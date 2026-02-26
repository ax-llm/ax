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

// ----- Helpers for rendering function/agent signatures in the actor prompt -----

function schemaTypeToShortString(schema: AxFunctionJSONSchema): string {
  if (schema.enum) return schema.enum.map((e) => `"${e}"`).join(' | ');
  if (schema.type === 'array') {
    const itemType = schema.items
      ? schemaTypeToShortString(schema.items)
      : 'unknown';
    return `${itemType}[]`;
  }
  if (schema.type === 'object') return 'object';
  return schema.type ?? 'unknown';
}

function shouldIncludeShortDescription(
  description: string | undefined
): boolean {
  if (!description) return false;
  return description.trim().split(/\s+/).length <= 12;
}

function renderCallArgObject(schema: AxFunctionJSONSchema | undefined): string {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    return '{}';
  }
  return `{ ${Object.keys(schema.properties).join(', ')} }`;
}

function renderArgsDetail(schema: AxFunctionJSONSchema | undefined): string {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    return 'none';
  }
  const required = new Set(schema.required ?? []);
  const parts = Object.entries(schema.properties).map(([key, prop]) => {
    const typeStr = schemaTypeToShortString(prop);
    const marker = required.has(key) ? 'required' : 'optional';
    const base = `${key}:${typeStr} (${marker})`;
    if (shouldIncludeShortDescription(prop.description)) {
      return `${base} - ${prop.description}`;
    }
    return base;
  });
  return parts.join(', ');
}

function renderReturnsSummary(
  schema: AxFunctionJSONSchema | undefined
): string {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    return 'unknown';
  }

  const parts = Object.entries(schema.properties).map(([key, prop]) => {
    const typeStr = schemaTypeToShortString(prop);
    if (shouldIncludeShortDescription(prop.description)) {
      return `${key}:${typeStr} (${prop.description})`;
    }
    return `${key}:${typeStr}`;
  });
  return `{ ${parts.join(', ')} }`;
}

