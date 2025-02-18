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
  lastDelta?: string
  currField?: AxField
  currFieldIndex?: number
  extractedFields: AxField[]
  streamedIndex?: Record<string, number>
  s: number
  inBlock?: boolean
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
  content: string,
  streamingValidation: boolean = false
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
        if (streamingValidation && values.length == 0 && !field.isOptional) {
          throw new ValidationError({
            message: 'Required field not found',
            fields: [field],
          })
        }
        continue // Field is not found, continue to the next field
      case -2:
        return true // Partial match at end, skip and gather more content
      case -3:
        return true // String is only whitespace, skip and gather more content
      case -4:
        xstate.inBlock = true
        return true // String is only backticks, skip and gather more content
    }
    // We found the full match at the index e

    let prefixLen = prefix.length

    if (xstate.currField) {
      const val = content.substring(xstate.s, e).trim()
      const parsedValue = validateAndParseFieldValue(xstate.currField, val)
      if (parsedValue !== undefined) {
        values[xstate.currField.name] = parsedValue
      }
      xstate.lastDelta = val
    }

    checkMissingRequiredFields(xstate, values, index)

    xstate.s = e + prefixLen
    xstate.currField = field
    xstate.currFieldIndex = index

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
    let val = content.substring(xstate.s).trim()

    const parsedValue = validateAndParseFieldValue(xstate.currField, val)
    if (parsedValue !== undefined) {
      values[xstate.currField.name] = parsedValue
    }
  }
  const sigFields = sig.getOutputFields()

  // Check all previous required fields before processing current field
  checkMissingRequiredFields(xstate, values, sigFields.length)
}

const convertValueToType = (field: Readonly<AxField>, val: string) => {
  switch (field.type?.name) {
    case 'code':
      return extractBlock(val)

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

export function processStreamingDelta(
  content: string,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState
) {
  if (!xstate.currField) {
    return null
  }

  const { name: fieldName, type: fieldType } = xstate.currField ?? {}
  const { isArray: fieldIsArray, name: fieldTypeName } = fieldType ?? {}

  if (!xstate.streamedIndex) {
    xstate.streamedIndex = {}
  }

  if (fieldIsArray) {
    if (xstate.streamedIndex[fieldName] === undefined) {
      xstate.streamedIndex[fieldName] = 0
    }
    return null
  }

  if (fieldTypeName !== 'string' && fieldTypeName !== 'code') {
    if (xstate.streamedIndex[fieldName] === undefined) {
      xstate.streamedIndex[fieldName] = 0
    }
    return null
  }

  const pos = xstate.streamedIndex[fieldName] ?? 0
  const s = xstate.s + pos
  const isFirstChunk = pos === 0

  // Grab everything from the current extract position
  const d1 = content.substring(s)

  // Remove trailing whitespace, tabs, and newlines
  let d2 = d1.replace(/\s+$/, '')

  // If this field is a "code" type, remove trailing backticks
  if (xstate.currField?.type?.name === 'code') {
    d2 = d2.replace(/\s*```\s*$/, '')
  }

  // Only trim start for the first chunk
  let d3 = isFirstChunk ? d2.trimStart() : d2

  // If this field is a "code" type, remove leading/trailing markdown fences
  if (xstate.currField?.type?.name === 'code') {
    // Remove any leading triple-backtick fences (with optional language specifier)
    d3 = d3.replace(/^[ ]*```[a-zA-Z0-9]*\n\s*/, '')
  }

  if (d3.length > 0) {
    xstate.streamedIndex[fieldName] = pos + d2.length
  }

  return d3
}

export function getStreamingDelta(
  content: string,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState
) {
  if (xstate.lastDelta) {
    processStreamingDelta(xstate.lastDelta, xstate)
    xstate.lastDelta = undefined
  }

  return processStreamingDelta(content, xstate)
}

export function* streamValues<OUT>(
  sig: Readonly<AxSignature>,
  values: Readonly<Record<string, OUT>>,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  delta: string | null
) {
  if (!xstate.currField) {
    return
  }

  const fieldName = xstate.currField.name

  if (delta && delta.length > 0) {
    yield { [fieldName]: delta } as Partial<OUT>
    return
  }

  for (const key of Object.keys(values)) {
    const value = values[key]

    if (Array.isArray(value)) {
      if (xstate.streamedIndex?.[key] === undefined) {
        throw new Error('Streamed index is not set for array field ' + key)
      }
      const s = xstate.streamedIndex[key]
      const v = value.slice(s)
      if (v && v.length > 0) {
        yield { [key]: v } as Partial<OUT>
        xstate.streamedIndex[key] = s + 1
      }
    } else {
      yield { [key]: value } as Partial<OUT>
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
    /^(null|undefined)\s*$/i.test(fieldValue)
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
  const markdownBlockPattern = /```([A-Za-z]*)\n([\s\S]*?)\n```/g
  const match = markdownBlockPattern.exec(input)
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
