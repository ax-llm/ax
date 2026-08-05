import { describe, expect, it, vi } from 'vitest';
import { ai } from '../ai/wrap.js';
import { ax } from './template.js';

const RESPONSE = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-5.6-luna',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Response Text: ok',
        refusal: null,
      },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  system_fingerprint: 'fp',
};

const capture = () => {
  const bodies: any[] = [];
  const fetch = vi
    .fn()
    .mockImplementation(async (_url: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  return { bodies, fetch: fetch as unknown as typeof globalThis.fetch };
};

// AxProgramForwardOptions extends AxAIServiceOptions, so promptCacheKey
// typechecks on forward(). generate.ts builds the ai.chat options field by
// field, so it has to be listed there explicitly or it is silently dropped —
// and the caller gets unreliable cache matching plus a misleading warning.
describe('promptCacheKey reaches the provider from forward()', () => {
  const makeAI = (fetch: typeof globalThis.fetch) =>
    ai({
      name: 'openai',
      apiKey: 'key',
      config: { model: 'gpt-5.6-luna' as any, stream: false },
      options: { fetch },
    });

  it('forwards promptCacheKey given in forward options', async () => {
    const { bodies, fetch } = capture();
    const gen = ax('userQuestion:string -> responseText:string');

    await gen.forward(
      makeAI(fetch) as any,
      { userQuestion: 'hello' } as any,
      { promptCacheKey: 'conversation-42', contextCache: {} } as any
    );

    expect(bodies[0].prompt_cache_key).toBe('conversation-42');
  });

  it('prefers promptCacheKey over sessionId', async () => {
    const { bodies, fetch } = capture();
    const gen = ax('userQuestion:string -> responseText:string');

    await gen.forward(
      makeAI(fetch) as any,
      { userQuestion: 'hello' } as any,
      {
        promptCacheKey: 'wins',
        sessionId: 'loses',
        contextCache: {},
      } as any
    );

    expect(bodies[0].prompt_cache_key).toBe('wins');
  });

  it('falls back to sessionId when no promptCacheKey is given', async () => {
    const { bodies, fetch } = capture();
    const gen = ax('userQuestion:string -> responseText:string');

    await gen.forward(
      makeAI(fetch) as any,
      { userQuestion: 'hello' } as any,
      { sessionId: 'conversation-7', contextCache: {} } as any
    );

    expect(bodies[0].prompt_cache_key).toBe('conversation-7');
  });
});
