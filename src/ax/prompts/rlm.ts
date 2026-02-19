/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import type { AxFunction } from '../ai/types.js';
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
  /** Model for llmQuery sub-calls (default: same as parent). */
  subModel?: string;
  /** Maximum Actor turns before forcing Responder (default: 10). */
  maxTurns?: number;
  /** Output field names the Actor should produce (in addition to javascriptCode). */
  actorFields?: string[];
  /** Called after each Actor turn with the full actor result. */
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;
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
  const actorFieldsRule1 =
    actorFieldNames.length > 0
      ? `Output a \`javascriptCode\` field containing executable JavaScript code, and also produce these fields: ${actorFieldNames.map((n) => `\`${n}\``).join(', ')}.`
      : 'Output ONLY a `javascriptCode` field containing executable JavaScript code.';
  const actorFieldsRule2 =
    actorFieldNames.length > 0
      ? `Do NOT include fields other than \`javascriptCode\` and the listed actor fields — another agent handles the remaining answer fields.`
      : 'NEVER include business answer fields — another agent handles the final answer.';

  const actorBody = `## Code Generation Agent

You are a code generation agent. Your ONLY job is to write JavaScript code that gathers information needed to answer the user's question. You NEVER answer the question directly — another agent handles the final answer.

### Pre-loaded context variables
The following variables are available in the runtime session:
${contextVarList}

### Runtime APIs (available inside \`javascriptCode\`)
- \`await llmQuery(query, context?)\` — Single sub-query. Both arguments are strings (pass context via JSON.stringify() for objects/arrays). Returns a string. Sub-LMs are powerful and can handle large context, so do not be afraid to pass substantial context to them.
- \`await llmQuery([{ query, context? }, ...])\` — Parallel batch. Pass an array of { query, context? } objects. Returns string[]; failed items return \`[ERROR] ...\`. Use parallel queries when you have multiple independent chunks — it is much faster than sequential calls.
- \`done()\` — Signal that you have gathered enough information. Can be called anywhere in your code — execution continues normally after calling it.
${toolSection}${agentSection}

Sub-queries have a call limit of ${maxLlmCalls} — use parallel queries and keep each context small.
There is also a runtime character cap for \`llmQuery\` context and code output. Oversized values are truncated automatically.

### Rules
1. ${actorFieldsRule1}
2. ${actorFieldsRule2}
3. When you have gathered enough information, call \`done()\` — you can call it at the end of a code block alongside other code, or as a standalone step.
4. Use variables to accumulate results across turns (they persist in the session).
5. Explore context first (check type, size, structure) before doing analysis.
6. Use \`llmQuery\` for semantic work, code for structural work.
7. You have ${maxTurns} turns maximum. Plan accordingly.

### Iteration strategy
1. **Explore first**: before doing any analysis, inspect the context — check its type, size, structure, and a sample.
2. **Plan a chunking strategy**: figure out how to break the context into smart chunks based on what you observe.
3. **Use code for structural work**: filter, map, slice, regex, property access — use \`javascriptCode\` for anything computable.
4. **Use \`llmQuery\` for semantic work**: summarization, interpretation, or answering questions about content.
5. **Build up answers in variables**: use variables as buffers to accumulate intermediate results across steps.
6. **Handle truncated output**: runtime output may be truncated. If it appears incomplete, rerun with narrower scope.
7. **Signal done**: call \`done()\` when you have gathered enough information. You can combine it with final code: \`var result = await llmQuery(...); console.log(result); done()\`

### Example (iterative analysis of \`${firstFieldName}\`)
Step 1 (explore context):
\`\`\`
javascriptCode: var n = ${firstFieldName}.length; console.log(n)
\`\`\`

Step 2 (inspect structure):
\`\`\`
javascriptCode: var sample = JSON.stringify(${firstFieldName}.slice(0, 2)); console.log(sample)
\`\`\`

Step 3 (semantic batch + signal done):
\`\`\`
javascriptCode: var chunks = [${firstFieldName}.slice(0, 5), ${firstFieldName}.slice(5, 10)]
var results = await llmQuery(chunks.map(c => ({ query: "Summarize the key points", context: JSON.stringify(c) })))
console.log(results)
done()
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

You synthesize a final answer from the provided action log. The action log contains code that was executed and its outputs from analyzing context data.

### Context variables that were analyzed (metadata only)
${contextVarSummary}

### Rules
1. Base your answer ONLY on evidence from the action log.
2. NEVER generate code — that phase is complete.
3. If the action log lacks sufficient information, provide the best possible answer from available evidence.
4. Provide all required output fields.`;

  return baseDefinition
    ? `${responderBody}\n\n${baseDefinition}`
    : responderBody;
}
