import type { AxChatRequest, AxChatResponseResult } from './types.js';

type AxChatRequestMessage = AxChatRequest['chatPrompt'][number];

function formatForMessage(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function raiseValidationError(
  issue: string,
  args: {
    item?: unknown;
    fieldPath?: string;
    value?: unknown;
    note?: string;
  } = {}
): never {
  const lines: string[] = [issue];
  if (args.fieldPath !== undefined) lines.push(`Field: ${args.fieldPath}`);
  if (args.value !== undefined)
    lines.push(`Value: ${formatForMessage(args.value)}`);
  if (args.note) lines.push(`Note: ${args.note}`);
  if (args.item !== undefined)
    lines.push(`Chat item: ${formatForMessage(args.item)}`);
  throw new Error(lines.join('\n'));
}

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

  const role =
    typeof item === 'object' &&
    item !== null &&
    'role' in item &&
    typeof item.role === 'string'
      ? item.role
      : undefined;
  if (!role) {
    throw new Error(
      `Chat request message must have a role, received: ${value(role)}`
    );
  }

  switch (role) {
    case 'system': {
      const content =
        typeof item === 'object' &&
        item !== null &&
        'content' in item &&
        typeof item.content === 'string'
          ? item.content
          : undefined;
      if (!content || content.trim() === '') {
        throw new Error(
          `System message content cannot be empty or whitespace-only, received: ${value(content)}`
        );
      }
      break;
    }

    case 'user': {
      const content =
        typeof item === 'object' && item !== null && 'content' in item
          ? (item as any).content
          : undefined;
      if (content === undefined) {
        throw new Error(
          `User message content cannot be undefined, received: ${value(content)}`
        );
      }

      if (typeof content === 'string') {
        if (content.trim() === '') {
          throw new Error(
            `User message content cannot be empty or whitespace-only, received: ${value(content)}`
          );
        }
      } else if (Array.isArray(content)) {
        if (content.length === 0) {
          throw new Error(
            `User message content array cannot be empty, received: ${value(content)}`
          );
        }

        for (let index = 0; index < content.length; index++) {
          const contentItem = content[index];
          if (!contentItem || typeof contentItem !== 'object') {
            throw new Error(
              `User message content item at index ${index} must be an object, received: ${value(contentItem)}`
            );
          }

          const contentType =
            typeof contentItem === 'object' &&
            contentItem !== null &&
            'type' in contentItem &&
            typeof contentItem.type === 'string'
              ? contentItem.type
              : undefined;
          if (!contentType) {
            throw new Error(
              `User message content item at index ${index} must have a type, received: ${value(contentType)}`
            );
          }

          switch (contentType) {
            case 'text': {
              const text =
                'text' in contentItem && typeof contentItem.text === 'string'
                  ? contentItem.text
                  : undefined;
              if (!text || text.trim() === '') {
                throw new Error(
                  `User message text content at index ${index} cannot be empty or whitespace-only, received: ${value(text)}`
                );
              }
              break;
            }
            case 'image': {
              const image =
                'image' in contentItem && typeof contentItem.image === 'string'
                  ? contentItem.image
                  : undefined;
              const mimeType =
                'mimeType' in contentItem &&
                typeof contentItem.mimeType === 'string'
                  ? contentItem.mimeType
                  : undefined;

              if (!image || image.trim() === '') {
                throw new Error(
                  `User message image content at index ${index} cannot be empty, received: ${value(image)}`
                );
              }
              if (!mimeType || mimeType.trim() === '') {
                throw new Error(
                  `User message image content at index ${index} must have a mimeType, received: ${value(mimeType)}`
                );
              }
              break;
            }
            case 'audio': {
              const data =
                'data' in contentItem && typeof contentItem.data === 'string'
                  ? contentItem.data
                  : undefined;
              if (!data || data.trim() === '') {
                throw new Error(
                  `User message audio content at index ${index} cannot be empty, received: ${value(data)}`
                );
              }
              break;
            }
            case 'file': {
              // Check if this is a fileUri-based file or data-based file
              const hasFileUri =
                'fileUri' in contentItem &&
                typeof contentItem.fileUri === 'string';
              const hasData =
                'data' in contentItem && typeof contentItem.data === 'string';

              // Must have either fileUri or data, but not both
              if (!hasFileUri && !hasData) {
                throw new Error(
                  `User message file content at index ${index} must have either 'data' or 'fileUri', received: ${value(contentItem)}`
                );
              }

              if (hasFileUri && hasData) {
                throw new Error(
                  `User message file content at index ${index} cannot have both 'data' and 'fileUri', received: ${value(contentItem)}`
                );
              }

              // Validate fileUri if present
              if (hasFileUri) {
                const fileUriValue = contentItem.fileUri;
                if (!fileUriValue || fileUriValue.trim() === '') {
                  throw new Error(
                    `User message file content at index ${index} fileUri cannot be empty, received: ${value(fileUriValue)}`
                  );
                }
              }

              // Validate data if present
              if (hasData) {
                const dataValue = contentItem.data;
                if (!dataValue || dataValue.trim() === '') {
                  throw new Error(
                    `User message file content at index ${index} data cannot be empty, received: ${value(dataValue)}`
                  );
                }
              }

              // Validate mimeType (required for both cases)
              const mimeType =
                'mimeType' in contentItem &&
                typeof contentItem.mimeType === 'string'
                  ? contentItem.mimeType
                  : null;
              if (!mimeType || mimeType.trim() === '') {
                throw new Error(
                  `User message file content at index ${index} must have a mimeType, received: ${value(mimeType)}`
                );
              }
              break;
            }
            case 'url': {
              const url =
                'url' in contentItem && typeof contentItem.url === 'string'
                  ? contentItem.url
                  : undefined;
              if (!url || url.trim() === '') {
                throw new Error(
                  `User message url content at index ${index} cannot be empty, received: ${value(url)}`
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
          `User message content must be a string or array of content objects, received: ${value(content)}`
        );
      }
      break;
    }

    case 'assistant': {
      const content =
        typeof item === 'object' && item !== null && 'content' in item
          ? (item as any).content
          : undefined;

      const functionCalls =
        typeof item === 'object' && item !== null && 'functionCalls' in item
          ? (item as any).functionCalls
          : undefined;

      const hasNonEmptyContent =
        typeof content === 'string' && content.trim() !== '';
      const hasFunctionCalls =
        Array.isArray(functionCalls) && functionCalls.length > 0;

      if (!hasNonEmptyContent && !hasFunctionCalls) {
        raiseValidationError(
          'Assistant message must include non-empty content or at least one function call',
          {
            fieldPath: 'content | functionCalls',
            value: { content, functionCalls },
            item,
          }
        );
      }

      if (content !== undefined && typeof content !== 'string') {
        raiseValidationError('Assistant message content must be a string', {
          fieldPath: 'content',
          value: content,
          item,
        });
      }

      if (functionCalls !== undefined && !Array.isArray(functionCalls)) {
        raiseValidationError(
          'Assistant message functionCalls must be an array when provided',
          {
            fieldPath: 'functionCalls',
            value: functionCalls,
            item,
          }
        );
      }

      if (Array.isArray(functionCalls)) {
        for (let i = 0; i < functionCalls.length; i++) {
          const fc = functionCalls[i];
          if (!fc || typeof fc !== 'object') {
            raiseValidationError('functionCalls entry must be an object', {
              fieldPath: `functionCalls[${i}]`,
              value: fc,
              item,
            });
          }
          if (
            !('id' in fc) ||
            typeof (fc as any).id !== 'string' ||
            (fc as any).id.trim() === ''
          ) {
            raiseValidationError(
              'functionCalls entry must include a non-empty string id',
              {
                fieldPath: `functionCalls[${i}].id`,
                value: (fc as any).id,
                item,
              }
            );
          }
          if (!('type' in fc) || (fc as any).type !== 'function') {
            raiseValidationError(
              "functionCalls entry must have type 'function'",
              {
                fieldPath: `functionCalls[${i}].type`,
                value: (fc as any).type,
                item,
              }
            );
          }
          if (!('function' in fc) || !(fc as any).function) {
            raiseValidationError(
              'functionCalls entry must include a function object',
              {
                fieldPath: `functionCalls[${i}].function`,
                value: (fc as any).function,
                item,
              }
            );
          } else {
            const funcObj = (fc as any).function;
            if (
              !('name' in funcObj) ||
              typeof funcObj.name !== 'string' ||
              funcObj.name.trim() === ''
            ) {
              raiseValidationError(
                'functionCalls entry must include a non-empty function name',
                {
                  fieldPath: `functionCalls[${i}].function.name`,
                  value: funcObj?.name,
                  item,
                }
              );
            }
            if (funcObj.params !== undefined) {
              if (
                typeof funcObj.params !== 'string' &&
                typeof funcObj.params !== 'object'
              ) {
                raiseValidationError(
                  'functionCalls entry params must be a string or object when provided',
                  {
                    fieldPath: `functionCalls[${i}].function.params`,
                    value: funcObj.params,
                    item,
                  }
                );
              }
            }
          }
        }
      }

      if ((item as any).name !== undefined) {
        const name = (item as any).name;
        if (typeof name !== 'string' || name.trim() === '') {
          raiseValidationError(
            'Assistant message name must be a non-empty string when provided',
            { fieldPath: 'name', value: name, item }
          );
        }
      }
      break;
    }

    case 'function': {
      const functionId =
        typeof item === 'object' &&
        item !== null &&
        'functionId' in item &&
        typeof item.functionId === 'string'
          ? item.functionId
          : undefined;
      const result =
        typeof item === 'object' && item !== null && 'result' in item
          ? item.result
          : undefined;

      if (!functionId || functionId.trim() === '') {
        throw new Error(
          `Function message must have a non-empty functionId, received: ${value(functionId)}`
        );
      }

      if (result === undefined || result === null) {
        throw new Error(
          `Function message must have a result, received: ${value(result)}`
        );
      }

      if (typeof result !== 'string') {
        throw new Error(
          `Function message result must be a string, received: ${value(result)}`
        );
      }

      if (
        (item as any).isError !== undefined &&
        typeof (item as any).isError !== 'boolean'
      ) {
        raiseValidationError(
          'Function message isError must be a boolean when provided',
          {
            fieldPath: 'isError',
            value: (item as any).isError,
            item,
          }
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
