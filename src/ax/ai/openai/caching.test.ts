import { describe, expect, it, vi } from 'vitest';
import { AxAIOpenAIProfile } from '../provider_profiles.js';
import type { AxChatRequest } from '../types.js';
import { AxAIOpenAI } from './api.js';
import { AxAIOpenAIModel } from './chat_types.js';

const RESPONSE = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-5.6-luna',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok', refusal: null },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  system_fingerprint: 'fp',
};

function createMockFetch(capture: { bodies: any[] }) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body && typeof init.body === 'string') {
        capture.bodies.push(JSON.parse(init.body));
      }
      return new Response(JSON.stringify(RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

const createAI = (model: AxAIOpenAIModel, fetch: typeof globalThis.fetch) =>
  new AxAIOpenAI({
    apiKey: 'key',
    config: { model, stream: false },
    options: { fetch },
  });

/** Indices of messages carrying a breakpoint, and the block it sits on. */
const breakpoints = (body: any): Map<number, unknown> => {
  const found = new Map<number, unknown>();
  body.messages.forEach((msg: any, i: number) => {
    if (!Array.isArray(msg.content)) return;
    const marked = msg.content.filter((p: any) => p.prompt_cache_breakpoint);
    if (marked.length > 0) {
      expect(marked).toHaveLength(1);
      found.set(i, msg.content[msg.content.length - 1]);
    }
  });
  return found;
};

const cachedSystem = (text: string) =>
  ({ role: 'system', content: text, cache: true }) as const;

describe('OpenAI prompt cache breakpoints', () => {
  // The whole feature turns on this property. A marker is part of its content
  // block, so a marker that moves between turns changes the serialized prefix
  // and voids the entry the previous turn wrote. No single-request assertion
  // can catch that — only comparing a shorter prompt against a longer one.
  it('keeps every marker at the same index as the conversation grows', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    // Strictly append-only, matching how memory actually grows: turn 1's tail
    // survives into turn 2. That transition — an unmarked string at index k
    // becoming a widened, marked block at index k — is the trickiest
    // serialization change in the scheme, so it has to be the one under test.
    const turn1: AxChatRequest['chatPrompt'] = [
      cachedSystem('SYS'),
      { role: 'user', content: 'STABLE' },
      { role: 'assistant', content: 'turn 1' },
      { role: 'user', content: 'VOLATILE 1' },
    ];
    const turn2: AxChatRequest['chatPrompt'] = [
      ...turn1,
      { role: 'assistant', content: 'turn 2' },
      { role: 'user', content: 'VOLATILE 2' },
    ];

    await ai.chat({ chatPrompt: turn1 }, { sessionId: 's' });
    await ai.chat({ chatPrompt: turn2 }, { sessionId: 's' });

    const [short, long] = capture.bodies.map(breakpoints);
    expect(short!.size).toBeGreaterThan(0);

    for (const [index, block] of short!) {
      expect(
        long!.has(index),
        `marker at index ${index} disappeared on the longer prompt`
      ).toBe(true);
      expect(long!.get(index)).toEqual(block);
    }
    // And the longer prompt marks strictly more, so cached_tokens can grow.
    expect(long!.size).toBeGreaterThan(short!.size);
  });

  it('widens string content and leaves the volatile tail unmarked', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat(
      {
        chatPrompt: [
          cachedSystem('SYS'),
          { role: 'assistant', content: 'a', functionCalls: [] },
          { role: 'function', functionId: 'f1', result: 'RESULT' },
          { role: 'user', content: 'VOLATILE' },
        ],
      },
      { sessionId: 's' }
    );

    const [body] = capture.bodies;
    expect(body.messages[0].content).toEqual([
      {
        type: 'text',
        text: 'SYS',
        prompt_cache_breakpoint: { mode: 'explicit' },
      },
    ]);
    // Tool results widen too — the breakpoint has to sit on a block.
    expect(body.messages[2].content).toEqual([
      {
        type: 'text',
        text: 'RESULT',
        prompt_cache_breakpoint: { mode: 'explicit' },
      },
    ]);
    expect(body.messages[3].content).toBe('VOLATILE');
  });

  it('marks the tail only when the caller marked it explicitly', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat(
      {
        chatPrompt: [
          cachedSystem('SYS'),
          { role: 'user', content: 'TAIL', cache: true },
        ],
      },
      { sessionId: 's' }
    );

    expect(breakpoints(capture.bodies[0]).has(1)).toBe(true);
  });

  it('resolves prompt_cache_key from the option, then sessionId', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));
    const chatPrompt: AxChatRequest['chatPrompt'] = [
      cachedSystem('SYS'),
      { role: 'user', content: 'U' },
    ];

    await ai.chat({ chatPrompt }, { promptCacheKey: 'explicit-key' });
    await ai.chat({ chatPrompt }, { sessionId: 'session-key' });
    await ai.chat(
      { chatPrompt },
      { promptCacheKey: 'wins', sessionId: 'loses' }
    );

    expect(capture.bodies.map((b) => b.prompt_cache_key)).toEqual([
      'explicit-key',
      'session-key',
      'wins',
    ]);
    for (const body of capture.bodies) {
      expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
    }
  });

  it('still sends breakpoints when no cache key can be resolved', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat({
      chatPrompt: [cachedSystem('SYS'), { role: 'user', content: 'U' }],
    });

    const [body] = capture.bodies;
    expect(body.prompt_cache_key).toBeUndefined();
    expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
    expect(breakpoints(body).size).toBeGreaterThan(0);
  });

  it('enables on contextCache alone, with no cache flags', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat(
      {
        chatPrompt: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'U' },
        ],
      },
      { contextCache: {}, sessionId: 's' }
    );

    expect(breakpoints(capture.bodies[0]).size).toBeGreaterThan(0);
  });

  it('skips messages with no block to mark, without shifting other indices', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat(
      {
        chatPrompt: [
          cachedSystem('SYS'),
          {
            role: 'assistant',
            functionCalls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'f', params: '{}' },
              },
            ],
          },
          { role: 'function', functionId: 'c1', result: '' },
          { role: 'user', content: 'STABLE' },
          { role: 'user', content: 'VOLATILE' },
        ],
      },
      { sessionId: 's' }
    );

    const [body] = capture.bodies;
    const marked = breakpoints(body);
    // 1 is tool-calls-only and 2 is an empty result: neither has a block to
    // carry a marker, and widening '' would send an empty text block.
    expect([...marked.keys()]).toEqual([0, 3]);
    expect(body.messages[1].content).toBeUndefined();
    expect(body.messages[2].content).toBe('');
  });

  it('marks the trailing block of multipart content, leaving parts intact', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat(
      {
        chatPrompt: [
          cachedSystem('SYS'),
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe this' },
              {
                type: 'image',
                mimeType: 'image/png',
                image: 'aGVsbG8=',
              },
            ],
          },
          { role: 'user', content: 'VOLATILE' },
        ],
      },
      { sessionId: 's' }
    );

    const parts = capture.bodies[0].messages[1].content;
    expect(parts).toHaveLength(2);
    // Both parts survive, and only the trailing one carries the marker.
    expect(parts[0]).toEqual({ type: 'text', text: 'describe this' });
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url).toEqual({
      url: 'data:image/png;base64,aGVsbG8=',
      details: 'auto',
    });
    expect(parts[1].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
  });

  // The request is Readonly and callers reuse chatPrompt across turns, so
  // writing into it would corrupt the next turn's prefix.
  it('does not mutate the caller chatPrompt', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    const chatPrompt = [
      cachedSystem('SYS'),
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'hello' }],
      },
      { role: 'user' as const, content: 'VOLATILE' },
    ];
    const before = JSON.stringify(chatPrompt);
    Object.freeze(chatPrompt);
    for (const m of chatPrompt) {
      Object.freeze(m);
      if (Array.isArray(m.content)) m.content.forEach((p) => Object.freeze(p));
    }

    await ai.chat({ chatPrompt }, { sessionId: 's' });
    await ai.chat({ chatPrompt }, { sessionId: 's' });

    expect(JSON.stringify(chatPrompt)).toBe(before);
    // And the two requests serialize identically, so a reused prompt keeps
    // producing the same prefix.
    expect(JSON.stringify(capture.bodies[0].messages)).toBe(
      JSON.stringify(capture.bodies[1].messages)
    );
  });

  // Explicit mode with no breakpoints is worse than sending nothing: it also
  // throws away the implicit breakpoint.
  it('omits prompt_cache_options when no message could take a marker', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'only message' }] },
      { contextCache: {}, sessionId: 's' }
    );

    const [body] = capture.bodies;
    expect(body.prompt_cache_options).toBeUndefined();
    // The key still goes out — it helps implicit matching too.
    expect(body.prompt_cache_key).toBe('s');
    expect(body.messages[0].content).toBe('only message');
  });

  it('advertises caching only for the 5.6 family', () => {
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, globalThis.fetch);
    expect(ai.getFeatures(AxAIOpenAIModel.GPT56Luna).caching).toEqual({
      supported: true,
      types: ['ephemeral'],
      cacheBreakpoints: true,
    });
    expect(ai.getFeatures(AxAIOpenAIModel.GPT55).caching.supported).toBe(false);
  });
});

