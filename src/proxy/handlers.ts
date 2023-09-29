import crypto from 'crypto';
import http, { IncomingMessage } from 'http';
import stream from 'stream';

import httpProxy from 'http-proxy';

import { MemoryCache } from './cache.js';
import { processAIRequest } from './prompt.js';
import { extendRequest } from './req.js';
import { RemoteTraceStore } from './tracing.js';
import { CacheItem, ExtendedIncomingMessage } from './types.js';
import { convertToAPIError, decompress } from './util.js';

export const requestHandler = async (
  proxy: httpProxy,
  cache: Readonly<MemoryCache<CacheItem>>,
  debug: boolean,
  _req: Readonly<IncomingMessage>,
  _res: Readonly<http.ServerResponse>
) => {
  if (_req.url === '/') {
    _res.end('Herding Llamas!');
    return;
  }

  if (_req.url === '/favicon.ico') {
    _res.writeHead(404);
    _res.end();
    return;
  }

  const req = _req as ExtendedIncomingMessage;
  const chunks = await getBody(req);

  const hashKey =
    (req.method ?? '') +
    (req.url ?? '') +
    (req.headers['x-llmclient-apikey'] ?? '') +
    (req.headers.authorization ?? '');

  const buff = Buffer.concat(chunks);
  const hash = crypto
    .createHash('sha256')
    .update(hashKey)
    .update(buff)
    .digest('hex');
  const cachedResponse = await cache.get(hash);
  const contentEncoding = req.headers['content-encoding'];

  req.llmClientAPIKey = req.headers['x-llmclient-apikey'] as string | undefined;
  req.traceId = req.headers['x-llmclient-traceid'] as string | undefined;
  req.sessionId = req.headers['x-llmclient-sessionid'] as string | undefined;
  req.sessionId = req.headers['x-llmclient-sessionid'] as string | undefined;
  req.host = req.headers['x-llmclient-host'] as string | undefined;

  if (debug) {
    console.log('> Proxying', hash, req.url);
  }

  if (cachedResponse) {
    const { body, headers, trace } = cachedResponse;
    _res.writeHead(200, headers);
    _res.write(Buffer.concat(body));
    _res.end();

    if (trace) {
      const ts = new RemoteTraceStore(trace, debug, req.llmClientAPIKey);
      ts.update(req);
      await ts.save();
    }
    return;
  }

  req.reqHash = hash;
  let target;

  try {
    target = extendRequest(req);
  } catch (err: unknown) {
    console.log('Error processing request', err);
    return;
  }

  // setup body buffer to pass to proxy
  const buffer = new stream.PassThrough();

  // llm requests that we need to trace and update
  if (req.middleware && req.headers['content-type'] === 'application/json') {
    req.reqBody = await decompress(contentEncoding, buff);

    // process the request
    const ureq = await processAIRequest(debug, req);

    // update the request body if needed
    if (ureq) {
      delete req.headers['content-length'];
      req.reqBody = ureq;
      buffer.end(Buffer.from(ureq));
    }
  }

  if (buffer.readableLength === 0) {
    buffer.end(buff);
  }

  // send the request to be proxied
  proxy.web(req, _res, { target, buffer });
};

export function addHandlers(
  proxy: httpProxy,
  cache: Readonly<MemoryCache<CacheItem>>,
  debug: boolean
) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  proxy.on('proxyRes', async (_proxyRes, _req, _res) => {
    const req = _req as ExtendedIncomingMessage;

    const chunks = await getBody(_proxyRes);
    const buff = Buffer.concat(chunks);
    const contentEncoding = _proxyRes.headers['content-encoding'];
    const isOK = _proxyRes.statusCode === 200;

    let trace;

    // don't record trace if not parser is defined
    if (req.middleware) {
      const resBody = await decompress(contentEncoding, buff);

      // parse out error for tracing
      if (!isOK) {
        req.error = convertToAPIError(req, _proxyRes, resBody);
      }

      try {
        if (!req.error) {
          // add the response to the trace
          req.middleware.addResponse(resBody);
        }

        // build the trace
        trace = req.middleware.getTrace(req);

        // send the trace
        const ts = new RemoteTraceStore(trace, debug, req.llmClientAPIKey);
        await ts.save();
      } catch (err: unknown) {
        console.error('Error building trace:', (err as Error).message);
        return;
      }
    }

    // only cache successful responses
    if (isOK) {
      await cache.set(
        req.reqHash,
        { body: chunks, headers: _proxyRes.headers, trace },
        3600
      );
    }
  });

  // proxy.on('proxyReq', async (_proxyReq, _req, _res) => {
  // });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  proxy.on('error', (err, _req, _res) => {
    console.log('Proxying failed', err);
  });
}

export const errMsg = (res: Readonly<http.ServerResponse>, msg: string) => {
  console.error(msg);
  res.writeHead(500);
  res.end(msg);
  return;
};

export const getBody = (
  req: Readonly<IncomingMessage>
): Promise<Uint8Array[]> => {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    req
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => resolve(chunks))
      .on('error', (err) => reject(err));
  });
};
