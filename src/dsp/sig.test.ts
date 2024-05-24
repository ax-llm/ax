import test from 'ava';

import { parse } from './parser.js';

test('new Signature() builds a signature', (t) => {
  const sig = parse(
    `"hello world" context?:string "some context", query:string 'some query' -> answers:string[]`
  );
  t.is(sig.desc, 'hello world');

  t.deepEqual(sig.inputs[0], {
    desc: 'some context',
    name: 'context',
    type: { name: 'string', isArray: false },
    isOptional: true
  });

  t.deepEqual(sig.inputs[1], {
    desc: 'some query',
    name: 'query',
    type: { name: 'string', isArray: false },
    isOptional: undefined
  });

  t.deepEqual(sig.outputs[0], {
    desc: undefined,
    name: 'answers',
    type: { name: 'string', isArray: true },
    isOptional: undefined
  });
});
