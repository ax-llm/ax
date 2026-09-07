import { describe, expect, it } from 'vitest';

import type { AxChatResponseResult } from '../types.js';
import { ai } from '../wrap.js';
import { AxAIMetaModel } from './types.js';

const audio = { data: 'AAE=', format: 'pcm16' as const };

function voiceSocket(events: object[]) {
  return class VoiceSocket {
    static instance: VoiceSocket;
    sent: (string | Uint8Array)[] = [];
    listeners = new Map<string, (event: unknown) => void>();
    constructor() {
      VoiceSocket.instance = this;
      queueMicrotask(() => this.listeners.get('open')?.({}));
    }
    addEventListener(type: string, callback: (event: unknown) => void) {
      this.listeners.set(type, callback);
    }
    send(data: string | Uint8Array) {
      this.sent.push(data);
      if (this.sent.length === 1) {
        queueMicrotask(() => this.message({ sessionId: 'voice' }));
      } else if (data instanceof Uint8Array && this.sent.length === 2) {
        for (const event of events) this.message(event);
      } else if (data === '{"type":"endStream"}') {
        queueMicrotask(() => this.listeners.get('close')?.({ code: 1000 }));
      }
    }
    message(value: object) {
      this.listeners.get('message')?.({ data: JSON.stringify(value) });
    }
    close() {}
  };
}

