import type {
  CreateUpdateChatMessageReq,
  GetChatMessageRes,
  ListChatMessagesRes
} from '@/types/messages.js';
import type { HandlerContext } from '@/util.js';
import type { Context } from 'hono';

import { type Tokens, marked } from 'marked';
import { ObjectId, type UpdateFilter } from 'mongodb';

import { createAI } from './ai.js';
import { getMessages, messagePipeline, messagesForUserPipeline } from './db.js';
import { ChatMemory, getChatPrompt } from './memory.js';
import { chatAgent } from './prompts.js';
import { sendMessages } from './stream.js';
import { type Agent, type Chat, type Message, user } from './types.js';
import { objectIds } from './util.js';

export const listChatMessagesHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId } = c.req.param();
    const userId = c.get('userId');

    // check if chat exists and user is part of the chat
    const chat = await hc.db.collection<Chat>('chats').findOne({
      _id: new ObjectId(chatId),
      userId
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    // get all messages for the chat
    const messages = (
      await getMessages(hc, messagePipeline({ chatId: chat._id })).toArray()
    ).map(decorateMessage);

    return c.json<ListChatMessagesRes>(messages);
  };

export const listChatMessagesByIdsHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const userId = c.get('userId');
    const messageIds = objectIds(c.req.query('messageIds'));

    if (messageIds.length === 0) {
      throw new Error('Message IDs not found');
    }

    const messages = (
      await getMessages(
        hc,
        messagesForUserPipeline({ _id: { $in: messageIds } }, userId)
      ).toArray()
    ).map(decorateMessage);

    return c.json(messages);
  };

export const createUpdateChatMessageHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const req = await c.req.json<CreateUpdateChatMessageReq>();

    const res =
      'messageId' in req && req.messageId
        ? await updateChatMessageHandler(hc, c, req)
        : await createChatMessageHandler(hc, c, req);

    return c.json<ListChatMessagesRes>(res);
  };

export const createChatMessageHandler = async (
  hc: Readonly<HandlerContext>,
  c: Readonly<Context>,
  req: Omit<CreateUpdateChatMessageReq, 'messageId'>
): Promise<ListChatMessagesRes> => {
  const { chatId: _chatId } = c.req.param();
  const userId = c.get('userId');

  const chatId = new ObjectId(_chatId);
  return await processChatMessage(hc, { chatId, userId, ...req });
};

export const updateChatMessageHandler = async (
  hc: Readonly<HandlerContext>,
  c: Readonly<Context>,
  req: CreateUpdateChatMessageReq
): Promise<ListChatMessagesRes> => {
  const { chatId: _chatId } = c.req.param();
  const userId = c.get('userId');

  const chatId = new ObjectId(_chatId);
  const messageId = new ObjectId(req.messageId);

  // use a transaction
  const session = await hc.dbClient.startSession();

  try {
    const res = await session.withTransaction(async () => {
      // find the message to update also ensure it's part of the chat
      // which ensures the chat e
      const message = await hc.db
        .collection<Message>('messages')
        .findOne({ _id: messageId, chatId });

      if (!message) {
        throw new Error('Message not found: ' + messageId);
      }

      // ensure we're not updating an agent message
      if (message.agentId) {
        throw new Error('Cannot update an agent message');
      }

      // delete all messages after and including the message to update
      await hc.db
        .collection<Message>('messages')
        .deleteMany({ chatId, createdAt: { $gte: message?.createdAt } });

      const res = await processChatMessage(hc, {
        chatId,
        previouslyCreatedAt: message.createdAt,
        userId,
        ...req
      });

      return res;
    });

    return res;
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
};

export const retryChatMessageHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { messageId } = c.req.param();
    const userId = c.get('userId');

    // find the message to retry
    const agentMessage = await hc.db
      .collection<Message>('messages')
      .findOne(
        { _id: new ObjectId(messageId) },
        { projection: { _id: 1, chatId: 1, error: 1, parentId: 1 } }
      );

    if (!agentMessage) {
      throw new Error('Message not found: ' + messageId.toString());
    }

    if (!agentMessage.parentId) {
      throw new Error('Message does not have a parent');
    }

    if (!agentMessage.error) {
      throw new Error('Message does not have an error');
    }

    // ensure the message is part of the chat the user is part of
    const chat = await hc.db.collection<Chat>('chats').findOne(
      {
        _id: agentMessage.chatId,
        userId
      },
      { projection: { _id: 1 } }
    );

    if (!chat) {
      throw new Error('Chat not found');
    }

    const chatId = agentMessage.chatId.toString();

    hc.taskRunner.addTask(chatId, () =>
      chatAgentTaskHandler(hc, { agentMessageId: agentMessage._id })
    );

    return c.json({ chatId, messageId });
  };

