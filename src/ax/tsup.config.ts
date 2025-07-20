import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm', 'cjs', 'iife'],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  minify: true,
  platform: 'neutral', // Ensures browser compatibility
  target: 'es2022', // Modern target for better performance
  globalName: 'ax', // Global variable name for IIFE
  external: [
    // Keep OpenTelemetry external, bundle dayjs to fix plugin resolution
    '@opentelemetry/api',
  ],
  // Ensure proper module resolution for different environments
  esbuildOptions(options) {
    options.conditions = ['module', 'import', 'require', 'default'];
  },
});