function renderCallableEntry(args: {
  qualifiedName: string;
  description: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
}): string {
  return [
    `- \`${args.qualifiedName}\``,
    `  purpose: ${args.description}`,
    `  call: \`await ${args.qualifiedName}(${renderCallArgObject(args.parameters)})\``,
    `  args: ${renderArgsDetail(args.parameters)}`,
    `  returns: ${renderReturnsSummary(args.returns)}`,
  ].join('\n');
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
  /** Cap on recursive sub-LM calls (default: 50). */
  maxLlmCalls?: number;
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
    maxLlmCalls?: number;
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
  const maxLlmCalls = options.maxLlmCalls ?? 50;

  const contextVarList =
    contextFields.length > 0
      ? contextFields
          .map((f) => {
            const typeStr = toFieldType(f.type);
            const desc = f.description ? `: ${f.description}` : '';
            return `- \`${f.name}\` (${typeStr})${desc}`;
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
  const hasUnknownFunctionReturn = sortedAgentFunctions.some(
    (fn) =>
      !fn.returns?.properties || Object.keys(fn.returns.properties).length === 0
  );

  const actorBody = `
## Code Generation Agent

You are a code generation agent called the \`actor\`. Your ONLY job is to write JavaScript code to solve problems, complete tasks and gather information. There is another agent called the \`responder\` that will synthesize final answers from the information you gather. You NEVER generate final answers directly — you can only write code to explore and analyze the context, call tools, and ask for clarification.

### Pre-loaded context variables
All input fields are available in the JavaScript runtime via \`inputs.<field>\` (including context fields).
Top-level aliases may exist for non-colliding names, but \`inputs.<field>\` is the canonical path.
Example: \`const kb = inputs.knowledgeBase\`
Mapping rule: a field named \`foo\` maps to \`inputs.foo\` in runtime code.

Context-focused fields loaded for runtime analysis:
${contextVarList}

Some configured context fields may also appear directly in Actor prompt inputs when compact (threshold-based).

### Responder output fields
The responder is looking to produce the following output fields: ${responderOutputFieldTitles}

### Functions for context analysis and responding
- \`await llmQuery(query:string, context?:object|array|string) : string\` — Delegate semantic work to a sub-agent when context is too large or complex for one turn.
- \`await llmQuery({ query:string, context?:object|array|string }) : string\` — Single-object convenience form of \`llmQuery\`.
- \`await llmQuery([{ query:string, context?:object|array|string }, ...]) : string[]\` — Batched \`llmQuery\` for parallel analysis. Sub-agent calls have a call limit of ${maxLlmCalls}. Oversized values are truncated automatically.
- \`final(...args)\` — Signal completion and provide payload arguments for the responder to use to generate its output. Requires at least one argument. Execution ends after calling it.
- \`ask_clarification(...args)\` — Signal that more user input is needed and provide clarification arguments for the responder. Requires at least one argument. Execution ends after calling it.
${
  options.hasInspectRuntime
    ? `
- \`await inspect_runtime() : string\` — Returns a compact snapshot of all user-defined variables in the runtime session (name, type, size, preview). Use this to re-ground yourself when the action log is large instead of re-reading previous outputs.
`
    : ''
}

### Function call contract
- Use \`await agents.<name>({...})\` and \`await <namespace>.<fnName>({...})\` with a single object argument.
- \`llmQuery\` supports positional (\`llmQuery(query, context?)\`), single-object (\`llmQuery({ query, context })\`), and batched (\`llmQuery([{ query, context }, ...])\`) forms.
- \`final(...args)\` and \`ask_clarification(...args)\` are completion signals; do not use \`await\`.
- Use exact namespace-qualified names.
${
  sortedAgents.length > 0
    ? `
### Available Agent Functions
The following agents are pre-loaded under the \`agents\` namespace:
${sortedAgents
  .map((fn) =>
    renderCallableEntry({
      qualifiedName: `agents.${fn.name}`,
      description: fn.description,
      parameters: fn.parameters,
    })
  )
  .join('\n')}
`
    : ''
}${
  sortedAgentFunctions.length > 0
    ? `
### Available Functions
The following functions are available under namespaced globals in the runtime:
${hasUnknownFunctionReturn ? '- If \`returns\` is \`unknown\`, inspect with \`console.log(result)\` before chaining.\n' : ''}${sortedAgentFunctions
  .map((fn) =>
    renderCallableEntry({
      qualifiedName: `${fn.namespace}.${fn.name}`,
      description: fn.description,
      parameters: fn.parameters,
      returns: fn.returns,
    })
  )
  .join('\n')}
`
    : ''
}
### Important guidance and guardrails
- Start with targeted code-based exploration on a small portion of context. Use \`contextMetadata\` to choose scope.
- Use code (filter/map/slice/regex/property access) for structural work; use \`llmQuery\` for semantic interpretation and summarization.
- Use batched \`llmQuery\` only when parallelism materially helps. Total sub-agent call budget is ${maxLlmCalls}.
- Accumulate intermediate findings in variables. Send final payload only through \`final(...args)\` or \`ask_clarification(...args)\`.
- The responder can only see arguments passed to \`final(...args)\` or \`ask_clarification(...args)\`.
- Runtime output may be truncated. If output is incomplete, rerun with narrower scope.

## Javascript Runtime Usage Instructions
${options.runtimeUsageInstructions}
`
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
            return `- \`${f.name}\` (${typeStr})`;
          })
          .join('\n')
      : '(none)';

  const responderBody = `## Answer Synthesis Agent

You synthesize a final answer from the provided actorResult payload. The payload includes the Actor completion type and arguments captured from final(...args) or ask_clarification(...args).

### Context variables that were analyzed (metadata only)
${contextVarSummary}

### Rules
1. Base your answer ONLY on evidence from actorResult payload arguments.
2. If actorResult lacks sufficient information, provide the best possible answer from available evidence.
3. If actorResult.type is \`ask_clarification\`, ask for the missing information clearly in your output fields.`;

  return baseDefinition
    ? `${responderBody}\n\n${baseDefinition}`
    : responderBody;
}
