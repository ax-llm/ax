import { describe, expect, it } from 'vitest';

import {
  buildPromptMetrics,
  countChatPromptContentChars,
} from './promptMetrics.js';

describe('countChatPromptContentChars', () => {
  it('should count only text-bearing prompt content', () => {
    const chars = countChatPromptContentChars([
      { role: 'system', content: 'system prompt' },
      { role: 'assistant', content: 'assistant reply' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'user text' },
          { type: 'image', image: 'data:image/png;base64,abc' },
          { type: 'audio', data: 'audio-bytes', format: 'wav' },
          { type: 'file', data: 'file-bytes', mimeType: 'text/plain' },
        ],
      },
      {
        role: 'function',
        functionId: 'fn_1',
        function: { name: 'demo', arguments: '{}' },
        result: 'tool result',
      },
    ] as any);

    expect(chars).toBe(
      'system prompt'.length +
        'assistant reply'.length +
        'user text'.length +
        'tool result'.length
    );
  });

  it('should handle plain string user messages', () => {
    const chars = countChatPromptContentChars([
      { role: 'user', content: 'plain user text' },
    ] as any);

    expect(chars).toBe('plain user text'.length);
  });
});

describe('buildPromptMetrics', () => {
  it('should keep segmented prompt counts in sync with totals', () => {
    const metrics = buildPromptMetrics(100, 200, 300);

    expect(metrics).toEqual({
      systemPromptCharacters: 100,
      exampleChatContextCharacters: 200,
      mutableChatContextCharacters: 300,
      chatContextCharacters: 500,
      totalPromptCharacters: 600,
    });
  });
});
