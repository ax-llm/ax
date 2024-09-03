import type {
  CreateUpdateChatMessageReq,
  ListChatMessagesRes
} from '@/types/messages.js';
import type { HandlerContext } from '@/util.js';
import type { Context } from 'hono';

import { type Tokens, marked } from 'marked';
import { ObjectId, type UpdateFilter, type WithId } from 'mongodb';

import type { Agent, Chat, Message } from './types.js';

import { createAI } from './ai.js';
import { chatAgent } from './prompts.js';
import { sendMessages } from './stream.js';

export const listChatMessagesHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId } = c.req.param();

    const messages = await hc.db
      .collection<Message>('messages')
      .find({ chatId: new ObjectId(chatId) })
      .sort({ createdAt: 1 })
      .toArray();

    // list of unique agentIds
    const agentIds = [
      ...new Set(
        messages.map((m) => m.agentId).filter((id) => id !== undefined)
      )
    ];

    const agents = await hc.db
      .collection<Agent>('agents')
      .find({ _id: { $in: agentIds } })
      .toArray();

    const res: ListChatMessagesRes = messages.map((message) => {
      const agent = agents.find((a) => a._id.equals(message.agentId));
      return messageToListChatMessagesRes(message, agent);
    });

    return c.json(res);
  };

export const createUpdateChatMessageHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId: _chatId } = c.req.param();
    const req = await c.req.json<CreateUpdateChatMessageReq>();
    const chatId = new ObjectId(_chatId);
    const messageId = req.messageId ? new ObjectId(req.messageId) : undefined;

    const res = messageId
      ? await updateChatMessageHandler(hc, chatId, messageId, req)
      : await createChatMessageHandler(hc, chatId, req);

    return c.json<ListChatMessagesRes>(res);
  };

export const createChatMessageHandler = async (
  hc: Readonly<HandlerContext>,
  chatId: ObjectId,
  req: CreateUpdateChatMessageReq
): Promise<ListChatMessagesRes> => {
  return await processChatMessage(hc, { chatId, ...req });
};

export const updateChatMessageHandler = async (
  hc: Readonly<HandlerContext>,
  chatId: ObjectId,
  messageId: ObjectId,
  req: Omit<CreateUpdateChatMessageReq, 'messageId'>
): Promise<ListChatMessagesRes> => {
  const session = await hc.dbClient.startSession();
  session.startTransaction();

  const message = await hc.db
    .collection<Message>('messages')
    .findOne({ _id: messageId, chatId });

  if (!message) {
    throw new Error('Message not found: ' + messageId);
  }

  if (message.agentId) {
    throw new Error('Cannot update an agent message');
  }

  await hc.db
    .collection<Message>('messages')
    .deleteMany({ chatId, createdAt: { $gte: message?.createdAt } });

  const res = await processChatMessage(hc, {
    chatId,
    createdAt: message.createdAt,
    ...req
  });

  await session.commitTransaction();
  session.endSession();

  return res;
};

export const retryChatMessageHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId, messageId } = c.req.param();

    const chat = await hc.db.collection<Chat>('chats').findOneAndUpdate(
      {
        _id: new ObjectId(chatId)
      },
      {
        $set: { updatedAt: new Date() }
      }
    );
    if (!chat) {
      throw new Error('Chat not found: ' + chatId.toString());
    }

    const respMsg = await hc.db
      .collection<Message>('messages')
      .findOne({ _id: new ObjectId(messageId) });

    if (!respMsg) {
      throw new Error('Message not found: ' + messageId.toString());
    }

    if (!respMsg.parentId) {
      throw new Error('Message does not have a parent');
    }

    if (!respMsg.error) {
      throw new Error('Message does not have an error');
    }

    const reqMsg = await hc.db
      .collection<Message>('messages')
      .findOne({ _id: new ObjectId(respMsg.parentId) });

    if (!reqMsg) {
      throw new Error('Message not found: ' + messageId.toString());
    }

    setTimeout(() => {
      chatAgentTaskHandler(hc, reqMsg, respMsg);
    }, 100);

    return c.json({ chatId });
  };

