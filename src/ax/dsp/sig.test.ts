import test from 'ava';

import { parseSignature } from './parser.js';

test('signature parsing', (t) => {
  const sig = parseSignature(
    `"hello world" context?:string "some context", query:string 'some query' -> answers:string[], messageType:class "reminder, follow-up"`
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
    isOptional: false
  });

  t.deepEqual(sig.outputs[0], {
    desc: undefined,
    name: 'answers',
    type: { name: 'string', isArray: true },
    isOptional: false
  });

  t.deepEqual(sig.outputs[1], {
    isOptional: false,
    name: 'messageType',
    type: { name: 'class', isArray: false, classes: ['reminder', 'follow-up'] }
  });
});

// test('signature parsing: invalid signature', (t) => {
//   t.throws(() =>
//     parseSignature(
//       `context?:string, query:boom -> test:image, answers:string[]`
//     )
//   );
// });
