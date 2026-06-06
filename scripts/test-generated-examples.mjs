#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runner = path.join(repoRoot, 'scripts', 'run-example.mjs');

const examples = [
  ['python', 'signature_schema.py'],
  ['python', 'agent_pipeline.py'],
  ['python', 'flow_program_graph.py'],
  ['python', 'audio_responses_mapping.py'],
  ['python', 'realtime_audio_events.py'],
  ['python', 'runtime_adapter.py'],
  ['python', 'optimizer_artifact.py'],
  ['python', 'gepa_local_optimizer.py'],
  ['java', 'SignatureSchemaExample.java'],
  ['java', 'AgentPipelineExample.java'],
  ['java', 'FlowProgramGraphExample.java'],
  ['java', 'AudioResponsesMappingExample.java'],
  ['java', 'RealtimeAudioEventsExample.java'],
  ['java', 'RuntimeAdapterExample.java'],
  ['java', 'OptimizerArtifactExample.java'],
  ['java', 'GEPALocalOptimizerExample.java'],
  ['cpp', 'signature_schema.cpp'],
  ['cpp', 'agent_pipeline.cpp'],
  ['cpp', 'flow_program_graph.cpp'],
  ['cpp', 'audio_responses_mapping.cpp'],
  ['cpp', 'realtime_audio_events.cpp'],
  ['cpp', 'runtime_adapter.cpp'],
  ['cpp', 'optimizer_artifact.cpp'],
  ['cpp', 'gepa_local_optimizer.cpp'],
  ['go', 'signature_schema.go'],
  ['go', 'provider_mapping_no_key.go'],
];

run(process.execPath, [runner, 'list']);
for (const [language, file] of examples) {
  run(process.execPath, [runner, language, file]);
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
