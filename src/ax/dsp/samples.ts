import type { AxAIMemory } from '../mem/types.js'

import type {
  AxGenDeltaOut,
  AxResultPickerFunction,
  AxResultPickerFunctionFunctionResults,
} from './program.js'
import type { AxGenOut } from './types.js'

export interface AxSamplePickerOptions<OUT extends AxGenOut> {
  resultPicker?: AxResultPickerFunction<OUT>
}

/**
 * Checks if there are function calls in memory
 */
function checkForFunctionCalls(mem: AxAIMemory, sessionId?: string): boolean {
  const history = mem.history(0, sessionId)

  // Check for both function calls and function results
  const hasFunctionResults = history.some((msg) => msg.role === 'function')
  const hasFunctionCalls = history.some(
    (msg) =>
      msg.role === 'assistant' &&
      'functionCalls' in msg &&
      Array.isArray(msg.functionCalls) &&
      msg.functionCalls.length > 0
  )

  return hasFunctionCalls && hasFunctionResults
}

/**
 * Extracts function execution results from memory
 */
function extractFunctionResults(
  mem: AxAIMemory,
  sessionId?: string
): AxResultPickerFunctionFunctionResults['results'] {
  const history = mem.history(0, sessionId)
  const results: {
    index: number
    functionName: string
    functionId: string
    args: string | object
    result: string
    isError?: boolean
  }[] = []

  // Find assistant messages with function calls
  const assistantMessages = history.filter(
    (msg) =>
      msg.role === 'assistant' &&
      'functionCalls' in msg &&
      Array.isArray(msg.functionCalls) &&
      msg.functionCalls.length > 0
  )

  // Find function result messages
  const functionMessages = history.filter((msg) => msg.role === 'function')

  // Match function calls with their results
  for (const assistantMsg of assistantMessages) {
    if ('functionCalls' in assistantMsg && assistantMsg.functionCalls) {
      for (const funcCall of assistantMsg.functionCalls) {
        // Find the corresponding function result
        const funcResult = functionMessages.find(
          (msg) => 'functionId' in msg && msg.functionId === funcCall.id
        )

        if (
          funcResult &&
          'result' in funcResult &&
          'functionId' in funcResult
        ) {
          results.push({
            index: results.length, // Use sequential index for function results
            functionName: funcCall.function.name,
            functionId: funcCall.id,
            args: funcCall.function.params || '',
            result: String(funcResult.result),
            isError:
              'isError' in funcResult ? Boolean(funcResult.isError) : false,
          })
        }
      }
    }
  }
  return results
}

/**
 * Selects a result from multiple samples using the provided result picker function.
 * If no result picker is provided or only one result exists, returns the first result.
 */
export async function selectFromSamples<OUT extends AxGenOut>(
  buffer: AxGenDeltaOut<OUT>[],
  options?: AxSamplePickerOptions<OUT>,
  mem?: AxAIMemory,
  sessionId?: string
): Promise<number> {
  // If no result picker or only one result, use index 0
  if (!options?.resultPicker || buffer.length <= 1) {
    return 0
  }

  const resultPicker = options.resultPicker

  // Check if there are function calls in memory to determine data type
  const hasFunctionCalls = mem ? checkForFunctionCalls(mem, sessionId) : false

  if (hasFunctionCalls && mem) {
    // Extract function execution data from memory
    const functionResults = extractFunctionResults(mem, sessionId)
    const selectedIndex = await resultPicker({
      type: 'function',
      results: functionResults,
    })

    // Validate the selected index
    if (selectedIndex < 0 || selectedIndex >= functionResults.length) {
      throw new Error(
        `Result picker returned invalid index: ${selectedIndex}. Must be between 0 and ${functionResults.length - 1}`
      )
    }

    return selectedIndex
  } else {
    // Use field results
    const fieldResults = buffer.map((b, index) => ({
      index,
      sample: b.delta,
    }))

    const selectedIndex = await resultPicker({
      type: 'fields',
      results: fieldResults,
    })

    // Validate the selected index
    if (selectedIndex < 0 || selectedIndex >= buffer.length) {
      throw new Error(
        `Result picker returned invalid index: ${selectedIndex}. Must be between 0 and ${buffer.length - 1}`
      )
    }

    return selectedIndex
  }
}

/**
 * Selects a result index from memory using the provided result picker function.
 * If no result picker is provided or only one result exists, returns 0.
 * If the last memory is not from an assistant role, returns 0.
 */
export async function selectFromSamplesInMemory<OUT extends AxGenOut>(
  mem: AxAIMemory,
  sessionId?: string,
  options?: AxSamplePickerOptions<OUT>
): Promise<number> {
  const lastMemory = mem?.getLast(sessionId)

  // If no memory or not from assistant role, return 0
  if (!lastMemory || lastMemory.role !== 'assistant') {
    return 0
  }

  // If only one chat sample, return 0
  if (lastMemory.chat.length <= 1) {
    return 0
  }

  // Convert memory chat to buffer format for selectFromSamples
  const buffer = lastMemory.chat.map((chat) => ({
    version: 0,
    index: chat.index,
    delta: chat.value as OUT,
  }))

  const selectedIndex = await selectFromSamples(buffer, options, mem, sessionId)
  return selectedIndex
}
