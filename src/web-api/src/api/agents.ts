import type { HandlerContext } from '@/util.js';
import type { Context } from 'hono';

import {
  type CreateUpdateAgentReq,
  type GetAgentRes,
  type ListAgentsRes
} from '@/types/agents.js';
import { ObjectId } from 'mongodb';

import type { Agent } from './types.js';

import { decryptData, encryptData } from './crypto.js';
import { getUser } from './users.js';

export const listAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const user = await getUser(hc, c);

    const agents = await hc.db
      .collection<Agent>('agents')
      .find<ListAgentsRes[0]>(
        {
          userId: user._id
        },
        {
          projection: {
            _id: 0,
            description: 1,
            id: '$_id',
            name: 1
          }
        }
      )
      .toArray();

    return c.json(agents);
  };

export const getAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { agentId } = c.req.param();

    const agent = await hc.db.collection<Agent>('agents').findOne<GetAgentRes>(
      { _id: new ObjectId(agentId) },
      {
        projection: {
          _id: 0,
          aiBigModel: {
            apiKeyId: 1,
            id: 1,
            model: 1
          },
          aiSmallModel: {
            apiKeyId: 1,
            id: 1,
            model: 1
          },
          createdAt: 1,
          description: 1,
          id: '$_id',
          name: 1,
          updatedAt: 1
        }
      }
    );

    if (!agent) {
      throw new Error('Agent not found: ' + agentId);
    }

    return c.json(agent);
  };

export const createAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const req = await c.req.json<CreateUpdateAgentReq>();
    const userId = c.get('userId');

    const res = await hc.db.collection<Agent>('agents').insertOne({
      aiBigModel: {
        apiKey: await encryptKey(hc, req.aiBigModel.apiKey),
        apiKeyId: req.aiBigModel.apiKey?.slice(-4),
        id: req.aiBigModel.id,
        model: req.aiBigModel.model
      },
      aiSmallModel: {
        apiKey: await encryptKey(hc, req.aiSmallModel.apiKey),
        apiKeyId: req.aiSmallModel.apiKey?.slice(-4),
        id: req.aiSmallModel.id,
        model: req.aiSmallModel.model
      },
      createdAt: new Date(),
      description: req.description,
      name: req.name,
      userId
    });

    return c.json({ agentId: res.insertedId.toString() });
  };

export const updateAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const req = await c.req.json<CreateUpdateAgentReq>();
    const userId = c.get('userId');

    const { agentId } = c.req.param();

    let bmApiKey,
      smApiKey = {};

    if (req.aiBigModel.apiKey && req.aiBigModel.apiKey !== 'set') {
      bmApiKey = {
        'aiBigModel.apiKey': await encryptKey(hc, req.aiBigModel.apiKey),
        'aiBigModel.apiKeyId': req.aiBigModel.apiKey.slice(-4)
      };
    }

    if (req.aiSmallModel.apiKey && req.aiSmallModel.apiKey !== 'set') {
      smApiKey = {
        'aiSmallModel.apiKey': await encryptKey(hc, req.aiSmallModel.apiKey),
        'aiSmallModel.apiKeyId': req.aiSmallModel.apiKey.slice(-4)
      };
    }

    await hc.db.collection<Agent>('agents').updateOne(
      { _id: new ObjectId(agentId), userId },
      {
        $set: {
          'aiBigModel.id': req.aiBigModel.id,
          'aiBigModel.model': req.aiBigModel.model,
          'aiSmallModel.id': req.aiSmallModel.id,
          'aiSmallModel.model': req.aiSmallModel.model,
          ...bmApiKey,
          ...smApiKey,
          description: req.description,
          name: req.name,
          updatedAt: new Date()
        }
      }
    );
    return c.json({ agentId });
  };

export const encryptKey = (hc: Readonly<HandlerContext>, key?: string) =>
  key ? encryptData(hc, key, 'ax:llm:apiKey') : undefined;

export const decryptKey = async (
  hc: Readonly<HandlerContext>,
  key?: string
) => {
  if (!key) {
    return undefined;
  }
  const dk = await decryptData(hc, key, 'ax:llm:apiKey');
  return dk.payload['sub'];
};
