import { IncomingMessage } from 'http';

import { AIGenerateTextTraceStepBuilder } from '../tracing';

export type ParserFunction = (
  request: Readonly<unknown>,
  response: Readonly<unknown>
) => AIGenerateTextTraceStepBuilder;

export type ExtendedIncomingMessage = IncomingMessage & {
  id: string;
  reqBody: string;
  resBody: string;
  startTime: number;
  parserFn: ParserFunction;
  apiKey?: string;
};