export const processChatMessage = async (
  hc: Readonly<HandlerContext>,
  req: {
    chatId: ObjectId;
    previouslyCreatedAt?: Date;
    userId: ObjectId;
  } & CreateUpdateChatMessageReq
): Promise<ListChatMessagesRes> => {
  const agentIds =
    req.mentions
      ?.filter((m) => m.agentId)
      .map((m) => new ObjectId(m.agentId)) ?? [];

  const res = await createUserAndAgentMessages(hc, {
    agentIds,
    chatId: req.chatId,
    previouslyCreatedAt: req.previouslyCreatedAt,
    text: req.text,
    userId: req.userId
  });

  const userMessage = await getMessages(
    hc,
    messagePipeline({ _id: res.userMessage._id })
  ).next();

  if (!userMessage) {
    throw new Error('User message not found');
  }

  await sendUpdateChatMessage(userMessage);

  const fnBatch = res.agentMessages.map(
    (agentMsg) => () =>
      chatAgentTaskHandler(hc, { agentMessageId: agentMsg._id, text: req.text })
  );

  hc.taskRunner.addTasks(req.chatId.toString(), fnBatch);

  return [userMessage];
};

const createUserAndAgentMessages = async (
  hc: Readonly<HandlerContext>,
  req: {
    agentIds: ObjectId[];
    chatId: ObjectId;
    previouslyCreatedAt?: Date;
    text: string;
    userId: ObjectId;
  }
) => {
  const now = new Date(new Date().getTime() + 10);
  const session = hc.dbClient.startSession();

  // Filter agentIds to include only those that exist in the database
  const validAgents = await hc.db
    .collection<Agent>('agents')
    .find(
      {
        _id: { $in: req.agentIds }
      },
      { projection: { _id: 1 } }
    )
    .toArray();

  const validAgentIds = validAgents.map((agent) => agent._id);

  try {
    const res = await session.withTransaction(async () => {
      // Update chat with only valid agentIds
      const chatUpdateResult = await hc.db
        .collection<Chat>('chats')
        .findOneAndUpdate(
          { _id: req.chatId, isDone: { $ne: true } },
          {
            $addToSet: { agents: { $each: validAgentIds } },
            $set: { updatedAt: now }
          },
          { returnDocument: 'after', session }
        );

      if (!chatUpdateResult) {
        throw new Error('Chat not found or does not match criteria');
      }

      // Create new messages
      const userMessage = {
        _id: new ObjectId(),
        chatId: req.chatId,
        createdAt: req.previouslyCreatedAt || now,
        text: req.text,
        updatedAt: req.previouslyCreatedAt ? now : undefined,
        userId: chatUpdateResult.userId
      };

      const agentMessages = validAgentIds.map((agentId, index) => ({
        _id: new ObjectId(),
        agentId,
        chatId: req.chatId,
        createdAt: new Date(now.getTime() + (index + 1) * 10),
        parentId: userMessage._id,
        processing: true
      }));

      if (validAgentIds.length === 0) {
        agentMessages.push({
          _id: new ObjectId(),
          agentId: chatUpdateResult.agentId,
          chatId: req.chatId,
          createdAt: new Date(now.getTime() + 10),
          parentId: userMessage._id,
          processing: true
        });
      }

      // Insert messages
      await hc.db
        .collection<Message>('messages')
        .insertMany([userMessage, ...agentMessages], { session });

      return {
        agentMessages,
        userMessage
      };
    });

    return res;
  } finally {
    await session.endSession();
  }
};

interface ChatAgentTaskHandlerArgs {
  agentMessageId: ObjectId;
  text?: string;
}

