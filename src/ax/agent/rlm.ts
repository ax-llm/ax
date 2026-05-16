/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import type { AxFunctionJSONSchema } from '../ai/types.js';
import { toFieldType } from '../dsp/prompt.js';
import type { AxIField } from '../dsp/sig.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';
import type { AxAgentExecutorTurnCallbackArgs } from './AxAgent.js';
import type { AxAgentOnContextEvent } from './contextEvents.js';
import { renderPrimitivesList } from './runtimePrimitives.js';
import { renderPromptTemplate } from './templateEngine.js';

// ----- Helpers for rendering function/agent signatures in the actor prompt -----

type AgentIdentityPrompt = Readonly<{
  name: string;
  description: string;
}>;

function renderAgentIdentity(
  identity: AgentIdentityPrompt | undefined
): string {
  if (!identity) return '';

  return [
    `- Name: ${identity.name}`,
    `- Description: ${identity.description}`,
  ].join('\n');
}

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

function renderCallableBlock(args: {
  qualifiedName: string;
  description?: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
}): string {
  const paramType = renderObjectType(args.parameters, {
    respectRequired: true,
  });
  const returnType = args.returns
    ? `: Promise<${renderReturnsSummary(args.returns)}>`
    : '';
  const signature = `\`${args.qualifiedName}(args: ${paramType})${returnType}\``;
  const description = args.description?.trim();
  return description ? `${description}\n${signature}` : signature;
}

/**
 * A code runtime that can create persistent sessions.
 * Implement this interface for your target runtime (Node.js, browser, WASM, etc.).
 */
export interface AxCodeRuntime {
  createSession(
    globals?: Record<string, unknown>,
    options?: { shouldBubbleError?: (err: unknown) => boolean }
  ): AxCodeSession;
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
 *   Best when character-based prompt pressure matters more than raw replay detail.
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
  /** Code runtime for the REPL loop (default: AxJSRuntime). */
  runtime?: AxCodeRuntime;
  /** Global cap on recursive sub-agent calls across all descendants (default: 100). */
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
  /**
   * Called after each Actor turn is recorded with both raw runtime output and
   * the formatted action-log output.
   */
  executorTurnCallback?: (
    args: AxAgentExecutorTurnCallbackArgs
  ) => void | Promise<void>;
  /**
   * Called when AxAgent measures context pressure or changes compacted context state.
   * Intended for observability; callback failures are ignored.
   */
  onContextEvent?: AxAgentOnContextEvent;
  /**
   * Called when the actor signals task progress via `reportSuccess(message)` or `reportFailure(message)`.
   */
  agentStatusCallback?: (
    message: string,
    status: 'success' | 'failed'
  ) => void | Promise<void>;
}

/**
 * Builds the context-understanding actor system prompt (the distiller).
 * The distiller explores and distills long-context inputs into a concise
 * evidence payload for the executor stage; it has no tools.
 */
