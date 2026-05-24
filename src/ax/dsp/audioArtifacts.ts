import type {
  AxAIService,
  AxChatAudioOutput,
  AxSpeechRequest,
} from '../ai/types.js';
import type { AxField, AxSignature } from './sig.js';
import type { AxGenOut, AxProgramForwardOptions } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isRenderedAudioArtifact = (value: unknown): value is AxChatAudioOutput =>
  isRecord(value) &&
  (typeof value.data === 'string' || typeof value.id === 'string');

const audioOutputFields = (
  signature: Readonly<AxSignature>
): readonly AxField[] =>
  signature
    .getOutputFields()
    .filter(
      (field) => field.type?.name === 'audio' && field.type?.isArray !== true
    );

export const hasAudioOutputFields = (
  signature: Readonly<AxSignature>
): boolean => audioOutputFields(signature).length > 0;

export async function renderAudioOutputArtifacts<OUT extends AxGenOut>(
  ai: Readonly<AxAIService>,
  signature: Readonly<AxSignature>,
  values: Readonly<OUT>,
  options?: Readonly<AxProgramForwardOptions<any>>
): Promise<OUT> {
  const fields = audioOutputFields(signature);
  if (fields.length === 0) {
    return values as OUT;
  }

  const speech = options?.speech;
  let rendered: Record<string, unknown> | undefined;

  for (const field of fields) {
    const value = (values as Record<string, unknown>)[field.name];
    if (
      value === undefined ||
      value === null ||
      isRenderedAudioArtifact(value)
    ) {
      continue;
    }

    if (typeof value !== 'string') {
      continue;
    }

    const request: AxSpeechRequest<any> = {
      ...(speech?.speak ?? {}),
      ...(speech?.fields?.[field.name] ?? {}),
      text: value,
    };
    const audio = await ai.speak(request, options);
    rendered ??= { ...(values as Record<string, unknown>) };
    rendered[field.name] = {
      ...audio,
      transcript: audio.transcript ?? value,
    };
  }

  return (rendered ?? values) as OUT;
}
