import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true, // Enable code splitting for better tree-shaking
  clean: true,
  sourcemap: true,
  minify: true,
  platform: 'neutral', // Ensures browser compatibility
  target: 'es2022', // Modern target for better performance
  external: [
    // Keep dependencies external so consumers can choose how to bundle
    '@opentelemetry/api',
  ],
  // Ensure proper module resolution for different environments
  esbuildOptions(options) {
    options.conditions = ['module', 'import', 'require', 'default'];
  },
});
