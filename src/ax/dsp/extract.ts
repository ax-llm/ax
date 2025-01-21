/* eslint-disable @typescript-eslint/naming-convention */

import JSON5 from 'json5'

import { parseLLMFriendlyDate, parseLLMFriendlyDateTime } from './datetime.js'
import type { AxField, AxSignature } from './sig.js'
import { parseMarkdownList } from './util.js'
import { ValidationError } from './validate.js'

export const extractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  content: string
) => {
  const xstate = { s: -1 }
  streamingExtractValues(sig, values, xstate, content)
  streamingExtractFinalValue(values, xstate, content)
}

export interface extractionState {
  currField?: AxField
  s: number
}

export const streamingExtractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  state: extractionState,
  content: string
) => {
  const fields = sig.getOutputFields()

  for (const field of fields) {
    if (field.name in values) {
      continue
    }

    const prefix = field.title + ':'
    const e = content.indexOf(prefix, state.s + 1)

    if (e === -1) {
      continue
    }

    if (state.currField) {
      const val = content
        .substring(state.s, e)
        .trim()
        .replace(/---+$/, '')
        .trim()

      values[state.currField.name] = validateAndParseFieldValue(
        state.currField,
        val
      )
    }

    state.s = e + prefix.length
    state.currField = field
  }
}

export const streamingExtractFinalValue = (
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  state: extractionState,
  content: string
) => {
  if (!state.currField) {
    return
  }
  const val = content.substring(state.s).trim().replace(/---+$/, '').trim()

  values[state.currField.name] = validateAndParseFieldValue(
    state.currField,
    val
  )
}

const convertValueToType = (field: Readonly<AxField>, val: string) => {
  switch (field.type?.name) {
    case 'string':
      return val as string
    case 'number': {
      const v = Number(val)
      if (Number.isNaN(v)) {
        throw new Error('Invalid number')
      }
      return v
    }
    case 'boolean': {
      const v = val.toLowerCase()
      if (v === 'true') {
        return true
      } else if (v === 'false') {
        return false
      } else {
        throw new Error('Invalid boolean')
      }
    }
    case 'date':
      return parseLLMFriendlyDate(field, val as string)
    case 'datetime':
      return parseLLMFriendlyDateTime(field, val as string)
    case 'class':
      if (field.type.classes && !field.type.classes.includes(val)) {
        throw new Error(
          `Invalid class '${val}', expected one of the following: ${field.type.classes.join(', ')}`
        )
      }
      return val as string
    default:
      return val as string // Unknown type
  }
}

const expectedTypeError = (
  field: Readonly<AxField>,
  err: Readonly<Error>,
  value: string | undefined = ''
) => {
  const exp = field.type?.isArray
    ? `array of ${field.type.name}`
    : field.type?.name
  const message = `Error '${err.message}', expected '${exp}' got '${value}'`
  return new ValidationError({ message, field, value })
}

function validateAndParseFieldValue(
  field: Readonly<AxField>,
  fieldValue: string | undefined
): unknown {
  const fv = fieldValue?.toLocaleLowerCase()
  if (!fieldValue || !fv || fv === '' || fv === 'null' || fv === 'undefined') {
    if (field.isOptional) {
      return
    }
    throw expectedTypeError(field, new Error('Empty value'), fieldValue)
  }
  let value: unknown = fieldValue

  if (field.type?.name === 'json') {
    try {
      const text = extractBlock(fieldValue)
      value = JSON5.parse(text)
      return value
    } catch (e) {
      throw expectedTypeError(field, e as Error, fieldValue)
    }
  }

  if (field.type?.isArray) {
    try {
      try {
        value = JSON5.parse(fieldValue)
      } catch {
        // If JSON parsing fails, try markdown parsing
        value = parseMarkdownList(fieldValue)
      }
      if (!Array.isArray(value)) {
        throw new Error('Expected an array')
      }
    } catch (e) {
      throw expectedTypeError(field, e as Error, fieldValue)
    }
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      try {
        value[index] = convertValueToType(field, item)
      } catch (e) {
        throw expectedTypeError(field, e as Error, item)
      }
    }
  } else {
    try {
      value = convertValueToType(field, fieldValue)
    } catch (e) {
      throw expectedTypeError(field, e as Error, fieldValue)
    }
  }

  // If validation passes, return null to indicate no error
  return value
}

export const extractBlock = (input: string): string => {
  const jsonBlockPattern = /```([A-Za-z]+)?\s*([\s\S]*?)\s*```/g
  const match = jsonBlockPattern.exec(input)
  if (!match) {
    return input
  }
  if (match.length === 3) {
    return match[2] as string
  }
  if (match.length === 2) {
    return match[1] as string
  }
  return input
}
