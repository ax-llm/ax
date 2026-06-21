#!/usr/bin/env node
// AxIR RLM prompt-sync check.
//
// The RLM actor prompts exist as TWO byte-identical copies: the TS source of truth
// under src/ax/agent/templates/rlm/*.md (compiled into AxAgent), and a hand-synced
// copy in ir/axcore/data/rlm-prompts.json (*_template fields) that the five language
// ports render. There is no generator between them -- they are kept in lockstep by
// hand -- so they can drift silently, which would make the ports run a different
// actor loop than TS. This gate fails the build the moment they diverge.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const mdDir = path.join(repoRoot, 'src', 'ax', 'agent', 'templates', 'rlm');
const jsonPath = path.join(
  repoRoot,
  'ir',
  'axcore',
  'data',
  'rlm-prompts.json'
);

// md basename (source of truth) -> JSON key (synced copy).
const PROMPTS = {
  executor: 'executor_template',
  distiller: 'distiller_template',
  responder: 'responder_template',
};

const prompts = JSON.parse(readFileSync(jsonPath, 'utf8'));
const violations = [];

function firstDiff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      return { line: i + 1, md: al[i], json: bl[i] };
    }
  }
  return null;
}

for (const [name, key] of Object.entries(PROMPTS)) {
  const mdPath = path.join(mdDir, `${name}.md`);
  let md;
  try {
    md = readFileSync(mdPath, 'utf8');
  } catch {
    violations.push(`${name}: src/ax/agent/templates/rlm/${name}.md not found`);
    continue;
  }
  const json = prompts[key];
  if (typeof json !== 'string') {
    violations.push(
      `${name}: ir/axcore/data/rlm-prompts.json is missing string field "${key}"`
    );
    continue;
  }
  if (md !== json) {
    const d = firstDiff(md, json);
    const where = d
      ? ` first differs at line ${d.line}:\n      .md   : ${JSON.stringify(d.md)}\n      .json : ${JSON.stringify(d.json)}`
      : ` (lengths ${md.length} vs ${json.length}; trailing content differs)`;
    violations.push(
      `${name}: src/ax/agent/templates/rlm/${name}.md != rlm-prompts.json["${key}"]${where}`
    );
  }
}

if (violations.length > 0) {
  console.error(
    'AxIR RLM prompt-sync FAILED -- the TS prompt templates and the IR copy diverged:'
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\n  The TS .md files are the source of truth. After editing them, copy each into the\n' +
      '  matching *_template field of ir/axcore/data/rlm-prompts.json (byte-for-byte), then\n' +
      '  re-run `npm run axir:generate-packages`. Both copies must stay identical.'
  );
  process.exit(1);
}

console.log(
  `AxIR RLM prompt-sync ok: ${Object.keys(PROMPTS).length} prompts identical between src/ax/agent/templates/rlm/*.md and ir/axcore/data/rlm-prompts.json`
);
