/* eslint-disable @typescript-eslint/naming-convention */

import { parseLLMFriendlyDate, parseLLMFriendlyDateTime } from './datetime.js'
import type { AxField, AxSignature } from './sig.js'
import { matchesContent, parseMarkdownList } from './util.js'
import { ValidationError } from './validate.js'

export const extractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  content: string
) => {
  const xstate = { extractedFields: [], s: -1 }
  streamingExtractValues(sig, values, xstate, content)
  streamingExtractFinalValue(sig, values, xstate, content)
}

export interface extractionState {
  currField?: AxField
  extractedFields: AxField[]
  streamedIndex?: Record<string, number>
  s: number
}

// Helper function to check for missing required fields
const checkMissingRequiredFields = (
  xstate: Readonly<extractionState>,
  values: Record<string, unknown>,
  currentIndex: number
) => {
  const missingFields: AxField[] = []

  // Check all fields up to the current index
  for (let i = 0; i < currentIndex; i++) {
    const field = xstate.extractedFields[i]
    if (field && !field.isOptional && values[field.name] === undefined) {
      missingFields.push(field)
    }
  }

  if (missingFields.length > 0) {
    throw new ValidationError({
      message: `Required ${missingFields.length === 1 ? 'field' : 'fields'} not found`,
      fields: missingFields,
    })
  }
}

export const streamingExtractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  content: string
) => {
  const fields = sig.getOutputFields()

  for (const [index, field] of fields.entries()) {
    if (field.name in values) {
      continue
    }

    const prefix = field.title + ':'
    let e = matchesContent(content, prefix, xstate.s + 1)

    switch (e) {
      case -1:
        continue // Field is not found, continue to the next field
      case -2:
        return true // Partial match at end, skip and gather more content
    }
    // We found the full match at the index e

    let prefixLen = prefix.length

    if (xstate.currField) {
      const val = content.substring(xstate.s, e).trim()
      const parsedValue = validateAndParseFieldValue(xstate.currField, val)
      if (parsedValue !== undefined) {
        values[xstate.currField.name] = parsedValue
      }
    }

    checkMissingRequiredFields(xstate, values, index)

    xstate.s = e + prefixLen
    xstate.currField = field

    if (!xstate.extractedFields.includes(field)) {
      xstate.extractedFields.push(field)
    }
  }
}

export const streamingExtractFinalValue = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  content: string
) => {
  if (xstate.currField) {
    const val = content.substring(xstate.s).trim()
    const parsedValue = validateAndParseFieldValue(xstate.currField, val)
    if (parsedValue !== undefined) {
      values[xstate.currField.name] = parsedValue
    }
  }

  const fields = sig.getOutputFields()

  // Check all previous required fields before processing current field
  checkMissingRequiredFields(xstate, values, fields.length - 1)
}

const convertValueToType = (field: Readonly<AxField>, val: string) => {
  switch (field.type?.name) {
    case 'string':
      return val

    case 'number': {
      const v = Number(val)
      if (Number.isNaN(v)) {
        throw new Error('Invalid number')
      }
      return v
    }

    case 'boolean': {
      if (typeof val === 'boolean') {
        return val
      }
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
      return parseLLMFriendlyDate(field, val)

    case 'datetime':
      return parseLLMFriendlyDateTime(field, val)

    case 'class':
      const className = val
      if (field.type.classes && !field.type.classes.includes(className)) {
        throw new Error(
          `Invalid class '${val}', expected one of the following: ${field.type.classes.join(', ')}`
        )
      }
      return className as string

    default:
      return val as string // Unknown type
  }
}

export function* streamValues<OUT>(
  sig: Readonly<AxSignature>,
  values: Readonly<Record<string, OUT>>,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  content: string,
  final: boolean = false
) {
  if (!xstate.currField) {
    return
  }

  const fieldName = xstate.currField.name

  if (!xstate.streamedIndex) {
    xstate.streamedIndex = { [fieldName]: 0 }
  }

  if (!final) {
    if (
      !xstate.currField.type ||
      (!xstate.currField.type.isArray &&
        xstate.currField.type.name === 'string')
    ) {
      const pos = xstate.streamedIndex[fieldName] ?? 0
      const s = xstate.s + pos

      const v = content.substring(s)
      const v1 = v.replace(/[\s\n\t]+$/, '')
      const v2 = pos === 0 ? v1.trimStart() : v1

      yield { [fieldName]: v2 } as Partial<OUT>

      // Ignore the length that was trimmed from the end not the beginning
      xstate.streamedIndex[fieldName] = pos + v1.length
      return
    }
  }

  for (const key of Object.keys(values)) {
    const value = values[key]

    if (Array.isArray(value)) {
      const s = xstate.streamedIndex[key] ?? 0
      const v = value.slice(s)
      if (v) {
        yield { [key]: v } as Partial<OUT>
        xstate.streamedIndex[key] = s + 1
      }
      continue
    }

    if (!xstate.streamedIndex[key]) {
      yield { [key]: value } as Partial<OUT>
      xstate.streamedIndex[key] = 1
    }
  }
}

function validateAndParseFieldValue(
  field: Readonly<AxField>,
  fieldValue: string | undefined
): unknown {
  if (
    !fieldValue ||
    fieldValue === '' ||
    fieldValue === 'null' ||
    fieldValue === 'NULL' ||
    fieldValue === 'undefined'
  ) {
    if (field.isOptional) {
      return
    }
    throw new ValidationError({
      message: 'Required field is missing',
      fields: [field],
      value: fieldValue,
    })
  }

  let value: unknown | undefined

  if (field.type?.name === 'json') {
    try {
      const text = extractBlock(fieldValue)
      value = JSON.parse(text)
      return value
    } catch (e) {
      throw new ValidationError({
        message: 'Invalid JSON: ' + (e as Error).message,
        fields: [field],
        value: fieldValue,
      })
    }
  }

  if (field.type?.isArray) {
    try {
      try {
        value = JSON.parse(fieldValue)
      } catch {
        // If JSON parsing fails, try markdown parsing
        value = parseMarkdownList(fieldValue)
      }
      if (!Array.isArray(value)) {
        throw new Error('Expected an array')
      }
    } catch (e) {
      throw new ValidationError({
        message: 'Invalid Array: ' + (e as Error).message,
        fields: [field],
        value: fieldValue,
      })
    }
  }

  try {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (item !== undefined) {
          const v = typeof item === 'string' ? item.trim() : item
          value[index] = convertValueToType(field, v)
        }
      }
    } else {
      value = convertValueToType(field, fieldValue)
    }
  } catch (e) {
    throw new ValidationError({
      message: (e as Error).message,
      fields: [field],
      value: fieldValue,
    })
  }

  if (typeof value === 'string' && value === '') {
    return undefined
  }

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
