#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const examplesRoot = path.join(repoRoot, 'src', 'examples');
const generatedRoot = path.join(examplesRoot, '.generated');
const axirDir = path.join(repoRoot, 'tools', 'axir');
const rootAxir = path.join(repoRoot, 'ir', 'axcore', 'root.axir');

const languageAliases = new Map([
  ['ts', 'ts'],
  ['typescript', 'ts'],
  ['js', 'ts'],
  ['javascript', 'ts'],
  ['python', 'python'],
  ['py', 'python'],
  ['java', 'java'],
  ['cpp', 'cpp'],
  ['c++', 'cpp'],
  ['cc', 'cpp'],
  ['go', 'go'],
]);

const defaultExt = {
  ts: '.ts',
  python: '.py',
  java: '.java',
  cpp: '.cpp',
};

const languageDir = {
  ts: '',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
  go: 'go',
};

const generatedCmakeExamples = new Set([
  'signature_schema',
  'axgen_fake_client_tool',
  'axgen_live_openai',
  'axai_fake_transport',
  'axagent_pipeline',
  'runtime_adapter',
  'runtime_protocol',
  'axflow_program_graph',
  'optimizer_artifact',
]);

const env = loadDotEnv();
if (!env.GOCACHE) env.GOCACHE = path.join(generatedRoot, 'go-build');
const args = process.argv.slice(2);

if (args.length === 0) usage(1);

let language = normalizeLanguage(args[0]);
let exampleArg;
let exampleArgs;

if (language) {
  exampleArg = args[1];
  exampleArgs = args.slice(2);
} else {
  exampleArg = args[0];
  exampleArgs = args.slice(1);
  language = inferLanguage(exampleArg);
}

if (!language || !exampleArg) usage(1);

const example = resolveExample(language, exampleArg);

switch (language) {
  case 'ts':
    runTs(example, exampleArgs);
    break;
  case 'python':
    await runPython(example, exampleArgs);
    break;
  case 'java':
    await runJava(example, exampleArgs);
    break;
  case 'cpp':
    await runCpp(example, exampleArgs);
    break;
  case 'go':
    runGo();
    break;
  default:
    usage(1);
}

function usage(code) {
  console.error(`Usage:
  npm run example -- ts src/examples/summarize.ts
  npm run example -- python axgen_live_openai.py
  npm run example -- java AxGenLiveOpenAIExample.java
  npm run example -- cpp axgen_live_openai.cpp

You can also pass a full example path and let the runner infer the language.`);
  process.exit(code);
}

function loadDotEnv() {
  const merged = { ...process.env };
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return merged;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (merged[key] == null || merged[key] === '') merged[key] = value;
  }
  return merged;
}

function normalizeLanguage(value) {
  if (!value) return null;
  return languageAliases.get(value.toLowerCase()) ?? null;
}

function inferLanguage(examplePath) {
  const ext = path.extname(examplePath).toLowerCase();
  if (ext === '.ts' || ext === '.js') return 'ts';
  if (ext === '.py') return 'python';
  if (ext === '.java') return 'java';
  if (ext === '.cpp' || ext === '.cc' || ext === '.cxx') return 'cpp';
  if (ext === '.go') return 'go';
  return null;
}

