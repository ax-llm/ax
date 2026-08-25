#!/usr/bin/env node
// Perturbation check: mutate one expected value in a sample of conformance
// fixtures and assert every target FAILS that fixture. A target that passes
// a perturbed fixture has a runner that is not actually checking behavior.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '..');
export const conformanceRoot = path.join(repoRoot, 'ir', 'conformance');

export const DEFAULT_TARGETS = ['python', 'go', 'rust', 'java', 'cpp'];
export const PERTURB_RUNNER_ROOT_ENV = 'AXIR_PERTURB_RUNNER_ROOT';

const PREPARED_RUNNER_VERSION = 1;
const PREPARED_RUNNER_MANIFEST = '.axir-perturb-runner.json';

// Engine-required suites: their fixtures need an optional in-process engine
// (goja/quickjs) that the default conformance runner here does NOT load, so they
// run in dedicated engine lanes (the axir-agent-antidote CI job + G1 fixtures),
// not in this harness. Mirrors conformanceSuitePaths, which also omits them.
export const ENGINE_ONLY_SUITES = new Set(['axagent-real']);

// One representative fixture per suite: the alphabetically first .json file.
export function sampleFixtures(root = conformanceRoot) {
  const suites = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !ENGINE_ONLY_SUITES.has(name))
    .sort();
  const sample = [];
  for (const suite of suites) {
    const fixtures = readdirSync(path.join(root, suite))
      .filter((name) => name.endsWith('.json'))
      .sort();
    if (fixtures.length > 0) {
      sample.push({ suite, file: fixtures[0] });
    }
  }
  return sample;
}

// Mutate the first expected_* leaf (depth-first) so the expectation can no
// longer hold. Adding keys to expected maps and items to expected arrays
// makes subset assertions stricter, so those count as mutations too.
export function perturbFixture(fixture) {
  const mutate = (value) => {
    if (typeof value === 'string') return `${value}__PERTURBED__`;
    if (typeof value === 'number') return value + 1;
    if (typeof value === 'boolean') return !value;
    if (Array.isArray(value)) return [...value, '__PERTURBED__'];
    if (value && typeof value === 'object') {
      return { ...value, __perturbed__: true };
    }
    return '__PERTURBED__';
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return null;
    for (const key of Object.keys(node)) {
      if (key.startsWith('expected')) {
        const before = JSON.stringify(node[key]);
        node[key] = mutate(node[key]);
        return { key, before, after: JSON.stringify(node[key]) };
      }
    }
    for (const key of Object.keys(node)) {
      const hit = visit(node[key]);
      if (hit) return hit;
    }
    return null;
  };
  return visit(fixture);
}

function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.endsWith('_BASE_URL') || key.endsWith('_API_KEY')) continue;
    env[key] = value;
  }
  env.AXIR_REPO_ROOT = repoRoot;
  env.AXIR_AXJS_RUNTIME_SERVER = path.join(
    repoRoot,
    'tools',
    'axir',
    'adapters',
    'axjs-runtime-server.ts'
  );
  return { ...env, ...extra };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
    env: cleanEnv(options.envExtra),
  });
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { envExtra, ...spawnOptions } = options;
    const startedAt = performance.now();
    const child = spawn(command, args, {
      ...spawnOptions,
      env: cleanEnv(envExtra),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      resolve({
        status,
        signal,
        stdout,
        stderr,
        durationMs: performance.now() - startedAt,
      });
    });
  });
}

