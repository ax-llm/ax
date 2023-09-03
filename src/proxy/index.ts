#!/usr/bin/env node

import crypto from 'crypto';
import http, { IncomingMessage } from 'http';
import stream from 'stream';
import zlib from 'zlib';

import chalk from 'chalk';
import httpProxy from 'http-proxy';

import { Cache } from './cache.js';
import {
  buildTrace,
  processRequest,
  publishTrace,
  remoteLog,
  updateCachedTrace,
} from './tracing.js';
import { CacheItem, ExtendedIncomingMessage } from './types.js';
import 'dotenv/config';
import { convertToAPIError } from './util.js';

const debug = (process.env.DEBUG ?? 'true') === 'true';

const cache = new Cache<CacheItem>();

const proxy = httpProxy.createProxyServer({
  secure: false,
  prependPath: true,
  changeOrigin: true,
});

http
  .createServer(async (_req, _res) => {
    const req = _req as ExtendedIncomingMessage;
    const chunks = await getBody(req);

    const buff = Buffer.concat(chunks);
    const hash = crypto
      .createHash('sha1')
      .update(req.url ?? '')
      .update(buff)
      .digest('hex');
    const cachedResponse = cache.get(hash);
    const contentEncoding = req.headers['content-encoding'];

    req.traceId = req.headers['x-llmclient-traceid'] as string | undefined;
    req.sessionId = req.headers['x-llmclient-sessionid'] as string | undefined;

    if (debug) {
      console.log('> Proxying', hash, req.url);
    }

    if (cachedResponse) {
      const { body, headers, trace } = cachedResponse;
      _res.writeHead(200, headers);
      _res.write(Buffer.concat(body));
      _res.end();

      if (trace) {
        const updatedTrace = updateCachedTrace(req, trace);
        publishTrace(updatedTrace, debug);
      }
      return;
    }

    req.reqHash = hash;
    let target;

    try {
      target = processRequest(req);
    } catch (err: unknown) {
      console.log('Error processing request', err);
      return;
    }

    if (target && req.headers['content-type'] === 'application/json') {
      req.reqBody = await decompress(contentEncoding, buff);
    }

    // setup body buffer to pass to proxy
    const buffer = new stream.PassThrough();
    buffer.end(buff);

    // send the request to be proxied
    proxy.web(req, _res, { target, buffer });
  })
  .listen(8081, () => {
    console.log(
      chalk.greenBright('🌵 LLMClient caching proxy listening on port 8081')
    );
    remoteLog.printDebugInfo();
    console.log('🔥 ❤️  🖖🏼');
  });

// proxy.on('proxyReq', async (_proxyReq, _req, _res) => {
// });

proxy.on('proxyRes', async (_proxyRes, _req, _res) => {
  const req = _req as ExtendedIncomingMessage;

  const chunks = await getBody(_proxyRes);
  const buff = Buffer.concat(chunks);
  const contentEncoding = _proxyRes.headers['content-encoding'];
  const isOK = _proxyRes.statusCode === 200;

  // parse out error for tracing
  if (!isOK) {
    req.error = convertToAPIError(req, _proxyRes);
  }

  let trace;

  // don't record trace if we don't have a request body
  if (req.reqBody) {
    req.resBody = await decompress(contentEncoding, buff);
    trace = buildTrace(req);
    publishTrace(trace, debug);
  }

  // only cache successful responses
  if (isOK) {
    cache.set(
      req.reqHash,
      { body: chunks, headers: _proxyRes.headers, trace },
      3600
    );
  }
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
proxy.on('error', (err, _req, _res) => {
  console.log('Proxying failed', err);
});

// const errMsg = (res: Readonly<http.ServerResponse>, msg: string) => {
//   res.writeHead(500);
//   res.end(msg);
//   return;
// };

const getBody = (req: Readonly<IncomingMessage>): Promise<Uint8Array[]> => {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    req
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => resolve(chunks))
      .on('error', (err) => reject(err));
  });
};

const decompress = (
  encoding: string | undefined,
  buff: Buffer
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const handler = (err: unknown, decoded: { toString: () => string }) =>
      err ? reject(err) : resolve(decoded.toString());

    switch (encoding) {
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
};