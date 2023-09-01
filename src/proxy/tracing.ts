import { apiURLOpenAI, OpenAIApi } from '../ai/openai/types.js';
import {
  generateChatTraceOpenAI,
  generateTraceOpenAI,
} from '../ai/openai/util.js';
import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import { uuid } from '../text/util.js';
import { AIGenerateTextTraceStepBuilder } from '../tracing/index.js';

import { ExtendedIncomingMessage, ParserFunction } from './types.js';

import 'dotenv/config';
import { AIGenerateTextTraceStep } from '../tracing/types.js';

const remoteLog = new RemoteLogger();
const consoleLog = new ConsoleLogger();

// eslint-disable-next-line functional/prefer-immutable-types
export const processRequest = (req: ExtendedIncomingMessage): string => {
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

  const parserFn = pm.parsers.find((p) => p.path === urlPath)?.fn;
  if (!parserFn) {
    throw new Error(`Unknown LLM provider path: ${urlPath}`);
  }

  req.id = uuid();
  req.startTime = Date.now();
  req.apiKey = req.headers['x-llmclient-apikey'] as string | undefined;
  req.url = urlPath;
  req.parserFn = parserFn as ParserFunction;

  return pm.target;
};

const parserMappings = {
  openai: {
    target: 'https://api.openai.com',
    parsers: [
      { path: OpenAIApi.ChatGenerate, fn: generateChatTraceOpenAI },
      { path: OpenAIApi.Generate, fn: generateTraceOpenAI },
    ],
  },
};
const parserMap = new Map(Object.entries(parserMappings));

const generateTrace = (
  req: Readonly<ExtendedIncomingMessage>
): AIGenerateTextTraceStepBuilder => {
  const reqBody = JSON.parse(req.reqBody);
  const resBody = JSON.parse(req.resBody);
  return req.parserFn(reqBody, resBody);
};

export const getTarget = (apiName?: string): string => {
  switch (apiName) {
    case 'openai':
      return apiURLOpenAI;
    default:
      throw new Error(`Unknown API name: ${apiName}`);
  }
};

export const buildTrace = (
  req: Readonly<ExtendedIncomingMessage>
): AIGenerateTextTraceStep => {
  return generateTrace(req)
    .setTraceId(req.id)
    .setModelResponseTime(Date.now() - req.startTime)
    .build();
};

export const publishTrace = (
  trace: Readonly<AIGenerateTextTraceStep>,
  debug: boolean
): AIGenerateTextTraceStep => {
  remoteLog.log(trace);

  if (debug) {
    consoleLog.log(trace);
  }

  return trace;
};