function resolveExample(language, exampleArg) {
  const ext = path.extname(exampleArg);
  const withExt =
    ext || !defaultExt[language]
      ? exampleArg
      : `${exampleArg}${defaultExt[language]}`;
  const candidates = [];

  if (path.isAbsolute(withExt)) candidates.push(withExt);
  candidates.push(path.resolve(process.cwd(), withExt));
  candidates.push(path.join(examplesRoot, languageDir[language], withExt));
  if (language === 'ts') candidates.push(path.join(examplesRoot, withExt));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Example not found for ${language}: ${exampleArg}`);
  }
  return found;
}

function runTs(examplePath, rest) {
  run(process.execPath, ['--import=tsx', examplePath, ...rest], {
    cwd: repoRoot,
    env,
  });
}

async function runPython(examplePath, rest) {
  const outDir = await ensureGeneratedPackage('python');
  const python = findCommand(['python3', 'python'], ['--version']);
  const pythonPath = prependEnvPath(env.PYTHONPATH, outDir);
  run(python, [examplePath, ...rest], {
    cwd: repoRoot,
    env: { ...env, PYTHONPATH: pythonPath },
  });
}

async function runJava(examplePath, rest) {
  const outDir = await ensureGeneratedPackage('java');
  const javac = findJavaTool('javac');
  const java = findJavaTool('java');
  const classesDir = path.join(generatedRoot, 'java-classes');
  await rm(classesDir, { recursive: true, force: true });
  await mkdir(classesDir, { recursive: true });

  const sources = await javaBaseSources(outDir);
  sources.push(examplePath);
  run(javac, ['-cp', outDir, '-d', classesDir, ...sources], {
    cwd: repoRoot,
    env,
  });

  const className = path.basename(examplePath, '.java');
  run(java, ['-cp', classesDir, className, ...rest], {
    cwd: repoRoot,
    env,
  });
}

async function runCpp(examplePath, rest) {
  const outDir = await ensureGeneratedPackage('cpp');
  const stem = path.basename(examplePath, path.extname(examplePath));
  const cmake = findOptionalCommand(['cmake'], ['--version']);

  if (cmake && generatedCmakeExamples.has(stem)) {
    await cp(
      examplePath,
      path.join(outDir, 'examples', path.basename(examplePath))
    );
    const buildDir = path.join(generatedRoot, 'cpp-cmake-build');
    run(
      cmake,
      [
        '-S',
        outDir,
        '-B',
        buildDir,
        '-DAX_BUILD_EXAMPLES=ON',
        '-DAX_BUILD_CONFORMANCE=OFF',
      ],
      { cwd: repoRoot, env }
    );
    run(cmake, ['--build', buildDir, '--target', stem], {
      cwd: repoRoot,
      env,
    });
    run(path.join(buildDir, stem), rest, { cwd: repoRoot, env });
    return;
  }

  const cxx = findCommand([env.CXX, 'c++', 'clang++', 'g++'].filter(Boolean), [
    '--version',
  ]);
  const bin = path.join(generatedRoot, 'cpp-bin', stem);
  await mkdir(path.dirname(bin), { recursive: true });
  run(
    cxx,
    [
      '-std=c++17',
      '-I',
      outDir,
      path.join(outDir, 'axllm', 'axllm.cpp'),
      examplePath,
      '-o',
      bin,
    ],
    { cwd: repoRoot, env }
  );
  run(bin, rest, { cwd: repoRoot, env });
}

function runGo() {
  console.log(
    'Go Ax examples are reserved for the future generated Go backend. Current generated Ax libraries are Python, Java, and C++.'
  );
}

async function ensureGeneratedPackage(target) {
  const outDir = path.join(generatedRoot, target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  run(
    'go',
    ['run', '.', 'compile', '--target', target, '--out', outDir, rootAxir],
    {
      cwd: axirDir,
      env,
    }
  );
  return outDir;
}

async function javaBaseSources(outDir) {
  const dir = path.join(outDir, 'dev', 'axllm', 'ax');
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.java'))
    .map((entry) => path.join(dir, entry.name));
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function findJavaTool(name) {
  const candidates = [];
  if (env.JAVA_HOME) candidates.push(path.join(env.JAVA_HOME, 'bin', name));
  candidates.push(
    `/opt/homebrew/opt/openjdk/bin/${name}`,
    `/usr/local/opt/openjdk/bin/${name}`,
    name
  );
  return findCommand(candidates, ['-version']);
}

function findCommand(candidates, args) {
  const found = findOptionalCommand(candidates, args);
  if (!found)
    throw new Error(`Required command not found: ${candidates.join(', ')}`);
  return found;
}

function findOptionalCommand(candidates, args) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, { stdio: 'ignore', env });
    if (result.status === 0) return candidate;
  }
  return null;
}

function prependEnvPath(existing, first) {
  return existing ? `${first}${path.delimiter}${existing}` : first;
}
