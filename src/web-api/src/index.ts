import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { googleAuth } from '@hono/oauth-providers/google';
import { zValidator } from '@hono/zod-validator';
import { createSecretKey } from 'crypto';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { etag } from 'hono/etag';
import { HTTPException } from 'hono/http-exception';
import { jwt } from 'hono/jwt';
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
import { auth, googleOAuthHandler } from './api/auth.js';
import {
  createChatHandler,
  getChatHandler,
  listChatsHandler,
  setChatDoneHandler
} from './api/chats.js';
import {
  createUpdateChatMessageHandler,
  listChatMessagesByIdsHandler,
  listChatMessagesHandler,
  retryChatMessageHandler
} from './api/messages.js';
import { createChatWebSocketHandler } from './api/stream.js';
import { TaskRunner } from './api/tasks.js';
import { getMeHandler, getUserHandler } from './api/users.js';
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

if (!process.env.DATA_SECRET) {
  throw new Error('DATA_SECRET is not set');
}

if (process.env.DATA_SECRET.length < 32) {
  throw new Error('DATA_SECRET must be at least 32 characters long');
}

if (!process.env.APACHE_TIKA_URL) {
  throw new Error('APACHE_TIKA_URL is not set');
}

const dataSecret = createSecretKey(
  process.env.DATA_SECRET.substring(0, 32),
  'utf-8'
);

const appSecret = createSecretKey(
  process.env.DATA_SECRET.substring(0, 32),
  'utf-8'
);

const taskRunner = new TaskRunner();

const dbClient = new MongoClient(process.env.MONGO_URI, {
  retryReads: true,
  retryWrites: true
});
await dbClient.connect();

const db = dbClient.db('ax');

// setup hono context
const hc: HandlerContext = {
  appSecret,
  dataSecret,
  db,
  dbClient,
  taskRunner
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

if (process.env.GOOGLE_ID && process.env.GOOGLE_SECRET) {
  console.log('Google OAuth enabled');
  apiPublic.get(
    '/auth/google',
    googleAuth({
      client_id: process.env.GOOGLE_ID,
      client_secret: process.env.GOOGLE_SECRET,
      redirect_uri: 'http://localhost:5173/api/p/auth/google',
      scope: ['email', 'profile']
    }),
    googleOAuthHandler(hc)
  );
}

const apiAuth = new Hono();
apiAuth.use(
  '/*',
  jwt({ cookie: 'ax', secret: process.env.APP_SECRET }),
  auth()
);
apiAuth.get('/me', getMeHandler(hc));
apiAuth.get('/users/:userId', getUserHandler(hc));

apiAuth.post(
  '/agents',
  zValidator('json', createUpdateAgentReq),
  createAgentHandler(hc)
);
apiAuth.post(
  '/agents/:agentId',
  zValidator('json', createUpdateAgentReq),
  updateAgentHandler(hc)
);
apiAuth.get('/agents', listAgentHandler(hc));
apiAuth.get('/agents/:agentId', getAgentHandler(hc));

apiAuth.post(
  '/chats',
  zValidator('json', createChatReq),
  createChatHandler(hc)
);
apiAuth.get('/chats', listChatsHandler(hc));
apiAuth.get('/chats/ws', upgradeWebSocket(createChatWebSocketHandler));
apiAuth.get('/chats/:chatId', getChatHandler(hc));

apiAuth.post(
  '/chats/:chatId/messages',
  zValidator('json', createUpdateChatMessageReq),
  createUpdateChatMessageHandler(hc)
);
apiAuth.post('/chats/:chatId/done', setChatDoneHandler(hc));
apiAuth.get('/chats/:chatId/messages', listChatMessagesHandler(hc));

apiAuth.get('/messages', listChatMessagesByIdsHandler(hc));
apiAuth.post('/messages/:messageId/retry', retryChatMessageHandler(hc));

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
  compress(),
  etag(),
  logger()
);

app.route('/api/p', apiPublic);
app.route('/api/a', apiAuth);

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
