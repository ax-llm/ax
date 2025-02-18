/* eslint-disable @typescript-eslint/naming-convention */
import { createHash } from 'crypto'

import type { AxChatResponseResult, AxModelInfo } from './types.js'

export const findItemByNameOrAlias = (
  list: readonly AxModelInfo[],
  name: string
): AxModelInfo | undefined => {
  for (const item of list) {
    if (item.name === name || item.aliases?.includes(name)) {
      return item
    }
  }
  return undefined
}

export const uniqBy = <T>(
  array: readonly T[],
  uniqueField: (value: T) => unknown
): T[] => {
  const uniqueValues = new Map()

  array.forEach((value: T) => {
    const field = uniqueField(value)

    if (!uniqueValues.has(field)) {
      uniqueValues.set(field, value)
    }
  })

  return Array.from(uniqueValues.values())
}

const functionCallRe = /(\w+)\((.*)\)/s

export const parseFunction = (
  value: string
): { name: string; args?: string } | undefined => {
  let v: string[] | null

  // extract function calls
  if ((v = functionCallRe.exec(value)) !== null) {
    const name = v.at(1)?.trim()
    const args = v.at(2)?.trim()
    if (!name || name.length === 0) {
      throw new Error(`Invalid function format: ${value}`)
    }
    return { name, args }
  }
  return
}

export interface mergeFunctionsState {
  lastId?: string
}

export function mergeFunctionCalls(
  functionCalls: NonNullable<AxChatResponseResult['functionCalls']>,
  functionCallDeltas: Readonly<
    NonNullable<AxChatResponseResult['functionCalls']>
  >
) {
  for (const _fc of functionCallDeltas) {
    const fc = functionCalls.find((fc) => fc.id === _fc.id)

    if (fc) {
      if (
        typeof _fc.function.name == 'string' &&
        _fc.function.name.length > 0
      ) {
        fc.function.name += _fc.function.name
      }

      if (
        typeof _fc.function.params == 'string' &&
        _fc.function.params.length > 0
      ) {
        fc.function.params += _fc.function.params
      }

      if (typeof _fc.function.params == 'object') {
        fc.function.params = _fc.function.params
      }
    } else {
      functionCalls.push(_fc)
    }
  }
}

export const hashObject = (obj: object) => {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(obj))
  return hash.digest('hex')
}
