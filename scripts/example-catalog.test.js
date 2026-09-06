import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublicExample } from './example-catalog.mjs';

const generation = {
  sourcePath: 'src/examples/python/generation/astra_async.py',
  file: 'astra_async.py',
  group: 'generation',
};
const flow = {
  sourcePath: 'src/examples/python/flows/astra_async.py',
  file: 'astra_async.py',
  group: 'flows',
};
const catalog = { byLanguage: { python: [generation, flow] } };
test('example resolution preserves the requested group and file path', () => {
  assert.equal(
    resolvePublicExample(catalog, 'python', 'flows/astra_async'),
    flow
  );
  assert.equal(
    resolvePublicExample(catalog, 'python', 'flows/astra_async.py'),
    flow
  );
  assert.equal(
    resolvePublicExample(
      catalog,
      'python',
      '/repo/src/examples/python/flows/astra_async.py'
    ),
    flow
  );
  assert.equal(
    resolvePublicExample(catalog, 'python', 'astra_async'),
    generation
  );
  assert.equal(
    resolvePublicExample(catalog, 'python', '/tmp/debug/astra_async.py'),
    undefined
  );
});
