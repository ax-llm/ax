import { apiURLOpenAI, OpenAIApi } from '../ai/openai/types.js';
import {
  generateChatTraceOpenAI,
  generateTraceOpenAI,
} from '../ai/openai/util.js';
import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import { AIGenerateTextTraceStepBuilder } from '../tracing/index.js';

import { ExtendedIncomingMessage } from './types.js';

import 'dotenv/config';

const remoteLog = new RemoteLogger();
const consoleLog = new ConsoleLogger();
const debug = process.env.DEBUG === 'true';

const generateTrace = (
  req: Readonly<ExtendedIncomingMessage>
): AIGenerateTextTraceStepBuilder | undefined => {
  const reqBody = JSON.parse(req.reqBody);
  const resBody = JSON.parse(req.resBody);

  if (req.type === 'openai') {
    switch (req.pathname) {
      case OpenAIApi.ChatGenerate:
        return generateChatTraceOpenAI(reqBody, resBody);
      case OpenAIApi.Generate:
        return generateTraceOpenAI(reqBody, resBody);
      default:
        return;
    }
  } else {
    throw new Error(`Unknown API name: ${req.type}`);
  }
};

export const getTarget = (apiName?: string): string => {
  switch (apiName) {
    case 'openai':
      return apiURLOpenAI;
    default:
      throw new Error(`Unknown API name: ${apiName}`);
  }
};

export const publishTrace = (req: Readonly<ExtendedIncomingMessage>) => {
  const trace = generateTrace(req)
    ?.setTraceId(req.id)
    ?.setModelResponseTime(Date.now() - req.startTime)
    ?.build();
  if (!trace) {
    return;
  }
  remoteLog.log(trace);

  if (debug) {
    consoleLog.log(trace);
  }
};
