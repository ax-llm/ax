#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicExampleCatalog } from './example-catalog.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runner = path.join(repoRoot, 'scripts', 'run-example.mjs');

const examples = [
  ['python', 'signature_schema.py'],
  ['python', 'provider_mapping_no_key.py'],
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

run(process.execPath, [runner, 'list']);
for (const [language, file] of examples) {
  run(process.execPath, [runner, language, file]);
}

const catalog = await readPublicExampleCatalog({ repoRoot });
for (const example of catalog.all.filter((value) => value.group === 'mcp')) {
  run(process.execPath, [
    runner,
    example.language.runner,
    example.sourcePath,
    '--compile-only',
  ]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
