import { axCreateDefaultLogger } from '../dsp/loggers.js'

import type {
  AxChatRequest,
  AxChatResponse,
  AxLoggerFunction,
  AxLoggerTag,
} from './types.js'

// Default logger instance
const defaultLogger: AxLoggerFunction = axCreateDefaultLogger()

const formatChatMessage = (
  msg: AxChatRequest['chatPrompt'][number],
  hideContent?: boolean,
  hideSystemPrompt?: boolean
) => {
  switch (msg.role) {
    case 'system':
      if (hideSystemPrompt) {
        return ''
      }
      return `\nSystem:\n${msg.content}`
    case 'function':
      return `\nFunction Result:\n${msg.result}`
    case 'user': {
      if (typeof msg.content === 'string') {
        return `\nUser:\n${msg.content}`
      }
      const items = msg.content.map((v) => {
        switch (v.type) {
          case 'text':
            return v.text
          case 'image':
            return `(Image, ${v.mimeType}) ${v.image.substring(0, 10)}`
          default:
            throw new Error('Invalid content type')
        }
      })
      return `\nUser:\n${items.join('\n')}`
    }
    case 'assistant': {
      if (msg.functionCalls) {
        const fns = msg.functionCalls?.map(({ function: fn }) => {
          const args =
            typeof fn.params !== 'string'
              ? JSON.stringify(fn.params, null, 2)
              : fn.params
          return `${fn.name}(${args})`
        })
        return `\nFunctions:\n${fns.join('\n')}`
      }
      return `\nAssistant:\n${hideContent ? '' : (msg.content ?? '<empty>')}`
    }
    default:
      throw new Error('Invalid role')
  }
}

export const logChatRequestMessage = (
  msg: AxChatRequest['chatPrompt'][number],
  hideSystemPrompt?: boolean,
  logger: AxLoggerFunction = defaultLogger
) => {
  const formattedMessage = formatChatMessage(msg, false, hideSystemPrompt)
  if (formattedMessage) {
    const tags: AxLoggerTag[] =
      msg.role === 'system'
        ? ['systemStart', 'systemContent']
        : msg.role === 'function'
          ? ['functionName']
          : msg.role === 'user'
            ? ['userStart', 'userContent']
            : []
    logger(formattedMessage, { tags })
  }
  logger('Assistant:', { tags: ['assistantStart'] })
}

export const logChatRequest = (
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>,
  hideSystemPrompt?: boolean,
  logger: AxLoggerFunction = defaultLogger
) => {
  for (const msg of chatPrompt ?? []) {
    const formattedMessage = formatChatMessage(msg, false, hideSystemPrompt)
    if (formattedMessage) {
      const tags: AxLoggerTag[] =
        msg.role === 'system'
          ? ['systemContent']
          : msg.role === 'function'
            ? ['functionName']
            : msg.role === 'user'
              ? ['userContent']
              : []
      logger(formattedMessage, { tags })
    }
  }

  logger('Assistant:', { tags: ['assistantStart'] })
}

export const logResponseResult = (
  r: Readonly<AxChatResponse['results'][number]>,
  logger: AxLoggerFunction = defaultLogger
) => {
  if (r.content) {
    logger(r.content, { tags: ['responseContent'] })
  }

  if (r.functionCalls && r.functionCalls.length > 0) {
    for (const [i, f] of r.functionCalls.entries()) {
      if (f.function.name) {
        const tags: AxLoggerTag[] = ['functionName']
        if (i === 0) {
          tags.push('firstFunction')
        }
        if (r.functionCalls.length > 1) {
          tags.push('multipleFunctions')
        }
        logger(`[${i + 1}] ${f.function.name}`, { tags })
      }
      if (f.function.params) {
        const params =
          typeof f.function.params === 'string'
            ? f.function.params
            : JSON.stringify(f.function.params, null, 2)
        logger(params, { tags: ['functionArg'] })
      }
    }
    // Add function end marker for the last function
    logger('', { tags: ['functionEnd'] })
  }
}

export const logResponse = (
  resp: Readonly<AxChatResponse>,
  logger: AxLoggerFunction = defaultLogger
) => {
  if (!resp.results) {
    return
  }
  for (const r of resp.results) {
    logResponseResult(r, logger)
  }
}

export const logResponseDelta = (
  delta: string,
  logger: AxLoggerFunction = defaultLogger
) => {
  logger(delta, { tags: ['responseContent'] })
}
