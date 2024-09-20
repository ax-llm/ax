import type { ListChatsRes } from '@/types/chats.js';
import type { ListChatMessagesRes } from '@/types/messages';
import type { HandlerContext } from '@/util';

import { ObjectId } from 'mongodb';

import { type Chat, type Message } from './types.js';

export const chatPipeline = (match: Object) => [
  {
    $match: match
  },
  // fetch involved agents
  {
    $lookup: {
      as: 'agents',
      from: 'agents',
      let: { agentIds: '$agents' },
      pipeline: [
        {
          $match: {
            $expr: { $in: ['$_id', '$$agentIds'] }
          }
        },
        {
          $project: {
            _id: 0,
            description: 1,
            id: '$_id',
            name: 1
          }
        }
      ]
    }
  },
  // fetch default agent for this chat
  {
    $lookup: {
      as: 'agent',
      foreignField: '_id',
      from: 'agents',
      localField: 'agentId',
      pipeline: [
        {
          $project: {
            _id: 0,
            description: 1,
            id: '$_id',
            name: 1
          }
        }
      ]
    }
  },
  // fetch user who created this chat
  {
    $lookup: {
      as: 'user',
      foreignField: '_id',
      from: 'users',
      localField: 'userId',
      pipeline: [
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            picture: 1
          }
        }
      ]
    }
  },
  // get latest chats first
  {
    $sort: {
      updatedAt: -1
    }
  },
  // return these fields
  {
    $project: {
      _id: 0,
      agent: { $arrayElemAt: ['$agent', 0] },
      agents: 1,
      createdAt: 1,
      id: '$_id',
      isDone: 1,
      isReferenced: {
        $cond: {
          // eslint-disable-next-line perfectionist/sort-objects
          if: {
            $and: [
              { $isArray: '$refMessageIds' },
              { $gt: [{ $size: '$refMessageIds' }, 0] }
            ]
          },
          then: true,
          // eslint-disable-next-line perfectionist/sort-objects
          else: false
        }
      },
      isTitleUpdatable: {
        $cond: {
          // eslint-disable-next-line perfectionist/sort-objects
          if: {
            $and: [
              { $ifNull: ['$titleUpdatedAt', false] },
              { $ifNull: ['$updatedAt', false] },
              { $lt: ['$titleUpdatedAt', '$updatedAt'] }
            ]
          },
          then: true,
          // eslint-disable-next-line perfectionist/sort-objects
          else: false
        }
      },
      title: 1,
      titleUpdatedAt: 1,
      updatedAt: 1,
      user: { $arrayElemAt: ['$user', 0] }
    }
  }
];

const messageContentPipeline = () => [
  // fetch agent if agent message
  {
    $lookup: {
      as: 'agent',
      from: 'agents',
      let: { agentId: '$agentId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $ne: ['$$agentId', null] },
                { $ne: ['$$agentId', undefined] },
                { $eq: ['$_id', '$$agentId'] }
              ]
            }
          }
        },
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1
          }
        }
      ]
    }
  },
  // fetch user if user message
  {
    $lookup: {
      as: 'user',
      from: 'users',
      let: { userId: '$userId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $ne: ['$$userId', null] },
                { $ne: ['$$userId', undefined] },
                { $eq: ['$_id', '$$userId'] }
              ]
            }
          }
        },
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            picture: 1
          }
        }
      ]
    }
  },
  // return these fields
  {
    $project: {
      _id: 0,
      agent: { $arrayElemAt: ['$agent', 0] },
      chatId: 1,
      createdAt: 1,
      error: 1,
      files: {
        id: 1,
        name: 1,
        size: 1,
        type: 1
      },
      id: '$_id',
      mentions: {
        $map: {
          as: 'm',
          in: {
            agentId: '$$m.agentId'
          },
          input: '$mentions'
        }
      },
      parentId: 1,
      processing: 1,
      text: 1,
      threadId: 1,
      updatedAt: 1,
      user: { $arrayElemAt: ['$user', 0] }
    }
  }
];

export const messagePipeline = (match: Object) => [
  {
    $match: match
  },
  ...messageContentPipeline()
];

export const messagesForUserPipeline = (match: Object, userId: ObjectId) => [
  {
    $match: match
  },
  {
    $lookup: {
      as: 'chat',
      foreignField: '_id',
      from: 'chats',
      localField: 'chatId',
      pipeline: [
        {
          $project: {
            userId: 1
          }
        }
      ]
    }
  },
  {
    $match: {
      'chat.userId': userId
    }
  },
  ...messageContentPipeline()
];

export const getMessages = <
  T extends ListChatMessagesRes[0] = ListChatMessagesRes[0]
>(
  hc: Readonly<HandlerContext>,
  pipeline: Document[]
) => {
  return hc.db.collection<Message>('messages').aggregate<T>(pipeline);
};

export const getChats = <T extends ListChatsRes[0] = ListChatsRes[0]>(
  hc: Readonly<HandlerContext>,
  pipeline: Document[]
) => {
  return hc.db.collection<Chat>('chats').aggregate<T>(pipeline, {});
};
