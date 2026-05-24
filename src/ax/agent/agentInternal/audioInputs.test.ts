import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../../ai/mock/api.js';
import { AxSignature } from '../../dsp/sig.js';
import {
  transcribeAgentAudioInputs,
  transcribedAgentInputFields,
} from './audioInputs.js';

describe('agent audio inputs', () => {
  it('transcribes top-level audio inputs before agent stages', async () => {
    const ai = new AxMockAIService({
      transcribeResponse: (req) => ({
        text: `transcribed ${req.audio.format ?? 'audio'}`,
      }),
    });
    const sig = new AxSignature(
      'recording:audio, question:string -> answer:string'
    );

    const values = await transcribeAgentAudioInputs(
      ai,
      sig,
      {
        recording: { data: 'UklGRg==', format: 'wav' },
        question: 'What did I say?',
      },
      { speech: { transcribe: { model: 'whisper-large-v3-turbo' } } }
    );

    expect(values).toEqual({
      recording: 'transcribed wav',
      question: 'What did I say?',
    });
  });

  it('converts agent stage audio fields to strings', () => {
    const sig = new AxSignature('recording:audio -> answer:string');
    const fields = transcribedAgentInputFields(sig.getInputFields());

    expect(fields[0]?.type?.name).toBe('string');
    expect(fields[0]?.description).toContain('transcribed from audio');
  });
});
