import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxMCPEventDemoServer } from '../src/examples/mcp-event-demo-server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv
  .find((value) => value.startsWith('--languages='))
  ?.slice('--languages='.length)
  .split(',')
  .filter(Boolean);
const languages = requested ?? ['python', 'java', 'cpp', 'go', 'rust'];
const eras = ['legacy', 'modern'] as const;

for (const language of languages) {
  const command = await build(language);
  for (const era of eras) await runSmoke(language, era, command);
}

async function build(language: string): Promise<{
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}> {
  const smoke = path.join(root, 'tools', 'axir', 'smoke', 'mcp-event');
  if (language === 'python') {
    return {
      command: 'python3',
      args: [path.join(smoke, 'python.py')],
      env: { PYTHONPATH: path.join(root, 'packages', 'python') },
    };
  }
  if (language === 'go') {
    const output = path.join('/tmp', 'ax-generated-mcp-event-go');
    checked('go', ['build', '-o', output, path.join(smoke, 'go.go')], {
      cwd: path.join(root, 'packages', 'go'),
      env: { GOCACHE: '/tmp/ax-event-go-cache' },
    });
    return { command: output, args: [] };
  }
  if (language === 'cpp') {
    const output = path.join('/tmp', 'ax-generated-mcp-event-cpp');
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
    const target = path.join('/tmp', 'ax-generated-mcp-event-rust-target');
    checked('cargo', [
      'build',
      '--offline',
      '--manifest-path',
      path.join(smoke, 'Cargo.toml'),
      '--target-dir',
      target,
    ]);
    return {
      command: path.join(target, 'debug', 'ax-generated-mcp-event-smoke'),
      args: [],
    };
  }
  if (language === 'java') {
    const output = path.join('/tmp', 'ax-generated-mcp-event-java');
    await mkdir(output, { recursive: true });
    const sources = await javaSources(
      path.join(root, 'packages', 'java', 'dev', 'axllm', 'ax'),
      false
    );
    checked('javac', [
      '-d',
      output,
      ...sources,
      path.join(smoke, 'GeneratedMcpEventSmoke.java'),
    ]);
    return {
      command: 'java',
      args: ['-cp', output, 'GeneratedMcpEventSmoke'],
    };
  }
  throw new Error(`Unsupported generated MCP smoke language: ${language}`);
}

async function runSmoke(
  language: string,
  era: (typeof eras)[number],
  spec: {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<void> {
  const server = new AxMCPEventDemoServer({ era });
  const endpoint = await server.start();
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd ?? root,
    env: {
      ...process.env,
      ...spec.env,
      AX_MCP_ENDPOINT: endpoint,
      AX_MCP_SMOKE_ERA: era,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (value) => {
    stdout += String(value);
  });
  child.stderr?.on('data', (value) => {
    stderr += String(value);
  });
  try {
    await Promise.all([
      waitForOutput(child, () => stdout.includes('AX_MCP_SMOKE_READY')),
      server.waitForSubscription('demo://inventory'),
      server.waitForSubscription('demo://orders'),
      server.waitForListeningConnection(),
    ]);
    if (era === 'modern') {
      if (server.getMethodCount('initialize') !== 0)
        throw new Error('modern smoke sent legacy initialize');
      if (server.getMethodCount('server/discover') !== 1)
        throw new Error('modern smoke did not use one server/discover request');
      for (const method of [
        'tools/list',
        'prompts/list',
        'resources/list',
        'resources/templates/list',
      ]) {
        if (server.getMethodCount(method) !== 1)
          throw new Error(
            `modern cacheable catalog did not reuse ${method}: ${server.getMethodCount(method)} requests`
          );
      }
      if (server.getMethodCount('tasks/get') < 1)
        throw new Error(
          'modern task result was not flattened through tasks/get'
        );
      if (server.getMethodCount('tools/call') < 6)
        throw new Error(
          'modern roots and elicitation MRTR rounds or sampling violation probe did not complete'
        );
    }
    server.addResource();
    await server.waitForSubscription('demo://alerts');
    server.removeResource('demo://orders');
    await server.waitForUnsubscribe('demo://orders');
    const priorInventorySubscriptions =
      server.getSubscriptionCount('demo://inventory');
    const priorAlertSubscriptions =
      server.getSubscriptionCount('demo://alerts');
    server.dropListeningConnections();
    await server.waitForListeningConnection();
    await Promise.all([
      server.waitForSubscriptionCount(
        priorInventorySubscriptions + 1,
        'demo://inventory'
      ),
      server.waitForSubscriptionCount(
        priorAlertSubscriptions + 1,
        'demo://alerts'
      ),
    ]);
    server.updateResource();
    if (era === 'legacy') {
      const taskId = await server.waitForTask();
      server.completeTask(taskId);
    }
    await waitForExit(child, 25_000);
    if (!stdout.includes('AX_MCP_SMOKE_OK')) {
      throw new Error(`${language} smoke did not report success`);
    }
    console.log(`[generated-mcp-event] ${language}/${era}: pass`);
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    throw new Error(
      `${language}/${era} generated MCP event smoke failed: ${String(error)}\nsubscriptions/listen=${server.getMethodCount('subscriptions/listen')}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  } finally {
    await server.close();
  }
}

function checked(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
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
    if (entry.isDirectory() && recursive)
      out.push(...(await javaSources(file)));
    else if (entry.name.endsWith('.java')) out.push(file);
  }
  return out;
}

function waitForOutput(
  child: ChildProcess,
  predicate: () => boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('timed out waiting for smoke readiness')),
      20_000
    );
    const poll = setInterval(() => {
      if (!predicate()) return;
      clearInterval(poll);
      clearTimeout(timeout);
      resolve();
    }, 10);
    child.once('exit', (code) => {
      clearInterval(poll);
      clearTimeout(timeout);
      if (predicate()) resolve();
      else reject(new Error(`smoke exited before readiness with ${code}`));
    });
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(new Error(`smoke exited with ${child.exitCode}`));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timed out waiting for smoke completion'));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`smoke exited with ${code}`));
    });
  });
}
