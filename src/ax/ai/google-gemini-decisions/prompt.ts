import { axAudioMimeType } from '../audio/util.js';
import type { AxInternalChatRequest } from '../types.js';
import type {
  AxAIGoogleGeminiDecisionContent,
  AxAIGoogleGeminiDecisionMedia,
} from './types.js';

/** @internal Serialize turns as text; the native endpoint has no conversation roles. */
export function decisionsPrompt(
  req: Readonly<AxInternalChatRequest<string>>
): AxAIGoogleGeminiDecisionContent[] {
  const input: AxAIGoogleGeminiDecisionContent[] = [];
  const media = (
    type: AxAIGoogleGeminiDecisionMedia['type'],
    mime: string,
    data: string,
    uri = false,
    resolution?: AxAIGoogleGeminiDecisionMedia['resolution']
  ): void => {
    let value = data;
    if (!uri && data.startsWith('data:')) {
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(data);
      if (!match || match[1] !== mime)
        throw new Error('Google Gemini Decisions: invalid media data URL');
      value = match[2]!;
    }
    input.push({
      type,
      mime_type: mime,
      ...(resolution ? { resolution } : {}),
      ...(uri ? { uri: value } : { data: value }),
    });
  };
  for (const message of req.chatPrompt) {
    if (
      message.role === 'function' ||
      (message.role === 'assistant' &&
        (message.functionCalls?.length ||
          message.audio ||
          message.images?.length))
    )
      throw new Error(
        'Google Gemini Decisions does not support tool or media history'
      );
    input.push({ type: 'text', text: `\n${message.role}:\n` });
    if (typeof message.content === 'string')
      input.push({ type: 'text', text: `${message.content}\n` });
    else if (message.role === 'user') {
      for (const part of message.content) {
        if (part.type === 'text') input.push({ type: 'text', text: part.text });
        else if (part.type === 'image')
          media(
            'image',
            part.mimeType,
            part.image,
            part.image.startsWith('https://'),
            part.details === 'auto' ? undefined : part.details
          );
        else if (part.type === 'audio') {
          if (!part.mimeType && !part.format)
            throw new Error(
              'Google Gemini Decisions requires an audio MIME type or format'
            );
          media(
            'audio',
            part.mimeType ?? axAudioMimeType(part.format, part.sampleRate),
            part.data
          );
        } else if (part.type === 'file') {
          const type = part.mimeType.startsWith('video/')
            ? 'video'
            : part.mimeType.startsWith('audio/')
              ? 'audio'
              : part.mimeType.startsWith('image/')
                ? 'image'
                : 'document';
          media(
            type,
            part.mimeType,
            'fileUri' in part ? part.fileUri : part.data,
            'fileUri' in part
          );
        } else
          throw new Error(
            'Google Gemini Decisions supports text, images, audio, video and PDF files; URL context is unsupported'
          );
      }
    }
  }
  return input;
}
