import { IncomingMessage } from 'http';

import { AIGenerateTextTraceStepBuilder } from '../tracing';
import { AIGenerateTextTraceStep } from '../tracing/types';

export type ParserFunction = (
  request: Readonly<unknown>,
  response: Readonly<unknown>
) => AIGenerateTextTraceStepBuilder;

export type ExtendedIncomingMessage = IncomingMessage & {
  id: string;
  reqHash: string;
  reqBody: string;
  resBody: string;
  startTime: number;
  parserFn: ParserFunction;
  apiKey?: string;
};

export type CacheItem = {
  body: Uint8Array[];
  headers: Record<string, string | string[] | undefined>;
  trace?: AIGenerateTextTraceStep;
};
