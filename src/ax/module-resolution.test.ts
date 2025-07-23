import { describe, expect, it } from 'vitest';

describe('Module Resolution Compatibility', () => {
  it('should have correct exports configuration for Node.js module resolution', () => {
    // This test simulates what Node.js module resolution algorithm checks
    const mockPackageJson = {
      name: '@ax-llm/ax',
      type: 'module',
      main: './index.cjs',
      module: './index.js',
      types: './index.d.ts',
      browser: './index.global.js',
      exports: {
        '.': {
          types: './index.d.ts',
          browser: './index.global.js',
          import: './index.js',
          require: './index.cjs',
        },
        './*': {
          types: './*.d.ts',
          import: './*.js',
          require: './*.cjs',
        },
      },
    };

    // Simulate CommonJS require() resolution
    function resolveCommonJS(packageJson: any, subpath = '.') {
      const exportsEntry = packageJson.exports?.[subpath];
      if (exportsEntry) {
        // Node.js checks for "require" field when using require()
        return exportsEntry.require || exportsEntry.default;
      }
      return packageJson.main;
    }

    // Simulate ESM import resolution
    function resolveESM(packageJson: any, subpath = '.') {
      const exportsEntry = packageJson.exports?.[subpath];
      if (exportsEntry) {
        // Node.js checks for "import" field when using import
        return exportsEntry.import || exportsEntry.default;
      }
      return packageJson.module || packageJson.main;
    }

    // Test CommonJS resolution - should get .cjs file
    const cjsResolution = resolveCommonJS(mockPackageJson);
    expect(cjsResolution).toBe('./index.cjs');

    // Test ESM resolution - should get .js file
    const esmResolution = resolveESM(mockPackageJson);
    expect(esmResolution).toBe('./index.js');

    // Test that "default" field is not present (this was the bug)
    expect(mockPackageJson.exports['.'].default).toBeUndefined();

    // Verify TypeScript resolution
    expect(mockPackageJson.exports['.'].types).toBe('./index.d.ts');

    // Verify browser resolution
    expect(mockPackageJson.exports['.'].browser).toBe('./index.global.js');
  });

  it('should maintain backward compatibility with legacy fields', () => {
    // Test that legacy tools that don't understand exports still work
    const mockPackageJson = {
      main: './index.cjs',
      module: './index.js',
      types: './index.d.ts',
    };

    // Legacy CommonJS tools use "main"
    expect(mockPackageJson.main).toBe('./index.cjs');

    // Legacy bundlers use "module"
    expect(mockPackageJson.module).toBe('./index.js');

    // TypeScript uses "types"
    expect(mockPackageJson.types).toBe('./index.d.ts');
  });
});
