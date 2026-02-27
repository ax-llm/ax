import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../..');
const compilerScript = resolve(repoRoot, 'scripts/buildPromptTemplates.mjs');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ax-templates-'));
  tempDirs.push(dir);
  return dir;
}

function runCompiler(args: string[]): string {
  return execFileSync(process.execPath, [compilerScript, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runCompilerExpectFailure(args: string[]): string {
  try {
    runCompiler(args);
    throw new Error('Expected compiler to fail');
  } catch (error) {
    if (error instanceof Error && 'stderr' in error) {
      const stderr = String((error as any).stderr ?? '');
      const stdout = String((error as any).stdout ?? '');
      return `${stdout}\n${stderr}\n${error.message}`;
    }
    return String(error);
  }
}

describe('buildPromptTemplates script', () => {
  it('resolves single and nested includes', () => {
    const root = createTempDir();
    const templateDir = join(root, 'templates');
    const partialDir = join(templateDir, 'partials');
    mkdirSync(partialDir, { recursive: true });

    writeFileSync(
      join(templateDir, 'main.md'),
      'Hello\n{{ include "./partials/header.md" }}\nDone\n',
      'utf8'
    );

    writeFileSync(
      join(partialDir, 'header.md'),
      '{{ include "./nested.md" }}\nBody\n',
      'utf8'
    );

    writeFileSync(join(partialDir, 'nested.md'), 'Nested\n', 'utf8');

    const outputFile = join(root, 'templates.generated.ts');
    runCompiler(['--template-dir', templateDir, '--output', outputFile]);

    const generated = readFileSync(outputFile, 'utf8');
    expect(generated).toContain("'main.md'");
    expect(generated).toContain('Hello\\nNested\\n\\nBody\\n\\nDone\\n');
    expect(generated).not.toContain('{{ include');
  });

  it('detects include cycles with readable chain', () => {
    const root = createTempDir();
    const templateDir = join(root, 'templates');
    mkdirSync(templateDir, { recursive: true });

    writeFileSync(
      join(templateDir, 'a.md'),
      '{{ include "./b.md" }}\n',
      'utf8'
    );
    writeFileSync(
      join(templateDir, 'b.md'),
      '{{ include "./a.md" }}\n',
      'utf8'
    );

    const outputFile = join(root, 'templates.generated.ts');
    const error = runCompilerExpectFailure([
      '--template-dir',
      templateDir,
      '--output',
      outputFile,
    ]);

    expect(error).toContain('Include cycle detected');
    expect(error).toContain('a.md -> b.md -> a.md');
  });

  it('fails on missing includes with file and line', () => {
    const root = createTempDir();
    const templateDir = join(root, 'templates');
    mkdirSync(templateDir, { recursive: true });

    writeFileSync(
      join(templateDir, 'main.md'),
      'Line 1\n{{ include "./missing.md" }}\n',
      'utf8'
    );

    const outputFile = join(root, 'templates.generated.ts');
    const error = runCompilerExpectFailure([
      '--template-dir',
      templateDir,
      '--output',
      outputFile,
    ]);

    expect(error).toContain("Missing include './missing.md'");
    expect(error).toContain('main.md:2:1');
  });

  it('fails --check when output is stale', () => {
    const root = createTempDir();
    const templateDir = join(root, 'templates');
    mkdirSync(templateDir, { recursive: true });

    writeFileSync(join(templateDir, 'main.md'), 'Current template\n', 'utf8');

    const outputFile = join(root, 'templates.generated.ts');
    writeFileSync(outputFile, '// stale\n', 'utf8');

    const error = runCompilerExpectFailure([
      '--template-dir',
      templateDir,
      '--output',
      outputFile,
      '--check',
    ]);

    expect(error).toContain('Template output is stale');
  });
});
