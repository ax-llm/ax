import { randomUUID } from '../../util/crypto.js';
import type { AxInternalChatRequest } from '../types.js';
import type { AxAITypesafeImageAsset, AxAITypesafeRequest } from './types.js';

/** @internal The upstream image/Box API is experimental and requires this header. */
export function typesafeImageHeaders(
  request: AxAITypesafeRequest
): Record<string, string> {
  return Object.keys(request.assets ?? {}).length ||
    Object.values(request.questions).some((q) => q.type === 'box')
    ? { 'TypeSafe-Danger-Zone-Images': 'true' }
    : {};
}

/** @internal Keep image parts in prompt order and reference their assets unambiguously. */
export function typesafePrompt(
  req: Readonly<AxInternalChatRequest<string>>
): Pick<AxAITypesafeRequest, 'state' | 'assets'> {
  const assets: Record<string, AxAITypesafeImageAsset> = {};
  const messages = req.chatPrompt.map((message) => ({
    role: message.role,
    content:
      message.role === 'function'
        ? message.result
        : typeof message.content === 'string'
          ? message.content
          : message.role === 'user'
            ? message.content
                .map((part) => {
                  if (part.type === 'text') return part.text;
                  if (part.type !== 'image')
                    throw new Error(
                      'Typesafe supports text and inline PNG/JPEG images only'
                    );
                  const format = {
                    'image/png': 'png',
                    'image/jpeg': 'jpeg',
                    'image/jpg': 'jpg',
                  }[part.mimeType ?? ''];
                  if (!format)
                    throw new Error('Typesafe images must be PNG or JPEG');
                  let data = part.image;
                  if (data.startsWith('data:')) {
                    const match =
                      /^data:(image\/(?:png|jpeg|jpg));base64,(.*)$/.exec(data);
                    if (!match || match[1] !== part.mimeType)
                      throw new Error(
                        'Typesafe image data URL must match its MIME type'
                      );
                    data = match[2]!;
                  }
                  const reference = randomUUID();
                  assets[reference] = {
                    type: 'image',
                    format: format as AxAITypesafeImageAsset['format'],
                    data_base64: data,
                  };
                  return reference;
                })
                .join('\n')
            : '',
  }));
  return {
    state: { messages },
    ...(Object.keys(assets).length ? { assets } : {}),
  };
}
