import { IncomingMessage } from 'http';

import { APIError } from '../tracing/types';

import { ExtendedIncomingMessage } from './types';

export function convertToAPIError(
  req: Readonly<ExtendedIncomingMessage>,
  res: Readonly<IncomingMessage>
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
    response: JSON.stringify(req.resBody),
  };
}
