import type { AxChatRequest, AxChatResponseResult } from './types.js'

type AxChatRequestMessage = AxChatRequest['chatPrompt'][number]

/**
 * Validates a chat request message item to ensure it meets the required criteria
 * @param item - The chat request message to validate
 * @throws {Error} When validation fails with a descriptive error message
 */
export function axValidateChatRequestMessage(item: AxChatRequestMessage): void {
  if (!item) {
    throw new Error('Chat request message item cannot be null or undefined')
  }

  if (!item.role) {
    throw new Error('Chat request message must have a role')
  }

  switch (item.role) {
    case 'system':
      if (!item.content || item.content.trim() === '') {
        throw new Error(
          'System message content cannot be empty or whitespace-only'
        )
      }
      break

    case 'user':
      if (!item.content) {
        throw new Error('User message content cannot be undefined')
      }

      if (typeof item.content === 'string') {
        if (item.content.trim() === '') {
          throw new Error(
            'User message content cannot be empty or whitespace-only'
          )
        }
      } else if (Array.isArray(item.content)) {
        if (item.content.length === 0) {
          throw new Error('User message content array cannot be empty')
        }

        for (let index = 0; index < item.content.length; index++) {
          const contentItem = item.content[index]
          if (!contentItem || typeof contentItem !== 'object') {
            throw new Error(
              `User message content item at index ${index} must be an object`
            )
          }

          if (!contentItem.type) {
            throw new Error(
              `User message content item at index ${index} must have a type`
            )
          }

          switch (contentItem.type) {
            case 'text':
              if (!contentItem.text || contentItem.text.trim() === '') {
                throw new Error(
                  `User message text content at index ${index} cannot be empty or whitespace-only`
                )
              }
              break
            case 'image':
              if (!contentItem.image || contentItem.image.trim() === '') {
                throw new Error(
                  `User message image content at index ${index} cannot be empty`
                )
              }
              if (!contentItem.mimeType || contentItem.mimeType.trim() === '') {
                throw new Error(
                  `User message image content at index ${index} must have a mimeType`
                )
              }
              break
            case 'audio':
              if (!contentItem.data || contentItem.data.trim() === '') {
                throw new Error(
                  `User message audio content at index ${index} cannot be empty`
                )
              }
              break
            default:
              throw new Error(
                `User message content item at index ${index} has unsupported type: ${(contentItem as { type: string }).type}`
              )
          }
        }
      } else {
        throw new Error(
          'User message content must be a string or array of content objects'
        )
      }
      break

    case 'assistant':
      // Assistant messages can have empty content if they have function calls
      if (!item.content && !item.functionCalls) {
        throw new Error(
          'Assistant message must have either content or function calls'
        )
      }

      if (item.content && typeof item.content !== 'string') {
        throw new Error('Assistant message content must be a string')
      }

      if (item.functionCalls && !Array.isArray(item.functionCalls)) {
        throw new Error('Assistant message function calls must be an array')
      }
      break

    case 'function':
      if (!item.functionId || item.functionId.trim() === '') {
        throw new Error('Function message must have a non-empty functionId')
      }

      if (item.result === undefined || item.result === null) {
        throw new Error('Function message must have a result')
      }

      if (typeof item.result !== 'string') {
        throw new Error('Function message result must be a string')
      }
      break

    default:
      throw new Error(
        `Unsupported message role: ${(item as { role: string }).role}`
      )
  }
}

/**
 * Validates a chat response result to ensure it meets the required criteria
 * @param results - The chat response results to validate (single result or array)
 * @throws {Error} When validation fails with a descriptive error message
 */
export function axValidateChatResponseResult(
  results: Readonly<AxChatResponseResult[]> | Readonly<AxChatResponseResult>
): void {
  const resultsArray = Array.isArray(results) ? results : [results]

  if (resultsArray.length === 0) {
    throw new Error('Chat response results cannot be empty')
  }

  for (let arrayIndex = 0; arrayIndex < resultsArray.length; arrayIndex++) {
    const result = resultsArray[arrayIndex]
    if (!result) {
      throw new Error(
        `Chat response result at index ${arrayIndex} cannot be null or undefined`
      )
    }

    // Validate index
    if (typeof result.index !== 'number') {
      throw new Error(
        `Chat response result at index ${arrayIndex} must have a numeric index`
      )
    }

    if (result.index < 0) {
      throw new Error(
        `Chat response result at index ${arrayIndex} must have a non-negative index`
      )
    }

    // Validate that at least one meaningful field is present
    if (
      !result.content &&
      !result.thought &&
      !result.functionCalls &&
      !result.finishReason
    ) {
      throw new Error(
        `Chat response result at index ${arrayIndex} must have at least one of: content, thought, functionCalls, or finishReason`
      )
    }

    // Validate content if present
    if (result.content !== undefined && typeof result.content !== 'string') {
      throw new Error(
        `Chat response result content at index ${arrayIndex} must be a string`
      )
    }

    // Validate thought if present
    if (result.thought !== undefined && typeof result.thought !== 'string') {
      throw new Error(
        `Chat response result thought at index ${arrayIndex} must be a string`
      )
    }

    // Validate name if present
    if (result.name !== undefined) {
      if (typeof result.name !== 'string') {
        throw new Error(
          `Chat response result name at index ${arrayIndex} must be a string`
        )
      }
      if (result.name.trim() === '') {
        throw new Error(
          `Chat response result name at index ${arrayIndex} cannot be empty or whitespace-only`
        )
      }
    }

    // Validate id if present
    if (result.id !== undefined) {
      if (typeof result.id !== 'string') {
        throw new Error(
          `Chat response result id at index ${arrayIndex} must be a string`
        )
      }
      if (result.id.trim() === '') {
        throw new Error(
          `Chat response result id at index ${arrayIndex} cannot be empty or whitespace-only`
        )
      }
    }

    // Validate functionCalls if present
    if (result.functionCalls !== undefined) {
      if (!Array.isArray(result.functionCalls)) {
        throw new Error(
          `Chat response result functionCalls at index ${arrayIndex} must be an array`
        )
      }

      for (
        let callIndex = 0;
        callIndex < result.functionCalls.length;
        callIndex++
      ) {
        const functionCall = result.functionCalls[callIndex]
        if (!functionCall) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} cannot be null or undefined`
          )
        }

        if (
          !functionCall.id ||
          typeof functionCall.id !== 'string' ||
          functionCall.id.trim() === ''
        ) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have a non-empty string id`
          )
        }

        if (functionCall.type !== 'function') {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have type 'function'`
          )
        }

        if (!functionCall.function) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have a function object`
          )
        }

        if (
          !functionCall.function.name ||
          typeof functionCall.function.name !== 'string' ||
          functionCall.function.name.trim() === ''
        ) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have a non-empty function name`
          )
        }

        if (functionCall.function.params !== undefined) {
          if (
            typeof functionCall.function.params !== 'string' &&
            typeof functionCall.function.params !== 'object'
          ) {
            throw new Error(
              `Function call params at index ${callIndex} in result ${arrayIndex} must be a string or object`
            )
          }
        }
      }
    }

    // Validate finishReason if present
    if (result.finishReason !== undefined) {
      const validFinishReasons = [
        'stop',
        'length',
        'function_call',
        'content_filter',
        'error',
      ]
      if (!validFinishReasons.includes(result.finishReason)) {
        throw new Error(
          `Chat response result finishReason at index ${arrayIndex} must be one of: ${validFinishReasons.join(', ')}`
        )
      }
    }
  }
}
