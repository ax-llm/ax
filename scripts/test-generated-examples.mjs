#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicExampleCatalog } from './example-catalog.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runner = path.join(repoRoot, 'scripts', 'run-example.mjs');

export const GENERATED_EXAMPLE_TARGETS = [
  'python',
  'java',
  'cpp',
  'go',
  'rust',
];

export const generatedExamples = [
  ['python', 'signature_schema.py'],
  ['python', 'provider_mapping_no_key.py'],
  ['python', 'runtime_hooks_no_key.py'],
  ['python', 'provider_stream_no_key.py'],
  ['python', 'axgen_scripted_client_tool.py'],
  ['python', 'axflow_program_graph.py'],
  ['python', 'audio_responses_mapping.py'],
  ['python', 'realtime_audio_events.py'],
  ['python', 'runtime_adapter.py'],
  ['python', 'optimizer_artifact.py'],
  ['python', 'gepa_local_optimizer.py'],
  ['python', 'mcp_scripted_tools.py'],
  ['java', 'SignatureSchemaExample.java'],
  ['java', 'ProviderMappingNoKeyExample.java'],
  ['java', 'RuntimeHooksNoKeyExample.java'],
  ['java', 'ProviderStreamNoKeyExample.java'],
  ['java', 'AxGenScriptedClientToolExample.java'],
  ['java', 'AxFlowProgramGraphExample.java'],
  ['java', 'AudioResponsesMappingExample.java'],
  ['java', 'RealtimeAudioEventsExample.java'],
  ['java', 'RuntimeAdapterExample.java'],
  ['java', 'OptimizerArtifactExample.java'],
  ['java', 'GEPALocalOptimizerExample.java'],
  ['java', 'AxMCPScriptedToolsExample.java'],
  ['cpp', 'signature_schema.cpp'],
  ['cpp', 'provider_mapping_no_key.cpp'],
  ['cpp', 'runtime_hooks_no_key.cpp'],
  ['cpp', 'provider_stream_no_key.cpp'],
  ['cpp', 'axgen_scripted_client_tool.cpp'],
  ['cpp', 'axflow_program_graph.cpp'],
  ['cpp', 'audio_responses_mapping.cpp'],
  ['cpp', 'realtime_audio_events.cpp'],
  ['cpp', 'runtime_adapter.cpp'],
  ['cpp', 'optimizer_artifact.cpp'],
  ['cpp', 'gepa_local_optimizer.cpp'],
  ['cpp', 'mcp_scripted_tools.cpp'],
  ['go', 'signature_schema.go'],
  ['go', 'provider_mapping_no_key.go'],
  ['go', 'runtime_hooks_no_key.go'],
  ['go', 'provider_stream_no_key.go'],
  ['go', 'axgen_scripted_client_tool.go'],
  ['go', 'axflow_program_graph.go'],
  ['go', 'audio_responses_mapping.go'],
  ['go', 'realtime_audio_events.go'],
  ['go', 'runtime_adapter.go'],
  ['go', 'runtime_protocol.go'],
  ['go', 'optimizer_artifact.go'],
  ['go', 'gepa_local_optimizer.go'],
  ['go', 'mcp_scripted_tools.go'],
  ['rust', 'signature_schema.rs'],
  ['rust', 'provider_mapping_no_key.rs'],
  ['rust', 'runtime_hooks_no_key.rs'],
  ['rust', 'provider_stream_no_key.rs'],
  ['rust', 'axgen_scripted_client_tool.rs'],
  ['rust', 'axflow_program_graph.rs'],
  ['rust', 'audio_responses_mapping.rs'],
  ['rust', 'realtime_audio_events.rs'],
  ['rust', 'runtime_adapter.rs'],
  ['rust', 'runtime_protocol.rs'],
  ['rust', 'optimizer_artifact.rs'],
  ['rust', 'gepa_local_optimizer.rs'],
  ['rust', 'mcp_scripted_tools.rs'],
];

export function selectGeneratedExampleTargets(args = []) {
  const requested = args.length > 0 ? args : GENERATED_EXAMPLE_TARGETS;
  const unknown = requested.filter(
    (target) => !GENERATED_EXAMPLE_TARGETS.includes(target)
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unsupported generated-example target(s): ${[...new Set(unknown)].join(', ')}. Expected one or more of: ${GENERATED_EXAMPLE_TARGETS.join(', ')}.`
    );
  }
  const selected = new Set(requested);
  return GENERATED_EXAMPLE_TARGETS.filter((target) => selected.has(target));
}

export function generatedExamplesForTargets(
  targets,
  values = generatedExamples
) {
  const selected = new Set(targets);
  return values.filter(([language]) => selected.has(language));
}

export function generatedMcpExamplesForTargets(catalog, targets) {
  const selected = new Set(targets);
  return catalog.all.filter(
    (value) => value.group === 'mcp' && selected.has(value.language.runner)
  );
}

async function main(args = process.argv.slice(2)) {
  const targets = selectGeneratedExampleTargets(args);
  console.log(`Generated example targets: ${targets.join(', ')}`);

  if (targets.includes('cpp')) {
    const generatedRoot = path.join(repoRoot, 'src', 'examples', '.generated');
    await Promise.all(
      ['cpp-package-build', 'cpp-package-install'].map((name) =>
        rm(path.join(generatedRoot, name), { force: true, recursive: true })
      )
    );
  }

  // Preserve the existing all-target catalog smoke without printing the entire
  // catalog once per CI shard. Targeted runs still parse the same catalog below.
  if (args.length === 0) run(process.execPath, [runner, 'list']);
  for (const [language, file] of generatedExamplesForTargets(targets)) {
    console.log(`[example] ${language}: ${file}`);
    run(process.execPath, [runner, language, file], language);
  }

  const catalog = await readPublicExampleCatalog({ repoRoot });
  for (const example of generatedMcpExamplesForTargets(catalog, targets)) {
    console.log(
      `[mcp compile] ${example.language.runner}: ${example.sourcePath}`
    );
    run(
      process.execPath,
      [runner, example.language.runner, example.sourcePath, '--compile-only'],
      example.language.runner
    );
  }
}

function run(command, args, language) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(language === 'cpp' ? { AXIR_CPP_REUSE_PACKAGE_BUILD: '1' } : {}),
    },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
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
