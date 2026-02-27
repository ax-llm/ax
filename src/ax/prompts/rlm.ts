/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import type { AxFunctionJSONSchema } from '../ai/types.js';
import { toFieldType } from '../dsp/adapter.js';
import type { AxIField } from '../dsp/sig.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';
import { renderPromptTemplate } from './templateEngine.js';

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

/**
 * A persistent code execution session. Variables persist across `execute()` calls.
 */
export interface AxCodeSession {
  execute(
    code: string,
    options?: { signal?: AbortSignal; reservedNames?: readonly string[] }
  ): Promise<unknown>;
  close(): void;
}

/**
 * Configuration for semantic context management in the Actor loop.
 * Controls how action log entries are evaluated, summarized, and pruned.
 */
export interface AxContextManagementConfig {
  /** Prune error entries after a successful (non-error) turn. */
  errorPruning?: boolean;
  /** Enable tombstone generation for resolved errors.
   *  When `true`, uses the main AI service with its default settings.
   *  Pass an `AxProgramForwardOptions` object to control the model, temperature,
   *  max tokens, etc. of the tombstone generation call (e.g. a cheaper/faster model). */
  tombstoning?: boolean | Omit<AxProgramForwardOptions<string>, 'functions'>;
  /** Enable heuristic-based importance scoring on entries. */
  hindsightEvaluation?: boolean;
  /** Enable runtime state inspection tool for the actor.
   *  `contextThreshold` is the character count on the serialized actionLog
   *  above which an `inspect_runtime()` hint is shown to the actor. */
  stateInspection?: { contextThreshold?: number };
  /** Entries ranked strictly below this value are purged from active context.
   *  Range: 0-5. Default: 2. */
  pruneRank?: number;
}

/**
 * RLM configuration for AxAgent.
 */
export interface AxRLMConfig {
  /** Input fields holding long context (will be removed from the LLM prompt). */
  contextFields: string[];
  /** Input fields to pass directly to subagents, bypassing the top-level LLM. */
  sharedFields?: string[];
  /** Code runtime for the REPL loop (default: AxJSRuntime). */
  runtime?: AxCodeRuntime;
  /** Cap on recursive sub-agent calls (default: 50). */
  maxSubAgentCalls?: number;
  /**
   * Maximum characters for RLM runtime payloads (default: 5000).
   * Applies to llmQuery context and code execution output.
   */
  maxRuntimeChars?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** Maximum Actor turns before forcing Responder (default: 10). */
  maxTurns?: number;
  /**
   * @deprecated Use `contextManagement.errorPruning` instead.
   * If true, prune error entries from the action log after a successful turn.
   */
  trajectoryPruning?: boolean;
  /** Semantic context management configuration. */
  contextManagement?: AxContextManagementConfig;
  /** Output field names the Actor should produce (in addition to javascriptCode). */
  actorFields?: string[];
  /** Called after each Actor turn with the full actor result. */
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;
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
    maxSubAgentCalls?: number;
    maxTurns?: number;
    hasInspectRuntime?: boolean;
    /** Child agents available under the `agents.*` namespace in the JS runtime. */
    agents?: ReadonlyArray<{
      name: string;
      description: string;
      parameters?: AxFunctionJSONSchema;
    }>;
    /** Agent functions available under namespaced globals in the JS runtime. */
    agentFunctions?: ReadonlyArray<{
      name: string;
      description: string;
      parameters: AxFunctionJSONSchema;
      returns?: AxFunctionJSONSchema;
      namespace: string;
    }>;
  }>
): string {
  //   const maxSubAgentCalls = options.maxSubAgentCalls ?? 50;

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
  const actorBody = renderPromptTemplate('rlm/actor.md', {
    contextVarList,
    responderOutputFieldTitles,
    hasInspectRuntime: Boolean(options.hasInspectRuntime),
    hasAgentFunctions: sortedAgents.length > 0,
    agentFunctionsList: sortedAgents
      .map((fn) =>
        renderCallableEntry({
          qualifiedName: `agents.${fn.name}`,
          parameters: fn.parameters,
        })
      )
      .join('\n'),
    hasFunctions: sortedAgentFunctions.length > 0,
    functionsList: sortedAgentFunctions
      .map((fn) =>
        renderCallableEntry({
          qualifiedName: `${fn.namespace}.${fn.name}`,
          parameters: fn.parameters,
          returns: fn.returns,
        })
      )
      .join('\n'),
    runtimeUsageInstructions: String(options.runtimeUsageInstructions),
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
