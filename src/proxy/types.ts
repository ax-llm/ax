import { IncomingMessage } from 'http';

import { AITextTraceStepBuilder } from '../tracing';
import { AITextTraceStep, APIError } from '../tracing/types';

export type ParserFunction = (
  request: string,
  response?: string
) => AITextTraceStepBuilder | undefined;

export type ExtendedIncomingMessage = IncomingMessage & {
  reqHash: string;
  reqBody: string;
  resBody: string;
  startTime: number;
  parserFn: ParserFunction;
  error?: APIError;

  traceId?: string;
  sessionId?: string;
  apiKey?: string;
  host?: string;
};

export type CacheItem = {
  body: Uint8Array[];
  headers: Record<string, string | string[] | undefined>;
  trace?: AITextTraceStep;
};