export function compileTarget(target, outDir) {
  execFileSync(
    'node',
    [
      path.join(repoRoot, 'scripts', 'run-axir.mjs'),
      'compile',
      '--target',
      target,
      '--out',
      outDir,
      path.join(repoRoot, 'ir', 'axcore', 'root.axir'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() }
  );
}

function runnerForTarget(target, outDir) {
  switch (target) {
    case 'python':
      return (suiteDir) =>
        run('python3', ['-m', 'axllm.conformance', suiteDir], {
          envExtra: { PYTHONPATH: outDir },
        });
    case 'go': {
      const bin = path.join(outDir, 'conformance_bin');
      return (suiteDir) => run(bin, [suiteDir], { cwd: outDir });
    }
    case 'rust': {
      // cargo honors CARGO_TARGET_DIR (CI sets it for build caching); resolve the
      // binary from the same dir cargo built into rather than assuming outDir/target.
      const targetDir = path.resolve(
        outDir,
        process.env.CARGO_TARGET_DIR || 'target'
      );
      const bin = path.join(targetDir, 'debug', 'axllm-conformance');
      return (suiteDir) => run(bin, [suiteDir], { cwd: outDir });
    }
    case 'java': {
      return (suiteDir) =>
        run('java', ['-cp', outDir, 'dev.axllm.ax.Conformance', suiteDir]);
    }
    case 'cpp': {
      const bin = path.join(outDir, 'conformance_bin');
      return (suiteDir) => run(bin, [suiteDir]);
    }
    default:
      throw new Error(`unsupported target ${target}`);
  }
}

// Build each target's conformance runner once; return a function that runs it
// against a suite directory and reports pass/fail. C++ has three independent
// translation units, so compile them concurrently before the final link.
export async function buildRunner(target, outDir) {
  switch (target) {
    case 'python':
      break;
    case 'go': {
      const bin = path.join(outDir, 'conformance_bin');
      const build = run('go', ['build', '-o', bin, './conformance'], {
        cwd: outDir,
      });
      if (build.status !== 0) {
        throw new Error(`go build failed:\n${build.stdout}${build.stderr}`);
      }
      break;
    }
    case 'rust': {
      const build = run(
        'cargo',
        [
          'build',
          '--quiet',
          '--manifest-path',
          path.join(outDir, 'Cargo.toml'),
          '--bin',
          'axllm-conformance',
        ],
        { cwd: outDir }
      );
      if (build.status !== 0) {
        throw new Error(`cargo build failed:\n${build.stdout}${build.stderr}`);
      }
      break;
    }
    case 'java': {
      const files = readdirSync(path.join(outDir, 'dev', 'axllm', 'ax'))
        .filter((name) => name.endsWith('.java'))
        .map((name) => path.join(outDir, 'dev', 'axllm', 'ax', name))
        .sort();
      const build = run('javac', ['-cp', outDir, '-d', outDir, ...files]);
      if (build.status !== 0) {
        throw new Error(`javac failed:\n${build.stdout}${build.stderr}`);
      }
      break;
    }
    case 'cpp': {
      const compiler = process.env.CXX || 'c++';
      const compileSteps = [
        {
          label: 'axllm.cpp',
          source: path.join(outDir, 'axllm', 'axllm.cpp'),
          object: path.join(outDir, 'ax.o'),
        },
        {
          label: 'mcp.cpp',
          source: path.join(outDir, 'axllm', 'mcp.cpp'),
          object: path.join(outDir, 'mcp.o'),
        },
        {
          label: 'conformance.cpp',
          source: path.join(outDir, 'conformance.cpp'),
          object: path.join(outDir, 'conformance.o'),
        },
      ];
      const results = await Promise.all(
        compileSteps.map(async ({ label, source, object }) => {
          const result = await runAsync(compiler, [
            '-std=c++17',
            '-I',
            outDir,
            '-c',
            source,
            '-o',
            object,
          ]);
          console.log(
            `[compile] cpp ${label} ${(result.durationMs / 1000).toFixed(1)}s`
          );
          return { label, object, result };
        })
      );
      for (const { label, result } of results) {
        if (result.status !== 0) {
          throw new Error(
            `c++ compile failed (${label}):\n${result.stdout}${result.stderr}`
          );
        }
      }
      const bin = path.join(outDir, 'conformance_bin');
      const linkStartedAt = performance.now();
      const link = run(compiler, [
        ...results.map(({ object }) => object),
        '-o',
        bin,
      ]);
      console.log(
        `[link] cpp conformance_bin ${(
          (performance.now() - linkStartedAt) / 1000
        ).toFixed(1)}s`
      );
      if (link.status !== 0) {
        throw new Error(`c++ link failed:\n${link.stdout}${link.stderr}`);
      }
      break;
    }
    default:
      throw new Error(`unsupported target ${target}`);
  }
  return runnerForTarget(target, outDir);
}

function runnerManifestPath(outDir) {
  return path.join(outDir, PREPARED_RUNNER_MANIFEST);
}

export async function prepareTargetRunner(target, outDir) {
  const generationStartedAt = performance.now();
  compileTarget(target, outDir);
  console.log(
    `[generate] ${target} ${(
      (performance.now() - generationStartedAt) / 1000
    ).toFixed(1)}s`
  );
  const runner = await buildRunner(target, outDir);
  writeFileSync(
    runnerManifestPath(outDir),
    `${JSON.stringify({ version: PREPARED_RUNNER_VERSION, target })}\n`
  );
  return runner;
}

export function loadPreparedRunner(target, outDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(runnerManifestPath(outDir), 'utf8'));
  } catch (error) {
    throw new Error(
      `prepared AxIR runner for ${target} is missing or invalid at ${outDir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (
    manifest.version !== PREPARED_RUNNER_VERSION ||
    manifest.target !== target
  ) {
    throw new Error(
      `prepared AxIR runner mismatch at ${outDir}: expected version ${PREPARED_RUNNER_VERSION} target ${target}`
    );
  }
  return runnerForTarget(target, outDir);
}

export async function loadOrPrepareRunners(selected, outDirForTarget) {
  const runners = {};
  const preparedRoot = process.env[PERTURB_RUNNER_ROOT_ENV];
  for (const target of selected) {
    if (preparedRoot) {
      const outDir = path.join(path.resolve(preparedRoot), target);
      console.log(`[reuse] ${target} runner from ${outDir}`);
      runners[target] = loadPreparedRunner(target, outDir);
      continue;
    }
    const outDir = outDirForTarget(target);
    console.log(`[build] ${target}`);
    runners[target] = await prepareTargetRunner(target, outDir);
  }
  return runners;
}

async function main() {
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const selected = targets.length > 0 ? targets : DEFAULT_TARGETS;
  const sample = sampleFixtures();
  console.log(
    `Perturbation check: ${sample.length} fixtures x ${selected.length} targets`
  );

  const work = mkdtempSync(path.join(os.tmpdir(), 'axir-perturb-'));
  const runners = await loadOrPrepareRunners(selected, (target) =>
    path.join(work, target)
  );

  // Self-test: the pristine tree must pass every sampled suite everywhere.
  for (const target of selected) {
    for (const { suite } of sample) {
      const result = runners[target](path.join(conformanceRoot, suite));
      if (result.status !== 0) {
        console.error(
          `SELF-TEST FAILED: ${target} fails pristine suite ${suite}\n${result.stdout}${result.stderr}`
        );
        process.exit(2);
      }
    }
    console.log(`[self-test] ${target} passes all sampled pristine suites`);
  }

  const failures = [];
  for (const { suite, file } of sample) {
    const perturbedRoot = path.join(work, `perturbed-${suite}`);
    cpSync(conformanceRoot, perturbedRoot, { recursive: true });
    const fixturePath = path.join(perturbedRoot, suite, file);
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const mutation = perturbFixture(fixture);
    if (!mutation) {
      console.log(`[skip] ${suite}/${file}: no expected_* key to perturb`);
      continue;
    }
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 1)}\n`);
    for (const target of selected) {
      const result = runners[target](path.join(perturbedRoot, suite));
      const failed = result.status !== 0;
      const verdict = failed ? 'rejected' : 'ACCEPTED-PERTURBED';
      console.log(`[${verdict}] ${target} ${suite}/${file} (${mutation.key})`);
      if (!failed) {
        failures.push({ target, suite, file, mutation });
      }
    }
    rmSync(perturbedRoot, { recursive: true, force: true });
  }

  rmSync(work, { recursive: true, force: true });
  if (failures.length > 0) {
    console.error(
      `\n${failures.length} target/fixture pairs ACCEPTED perturbed expectations:`
    );
    for (const failure of failures) {
      console.error(
        `- ${failure.target}: ${failure.suite}/${failure.file} (${failure.mutation.key})`
      );
    }
    process.exit(1);
  }
  console.log('\nAll targets reject every perturbed fixture.');
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
