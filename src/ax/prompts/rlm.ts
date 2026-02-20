/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import type { AxFunction } from '../ai/types.js';
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
  getUsageInstructions?(): string;
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
  options: Readonly<{
    toolFunctions?: readonly AxFunction[];
    agentFunctions?: readonly AxFunction[];
    runtimeUsageInstructions?: string;
    maxLlmCalls?: number;
    maxTurns?: number;
    actorFieldNames?: readonly string[];
    compressLog?: boolean;
  }>
): string {
  const maxLlmCalls = options.maxLlmCalls ?? 50;
  const maxTurns = options.maxTurns ?? 10;
  const runtimeUsageInstructions =
    options.runtimeUsageInstructions?.trim() ?? '';
  const runtimeUsageNotesSection = runtimeUsageInstructions
    ? `\n\n### Runtime-specific usage notes\n${runtimeUsageInstructions}`
    : '';

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

  const toolSection =
    options.toolFunctions && options.toolFunctions.length > 0
      ? '\n\n### Available tools (callable as async functions)\n' +
        options.toolFunctions
          .map((fn) => {
            const params = fn.parameters?.properties
              ? Object.keys(fn.parameters.properties).join(', ')
              : '';
            return `- \`await ${fn.name}(${params ? `{ ${params} }` : ''})\` — ${fn.description}`;
          })
          .join('\n')
      : '';

  const agentSection =
    options.agentFunctions && options.agentFunctions.length > 0
      ? '\n\n### Available agents (accessible via `agents.*`)\n' +
        options.agentFunctions
          .map((fn) => {
            const schema = fn.parameters
              ? JSON.stringify(fn.parameters, null, 2)
              : '{}';
            return `#### \`await agents.${fn.name}({...})\`\n${fn.description}\n\nParameters:\n\`\`\`json\n${schema}\n\`\`\``;
          })
          .join('\n\n')
      : '';

  const firstFieldName = contextFields[0]?.name ?? 'data';

  const actorFieldNames = options.actorFieldNames ?? [];
  const requiredActorFields: string[] = [];
  if (options.compressLog) {
    requiredActorFields.push('`actionDescription`');
  }
  if (actorFieldNames.length > 0) {
    requiredActorFields.push(...actorFieldNames.map((n) => `\`${n}\``));
  }
  const actorFieldsRule1 =
    requiredActorFields.length > 0
      ? `Output a \`javascriptCode\` field containing executable JavaScript code, and also produce these fields: ${requiredActorFields.join(', ')}.`
      : 'Output ONLY a `javascriptCode` field containing executable JavaScript code.';
  const actorFieldsRule2 =
    requiredActorFields.length > 0
      ? `Do NOT include fields other than \`javascriptCode\` and the listed actor fields — another agent handles the remaining answer fields.`
      : 'NEVER include business answer fields — another agent handles the final answer.';
  const compressLogRule = options.compressLog
    ? '4. `actionDescription` is REQUIRED and must be a short plain-English description of what the code does.'
    : '';
  const signalRule = options.compressLog ? 5 : 4;
  const variableRule = options.compressLog ? 6 : 5;
  const exploreRule = options.compressLog ? 7 : 6;
  const semanticRule = options.compressLog ? 8 : 7;
  const turnsRule = options.compressLog ? 9 : 8;
  const batchRule = options.compressLog ? 10 : 9;
  const recursionRule = options.compressLog ? 11 : 10;

  const actorBody = `## Code Generation Agent

You are a code generation agent. Your ONLY job is to write JavaScript code that gathers information needed to answer the user's question. You NEVER answer the question directly — another agent handles the final answer.

### Pre-loaded context variables
The following variables are available in the runtime session:
${contextVarList}

### Runtime APIs (available inside \`javascriptCode\`)
- \`await llmQuery(query, context)\` — Single sub-query. query is a string, context can be any value (string, object, array, etc.) and will be available as a variable in the sub-agent's runtime. Returns a string. Always pass the relevant context — sub-LMs are powerful and can handle large context.
- \`await llmQuery([{ query, context }, ...])\` — Parallel batch. Pass an array of { query, context } objects where context can be any value. Returns string[]; failed items return \`[ERROR] ...\`. Use parallel queries when you have multiple independent chunks — it is much faster than sequential calls.
- \`submit(...args)\` — Signal completion and provide payload arguments for the responder. Requires at least one argument. Can be called anywhere in your code — execution continues normally after calling it.
- \`ask_clarification(...args)\` — Signal that more user input is needed and provide clarification arguments for the responder. Requires at least one argument. Can be called anywhere in your code — execution continues normally after calling it.
${toolSection}${agentSection}

Sub-queries have a call limit of ${maxLlmCalls} — use parallel queries and keep each context small.
There is also a runtime character cap for \`llmQuery\` context and code output. Oversized values are truncated automatically.

### Strategic planning
Before writing any code, assess your input data. Often the context is small enough to handle in a few direct \`llmQuery\` calls without deep recursion. Think step by step: plan your approach and execute it immediately in your code — do not just describe what you will do. Prefer using code for structural work (slicing, filtering, aggregating) and reserve \`llmQuery\` only for semantic tasks that code cannot handle.

### Rules
1. ${actorFieldsRule1}
2. ${actorFieldsRule2}
3. When you have gathered enough information, call \`submit(...args)\`. If you need user input before continuing, call \`ask_clarification(...args)\`.
${compressLogRule}
${signalRule}. Use variables to accumulate results across turns (they persist in the session).
${variableRule}. Explore context first (check type, size, structure) before doing analysis.
${exploreRule}. Use \`llmQuery\` for semantic work, code for structural work.
${semanticRule}. \`submit(...args)\` and \`ask_clarification(...args)\` each require at least one argument.
${turnsRule}. You have ${maxTurns} turns maximum. Plan accordingly.
${batchRule}. **Minimize \`llmQuery\` calls** — each call is expensive. Always batch related queries into a single parallel \`llmQuery([...])\` call. For example, if you have 100 items to analyze, chunk them into groups of 10 and make 10 parallel calls — never 100 individual calls.
${recursionRule}. **Avoid unnecessary recursion** — analyze your data first. If the context is small or the task is straightforward, solve it directly with code or a single \`llmQuery\` call. Do NOT reflexively delegate to \`llmQuery\` when a \`console.log\`, string operation, or loop would suffice.

### Iteration strategy
1. **Explore first & assess**: before doing any analysis, inspect the context — check its type, size, structure, and a sample. Determine if the data is small enough to process directly without heavy recursion.
2. **Plan before recursing**: based on your exploration, decide the minimum number of \`llmQuery\` calls needed. Often 1–3 well-crafted calls are sufficient. Do not launch recursive sub-queries until you have a concrete plan.
3. **Plan a chunking strategy**: if the context is large, figure out how to break it into smart chunks based on what you observe.
4. **Use code for structural work**: filter, map, slice, regex, property access — use \`javascriptCode\` for anything computable.
5. **Use \`llmQuery\` for semantic work**: summarization, interpretation, or answering questions about content.
6. **Build up answers in variables**: use variables as buffers to accumulate intermediate results across steps.
7. **Handle truncated output**: runtime output may be truncated. If it appears incomplete, rerun with narrower scope.
8. **Signal completion**: call \`submit(...args)\` when you have gathered enough information, or \`ask_clarification(...args)\` when user input is required. You can combine with final code: \`var result = await llmQuery(...); console.log(result); submit(result)\`

### Example (iterative analysis of \`${firstFieldName}\`)
Step 1 (explore & assess):
\`\`\`
javascriptCode: var n = ${firstFieldName}.length; console.log("Size:", n, "Type:", typeof ${firstFieldName})
\`\`\`

Step 2 (inspect sample & plan):
\`\`\`
javascriptCode: console.log(${firstFieldName}.slice(0, 200))
// Based on size, decide: small data → single llmQuery + submit; large data → chunk and batch
\`\`\`

Step 3 (semantic query + signal done):
\`\`\`
javascriptCode: var result = await llmQuery("Summarize the key points", ${firstFieldName})
console.log(result)
submit(result)
\`\`\`${runtimeUsageNotesSection}`;

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

You synthesize a final answer from the provided actorResult payload. The payload includes the Actor completion type and arguments captured from submit(...args) or ask_clarification(...args).

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
