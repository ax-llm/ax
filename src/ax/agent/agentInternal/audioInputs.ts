import type {
  AxAIService,
  AxAudioInput,
  AxTranscriptionRequest,
} from '../../ai/types.js';
import type { AxField, AxIField, AxSignature } from '../../dsp/sig.js';
import type { AxGenIn, AxProgramForwardOptions } from '../../dsp/types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAudioInput = (value: unknown): value is AxAudioInput =>
  isRecord(value) && typeof value.data === 'string';

export function transcribedAgentInputFields(
  fields: readonly AxIField[]
): AxIField[] {
  return fields.map((field) => {
    if (field.type?.name !== 'audio') {
      return field;
    }

    const suffix = field.type.isArray
      ? ' Each item is transcribed from an audio input before agent stages run.'
      : ' This field is transcribed from audio before agent stages run.';
    return {
      ...field,
      description: field.description
        ? `${field.description}${suffix}`
        : suffix.trim(),
      type: {
        ...field.type,
        name: 'string',
      },
    };
  });
}

async function transcribeSingleAudioInput(
  ai: Readonly<AxAIService>,
  audio: Readonly<AxAudioInput>,
  options?: Readonly<AxProgramForwardOptions<any>>
): Promise<string> {
  const request: AxTranscriptionRequest<any> = {
    ...(options?.speech?.transcribe ?? {}),
    audio,
  };
  const result = await ai.transcribe(request, options);
  return result.text;
}

export async function transcribeAgentAudioInputs<IN extends AxGenIn>(
  ai: Readonly<AxAIService>,
  signature: Readonly<AxSignature>,
  values: Readonly<IN>,
  options?: Readonly<AxProgramForwardOptions<any>>
): Promise<IN> {
  const audioFields = signature
    .getInputFields()
    .filter((field: AxField) => field.type?.name === 'audio');
  if (audioFields.length === 0) {
    return values as IN;
  }

  let nextValues: Record<string, unknown> | undefined;
  for (const field of audioFields) {
    const value = (values as Record<string, unknown>)[field.name];
    if (value === undefined || value === null || typeof value === 'string') {
      continue;
    }

    if (Array.isArray(value)) {
      const items = await Promise.all(
        value.map((item) =>
          isAudioInput(item)
            ? transcribeSingleAudioInput(ai, item, options)
            : Promise.resolve(item)
        )
      );
      nextValues ??= { ...(values as Record<string, unknown>) };
      nextValues[field.name] = items;
      continue;
    }

    if (!isAudioInput(value)) {
      continue;
    }

    nextValues ??= { ...(values as Record<string, unknown>) };
    nextValues[field.name] = await transcribeSingleAudioInput(
      ai,
      value,
      options
    );
  }

  return (nextValues ?? values) as IN;
}