export function axBuildDistillerDefinition(
  baseDefinition: string | undefined,
  contextFields: readonly AxIField[],
  options: Readonly<{
    runtimeUsageInstructions?: string;
    promptLevel?: 'default' | 'detailed';
    hasInspectRuntime?: boolean;
    hasLiveRuntimeState?: boolean;
    hasCompressedActionReplay?: boolean;
    /** Enables `recall` runtime primitive in the prompt. */
    memoriesMode?: boolean;
    /** Optional override for the `rlm/distiller.md` template source. */
    templateOverride?: string;
    /** Optional per-primitive override map keyed by primitive id. */
    primitiveOverrides?: ReadonlyMap<string, readonly string[]>;
  }>
): string {
  const contextVarList =
    contextFields.length > 0
      ? contextFields
          .map((f) => `- \`${f.name}\` -> \`inputs.${f.name}\``)
          .join('\n')
      : '(none)';

  const actorBody = renderPromptTemplate(
    'rlm/distiller.md',
    {
      contextVarList,
      promptLevel: options.promptLevel ?? 'default',
      hasInspectRuntime: Boolean(options.hasInspectRuntime),
      hasLiveRuntimeState: Boolean(options.hasLiveRuntimeState),
      hasCompressedActionReplay: Boolean(options.hasCompressedActionReplay),
      primitivesList: renderPrimitivesList(
        'distiller',
        {
          hasInspectRuntime: Boolean(options.hasInspectRuntime),
          memoriesMode: Boolean(options.memoriesMode),
        },
        options.primitiveOverrides
      ),
      memoriesMode: Boolean(options.memoriesMode),
      runtimeUsageInstructions: String(options.runtimeUsageInstructions ?? ''),
    },
    options.templateOverride
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return baseDefinition ? `${actorBody}\n\n${baseDefinition}` : actorBody;
}

/**
 * Builds the executor system prompt. The executor consumes
 * `inputs.executorRequest` and `inputs.distilledContext` from the prior
 * distiller stage and runs tools / discovery to complete the task.
 */
export function axBuildExecutorDefinition(
  baseDefinition: string | undefined,
  contextFields: readonly AxIField[],
  responderOutputFields: readonly AxIField[],
  options: Readonly<{
    runtimeUsageInstructions?: string;
    promptLevel?: 'default' | 'detailed';
    hasInspectRuntime?: boolean;
    hasLiveRuntimeState?: boolean;
    hasCompressedActionReplay?: boolean;
    llmQueryPromptMode?: 'simple';
    enforceIncrementalConsoleTurns?: boolean;
    hasAgentStatusCallback?: boolean;
    discoveryMode?: boolean;
    /** Enables `consult` runtime primitive in the prompt. */
    skillsMode?: boolean;
    /** Enables `recall` runtime primitive in the prompt. */
    memoriesMode?: boolean;
    availableModules?: ReadonlyArray<{
      namespace: string;
      selectionCriteria?: string;
    }>;
    discoveredDocsMarkdown?: string;
    /** Skill bodies accumulated during the current run (sorted by name). */
    skillsMarkdown?: string;
    agentFunctions?: ReadonlyArray<{
      name: string;
      description?: string;
      parameters?: AxFunctionJSONSchema;
      returns?: AxFunctionJSONSchema;
      namespace: string;
    }>;
    /** Optional override for the `rlm/executor.md` template source. */
    templateOverride?: string;
    /** Optional per-primitive override map keyed by primitive id. */
    primitiveOverrides?: ReadonlyMap<string, readonly string[]>;
  }>
): string {
  type AvailableModule = { namespace: string; selectionCriteria?: string };

  const contextVarList =
    contextFields.length > 0
      ? contextFields
          .map((f) => `- \`${f.name}\` -> \`inputs.${f.name}\``)
          .join('\n')
      : '(none)';

  const responderOutputFieldTitles = responderOutputFields
    .map((f) => `\`${f.name}\``)
    .join(', ');

  const sortedAgentFunctions = [...(options.agentFunctions ?? [])].sort(
    (a, b) => {
      if (a.namespace !== b.namespace) {
        return a.namespace.localeCompare(b.namespace);
      }
      return a.name.localeCompare(b.name);
    }
  );
  const discoveryMode = Boolean(options.discoveryMode);
  const availableModules: AvailableModule[] = options.availableModules
    ? [...options.availableModules].sort((a, b) =>
        a.namespace.localeCompare(b.namespace)
      )
    : [...new Set(sortedAgentFunctions.map((fn) => fn.namespace))]
        .sort((a, b) => a.localeCompare(b))
        .map((namespace) => ({ namespace }));

  const actorBody = renderPromptTemplate(
    'rlm/executor.md',
    {
      contextVarList,
      responderOutputFieldTitles,
      promptLevel: options.promptLevel ?? 'default',
      llmQueryPromptMode: options.llmQueryPromptMode ?? 'simple',
      discoveryMode,
      hasInspectRuntime: Boolean(options.hasInspectRuntime),
      primitivesList: renderPrimitivesList(
        'executor',
        {
          hasInspectRuntime: Boolean(options.hasInspectRuntime),
          hasAgentStatusCallback: Boolean(options.hasAgentStatusCallback),
          discoveryMode,
          skillsMode: Boolean(options.skillsMode),
          memoriesMode: Boolean(options.memoriesMode),
        },
        options.primitiveOverrides
      ),
      functionsList:
        !discoveryMode && sortedAgentFunctions.length > 0
          ? sortedAgentFunctions
              .map((fn) =>
                renderCallableBlock({
                  qualifiedName: `${fn.namespace}.${fn.name}`,
                  description: fn.description,
                  parameters: fn.parameters,
                  returns: fn.returns,
                })
              )
              .join('\n\n')
          : '',
      hasModules: discoveryMode && availableModules.length > 0,
      modulesList: availableModules
        .map((module) =>
          module.selectionCriteria?.trim()
            ? `- \`${module.namespace}\` - ${module.selectionCriteria.trim()}`
            : `- \`${module.namespace}\``
        )
        .join('\n'),
      runtimeUsageInstructions: String(options.runtimeUsageInstructions ?? ''),
      hasDiscoveredDocs: Boolean(options.discoveredDocsMarkdown),
      discoveredDocsMarkdown: String(options.discoveredDocsMarkdown ?? ''),
      hasSkills: Boolean(options.skillsMarkdown),
      skillsMarkdown: String(options.skillsMarkdown ?? ''),
      memoriesMode: Boolean(options.memoriesMode),
      enforceIncrementalConsoleTurns: Boolean(
        options.enforceIncrementalConsoleTurns
      ),
      hasLiveRuntimeState: Boolean(options.hasLiveRuntimeState),
      hasCompressedActionReplay: Boolean(options.hasCompressedActionReplay),
      hasAgentStatusCallback: Boolean(options.hasAgentStatusCallback),
    },
    options.templateOverride
  )
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
  contextFields: readonly AxIField[],
  options?: Readonly<{
    /** User-facing agent identity from `agentIdentity`. */
    agentIdentity?: AgentIdentityPrompt;
    /** Optional override for the `rlm/responder.md` template source. */
    templateOverride?: string;
  }>
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

  const agentIdentityText = renderAgentIdentity(options?.agentIdentity);

  const body = renderPromptTemplate(
    'rlm/responder.md',
    {
      contextVarSummary,
      hasAgentIdentity: agentIdentityText.length > 0,
      agentIdentityText,
    },
    options?.templateOverride
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return baseDefinition ? `${body}\n\n${baseDefinition}` : body;
}