describe('OpenAI prompt caching stays off', () => {
  it('sends nothing on a pre-5.6 model even with cache flags set', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT55, createMockFetch(capture));

    await ai.chat(
      {
        chatPrompt: [cachedSystem('SYS'), { role: 'user', content: 'U' }],
      },
      { sessionId: 's', promptCacheKey: 'k' }
    );

    const [body] = capture.bodies;
    expect(body.prompt_cache_key).toBeUndefined();
    expect(body.prompt_cache_options).toBeUndefined();
    expect(body.messages[0].content).toBe('SYS');

    // The opt-in is per-model, not per-provider: contextCache on a pre-5.6
    // model keeps throwing exactly as it did before this feature existed.
    await expect(
      ai.chat(
        { chatPrompt: [{ role: 'user', content: 'U' }] },
        { contextCache: {} }
      )
    ).rejects.toThrow(/Context caching is not supported/);
  });

  // Forcing explicit mode onto 5.6 traffic that never asked for caching would
  // strip the implicit breakpoint those callers get for free today.
  it('sends nothing on a 5.6 model when caching was not requested', async () => {
    const capture = { bodies: [] as any[] };
    const ai = createAI(AxAIOpenAIModel.GPT56Luna, createMockFetch(capture));

    await ai.chat(
      {
        chatPrompt: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'U' },
        ],
      },
      { sessionId: 's', promptCacheKey: 'k' }
    );

    const [body] = capture.bodies;
    expect(body.prompt_cache_key).toBeUndefined();
    expect(body.prompt_cache_options).toBeUndefined();
    expect(body.messages[0].content).toBe('SYS');
  });

  // Azure shares this request builder and the same model enum, so the model
  // name alone must not be enough to opt a deployment in.
  it('sends nothing from Azure on a 5.6 deployment', async () => {
    const capture = { bodies: [] as any[] };
    const ai = new AxAIOpenAIProfile({
      name: 'azure-openai',
      apiKey: 'key',
      resourceName: 'https://example.openai.azure.com/',
      deploymentName: 'deployment',
      config: { model: AxAIOpenAIModel.GPT56Luna, stream: false },
      options: { fetch: createMockFetch(capture) },
    });

    await ai.chat(
      {
        chatPrompt: [cachedSystem('SYS'), { role: 'user', content: 'U' }],
      },
      { sessionId: 's' }
    );

    const [body] = capture.bodies;
    expect(body.prompt_cache_key).toBeUndefined();
    expect(body.prompt_cache_options).toBeUndefined();
    expect(body.messages[0].content).toBe('SYS');

    await expect(
      ai.chat(
        { chatPrompt: [{ role: 'user', content: 'U' }] },
        { contextCache: {} }
      )
    ).rejects.toThrow(/Context caching is not supported/);
  });
});
