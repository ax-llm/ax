#!/usr/bin/env node
// Anti-hardcode (response-perturbation) gate.
//
// The expected-perturbation harness (axir-perturb-check.mjs) proves a runner
// ENFORCES expectations. This gate proves the asserted value actually COMES
// FROM the model: for every fixture whose assertions depend on a scripted
// model response, it mutates THAT response and requires every target to FAIL.
// A target that still PASSES a response-mutated fixture is asserting a
// hardcoded/unwired value instead of the model's output.
//
// Detection is automatic: a response is "load-bearing" when its content (or,
// if the content is JSON, one of its leaf strings) overlaps a value asserted
// under an expected_* key. Every (fixture, response) selection is logged, so a
// blind spot is visible rather than silent. Default target is `go` (fast,
// always-on in the go-test lane); set AXIR_PERTURB_ALL=1 (CI) to run all five.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunner,
  compileTarget,
  conformanceRoot,
  DEFAULT_TARGETS,
  ENGINE_ONLY_SUITES,
} from './axir-perturb-check.mjs';

// Shortest string we trust as a model-output marker. Below this, coincidental
// overlap (shared words, short ids) produces false matches.
const MIN_LEN = 6;
const SENTINEL = '__ANTI_HARDCODE_SENTINEL__';

function collectLeafStrings(node, out) {
  if (typeof node === 'string') {
    if (node.length >= MIN_LEN) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectLeafStrings(v, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) collectLeafStrings(v, out);
  }
}

// Strings the fixture asserts under expected_* keys (excluding count-only
// assertions, which never echo response content).
function assertionStrings(fixture) {
  const out = [];
  const walk = (node, underExpected) => {
    if (typeof node === 'string') {
      if (underExpected && node.length >= MIN_LEN) out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v, underExpected);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const isExpected =
          underExpected ||
          (k.startsWith('expected') &&
            k !== 'expected_request_count' &&
            k !== 'expected_request_counts');
        walk(v, isExpected);
      }
    }
  };
  walk(fixture, false);
  return out;
}

// Indices of responses whose content (or JSON leaves) overlap an assertion.
export function loadBearingResponses(fixture) {
  const responses = Array.isArray(fixture.responses) ? fixture.responses : [];
  if (responses.length === 0) return [];
  const asserts = assertionStrings(fixture);
  if (asserts.length === 0) return [];
  const indices = [];
  responses.forEach((response, index) => {
    const content =
      typeof response?.content === 'string' ? response.content : '';
    const candidates = [];
    if (content.length >= MIN_LEN) candidates.push(content);
    try {
      collectLeafStrings(JSON.parse(content), candidates);
    } catch {
      // content is not JSON; the raw content candidate already covers it.
    }
    const hit = candidates.some((c) =>
      asserts.some((a) => a.includes(c) || c.includes(a))
    );
    if (hit) indices.push(index);
  });
  return indices;
}

function discoverCases() {
  const suites = readdirSync(conformanceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !ENGINE_ONLY_SUITES.has(name))
    .sort();
  const cases = [];
  for (const suite of suites) {
    for (const file of readdirSync(path.join(conformanceRoot, suite))
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      let fixture;
      try {
        fixture = JSON.parse(
          readFileSync(path.join(conformanceRoot, suite, file), 'utf8')
        );
      } catch {
        continue;
      }
      const responses = loadBearingResponses(fixture);
      if (responses.length > 0) cases.push({ suite, file, responses });
    }
  }
  return cases;
}

// Run a single fixture in isolation (its own one-file suite dir) on a target.
function runFixture(runner, work, label, fixture) {
  const dir = path.join(work, `case-${label}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'fixture.json'),
    `${JSON.stringify(fixture, null, 1)}\n`
  );
  const result = runner(dir);
  rmSync(dir, { recursive: true, force: true });
  return result;
}

async function main() {
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const selected =
    targets.length > 0
      ? targets
      : process.env.AXIR_PERTURB_ALL
        ? DEFAULT_TARGETS
        : ['go'];

  const cases = discoverCases();
  console.log(
    `Response-perturbation: ${cases.length} model-output fixtures x ${selected.length} targets`
  );
  for (const c of cases) {
    console.log(
      `[detect] ${c.suite}/${c.file} load-bearing responses [${c.responses.join(', ')}]`
    );
  }
  if (cases.length === 0) {
    console.error('No model-output fixtures detected — detection is broken.');
    process.exit(2);
  }

  const work = mkdtempSync(path.join(os.tmpdir(), 'axir-respperturb-'));
  const runners = {};
  for (const target of selected) {
    const outDir = path.join(work, `pkg-${target}`);
    console.log(`[build] ${target}`);
    compileTarget(target, outDir);
    runners[target] = buildRunner(target, outDir);
  }

  // A fixture is anti-hardcode-verified for a target when mutating AT LEAST ONE
  // of its load-bearing responses makes the run fail — i.e. some asserted value
  // genuinely depends on a model response. (Requiring EVERY detected response to
  // fail is wrong: a discarded first attempt in a retry fixture is superseded by
  // its retry, so mutating it correctly does not fail.) A fixture where NO
  // detected response mutation fails is asserting a hardcoded/unwired value.
  const failures = [];
  let checks = 0;
  for (const c of cases) {
    const pristine = JSON.parse(
      readFileSync(path.join(conformanceRoot, c.suite, c.file), 'utf8')
    );
    for (const target of selected) {
      const ok = runFixture(runners[target], work, `${target}-self`, pristine);
      if (ok.status !== 0) {
        console.error(
          `SELF-TEST FAILED: ${target} fails pristine ${c.suite}/${c.file}\n${ok.stdout}${ok.stderr}`
        );
        process.exit(2);
      }
      let anyFailed = false;
      for (const idx of c.responses) {
        const mutated = JSON.parse(JSON.stringify(pristine));
        mutated.responses[idx] = {
          ...mutated.responses[idx],
          content: SENTINEL,
        };
        const result = runFixture(
          runners[target],
          work,
          `${target}-${idx}`,
          mutated
        );
        const failed = result.status !== 0;
        checks += 1;
        if (failed) anyFailed = true;
        console.log(
          `[${failed ? 'rejected' : 'accepted'}] ${target} ${c.suite}/${c.file} resp#${idx}`
        );
      }
      if (!anyFailed) {
        console.error(
          `[HARDCODED] ${target} ${c.suite}/${c.file}: no load-bearing response [${c.responses.join(', ')}] changed the result`
        );
        failures.push({
          target,
          suite: c.suite,
          file: c.file,
          responses: c.responses,
        });
      }
    }
  }

  rmSync(work, { recursive: true, force: true });
  if (failures.length > 0) {
    console.error(
      `\n${failures.length} target/fixture pairs assert a value no model response affects (hardcoded/unwired):`
    );
    for (const f of failures) {
      console.error(
        `- ${f.target}: ${f.suite}/${f.file} resp[${f.responses.join(', ')}]`
      );
    }
    process.exit(1);
  }
  console.log(
    `\n${checks} response mutations across ${cases.length} fixtures: every fixture has a model-dependent assertion on every target.`
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
