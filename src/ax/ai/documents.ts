import type { AxChatRequest, AxDocumentInput } from './types.js';

/** @internal Validate native document values before transport or prompt rendering. */
export function validateDocumentInput(
  value: unknown
): asserts value is AxDocumentInput {
  if (!value || typeof value !== 'object' || !('source' in value)) {
    throw new Error('Document input must contain a source');
  }
  const doc = value as AxDocumentInput;
  for (const key of ['title', 'context'] as const) {
    if (doc[key] !== undefined && typeof doc[key] !== 'string') {
      throw new Error(`Document ${key} must be a string`);
    }
  }
  if (
    doc.citations !== undefined &&
    (!doc.citations || typeof doc.citations.enabled !== 'boolean')
  ) {
    throw new Error('Document citations.enabled must be a boolean');
  }
  const source = doc.source;
  if (!source || typeof source !== 'object') {
    throw new Error('Document source must be an object');
  }
  const nonempty = (text: unknown): text is string =>
    typeof text === 'string' && text.trim().length > 0;
  switch (source.type) {
    case 'text':
      if (!nonempty(source.data))
        throw new Error('Document text must not be empty');
      return;
    case 'base64':
      if (source.mediaType !== 'application/pdf' || !nonempty(source.data)) {
        throw new Error(
          'Document base64 source requires PDF data and mediaType application/pdf'
        );
      }
      return;
    case 'url':
      if (!nonempty(source.url) || !/^https?:\/\//i.test(source.url)) {
        throw new Error('Document URL must use http or https');
      }
      return;
    case 'file':
      if (!nonempty(source.fileId))
        throw new Error('Document fileId must not be empty');
      return;
    case 'content':
      if (
        !Array.isArray(source.content) ||
        !source.content.length ||
        source.content.some(
          (block) => block?.type !== 'text' || !nonempty(block.text)
        )
      ) {
        throw new Error(
          'Document custom content must contain nonempty text blocks'
        );
      }
      return;
    default:
      throw new Error('Unsupported document source type');
  }
}

/** @internal Documents requiring native preservation must never be degraded by routing. */
export function requiresNativeDocuments(
  request: Readonly<AxChatRequest<unknown>>
): boolean {
  return request.chatPrompt.some(
    (message) =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) =>
          part.type === 'document' ||
          (part.type === 'file' && part.citations?.enabled === true)
      )
  );
}
