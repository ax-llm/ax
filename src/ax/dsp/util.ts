/* eslint-disable functional/prefer-immutable-types */
import { ColorLog } from '../util/log.js';

import type { AxExample, AxOptimizationStats } from './optimizer.js';
import type { AxGenDeltaOut, AxProgramUsage } from './program.js';
import type { AxField } from './sig.js';
import type { AxFieldValue, AxGenOut } from './types.js';

const colorLog = new ColorLog();

export const updateProgressBar = (
  current: number,
  total: number,
  success: number,
  _elapsedTime: number, // in seconds
  msg: string,
  progressBarWidth = 20 // Default width of the progress bar
): void => {
  const percentage = ((current / total) * 100).toFixed(1);
  const filledBarLength = Math.round((progressBarWidth * current) / total);
  const emptyBarLength = progressBarWidth - filledBarLength;
  const filledBar = colorLog.blueBright('█'.repeat(filledBarLength));
  const emptyBar = ' '.repeat(emptyBarLength);
  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0.0';

  // More user-friendly message
  const friendlyMsg = msg.includes('Running MIPROv2 optimization')
    ? 'Testing prompt variations'
    : msg.includes('Tuning Prompt')
      ? 'Generating training examples'
      : msg;

  // Use newline instead of carriage return to avoid overwriting structured logs
  process.stdout.write(
    `│  ${friendlyMsg}: ${current}/${total} (${colorLog.yellow(percentage)}%) |${filledBar}${emptyBar}| Success rate: ${colorLog.greenBright(successRate)}%\n`
  );
};

export const validateValue = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
): void => {
  const ft = field.type ?? { name: 'string', isArray: false };

  const validateSingleValue = (
    expectedType: string,
    val: Readonly<AxFieldValue>
  ): boolean => {
    switch (expectedType) {
      case 'class':
        return typeof val === 'string';
      case 'code':
        return typeof val === 'string';
      case 'string':
        return typeof val === 'string';
      case 'number':
        return typeof val === 'number';
      case 'boolean':
        return typeof val === 'boolean';
      case 'date':
        return val instanceof Date || typeof val === 'string';
      case 'datetime':
        return val instanceof Date || typeof val === 'string';
      case 'json':
        return typeof val === 'object' || typeof val === 'string';
      default:
        return false; // Unknown or unsupported type
    }
  };

  const validImage = (val: Readonly<AxFieldValue>): boolean => {
    if (
      !val ||
      typeof val !== 'object' ||
      !('mimeType' in val) ||
      !('data' in val)
    ) {
      return false;
    }
    return true;
  };

  if (field.type?.name === 'image') {
    let msg: string | undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!validImage(item)) {
          msg = 'object ({ mimeType: string; data: string })';
          break;
        }
      }
    } else if (!validImage(value)) {
      msg = 'object ({ mimeType: string; data: string })';
    }

    if (msg) {
      throw new Error(
        `Validation failed: Expected '${field.name}' to be type '${msg}' instead got '${value}'`
      );
    }
    return;
  }

  const validAudio = (val: Readonly<AxFieldValue>): boolean => {
    if (!val || typeof val !== 'object' || !('data' in val)) {
      return false;
    }
    return true;
  };

  if (field.type?.name === 'audio') {
    let msg: string | undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!validAudio(item)) {
          msg = 'object ({ data: string; format?: string })';
          break;
        }
      }
    } else if (!validAudio(value)) {
      msg = 'object ({ data: string; format?: string })';
    }

    if (msg) {
      throw new Error(
        `Validation failed: Expected '${field.name}' to be type '${msg}' instead got '${value}'`
      );
    }
    return;
  }

  let isValid = true;

  if (ft.isArray) {
    if (!Array.isArray(value)) {
      isValid = false;
    } else {
      for (const item of value) {
        if (!validateSingleValue(ft.name, item)) {
          isValid = false;
          break;
        }
      }
    }
  } else {
    isValid = validateSingleValue(ft.name, value);
  }

  if (!isValid) {
    const gotType = Array.isArray(value) ? 'array' : typeof value;
    throw new Error(
      `Validation failed: Expected '${field.name}' to be a ${field.type?.isArray ? 'an array of ' : ''}${ft.name} instead got '${gotType}' (${JSON.stringify(value)})`
    );
  }
};

