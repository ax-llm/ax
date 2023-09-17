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

/**
 * Proxy Cache interface
 * @group Cache
 * @export
 */
export interface Cache<T> {
  set(key: string, value: Readonly<T>, maxAgeSeconds: number): Promise<void>;
  get(key: string): Promise<T | undefined>;
  removeIfExpired(key: string): Promise<void>;
}

/**
 * @group Cache
 * @export
 */
export type CacheValue<T> = {
  value: T;
  expiry: Date;
};

/**
 * @group Cache
 * @export
 */
export type CacheItem = {
  body: Uint8Array[];
  headers: Record<string, string | string[] | undefined>;
  trace?: AITextTraceStep;
};
