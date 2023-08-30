import http, { IncomingMessage } from 'http';
import zlib from 'zlib';

import chalk from 'chalk';
import httpProxy from 'http-proxy';

import { uuid } from '../text/util.js';

import { getTarget, publishTrace } from './tracing.js';
import { ExtendedIncomingMessage } from './types.js';

import 'dotenv/config';

const debug = process.env.DEBUG === 'true';

const proxy = httpProxy.createProxyServer({
  secure: false,
  prependPath: true,
  changeOrigin: true,
});

http
  .createServer(async (_req, res) => {
    const req = _req as ExtendedIncomingMessage;
    if (!req.url) {
      errMsg(res, 'No URL provided');
      return;
    }

    let target;

    if (req.headers['content-type'] === 'application/json') {
      const apiName = req.url.split('/', 2).at(1);
      target = getTarget(apiName);

      req.id = uuid();
      req.type = apiName;
      req.url = req.type ? req.url.substring(req.type.length + 1) : req.url;
      req.pathname = new URL(req.url, target).pathname;
      req.startTime = Date.now();

      if (debug) {
        console.log('> Proxying', req.id, apiName, target, req.pathname);
      }
    }

    proxy.web(req, res, { target });
  })
  .listen(8081, () => {
    console.log(chalk.greenBright('🦙 LLMClient proxy listening on port 8081'));
  });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
proxy.on('proxyReq', async (_proxyReq, _req, _res) => {
  const req = _req as ExtendedIncomingMessage;
  if (req.id) {
    req.reqBody = await getBody(_req);
  }
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
proxy.on('proxyRes', async (_proxyRes, _req, _res) => {
  const req = _req as ExtendedIncomingMessage;
  if (req.id) {
    req.resBody = await getBody(_proxyRes);
    publishTrace(req);
  }
});

proxy.on('error', (err, _req, res) => {
  console.log('Proxying failed', err);
  res.end();
});

// const cache = new Cache();

const errMsg = (res: Readonly<http.ServerResponse>, msg: string) => {
  res.writeHead(500);
  res.end(msg);
  return;
};

const getBody = (req: Readonly<IncomingMessage>): Promise<string> => {
  const chunks: Uint8Array[] = [];

  return new Promise((resolve, reject) => {
    const handler = (err: unknown, decoded: { toString: () => string }) =>
      err ? reject(err) : resolve(decoded.toString());

    req
      .on('data', function (chunk: Uint8Array) {
        chunks.push(chunk);
      })
      .on('end', function () {
        const buff = Buffer.concat(chunks);
        switch (req.headers['content-encoding']) {
          case 'gzip':
            zlib.gunzip(buff, handler);
            break;
          case 'deflate':
            zlib.inflate(buff, handler);
            break;
          case 'br':
            zlib.brotliDecompress(buff, handler);
            break;
          default:
            resolve(buff.toString());
        }
      });
  });
};