export function mergeProgramUsage(
  usages: readonly AxProgramUsage[]
): AxProgramUsage[] {
  const usageMap: { [key: string]: AxProgramUsage } = {};

  for (const usage of usages) {
    const key = `${usage.ai}:${usage.model}`;

    if (!usageMap[key]) {
      usageMap[key] = { ...usage };
      continue;
    }

    const currentUsage = usageMap[key];
    if (currentUsage) {
      const tokens = currentUsage.tokens ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      tokens.promptTokens += usage?.tokens?.promptTokens ?? 0;
      tokens.completionTokens += usage?.tokens?.completionTokens ?? 0;
      tokens.totalTokens += usage?.tokens?.totalTokens ?? 0;
      currentUsage.tokens = tokens;
    }
  }

  return Object.values(usageMap);
}

/**
 * Parses a markdown list from a string. This is a very forgiving parser that
 * will try to handle anything that looks vaguely like a markdown list.
 */
export const parseMarkdownList = (input: string): string[] => {
  // Handle empty input
  if (!input.trim()) {
    return [];
  }

  const listBullets = new Set(['-', '*', '+']);
  const numberedListRegex = /^\d+[\s]*[.)\]]\s*/;

  const lines = input.split('\n');
  const list = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    // Skip empty lines
    if (!trimmedLine) {
      continue;
    }

    // Check for bullet points
    if (trimmedLine[0] && listBullets.has(trimmedLine[0])) {
      list.push(trimmedLine.slice(1).trim());
    }
    // Check for numbered lists (e.g., "1.", "2.", etc.)
    else if (numberedListRegex.test(trimmedLine)) {
      list.push(trimmedLine.replace(numberedListRegex, '').trim());
    }
    // If it's not a list item and we haven't collected any items yet, do nothing
    else if (list.length === 0) {
      // Skip non-list lines at the beginning
    }
    // If we've already started collecting list items, then this non-list line
    //is an error
    else {
      throw new Error('Could not parse markdown list: mixed content detected');
    }
  }

  // If we didn't find any list items, throw error
  if (list.length === 0) {
    throw new Error('Could not parse markdown list: no valid list items found');
  }

  return list;
};

export function mergeDeltas<OUT extends AxGenOut>(
  base: AxGenDeltaOut<OUT>[],
  currentDelta: AxGenDeltaOut<OUT>
) {
  type ValueTypeOfAxGenOut = AxGenOut[keyof AxGenOut];

  const { index, delta, version } = currentDelta;

  // Cast once for mutation – safe because we'll only assign validated keys
  const target = base.find((b) => b.index === index)?.delta as Record<
    string,
    ValueTypeOfAxGenOut
  >;

  if (!target) {
    base.push({ index, delta, version });
    return base;
  }

  for (const key of Object.keys(delta)) {
    const baseValue = target[key];
    const deltaValue = (delta as Record<string, unknown>)[key];

    if (baseValue === undefined && Array.isArray(deltaValue)) {
      target[key] = [...deltaValue];
    } else if (Array.isArray(baseValue) && Array.isArray(deltaValue)) {
      // Concatenate arrays
      target[key] = [...(baseValue as unknown[]), ...deltaValue];
    } else if (
      (baseValue === undefined || typeof baseValue === 'string') &&
      typeof deltaValue === 'string'
    ) {
      // Concatenate strings
      target[key] = `${baseValue ?? ''}${deltaValue}`;
    } else {
      // For all other types, overwrite with the new value
      target[key] = deltaValue as ValueTypeOfAxGenOut;
    }
  }
  return base;
}

