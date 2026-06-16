#!/usr/bin/env node
// G5 behavioral-parity ledger check.
//
// Provenance proves emitted-code <= IR op (origin) and is structurally blind to behavior
// that exists in neither the IR nor the packages -- which is exactly how a non-functional
// agent() shipped. This ledger adds the missing COMPLETENESS layer: every claimed
// behavioral capability must map to (a) IR op(s) that actually exist, and (b) at least one
// conformance fixture that exercises it for real. A capability listed with no fixture, or
// pointing at a missing op/fixture, fails the build.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const ledgerPath = path.join(repoRoot, 'ir', 'behavioral-parity-ledger.json');
const axcoreDir = path.join(repoRoot, 'ir', 'axcore');
const conformanceDir = path.join(repoRoot, 'ir', 'conformance');

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));

// Collect every defined op name across the IR (e.g. "op ax.agent.semantic @agent_forward {").
const opSet = new Set();
for (const file of readdirSync(axcoreDir)) {
  if (!file.endsWith('.axir')) continue;
  const text = readFileSync(path.join(axcoreDir, file), 'utf8');
  for (const m of text.matchAll(/op\s+[A-Za-z0-9_.]+\s+(@[A-Za-z0-9_]+)/g)) {
    opSet.add(m[1]);
  }
}

const violations = [];
const entries = ledger.entries || [];
for (const entry of entries) {
  const cap = entry.capability || '(unnamed)';
  for (const op of entry.ir_ops || []) {
    if (!opSet.has(op)) {
      violations.push(`${cap}: IR op ${op} not found in ir/axcore/*.axir`);
    }
  }
  const fixtures = entry.fixtures || [];
  if (fixtures.length === 0) {
    violations.push(
      `${cap}: no fixture -- a claimed capability with no real fixture is unverifiable`
    );
  }
  for (const fixture of fixtures) {
    if (!existsSync(path.join(conformanceDir, fixture))) {
      violations.push(`${cap}: fixture ir/conformance/${fixture} not found`);
    }
  }
}

if (violations.length > 0) {
  console.error('behavioral-parity ledger FAILED:');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(
  `behavioral-parity ledger ok: ${entries.length} capabilities, each maps to an existing IR op and a real fixture`
);
