import { describe, expect, it } from 'vitest';

import {
  type AxAIServiceOptions,
  AxEmbeddingAdapter,
  AxMockAIService,
} from '../index.js';

const info = {
  name: 'vectorSearch',
  description: 'Search using an embedded query',
  argumentDescription: 'Query text',
};

type Options = Readonly<AxAIServiceOptions>;
type Callback = (
  embedding: readonly number[],
  options?: Options
) => Promise<unknown>;

const callbacks: [string, Callback][] = [
  ['two parameters', async (_embedding, options) => options],
  ['default parameter', async (_embedding, options = {}) => options],
  ['rest parameters', async (...args) => args[1]],
  [
    'destructured default parameter',
    async (_embedding, { sessionId, abortSignal } = {}) => ({
      sessionId,
      abortSignal,
    }),
  ],
];

describe('AxEmbeddingAdapter', () => {
  it.each(callbacks)('forwards tool context to %s', async (_label, func) => {
    const abortSignal = new AbortController().signal;
    const options = { sessionId: 'search-session', abortSignal };
    const tool = new AxEmbeddingAdapter({
      ai: new AxMockAIService(),
      info,
      func,
    }).toFunction();

    await expect(tool.func({ text: 'query' }, options)).resolves.toEqual(
      options
    );
  });

  it('keeps callbacks that only consume the embedding working', async () => {
    const tool = new AxEmbeddingAdapter({
      ai: new AxMockAIService({ embedResponse: { embeddings: [[0.1, 0.2]] } }),
      info,
      func: async (embedding) => [...embedding],
    }).toFunction();

    await expect(
      tool.func({ text: 'query' }, { sessionId: 'search-session' })
    ).resolves.toEqual([0.1, 0.2]);
  });

  it('keeps default options when no context was provided', async () => {
    const tool = new AxEmbeddingAdapter({
      ai: new AxMockAIService(),
      info,
      func: async (_embedding, options = {}) => options,
    }).toFunction();

    await expect(tool.func({ text: 'query' })).resolves.toEqual({});
  });
});
