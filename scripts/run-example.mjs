#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPublicExampleCatalog,
  resolvePublicExample,
} from './example-catalog.mjs';

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
const publicExampleCatalog = await readPublicExampleCatalog({ repoRoot });

if (args.length === 0) usage(1);
if (args[0] === 'list') listExamples(publicExampleCatalog, args);

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

const example = resolveExample(language, exampleArg, publicExampleCatalog);

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
  npm run example -- typescript src/examples/typescript/generation/axgen-openai.ts
  npm run example -- python src/examples/python/generation/axgen-openai.py
  npm run example -- java src/examples/java/generation/AxGenOpenAIExample.java
  npm run example -- cpp src/examples/cpp/generation/axgen_openai.cpp
  npm run example -- go src/examples/go/generation/axgen_openai.go
  npm run example -- rust src/examples/rust/generation/axgen_openai.rs
  npm run example -- list
  npm run example -- list --json

You can also pass a full example path and let the runner infer the language.
Generated package fixtures under packages/<language>/examples can still be run by explicit path for verification.`);
  process.exit(code);
}

function listExamples(catalog, listArgs) {
  if (listArgs.includes('--json')) {
    console.log(JSON.stringify(catalog, null, 2));
    process.exit(0);
  }

  for (const [language, rows] of Object.entries(catalog.byLanguage)) {
    console.log(`${language}:`);
    for (const example of rows) {
      console.log(
        `  ${example.group.padEnd(14)} ${example.level.padEnd(12)} ${example.command.padEnd(82)} ${example.title} - ${example.description}`
      );
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

function resolveExample(language, exampleArg, catalog) {
  const publicExample = resolvePublicExample(catalog, language, exampleArg);
  if (publicExample) {
    return path.join(repoRoot, publicExample.sourcePath);
  }

  const ext = path.extname(exampleArg);
  const withExt =
    ext || !defaultExt[language]
      ? exampleArg
      : `${exampleArg}${defaultExt[language]}`;
  const candidates = [];

  if (path.isAbsolute(withExt)) candidates.push(withExt);
  candidates.push(path.resolve(process.cwd(), withExt));
  if (language !== 'ts') {
    candidates.push(path.join(packagesRoot, language, 'examples', withExt));
    if (language === 'go') {
      candidates.push(
        path.join(
          packagesRoot,
          'go',
          'examples',
          path.basename(withExt, '.go'),
          'main.go'
        )
      );
    }
    candidates.push(path.join(examplesRoot, languageDir[language], withExt));
  } else {
    candidates.push(path.join(examplesRoot, withExt));
    if (languageDir[language]) {
      candidates.push(path.join(examplesRoot, languageDir[language], withExt));
    }
  }

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

  // Agent examples use the in-process quickjs4j runtime; put it on the classpath.
  const extraCp = exampleNeedsJsRuntime(examplePath)
    ? resolveQuickjs4jClasspath()
    : '';
  const compileCp = extraCp ? `${outDir}${path.delimiter}${extraCp}` : outDir;
  const runCp = extraCp
    ? `${classesDir}${path.delimiter}${extraCp}`
    : classesDir;

  const sources = await javaBaseSources(outDir);
  sources.push(examplePath);
  run(javac, ['-cp', compileCp, '-d', classesDir, ...sources], {
    cwd: repoRoot,
    env,
  });

  run(java, ['-cp', runCp, className, ...rest], {
    cwd: repoRoot,
    env,
  });
}

async function runCpp(examplePath, rest) {
  const outDir = languagePackageDir('cpp');
  const stem = path.basename(examplePath, path.extname(examplePath));
  const cmake = findOptionalCommand(['cmake'], ['--version']);
  const wantsRuntime = exampleNeedsJsRuntime(examplePath);
  const qjs = wantsRuntime ? resolveQuickjsCppFlags() : null;

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

    const configureArgs = [
      '-S',
      outDir,
      '-B',
      buildDir,
      '-DAX_BUILD_EXAMPLES=OFF',
      '-DAX_BUILD_CONFORMANCE=OFF',
    ];
    if (wantsRuntime) {
      configureArgs.push(
        '-DAX_BUILD_QUICKJS_PROFILE=ON',
        `-DAX_QUICKJS_CFLAGS=${qjs.cflags}`,
        `-DAX_QUICKJS_LDFLAGS=${qjs.ldflags}`
      );
    }
    run(cmake, configureArgs, { cwd: repoRoot, env });
    run(cmake, ['--build', buildDir, '--target', 'axllm'], {
      cwd: repoRoot,
      env,
    });
    if (wantsRuntime) {
      run(cmake, ['--build', buildDir, '--target', 'axllm_quickjs'], {
        cwd: repoRoot,
        env,
      });
    }
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
target_link_libraries(${stem} PRIVATE ${wantsRuntime ? 'axllm::axllm_quickjs' : 'axllm::axllm'})
${wantsRuntime ? `target_compile_options(${stem} PRIVATE ${qjs.cflags})` : ''}
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
  const cppSources = [path.join(outDir, 'axllm', 'axllm.cpp')];
  const mcpSource = path.join(outDir, 'axllm', 'mcp.cpp');
  if (existsSync(mcpSource)) cppSources.push(mcpSource);
  const cxxArgs = ['-std=c++17', '-I', outDir];
  if (wantsRuntime) {
    cppSources.push(
      path.join(outDir, 'axllm', 'runtime', 'quickjs', 'quickjs_runtime.cpp')
    );
    cxxArgs.push(...qjs.cflags.split(/\s+/).filter(Boolean));
  }
  cxxArgs.push(...cppSources, examplePath, '-o', bin);
  if (wantsRuntime) cxxArgs.push(...qjs.ldflags.split(/\s+/).filter(Boolean));
  run(cxx, cxxArgs, { cwd: repoRoot, env });
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

require github.com/ax-llm/ax/packages/go v0.0.0

replace github.com/ax-llm/ax/packages/go => ${escapeGoModPath(outDir)}
`
  );
  await writeFile(
    path.join(scratchDir, 'main.go'),
    await readFile(examplePath)
  );
  // -mod=mod lets `go run` resolve the goja transitive dep (used by agent
  // examples) that the generated scratch go.mod does not pin; it is already in
  // the package's go.sum / module cache.
  run('go', ['run', '.', ...rest], {
    cwd: scratchDir,
    env: {
      ...env,
      GOFLAGS: [env.GOFLAGS, '-mod=mod'].filter(Boolean).join(' '),
    },
  });
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
axllm = { path = "${escapeCargoTomlPath(outDir)}"${exampleNeedsJsRuntime(examplePath) ? ', features = ["runtime-quickjs"]' : ''} }
serde_json = "1"
`
  );
  await writeFile(
    path.join(scratchDir, 'src', 'main.rs'),
    await readFile(examplePath)
  );
  const manifestPath = path.join(scratchDir, 'Cargo.toml');
  const args = ['run', '--quiet', '--manifest-path', manifestPath, ...rest];
  const result = spawnSync('cargo', args, {
    cwd: scratchDir,
    env,
    shell: false,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status === 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return;
  }
  run(
    'cargo',
    ['run', '--offline', '--quiet', '--manifest-path', manifestPath, ...rest],
    {
      cwd: scratchDir,
      env,
    }
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

function exampleNeedsJsRuntime(examplePath) {
  // Only agent examples drive the embedded JS runtime; non-agent examples
  // (generation, flows, ...) must not pull in the optional runtime build.
  return /\/(short|long)-agents\//.test(
    String(examplePath).replace(/\\/g, '/')
  );
}

function resolveQuickjs4jClasspath() {
  if (env.AXIR_QUICKJS4J_CP) return env.AXIR_QUICKJS4J_CP;
  const script = path.join(
    packagesRoot,
    'java',
    'examples',
    'runtime_profiles',
    'resolve_quickjs4j_cp.sh'
  );
  const result = spawnSync('sh', [script], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to resolve the quickjs4j classpath for Java agent examples (set AXIR_QUICKJS4J_CP to skip):\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
}

function resolveQuickjsCppFlags() {
  let cflags = env.AXIR_QUICKJS_CFLAGS || env.AX_QUICKJS_CFLAGS || '';
  let ldflags = env.AXIR_QUICKJS_LDFLAGS || env.AX_QUICKJS_LDFLAGS || '';
  if (!cflags || !ldflags) {
    // Auto-detect a Homebrew QuickJS install (matches the runtime_profiles README).
    const prefix = ['/opt/homebrew/opt/quickjs', '/usr/local/opt/quickjs'].find(
      (p) => existsSync(path.join(p, 'include', 'quickjs', 'quickjs.h'))
    );
    if (prefix) {
      cflags = cflags || `-I${prefix}/include/quickjs`;
      ldflags =
        ldflags || `${prefix}/lib/quickjs/libquickjs.a -lm -ldl -pthread`;
    }
  }
  if (!cflags || !ldflags) {
    throw new Error(
      'QuickJS headers/libraries not found for the C++ agent example. Set AXIR_QUICKJS_CFLAGS and AXIR_QUICKJS_LDFLAGS (see packages/cpp/examples/runtime_profiles/README.md).'
    );
  }
  return { cflags, ldflags };
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
