import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  clean: true,
  sourcemap: true,
  minify: false,
});
