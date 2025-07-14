import { defaultLogger } from '../dsp/loggers.js';
import type {
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunctionResult,
  AxLoggerData,
  AxLoggerFunction,
} from './types.js';

export const logChatRequest = (
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>,
  step: number,
  hideSystemPrompt?: boolean,
  logger: AxLoggerFunction = defaultLogger
) => {
  // Filter out system messages if hideSystemPrompt is true
  const filteredPrompt = hideSystemPrompt
    ? chatPrompt.filter((msg) => msg.role !== 'system')
    : [...chatPrompt]; // Create a mutable copy

  const loggerData: AxLoggerData = {
    name: 'ChatRequestChatPrompt',
    step,
    value: filteredPrompt as AxChatRequest['chatPrompt'],
  };

  logger(loggerData);
};

export const logResponseResult = (
  r: Readonly<AxChatResponse['results'][number] & { index: number }>,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'ChatResponseResults',
    value: [r],
  };

  logger(loggerData);
};

export const logResponse = (
  resp: Readonly<AxChatResponse>,
  logger: AxLoggerFunction = defaultLogger
) => {
  if (!resp.results) {
    return;
  }

  const loggerData: AxLoggerData = {
    name: 'ChatResponseResults',
    value: resp.results as AxChatResponseResult[],
  };

  logger(loggerData);
};

export const logResponseStreamingResult = (
  result: AxChatResponseResult & { delta?: string },
  index: number,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'ChatResponseStreamingResult',
    index,
    value: result,
  };

  logger(loggerData);
};

export const logFunctionResults = (
  results: Readonly<AxFunctionResult[]>,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'FunctionResults',
    value: results as AxFunctionResult[],
  };

  logger(loggerData);
};

export const logFunctionError = (
  error: unknown,
  index: number,
  fixingInstructions: string,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'FunctionError',
    index,
    fixingInstructions,
    error,
  };

  logger(loggerData);
};

export const logValidationError = (
  error: unknown,
  index: number,
  fixingInstructions: string,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'ValidationError',
    index,
    fixingInstructions,
    error,
  };

  logger(loggerData);
};

export const logAssertionError = (
  error: unknown,
  index: number,
  fixingInstructions: string,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'AssertionError',
    index,
    fixingInstructions,
    error,
  };

  logger(loggerData);
};

export const logRefusalError = (
  error: unknown,
  index: number,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'RefusalError',
    index,
    error,
  };

  logger(loggerData);
};

export const logNotification = (
  id: string,
  value: string,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'Notification',
    id,
    value,
  };

  logger(loggerData);
};

export const logEmbedRequest = (
  texts: readonly string[],
  embedModel: string,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'EmbedRequest',
    embedModel,
    value: texts,
  };

  logger(loggerData);
};

export const logEmbedResponse = (
  embeddings: readonly (readonly number[])[],
  logger: AxLoggerFunction = defaultLogger
) => {
  // Show only a few embeddings for effect, not all
  const sampleEmbeddings = embeddings.slice(0, 3).map((embedding) => ({
    length: embedding.length,
    sample: embedding.slice(0, 5), // Show first 5 values
    truncated: embedding.length > 5,
  }));

  const loggerData: AxLoggerData = {
    name: 'EmbedResponse',
    totalEmbeddings: embeddings.length,
    value: sampleEmbeddings,
  };

  logger(loggerData);
};

export const logResultPickerUsed = (
  sampleCount: number,
  selectedIndex: number,
  latency: number,
  logger: AxLoggerFunction = defaultLogger
) => {
  const loggerData: AxLoggerData = {
    name: 'ResultPickerUsed',
    sampleCount,
    selectedIndex,
    latency,
  };

  logger(loggerData);
};
