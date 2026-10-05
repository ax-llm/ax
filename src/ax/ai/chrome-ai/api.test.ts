import { describe, expect, it, vi } from 'vitest';

import { ai } from '../wrap.js';

import {
  AxAIChromeAI,
  axAIChromeAICreativeConfig,
  axAIChromeAIDefaultConfig,
} from './api.js';
import {
  AxAIChromeAIModel,
  type ChromeAILanguageModel,
  type ChromeAISession,
} from './types.js';

const createMockSession = (
  overrides: Partial<ChromeAISession> = {}
): ChromeAISession => ({
  prompt: vi.fn().mockResolvedValue('Hello from Chrome AI'),
  promptStreaming: vi.fn().mockReturnValue(
    new ReadableStream<string>({
      start(controller) {
        controller.enqueue('Hello');
        controller.enqueue(' world');
        controller.close();
      },
    })
  ),
  destroy: vi.fn(),
  ...overrides,
});

const createMockLanguageModel = (
  session: ChromeAISession = createMockSession(),
  availability = 'available'
): ChromeAILanguageModel => ({
  availability: vi.fn().mockResolvedValue(availability),
  create: vi.fn().mockResolvedValue(session),
});

describe('AxAIChromeAI', () => {
  it('uses default config with Gemini Nano', () => {
    const config = axAIChromeAIDefaultConfig();
    expect(config.model).toBe(AxAIChromeAIModel.GeminiNano);
  });

  it('uses creative config with Gemini Nano', () => {
    const config = axAIChromeAICreativeConfig();
    expect(config.model).toBe(AxAIChromeAIModel.GeminiNano);
  });

  it('executes a basic chat completion with supplied languageModel', async () => {
    const session = createMockSession({
      prompt: vi.fn().mockResolvedValue('Paris is the capital of France.'),
    });
    const lm = createMockLanguageModel(session);

    const client = ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { model: AxAIChromeAIModel.GeminiNano, stream: false },
    });

    const response = await client.chat({
      chatPrompt: [{ role: 'user', content: 'What is the capital of France?' }],
    });

    expect(lm.create).toHaveBeenCalled();
    expect(session.prompt).toHaveBeenCalledWith(
      'What is the capital of France?',
      undefined
    );
    expect(response.results[0]?.content).toBe(
      'Paris is the capital of France.'
    );
    expect(session.destroy).toHaveBeenCalled();
    expect(client.getLastUsedChatModel()).toBe(AxAIChromeAIModel.GeminiNano);
  });

  it('correctly maps multi-turn conversation messages to initialPrompts', async () => {
    const session = createMockSession();
    const lm = createMockLanguageModel(session);

    const client = ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { stream: false },
    });

    await client.chat({
      chatPrompt: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'What is 2+2?' },
      ],
    });

    expect(lm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompts: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello! How can I help?' },
        ],
      })
    );
    expect(session.prompt).toHaveBeenCalledWith('What is 2+2?', undefined);
  });

  it('supports structured output via responseConstraint', async () => {
    const expectedJson = '{"answer": 4}';
    const session = createMockSession({
      prompt: vi.fn().mockResolvedValue(expectedJson),
    });
    const lm = createMockLanguageModel(session);

    const client = ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { stream: false },
    });

    const schema = {
      type: 'object',
      properties: { answer: { type: 'number' } },
      required: ['answer'],
    };

    const response = await client.chat({
      chatPrompt: [{ role: 'user', content: 'What is 2+2 in JSON?' }],
      responseFormat: {
        type: 'json_schema',
        schema,
      },
    });

    expect(session.prompt).toHaveBeenCalledWith(
      'What is 2+2 in JSON?',
      expect.objectContaining({
        responseConstraint: schema,
      })
    );
    expect(response.results[0]?.content).toBe(expectedJson);
  });

  it('supports streaming completions with successive chunks', async () => {
    const session = createMockSession({
      promptStreaming: vi.fn().mockReturnValue(
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue('Thinking');
            controller.enqueue(' about');
            controller.enqueue(' it: 42');
            controller.close();
          },
        })
      ),
    });
    const lm = createMockLanguageModel(session);

    const client = ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { stream: true },
    });

    const stream = (await client.chat({
      chatPrompt: [{ role: 'user', content: 'Answer with streaming' }],
      modelConfig: { stream: true },
    })) as ReadableStream<any>;

    const reader = stream.getReader();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = value.results[0]?.content;
      if (text) {
        chunks.push(text);
      }
    }

    expect(chunks).toEqual(['Thinking', ' about', ' it: 42']);
    expect(session.destroy).toHaveBeenCalled();
  });

  it('degrades multimodal content parts into text', async () => {
    const session = createMockSession();
    const lm = createMockLanguageModel(session);

    const client = ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { stream: false },
    });

    await client.chat({
      chatPrompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this: ' },
            {
              type: 'image',
              mimeType: 'image/png',
              image: 'base64...',
              altText: 'A chart of sales',
            },
          ],
        },
      ],
    });

    expect(session.prompt).toHaveBeenCalledWith(
      'Analyze this: \nA chart of sales',
      undefined
    );
  });

  it('throws informative error when Chrome AI model is unavailable', async () => {
    const lm: ChromeAILanguageModel = {
      availability: vi.fn().mockResolvedValue('unavailable'),
      create: vi.fn(),
    };

    const client = ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { stream: false },
    });

    await expect(
      client.chat({ chatPrompt: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(
      'Chrome built-in AI model is not available on this device'
    );
  });

  it('throws informative error when LanguageModel is not in global scope', async () => {
    const client = new AxAIChromeAI();

    await expect(
      client.chat({ chatPrompt: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow('Chrome built-in AI (LanguageModel) is not available');
  });

  it('reports correct capabilities in getFeatures()', () => {
    const client = new AxAIChromeAI();
    const features = client.getFeatures();

    expect(features.functions).toBe(false);
    expect(features.streaming).toBe(true);
    expect(features.structuredOutputs).toBe(true);
    expect(features.structuredOutputModes).toEqual(['native']);
    expect(features.multiTurn).toBe(true);
    expect(features.thinking).toBe(false);
  });

  it('supports custom model ids', async () => {
    const session = createMockSession();
    const lm = createMockLanguageModel(session);

    const client = ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { model: 'gemini-nano-experimental', stream: false },
    });

    await client.chat({ chatPrompt: [{ role: 'user', content: 'Hi' }] });
    expect(client.getLastUsedChatModel()).toBe('gemini-nano-experimental');
  });
});

