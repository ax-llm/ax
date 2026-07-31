import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import {
  createServer as createHTTPServer,
  request as httpRequest,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxMCPClient } from '../src/ax/mcp/client.js';
import { AxMCPStreamableHTTPTransport } from '../src/ax/mcp/transports/httpStreamTransport.js';
import { AxMCPStdioTransport } from '../src/tools/mcp/stdioTransport.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const everythingServer = path.join(
  root,
  'node_modules',
  '@modelcontextprotocol',
  'server-everything',
  'dist',
  'index.js'
);
const requested = process.argv
  .find((value) => value.startsWith('--languages='))
  ?.slice('--languages='.length)
  .split(',')
  .filter(Boolean);
const languages = requested ?? ['python', 'java', 'cpp', 'go', 'rust'];

await runTypeScriptStdio();

const foreign = await startForeignHTTPServer();
try {
  foreign.reset();
  await runTypeScriptHTTP(foreign.endpoint);
  assertForeignLegacyExchange('typescript/http', foreign.exchanges());
  console.log('[mcp-interop] typescript/http: pass');

  for (const language of languages) {
    const command = await build(language);
    foreign.reset();
    try {
      await runGenerated(language, command, foreign.endpoint);
    } catch (error) {
      throw new Error(
        `${String(error)}\nforeign exchanges:\n${summarizeExchanges(foreign.exchanges())}`
      );
    }
    assertForeignLegacyExchange(language, foreign.exchanges());
    console.log(`[mcp-interop] ${language}/http: pass`);
  }
} finally {
  await foreign.close();
}

function summarizeExchanges(exchanges: readonly HTTPExchange[]): string {
  return exchanges
    .map((exchange) => {
      const message = parseJSONRPC(exchange.requestBody);
      return JSON.stringify({
        method: message?.method ?? exchange.method,
        requestHeaders: exchange.requestHeaders,
        statusCode: exchange.statusCode,
        responseHeaders: exchange.responseHeaders,
        responseBody: exchange.responseBody,
      });
    })
    .join('\n');
}

async function runTypeScriptStdio(): Promise<void> {
  const transport = new AxMCPStdioTransport({
    command: process.execPath,
    args: [everythingServer, 'stdio'],
  });
  const client = new AxMCPClient(transport, {
    namespace: 'foreign_stdio',
    era: 'auto',
  });
  try {
    const catalog = await client.inspectCatalog();
    assertCatalogAndEra('typescript/stdio', client, catalog);
    const result = await client.callTool('echo', {
      message: 'ax-interop-typescript-stdio',
    });
    assertEcho(result, 'ax-interop-typescript-stdio');
    await client.close();
    console.log('[mcp-interop] typescript/stdio: pass');
  } finally {
    await transport.terminate();
  }
}

async function runTypeScriptHTTP(endpoint: string): Promise<void> {
  const client = new AxMCPClient(
    new AxMCPStreamableHTTPTransport(endpoint, {
      ssrfProtection: {
        allowHTTP: true,
        allowLoopback: true,
        allowPrivateNetwork: true,
      },
    }),
    { namespace: 'foreign_http', era: 'auto', readCache: true }
  );
  try {
    const catalog = await client.inspectCatalog();
    assertCatalogAndEra('typescript/http', client, catalog);
    if (
      Object.values(catalog.cache).some(
        (entry) => entry?.expiresAt !== undefined
      )
    ) {
      throw new Error(
        'foreign legacy catalog unexpectedly produced modern cache expiry metadata'
      );
    }
    const result = await client.callTool('echo', {
      message: 'ax-interop-typescript-http',
    });
    assertEcho(result, 'ax-interop-typescript-http');
  } finally {
    await client.close();
  }
}

function assertCatalogAndEra(
  label: string,
  client: AxMCPClient,
  catalog: Awaited<ReturnType<AxMCPClient['inspectCatalog']>>
): void {
  if (client.getEra() !== 'legacy') {
    throw new Error(`${label} classified as ${client.getEra() ?? 'unknown'}`);
  }
  if (catalog.protocolVersion !== '2025-11-25') {
    throw new Error(
      `${label} negotiated ${catalog.protocolVersion ?? 'no protocol version'}`
    );
  }
  if (catalog.tools.length === 0) {
    throw new Error(`${label} returned an empty tool catalog`);
  }
  if (!catalog.tools.some((tool) => tool.name === 'echo')) {
    throw new Error(`${label} catalog did not contain the echo tool`);
  }
}

