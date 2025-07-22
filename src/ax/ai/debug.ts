import type {
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunctionResult,
  AxLoggerData,
  AxLoggerFunction,
} from './types.js';
import { mergeFunctionCalls } from './util.js';

export const logChatRequest = (
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>,
  step: number,
  logger: AxLoggerFunction,
  hideSystemPrompt?: boolean
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
  logger: AxLoggerFunction
) => {
  const loggerData: AxLoggerData = {
    name: 'ChatResponseResults',
    value: [r],
  };

  logger(loggerData);
};

export const logResponse = (
  resp: Readonly<AxChatResponse>,
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
) => {
  const loggerData: AxLoggerData = {
    name: 'ChatResponseStreamingResult',
    index,
    value: result,
  };

  logger(loggerData);
};

export function logResponseStreamingDoneResult(
  values: readonly AxChatResponse[],
  logger: AxLoggerFunction
): void {
  // Combine results by index
  const combinedResults = new Map<number, AxChatResponseResult>();

  for (const value of values) {
    for (const result of value.results) {
      if (!result) {
        continue;
      }

      let existing = combinedResults.get(result.index);
      if (!existing) {
        existing = structuredClone(result);
        combinedResults.set(result.index, existing);
      } else {
        if (result.content) {
          existing.content = (existing.content ?? '') + result.content;
        }
        if (result.thought) {
          existing.thought = (existing.thought ?? '') + result.thought;
        }
        if (result.finishReason) {
          existing.finishReason = result.finishReason;
        }
        if (result.functionCalls) {
          if (existing.functionCalls) {
            mergeFunctionCalls(
              existing.functionCalls,
              structuredClone(result.functionCalls)
            );
          } else {
            existing.functionCalls = structuredClone(result.functionCalls);
          }
        }
      }
    }
  }

  // Log each combined result
  for (const result of combinedResults.values()) {
    const loggerData: AxLoggerData = {
      name: 'ChatResponseStreamingDoneResult',
      index: result.index,
      value: result,
    };

    logger(loggerData);
  }
}

export const logFunctionResults = (
  results: Readonly<AxFunctionResult[]>,
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
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
  logger: AxLoggerFunction
) => {
  const loggerData: AxLoggerData = {
    name: 'ResultPickerUsed',
    sampleCount,
    selectedIndex,
    latency,
  };

  logger(loggerData);
};
