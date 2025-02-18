import { ColorLog } from '../util/log.js'

import type { AxChatRequest, AxChatResponse } from './types.js'

const colorLog = new ColorLog()

const formatChatMessage = (
  msg: AxChatRequest['chatPrompt'][number],
  hideContent?: boolean
) => {
  switch (msg.role) {
    case 'system':
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
  msg: AxChatRequest['chatPrompt'][number]
) => {
  process.stdout.write(formatChatMessage(msg) + '\n')
  process.stdout.write(colorLog.blueBright('\nAssistant:\n'))
}

export const logChatRequest = (
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>
) => {
  const items = chatPrompt?.map((msg) => formatChatMessage(msg))

  if (items) {
    process.stdout.write(items.join('\n'))
    process.stdout.write(colorLog.blueBright('\nAssistant:\n'))
  }
}

export const logResponseResult = (
  r: Readonly<AxChatResponse['results'][number]>
) => {
  if (r.content) {
    process.stdout.write(colorLog.greenBright(r.content))
  }
  if (r.functionCalls) {
    for (const [i, f] of r.functionCalls.entries()) {
      if (f.function.name) {
        if (i > 0) {
          process.stdout.write('\n')
        }
        process.stdout.write(
          `Function ${i + 1} -> ${colorLog.greenBright(f.function.name)}`
        )
      }
      if (f.function.params) {
        const params =
          typeof f.function.params === 'string'
            ? f.function.params
            : JSON.stringify(f.function.params, null, 2)
        process.stdout.write(`${colorLog.greenBright(params)}`)
      }
    }
  }
}

export const logResponse = (resp: Readonly<AxChatResponse>) => {
  if (!resp.results) {
    return
  }
  for (const r of resp.results) {
    logResponseResult(r)
  }
}

export const logResponseDelta = (delta: string) => {
  process.stdout.write(colorLog.greenBright(delta))
}
