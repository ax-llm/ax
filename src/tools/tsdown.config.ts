import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['index.ts', 'event/sqlite.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  platform: 'neutral', // Ensures browser compatibility
  target: 'es2022', // Modern target for better performance
  deps: { neverBundle: ['@opentelemetry/api', 'better-sqlite3', /^node:/] },
  inputOptions: {
    resolve: { conditionNames: ['module', 'import', 'require', 'default'] },
  },
});