function assertEcho(result: unknown, message: string): void {
  if (!JSON.stringify(result).includes(`Echo: ${message}`)) {
    throw new Error(`foreign echo result mismatch: ${JSON.stringify(result)}`);
  }
}

interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

async function build(language: string): Promise<CommandSpec> {
  const smoke = path.join(root, 'tools', 'axir', 'smoke', 'mcp-interop');
  if (language === 'python') {
    return {
      command: 'python3',
      args: [path.join(smoke, 'python.py')],
      env: { PYTHONPATH: path.join(root, 'packages', 'python') },
    };
  }
  if (language === 'go') {
    const output = path.join('/tmp', 'ax-generated-mcp-interop-go');
    checked('go', ['build', '-o', output, path.join(smoke, 'go.go')], {
      cwd: path.join(root, 'packages', 'go'),
      env: { GOCACHE: '/tmp/ax-interop-go-cache' },
    });
    return { command: output, args: [] };
  }
  if (language === 'cpp') {
    const output = path.join('/tmp', 'ax-generated-mcp-interop-cpp');
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
    const target = path.join('/tmp', 'ax-generated-mcp-interop-rust-target');
    checked('cargo', [
      'build',
      '--offline',
      '--manifest-path',
      path.join(smoke, 'Cargo.toml'),
      '--target-dir',
      target,
    ]);
    return {
      command: path.join(target, 'debug', 'ax-generated-mcp-interop-smoke'),
      args: [],
    };
  }
  if (language === 'java') {
    const output = path.join('/tmp', 'ax-generated-mcp-interop-java');
    await mkdir(output, { recursive: true });
    const sources = await javaSources(
      path.join(root, 'packages', 'java', 'dev', 'axllm', 'ax'),
      false
    );
    checked('javac', [
      '-d',
      output,
      ...sources,
      path.join(smoke, 'GeneratedMcpInteropSmoke.java'),
    ]);
    return {
      command: 'java',
      args: ['-cp', output, 'GeneratedMcpInteropSmoke'],
    };
  }
  throw new Error(`Unsupported generated MCP interop language: ${language}`);
}

