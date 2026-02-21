/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import { toFieldType } from '../dsp/adapter.js';
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
   * If true, the Actor must return `actionDescription` and action logs will store
   * short action descriptions instead of full code blocks.
   */
  compressLog?: boolean;
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

### Strategic planning
Before writing any code, assess your input data some of which is in your llm context and the rest listed under "Pre-loaded context variables" above is available only in the javascript runtime. Check the type, size, structure, and a sample of the data to determine how to approach the problem. If the context is large or complex, plan how to break it into chunks and use \`llmQuery\` to delegate sub-tasks to a sub-agent. If its small or straightforward, solve it directly with code without unnecessary calls to \`llmQuery\` which an expensive operation. Think step by step, plan your approach and execute it with code. Prefer using code for structural work (slicing, filtering, aggregating) and reserve \`llmQuery\` only for semantic tasks that code cannot handle.

### Iteration strategy
1. **Explore first & assess**: before doing any analysis, inspect the context — check its type, size, structure, and a sample. Determine if the data is small enough to process directly without heavy recursion.
2. **Plan before recursing**: based on your exploration, decide the minimum number of \`llmQuery\` calls needed. Often 1–3 well-crafted calls are sufficient. Do not launch recursive sub-queries until you have a concrete plan.
3. **Plan a chunking strategy**: if the context is large, figure out how to break it into smart chunks based on what you observe.
4. **Use code for structural work**: filter, map, slice, regex, property access — use \`javascriptCode\` for anything computable.
5. **Use \`llmQuery\` for semantic work**: summarization, interpretation, or answering questions about content.
6. **Build up answers in variables**: use variables as buffers to accumulate intermediate results across steps.
7. **Handle truncated output**: runtime output may be truncated. If it appears incomplete, rerun with narrower scope.
8. **Signal completion**: call \`final(...args)\` when you have gathered enough information, or \`ask_clarification(...args)\` when user input is required. You can combine with final code: \`var result = await llmQuery(...); console.log(result); final(result)\`

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
