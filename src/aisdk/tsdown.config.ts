import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  fixedExtension: false,
  deps: { neverBundle: ['react'] },
  outputOptions: { codeSplitting: false },
  clean: true,
  sourcemap: true,
  minify: false,
});
