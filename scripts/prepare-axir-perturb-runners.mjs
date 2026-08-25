#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TARGETS,
  PERTURB_RUNNER_ROOT_ENV,
  prepareTargetRunner,
} from './axir-perturb-check.mjs';

export function selectPrepareTargets(args = []) {
  const requested = args.filter((arg) => !arg.startsWith('--'));
  const selected = requested.length > 0 ? requested : DEFAULT_TARGETS;
  const unknown = selected.filter(
    (target) => !DEFAULT_TARGETS.includes(target)
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unsupported AxIR perturbation target(s): ${[...new Set(unknown)].join(', ')}. Expected one or more of: ${DEFAULT_TARGETS.join(', ')}.`
    );
  }
  return DEFAULT_TARGETS.filter((target) => selected.includes(target));
}

async function main(args = process.argv.slice(2)) {
  const configuredRoot = process.env[PERTURB_RUNNER_ROOT_ENV];
  if (!configuredRoot) {
    throw new Error(
      `${PERTURB_RUNNER_ROOT_ENV} must point to a job-local directory shared by both perturbation gates.`
    );
  }
  const runnerRoot = path.resolve(configuredRoot);
  const targets = selectPrepareTargets(args);
  mkdirSync(runnerRoot, { recursive: true });

  for (const target of targets) {
    const outDir = path.join(runnerRoot, target);
    if (existsSync(outDir)) {
      throw new Error(
        `Refusing to overwrite prepared AxIR runner at ${outDir}`
      );
    }
    const startedAt = performance.now();
    console.log(`[prepare] ${target} runner at ${outDir}`);
    await prepareTargetRunner(target, outDir);
    console.log(
      `[prepared] ${target} ${((performance.now() - startedAt) / 1000).toFixed(1)}s`
    );
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
