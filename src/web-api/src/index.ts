import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { etag } from 'hono/etag';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { MongoClient } from 'mongodb';

import type { HandlerContext } from './util.js';

import {
  createAgentHandler,
  getAgentHandler,
  listAgentHandler,
  updateAgentHandler
} from './api/agents.js';
import { aiListHandler } from './api/ai.js';
import {
  createChatHandler,
  getChatHandler,
  listChatsHandler
} from './api/chats.js';
import {
  createUpdateChatMessageHandler,
  listChatMessagesHandler,
  retryChatMessageHandler
} from './api/messages.js';
import { createChatWebSocketHandler } from './api/stream.js';
import { createUpdateAgentReq } from './types/agents.js';
import { createChatReq } from './types/chats.js';
import { createUpdateChatMessageReq } from './types/messages.js';

// const isProd = process.env.NODE_ENV === 'production';

if (!process.env.MONGO_URI) {
  throw new Error('MONGO_URI is not set');
}

if (!process.env.APP_SECRET) {
  throw new Error('APP_SECRET is not set');
}

if (!process.env.APACHE_TIKA_URL) {
  throw new Error('APACHE_TIKA_URL is not set');
}

const dbClient = new MongoClient(process.env.MONGO_URI, {
  retryReads: true,
  retryWrites: true
});
await dbClient.connect();

const db = dbClient.db('ax');

// setup hono context
const hc: HandlerContext = {
  db,
  dbClient
};

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.trace(err);
  return c.text('Server made boo boo', 500);
});

const apiPublic = new Hono();
apiPublic.get('/ai', aiListHandler());

apiPublic.post(
  '/agents',
  zValidator('json', createUpdateAgentReq),
  createAgentHandler(hc)
);
apiPublic.post(
  '/agents/:agentId',
  zValidator('json', createUpdateAgentReq),
  updateAgentHandler(hc)
);
apiPublic.get('/agents', listAgentHandler(hc));
apiPublic.get('/agents/:agentId', getAgentHandler(hc));

apiPublic.post(
  '/chats',
  zValidator('json', createChatReq),
  createChatHandler(hc)
);

apiPublic.get('/chats', listChatsHandler(hc));
apiPublic.get('/chats/ws', upgradeWebSocket(createChatWebSocketHandler));
apiPublic.get('/chats/:chatId', getChatHandler(hc));

apiPublic.post(
  '/chats/:chatId/messages',
  zValidator('json', createUpdateChatMessageReq),
  createUpdateChatMessageHandler(hc)
);

apiPublic.get('/chats/:chatId/messages', listChatMessagesHandler(hc));

apiPublic.post(
  '/chats/:chatId/messages/:messageId/retry',
  retryChatMessageHandler(hc)
);

app.use(
  '/*',
  cors({
    allowHeaders: ['Upgrade-Insecure-Requests', 'Content-Type'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    credentials: true,
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    origin: ['http://localhost:5173']
  }),
  etag(),
  logger()
);

app.route('/api/p', apiPublic);

const server = serve(
  {
    fetch: app.fetch,
    port: process.env.PORT ?? 3000
  },
  ({ address, port }) => {
    console.log(`Server started on http://${address}:${port}`);
  }
);

injectWebSocket(server);
