#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const siteRoot = path.join(repoRoot, 'website-md');
const destination = path.join(siteRoot, 'public');

const result = spawnSync(
  'hugo',
  [
    '--source',
    siteRoot,
    '--destination',
    destination,
    '--environment',
    'production',
    '--cleanDestinationDir',
    '--printPathWarnings',
    '--minify',
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  }
);

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error(
      'Hugo is required for website-md builds. Install Hugo v0.162.0 or run in CI.'
    );
  }
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const indexHtml = await readFile(path.join(destination, 'index.html'), 'utf8');
if (indexHtml.includes('livereload.js')) {
  console.error(
    'website-md production build unexpectedly includes livereload.'
  );
  process.exit(1);
}
