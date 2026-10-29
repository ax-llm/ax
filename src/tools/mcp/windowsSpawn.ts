// cspell:ignore PATHEXT COMSPEC
import { statSync } from 'node:fs';
import path from 'node:path';

// Windows only runs .exe/.com directly; .cmd/.bat shims such as npx need
// cmd.exe, and Node refuses to spawn them without a shell (CVE-2024-27980).
// Lookup and escaping follow cross-spawn (lib/parse.js, lib/util/escape.js).

const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;

function windowsEnvValue(
  env: NodeJS.ProcessEnv,
  name: string
): string | undefined {
  // Node sorts keys and passes only the first case-insensitive match to the
  // child. Use the same value for lookup and escaping as the spawned process.
  const key = Object.keys(env)
    .sort()
    .find((key) => key.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export function escapeCommand(command: string): string {
  return command.replace(metaCharsRegExp, '^$1');
}

export function escapeArgument(arg: string, doubleEscape: boolean): string {
  // https://qntm.org/cmd: double the backslashes before a quote or the end.
  // cross-spawn 7.0.6's regex form doubles only the last one of a run.
  let escaped = '';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes++;
      continue;
    }
    const run = char === '"' ? backslashes * 2 + 1 : backslashes;
    escaped += `${'\\'.repeat(run)}${char}`;
    backslashes = 0;
  }
  escaped += '\\'.repeat(backslashes * 2);
  escaped = `"${escaped}"`.replace(metaCharsRegExp, '^$1');
  return doubleEscape ? escaped.replace(metaCharsRegExp, '^$1') : escaped;
}

function resolveCommand(
  command: string,
  env: NodeJS.ProcessEnv
): string | undefined {
  const dirs = /[\\/]/.test(command)
    ? ['']
    : [process.cwd(), ...(windowsEnvValue(env, 'PATH') ?? '').split(';')];
  const exts = (windowsEnvValue(env, 'PATHEXT') ?? '.EXE;.CMD;.BAT;.COM').split(
    ';'
  );
  if (command.includes('.') && exts[0] !== '') exts.unshift('');
  for (const dir of dirs) {
    const base = path.join(dir.replace(/^"(.*)"$/, '$1'), command);
    for (const ext of exts) {
      const file = base + ext;
      const isExecutable = exts.some(
        (e) => e !== '' && file.toLowerCase().endsWith(e.toLowerCase())
      );
      if (isExecutable && statSync(file, { throwIfNoEntry: false })?.isFile()) {
        return path.resolve(file);
      }
    }
  }
  return undefined;
}

/**
 * Returns the cmd.exe invocation for a command Windows can't spawn directly,
 * or undefined when it resolves to an .exe/.com.
 */
export function windowsShellCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): { command: string; args: string[] } | undefined {
  const file = resolveCommand(command, env);
  if (file && /\.(?:com|exe)$/i.test(file)) return undefined;
  // Batch files expand %* and parse it again, so their arguments need a
  // second level of escaping (cross-spawn only does this under
  // node_modules\.bin; npx.cmd and other shims live elsewhere).
  const doubleEscape = file !== undefined && /\.(?:bat|cmd)$/i.test(file);
  const commandLine = [
    escapeCommand(path.normalize(command)),
    ...args.map((arg) => escapeArgument(arg, doubleEscape)),
  ].join(' ');
  return {
    command: windowsEnvValue(env, 'COMSPEC') ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
  };
}
