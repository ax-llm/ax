import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import { uuid } from '../text/util.js';
import { AITextTraceStepBuilder } from '../tracing/index.js';
import { AITextTraceStep } from '../tracing/types.js';

import 'dotenv/config';
import { parserMap } from './parsers.js';
import { ExtendedIncomingMessage, ParserFunction } from './types.js';

const consoleLog = new ConsoleLogger();

export const processRequest = (
  // eslint-disable-next-line functional/prefer-immutable-types
  req: ExtendedIncomingMessage
): string => {
  if (!req.url) {
    throw new Error('No URL provided');
  }

  let providerName = (
    req.headers['x-llm-provider'] as string | undefined
  )?.toLocaleLowerCase();

  let urlPath = req.url as string | undefined;

  if (!providerName) {
    const parts = req.url.split('/')?.slice(1);
    providerName = parts.shift()?.toLocaleLowerCase();
    urlPath = '/' + parts.join('/');
  }

  if (!providerName || providerName === '') {
    throw new Error('No LLM provider defined');
  }

  const pm = parserMap.get(providerName);
  if (!pm) {
    throw new Error(`Unknown LLM provider: ${providerName}`);
  }

  const parserFn = pm.parsers.find((p) => urlPath?.startsWith(p.path))?.fn;
  if (!parserFn) {
    throw new Error(`Unknown LLM provider path: ${urlPath}`);
  }

  req.startTime = Date.now();
  req.url = urlPath;
  req.parserFn = parserFn as ParserFunction;

  if (pm.target instanceof Function) {
    if (!req.host && pm.hostRequired) {
      throw new Error('No host provided (x-llmclient-host');
    }
    return pm.target(req.host);
  }

  return pm.target;
};

const generateTrace = (
  req: Readonly<ExtendedIncomingMessage>
): AITextTraceStepBuilder | undefined => {
  const reqBody = req.reqBody;
  const resBody = !req.error ? req.resBody : undefined;
  try {
    return req.parserFn(reqBody, resBody)?.setApiError(req.error);
  } catch (e) {
    console.error(e);
  }
  return;
};

export const buildTrace = (
  req: Readonly<ExtendedIncomingMessage>
): AITextTraceStep | undefined => {
  return generateTrace(req)
    ?.setTraceId(req.traceId ?? uuid())
    ?.setSessionId(req.sessionId)
    ?.setModelResponseTime(Date.now() - req.startTime)
    ?.build();
};

export const updateCachedTrace = (
  req: Readonly<ExtendedIncomingMessage>,
  trace: Readonly<AITextTraceStep>
): AITextTraceStep => {
  return {
    ...trace,
    traceId: req.traceId ?? uuid(),
    sessionId: req.sessionId,
  };
};

export const publishTrace = async (
  trace: Readonly<AITextTraceStep>,
  apiKey?: string,
  debug?: boolean
): Promise<AITextTraceStep> => {
  const remoteLog = new RemoteLogger();

  if (apiKey) {
    remoteLog.setAPIKey(apiKey);
  }

  try {
    await remoteLog.log(trace);
  } catch (e) {
    console.error(e);
  }

  if (debug) {
    consoleLog.log(trace);
  }

  return trace;
};

export { AITextTraceStepBuilder };
