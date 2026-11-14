import { validateDocumentInput } from '../documents.js';
import type { AxChatRequest, AxDocumentInput } from '../types.js';
import type { AxAIAnthropicDocumentBlock } from './types.js';

type UserContent = Exclude<
  Extract<AxChatRequest['chatPrompt'][number], { role: 'user' }>['content'],
  string
>[number];

/** @internal Normalize existing PDF file inputs alongside explicit document sources. */
export function getAnthropicDocument(
  part: UserContent
): AxDocumentInput | undefined {
  if (part.type === 'document') return part;
  if (part.type !== 'file') return undefined;
  if (part.mimeType !== 'application/pdf') {
    if (part.citations?.enabled) {
      throw new Error(
        'Anthropic file citations require a PDF; use a document text source for plain text'
      );
    }
    return undefined;
  }
  return {
    source:
      'fileUri' in part
        ? { type: 'url', url: part.fileUri }
        : { type: 'base64', mediaType: 'application/pdf', data: part.data },
    ...(part.title !== undefined ? { title: part.title } : {}),
    ...(part.context !== undefined ? { context: part.context } : {}),
    ...(part.citations !== undefined ? { citations: part.citations } : {}),
    ...(part.cache !== undefined ? { cache: part.cache } : {}),
  };
}

/** @internal */
export function validateAnthropicDocuments(
  request: Readonly<AxChatRequest<unknown>>,
  isVertex: boolean
): void {
  const documents = request.chatPrompt.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) => {
          const doc = getAnthropicDocument(part);
          return doc ? [doc] : [];
        })
      : []
  );
  for (const doc of documents) {
    validateDocumentInput(doc);
    if (isVertex && doc.source.type === 'file') {
      throw new Error(
        'Anthropic fileId document sources require the first-party Files API'
      );
    }
  }
  if (!documents.some((doc) => doc.citations?.enabled)) return;
  if (documents.some((doc) => doc.citations?.enabled !== true)) {
    throw new Error(
      'Anthropic citations must be enabled on all documents in the request or none'
    );
  }
  if (request.responseFormat?.type === 'json_schema') {
    throw new Error(
      'Anthropic document citations cannot be combined with native structured outputs (output_config.format); use a text signature without .useStructured()'
    );
  }
}

/** @internal */
export function createAnthropicDocument(
  doc: AxDocumentInput
): AxAIAnthropicDocumentBlock {
  validateDocumentInput(doc);
  let source: AxAIAnthropicDocumentBlock['source'];
  switch (doc.source.type) {
    case 'text':
      source = {
        type: 'text',
        media_type: 'text/plain',
        data: doc.source.data,
      };
      break;
    case 'base64':
      source = {
        type: 'base64',
        media_type: doc.source.mediaType,
        data: doc.source.data,
      };
      break;
    case 'file':
      source = { type: 'file', file_id: doc.source.fileId };
      break;
    case 'url':
      source = { type: 'url', url: doc.source.url };
      break;
    case 'content':
      source = {
        type: 'content',
        content: doc.source.content.map((block) => ({
          type: 'text',
          text: block.text,
        })),
      };
      break;
  }
  return {
    type: 'document',
    source,
    ...(doc.title !== undefined ? { title: doc.title } : {}),
    ...(doc.context !== undefined ? { context: doc.context } : {}),
    ...(doc.citations !== undefined
      ? { citations: { enabled: doc.citations.enabled } }
      : {}),
    ...(doc.cache ? { cache_control: { type: 'ephemeral' } } : {}),
  };
}
