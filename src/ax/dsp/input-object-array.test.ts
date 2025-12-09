import { vi, describe, it, expect } from 'vitest';

import { ax } from '../index.js';
import { f } from './sig.js';

const sig = f()
  .input(
    'items',
    f
      .object(
        {
          id: f.number('Index'),
          name: f.string('Name'),
        },
        'Item'
      )
      .array()
  )
  .output(
    'classifiedItems',
    f
      .object(
        {
          id: f.number('Index'),
          label: f.string('Label'),
        },
        'Classification'
      )
      .array()
  )
  .build();

const gen = ax(sig);

import type { AxAIService, AxChatResponse } from '../ai/types.js';

const llm: AxAIService = {
  chat: vi.fn().mockResolvedValue({
    results: [
      {
        index: 0,
        content:
          'Classified Items: [{"id": 0, "label": "A"}, {"id": 1, "label": "B"}]',
      },
    ],
  } as AxChatResponse),
  embed: vi.fn(),
  getOptions: vi.fn().mockReturnValue({}),
  setOptions: vi.fn(),
  getName: vi.fn(),
  getFeatures: vi.fn().mockReturnValue({ structuredOutputs: true }),
  getModelList: vi.fn(),
  getMetrics: vi.fn(),
  getLogger: vi.fn(),
  getLastUsedChatModel: vi.fn(),
  getLastUsedEmbedModel: vi.fn(),
  getLastUsedModelConfig: vi.fn(),
  getId: vi.fn(),
};

describe('f.object().array() on inputs', () => {
  it('should not throw a validation error for valid input', async () => {
    const result = await gen.forward(llm, {
      items: [
        { id: 0, name: 'Foo' },
        { id: 1, name: 'Bar' },
      ],
    });
    expect(result.classifiedItems).toEqual([
      { id: 0, label: 'A' },
      { id: 1, label: 'B' },
    ]);
  });
});
