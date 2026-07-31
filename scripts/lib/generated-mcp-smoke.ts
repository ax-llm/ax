import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const generatedMCPSmokeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

export type GeneratedMCPSmokeCommand = {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export async function buildGeneratedMCPSmoke(
  language: string,
  options: {
    smokeDirectory: string;
    outputName: string;
    javaSource: string;
    javaClass: string;
    rustBinary: string;
  }
): Promise<GeneratedMCPSmokeCommand> {
  const root = generatedMCPSmokeRoot;
  const smoke = path.join(
    root,
    'tools',
    'axir',
    'smoke',
    options.smokeDirectory
  );
  if (language === 'python') {
    return {
      command: 'python3',
      args: [path.join(smoke, 'python.py')],
      env: { PYTHONPATH: path.join(root, 'packages', 'python') },
    };
  }
  if (language === 'go') {
    const output = path.join('/tmp', `${options.outputName}-go`);
    checked('go', ['build', '-o', output, path.join(smoke, 'go.go')], {
      cwd: path.join(root, 'packages', 'go'),
      env: { GOCACHE: path.join('/tmp', `${options.outputName}-go-cache`) },
    });
    return { command: output, args: [] };
  }
  if (language === 'cpp') {
    const output = path.join('/tmp', `${options.outputName}-cpp`);
    checked('c++', [
      '-std=c++17',
      '-DAXLLM_ENABLE_CURL',
      '-I',
      path.join(root, 'packages', 'cpp', 'axllm'),
      path.join(root, 'packages', 'cpp', 'axllm', 'axllm.cpp'),
      path.join(root, 'packages', 'cpp', 'axllm', 'mcp.cpp'),
      path.join(smoke, 'cpp.cpp'),
      '-lcurl',
      '-o',
      output,
    ]);
    return { command: output, args: [] };
  }
  if (language === 'rust') {
    const target = path.join('/tmp', `${options.outputName}-rust-target`);
    checked('cargo', [
      'build',
      '--offline',
      '--manifest-path',
      path.join(smoke, 'Cargo.toml'),
      '--target-dir',
      target,
    ]);
    return {
      command: path.join(target, 'debug', options.rustBinary),
      args: [],
    };
  }
  if (language === 'java') {
    const output = path.join('/tmp', `${options.outputName}-java`);
    await mkdir(output, { recursive: true });
    const sources = await javaSources(
      path.join(root, 'packages', 'java', 'dev', 'axllm', 'ax'),
      false
    );
    const javaHome = [
      '/opt/homebrew/opt/openjdk/bin',
      '/usr/local/opt/openjdk/bin',
    ].find((directory) => existsSync(path.join(directory, 'javac')));
    const javac =
      process.env.JAVAC ?? (javaHome ? path.join(javaHome, 'javac') : 'javac');
    const java =
      process.env.JAVA ?? (javaHome ? path.join(javaHome, 'java') : 'java');
    checked(javac, [
      '-d',
      output,
      ...sources,
      path.join(smoke, options.javaSource),
    ]);
    return {
      command: java,
      args: ['-cp', output, options.javaClass],
    };
  }
  throw new Error(`Unsupported generated MCP smoke language: ${language}`);
}

export function checked(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? generatedMCPSmokeRoot,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? 'no status'}`);
  }
}

async function javaSources(
  directory: string,
  recursive = true
): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && recursive) {
      out.push(...(await javaSources(file)));
    } else if (entry.name.endsWith('.java')) out.push(file);
  }
  return out;
}
