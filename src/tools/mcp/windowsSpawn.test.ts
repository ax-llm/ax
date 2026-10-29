// cspell:ignore PATHEXT Pathext COMSPEC
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escapeArgument, windowsShellCommand } from './windowsSpawn.js';

describe('Windows command environment', () => {
  let root: string;
  let batchDir: string;
  let exeDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ax-mcp-env-'));
    batchDir = join(root, 'batch');
    exeDir = join(root, 'exe');
    mkdirSync(batchDir);
    mkdirSync(exeDir);
    writeFileSync(join(batchDir, 'ax-env-server.CMD'), '');
    writeFileSync(join(exeDir, 'ax-env-server.EXE'), '');
    vi.stubEnv('PATHEXT', '.EXE');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const argument = 'literal&value';
  const batchCommandLine = `"ax-env-server ${escapeArgument(argument, true)}"`;

  it('uses the child PATHEXT when it differs from the parent', () => {
    const shell = windowsShellCommand('ax-env-server', [argument], {
      PATH: batchDir,
      PATHEXT: '.CMD',
    });
    expect(shell?.args).toEqual(['/d', '/s', '/c', batchCommandLine]);
  });

  it('accepts case-insensitive child environment keys', () => {
    const shell = windowsShellCommand('ax-env-server', [argument], {
      path: batchDir,
      Pathext: '.CMD',
      comspec: 'custom-cmd.exe',
    });
    expect(shell).toEqual({
      command: 'custom-cmd.exe',
      args: ['/d', '/s', '/c', batchCommandLine],
    });
  });

  it.each([false, true])(
    'matches Node PATH selection regardless of insertion order (reverse=%s)',
    (reverse) => {
      const paths = reverse
        ? { Path: batchDir, PATH: exeDir }
        : { PATH: exeDir, Path: batchDir };
      expect(
        windowsShellCommand('ax-env-server', [argument], {
          ...paths,
          PATHEXT: '.EXE;.CMD',
        })
      ).toBeUndefined();
    }
  );

  it('keeps batch escaping when the first PATH key points to a batch file', () => {
    const shell = windowsShellCommand('ax-env-server', [argument], {
      PATH: batchDir,
      Path: exeDir,
      PATHEXT: '.EXE;.CMD',
    });
    expect(shell?.args[3]).toBe(batchCommandLine);
  });

  it('matches Node selection for duplicate PATHEXT and ComSpec keys', () => {
    const shell = windowsShellCommand('ax-env-server', [argument], {
      PATH: batchDir,
      PATHEXT: '.CMD',
      Pathext: '.EXE',
      COMSPEC: 'first-cmd.exe',
      ComSpec: 'second-cmd.exe',
    });
    expect(shell).toEqual({
      command: 'first-cmd.exe',
      args: ['/d', '/s', '/c', batchCommandLine],
    });
  });
});
