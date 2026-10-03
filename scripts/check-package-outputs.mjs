import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consumer = mkdtempSync(path.join(tmpdir(), 'ax-package-outputs-'));
const packages = ['ax', 'aisdk', 'aws-bedrock', 'tools'];
const names = [
  '@ax-llm/ax',
  '@ax-llm/ax-ai-sdk-provider',
  '@ax-llm/ax-ai-aws-bedrock',
  '@ax-llm/ax-tools',
];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function checkWorker(AxJSRuntime) {
  const session = new AxJSRuntime({ nodeWorkerPoolSize: 0 }).createSession({
    seed: 21,
    double: (value) => value * 2,
  });
  try {
    assert.equal(await session.execute('await double(seed)'), 42);
    assert.equal(await session.execute('var persisted = 10'), undefined);
    assert.equal(await session.execute('persisted + 5'), 15);
  } finally {
    session.close();
  }
}

try {
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' })
  );
  const archives = JSON.parse(
    execFileSync(
      npm,
      [
        'pack',
        ...packages.map((name) => `./src/${name}/dist`),
        '--json',
        '--pack-destination',
        consumer,
      ],
      { cwd: root, encoding: 'utf8' }
    )
  );
  execFileSync(
    npm,
    [
      'install',
      ...archives.map(({ filename }) => path.join(consumer, filename)),
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefer-offline',
    ],
    { cwd: consumer, stdio: 'inherit' }
  );
  const require = createRequire(path.join(consumer, 'package.json'));
  let core;
  for (const name of names) {
    const cjs = require(name);
    const manifest = JSON.parse(
      readFileSync(
        path.join(path.dirname(require.resolve(name)), 'package.json'),
        'utf8'
      )
    );
    const entry = path.join(
      path.dirname(require.resolve(name)),
      manifest.module
    );
    const esm = await import(pathToFileURL(entry).href);
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort(), name);
    assert.ok(Object.keys(esm).length > 0, `${name} has public exports`);
    for (const output of ['main', 'module', 'types']) {
      assert.ok(
        readFileSync(path.join(path.dirname(entry), manifest[output])).length
      );
    }
    if (name === '@ax-llm/ax') {
      core = esm;
      await checkWorker(esm.AxJSRuntime);
      await checkWorker(cjs.AxJSRuntime);
    }
    console.log(`${name}: ESM and CommonJS exports match`);
  }
  assert.equal(
    typeof require('@ax-llm/ax-tools/event/sqlite').AxSQLiteEventStore,
    'function'
  );

  // Give the global bundle browser globals, with no process, require, or
  // module helpers. Evaluate each serialized worker in a separate context.
  const blobs = new Map();
  class BrowserWorker {
    constructor(url) {
      this.ready = blobs
        .get(url)
        .text()
        .then((source) => {
          this.context = vm.createContext({
            console,
            TextEncoder,
            TextDecoder,
            setTimeout,
            clearTimeout,
            postMessage: (data) =>
              queueMicrotask(() => this.onmessage?.({ data })),
          });
          this.context.self = this.context;
          vm.runInContext(source, this.context);
        });
    }
    postMessage(data) {
      void this.ready
        .then(() => this.context.onmessage({ data }))
        .catch((error) => this.onerror?.(error));
    }
    terminate() {}
  }
  const browser = vm.createContext({
    console,
    fetch,
    AbortController,
    Blob,
    TextEncoder,
    TextDecoder,
    ReadableStream,
    TransformStream,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Worker: BrowserWorker,
    URL: {
      createObjectURL(blob) {
        const url = `blob:${blobs.size}`;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL(url) {
        blobs.delete(url);
      },
    },
  });
  vm.runInContext(
    readFileSync(
      path.join(consumer, 'node_modules/@ax-llm/ax/index.global.js'),
      'utf8'
    ),
    browser
  );
  assert.deepEqual(Object.keys(browser.ax).sort(), Object.keys(core).sort());
  assert.equal(
    typeof browser.ax.ax('question:string -> answer:string').forward,
    'function'
  );
  await checkWorker(browser.ax.AxJSRuntime);
  console.log(
    'Browser global bundle and isolated worker callback/persistence pass'
  );

  writeFileSync(
    path.join(consumer, 'consumer.ts'),
    `
import { ax, type AxAIService } from '@ax-llm/ax';
import { AxAIProvider } from '@ax-llm/ax-ai-sdk-provider';
import { AxAIBedrock } from '@ax-llm/ax-ai-aws-bedrock';
import { AxSQLiteEventStore } from '@ax-llm/ax-tools/event/sqlite';
const program = ax('question:string -> answer:string');
async function answer(ai: AxAIService): Promise<string> {
  const result = await program.forward(ai, { question: 'hello' });
  return result.answer;
}
void [answer, AxAIProvider, AxAIBedrock, AxSQLiteEventStore];
`
  );
  execFileSync(
    path.join(root, 'node_modules/.bin/tsc'),
    [
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'consumer.ts',
    ],
    { cwd: consumer, stdio: 'inherit' }
  );
  console.log(
    'Published package declaration imports and signature inference pass'
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
