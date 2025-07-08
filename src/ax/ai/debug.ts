import { axCreateDefaultLogger } from '../dsp/loggers.js';

import type {
  AxChatRequest,
  AxChatResponse,
  AxLoggerFunction,
  AxLoggerTag,
} from './types.js';

// Default logger instance
const defaultLogger: AxLoggerFunction = axCreateDefaultLogger();

const formatChatMessage = (
  msg: AxChatRequest['chatPrompt'][number],
  hideContent?: boolean,
  hideSystemPrompt?: boolean
) => {
  switch (msg.role) {
    case 'system':
      if (hideSystemPrompt) {
        return '';
      }
      return `─── System: ───\n${msg.content}`;
    case 'function':
      return `─── Function Result: ───\n${msg.result}`;
    case 'user': {
      if (typeof msg.content === 'string') {
        return `─── User: ───\n${msg.content}`;
      }
      const items = msg.content.map((v) => {
        switch (v.type) {
          case 'text':
            return v.text;
          case 'image':
            return `(Image, ${v.mimeType}) ${v.image.substring(0, 10)}`;
          default:
            throw new Error('Invalid content type');
        }
      });
      return `─── User: ───\n${items.join('\n')}`;
    }
    case 'assistant': {
      if (msg.functionCalls) {
        const fns = msg.functionCalls?.map(({ function: fn }) => {
          const args =
            typeof fn.params !== 'string'
              ? JSON.stringify(fn.params, null, 2)
              : fn.params;
          return `${fn.name}(${args})`;
        });
        return `─── Functions: ───\n${fns.join('\n')}`;
      }
      return `─── Assistant: ───\n${hideContent ? '' : (msg.content ?? '<empty>')}`;
    }
    default:
      throw new Error('Invalid role');
  }
};

export const logChatRequestMessage = (
  msg: AxChatRequest['chatPrompt'][number],
  hideSystemPrompt?: boolean,
  logger: AxLoggerFunction = defaultLogger
) => {
  logChatRequest([msg], hideSystemPrompt, logger);
};

export const logChatRequest = (
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>,
  hideSystemPrompt?: boolean,
  logger: AxLoggerFunction = defaultLogger
) => {
  for (const msg of chatPrompt ?? []) {
    const formattedMessage = formatChatMessage(msg, false, hideSystemPrompt);
    if (formattedMessage) {
      const tags: AxLoggerTag[] = [];

      switch (msg.role) {
        case 'system':
          tags.push('systemContent');
          break;
        case 'function':
          tags.push('functionName');
          break;
        case 'user':
          tags.push('userContent');
          break;
      }

      logger(formattedMessage, { tags });
    }
  }

  logger('─── Assistant: ───', { tags: ['assistantStart'] });
};

export const logResponseResult = (
  r: Readonly<AxChatResponse['results'][number] & { index: number }>,
  logger: AxLoggerFunction = defaultLogger
) => {
  if (r.content) {
    logger(r.content, { tags: ['responseContent'] });
  }

  const loggedFunctionCalls = new Set<string>();

  if (r.functionCalls && r.functionCalls.length > 0) {
    for (const [i, f] of r.functionCalls.entries()) {
      if (f.id) {
        if (loggedFunctionCalls.has(f.id)) {
          continue;
        }
        loggedFunctionCalls.add(f.id);

        const tags: AxLoggerTag[] = ['functionName'];
        if (i === 0) {
          tags.push('firstFunction');
        }
        if (r.functionCalls.length > 1) {
          tags.push('multipleFunctions');
        }
        logger(`[${i + 1}] ${f.function.name} [${f.id}]`, { tags });
      }

      if (f.function.params) {
        const params =
          typeof f.function.params === 'string'
            ? f.function.params
            : JSON.stringify(f.function.params, null, 2);
        logger(params, { tags: ['functionArg'] });
      }
    }
    // Add function end marker for the last function
    logger('', { tags: ['functionEnd'] });
  }
};

export const logResponse = (
  resp: Readonly<AxChatResponse>,
  logger: AxLoggerFunction = defaultLogger
) => {
  if (!resp.results) {
    return;
  }
  for (const r of resp.results) {
    logResponseResult(r, logger);
  }
};

export const logResponseDelta = (
  delta: string,
  logger: AxLoggerFunction = defaultLogger
) => {
  logger(delta, { tags: ['responseContent', 'responseDelta'] });
};

export const logFunctionResults = (
  results: Readonly<
    { result: string; functionId: string; isError?: boolean; index: number }[]
  >,
  logger: AxLoggerFunction = defaultLogger
) => {
  for (const result of results) {
    logger(`Function Result [${result.functionId}]:`, {
      tags: ['functionResult'],
    });

    if (result.isError) {
      logger(result.result, { tags: ['functionResult', 'error'] });
    } else {
      logger(result.result, { tags: ['functionResult'] });
    }
  }
  logger('', { tags: ['functionEnd'] });
};
