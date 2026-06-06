#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const examplesRoot = path.join(repoRoot, 'src', 'examples');
const generatedRoot = path.join(examplesRoot, '.generated');
const packagesRoot = path.join(repoRoot, 'packages');

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
  ['rust', 'rust'],
  ['rs', 'rust'],
]);

const defaultExt = {
  ts: '.ts',
  python: '.py',
  java: '.java',
  cpp: '.cpp',
  go: '.go',
  rust: '.rs',
};

const languageDir = {
  ts: '',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
  go: 'go',
  rust: 'rust',
};

const exampleCatalog = {
  ts: [
    ['no-key', 'src/examples/rlm-context-map.ts', 'AxAgent context-map smoke'],
    [
      'no-key',
      'src/examples/rlm-context-management.ts',
      'AxAgent context pressure',
    ],
    [
      'provider-api',
      'src/examples/summarize.ts',
      'AxGen OpenAI-compatible API run',
    ],
    [
      'provider-api',
      'src/examples/audio-chat.ts voice',
      'Realtime audio voice stream',
    ],
  ],
  python: [
    ['no-key', 'signature_schema.py', 'Signature and schema smoke'],
    ['no-key', 'agent_pipeline.py', 'Deterministic AxAgent forward and logs'],
    ['no-key', 'flow_program_graph.py', 'Deterministic AxFlow graph'],
    ['no-key', 'audio_responses_mapping.py', 'OpenAI Responses audio mapping'],
    [
      'no-key',
      'realtime_audio_events.py',
      'Grok and Gemini realtime event folding',
    ],
    ['no-key', 'runtime_adapter.py', 'Custom AxCodeRuntime session'],
    ['no-key', 'optimizer_artifact.py', 'Optimizer artifact apply round trip'],
    ['no-key', 'gepa_local_optimizer.py', 'Local GEPA engine run'],
    ['provider-api', 'axgen_openai_api.py', 'AxGen OpenAI API run'],
    ['provider-api', 'agent_openai_api.py', 'AxAgent OpenAI API run'],
    ['provider-api', 'flow_openai_api.py', 'AxFlow OpenAI API run'],
  ],
  java: [
    ['no-key', 'SignatureSchemaExample.java', 'Signature and schema smoke'],
    [
      'no-key',
      'AgentPipelineExample.java',
      'Deterministic AxAgent forward and logs',
    ],
    ['no-key', 'FlowProgramGraphExample.java', 'Deterministic AxFlow graph'],
    [
      'no-key',
      'AudioResponsesMappingExample.java',
      'OpenAI Responses audio mapping',
    ],
    [
      'no-key',
      'RealtimeAudioEventsExample.java',
      'Grok and Gemini realtime event folding',
    ],
    ['no-key', 'RuntimeAdapterExample.java', 'Custom AxCodeRuntime session'],
    [
      'no-key',
      'OptimizerArtifactExample.java',
      'Optimizer artifact apply round trip',
    ],
    ['no-key', 'GEPALocalOptimizerExample.java', 'Local GEPA engine run'],
    ['provider-api', 'AxGenOpenAIExample.java', 'AxGen OpenAI API run'],
    ['provider-api', 'AgentOpenAIExample.java', 'AxAgent OpenAI API run'],
    ['provider-api', 'FlowOpenAIExample.java', 'AxFlow OpenAI API run'],
  ],
  cpp: [
    ['no-key', 'signature_schema.cpp', 'Signature and schema smoke'],
    ['no-key', 'agent_pipeline.cpp', 'Deterministic AxAgent forward and logs'],
    ['no-key', 'flow_program_graph.cpp', 'Deterministic AxFlow graph'],
    ['no-key', 'audio_responses_mapping.cpp', 'OpenAI Responses audio mapping'],
    [
      'no-key',
      'realtime_audio_events.cpp',
      'Grok and Gemini realtime event folding',
    ],
    ['no-key', 'runtime_adapter.cpp', 'Custom AxCodeRuntime session'],
    ['no-key', 'optimizer_artifact.cpp', 'Optimizer artifact apply round trip'],
    ['no-key', 'gepa_local_optimizer.cpp', 'Local GEPA engine run'],
    ['provider-api', 'axgen_openai_api.cpp', 'AxGen OpenAI API run'],
    ['provider-api', 'agent_openai_api.cpp', 'AxAgent OpenAI API run'],
    ['provider-api', 'flow_openai_api.cpp', 'AxFlow OpenAI API run'],
  ],
  go: [
    ['no-key', 'signature_schema.go', 'Signature and schema smoke'],
    ['no-key', 'provider_mapping_no_key.go', 'OpenAI-compatible mapping smoke'],
    ['provider-api', 'axgen_openai_api.go', 'AxGen OpenAI API run'],
  ],
  rust: [
    ['no-key', 'signature_schema.rs', 'Signature and schema smoke'],
    ['no-key', 'provider_mapping_no_key.rs', 'OpenAI-compatible mapping smoke'],
    [
      'no-key',
      'provider_stream_no_key.rs',
      'OpenAI-compatible streaming smoke',
    ],
    ['no-key', 'axgen_fake_client_tool.rs', 'AxGen fake client and tool'],
    ['no-key', 'axagent_pipeline.rs', 'Deterministic AxAgent forward and logs'],
    ['no-key', 'axflow_program_graph.rs', 'Deterministic AxFlow graph'],
    ['no-key', 'runtime_adapter.rs', 'Custom AxCodeRuntime session'],
    ['no-key', 'runtime_protocol.rs', 'Process AxCodeRuntime protocol'],
    ['no-key', 'optimizer_artifact.rs', 'Optimizer artifact smoke'],
    ['provider-api', 'axgen_openai_api.rs', 'AxGen OpenAI API run'],
  ],
};

