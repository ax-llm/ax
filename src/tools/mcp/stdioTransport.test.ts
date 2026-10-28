import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AxMCPStdioTransport,
  axCreateMCPStdioTransport,
} from './stdioTransport.js';
import {
  escapeArgument,
  escapeCommand,
  windowsShellCommand,
} from './windowsSpawn.js';

const transports: AxMCPStdioTransport[] = [];
const request = { jsonrpc: '2.0' as const, id: 1, method: 'test' };
const notification = { jsonrpc: '2.0' as const, method: 'test' };
const response = { jsonrpc: '2.0' as const, id: 1, result: {} };

function createTransport(script: string): AxMCPStdioTransport {
  const transport = new AxMCPStdioTransport({
    command: process.execPath,
    args: ['-e', script],
  });
  transports.push(transport);
  return transport;
}

function getChild(
  transport: AxMCPStdioTransport
): ChildProcessWithoutNullStreams {
  return (transport as unknown as { process: ChildProcessWithoutNullStreams })
    .process;
}

afterEach(async () => {
  await Promise.all(
    transports.splice(0).map((transport) => transport.terminate())
  );
});

describe('AxMCPStdioTransport', () => {
  it('creates transport instances and waits for the live child to close', async () => {
    const transport = createTransport('setInterval(() => {}, 1000)');
    expect(transport).toBeInstanceOf(AxMCPStdioTransport);
    await transport.terminate();
    expect(getChild(transport).signalCode).toBe('SIGTERM');
  });

  it('creates transport with the factory function', async () => {
    const transport = axCreateMCPStdioTransport({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    transports.push(transport);
    expect(transport).toBeInstanceOf(AxMCPStdioTransport);
    await transport.terminate();
  });

  it('resolves a response before the child exits', async () => {
    const transport = createTransport(`
      require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const request = JSON.parse(line);
        console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } }));
      });
    `);
    await expect(transport.send(request)).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
  });

  it('rejects every pending request and clears them when the child exits', async () => {
    const transport = createTransport(`
      process.stdin.once('data', () => process.exit(1));
      process.stdin.resume();
    `);
    await Promise.all([
      expect(transport.send(request)).rejects.toThrow(
        'MCP server process exited'
      ),
      expect(transport.send({ ...request, id: 2 })).rejects.toThrow(
        'MCP server process exited'
      ),
    ]);
    expect(
      (transport as unknown as { pendingResponses: Map<unknown, unknown> })
        .pendingResponses.size
    ).toBe(0);
    await transport.terminate();
    await transport.terminate();
  });

  it('rejects requests after an already-exited child and terminates repeatedly', async () => {
    const transport = createTransport('process.exit(0)');
    await once(getChild(transport), 'close');
    await expect(transport.send(request)).rejects.toThrow('not running');
    await expect(transport.sendNotification(notification)).rejects.toThrow(
      'not running'
    );
    await expect(transport.sendResponse(response)).rejects.toThrow(
      'not running'
    );
    await transport.terminate();
    await transport.terminate();
  });

  it('settles pending sends and termination when spawning fails', async () => {
    const transport = new AxMCPStdioTransport({
      command: `${process.execPath}-missing-mcp-server`,
    });
    transports.push(transport);
    await expect(transport.send(request)).rejects.toThrow();
    await transport.terminate();
  });

  it('terminates a live child after stdin fails', async () => {
    const transport = createTransport(`
      require('node:fs').closeSync(0);
      console.log(JSON.stringify({ jsonrpc: '2.0', method: 'ready' }));
      setInterval(() => {}, 1000);
    `);
    const child = getChild(transport);
    await once(child.stdout, 'data');
    const failedWrite = once(child.stdin, 'error');
    const rejected = expect(transport.send(request)).rejects.toThrow();
    await failedWrite;
    await rejected;
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    await transport.terminate();
    expect(child.killed).toBe(true);
    expect(child.signalCode).toBe('SIGTERM');
    await expect(transport.sendNotification(notification)).rejects.toThrow(
      'not running'
    );
  });

  it('rejects requests immediately when termination starts', async () => {
    const transport = createTransport('setInterval(() => {}, 1000)');
    const pending = expect(transport.send(request)).rejects.toThrow(
      'terminated'
    );
    const termination = transport.terminate();
    await pending;
    await expect(transport.send(request)).rejects.toThrow('not running');
    await expect(transport.sendResponse(response)).rejects.toThrow(
      'not running'
    );
    await termination;
  });
});

describe('Windows command escaping', () => {
  it('escapes cmd.exe metacharacters in the command', () => {
    expect(escapeCommand(String.raw`C:\Program Files\nodejs\npx.cmd`)).toBe(
      String.raw`C:\Program^ Files\nodejs\npx.cmd`
    );
  });

  it('quotes arguments and escapes metacharacters once or twice', () => {
    expect(escapeArgument('a b', false)).toBe('^"a^ b^"');
    expect(escapeArgument('& echo pwned', false)).toBe('^"^&^ echo^ pwned^"');
    expect(escapeArgument('%PATH%', true)).toBe('^^^"^^^%PATH^^^%^^^"');
  });

  it('escapes quotes and the backslashes before them', () => {
    expect(escapeArgument('a"b', false)).toBe(String.raw`^"a\^"b^"`);
    expect(escapeArgument(String.raw`a\\"b`, false)).toBe(
      String.raw`^"a\\\\\^"b^"`
    );
    expect(escapeArgument('trail\\\\', false)).toBe(String.raw`^"trail\\\\^"`);
  });
});

describe.runIf(process.platform === 'win32')(
  'AxMCPStdioTransport on Windows',
  () => {
    it('spawns .exe commands directly', () => {
      expect(windowsShellCommand('node', [], process.env)).toBeUndefined();
    });

    it('runs .cmd servers with arguments passed through unchanged', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ax-mcp-'));
      try {
        const server = `
        require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
          const request = JSON.parse(line);
          console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: process.argv.slice(2) }));
        });
      `;
        writeFileSync(join(dir, 'server.js'), server);
        writeFileSync(
          join(dir, 'mcp-server.cmd'),
          `@"${process.execPath}" "%~dp0server.js" %*\r\n`
        );
        const args = [
          'with space',
          'a"b',
          '%PATH%',
          '^',
          '& echo pwned',
          '"&echo pwned&rem "',
          '| <nul > out.txt (x)',
          'trail\\\\',
          '',
        ];
        const pathKey =
          Object.keys(process.env).find(
            (key) => key.toUpperCase() === 'PATH'
          ) ?? 'PATH';
        const transport = new AxMCPStdioTransport({
          command: 'mcp-server',
          args,
          env: { [pathKey]: `${dir};${process.env[pathKey]}` },
        });
        transports.push(transport);
        await expect(transport.send(request)).resolves.toEqual({
          jsonrpc: '2.0',
          id: 1,
          result: args,
        });
        await transport.terminate();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
);
