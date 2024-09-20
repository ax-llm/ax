import type { HandlerContext } from '@/util.js';
import type { Context } from 'hono';

import { type GetChatRes, createChatReq } from '@/types/chats.js';
import { ObjectId, type WithId } from 'mongodb';

import type { Agent, Chat, Message } from './types.js';

import { createAI } from './ai.js';
import { chatPipeline, getChats, getMessages, messagePipeline } from './db.js';
import {
  processChatMessage,
  sendUpdateChatMessageDone,
  sendUpdateChatMessageProcessing
} from './messages.js';
import { genTitle } from './prompts.js';
import { getFiles } from './util.js';

export const listChatsHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const userId = c.get('userId');
    const chats = await getChats(hc, chatPipeline({ userId })).toArray();
    return c.json(chats);
  };

export const getChatHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId } = c.req.param();
    const userId = c.get('userId');

    const chat = await getChats(
      hc,
      chatPipeline({
        _id: new ObjectId(chatId),
        userId
      })
    ).next();

    if (!chat) {
      throw new Error('Chat not found');
    }

    return c.json<GetChatRes>(chat);
  };

export const createChatHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const form = await c.req.formData();
    const reqObj = JSON.parse(form.get('json') as string);
    const req = createChatReq.parse(reqObj);

    const userId = c.get('userId');
    const files = getFiles(form);

    const session = hc.dbClient.startSession();

    try {
      const chatId = await session.withTransaction(async () => {
        const agent = await hc.db.collection<Agent>('agents').findOne({
          _id: new ObjectId(req.agentId),
          userId
        });
        if (!agent) {
          throw new Error('Agent not found');
        }

        const chatId = new ObjectId();
        const now = new Date();

        let existingMsgs: WithId<Message>[] = [];
        let refMessage: WithId<Message> | undefined;
        let refChatId: ObjectId | undefined;
        let agentId = agent._id;

        if (req.refChatId) {
          refChatId = new ObjectId(req.refChatId);
          const refChat = await hc.db
            .collection<Chat>('chats')
            .findOne({ _id: refChatId, userId });

          if (!refChat) {
            throw new Error('Ref chat not found');
          }

          refMessage = {
            _id: new ObjectId(),
            chatId: refChat._id,
            createdAt: now,
            processing: true,
            threadId: chatId
          };

          existingMsgs = [refMessage];
        }

        if (refChatId && req.messageIds) {
          const messageIds = req.messageIds.map((id) => new ObjectId(id));
          const selectedMessages = await hc.db
            .collection<Message>('messages')
            .find({ _id: { $in: messageIds }, chatId: refChatId })
            .toArray();

          const validSelectedMessages = selectedMessages.filter(
            (msg) => !msg.error && !msg.processing
          );

          if (
            validSelectedMessages.length === 1 &&
            validSelectedMessages[0].agentId
          ) {
            agentId = validSelectedMessages[0].agentId;
          }

          const msgs = validSelectedMessages.map((msg) => ({
            _id: new ObjectId(),
            agentId,
            chatId,
            createdAt: now,
            parentId: msg._id,
            text: msg.text
          }));

          existingMsgs = [...existingMsgs, ...msgs];
        }

        if (existingMsgs.length > 0) {
          const msgs = existingMsgs.map((msg, i) => ({
            ...msg,
            createdAt: new Date(now.getTime() + 10 * (i + 1))
          }));

          await hc.db.collection<Message>('messages').insertMany(msgs);
        }

        if (refMessage) {
          const pl = messagePipeline({ _id: refMessage._id });
          const message = await getMessages(hc, pl).next();
          if (!message) {
            throw new Error('Ref message not found: ' + refMessage._id);
          }
          await sendUpdateChatMessageProcessing(message);
        }

        const ai = await createAI(hc, agent, 'small');
        const { chatTitle } = await genTitle.forward(ai, {
          chatMessages: req.text
        });

        const chat: WithId<Chat> = {
          _id: chatId,
          agentId,
          createdAt: now,
          title: chatTitle,
          titleUpdatedAt: now,
          userId,
          ...(refMessage ? { refMessageIds: [refMessage._id] } : {})
        };

        await hc.db.collection<Chat>('chats').insertOne(chat);

        await processChatMessage(hc, {
          chatId,
          userId,
          ...req,
          files
        });

        return chatId;
      });

      return c.json<{ id: string }>({ id: chatId.toString() });
    } catch (error) {
      session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  };

export const setChatDoneHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId } = c.req.param();
    const userId = c.get('userId');

    const session = hc.dbClient.startSession();

    try {
      session.withTransaction(async () => {
        const chat = await hc.db.collection<Chat>('chats').findOne({
          _id: new ObjectId(chatId),
          userId
        });

        if (!chat) {
          throw new Error('Chat not found');
        }

        if (!chat.refMessageIds || chat.refMessageIds.length === 0) {
          throw new Error('Chat has no ref messages');
        }

        const lastMessage = await hc.db
          .collection<Message>('messages')
          .find(
            { chatId: chat._id },
            {
              limit: 1,
              projection: { text: 1 },
              sort: { createdAt: -1 }
            }
          )
          .next();

        if (!lastMessage) {
          throw new Error('Chat has no messages');
        }

        await hc.db.collection<Message>('messages').updateMany(
          { _id: { $in: chat.refMessageIds } },
          {
            $set: {
              createdAt: new Date(),
              text: lastMessage.text
            },
            $unset: {
              processing: 1
            }
          }
        );

        const respMsgs = await getMessages(
          hc,
          messagePipeline({ _id: { $in: chat.refMessageIds } })
        ).toArray();

        await hc.db.collection<Chat>('chats').updateOne(
          { _id: chat._id },
          {
            $set: {
              isDone: true,
              updatedAt: new Date()
            }
          }
        );

        for (const respMsg of respMsgs) {
          await sendUpdateChatMessageDone(respMsg);
        }
      });

      return c.json<{ chatId: string }>({ chatId });
    } catch (error) {
      session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  };

export const setChatTitleHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId } = c.req.param();
    const userId = c.get('userId');

    const chat = await hc.db.collection<Chat>('chats').findOne({
      _id: new ObjectId(chatId),
      userId
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    if (!chat.updatedAt) {
      return c.json({ chatId });
    }

    if (chat.titleUpdatedAt && chat.titleUpdatedAt >= chat.updatedAt) {
      return c.json({ chatId });
    }

    const agent = await hc.db.collection<Agent>('agents').findOne({
      _id: chat.agentId,
      userId
    });
    if (!agent) {
      throw new Error('Agent not found');
    }

    const messages = await hc.db
      .collection<Message>('messages')
      .find(
        { chatId: chat._id },
        {
          limit: 3,
          projection: { files: 1, text: 1 },
          sort: { createdAt: -1 }
        }
      )
      .toArray();

    if (messages.length === 0) {
      throw new Error('Chat has no messages');
    }

    const chatMessages = messages
      .map((msg) => msg.text)
      .filter(Boolean)
      .join('\n');

    const context = messages
      .map((msg) => msg.files?.map((f) => f.file).join(', '))
      .filter(Boolean)
      .join('\n');

    const ai = await createAI(hc, agent, 'small');

    const { chatTitle } = await genTitle.forward(ai, {
      chatMessages,
      context
    });

    await hc.db.collection<Chat>('chats').updateOne(
      { _id: chat._id },
      {
        $set: {
          title: chatTitle,
          titleUpdatedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    return c.json({ chatId });
  };
