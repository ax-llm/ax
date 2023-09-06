import { IncomingMessage } from 'http';

import { AITextTraceStepBuilder } from '../tracing';
import { AITextTraceStep, APIError } from '../tracing/types';

export type ParserFunction = (
  request: Readonly<unknown>,
  response?: Readonly<unknown>
) => AITextTraceStepBuilder;

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
};

export type CacheItem = {
  body: Uint8Array[];
  headers: Record<string, string | string[] | undefined>;
  trace?: AITextTraceStep;
};
