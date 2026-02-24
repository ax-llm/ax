/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import { toFieldType } from '../dsp/prompt.js';
import type { AxIField } from '../dsp/sig.js';

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
   *  When true, uses the main AI service with its default model.
   *  Pass `{ model: '...' }` to override the model (e.g. a cheaper/faster one). */
  tombstoning?: boolean | { model?: string };
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

  const actorBody = `
## Code Generation Agent

You are a code generation agent called the \`actor\`. Your ONLY job is to write JavaScript code to solve problems, complete tasks and gather information. There is another agent called the \`responder\` that will synthesize final answers from the information you gather. You NEVER generate final answers directly — you can only write code to explore and analyze the context, call tools, and ask for clarification.

### Pre-loaded context variables
The following variables are **ONLY** available in the javascript code runtime session:
${contextVarList}

### Responder output fields
The responder is looking to produce the following output fields: ${responderOutputFieldTitles}

### APIs (Some of the api's you can use in your code)
- \`await llmQuery(query:string, context:object|array|string) : string\` — Have a sub agent work on a part of the task for you when the context is too large or complex to handle in a single turn. Its a way to divide and conquer but do not overuse it.

- \`await llmQuery([{ query:string, context:object|array|string }, ...]) : string\` — A batched version of \`llmQuery\` that allows you to make multiple queries in parallel. Use this to speed up processing when you have many items to analyze. Sub-agent calls have a call limit of ${maxLlmCalls}. Oversized values are truncated automatically.

- \`final(...args)\` — Signal completion and provide payload arguments for the responder to use to generate its output. Requires at least one argument. Execution ends after calling it.

- \`ask_clarification(...args)\` — Signal that more user input is needed and provide clarification arguments for the responder. Requires at least one argument. Execution ends after calling it.
${
  options.hasInspectRuntime
    ? `
- \`await inspect_runtime() : string\` — Returns a compact snapshot of all user-defined variables in the runtime session (name, type, size, preview). Use this to re-ground yourself when the action log is large instead of re-reading previous outputs.
`
    : ''
}
### Important guidance and guardrails
- Always do some due diligence first to figure out if you can solve the problem by writing code that looks at only a portion of the context. You have access to the \`contextMetadata\` which provides information about the context fields, use this in your decision making.

- Use \`llmQuery\` to delegate sub-tasks to a sub-agent when the context is too large or complex to handle. You can also use the batched version of \`llmQuery\` to speed up processing when you want to explore parts of the context in parallel. Sub-agent calls have a call limit of ${maxLlmCalls} and oversized values are truncated automatically.

- You can only send data to the responder to produce output by calling \`final(...args)\` or \`ask_clarification(...args)\` with a non-empty args. Do not attempt to return values or set variables for the responder to read. The responder can ONLY see the arguments you pass using these two functions.

- Do not use \`final\` in the a code snippet that also contains \`console.log\`  statements. These statements mean that you want to look at intermediate results so only call \`final\` when you are done will looking at all the intermediate results and are ready to pass the final payload to the responder. 

- First attempt to use code like filter, map, slice, regex, property access, etc combined with \`console.log\` to explore the context and gather information. Use \`llmQuery\` for anything that requires interpretation, summarization, or answering questions about the content.

- Use variables as buffers to accumulate information across steps. For example, if you are gathering evidence from multiple parts of the context, you can store it in an array variable and then pass it all at once in the \`final\` call.

- Runtime output may be truncated. If it appears incomplete, rerun with narrower scope.

## Javascript Runtime Usage Instructions
${options.runtimeUsageInstructions}
`;

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
