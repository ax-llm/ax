import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { extractReadIdentifiers } from '../src/ax/agent/contextManager.ts';
import { extractTopLevelDurableWriteTargets } from '../src/ax/util/jsAnalysis.ts';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const supportPath = path.join(
  repoRoot,
  'tools/axir/internal/axir/templates/runtime/runtimeSupport.js'
);

function loadSupport() {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(supportPath, 'utf8'), context);
  return context;
}

const CODE_SAMPLES = [
  "const kept = 41; var items = [1, 2, 3, 4]; bare = { a: 1, b: 'x' }; let label = 'refunds'; console.log('seen', kept, items.length)",
  'const { a, b: renamed, ...rest } = source; const [first, , third] = list;',
  "globalThis.total = sum(values); count += 1; items.push(value); // note = 'x'",
  'for (const row of rows) { const inner = row.id; } result = rows.map((r) => r.id);',
  'const r = await crm.lookup({ id: "c-7" }); final("Report", { tier: r.tier });',
];

describe('axir runtime support JavaScript', () => {
  it('is generated from the current TypeScript sources', () => {
    execFileSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/axir-runtime-support.mjs'), 'check'],
      { cwd: repoRoot, stdio: 'pipe' }
    );
  });

  it("analyzes code as TypeScript's action log does", () => {
    const context = loadSupport();
    for (const code of CODE_SAMPLES) {
      const analysis = JSON.parse(context.__ax_analyze_code(code));
      expect(analysis.producedVars).toEqual(
        extractTopLevelDurableWriteTargets(code)
      );
      expect(analysis.readVars).toEqual([...extractReadIdentifiers(code)]);
    }
  });

  it("describes globals as TypeScript's AxJSRuntime snapshot does", () => {
    const context = loadSupport();
    const baseline = vm.runInContext(
      'Object.getOwnPropertyNames(globalThis)',
      context
    );
    vm.runInContext(
      "var kept = 41; var items = [1, 2, 3, 4]; var bare = { a: 1, b: 'x' }; var label = 'refunds'; function helper() {}",
      context
    );
    const entries = JSON.parse(context.__ax_inspect_entries(baseline));
    expect(entries).toEqual([
      {
        name: 'bare',
        type: 'object',
        ctor: 'Object',
        size: '2 keys',
        preview: '{a, b}',
        restorable: true,
      },
      {
        name: 'helper',
        type: 'function',
        preview: '[function helper]',
        restorable: false,
      },
      {
        name: 'items',
        type: 'array',
        ctor: 'Array',
        size: '4 items',
        preview: '[1, 2, 3, ...]',
        restorable: true,
      },
      { name: 'kept', type: 'number', preview: '41', restorable: true },
      {
        name: 'label',
        type: 'string',
        size: '7 chars',
        preview: '"refunds"',
        restorable: true,
      },
    ]);
  });
});