export const processChatMessage = async (
  hc: Readonly<HandlerContext>,
  req: { chatId: ObjectId; createdAt?: Date } & CreateUpdateChatMessageReq
): Promise<ListChatMessagesRes> => {
  const chat = await hc.db.collection<Chat>('chats').findOneAndUpdate(
    {
      _id: req.chatId
    },
    {
      $set: { updatedAt: new Date() }
    }
  );
  if (!chat) {
    throw new Error('Chat not found');
  }

  const updatedAt = req.createdAt ? new Date() : undefined;

  const reqMsg: WithId<Message> = {
    _id: new ObjectId(),
    chatId: req.chatId,
    createdAt: req.createdAt ?? new Date(),
    text: req.text,
    ...(updatedAt ? { updatedAt } : {})
  };

  const respMsg: WithId<Message> = {
    _id: new ObjectId(),
    agentId: chat.agentId,
    chatId: req.chatId,
    createdAt: reqMsg.createdAt,
    parentId: reqMsg._id,
    processing: true
  };

  await hc.db.collection<Message>('messages').insertMany([reqMsg, respMsg]);

  setTimeout(() => {
    chatAgentTaskHandler(hc, reqMsg, respMsg);
  }, 100);

  return [messageToListChatMessagesRes(reqMsg)];
};

export const chatAgentTaskHandler = async (
  hc: Readonly<HandlerContext>,
  reqMsg: WithId<Message>,
  respMsg: WithId<Message>
) => {
  await sendUpdateChatMessage({ message: reqMsg });

  if (!respMsg.agentId) {
    throw new Error('Agent ID not found');
  }

  if (reqMsg.error) {
    throw new Error('Request message cannot have an error');
  }

  if (!reqMsg.text) {
    throw new Error('Request message must have text');
  }

  const agent = await hc.db.collection<Agent>('agents').findOne({
    _id: respMsg.agentId
  });
  if (!agent) {
    throw new Error('Agent not found: ' + respMsg.agentId.toString());
  }

  await sendUpdateChatMessageProcessing({ agent, message: respMsg });

  try {
    const ai = createAI(agent, 'big');
    ai.setOptions({ debug: true });

    const { markdownResponse } = await chatAgent.forward(ai, {
      query: reqMsg.text
    });

    const updatedRespMsg = { ...respMsg, text: markdownResponse };

    await updateChatMessage(hc, updatedRespMsg);
    await sendUpdateChatMessageDone({ agent, message: updatedRespMsg });
  } catch (e) {
    const error = (e as Error).message;
    const updatedRespMsg = { ...respMsg, error };

    await updateChatMessage(hc, updatedRespMsg);
    await sendUpdateChatMessageError({ agent, error, message: updatedRespMsg });
  }
};

interface SendUpdateChatMessageArgs {
  agent?: WithId<Agent>;
  message: WithId<Message>;
}

const sendUpdateChatMessage = async ({
  agent,
  message
}: SendUpdateChatMessageArgs) => {
  const val = messageToListChatMessagesRes({ ...message }, agent);
  const chatId = message.chatId.toString();
  await sendMessages(chatId, {
    msgType: 'updateChatMessage',
    ...val
  });
};

const sendUpdateChatMessageProcessing = async (
  args: SendUpdateChatMessageArgs
) => {
  return sendUpdateChatMessage({
    ...args,
    message: { ...args.message, processing: true }
  });
};

const sendUpdateChatMessageDone = async (args: SendUpdateChatMessageArgs) => {
  return sendUpdateChatMessage({
    ...args,
    message: { ...args.message, processing: false }
  });
};

const sendUpdateChatMessageError = async ({
  error,
  ...args
}: { error: string } & SendUpdateChatMessageArgs) => {
  return sendUpdateChatMessage({
    ...args,
    message: { ...args.message, error, processing: false }
  });
};

const messageToListChatMessagesRes = (
  message: WithId<Message>,
  agent?: WithId<Agent>
): ListChatMessagesRes[0] => {
  const agentValue = agent
    ? { id: agent._id.toString(), name: agent.name }
    : undefined;

  return {
    createdAt: message.createdAt,
    id: message._id.toString(),
    updatedAt: message.updatedAt,
    ...(agentValue ? { agent: agentValue } : {}),
    ...(message.error ? { error: message.error } : {}),
    ...(message.text && message.agentId
      ? { html: markdownToHtml(message.text) }
      : { text: message.text }),
    ...(message.processing !== undefined
      ? { processing: message.processing }
      : {})
  };
};

const updateChatMessage = async (
  hc: HandlerContext,
  respMsg: WithId<Message>
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
    .updateOne({ _id: respMsg._id }, data);
};

export const markdownToHtml = (markdown: string): string => {
  marked.use({
    renderer: {
      code: ({ lang, text }: Tokens.Code) => {
        return lang && lang.length > 0
          ? `<pre><code class="language-${lang}">${text}</code></pre>`
          : text;
      }
    }
  });

  return marked.parse(markdown, {
    breaks: true,
    gfm: true,
    silent: true
  }) as string;
};