export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value) {
      // Refresh position by deleting and re-adding
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (first item in map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

const globalPrefixCache = new LRUCache<string, string[]>(500);

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
    return -4;
  }

  // Check if string is only whitespace
  if (/^[\s`]*$/.test(content)) {
    return -3;
  }

  // First check if the complete prefix exists anywhere after startIndex
  const exactMatchIndex = content.indexOf(prefix, startIndex);

  if (exactMatchIndex !== -1) {
    return exactMatchIndex;
  }

  // Get or create cached prefixes
  const prefixes =
    prefixCache.get(prefix) ??
    Array.from({ length: prefix.length }, (_, i) => prefix.slice(0, i + 1));

  // Set in cache if it wasn't there
  if (!prefixCache.get(prefix)) {
    prefixCache.set(prefix, prefixes);
  }

  // Check for partial matches at the end (for streaming content)
  // We want to find the longest partial prefix that the content ends with
  let longestPartialMatch = -1;

  // Start from the longest prefix and work backwards to find the longest match
  for (let i = prefixes.length - 1; i >= 0; i--) {
    const partialPrefix = prefixes[i] as string;

    // Check if content ends with this partial prefix
    if (content.endsWith(partialPrefix)) {
      longestPartialMatch = i;
      break; // Found the longest match, no need to continue
    }
  }

  // Return -2 for partial match, -1 for no match
  return longestPartialMatch >= 0 ? -2 : -1;
}

export const formatTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
};

export const calculateETA = (
  current: number,
  total: number,
  elapsedMs: number
): string => {
  if (current === 0) return 'calculating...';

  const msPerItem = elapsedMs / current;
  const remainingItems = total - current;
  const etaMs = msPerItem * remainingItems;

  return formatTime(etaMs);
};

interface ProgressConfigInfo {
  maxRounds: number;
  batchSize: number;
  earlyStoppingPatience: number;
  costMonitoring: boolean;
  verboseMode: boolean;
  debugMode: boolean;
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
  process.stdout.write('\r\x1b[K');

  const percentage = ((current / total) * 100).toFixed(1);
  const formattedTime = formatTime(elapsedTime);
  const eta = calculateETA(current, total, elapsedTime);

  // Basic progress info (always shown) - more user-friendly
  let output = `Training round ${roundIndex + 1}/${configInfo.maxRounds}: ${current}/${total} (${percentage}%) [${formattedTime}, ETA: ${eta}]`;

  // Add success stats in a cleaner format
  const successRate =
    stats.totalCalls > 0 ? (stats.successfulDemos / stats.totalCalls) * 100 : 0;
  output += ` | Success rate: ${successRate.toFixed(1)}% (${stats.successfulDemos}/${stats.totalCalls})`;

  // Additional info for verbose mode
  if (configInfo.verboseMode || configInfo.debugMode) {
    if (configInfo.costMonitoring) {
      output += `\n  Tokens: ~${stats.estimatedTokenUsage.toLocaleString()} total`;
    }

    output += `\n  Batch: ${Math.floor(current / configInfo.batchSize) + 1}/${Math.ceil(total / configInfo.batchSize)}`;

    if (configInfo.earlyStoppingPatience > 0 && stats.earlyStopping) {
      output += `\n  Best round: ${stats.earlyStopping.bestScoreRound + 1}, Patience: ${configInfo.earlyStoppingPatience}`;
    }
  }

  // Debug mode gets even more info
  if (configInfo.debugMode) {
    // Truncate example keys for display
    const exampleKeys = Object.keys(example)
      .map((k) => {
        const valueStr = JSON.stringify(example[k]);
        const truncated =
          valueStr.length > 30 ? `${valueStr.substring(0, 30)}...` : valueStr;
        return `${k}: ${truncated}`;
      })
      .join(', ');

    output += `\n  Example: {${exampleKeys}}`;

    if (error) {
      output += `\n  ERROR: ${error.message}`;
    } else if (result) {
      // Truncate result for display
      const resultStr = JSON.stringify(result);
      const truncatedResult =
        resultStr.length > 50 ? `${resultStr.substring(0, 50)}...` : resultStr;
      output += `\n  Result: ${truncatedResult}`;
    }

    // Add temperature info
    output += `\n  Temperature: ${(0.7 + 0.001 * current).toFixed(3)}`;
  }

  console.log(output);
};
