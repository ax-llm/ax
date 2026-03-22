/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import type { AxFunctionJSONSchema } from '../../ai/types.js';
import { toFieldType } from '../../dsp/prompt.js';
import type { AxIField } from '../../dsp/sig.js';
import type { AxProgramForwardOptions } from '../../dsp/types.js';
import { renderPromptTemplate } from '../templateEngine.js';
import type { AxAgentTurnCallbackArgs } from './AxAgent.js';

// ----- Helpers for rendering function/agent signatures in the actor prompt -----

function normalizeSchemaTypes(schema: AxFunctionJSONSchema): string[] {
  const rawType = (schema as { type?: unknown }).type;

  if (Array.isArray(rawType)) {
    return rawType.filter((t): t is string => typeof t === 'string');
  }

  if (typeof rawType === 'string') {
    if (rawType.includes(',')) {
      return rawType
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [rawType];
  }

  return [];
}

function isJsonAnyTypeUnion(types: readonly string[]): boolean {
  const normalized = new Set(types);
  return (
    normalized.has('object') &&
    normalized.has('array') &&
    normalized.has('string') &&
    normalized.has('number') &&
    normalized.has('boolean') &&
    normalized.has('null')
  );
}

function schemaTypeToShortString(schema: AxFunctionJSONSchema): string {
  if (schema.enum) return schema.enum.map((e) => `"${e}"`).join(' | ');

  const types = normalizeSchemaTypes(schema);
  if (types.length === 0) return 'unknown';

  if (isJsonAnyTypeUnion(types)) return 'any';

  const rendered = [...new Set(types)].map((type) => {
    if (type === 'array') {
      const itemType = schema.items
        ? schemaTypeToShortString(schema.items)
        : 'unknown';
      return itemType.includes(' | ') ? `(${itemType})[]` : `${itemType}[]`;
    }
    if (type === 'object') {
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        return renderObjectType(schema);
      }
      return 'object';
    }
    return type;
  });

  return rendered.length > 1
    ? rendered.join(' | ')
    : (rendered[0] ?? 'unknown');
}

function renderObjectType(
  schema: AxFunctionJSONSchema | undefined,
  options?: Readonly<{ respectRequired?: boolean }>
): string {
  if (!schema) {
    return '{}';
  }
  const hasProperties =
    !!schema.properties && Object.keys(schema.properties).length > 0;
  const supportsExtraProps = schema.additionalProperties === true;

  if (!hasProperties) {
    return supportsExtraProps ? '{ [key: string]: unknown }' : '{}';
  }
  const required = new Set(schema.required ?? []);
  const respectRequired = options?.respectRequired ?? false;
  const parts = Object.entries(schema.properties!).map(([key, prop]) => {
    const typeStr = schemaTypeToShortString(prop);
    const optionalMarker = respectRequired && !required.has(key) ? '?' : '';
    return `${key}${optionalMarker}: ${typeStr}`;
  });
  if (schema?.additionalProperties === true) {
    parts.push('[key: string]: unknown');
  }
  return `{ ${parts.join(', ')} }`;
}

function renderReturnsSummary(
  schema: AxFunctionJSONSchema | undefined
): string {
  if (!schema) {
    return 'unknown';
  }
  return schemaTypeToShortString(schema);
}

function renderCallableEntry(args: {
  qualifiedName: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
}): string {
  const paramType = renderObjectType(args.parameters, {
    respectRequired: true,
  });
  const returnType = args.returns
    ? `: Promise<${renderReturnsSummary(args.returns)}>`
    : '';
  return `- \`${args.qualifiedName}(args: ${paramType})${returnType}\``;
}

/**
 * A code runtime that can create persistent sessions.
 * Implement this interface for your target runtime (Node.js, browser, WASM, etc.).
 */
export interface AxCodeRuntime {
  createSession(globals?: Record<string, unknown>): AxCodeSession;
  /**
   * Optional runtime-specific usage guidance injected into the RLM system prompt.
   * Use this for execution semantics that differ by runtime/language.
   */
  getUsageInstructions(): string;
}

/**
 * @deprecated Use `AxCodeRuntime` instead.
 */
export type AxCodeInterpreter = AxCodeRuntime;

export type AxCodeSessionSnapshotEntry = {
  name: string;
  type: string;
  ctor?: string;
  size?: string;
  preview?: string;
  restorable?: boolean;
};

export type AxCodeSessionSnapshot = {
  version: 1;
  entries: AxCodeSessionSnapshotEntry[];
  bindings: Record<string, unknown>;
};

/**
 * A persistent code execution session. Variables persist across `execute()` calls.
 */
