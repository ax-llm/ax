import { normalizeDiscoveryCallableIdentifier } from '../runtimeDiscovery.js';
import {
  createDiscoveryTurnSummary,
  formatDiscoveryTurnSummary,
} from './discoveryHelpers.js';
import {
  type AxAgentMemoryEntry,
  mergeMemoryResults,
  normalizeUsedMemoryResult,
} from './memoriesHelpers.js';
import type {
  AxAgentMemoryResult,
  AxAgentUsedMemory,
} from './memoriesTypes.js';
import {
  ingestSkillResults,
  normalizeUsedSkillResult,
} from './skillsHelpers.js';
import type { AxAgentSkillResult, AxAgentUsedSkill } from './skillsTypes.js';
import type { AxAgentRuntimeInputState } from './types.js';

export interface RunNoteBindingsDeps {
  /** The owning `ActorAgentRLM` internals blob. */
  s: any;
  inputState: AxAgentRuntimeInputState;
  stageVariant: 'distiller' | 'executor';
  onUsedMemories?: (usedMemories: readonly AxAgentUsedMemory[]) => void;
  onUsedSkills?: (usedSkills: readonly AxAgentUsedSkill[]) => void;
}

export interface RunNoteBindings {
  noteDiscoveredActorModelNamespaces: (namespaces: readonly string[]) => void;
  noteDiscoveredModules: (
    modules: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => void;
  noteDiscoveredFunctions: (
    qualifiedNames: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => void;
  noteLoadedSkills: (results: readonly AxAgentSkillResult[]) => void;
  noteLoadedMemories: (results: readonly AxAgentMemoryResult[]) => void;
  noteUsed: (id: unknown, reason: unknown) => void;
  consumeDiscoveryTurnArtifacts: () => { summary?: string; texts: string[] };
  getCurrentMemories: () => readonly AxAgentMemoryResult[];
  getDiscoveredActorModelNamespaces: () => string[];
}

/**
 * Per-run note-taking callbacks the runtime globals report into: discovery
 * docs (agent prompt state + per-turn summaries), loaded skills/memories, and
 * `used(...)` attributions. Extracted from `createRuntimeExecutionContext` so
 * the composition root stays readable; all state lives either on the agent
 * blob (prompt state that outlives the run) or in this closure (per-turn
 * artifacts).
 */
export function buildRunNoteBindings(
  deps: RunNoteBindingsDeps
): RunNoteBindings {
  const { s, inputState, stageVariant, onUsedMemories, onUsedSkills } = deps;

  const discoveredActorModelNamespaces = new Set<string>();
  let pendingDiscoveryTurnSummary = createDiscoveryTurnSummary();
  const noteDiscoveredActorModelNamespaces = (
    namespaces: readonly string[]
  ) => {
    for (const namespace of namespaces) {
      const trimmed = namespace.trim();
      if (trimmed) {
        discoveredActorModelNamespaces.add(trimmed);
      }
    }
  };
  const noteDiscoveredModules = (
    modules: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => {
    for (const module of modules) {
      const normalizedModule = module.trim();
      const text = docs[module] ?? docs[normalizedModule];
      if (!text) {
        continue;
      }
      s.currentDiscoveryPromptState.modules.set(normalizedModule, text);
      pendingDiscoveryTurnSummary.modules.add(normalizedModule);
      pendingDiscoveryTurnSummary.texts.add(text);
    }
  };
  const noteDiscoveredFunctions = (
    qualifiedNames: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => {
    for (const qualifiedName of qualifiedNames) {
      const normalizedQualifiedName =
        normalizeDiscoveryCallableIdentifier(qualifiedName);
      const text = docs[qualifiedName] ?? docs[normalizedQualifiedName];
      if (!text) {
        continue;
      }
      s.currentDiscoveryPromptState.functions.set(
        normalizedQualifiedName,
        text
      );
      pendingDiscoveryTurnSummary.functions.add(normalizedQualifiedName);
      pendingDiscoveryTurnSummary.texts.add(text);
    }
  };
  const noteLoadedSkills = (results: readonly AxAgentSkillResult[]) => {
    ingestSkillResults(s.currentSkillsPromptState, results);
    if (typeof s.onLoadedSkills === 'function') {
      // Fire-and-forget; errors must not break the actor loop.
      Promise.resolve(s.onLoadedSkills(results)).catch(() => {});
    }
  };
  const memoriesEnabled = typeof s.onMemoriesSearch === 'function';
  let currentMemories: AxAgentMemoryEntry[] = memoriesEnabled
    ? mergeMemoryResults(
        Array.isArray(inputState.currentInputs?.memories)
          ? (inputState.currentInputs.memories as readonly AxAgentMemoryEntry[])
          : [],
        []
      )
    : [];
  if (memoriesEnabled) {
    inputState.currentInputs.memories = currentMemories;
  }
  const noteLoadedMemories = (results: readonly AxAgentMemoryResult[]) => {
    if (!memoriesEnabled) return;
    currentMemories = mergeMemoryResults(currentMemories, results);
    inputState.currentInputs.memories = currentMemories;
    if (typeof s.onLoadedMemories === 'function') {
      // Fire-and-forget; errors must not break the actor loop.
      Promise.resolve(s.onLoadedMemories(results)).catch(() => {});
    }
  };
  const noteUsed = (id: unknown, reason: unknown) => {
    if (s.usageTrackingEnabled !== true) return;
    if (memoriesEnabled && s.memoryUsageTrackingEnabled === true) {
      const usedMemory = normalizeUsedMemoryResult(
        id,
        reason,
        currentMemories,
        stageVariant
      );
      if (usedMemory) {
        onUsedMemories?.([usedMemory]);
      }
    }
    if (s.skillUsageTrackingEnabled === true) {
      const usedSkill = normalizeUsedSkillResult(
        id,
        reason,
        s.currentSkillsPromptState,
        stageVariant
      );
      if (usedSkill) {
        onUsedSkills?.([usedSkill]);
      }
    }
  };
  const consumeDiscoveryTurnArtifacts = () => {
    const summary = formatDiscoveryTurnSummary(pendingDiscoveryTurnSummary);
    const texts = [...pendingDiscoveryTurnSummary.texts];
    pendingDiscoveryTurnSummary = createDiscoveryTurnSummary();
    return {
      ...(summary ? { summary } : {}),
      texts,
    };
  };

  return {
    noteDiscoveredActorModelNamespaces,
    noteDiscoveredModules,
    noteDiscoveredFunctions,
    noteLoadedSkills,
    noteLoadedMemories,
    noteUsed,
    consumeDiscoveryTurnArtifacts,
    getCurrentMemories: () => currentMemories as readonly AxAgentMemoryResult[],
    getDiscoveredActorModelNamespaces: () => [
      ...discoveredActorModelNamespaces,
    ],
  };
}
