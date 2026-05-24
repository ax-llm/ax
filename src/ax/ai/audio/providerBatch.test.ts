import { describe, expect, it, vi } from 'vitest';
import { AxMediaNotSupportedError } from '../../util/apicall.js';
import { AxAIAnthropic } from '../anthropic/api.js';
import { AxAIGoogleGemini } from '../google-gemini/api.js';
import { AxAIGroq } from '../groq/api.js';
import { AxAIMistral } from '../mistral/api.js';
import { AxAITogether } from '../together/api.js';
import { AxAIGrok } from '../x-grok/api.js';

const audio = { data: 'AAAA', format: 'wav' as const };

type CapturedRequest = {
  url: string;
  body?: BodyInit | null;
  json?: any;
};

const createFetch = (response: () => Response, captured: CapturedRequest[]) =>
  vi
    .fn()
    .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const item: CapturedRequest = {
        url: String(url),
        body: init?.body,
      };
      if (typeof init?.body === 'string') {
        item.json = JSON.parse(init.body);
      }
      captured.push(item);
      return response();
    });

const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const audioResponse = (mimeType = 'audio/mpeg') =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'Content-Type': mimeType },
  });

describe('batch audio provider request mapping', () => {
  it('maps Groq transcription and speech defaults', async () => {
    const transcriptionCalls: CapturedRequest[] = [];
    const transcriptionFetch = createFetch(
      () => jsonResponse({ text: 'groq transcript' }),
      transcriptionCalls
    );
    const groq = new AxAIGroq({
      apiKey: 'key',
      options: { fetch: transcriptionFetch },
    });

    await groq.transcribe({ audio });

    expect(transcriptionCalls[0]?.url).toBe(
      'https://api.groq.com/openai/v1/audio/transcriptions'
    );
    const form = transcriptionCalls[0]?.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('response_format')).toBe('json');

    const speechCalls: CapturedRequest[] = [];
    groq.setOptions({
      fetch: createFetch(() => audioResponse('audio/wav'), speechCalls),
    });

    const speech = await groq.speak({ text: 'hello' });

    expect(speechCalls[0]?.url).toBe(
      'https://api.groq.com/openai/v1/audio/speech'
    );
    expect(speechCalls[0]?.json).toMatchObject({
      model: 'canopylabs/orpheus-v1-english',
      input: 'hello',
      voice: 'troy',
      response_format: 'wav',
    });
    expect(speech.format).toBe('wav');
  });

  it('maps Together transcription and speech defaults', async () => {
    const transcriptionCalls: CapturedRequest[] = [];
    const together = new AxAITogether({
      apiKey: 'key',
      options: {
        fetch: createFetch(
          () => jsonResponse({ text: 'together transcript' }),
          transcriptionCalls
        ),
      },
    });

    await together.transcribe({ audio });

    expect(transcriptionCalls[0]?.url).toBe(
      'https://api.together.xyz/v1/audio/transcriptions'
    );
    expect((transcriptionCalls[0]?.body as FormData).get('model')).toBe(
      'openai/whisper-large-v3'
    );

    const speechCalls: CapturedRequest[] = [];
    together.setOptions({
      fetch: createFetch(() => audioResponse(), speechCalls),
    });

    await together.speak({ text: 'hi' });

    expect(speechCalls[0]?.url).toBe(
      'https://api.together.xyz/v1/audio/speech'
    );
    expect(speechCalls[0]?.json).toMatchObject({
      model: 'canopylabs/orpheus-3b-0.1-ft',
      input: 'hi',
      voice: 'tara',
      response_format: 'mp3',
    });
  });

  it('maps Mistral Voxtral transcription and speech requests', async () => {
    const transcriptionCalls: CapturedRequest[] = [];
    const mistral = new AxAIMistral({
      apiKey: 'key',
      options: {
        fetch: createFetch(
          () => jsonResponse({ text: 'mistral transcript' }),
          transcriptionCalls
        ),
      },
    });

    await mistral.transcribe({ audio });

    expect(transcriptionCalls[0]?.url).toBe(
      'https://api.mistral.ai/v1/audio/transcriptions'
    );
    expect((transcriptionCalls[0]?.body as FormData).get('model')).toBe(
      'voxtral-mini-latest'
    );

    const speechCalls: CapturedRequest[] = [];
    mistral.setOptions({
      fetch: createFetch(() => audioResponse(), speechCalls),
    });

    await mistral.speak({ text: 'bonjour', voice: 'voice-a' });

    expect(speechCalls[0]?.url).toBe('https://api.mistral.ai/v1/audio/speech');
    expect(speechCalls[0]?.json).toMatchObject({
      model: 'voxtral-mini-tts-2603',
      input: 'bonjour',
      voice_id: 'voice-a',
      response_format: 'mp3',
    });
  });

  it('maps xAI STT and TTS requests', async () => {
    const sttCalls: CapturedRequest[] = [];
    const grok = new AxAIGrok({
      apiKey: 'key',
      options: {
        fetch: createFetch(
          () => jsonResponse({ text: 'xai transcript' }),
          sttCalls
        ),
      },
    });

    await grok.transcribe({
      audio,
      language: 'en',
      prompt: 'product names',
    });

    expect(sttCalls[0]?.url).toBe('https://api.x.ai/v1/stt');
    const form = sttCalls[0]?.body as FormData;
    expect(form.get('language')).toBe('en');
    expect(form.get('keyterm')).toBe('product names');
    expect(form.get('format')).toBe('true');
    expect(form.get('model')).toBeNull();

    const ttsCalls: CapturedRequest[] = [];
    grok.setOptions({
      fetch: createFetch(() => audioResponse('audio/basic'), ttsCalls),
    });

    await grok.speak({
      text: 'hello',
      voice: 'eve',
      format: 'ulaw',
      sampleRate: 8000,
      language: 'en',
    });

    expect(ttsCalls[0]?.url).toBe('https://api.x.ai/v1/tts');
    expect(ttsCalls[0]?.json).toMatchObject({
      text: 'hello',
      voice_id: 'eve',
      language: 'en',
      output_format: {
        codec: 'mulaw',
        sample_rate: 8000,
      },
    });
  });

  it('maps Gemini audio through generateContent', async () => {
    const transcriptionCalls: CapturedRequest[] = [];
    const gemini = new AxAIGoogleGemini({
      apiKey: 'key',
      options: {
        fetch: createFetch(
          () =>
            jsonResponse({
              candidates: [
                { content: { parts: [{ text: 'gemini transcript' }] } },
              ],
            }),
          transcriptionCalls
        ),
      },
    });

    const transcript = await gemini.transcribe({
      audio,
      prompt: 'transcribe this',
    });

    expect(transcript.text).toBe('gemini transcript');
    expect(transcriptionCalls[0]?.url).toContain(
      '/models/gemini-2.5-flash:generateContent?key=key'
    );
    expect(transcriptionCalls[0]?.json.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: 'audio/wav', data: 'AAAA' },
    });
    expect(transcriptionCalls[0]?.json.contents[0].parts[1]).toEqual({
      text: 'transcribe this',
    });

    const speechCalls: CapturedRequest[] = [];
    gemini.setOptions({
      fetch: createFetch(
        () =>
          jsonResponse({
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { mimeType: 'audio/wav', data: 'QUJD' } },
                  ],
                },
              },
            ],
          }),
        speechCalls
      ),
    });

    const speech = await gemini.speak({ text: 'hello', voice: 'Kore' });

    expect(speech.data).toBe('QUJD');
    expect(speechCalls[0]?.url).toContain(
      '/models/gemini-2.5-flash-preview-tts:generateContent?key=key'
    );
    expect(speechCalls[0]?.json.generationConfig).toMatchObject({
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    });
  });

  it('throws a media error for providers without batch audio', async () => {
    const anthropic = new AxAIAnthropic({ apiKey: 'key' });

    await expect(anthropic.transcribe({ audio })).rejects.toThrow(
      AxMediaNotSupportedError
    );
    await expect(anthropic.speak({ text: 'hello' })).rejects.toThrow(
      AxMediaNotSupportedError
    );
  });
});
