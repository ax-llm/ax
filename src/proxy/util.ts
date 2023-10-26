import { IncomingMessage } from 'http';
import zlib from 'zlib';

import { APIError } from '../tracing/types.js';

import { ExtendedIncomingMessage } from './types.js';

export function convertToAPIError(
  req: Readonly<ExtendedIncomingMessage>,
  res: Readonly<IncomingMessage>,
  resBody: string
): APIError {
  const { statusCode, statusMessage, headers } = res;

  if (!req.url) {
    throw new Error('URL is required');
  }

  return {
    pathname: req.url,
    statusCode: statusCode ?? 0,
    statusMessage,
    headers: JSON.stringify(headers),
    request: JSON.stringify(req.reqBody),
    response: JSON.stringify(resBody)
  };
}

export const decompress = (
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