export interface AxCodeSession {
  execute(
    code: string,
    options?: { signal?: AbortSignal; reservedNames?: readonly string[] }
  ): Promise<unknown>;
  inspectGlobals?(options?: {
    signal?: AbortSignal;
    reservedNames?: readonly string[];
  }): Promise<string>;
  snapshotGlobals?(options?: {
    signal?: AbortSignal;
    reservedNames?: readonly string[];
  }): Promise<AxCodeSessionSnapshot>;
  patchGlobals(
    globals: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<void>;
  close(): void;
}

/**
 * Opinionated context replay presets for the Actor loop.
 *
 * - `full`: Keep prior actions fully replayed with minimal compression.
 *   Best for debugging or short tasks where the actor should reread exact old code/output.
 * - `adaptive`: Keep live runtime state visible, preserve recent or dependency-relevant
 *   actions in full, keep discovery docs available by default, and collapse older successful work
 *   into checkpoint summaries as context grows. Reliability-first defaults favor
 *   summaries before deletion. Best default for long multi-turn tasks.
 * - `lean`: Most aggressive compression. Keep live runtime state visible, checkpoint
 *   older successful work, and summarize replay-pruned successful turns instead of
 *   replaying their full code blocks. Reliability-first
 *   defaults still preserve recent evidence before deleting older low-value steps.
 *   Best when token pressure matters more than raw replay detail.
 * - `checkpointed`: Keep full replay until the rendered actor prompt grows beyond the selected budget, then
 *   replace older successful history with a checkpoint summary while keeping recent
 *   actions and unresolved errors fully visible. Best when you want conservative,
 *   debugging-friendly replay until prompt pressure becomes real.
 */
export type AxContextPolicyPreset =
  | 'full'
  | 'adaptive'
  | 'lean'
  | 'checkpointed';

export type AxContextPolicyBudget = 'compact' | 'balanced' | 'expanded';

/**
 * Public context policy for the Actor loop.
 * Users choose replay style via `preset` and overall prompt budget via `budget`.
 */
export interface AxContextPolicyConfig {
  /**
   * Opinionated preset for how the agent should replay and compress context.
   *
   * - `full`: prefer raw replay of earlier actions
   * - `adaptive`: balance replay detail with checkpoint compression while keeping more recent evidence visible
   * - `lean`: prefer live state + compact summaries over raw replay detail
   * - `checkpointed`: keep full replay until the rendered actor prompt grows beyond the selected budget, then replace older successful turns with a checkpoint summary
   */
  preset?: AxContextPolicyPreset;
  /** Overall prompt budget and compression aggressiveness. */
  budget?: AxContextPolicyBudget;
}

/**
 * RLM configuration for AxAgent.
 */
export interface AxRLMConfig {
  /** Input fields holding long context (will be removed from the LLM prompt). */
  contextFields: string[];
  /** Actor prompt verbosity and scaffolding level (default: 'default'). */
  promptLevel?: 'default' | 'detailed';
  /** Input fields to pass directly to subagents, bypassing the top-level LLM. */
  sharedFields?: string[];
  /** Code runtime for the REPL loop (default: AxJSRuntime). */
  runtime?: AxCodeRuntime;
  /** Cap on recursive sub-agent calls (default: 50). */
  maxSubAgentCalls?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** Maximum Actor turns before forcing Responder (default: 10). */
  maxTurns?: number;
  /** Maximum characters to keep from runtime output and console/log replay (default: 3000). */
  maxRuntimeChars?: number;
  /** Context replay, checkpointing, and runtime-state policy. */
  contextPolicy?: AxContextPolicyConfig;
  /** Default options for the internal checkpoint summarizer. */
  summarizerOptions?: Omit<AxProgramForwardOptions<string>, 'functions'>;
  /** Output field names the Actor should produce (in addition to javascriptCode). */
  actorFields?: string[];
  /**
   * Called after each Actor turn is recorded with both raw runtime output and
   * the formatted action-log output.
   */
  actorTurnCallback?: (args: AxAgentTurnCallbackArgs) => void | Promise<void>;
  /**
   * Sub-query execution mode (default: 'simple').
   * - 'simple': llmQuery delegates to a plain AxGen (direct LLM call, no code runtime).
   * - 'advanced': llmQuery delegates to a full AxAgent (Actor/Responder + code runtime).
   */
  mode?: 'simple' | 'advanced';
}

/**
 * Builds the Actor system prompt. The Actor is a code generation agent that
 * decides what code to execute next based on the current state. It NEVER
 * generates final answers directly.
 */
export function axBuildActorDefinition(
  baseDefinition: string | undefined,
  contextFields: readonly AxIField[],
  responderOutputFields: readonly AxIField[],
  options: Readonly<{
    runtimeUsageInstructions?: string;
    promptLevel?: 'default' | 'detailed';
    maxSubAgentCalls?: number;
    maxTurns?: number;
    hasInspectRuntime?: boolean;
    hasLiveRuntimeState?: boolean;
    hasCompressedActionReplay?: boolean;
    llmQueryPromptMode?:
      | 'simple'
      | 'advanced-recursive'
      | 'simple-at-terminal-depth';
    /** When true, Actor must run one observable console step per non-final turn. */
    enforceIncrementalConsoleTurns?: boolean;
    /** Child agents available under the `<agentModuleNamespace>.*` namespace in the JS runtime. */
    agents?: ReadonlyArray<{
      name: string;
      description: string;
      parameters?: AxFunctionJSONSchema;
    }>;
    /** Agent functions available under namespaced globals in the JS runtime. */
    agentFunctions?: ReadonlyArray<{
      name: string;
      description?: string;
      parameters: AxFunctionJSONSchema;
      returns?: AxFunctionJSONSchema;
      namespace: string;
    }>;
    /** Module namespace used for child agent calls (default: "agents"). */
    agentModuleNamespace?: string;
    /** Enables module-only discovery rendering in prompt. */
    discoveryMode?: boolean;
    /** Precomputed available modules for runtime discovery mode. */
    availableModules?: ReadonlyArray<{
      namespace: string;
      selectionCriteria?: string;
    }>;
    /** Discovery docs accumulated during the current run. */
    discoveredDocsMarkdown?: string;
  }>
): string {
  //   const maxSubAgentCalls = options.maxSubAgentCalls ?? 50;
  type AvailableModule = {
    namespace: string;
    selectionCriteria?: string;
  };

  const contextVarList =
    contextFields.length > 0
      ? contextFields
          .map((f) => {
            const typeStr = toFieldType(f.type);
            const optionality = f.isOptional ? 'optional' : 'required';
            const desc = f.description ? `: ${f.description}` : '';
            return `- \`${f.name}\` -> \`inputs.${f.name}\` (${typeStr}, ${optionality})${desc}`;
          })
          .join('\n')
      : '(none)';

  const responderOutputFieldTitles = responderOutputFields
    .map((f) => `\`${f.name}\``)
    .join(', ');

  const sortedAgents = [...(options.agents ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const sortedAgentFunctions = [...(options.agentFunctions ?? [])].sort(
    (a, b) => {
      if (a.namespace !== b.namespace) {
        return a.namespace.localeCompare(b.namespace);
      }
      return a.name.localeCompare(b.name);
    }
  );
  const agentModuleNamespace = options.agentModuleNamespace ?? 'agents';
  const discoveryMode = Boolean(options.discoveryMode);
  const availableModules: AvailableModule[] = options.availableModules
    ? [...options.availableModules].sort((a, b) =>
        a.namespace.localeCompare(b.namespace)
      )
    : [
        ...new Set([
          ...sortedAgentFunctions.map((fn) => fn.namespace),
          ...(sortedAgents.length > 0 ? [agentModuleNamespace] : []),
        ]),
      ]
        .sort((a, b) => a.localeCompare(b))
        .map((namespace) => ({ namespace }));

  const actorBody = renderPromptTemplate('rlm/actor.md', {
    contextVarList,
    responderOutputFieldTitles,
    promptLevel: options.promptLevel ?? 'default',
    llmQueryPromptMode: options.llmQueryPromptMode ?? 'simple',
    discoveryMode,
    hasInspectRuntime: Boolean(options.hasInspectRuntime),
    hasAgentFunctions: !discoveryMode && sortedAgents.length > 0,
    agentModuleNamespace,
    agentFunctionsList: sortedAgents
      .map((fn) =>
        renderCallableEntry({
          qualifiedName: `${agentModuleNamespace}.${fn.name}`,
          parameters: fn.parameters,
        })
      )
      .join('\n'),
    hasFunctions: !discoveryMode && sortedAgentFunctions.length > 0,
    functionsList: sortedAgentFunctions
      .map((fn) =>
        renderCallableEntry({
          qualifiedName: `${fn.namespace}.${fn.name}`,
          parameters: fn.parameters,
          returns: fn.returns,
        })
      )
      .join('\n'),
    hasModules: discoveryMode && availableModules.length > 0,
    modulesList: availableModules
      .map((module) =>
        module.selectionCriteria?.trim()
          ? `- \`${module.namespace}\` - ${module.selectionCriteria.trim()}`
          : `- \`${module.namespace}\``
      )
      .join('\n'),
    runtimeUsageInstructions: String(options.runtimeUsageInstructions),
    hasDiscoveredDocs: Boolean(options.discoveredDocsMarkdown),
    discoveredDocsMarkdown: String(options.discoveredDocsMarkdown ?? ''),
    enforceIncrementalConsoleTurns: Boolean(
      options.enforceIncrementalConsoleTurns
    ),
    hasLiveRuntimeState: Boolean(options.hasLiveRuntimeState),
    hasCompressedActionReplay: Boolean(options.hasCompressedActionReplay),
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return baseDefinition ? `${actorBody}\n\n${baseDefinition}` : actorBody;
}

/**
 * Builds the Responder system prompt. The Responder synthesizes a final answer
 * from the action log produced by the Actor. It NEVER generates code.
 */
export function axBuildResponderDefinition(
  baseDefinition: string | undefined,
  contextFields: readonly AxIField[]
): string {
  const contextVarSummary =
    contextFields.length > 0
      ? contextFields
          .map((f) => {
            const typeStr = toFieldType(f.type);
            const optionality = f.isOptional ? 'optional' : 'required';
            return `- \`${f.name}\` (${typeStr}, ${optionality})`;
          })
          .join('\n')
      : '(none)';

  const responderBody = renderPromptTemplate('rlm/responder.md', {
    contextVarSummary,
  }).trim();

  return baseDefinition
    ? `${responderBody}\n\n${baseDefinition}`
    : responderBody;
}
