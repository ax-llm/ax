import { IncomingMessage } from 'http';

import { AIGenerateTextTraceStepBuilder } from '../tracing';
import { AIGenerateTextTraceStep, APIError } from '../tracing/types';

export type ParserFunction = (
  request: Readonly<unknown>,
  response?: Readonly<unknown>
) => AIGenerateTextTraceStepBuilder;

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
  trace?: AIGenerateTextTraceStep;
};
