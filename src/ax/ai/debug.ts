import { ColorLog } from '../util/log.js'

import type {
  AxChatRequest,
  AxChatResponse,
  AxLoggerFunction,
} from './types.js'

const colorLog = new ColorLog()

// Default logger function
const defaultLogger: AxLoggerFunction = (message: string) => {
  process.stdout.write(message)
}

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
      return `\n${colorLog.blueBright('System:')}\n${colorLog.whiteBright(msg.content)}`
    case 'function':
      return `\n${colorLog.blueBright('Function Result:')}\n${colorLog.whiteBright(msg.result)}`
    case 'user': {
      if (typeof msg.content === 'string') {
        return `\n${colorLog.blueBright('User:')}\n${colorLog.whiteBright(msg.content)}`
      }
      const items = msg.content.map((v) => {
        switch (v.type) {
          case 'text':
            return `${colorLog.whiteBright(v.text)}`
          case 'image':
            return `(Image, ${v.mimeType}) ${colorLog.whiteBright(v.image.substring(0, 10))}`
          default:
            throw new Error('Invalid content type')
        }
      })
      return `\n${colorLog.blueBright('User:')}\n${items.join('\n')}`
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
        return `\n${colorLog.blueBright('\nFunctions:')}\n${colorLog.whiteBright(fns.join('\n'))}`
      }
      return `\n${colorLog.blueBright('\nAssistant:')}\n${hideContent ? '' : colorLog.whiteBright(msg.content ?? '<empty>')}`
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
  logger(`${formatChatMessage(msg, hideSystemPrompt)}\n`)
  logger(colorLog.blueBright('\nAssistant:\n'))
}

export const logChatRequest = (
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>,
  hideSystemPrompt?: boolean,
  logger: AxLoggerFunction = defaultLogger
) => {
  const items = chatPrompt?.map((msg) =>
    formatChatMessage(msg, hideSystemPrompt)
  )

  if (items) {
    logger(items.join('\n'))
    logger(colorLog.blueBright('\nAssistant:\n'))
  }
}

export const logResponseResult = (
  r: Readonly<AxChatResponse['results'][number]>,
  logger: AxLoggerFunction = defaultLogger
) => {
  if (r.content) {
    logger(colorLog.greenBright(r.content))
  }

  if (r.functionCalls) {
    for (const [i, f] of r.functionCalls.entries()) {
      if (f.function.name) {
        if (i > 0) {
          logger('\n')
        }
        logger(`Function ${i + 1} -> ${colorLog.greenBright(f.function.name)}`)
      }
      if (f.function.params) {
        const params =
          typeof f.function.params === 'string'
            ? f.function.params
            : JSON.stringify(f.function.params, null, 2)
        logger(`${colorLog.greenBright(params)}`)
      }
    }
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
  logger(colorLog.greenBright(delta))
}
