import { ColorLog } from '../util/log.js'

import type { AxFieldValue, AxProgramUsage } from './program.js'
import type { AxField } from './sig.js'

const colorLog = new ColorLog()

export const updateProgressBar = (
  current: number,
  total: number,
  success: number,
  elapsedTime: number, // in seconds
  progressBarWidth: number = 20, // Default width of the progress bar
  msg: string
): void => {
  const percentage = ((current / total) * 100).toFixed(1)
  const filledBarLength = Math.round((progressBarWidth * current) / total)
  const emptyBarLength = progressBarWidth - filledBarLength
  const filledBar = colorLog.blueBright('█'.repeat(filledBarLength))
  const emptyBar = ' '.repeat(emptyBarLength)
  const itemsPerSecond =
    elapsedTime > 0 ? (current / elapsedTime).toFixed(2) : '0.00'

  process.stdout.write(
    `\r${msg}: ${current} / ${total} (${colorLog.yellow(percentage)}%): 100%|${filledBar}${emptyBar}| Success: ${success}/${total} [${colorLog.red(elapsedTime.toFixed(2))}, ${itemsPerSecond}it/s]`
  )
}

export const validateValue = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
): void => {
  const ft = field.type ?? { name: 'string', isArray: false }

  const validateSingleValue = (
    expectedType: string,
    val: Readonly<AxFieldValue>
  ): boolean => {
    switch (expectedType) {
      case 'string':
        return typeof val === 'string'
      case 'number':
        return typeof val === 'number'
      case 'boolean':
        return typeof val === 'boolean'
      case 'date':
        return val instanceof Date || typeof val === 'string'
      case 'datetime':
        return val instanceof Date || typeof val === 'string'
      default:
        return false // Unknown or unsupported type
    }
  }

  const validImage = (val: Readonly<AxFieldValue>): boolean => {
    if (
      !val ||
      typeof val !== 'object' ||
      !('mimeType' in val) ||
      !('data' in val)
    ) {
      return false
    }
    return true
  }

  if (field.type?.name === 'image') {
    let msg
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!validImage(item)) {
          msg = 'object ({ mimeType: string; data: string })'
          break
        }
      }
    } else if (!validImage(value)) {
      msg = 'object ({ mimeType: string; data: string })'
    }

    if (msg) {
      throw new Error(
        `Validation failed: Expected '${field.name}' to be a ${msg} instead got '${value}'`
      )
    }
    return
  }

  const validAudio = (val: Readonly<AxFieldValue>): boolean => {
    if (!val || typeof val !== 'object' || !('data' in val)) {
      return false
    }
    return true
  }

  if (field.type?.name === 'audio') {
    let msg
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!validAudio(item)) {
          msg = 'object ({ data: string; format?: string })'
          break
        }
      }
    } else if (!validAudio(value)) {
      msg = 'object ({ data: string; format?: string })'
    }

    if (msg) {
      throw new Error(
        `Validation failed: Expected '${field.name}' to be a ${msg} instead got '${value}'`
      )
    }
    return
  }

  let isValid = true

  if (ft.isArray) {
    if (!Array.isArray(value)) {
      isValid = false
    } else {
      for (const item of value) {
        if (!validateSingleValue(ft.name, item)) {
          isValid = false
          break
        }
      }
    }
  } else {
    isValid = validateSingleValue(ft.name, value)
  }

  if (!isValid) {
    throw new Error(
      `Validation failed: Expected '${field.name}' to be a ${field.type?.isArray ? 'an array of ' : ''}${ft.name} instead got '${typeof value}' (${value})`
    )
  }
}

export function mergeProgramUsage(
  usages: readonly AxProgramUsage[]
): AxProgramUsage[] {
  const usageMap: { [key: string]: AxProgramUsage } = {}

  usages.forEach((usage) => {
    const key = `${usage.ai}:${usage.model}`

    if (!usageMap[key]) {
      usageMap[key] = { ...usage }
      return
    }

    usageMap[key]!.promptTokens += usage.promptTokens
    usageMap[key]!.completionTokens += usage.completionTokens
    usageMap[key]!.totalTokens += usage.totalTokens
  })

  return Object.values(usageMap)
}

/**
 * Parses a markdown list from a string. This is a very forgiving parser that
 * will try to handle anything that looks vaguely like a markdown list.
 */
export const parseMarkdownList = (input: string): string[] => {
  // Handle empty input
  if (!input.trim()) {
    return []
  }

  const listBullets = new Set(['-', '*', '+'])
  const numberedListRegex = /^\d+[\s]*[.)\]]\s*/

  const lines = input.split('\n')
  const list = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    // Skip empty lines
    if (!trimmedLine) {
      continue
    }

    // Check for bullet points
    if (trimmedLine[0] && listBullets.has(trimmedLine[0])) {
      list.push(trimmedLine.slice(1).trim())
    }
    // Check for numbered lists (e.g., "1.", "2.", etc.)
    else if (numberedListRegex.test(trimmedLine)) {
      list.push(trimmedLine.replace(numberedListRegex, '').trim())
    }
    // If it's not a list item and we haven't collected any items yet, skip it
    else if (list.length === 0) {
      continue
    }
    // If we've already started collecting list items, then this non-list line
    //is an error
    else {
      throw new Error('Could not parse markdown list: mixed content detected')
    }
  }

  // If we didn't find any list items, throw error
  if (list.length === 0) {
    throw new Error('Could not parse markdown list: no valid list items found')
  }

  return list
}

export function mergeDeltas<T>(
  base: Partial<T>,
  delta: Partial<T>
): Partial<T> {
  const merged = { ...base }

  for (const key in delta) {
    const baseValue = base[key]
    const deltaValue = delta[key]

    if (Array.isArray(baseValue) && Array.isArray(deltaValue)) {
      // Concatenate arrays
      merged[key] = [...baseValue, ...deltaValue] as T[Extract<keyof T, string>]
    } else if (
      typeof baseValue === 'string' &&
      typeof deltaValue === 'string'
    ) {
      // Concatenate strings
      merged[key] = (baseValue + deltaValue) as T[Extract<keyof T, string>]
    } else {
      // For all other types, overwrite with the new value
      merged[key] = deltaValue
    }
  }

  return merged
}
