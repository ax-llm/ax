#!/usr/bin/env node
// G2 anti-facade gate.
//
// Why this exists: a non-functional agent() shipped in five languages because every
// example "demonstrated" it by hand-feeding canned completion payloads through a mock
// client -- a scripted facade that looks like a real agent run. Provenance/coverage/
// conformance all stayed green because none of them can tell a fabricated payload from
// a real one. This gate makes that class of defect fail the build.
//
// Rule: a SHIPPED example must never hand-construct an agent completion payload AS THE
// AGENT'S RESULT. A real agent run produces {completion:{type:"final"|"askClarification",
// args:[...]}} by executing model-authored code in a runtime. An example that builds that
// shape with no engine behind it is faking the runtime.
//
// Two strengthenings over the naive version (both motivated by a facade that slipped past
// an earlier gate):
//   1. Escaping-aware. The payload often hides as an escaped JSON string literal inside a
//      scripted client -- `"{\"completion\":{\"type\":\"final\"}}"`. The raw bytes are
//      `\"completion\"` (backslash where the closing quote should be), so a regex looking
//      for `"completion"` misses it entirely. We normalize one level of backslash-escaped
//      quotes (\" -> ") before matching, so string-literal quoting can't hide the facade.
//   2. Real-engine exemption. A completion-shaped turn is legitimate when the SAME example
//      also feeds model-authored executable code (javascriptCode/pythonCode/actorCode) to a
//      real runtime: there the engine produces the genuine completion and the scripted turn
//      is only scaffolding for a downstream feature (state restore, guide, clarification).
//      A pure facade has the completion shape but NO such code -- the payload IS the
//      fabricated result. So we flag a file only when it fabricates a payload AND ships no
//      actor code.
//
// Scope: packages/<lang>/examples/** (the user-facing surface). Conformance fixtures
// (ir/conformance/*.json) and conformance-runner scaffolding (tools/axir templates) are
// test infrastructure and are intentionally NOT scanned.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const SOURCE_EXTS = new Set([
  '.py',
  '.rs',
  '.cpp',
  '.hpp',
  '.cc',
  '.h',
  '.java',
  '.go',
]);

// The "completion" envelope key, exactly (not "completion_payload", which legitimate
// runtime examples read from results).
const COMPLETION_KEY = /["']completion["']/;
// A {type: "final"|"askClarification"} payload field, in any of the five languages'
// object/map literal forms ("type": "final" / "type", "final").
const TYPE_PAYLOAD = /["']type["']\s*[:,]\s*["'](?:final|askClarification)["']/;
// Model-authored executable code that a real engine runs. Its presence means the example
// drives an actual runtime (the engine, not the fixture, produces the completion), so a
// scripted completion turn in the same file is scaffolding, not a facade.
const ACTOR_CODE = /["'](?:javascriptCode|pythonCode|actorCode)["']/;
// Collapse one level of backslash-escaped quotes (\" -> ", \' -> ') without touching
// newlines, so line numbers are preserved and escaped-JSON string literals are matched
// the same as bare object/map literals.
const unescapeQuotes = (text) => text.replace(/\\(["'])/g, '$1');

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const packagesRoot = path.join(repoRoot, 'packages');
let exampleDirs = [];
try {
  exampleDirs = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(packagesRoot, d.name, 'examples'));
} catch {
  console.error(`anti-facade gate: cannot read ${packagesRoot}`);
  process.exit(2);
}

const violations = [];
for (const dir of exampleDirs) {
  for (const file of walk(dir, [])) {
    const text = unescapeQuotes(readFileSync(file, 'utf8'));
    const fabricatesPayload =
      COMPLETION_KEY.test(text) && TYPE_PAYLOAD.test(text);
    // A fabricated payload is only a facade when no real engine runs alongside it.
    if (fabricatesPayload && !ACTOR_CODE.test(text)) {
      const lines = text.split('\n');
      const line = lines.findIndex((l) => TYPE_PAYLOAD.test(l)) + 1;
      violations.push(`${path.relative(repoRoot, file)}:${line || 1}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    'anti-facade gate FAILED: shipped example(s) hand-fabricate an agent completion payload.'
  );
  console.error(
    'A genuine example must run a real runtime so the model + engine produce the completion;'
  );
  console.error(
    'delete the scripted facade or replace it with a real end-to-end example.\n'
  );
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(
  'anti-facade gate ok: no shipped example fabricates a completion payload'
);
