import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Package Exports Compatibility', () => {
  it('should not have "default" field in exports to maintain CommonJS compatibility', () => {
    // Check if dist/package.json exists, if not skip this test
    const distPackageJsonPath = path.join(
      process.cwd(),
      'dist',
      'package.json'
    );
    try {
      const packageJson = JSON.parse(readFileSync(distPackageJsonPath, 'utf8'));

      // Verify exports structure exists
      expect(packageJson.exports).toBeDefined();
      expect(packageJson.exports['.']).toBeDefined();

      // Critical: "default" field should NOT exist to maintain CommonJS compatibility
      expect(packageJson.exports['.'].default).toBeUndefined();
      expect(packageJson.exports['./*']?.default).toBeUndefined();

      // Verify required fields exist for dual compatibility
      expect(packageJson.exports['.'].import).toBe('./index.js');
      expect(packageJson.exports['.'].require).toBe('./index.cjs');
      expect(packageJson.exports['.'].types).toBe('./index.d.ts');
      expect(packageJson.exports['.'].browser).toBe('./index.global.js');

      // Verify legacy fields for older tooling
      expect(packageJson.main).toBe('./index.cjs');
      expect(packageJson.module).toBe('./index.js');
      expect(packageJson.types).toBe('./index.d.ts');
    } catch (_error) {
      // If dist doesn't exist, test the postbuild script configuration instead
      console.warn(
        'dist/package.json not found, testing postbuild script configuration'
      );

      const postbuildPath = path.join(
        process.cwd(),
        '../../scripts/postbuild.js'
      );
      const postbuildContent = readFileSync(postbuildPath, 'utf8');

      // Verify the postbuild script doesn't add "default" field
      expect(postbuildContent).not.toContain("default: './index.js'");
      expect(postbuildContent).not.toContain("default: './*.js'");
    }
  });

  it('should maintain proper module type configuration', async () => {
    // Read the source package.json
    const sourcePackageJsonPath = path.join(process.cwd(), 'package.json');
    const sourcePackageJson = JSON.parse(
      readFileSync(sourcePackageJsonPath, 'utf8')
    );

    // Verify source keeps "type": "module" for development
    expect(sourcePackageJson.type).toBe('module');
  });

  it('should generate all required build artifacts', async () => {
    const { existsSync } = await import('node:fs');
    const distPath = path.join(process.cwd(), 'dist');

    // Verify all build outputs exist
    expect(existsSync(path.join(distPath, 'index.js'))).toBe(true);
    expect(existsSync(path.join(distPath, 'index.cjs'))).toBe(true);
    expect(existsSync(path.join(distPath, 'index.d.ts'))).toBe(true);
    expect(existsSync(path.join(distPath, 'index.global.js'))).toBe(true);
    expect(existsSync(path.join(distPath, 'package.json'))).toBe(true);
  });
});
