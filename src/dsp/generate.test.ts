import test from 'ava';

import { extractValues, Signature } from './sig.js';

test('extractValues', (t) => {
  const sig = new Signature(`question -> answer`);
  const v1 = extractValues(sig, `Answer: "hello world"`);

  t.deepEqual(v1, { answer: '"hello world"' });
});

test('extractValues with no prefix and single output', (t) => {
  const sig = new Signature(`question -> answer`);
  const v1 = extractValues(sig, `"hello world"`);

  t.deepEqual(v1, { answer: '"hello world"' });
});

test('extractValues with json', (t) => {
  const sig = new Signature(`question -> answer : json`);
  const v1 = extractValues(sig, 'Answer: ```json\n{"hello": "world"}\n```');

  t.deepEqual(v1, { answer: { hello: 'world' } });
});
