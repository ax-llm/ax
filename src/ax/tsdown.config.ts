import { defineConfig } from 'tsdown';

const shared = {
  entry: ['index.ts'],
  clean: true,
  sourcemap: true,
  minify: true,
  platform: 'neutral' as const,
  target: 'es2022',
  outputOptions: { codeSplitting: false },
  inputOptions: {
    resolve: { conditionNames: ['module', 'import', 'require', 'default'] },
  },
};

export default defineConfig([
  {
    ...shared,
    format: ['esm', 'cjs'],
    dts: true,
    deps: { neverBundle: ['@opentelemetry/api'] },
  },
  {
    ...shared,
    format: 'iife',
    dts: false,
    globalName: 'ax',
    deps: { alwaysBundle: ['@opentelemetry/api'] },
    outputOptions: {
      codeSplitting: false,
      entryFileNames: '[name].global.js',
    },
  },
]);
