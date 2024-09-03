import type { HandlerContext } from '@/util.js';
import type { Context } from 'hono';

import {
  type CreateUpdateAgentReq,
  type GetAgentRes,
  type ListAgentsRes
} from '@/types/agents.js';
import { ObjectId } from 'mongodb';

import type { Agent } from './types.js';

export const createAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const req = await c.req.json<CreateUpdateAgentReq>();
    const res = await hc.db.collection<Agent>('agents').insertOne({
      aiBigModel: {
        apiKey: req.aiBigModel.apiKey,
        id: req.aiBigModel.id,
        model: req.aiBigModel.model
      },
      aiSmallModel: {
        apiKey: req.aiSmallModel.apiKey,
        id: req.aiSmallModel.id,
        model: req.aiSmallModel.model
      },
      createdAt: new Date(),
      description: req.description,
      name: req.name
    });
    return c.json({ agentId: res.insertedId.toString() });
  };

export const updateAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const req = await c.req.json<CreateUpdateAgentReq>();
    const { agentId } = c.req.param();

    const aiBigModelApiKey =
      req.aiBigModel.apiKey && req.aiBigModel.apiKey !== 'set'
        ? { 'aiBigModel.apiKey': req.aiBigModel.apiKey }
        : {};

    const aiSmallModelApiKey =
      req.aiSmallModel.apiKey && req.aiSmallModel.apiKey !== 'set'
        ? { 'aiSmallModel.apiKey': req.aiSmallModel.apiKey }
        : {};

    await hc.db.collection<Agent>('agents').updateOne(
      { _id: new ObjectId(agentId) },
      {
        $set: {
          'aiBigModel.id': req.aiBigModel.id,
          'aiBigModel.model': req.aiBigModel.model,
          'aiSmallModel.id': req.aiSmallModel.id,
          'aiSmallModel.model': req.aiSmallModel.model,
          ...aiBigModelApiKey,
          ...aiSmallModelApiKey,
          description: req.description,
          name: req.name,
          updatedAt: new Date()
        }
      }
    );
    return c.json({ agentId });
  };

export const getAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { agentId } = c.req.param();

    const agent = await hc.db
      .collection<Agent>('agents')
      .findOne({ _id: new ObjectId(agentId) });

    if (!agent) {
      throw new Error('Agent not found: ' + agentId);
    }

    const res: GetAgentRes = {
      aiBigModel: {
        apiKeyId: agent.aiBigModel.apiKey?.substring(0, 4),
        id: agent.aiBigModel.id,
        model: agent.aiBigModel.model
      },
      aiSmallModel: {
        apiKeyId: agent.aiSmallModel.apiKey?.substring(0, 4),
        id: agent.aiSmallModel.id,
        model: agent.aiSmallModel.model
      },
      createdAt: agent.createdAt,
      description: agent.description,
      id: agent._id.toString(),
      name: agent.name,
      updatedAt: agent.updatedAt
    };

    return c.json(res);
  };

export const listAgentHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const agents = await hc.db.collection<Agent>('agents').find().toArray();
    const res: ListAgentsRes = agents.map((agent) => ({
      id: agent._id.toString(),
      name: agent.name
    }));
    return c.json(res);
  };
