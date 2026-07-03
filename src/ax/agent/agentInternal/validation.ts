import type { AxSignature } from '../../dsp/sig.js';
import { DISCOVERY_DISCOVER_NAME, MEMORIES_LOAD_NAME } from '../runtime.js';
import type { AxAgentFunction, AxAgentFunctionModuleMeta } from './types.js';

export function reservedAgentFunctionNamespaces(self: any): Set<string> {
  const s = self as any;
  return new Set([
    'inputs',
    'llmQuery',
    'final',
    'askClarification',
    'reportSuccess',
    'reportFailure',
    'inspectRuntime',
    MEMORIES_LOAD_NAME,
    ...(s.functionDiscoveryEnabled || typeof s.onSkillsSearch === 'function'
      ? [DISCOVERY_DISCOVER_NAME]
      : []),
  ]);
}

export function mergeAgentFunctionModuleMetadata(
  self: any,
  newMetadata: readonly AxAgentFunctionModuleMeta[]
): boolean {
  const s = self as any;
  let changed = false;

  for (const meta of newMetadata) {
    const existing = s.agentFunctionModuleMetadata.get(meta.namespace);
    if (!existing) {
      s.agentFunctionModuleMetadata.set(meta.namespace, meta);
      changed = true;
      continue;
    }

    if (
      existing.title !== meta.title ||
      existing.selectionCriteria !== meta.selectionCriteria ||
      existing.description !== meta.description ||
      existing.alwaysInclude !== meta.alwaysInclude
    ) {
      throw new Error(
        `Conflicting agent function group metadata for namespace "${meta.namespace}"`
      );
    }
  }

  return changed;
}

export function validateConfiguredSignature(
  self: any,
  signature: Readonly<AxSignature>
): void {
  const s = self as any;
  if (signature.getDescription()?.trim()) {
    throw new Error(
      'AxAgent does not support signature-level descriptions. ' +
        'Use contextOptions.description, executorOptions.description, or responderOptions.description instead.'
    );
  }

  const inputFieldNames = new Set(
    signature.getInputFields().map((field) => field.name)
  );
  const outputFieldNames = new Set(
    signature.getOutputFields().map((field) => field.name)
  );
  const reservedInputFieldNames = new Set([
    'contextMetadata',
    'contextMap',
    'discoveredToolDocs',
    'guidanceLog',
    'loadedSkills',
    'summarizedActorLog',
    'actionLog',
    'liveRuntimeState',
    'contextPressure',
    'contextData',
  ]);
  // The coordinator wires `contextMetadata` into the executor stage's own
  // signature (shared-session handoff: it describes the raw context variables
  // still live in the runtime). User signatures are still guarded — they are
  // validated through the distiller stage, which carries every user input.
  if (s.stagePolicy?.allowsContextMetadataInput) {
    reservedInputFieldNames.delete('contextMetadata');
  }
  const reservedOutputFieldNames = new Set([
    'javascriptCode',
    s.runtimeCodeFieldName ?? 'javascriptCode',
  ]);

  for (const field of signature.getInputFields()) {
    if (reservedInputFieldNames.has(field.name)) {
      throw new Error(
        `AxAgent reserves input field name "${field.name}" for internal actor/responder wiring`
      );
    }
  }

  for (const field of signature.getOutputFields()) {
    if (reservedOutputFieldNames.has(field.name)) {
      throw new Error(
        `AxAgent reserves output field name "${field.name}" for internal actor wiring`
      );
    }
  }

  for (const field of s.rlmConfig.contextFields) {
    if (!inputFieldNames.has(field)) {
      throw new Error(`RLM contextField "${field}" not found in signature`);
    }
  }
  void outputFieldNames;
}

export function validateAgentFunctionNamespaces(
  self: any,
  functions: readonly AxAgentFunction[]
): void {
  const s = self as any;
  const reservedNamespaces = reservedAgentFunctionNamespaces(s);
  for (const fn of functions) {
    const ns = fn.namespace ?? 'utils';
    if (reservedNamespaces.has(ns)) {
      throw new Error(
        `Agent function namespace "${ns}" conflicts with an AxAgent runtime global and is reserved`
      );
    }
  }
}
