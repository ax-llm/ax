import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Postbuild Script', () => {
  const testDir = path.join(__dirname, 'test-output');
  const originalCwd = process.cwd();

  beforeEach(() => {
    // Create test directory
    mkdirSync(testDir, { recursive: true });
    mkdirSync(path.join(testDir, 'dist'), { recursive: true });

    // Create a test package.json
    const testPackageJson = {
      name: '@ax-llm/ax-test',
      version: '1.0.0',
      type: 'module',
      description: 'Test package',
      devDependencies: {
        typescript: '^5.0.0',
      },
      scripts: {
        build: 'echo build',
      },
    };

    writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(testPackageJson, null, 2)
    );

    // Change to test directory
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore original directory
    process.chdir(originalCwd);

    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should generate package.json without "default" field in exports', async () => {
    // Import and run the postbuild script
    const postbuildPath = path.join(__dirname, 'postbuild.js');
    const { execSync } = await import('node:child_process');

    // Run the postbuild script
    execSync(`node ${postbuildPath}`, { cwd: testDir });

    // Read the generated package.json
    const generatedPackageJson = JSON.parse(
      readFileSync(path.join(testDir, 'dist', 'package.json'), 'utf8')
    );

    // Verify exports structure
    expect(generatedPackageJson.exports).toBeDefined();
    expect(generatedPackageJson.exports['.']).toBeDefined();

    // Critical: "default" field should NOT exist
    expect(generatedPackageJson.exports['.'].default).toBeUndefined();
    expect(generatedPackageJson.exports['./*']?.default).toBeUndefined();

    // Verify correct dual compatibility fields
    expect(generatedPackageJson.exports['.'].import).toBe('./index.js');
    expect(generatedPackageJson.exports['.'].require).toBe('./index.cjs');
    expect(generatedPackageJson.exports['.'].types).toBe('./index.d.ts');
    expect(generatedPackageJson.exports['.'].browser).toBe('./index.global.js');

    // Verify legacy fields
    expect(generatedPackageJson.main).toBe('./index.cjs');
    expect(generatedPackageJson.module).toBe('./index.js');
    expect(generatedPackageJson.types).toBe('./index.d.ts');
    expect(generatedPackageJson.browser).toBe('./index.global.js');

    // Verify cleanup
    expect(generatedPackageJson.devDependencies).toBeUndefined();
    expect(generatedPackageJson.scripts).toBeUndefined();
  });
});
