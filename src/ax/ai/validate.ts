import type { AxChatRequest, AxChatResponseResult } from './types.js';

type AxChatRequestMessage = AxChatRequest['chatPrompt'][number];

/**
 * Validates a chat request message item to ensure it meets the required criteria
 * @param item - The chat request message to validate
 * @throws {Error} When validation fails with a descriptive error message
 */
export function axValidateChatRequestMessage(item: AxChatRequestMessage): void {
  const value = (v: unknown) => JSON.stringify(v, null, 2);

  if (!item) {
    throw new Error(
      `Chat request message item cannot be null or undefined, received: ${value(item)}`
    );
  }

  const role = (item as { role?: string })?.role;
  if (!role) {
    throw new Error(
      `Chat request message must have a role, received: ${value(role)}`
    );
  }

  switch (role) {
    case 'system': {
      const systemItem = item as { role: 'system'; content: string };
      if (!systemItem.content || systemItem.content.trim() === '') {
        throw new Error(
          `System message content cannot be empty or whitespace-only, received: ${value(systemItem.content)}`
        );
      }
      break;
    }

    case 'user': {
      const userItem = item as { role: 'user'; content: string | object[] };
      if (!userItem.content) {
        throw new Error(
          `User message content cannot be undefined, received: ${value(userItem.content)}`
        );
      }

      if (typeof userItem.content === 'string') {
        if (userItem.content.trim() === '') {
          throw new Error(
            `User message content cannot be empty or whitespace-only, received: ${value(userItem.content)}`
          );
        }
      } else if (Array.isArray(userItem.content)) {
        if (userItem.content.length === 0) {
          throw new Error(
            `User message content array cannot be empty, received: ${value(userItem.content)}`
          );
        }

        for (let index = 0; index < userItem.content.length; index++) {
          const contentItem = userItem.content[index];
          if (!contentItem || typeof contentItem !== 'object') {
            throw new Error(
              `User message content item at index ${index} must be an object, received: ${value(contentItem)}`
            );
          }

          const contentType = (contentItem as { type?: string })?.type;
          if (!contentType) {
            throw new Error(
              `User message content item at index ${index} must have a type, received: ${value(contentType)}`
            );
          }

          switch (contentType) {
            case 'text': {
              const textItem = contentItem as { type: 'text'; text: string };
              if (!textItem.text || textItem.text.trim() === '') {
                throw new Error(
                  `User message text content at index ${index} cannot be empty or whitespace-only, received: ${value(textItem.text)}`
                );
              }
              break;
            }
            case 'image': {
              const imageItem = contentItem as {
                type: 'image';
                image: string;
                mimeType: string;
              };
              if (!imageItem.image || imageItem.image.trim() === '') {
                throw new Error(
                  `User message image content at index ${index} cannot be empty, received: ${value(imageItem.image)}`
                );
              }
              if (!imageItem.mimeType || imageItem.mimeType.trim() === '') {
                throw new Error(
                  `User message image content at index ${index} must have a mimeType, received: ${value(imageItem.mimeType)}`
                );
              }
              break;
            }
            case 'audio': {
              const audioItem = contentItem as { type: 'audio'; data: string };
              if (!audioItem.data || audioItem.data.trim() === '') {
                throw new Error(
                  `User message audio content at index ${index} cannot be empty, received: ${value(audioItem.data)}`
                );
              }
              break;
            }
            default:
              throw new Error(
                `User message content item at index ${index} has unsupported type: ${value(contentType)}`
              );
          }
        }
      } else {
        throw new Error(
          `User message content must be a string or array of content objects, received: ${value(userItem.content)}`
        );
      }
      break;
    }

    case 'assistant': {
      const assistantItem = item as {
        role: 'assistant';
        content?: string;
        functionCalls?: object[];
      };
      // Assistant messages can have empty content if they have function calls
      if (!assistantItem.content && !assistantItem.functionCalls) {
        throw new Error(
          `Assistant message must have either content or function calls, received content: ${value(assistantItem.content)}, functionCalls: ${value(assistantItem.functionCalls)}`
        );
      }

      if (assistantItem.content && typeof assistantItem.content !== 'string') {
        throw new Error(
          `Assistant message content must be a string, received: ${value(assistantItem.content)}`
        );
      }

      if (
        assistantItem.functionCalls &&
        !Array.isArray(assistantItem.functionCalls)
      ) {
        throw new Error(
          `Assistant message function calls must be an array, received: ${value(assistantItem.functionCalls)}`
        );
      }
      break;
    }

    case 'function': {
      const functionItem = item as {
        role: 'function';
        functionId: string;
        result: string;
      };
      if (!functionItem.functionId || functionItem.functionId.trim() === '') {
        throw new Error(
          `Function message must have a non-empty functionId, received: ${value(functionItem.functionId)}`
        );
      }

      if (functionItem.result === undefined || functionItem.result === null) {
        throw new Error(
          `Function message must have a result, received: ${value(functionItem.result)}`
        );
      }

      if (typeof functionItem.result !== 'string') {
        throw new Error(
          `Function message result must be a string, received: ${value(functionItem.result)}`
        );
      }
      break;
    }

    default:
      throw new Error(`Unsupported message role: ${value(role)}`);
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
  const value = (v: unknown) => JSON.stringify(v, null, 2);
  const resultsArray = Array.isArray(results) ? results : [results];

  if (resultsArray.length === 0) {
    throw new Error(
      `Chat response results cannot be empty, received: ${value(resultsArray)}`
    );
  }

  for (let arrayIndex = 0; arrayIndex < resultsArray.length; arrayIndex++) {
    const result = resultsArray[arrayIndex];
    if (!result) {
      throw new Error(
        `Chat response result at index ${arrayIndex} cannot be null or undefined, received: ${value(result)}`
      );
    }

    // Validate index
    if (typeof result.index !== 'number') {
      throw new Error(
        `Chat response result at index ${arrayIndex} must have a numeric index, received: ${value(result.index)}`
      );
    }

    if (result.index < 0) {
      throw new Error(
        `Chat response result at index ${arrayIndex} must have a non-negative index, received: ${value(result.index)}`
      );
    }

    // Validate that at least one meaningful field is present
    if (
      !result.content &&
      !result.thought &&
      !result.functionCalls &&
      !result.finishReason
    ) {
      throw new Error(
        `Chat response result at index ${arrayIndex} must have at least one of: content, thought, functionCalls, or finishReason, received: ${value({ content: result.content, thought: result.thought, functionCalls: result.functionCalls, finishReason: result.finishReason })}`
      );
    }

    // Validate content if present
    if (result.content !== undefined && typeof result.content !== 'string') {
      throw new Error(
        `Chat response result content at index ${arrayIndex} must be a string, received: ${value(result.content)}`
      );
    }

    // Validate thought if present
    if (result.thought !== undefined && typeof result.thought !== 'string') {
      throw new Error(
        `Chat response result thought at index ${arrayIndex} must be a string, received: ${value(result.thought)}`
      );
    }

    // Validate name if present
    if (result.name !== undefined) {
      if (typeof result.name !== 'string') {
        throw new Error(
          `Chat response result name at index ${arrayIndex} must be a string, received: ${value(result.name)}`
        );
      }
      if (result.name.trim() === '') {
        throw new Error(
          `Chat response result name at index ${arrayIndex} cannot be empty or whitespace-only, received: ${value(result.name)}`
        );
      }
    }

    // Validate annotations if present
    if (result.annotations !== undefined) {
      if (!Array.isArray(result.annotations)) {
        throw new Error(
          `Chat response result annotations at index ${arrayIndex} must be an array, received: ${value(result.annotations)}`
        );
      }
      for (let i = 0; i < result.annotations.length; i++) {
        const annotation = result.annotations[i];
        if (!annotation || typeof annotation !== 'object') {
          throw new Error(
            `Chat response result annotation at index ${arrayIndex}[${i}] must be an object, received: ${value(annotation)}`
          );
        }
        if (annotation.type !== 'url_citation') {
          throw new Error(
            `Chat response result annotation at index ${arrayIndex}[${i}] must have type 'url_citation', received: ${value(annotation.type)}`
          );
        }
        if (
          !annotation.url_citation ||
          typeof annotation.url_citation !== 'object'
        ) {
          throw new Error(
            `Chat response result annotation at index ${arrayIndex}[${i}] must have a valid url_citation object, received: ${value(annotation.url_citation)}`
          );
        }
        if (typeof annotation.url_citation.url !== 'string') {
          throw new Error(
            `Chat response result annotation at index ${arrayIndex}[${i}] url_citation.url must be a string, received: ${value(annotation.url_citation.url)}`
          );
        }
      }
    }

    // Validate id if present
    if (result.id !== undefined) {
      if (typeof result.id !== 'string') {
        throw new Error(
          `Chat response result id at index ${arrayIndex} must be a string, received: ${value(result.id)}`
        );
      }
      if (result.id.trim() === '') {
        throw new Error(
          `Chat response result id at index ${arrayIndex} cannot be empty or whitespace-only, received: ${value(result.id)}`
        );
      }
    }

    // Validate functionCalls if present
    if (result.functionCalls !== undefined) {
      if (!Array.isArray(result.functionCalls)) {
        throw new Error(
          `Chat response result functionCalls at index ${arrayIndex} must be an array, received: ${value(result.functionCalls)}`
        );
      }

      for (
        let callIndex = 0;
        callIndex < result.functionCalls.length;
        callIndex++
      ) {
        const functionCall = result.functionCalls[callIndex];
        if (!functionCall) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} cannot be null or undefined, received: ${value(functionCall)}`
          );
        }

        if (
          !functionCall.id ||
          typeof functionCall.id !== 'string' ||
          functionCall.id.trim() === ''
        ) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have a non-empty string id, received: ${value(functionCall.id)}`
          );
        }

        if (functionCall.type !== 'function') {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have type 'function', received: ${value(functionCall.type)}`
          );
        }

        if (!functionCall.function) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have a function object, received: ${value(functionCall.function)}`
          );
        }

        if (
          !functionCall.function.name ||
          typeof functionCall.function.name !== 'string' ||
          functionCall.function.name.trim() === ''
        ) {
          throw new Error(
            `Function call at index ${callIndex} in result ${arrayIndex} must have a non-empty function name, received: ${value(functionCall.function.name)}`
          );
        }

        if (functionCall.function.params !== undefined) {
          if (
            typeof functionCall.function.params !== 'string' &&
            typeof functionCall.function.params !== 'object'
          ) {
            throw new Error(
              `Function call params at index ${callIndex} in result ${arrayIndex} must be a string or object, received: ${value(functionCall.function.params)}`
            );
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
      ];
      if (!validFinishReasons.includes(result.finishReason)) {
        throw new Error(
          `Chat response result finishReason at index ${arrayIndex} must be one of: ${validFinishReasons.join(', ')}, received: ${value(result.finishReason)}`
        );
      }
    }
  }
}