export const chatAgentTaskHandler = async (
  hc: Readonly<HandlerContext>,
  { agentMessageId, text }: ChatAgentTaskHandlerArgs
) => {
  const agentMessage = await getMessages(
    hc,
    messagePipeline({ _id: agentMessageId })
  ).next();

  if (!agentMessage) {
    throw new Error('Agent message not found: ' + agentMessageId.toString());
  }

  if (!agentMessage.agent?.id) {
    throw new Error('Agent message does not have an agent');
  }

  await sendUpdateChatMessageProcessing(agentMessage);

  if (!text) {
    const userMessage = await hc.db.collection<Message>('messages').findOne(
      {
        _id: new ObjectId(agentMessage.parentId)
      },
      { projection: { text: 1 } }
    );

    if (!userMessage) {
      throw new Error('User message not found: ' + agentMessage.parentId);
    }
    text = userMessage.text;
  }

  if (!text) {
    throw new Error('No text provided');
  }

  try {
    const { response } = await executeChat(hc, {
      agentId: agentMessage.agent.id,
      chatId: agentMessage.chatId,
      queryOrTask: text,
      uptoMessageId: agentMessage.parentId
    });

    const updatedAgentMessage = { ...agentMessage, text: response };

    await updateChatMessage(hc, updatedAgentMessage);
    await sendUpdateChatMessageDone(updatedAgentMessage);
  } catch (e) {
    const error = (e as Error).message;
    const updatedAgentMessage = { ...agentMessage, error };
    await updateChatMessage(hc, updatedAgentMessage);
    await sendUpdateChatMessageError(updatedAgentMessage);
  }
};

interface ExecuteChatArgs {
  agentId: ObjectId;
  chatId: ObjectId;
  queryOrTask: string;
  uptoMessageId?: ObjectId;
}

const executeChat = async (
  hc: Readonly<HandlerContext>,
  { agentId, chatId, queryOrTask, uptoMessageId }: ExecuteChatArgs
) => {
  const agent = await hc.db
    .collection<Agent>('agents')
    .findOne({ _id: agentId });

  if (!agent) {
    throw new Error('Agent not found: ' + agentId);
  }

  const chatHistory = await getChatPrompt(hc.db, { chatId, uptoMessageId });
  const mem = new ChatMemory([]);
  const ai = await createAI(hc, agent, 'big');
  ai.setOptions({ debug: true });
  const { markdownResponse } = await chatAgent.forward(
    ai,
    {
      agentDescription: agent.description,
      chatHistory,
      queryOrTask
    },
    { mem }
  );

  return { response: markdownResponse };
};

const sendUpdateChatMessage = async (message: GetChatMessageRes) => {
  const msg = decorateMessage(message);
  const chatId = message.chatId.toString();
  await sendMessages(chatId, { ...msg, msgType: 'updateChatMessage' });
};

export const sendUpdateChatMessageProcessing = async (
  message: GetChatMessageRes
) => {
  return sendUpdateChatMessage({
    ...message,
    processing: true
  });
};

export const sendUpdateChatMessageDone = async (message: GetChatMessageRes) => {
  // remove error field from arg.messages
  const { error, ...rest } = message;
  return sendUpdateChatMessage({ ...rest, processing: false });
};

const sendUpdateChatMessageError = async (message: GetChatMessageRes) => {
  return sendUpdateChatMessage({ ...message, processing: false });
};

const updateChatMessage = async (
  hc: HandlerContext,
  respMsg: GetChatMessageRes
) => {
  let data: UpdateFilter<Message> | undefined;

  if (respMsg.text) {
    data = {
      $set: {
        text: respMsg.text,
        updatedAt: respMsg.updatedAt
      },
      $unset: { error: 1, processing: 1 }
    };
  } else if (respMsg.error) {
    data = {
      $set: {
        error: respMsg.error,
        updatedAt: respMsg.updatedAt
      },
      $unset: {
        processing: 1
      }
    };
  } else {
    throw new Error('No response or error provided');
  }

  await hc.db
    .collection<Message>('messages')
    .updateOne({ _id: new ObjectId(respMsg.id) }, data);
};

export const decorateMessage = (
  message: ListChatMessagesRes[0]
): ListChatMessagesRes[0] => {
  return {
    ...message,
    html: message.text ? markdownToHtml(message.text) : undefined
  };
};

export const markdownToHtml = (markdown: string): string => {
  marked.use({
    renderer: {
      code: ({ lang, text }: Tokens.Code) => {
        if (lang === '') {
          return text;
        }
        if (lang === 'markdown') {
          return `${markdownToHtml(text)}`;
        }
        return `<pre><code class="language-${lang}">${text}</code></pre>`;
      }
    }
  });

  return marked.parse(markdown, {
    breaks: true,
    gfm: true,
    silent: true
  }) as string;
};
