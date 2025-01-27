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
    const e = content.indexOf(prefix, xstate.s + 1)
    if (e === -1) {
      continue
    }

    if (xstate.currField) {
      const val = content.substring(xstate.s, e)
      const parsedValue = validateAndParseFieldValue(xstate.currField, val)
      if (parsedValue !== undefined) {
        values[xstate.currField.name] = parsedValue
      }
    }

    checkMissingRequiredFields(xstate, values, index)

    xstate.s = e + prefix.length
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
    const val = content.substring(xstate.s)
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
      return parseLLMFriendlyDate(field, val)
    case 'datetime':
      return parseLLMFriendlyDateTime(field, val)
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

export function* streamingValues<OUT>(
  sig: Readonly<AxSignature>,
  values: Readonly<Record<string, OUT>>,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  content: string
) {
  if (!xstate.currField) {
    return
  }

  const fieldName = xstate.currField.name

  if (!xstate.streamedIndex) {
    xstate.streamedIndex = { [fieldName]: 0 }
  }

  if (
    !xstate.currField.type ||
    (!xstate.currField.type.isArray && xstate.currField.type.name === 'string')
  ) {
    const s = xstate.s + (xstate.streamedIndex[fieldName] ?? 0)
    const v = content.substring(s)
    yield { [fieldName]: v } as Partial<OUT>
    xstate.streamedIndex[fieldName] = v.length
    return
  }

  for (const key of Object.keys(values)) {
    const value = values[key]

    if (Array.isArray(value)) {
      const s = xstate.streamedIndex[fieldName] ?? 0
      const v = value.slice(s)
      if (v) {
        yield { [fieldName]: v } as Partial<OUT>
        xstate.streamedIndex[fieldName] = s + 1
      }
      continue
    }

    if (!xstate.streamedIndex[fieldName]) {
      yield { [fieldName]: value } as Partial<OUT>
      xstate.streamedIndex[fieldName] = 1
    }
  }
}

function validateAndParseFieldValue(
  field: Readonly<AxField>,
  fieldValue: string | undefined
): unknown {
  const fv = fieldValue?.trim()

  if (
    !fv ||
    !fv ||
    fv === '' ||
    fv === 'null' ||
    fv === 'NULL' ||
    fv === 'undefined'
  ) {
    if (field.isOptional) {
      return
    }
    throw new ValidationError({
      message: 'Required field is missing',
      fields: [field],
      value: fv,
    })
  }

  let value: unknown | undefined

  if (field.type?.name === 'json') {
    try {
      const text = extractBlock(fv)
      value = JSON5.parse(text)
      return value
    } catch (e) {
      throw new ValidationError({
        message: 'Invalid JSON: ' + (e as Error).message,
        fields: [field],
        value: fv,
      })
    }
  }

  if (field.type?.isArray) {
    try {
      try {
        value = JSON5.parse(fv)
      } catch {
        // If JSON parsing fails, try markdown parsing
        value = parseMarkdownList(fv)
      }
      if (!Array.isArray(value)) {
        throw new Error('Expected an array')
      }
    } catch (e) {
      throw new ValidationError({
        message: 'Invalid array: ' + (e as Error).message,
        fields: [field],
        value: fv,
      })
    }
  }

  try {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        value[index] = convertValueToType(field, item)
      }
    } else {
      value = convertValueToType(field, fv)
    }
  } catch (e) {
    throw new ValidationError({
      message: (e as Error).message,
      fields: [field],
      value: fieldValue,
    })
  }

  // If validation passes, return null to indicate no error
  return value ?? fv
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
