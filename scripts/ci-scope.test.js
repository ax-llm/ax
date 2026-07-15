import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  axirMatrixPaths,
  changedFilesFromGit,
  coreTestPaths,
  isAxirMatrixPath,
  isCoreTestPath,
} from './ci-scope.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function filesUnder(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  return readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(repoRoot, path.join(entry.parentPath, entry.name))
        .replaceAll(path.sep, '/')
    );
}

describe('AxIR CI scope', () => {
  it('skips the generated-language matrix for a portable TS change with only a backlog entry', () => {
    expect(
      axirMatrixPaths([
        'docs/AXIR_BACKLOG.md',
        'ir/axir-backlog.json',
        'src/ax/ai/anthropic/api.test.ts',
        'src/ax/ai/anthropic/api.ts',
        'src/ax/ai/anthropic/types.ts',
      ])
    ).toEqual([]);
  });

  it.each([
    'ir/axcore/provider.axir',
    'ir/conformance/axai/provider-request.json',
    'tools/axir/internal/axir/codegen.go',
    'packages/python/axllm/agent.py',
    'packages/java/dev/axllm/ax/AxAgent.java',
    'packages/cpp/axllm/axllm.cpp',
    'packages/go/axllm.go',
    'packages/rust/src/lib.rs',
    'src/examples/python/generation/axgen-openai.py',
    'packages/python/README.md',
    'tools/axir/internal/axir/templates/pyodide/pyodideProfileReadme.md',
    'scripts/example-catalog.mjs',
    'scripts/generate-axir-packages.mjs',
    '.npmrc',
    '.github/workflows/ci.yml',
    'package-lock.json',
  ])('runs the generated-language matrix for %s', (filePath) => {
    expect(isAxirMatrixPath(filePath)).toBe(true);
  });

  it.each([
    'docs/AXIR_BACKLOG.md',
    'ir/axir-backlog.json',
    'ir/behavioral-parity-ledger.json',
    'ir/spec/backend.md',
    'src/ax/agent/agent.ts',
    'src/examples/typescript/agent.ts',
    'ir/conformance/axagent/README.md',
    'ir/axcore/agent.md',
    'tools/axir/skills/axir-language-backend/SKILL.md',
    'src/ax/agent/templates/README.md',
    'README.md',
  ])('does not run the generated-language matrix for %s', (filePath) => {
    expect(isAxirMatrixPath(filePath)).toBe(false);
  });

  it.each([
    'website/content-src/templates/concept-mcp.md',
    'website/static/css/site.css',
    'website/static/js/site.js',
    'docs/ARCHITECTURE.md',
    'src/ax/skills/ax-agent.md',
    'scripts/website-prepare.mjs',
    'typedoc.json',
    'ir/axir-backlog.json',
    'packages/python/README.md',
    'packages/python/API.md',
    'packages/python/skills/ax-python-agent/SKILL.md',
    'src/aisdk/README.md',
  ])('skips the core build and workspace tests for %s', (filePath) => {
    expect(isCoreTestPath(filePath)).toBe(false);
  });

  it.each([
    'src/ax/ai/anthropic/api.ts',
    'src/examples/typescript/agent.ts',
    'src/ax/agent/templates/rlm/executor.md',
    'src/ax/agent/templates/README.md',
    'tools/axir/internal/axir/codegen.go',
    'tools/axir/internal/axir/templates/pyodide/pyodideProfileReadme.md',
    'tools/axir/internal/axir/templates/README.md',
    'scripts/run-example.mjs',
    'package.json',
    '.github/workflows/ci.yml',
  ])('runs the core build and workspace tests for %s', (filePath) => {
    expect(isCoreTestPath(filePath)).toBe(true);
  });

  it('runs core tests when a documentation change is mixed with code', () => {
    expect(
      coreTestPaths([
        'website/content-src/templates/concept-mcp.md',
        'src/ax/mcp/client.ts',
      ])
    ).toEqual(['src/ax/mcp/client.ts']);
  });

  it('classifies every generated package and example root as AxIR matrix input', () => {
    const languages = readdirSync(path.join(repoRoot, 'packages'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(languages).toEqual(
      expect.arrayContaining(['cpp', 'go', 'java', 'python', 'rust'])
    );
    for (const language of languages) {
      expect(isAxirMatrixPath(`packages/${language}/sentinel`)).toBe(true);
      expect(isAxirMatrixPath(`src/examples/${language}/sentinel`)).toBe(true);
    }
  });

  it('keeps every runtime prompt Markdown file in core CI scope', () => {
    const prompts = filesUnder('src/ax/agent/templates').filter((filePath) =>
      filePath.endsWith('.md')
    );

    expect(prompts).not.toHaveLength(0);
    for (const prompt of prompts) {
      expect(isCoreTestPath(prompt)).toBe(true);
    }
  });

  it('keeps every embedded AxIR Markdown template in full CI scope', () => {
    const templates = filesUnder('tools/axir/internal/axir/templates').filter(
      (filePath) => filePath.endsWith('.md')
    );

    expect(templates).not.toHaveLength(0);
    for (const template of templates) {
      expect(isAxirMatrixPath(template)).toBe(true);
      expect(isCoreTestPath(template)).toBe(true);
    }
  });

  it('fails open to full CI when the diff base is unreachable', () => {
    expect(changedFilesFromGit('0'.repeat(40), 'HEAD')).toEqual([
      '.github/workflows/ci.yml',
    ]);
  });

  it('writes exact GitHub Actions outputs, including fail-open scope', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'ax-ci-scope-'));
    const scopeScript = path.join(repoRoot, 'scripts', 'ci-scope.mjs');
    const noChangesOutput = path.join(tempRoot, 'no-changes-output');
    const failOpenOutput = path.join(tempRoot, 'fail-open-output');

    try {
      execFileSync(
        process.execPath,
        [
          scopeScript,
          '--base',
          'HEAD',
          '--head',
          'HEAD',
          '--github-output',
          noChangesOutput,
        ],
        { cwd: repoRoot, stdio: 'pipe' }
      );
      expect(readFileSync(noChangesOutput, 'utf8')).toBe(
        'run_axir=false\nrun_core=false\n'
      );

      execFileSync(
        process.execPath,
        [
          scopeScript,
          '--base',
          '0'.repeat(40),
          '--head',
          'HEAD',
          '--github-output',
          failOpenOutput,
        ],
        { cwd: repoRoot, stdio: 'pipe' }
      );
      expect(readFileSync(failOpenOutput, 'utf8')).toBe(
        'run_axir=true\nrun_core=true\n'
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