const env = loadDotEnv();
if (!env.GOCACHE) env.GOCACHE = path.join(generatedRoot, 'go-build');
if (!env.AXIR_REPO_ROOT) env.AXIR_REPO_ROOT = repoRoot;
if (!env.AXIR_AXJS_RUNTIME_SERVER) {
  env.AXIR_AXJS_RUNTIME_SERVER = path.join(
    repoRoot,
    'tools',
    'axir',
    'adapters',
    'axjs-runtime-server.ts'
  );
}
const args = process.argv.slice(2);

if (args.length === 0) usage(1);
if (args[0] === 'list') listExamples();

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
    await runGo(example, exampleArgs);
    break;
  case 'rust':
    await runRust(example, exampleArgs);
    break;
  default:
    usage(1);
}

function usage(code) {
  console.error(`Usage:
  npm run example -- ts src/examples/summarize.ts
  npm run example -- python axgen_openai_api.py
  npm run example -- java AxGenOpenAIExample.java
  npm run example -- cpp axgen_openai_api.cpp
  npm run example -- go axgen_openai_api.go
  npm run example -- go signature_schema.go
  npm run example -- rust signature_schema.rs
  npm run example -- list

You can also pass a full example path and let the runner infer the language.`);
  process.exit(code);
}

function listExamples() {
  for (const [language, rows] of Object.entries(exampleCatalog)) {
    console.log(`${language}:`);
    for (const [kind, file, description] of rows) {
      const command = `npm run example -- ${language} ${file}`;
      console.log(`  ${kind.padEnd(12)} ${command.padEnd(64)} ${description}`);
    }
    console.log('');
  }
  process.exit(0);
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
  if (ext === '.rs') return 'rust';
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
  const outDir = languagePackageDir('python');
  const python = findCommand(['python3', 'python'], ['--version']);
  const pythonPath = prependEnvPath(env.PYTHONPATH, outDir);
  run(python, [examplePath, ...rest], {
    cwd: repoRoot,
    env: { ...env, PYTHONPATH: pythonPath },
  });
}

async function runJava(examplePath, rest) {
  const outDir = languagePackageDir('java');
  const javac = findJavaTool('javac');
  const java = findJavaTool('java');
  const className = path.basename(examplePath, '.java');
  const classesDir = path.join(generatedRoot, 'java-classes', className);
  await rm(classesDir, { recursive: true, force: true });
  await mkdir(classesDir, { recursive: true });

  const sources = await javaBaseSources(outDir);
  sources.push(examplePath);
  run(javac, ['-cp', outDir, '-d', classesDir, ...sources], {
    cwd: repoRoot,
    env,
  });

  run(java, ['-cp', classesDir, className, ...rest], {
    cwd: repoRoot,
    env,
  });
}

