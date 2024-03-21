import test from 'ava';

import { Signature } from './sig.js';

test('new Signature() builds a signature', (t) => {
  const signature = new Signature(
    '"hello world" query:string -> answer:string'
  );
  const sig = signature.getParsedSignature();

  t.is(sig.desc, 'hello world');
  t.deepEqual(sig.inputs[0], {
    desc: undefined,
    name: 'query',
    type: { name: 'string', isArray: false },
    isOptional: undefined
  });
});
