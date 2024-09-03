import type { CreateChatReq, GetChatRes, ListChatsRes } from '@/types/chats.js';
import type { HandlerContext } from '@/util.js';
import type { Context } from 'hono';

import { ObjectId, type WithId } from 'mongodb';

import type { Agent, Chat, Message } from './types.js';

import { createAI } from './ai.js';
import { chatAgentTaskHandler } from './messages.js';
import { genTitle } from './prompts.js';

export const listChatsHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const chats = await hc.db.collection<Chat>('chats').find().toArray();
    const res: ListChatsRes = chats.map((chat) => ({
      id: chat._id.toString(),
      title: chat.title ?? 'Untitled'
    }));
    return c.json(res);
  };

export const getChatHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { chatId } = c.req.param();
    console.log('chatId:', chatId);

    const chat = await hc.db
      .collection<Chat>('chats')
      .findOne({ _id: new ObjectId(chatId) });

    if (!chat) {
      throw new Error('Chat not found');
    }

    const res: GetChatRes = {
      agent: {
        description: 'Agent Description',
        id: chat.agentId.toString(),
        name: 'Agent Name'
      },
      id: chat._id.toString(),
      title: chat.title
    };
    return c.json(res);
  };

export const createChatHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const req = await c.req.json<CreateChatReq>();

    const agent = await hc.db.collection<Agent>('agents').findOne({
      _id: new ObjectId(req.agentId)
    });
    if (!agent) {
      throw new Error('Agent not found');
    }

    const ai = createAI(agent, 'small');
    const { chatTitle } = await genTitle.forward(ai, {
      firstChatMessage: req.text
    });

    const chat: WithId<Chat> = {
      _id: new ObjectId(),
      agentId: agent._id,
      createdAt: new Date(),
      title: chatTitle
    };

    await hc.db.collection<Chat>('chats').insertOne(chat);

    const reqMsg: WithId<Message> = {
      _id: new ObjectId(),
      chatId: chat._id,
      createdAt: new Date(),
      text: req.text
    };

    const respMsg: WithId<Message> = {
      _id: new ObjectId(),
      agentId: agent._id,
      chatId: chat._id,
      createdAt: new Date(),
      parentId: reqMsg._id,
      processing: true
    };

    await hc.db.collection<Message>('messages').insertMany([reqMsg, respMsg]);

    setTimeout(() => {
      chatAgentTaskHandler(hc, reqMsg, respMsg);
    }, 100);

    return c.json<{ id: string }>({
      id: chat._id.toString()
    });
  };
