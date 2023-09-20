import { IncomingMessage } from 'http';

import { Parser } from '../ai/types';
import { AITextTraceStep, APIError } from '../tracing/types';

export type ExtendedIncomingMessage = IncomingMessage & {
  reqHash: string;
  reqBody: string;
  startTime: number;
  parser: Parser;
  error?: APIError;

  traceId?: string;
  sessionId?: string;
  apiKey?: string;
  host?: string;
  memory?: string;
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
