import { ColorLog } from '../util/log.js'

import type { AxFieldValue, AxGenOut, AxProgramUsage } from './program.js'
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

export function mergeDeltas<OUT>(
  base: Partial<AxGenOut>,
  delta: Partial<AxGenOut>
) {
  for (const key of Object.keys(delta)) {
    const baseValue = base[key]
    const deltaValue = delta[key]

    if (
      (baseValue === undefined || Array.isArray(baseValue)) &&
      Array.isArray(deltaValue)
    ) {
      // Concatenate arrays
      base[key] = [...(baseValue ?? []), ...deltaValue]
    } else if (
      (baseValue === undefined || typeof baseValue === 'string') &&
      typeof deltaValue === 'string'
    ) {
      // Concatenate strings
      base[key] = (baseValue ?? '') + deltaValue
    } else {
      // For all other types, overwrite with the new value
      base[key] = deltaValue
    }
  }
  return base as OUT
}

export class LRUCache<K, V> {
  private cache = new Map<K, V>()
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value) {
      // Refresh position by deleting and re-adding
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (first item in map)
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }
}

const globalPrefixCache = new LRUCache<string, string[]>(500)

/**
 * Checks if a streaming string matches a prefix, either fully or partially from the end.
 * For streaming content, partial matches are checked from shortest to longest since
 * the content grows at the end and we want to detect partial prefixes as they form.
 * @param content The string to check (potentially streaming)
 * @param prefix The prefix to look for
 * @param startIndex Optional starting index for the search (default: 0)
 * @returns
 *   - index >= 0: Position of full match
 *   - -1: No match found
 *   - -2: Partial match from the end
 */
export function matchesContent(
  content: string,
  prefix: string,
  startIndex: number = 0,
  prefixCache: LRUCache<string, string[]> = globalPrefixCache
): number {
  // First check if the complete prefix exists anywhere after startIndex
  const exactMatchIndex = content.indexOf(prefix, startIndex)
  if (exactMatchIndex !== -1) {
    return exactMatchIndex
  }

  // Get or create cached prefixes
  const prefixes =
    prefixCache.get(prefix) ??
    Array.from({ length: prefix.length }, (_, i) => prefix.slice(0, i + 1))

  // Set in cache if it wasn't there
  if (!prefixCache.get(prefix)) {
    prefixCache.set(prefix, prefixes)
  }

  // Get the content slice we'll check for partial matches
  const contentEnd = content.slice(
    Math.max(startIndex, content.length - prefix.length)
  )

  // Check for partial matches at the end, starting from shortest to longest
  // Skip the full prefix as it was already checked
  for (let i = 0; i < prefixes.length - 1; i++) {
    const partialPrefix = prefixes[i]!
    if (contentEnd.endsWith(partialPrefix)) {
      return -2
    }
  }

  return -1
}