describe('Meta Voice transcript contract', () => {
  it('uses sample rate and channel metadata from the audio item', async () => {
    const Socket = voiceSocket([]);
    const service = ai({
      name: 'meta',
      apiKey: 'test',
      config: { model: AxAIMetaModel.MuseVoiceTranscribe10 },
      options: { webSocket: Socket },
    });
    const stream = await service.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'audio', ...audio, sampleRate: 16000, channels: 1 },
            ],
          },
        ],
      },
      { stream: true }
    );
    for await (const _ of stream) {
    }
    expect(JSON.parse(String(Socket.instance.sent[0])).audioEncoding).toBe(
      'PCM_16KHZ'
    );
  });

  it.each([
    { channels: 2, sampleRate: 16000, expected: 'requires mono audio' },
    {
      channels: 1,
      sampleRate: 8000,
      expected: 'requires 16000 Hz or 24000 Hz audio',
    },
  ])(
    'rejects unsupported item metadata: $channels channels at $sampleRate Hz',
    async ({ channels, sampleRate, expected }) => {
      const service = ai({
        name: 'meta',
        apiKey: 'test',
        config: { model: AxAIMetaModel.MuseVoiceTranscribe10 },
        options: { webSocket: voiceSocket([]) },
      });
      await expect(
        (async () => {
          const stream = await service.chat(
            {
              chatPrompt: [
                {
                  role: 'user',
                  content: [{ type: 'audio', ...audio, channels, sampleRate }],
                },
              ],
            },
            { stream: true }
          );
          for await (const _ of stream) {
          }
        })()
      ).rejects.toThrow(expected);
    }
  );

  it('rejects a normal close before the recording has been uploaded', async () => {
    const BaseSocket = voiceSocket([]);
    class EarlyCloseSocket extends BaseSocket {
      override send(data: string | Uint8Array) {
        super.send(data);
        if (data instanceof Uint8Array)
          queueMicrotask(() => this.listeners.get('close')?.({ code: 1000 }));
      }
    }
    const service = ai({
      name: 'meta',
      apiKey: 'test',
      config: { model: AxAIMetaModel.MuseVoiceTranscribe10 },
      options: { webSocket: EarlyCloseSocket },
    });
    await expect(
      (async () => {
        const stream = await service.chat(
          {
            chatPrompt: [
              {
                role: 'user',
                content: [
                  {
                    type: 'audio',
                    format: 'pcm16',
                    data: Buffer.alloc(9600).toString('base64'),
                  },
                ],
              },
            ],
          },
          { stream: true }
        );
        for await (const _ of stream) {
        }
      })()
    ).rejects.toThrow('closed');
  });

  it.each(['cumulative', 'delta'] as const)(
    'finalizes %s hypotheses exactly once',
    async (partialMode) => {
      const events =
        partialMode === 'cumulative'
          ? [
              { type: 'transcript', transcript: 'I scream', final: false },
              { type: 'transcript', transcript: 'Ice cream', final: false },
              { type: 'transcript', transcript: 'Ice cream.', final: true },
            ]
          : [
              { type: 'transcript', transcript: 'Ice', final: false },
              { type: 'transcript', transcript: ' cream', final: false },
              { type: 'transcript', transcript: 'Ice cream.', final: true },
            ];
      const service = ai({
        name: 'meta',
        apiKey: 'test',
        config: {
          model: AxAIMetaModel.MuseVoiceTranscribe10,
          realtimeTranscription: { partialMode },
        },
        options: { webSocket: voiceSocket(events) },
      });
      const stream = await service.chat(
        {
          chatPrompt: [
            { role: 'user', content: [{ type: 'audio', ...audio }] },
          ],
        },
        { stream: true }
      );
      const results: AxChatResponseResult[] = [];
      for await (const chunk of stream) results.push(...chunk.results);
      expect(results.map((x) => x.content ?? '').join('')).toBe('Ice cream.');
      expect(
        results
          .filter((x) => x.transcript && !x.transcript.isFinal)
          .map((x) => x.transcript?.text)
      ).toEqual(
        partialMode === 'cumulative'
          ? ['I scream', 'Ice cream']
          : ['Ice', 'Ice cream']
      );
    }
  );

  it('emits corrected overlapping turns in start order while receiving during upload', async () => {
    const Socket = voiceSocket([
      { type: 'speechStart', turnId: 'first', audioProcessedMs: 100 },
      { type: 'transcript', transcript: 'wrong hypothesis' },
      { type: 'speechStart', turnId: 'second', audioProcessedMs: 200 },
      { type: 'speechComplete', turnId: 'second', transcript: 'Second.' },
      { type: 'speechComplete', turnId: 'first', transcript: 'First.' },
    ]);
    const service = ai({
      name: 'meta',
      apiKey: 'test',
      config: { model: AxAIMetaModel.MuseVoiceTranscribe10 },
      options: { webSocket: Socket },
    });
    const stream = await service.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              {
                type: 'audio',
                data: Buffer.alloc(9600).toString('base64'),
                format: 'pcm16',
              },
            ],
          },
        ],
      },
      { stream: true }
    );
    const results: AxChatResponseResult[] = [];
    for await (const chunk of stream) {
      results.push(...chunk.results);
      if (
        chunk.results.some((x) => x.transcript?.text === 'wrong hypothesis')
      ) {
        expect(Socket.instance.sent).not.toContain('{"type":"endStream"}');
      }
    }
    expect(
      results.filter((x) => x.content).map((x) => [x.id, x.content])
    ).toEqual([
      ['first', 'First.'],
      ['second', 'Second.'],
    ]);
  });

  it.each(['delta', 'cumulative'] as const)(
    'replaces the complete final batch transcript in %s mode',
    async (partialMode) => {
      const events = [
        { type: 'transcript', transcript: 'Hello', final: false },
        {
          type: 'transcript',
          transcript: partialMode === 'delta' ? ' world' : 'Hello world',
          final: false,
        },
        { type: 'transcript', transcript: 'Hello world.', final: true },
      ];
      const service = ai({
        name: 'meta',
        apiKey: 'test',
        options: {
          fetch: async () =>
            new Response(
              events.map((x) => `data: ${JSON.stringify(x)}\n\n`).join(''),
              { headers: { 'Content-Type': 'text/event-stream' } }
            ),
        },
      });
      const response = await service.transcribe({
        audio: { ...audio, format: 'wav' },
        mode: 'push_to_talk',
        partialMode,
      });
      expect(response.text).toBe('Hello world.');
      expect(response.segments?.[0]?.text).toBe('Hello world.');
    }
  );
});