async function runCpp(examplePath, rest) {
  const outDir = languagePackageDir('cpp');
  const stem = path.basename(examplePath, path.extname(examplePath));
  const cmake = findOptionalCommand(['cmake'], ['--version']);

  if (cmake) {
    const buildDir = path.join(generatedRoot, 'cpp-cmake-build', stem);
    const installDir = path.join(generatedRoot, 'cpp-install', stem);
    const scratchDir = path.join(generatedRoot, 'cpp-run', stem);
    const scratchBuildDir = path.join(generatedRoot, 'cpp-run-build', stem);
    await rm(buildDir, { recursive: true, force: true });
    await rm(installDir, { recursive: true, force: true });
    await rm(scratchDir, { recursive: true, force: true });
    await rm(scratchBuildDir, { recursive: true, force: true });
    await mkdir(scratchDir, { recursive: true });

    run(
      cmake,
      [
        '-S',
        outDir,
        '-B',
        buildDir,
        '-DAX_BUILD_EXAMPLES=OFF',
        '-DAX_BUILD_CONFORMANCE=OFF',
      ],
      { cwd: repoRoot, env }
    );
    run(cmake, ['--build', buildDir, '--target', 'axllm'], {
      cwd: repoRoot,
      env,
    });
    run(cmake, ['--install', buildDir, '--prefix', installDir], {
      cwd: repoRoot,
      env,
    });

    await writeFile(
      path.join(scratchDir, 'CMakeLists.txt'),
      `cmake_minimum_required(VERSION 3.16)
project(axllm_user_example LANGUAGES CXX)
find_package(axllm CONFIG REQUIRED)
add_executable(${stem} "${escapeCmakePath(examplePath)}")
target_link_libraries(${stem} PRIVATE axllm::axllm)
`
    );
    run(
      cmake,
      [
        '-S',
        scratchDir,
        '-B',
        scratchBuildDir,
        `-DCMAKE_PREFIX_PATH=${installDir}`,
      ],
      { cwd: repoRoot, env }
    );
    run(cmake, ['--build', scratchBuildDir, '--target', stem], {
      cwd: repoRoot,
      env,
    });
    run(path.join(scratchBuildDir, stem), rest, { cwd: repoRoot, env });
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

function escapeCmakePath(value) {
  return value.replace(/\\/g, '/').replace(/"/g, '\\"');
}

async function runGo(examplePath, rest) {
  const outDir = languagePackageDir('go');
  const stem = path.basename(examplePath, path.extname(examplePath));
  const scratchDir = path.join(generatedRoot, 'go-run', stem);
  await rm(scratchDir, { recursive: true, force: true });
  await mkdir(scratchDir, { recursive: true });
  await writeFile(
    path.join(scratchDir, 'go.mod'),
    `module axllm_example_${stem}

go 1.22

require github.com/ax-llm/ax/go v0.0.0

replace github.com/ax-llm/ax/go => ${escapeGoModPath(outDir)}
`
  );
  await writeFile(
    path.join(scratchDir, 'main.go'),
    await readFile(examplePath)
  );
  run('go', ['run', '.', ...rest], { cwd: scratchDir, env });
}

function escapeGoModPath(value) {
  return value.replace(/\\/g, '/');
}

async function runRust(examplePath, rest) {
  const outDir = languagePackageDir('rust');
  const stem = path.basename(examplePath, path.extname(examplePath));
  const scratchDir = path.join(generatedRoot, 'rust-run', stem);
  await rm(scratchDir, { recursive: true, force: true });
  await mkdir(path.join(scratchDir, 'src'), { recursive: true });
  await writeFile(
    path.join(scratchDir, 'Cargo.toml'),
    `[package]
name = "axllm_example_${stem.replace(/[^A-Za-z0-9_]/g, '_')}"
version = "0.0.0"
edition = "2021"

[dependencies]
axllm = { path = "${escapeCargoTomlPath(outDir)}" }
serde_json = "1"
`
  );
  await writeFile(
    path.join(scratchDir, 'src', 'main.rs'),
    await readFile(examplePath)
  );
  run(
    'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      path.join(scratchDir, 'Cargo.toml'),
      ...rest,
    ],
    { cwd: scratchDir, env }
  );
}

function escapeCargoTomlPath(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function languagePackageDir(target) {
  const outDir = path.join(packagesRoot, target);
  if (!existsSync(outDir)) {
    throw new Error(
      `Committed AxIR package missing: packages/${target}. Run \`npm run axir:generate-packages\`.`
    );
  }
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