// Browser contract regressions: these mocks enforce rules the permissive basic
// mocks above do not enforce.
describe('Chrome Prompt API contract', () => {
  const request = { chatPrompt: [{ role: 'user' as const, content: 'Hello' }] };

  it('omits both sampling parameters by default', async () => {
    const session = createMockSession();
    const lm = createMockLanguageModel(session);
    lm.create = vi.fn(async (options) => {
      expect(options).not.toHaveProperty('temperature');
      expect(options).not.toHaveProperty('topK');
      return session;
    });
    await ai({ name: 'chrome-ai', languageModel: lm }).chat(request, {
      stream: false,
    });
  });

  it.each([
    [{ temperature: 0.2 }, { temperature: 0.2, topK: 3 }],
    [{ topK: 8 }, { temperature: 1, topK: 8 }],
  ])(
    'completes a partial sampling pair from extension defaults: %j',
    async (config, expected) => {
      const lm = createMockLanguageModel();
      lm.params = vi.fn(async () => ({
        defaultTemperature: 1,
        maxTemperature: 2,
        defaultTopK: 3,
        maxTopK: 128,
      }));
      await ai({ name: 'chrome-ai', languageModel: lm, config }).chat(request, {
        stream: false,
      });
      expect(lm.create).toHaveBeenCalledWith(expect.objectContaining(expected));
    }
  );

  it('preserves an explicit sampling pair without params()', async () => {
    const lm = createMockLanguageModel();
    await ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: { temperature: 0, topK: 1 },
    }).chat(request, { stream: false });
    expect(lm.create).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0, topK: 1 })
    );
  });

  it.each([undefined, async () => null])(
    'rejects an incomplete sampling pair when extension defaults are unavailable',
    async (params) => {
      const lm = createMockLanguageModel();
      lm.params = params;
      await expect(
        ai({
          name: 'chrome-ai',
          languageModel: lm,
          config: { temperature: 0.2 },
        }).chat(request, { stream: false })
      ).rejects.toThrow('requires both temperature and topK');
      expect(lm.create).not.toHaveBeenCalled();
    }
  );

  it('uses extension defaults with the creative preset', async () => {
    const lm = createMockLanguageModel();
    lm.params = async () => ({
      defaultTemperature: 1,
      maxTemperature: 2,
      defaultTopK: 3,
      maxTopK: 128,
    });
    await ai({
      name: 'chrome-ai',
      languageModel: lm,
      config: axAIChromeAICreativeConfig(),
    }).chat(request, { stream: false });
    expect(lm.create).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.4, topK: 3 })
    );
  });

  it.each(['readable', 'iterable'])(
    'preserves repeated and prefix-overlapping deltas from a %s stream',
    async (kind) => {
      const session = createMockSession({
        promptStreaming: () =>
          kind === 'readable'
            ? new ReadableStream<string>({
                start(c) {
                  for (const chunk of ['yes ', 'yes ', 'yes please', '!'])
                    c.enqueue(chunk);
                  c.close();
                },
              })
            : {
                async *[Symbol.asyncIterator]() {
                  yield* ['yes ', 'yes ', 'yes please', '!'];
                },
              },
      });
      const stream = await ai({
        name: 'chrome-ai',
        languageModel: createMockLanguageModel(session),
      }).chat(request, { stream: true });
      let text = '';
      for await (const chunk of stream) text += chunk.results[0]?.content ?? '';
      expect(text).toBe('yes yes yes please!');
      expect(session.destroy).toHaveBeenCalledTimes(1);
    }
  );

  it('cleans up when starting a stream throws synchronously', async () => {
    const session = createMockSession({
      promptStreaming: () => {
        throw new DOMException('Aborted', 'AbortError');
      },
    });
    await expect(
      ai({
        name: 'chrome-ai',
        languageModel: createMockLanguageModel(session),
      }).chat(request, { stream: true })
    ).rejects.toThrow('Aborted');
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('cleans up when the underlying stream fails', async () => {
    const session = createMockSession({
      promptStreaming: () =>
        new ReadableStream({
          pull(c) {
            c.error(new Error('generation failed'));
          },
        }),
    });
    const stream = await ai({
      name: 'chrome-ai',
      languageModel: createMockLanguageModel(session),
    }).chat(request, { stream: true });
    await expect(stream.getReader().read()).rejects.toThrow(
      'generation failed'
    );
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('cleans up on stream cancellation', async () => {
    const session = createMockSession({
      promptStreaming: () => new ReadableStream({ pull() {} }),
    });
    const stream = await ai({
      name: 'chrome-ai',
      languageModel: createMockLanguageModel(session),
    }).chat(request, { stream: true });
    await stream.cancel();
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('cleans up when a non-streaming prompt rejects', async () => {
    const session = createMockSession({
      prompt: vi.fn().mockRejectedValue(new Error('generation failed')),
    });
    await expect(
      ai({
        name: 'chrome-ai',
        languageModel: createMockLanguageModel(session),
      }).chat(request, { stream: false })
    ).rejects.toThrow('generation failed');
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });
});