async function runGenerated(
  language: string,
  spec: CommandSpec,
  endpoint: string
): Promise<void> {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd ?? root,
    env: { ...process.env, ...spec.env, AX_MCP_ENDPOINT: endpoint },
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
    await waitForOutput(child, () => stdout.includes('AX_MCP_INTEROP_READY'));
    await waitForExit(child, 25_000);
    if (!stdout.includes('AX_MCP_INTEROP_OK')) {
      throw new Error(`${language} did not report success`);
    }
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    throw new Error(
      `${language} generated MCP interop failed: ${String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  }
}

interface HTTPExchange {
  method: string;
  requestHeaders: Readonly<Record<string, string | string[] | undefined>>;
  requestBody: string;
  responseHeaders?: Readonly<Record<string, string | string[] | undefined>>;
  responseBody?: string;
  statusCode?: number;
}

async function startForeignHTTPServer(): Promise<{
  endpoint: string;
  exchanges: () => readonly HTTPExchange[];
  reset: () => void;
  close: () => Promise<void>;
}> {
  const port = await reservePort();
  const child = spawn(process.execPath, [everythingServer, 'streamableHttp'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout?.on('data', (value) => {
    serverOutput += String(value);
  });
  child.stderr?.on('data', (value) => {
    serverOutput += String(value);
  });
  await waitForOutput(child, () => serverOutput.includes('listening on port'));

  const recorded: HTTPExchange[] = [];
  const proxy = createHTTPServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const exchange: HTTPExchange = {
        method: request.method ?? 'GET',
        requestHeaders: { ...request.headers },
        requestBody: body.toString('utf8'),
      };
      recorded.push(exchange);
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: request.url,
          method: request.method,
          headers: stripHopByHopHeaders({
            ...request.headers,
            host: `127.0.0.1:${port}`,
          }),
        },
        (upstreamResponse) => {
          exchange.statusCode = upstreamResponse.statusCode;
          exchange.responseHeaders = { ...upstreamResponse.headers };
          response.writeHead(upstreamResponse.statusCode ?? 500, {
            ...stripHopByHopHeaders(upstreamResponse.headers),
          });
          const responseChunks: Buffer[] = [];
          upstreamResponse.on('data', (chunk) => {
            const value = Buffer.from(chunk);
            if (
              responseChunks.reduce((sum, item) => sum + item.length, 0) <
              1_000_000
            ) {
              responseChunks.push(value);
            }
            response.write(value);
          });
          upstreamResponse.on('end', () => {
            exchange.responseBody =
              Buffer.concat(responseChunks).toString('utf8');
            response.end();
          });
        }
      );
      upstream.on('error', (error) => response.destroy(error));
      request.on('aborted', () => upstream.destroy());
      upstream.end(body);
    });
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', () => resolve());
  });
  const proxyPort = (proxy.address() as AddressInfo).port;

  return {
    endpoint: `http://127.0.0.1:${proxyPort}/mcp`,
    exchanges: () => [...recorded],
    reset: () => recorded.splice(0, recorded.length),
    close: async () => {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      if (child.exitCode === null) child.kill('SIGINT');
      try {
        await waitForExit(child, 2_000);
      } catch {
        child.kill('SIGKILL');
        await waitForExit(child, 2_000);
      }
    },
  };
}

function stripHopByHopHeaders<T extends Record<string, unknown>>(
  headers: T
): T {
  const out = { ...headers };
  for (const name of [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]) {
    delete out[name];
  }
  return out;
}

function assertForeignLegacyExchange(
  label: string,
  exchanges: readonly HTTPExchange[]
): void {
  const requests = exchanges
    .filter((exchange) => exchange.requestBody)
    .map((exchange) => ({
      exchange,
      message: parseJSONRPC(exchange.requestBody),
    }))
    .filter(
      (
        value
      ): value is {
        exchange: HTTPExchange;
        message: Record<string, unknown>;
      } => value.message !== undefined
    );
  const methods = requests.map((value) => value.message.method);
  for (const expected of [
    'server/discover',
    'initialize',
    'tools/list',
    'tools/call',
  ]) {
    if (!methods.includes(expected)) {
      throw new Error(
        `${label} did not send ${expected}: ${methods.join(', ')}`
      );
    }
  }
  const initialized = requests.find(
    (value) => value.message.method === 'initialize'
  );
  if (!initialized?.exchange.responseHeaders?.['mcp-session-id']) {
    throw new Error(`${label} did not receive the foreign MCP session header`);
  }
  for (const method of ['tools/list', 'tools/call']) {
    const current = requests.find((value) => value.message.method === method);
    if (
      current?.exchange.requestHeaders['mcp-protocol-version'] !== '2025-11-25'
    ) {
      throw new Error(`${label} omitted MCP-Protocol-Version on ${method}`);
    }
    if (!current.exchange.requestHeaders['mcp-session-id']) {
      throw new Error(`${label} omitted MCP-Session-Id on ${method}`);
    }
  }
  const list = requests.find((value) => value.message.method === 'tools/list');
  if (
    list?.exchange.responseBody?.includes('"ttlMs"') ||
    list?.exchange.responseBody?.includes('"cacheScope"')
  ) {
    throw new Error(
      `${label} foreign legacy catalog unexpectedly carried modern cache metadata`
    );
  }
}

function parseJSONRPC(body: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function reservePort(): Promise<number> {
  const server = createHTTPServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
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
      () => reject(new Error('timed out waiting for process readiness')),
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
      else reject(new Error(`process exited before readiness with ${code}`));
    });
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(new Error(`process exited with ${child.exitCode}`));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('timed out waiting for process exit')),
      timeoutMs
    );
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`process exited with ${code}`));
    });
  });
}
