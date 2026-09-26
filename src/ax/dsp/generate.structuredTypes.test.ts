import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { ValidationError } from './errors.js';
import { validateStructuredOutputValues } from './extract.js';
import { AxSignature } from './sig.js';
import { ax } from './template.js';

const validate = (signature: string, values: Record<string, unknown>) => {
  validateStructuredOutputValues(new AxSignature(signature), values);
  return values;
};

describe('structured output value types', () => {
  it('coerces numeric and boolean strings as the text contract does', () => {
    expect(
      validate('question:string -> count:number, ok:boolean, ids:number[]', {
        count: ' 7 ',
        ok: 'TRUE',
        ids: ['1', 2, '3.5'],
      })
    ).toEqual({ count: 7, ok: true, ids: [1, 2, 3.5] });
    expect(
      validate('question:string -> meta:object{ size:number, open:boolean }', {
        meta: { size: '12', open: 'false' },
      })
    ).toEqual({ meta: { size: 12, open: false } });
  });

  it.each([
    ['question:string -> count:number', { count: 'seven' }],
    ['question:string -> count:number', { count: '' }],
    ['question:string -> count:number', { count: true }],
    ['question:string -> ok:boolean', { ok: 'yes' }],
    ['question:string -> ok:boolean', { ok: 1 }],
    ['question:string -> name:string', { name: 5 }],
    ['question:string -> name:string', { name: { first: 'Ada' } }],
    ['question:string -> snippet:code', { snippet: ['x'] }],
    ['question:string -> mood:class "happy, sad"', { mood: 'angry' }],
    ['question:string -> mood:class "happy, sad"', { mood: 1 }],
    ['question:string -> tags:string[]', { tags: 'solo' }],
    ['question:string -> tags:string[]', { tags: ['ok', 3] }],
    ['question:string -> meta:object{ size:number }', { meta: 'big' }],
    [
      'question:string -> meta:object{ size:number }',
      { meta: { size: 'big' } },
    ],
  ])('rejects %s with %j', (signature, values) => {
    expect(() => validate(signature, values)).toThrow(ValidationError);
  });

  it('leaves json values as they are', () => {
    expect(
      validate('question:string -> rawRecord:json', {
        rawRecord: { any: ['shape', 1] },
      })
    ).toEqual({ rawRecord: { any: ['shape', 1] } });
  });

  it('retries a structured answer whose value has the wrong type', async () => {
    const answers = [
      '{"count":"seven","detail":{"note":"n"}}',
      '{"count":"7","detail":{"note":"n"}}',
    ];
    let call = 0;
    const ai = new AxMockAIService<string>({
      name: 'mock',
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: async () => ({
        results: [
          { index: 0, content: answers[call++] ?? '', finishReason: 'stop' },
        ],
      }),
    });
    const gen = ax(
      'question:string -> count:number, detail:object{ note:string }'
    );

    const out = await gen.forward(ai, { question: 'q' });

    expect(out).toEqual({ count: 7, detail: { note: 'n' } });
    expect(call).toBe(2);
  });
});
