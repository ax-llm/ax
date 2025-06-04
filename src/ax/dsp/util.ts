import { ColorLog } from '../util/log.js'

import type { AxExample, AxOptimizationStats } from './optimize.js'
import type { AxProgramUsage } from './program.js'
import type { AxField } from './sig.js'
import type { AxFieldValue, AxGenOut } from './types.js'

const colorLog = new ColorLog()

export const updateProgressBar = (
  current: number,
  total: number,
  success: number,
  elapsedTime: number, // in seconds
  msg: string,
  progressBarWidth = 20 // Default width of the progress bar
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
      case 'code':
        return typeof val === 'string'
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
      case 'json':
        return typeof val === 'object' || typeof val === 'string'
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
    let msg: string | undefined
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
    let msg: string | undefined
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

  for (const usage of usages) {
    const key = `${usage.ai}:${usage.model}`

    if (!usageMap[key]) {
      usageMap[key] = { ...usage }
      continue
    }

    const currentUsage = usageMap[key]
    if (currentUsage) {
      const tokens = currentUsage.tokens ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }
      tokens.promptTokens += usage?.tokens?.promptTokens ?? 0
      tokens.completionTokens += usage?.tokens?.completionTokens ?? 0
      tokens.totalTokens += usage?.tokens?.totalTokens ?? 0
      currentUsage.tokens = tokens
    }
  }

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
    // If it's not a list item and we haven't collected any items yet, do nothing
    else if (list.length === 0) {
      // Skip non-list lines at the beginning
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

export function mergeDeltas<OUT extends AxGenOut>(
  base: Partial<AxGenOut>,
  delta: Partial<AxGenOut>
) {
  for (const key of Object.keys(delta)) {
    const baseValue = base[key]
    const deltaValue = delta[key]

    if (baseValue === undefined && Array.isArray(deltaValue)) {
      base[key] = [...deltaValue]
    } else if (Array.isArray(baseValue) && Array.isArray(deltaValue)) {
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
 * @param startIndex Optional starting index for the search
 * @returns
 *   - index >= 0: Position of full match
 *   - -1: No match found
 *   - -2: Partial match from the end
 *   - -3: String is only whitespace
 */
export function matchesContent(
  content: string,
  prefix: string,
  startIndex = 0,
  prefixCache: LRUCache<string, string[]> = globalPrefixCache
): number {
  // Check if string starts with a markdown block with optional language
  if (/^```[a-zA-Z]*\s*$/.test(content)) {
    return -4
  }

  // Check if string is only whitespace
  if (/^[\s`]*$/.test(content)) {
    return -3
  }

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
    const partialPrefix = prefixes[i]
    if (partialPrefix === '\n' || partialPrefix === ':') {
      continue
    }
    if (partialPrefix && contentEnd.endsWith(partialPrefix)) {
      return -2
    }
  }

  return -1
}

export const formatTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
}

export const calculateETA = (
  current: number,
  total: number,
  elapsedMs: number
): string => {
  if (current === 0) return 'calculating...'

  const msPerItem = elapsedMs / current
  const remainingItems = total - current
  const etaMs = msPerItem * remainingItems

  return formatTime(etaMs)
}

interface ProgressConfigInfo {
  maxRounds: number
  batchSize: number
  earlyStoppingPatience: number
  costMonitoring: boolean
  verboseMode: boolean
  debugMode: boolean
}

export const updateDetailedProgress = <T extends AxGenOut = AxGenOut>(
  roundIndex: number,
  current: number,
  total: number,
  elapsedTime: number,
  example: Readonly<AxExample>,
  stats: Readonly<AxOptimizationStats>,
  configInfo: Readonly<ProgressConfigInfo>,
  result?: T,
  error?: Error
): void => {
  // Clear line and create a formatted output
  process.stdout.write('\r\x1b[K')

  const percentage = ((current / total) * 100).toFixed(1)
  const formattedTime = formatTime(elapsedTime)
  const itemsPerSecond =
    elapsedTime > 0 ? ((current / elapsedTime) * 1000).toFixed(2) : '0.00'
  const eta = calculateETA(current, total, elapsedTime)

  // Basic progress info (always shown)
  let output = `Round ${roundIndex + 1}/${configInfo.maxRounds}: ${current}/${total} (${percentage}%) [${formattedTime}, ${itemsPerSecond} it/s, ETA: ${eta}]`

  // Add success stats
  const successRate =
    stats.totalCalls > 0 ? (stats.successfulDemos / stats.totalCalls) * 100 : 0
  output += ` | Success: ${stats.successfulDemos}/${stats.totalCalls} (${successRate.toFixed(1)}%)`

  // Additional info for verbose mode
  if (configInfo.verboseMode || configInfo.debugMode) {
    if (configInfo.costMonitoring) {
      output += `\n  Tokens: ~${stats.estimatedTokenUsage.toLocaleString()} total`
    }

    output += `\n  Batch: ${Math.floor(current / configInfo.batchSize) + 1}/${Math.ceil(total / configInfo.batchSize)}`

    if (configInfo.earlyStoppingPatience > 0 && stats.earlyStopping) {
      output += `\n  Best round: ${stats.earlyStopping.bestScoreRound + 1}, Patience: ${configInfo.earlyStoppingPatience}`
    }
  }

  // Debug mode gets even more info
  if (configInfo.debugMode) {
    // Truncate example keys for display
    const exampleKeys = Object.keys(example)
      .map((k) => {
        const valueStr = JSON.stringify(example[k])
        const truncated =
          valueStr.length > 30 ? `${valueStr.substring(0, 30)}...` : valueStr
        return `${k}: ${truncated}`
      })
      .join(', ')

    output += `\n  Example: {${exampleKeys}}`

    if (error) {
      output += `\n  ERROR: ${error.message}`
    } else if (result) {
      // Truncate result for display
      const resultStr = JSON.stringify(result)
      const truncatedResult =
        resultStr.length > 50 ? `${resultStr.substring(0, 50)}...` : resultStr
      output += `\n  Result: ${truncatedResult}`
    }

    // Add temperature info
    output += `\n  Temperature: ${(0.7 + 0.001 * current).toFixed(3)}`
  }

  console.log(output)
}
