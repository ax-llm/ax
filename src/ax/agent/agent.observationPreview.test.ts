import { expect, it } from 'vitest';
import { TurnObservations } from './agentInternal/turnObservations.js';

it('does not traverse a full large array just to size a bounded preview', () => {
  let reads = 0;
  const values = new Proxy(
    Array.from({ length: 100000 }, () => ({ id: 1, text: 'x'.repeat(200) })),
    {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    }
  );
  const observations = new TurnObservations();
  observations.recordResult('read', values);
  const output = observations.render(500);
  expect(output.length).toBeLessThanOrEqual(500);
  expect(reads).toBeLessThan(100);
  expect(output).toContain('more items');
});

it('preserves useful sibling fields when a large result has cycles or big integers', () => {
  const observations = new TurnObservations();
  const value: Record<string, unknown> = {
    payload: 'x'.repeat(20000),
    recordId: 12345678901234567890n,
    note: 'Use replacement B.',
  };
  value.self = value;
  observations.recordResult('read', value);
  const output = observations.render(800);
  const preview = JSON.parse(
    output.slice('read: '.length, output.indexOf('\n[OBSERVATION]'))
  );
  expect(output.length).toBeLessThanOrEqual(800);
  expect(preview.recordId).toBe('12345678901234567890');
  expect(preview.note).toBe('Use replacement B.');
  expect(preview.self).toContain('Circular');
});

it('keeps nested contract values readable under the existing observation budget', () => {
  const observations = new TurnObservations();
  const contract = {
    module: 'warehouse',
    operation: 'replace_record',
    path: '/records/{record_id}',
    method: 'POST',
    description: 'Replace a record after reading its revision.',
    parameters: [
      {
        name: 'record_id',
        type: 'integer',
        required: true,
        description: 'The selected record identifier. '.repeat(15),
        default: null,
        constraints: [],
      },
      {
        name: 'revision',
        type: 'integer',
        required: true,
        description: 'Use the current revision from the read result. '.repeat(
          15
        ),
        default: null,
        constraints: [],
      },
    ],
    response: {
      success: { message: 'string' },
      failure: { message: 'string' },
    },
  };
  observations.recordResult('catalog', contract);
  const output = observations.render(1600);
  expect(output.length).toBeLessThanOrEqual(1600);
  const preview = JSON.parse(
    output.slice('catalog: '.length, output.indexOf('\n[OBSERVATION]'))
  );
  expect(preview.parameters.map((p: { name: string }) => p.name)).toEqual([
    'record_id',
    'revision',
  ]);
  expect(
    preview.parameters.every((p: { required: boolean }) => p.required)
  ).toBe(true);
  expect(preview.response.failure.message).toBe('string');
});

it.each([120, 300, 800, 3000])(
  'keeps explicit bounded omissions and later caveats at %i characters',
  (budget) => {
    const observations = new TurnObservations();
    const value: Record<string, unknown> = {
      payload: 'x'.repeat(20000),
      note: 'Use replacement B.',
      revision: 7,
    };
    observations.recordResult('read', value);
    const output = observations.render(budget);
    expect(output.length).toBeLessThanOrEqual(budget);
    if (budget >= 300) {
      const preview = JSON.parse(
        output.slice('read: '.length, output.indexOf('\n[OBSERVATION]'))
      );
      expect(preview.note).toBe('Use replacement B.');
      expect(preview.revision).toBe(7);
      expect(preview.payload).toContain('…');
    }
  }
);

it('retains every row when compact JSON exactly fits after the label and note', () => {
  const observations = new TurnObservations();
  const rows = Array.from({ length: 20 }, (_, id) => ({ id }));
  observations.recordResult('rows', rows);
  const noteStart = '\n[OBSERVATION]';
  const large = observations.render(3000);
  const note = large.slice(large.indexOf(noteStart));
  const expected = `rows: ${JSON.stringify(rows)}${note}`;
  expect(observations.render(expected.length)).toBe(expected);
});

it('counts an explicitly printed batch result only once with indented JSON', () => {
  const observations = new TurnObservations();
  const record = { route: 'new-route' };
  observations.recordResult('first', record);
  observations.recordResult('second', 'ready');
  const text = observations.render(500, JSON.stringify(record, null, 2));
  expect(text.match(/new-route/g)).toHaveLength(1);
  expect(text).toContain('second: ready');
});
