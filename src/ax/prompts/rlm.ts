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
  readonly language: string; // e.g. 'JavaScript', 'Python'
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
  /** RLM execution mode (default: 'inline'). */
  mode?: 'function' | 'inline';
  /**
   * Language label used in inline mode helper field naming.
   * Example: 'javascript' -> `javascriptCode` (default: 'javascript').
   */
  language?: string;
  /** Input fields holding long context (will be removed from the LLM prompt). */
  contextFields: string[];
  /**
   * Code runtime for the REPL loop.
   * Preferred key.
   */
  runtime?: AxCodeRuntime;
  /**
   * @deprecated Use `runtime` instead.
   * Backward-compatible alias.
   */
  interpreter?: AxCodeRuntime;
  /** Cap on recursive sub-LM calls (default: 50). */
  maxLlmCalls?: number;
  /**
   * Maximum characters for RLM runtime payloads (default: 5000).
   * Applies to llmQuery context and codeInterpreter output.
   */
  maxRuntimeChars?: number;
  /** @deprecated Use `maxRuntimeChars` instead. */
  maxSubQueryContextChars?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** @deprecated Use `maxRuntimeChars` instead. */
  maxInterpreterOutputChars?: number;
  /** Model for llmQuery sub-calls (default: same as parent). */
  subModel?: string;
}

/**
 * Builds the RLM system prompt that instructs the LLM on how to use the
 * code interpreter, context variables, and llmQuery for semantic analysis.
 */
export function axBuildRLMDefinition(
  baseDefinition: string | undefined,
  language: string,
  contextFields: readonly AxIField[] | readonly string[],
  options?: Readonly<{
    mode?: 'function' | 'inline';
    inlineCodeFieldName?: string;
    inlineLanguage?: string;
    runtimeUsageInstructions?: string;
    maxLlmCalls?: number;
  }>
): string {
  // Backward compat: convert string[] to minimal AxIField[]
  const fields: readonly AxIField[] =
    contextFields.length > 0 && typeof contextFields[0] === 'string'
      ? (contextFields as readonly string[]).map((name) => ({
          name,
          title: name,
        }))
      : (contextFields as readonly AxIField[]);

  const contextVarList = fields
    .map((f) => {
      const typeStr = toFieldType(f.type);
      const desc = f.description ? `: ${f.description}` : '';
      return `- \`${f.name}\` (${typeStr})${desc}`;
    })
    .join('\n');

  const firstFieldName = fields[0]?.name ?? 'context';

  const mode = options?.mode ?? 'function';
  const inlineCodeFieldName = options?.inlineCodeFieldName ?? 'javascriptCode';
  const inlineLanguage = options?.inlineLanguage ?? 'javascript';
  const maxLlmCalls = options?.maxLlmCalls ?? 50;
  const runtimeUsageInstructions =
    options?.runtimeUsageInstructions?.trim() ?? '';
  const runtimeUsageNotesSection = runtimeUsageInstructions
    ? `\n\n### Runtime-specific usage notes\n${runtimeUsageInstructions}`
    : '';

  if (mode === 'inline') {
    const inlineBody = `## Iterative Context Analysis

You have a persistent ${inlineLanguage} runtime session. Variables and state persist across iterations. Use it to interactively explore, transform, and analyze context. You are strongly encouraged to use sub-LM queries for semantic analysis.

### Pre-loaded context variables
The following variables are available in the runtime session:
${contextVarList}

### Helper output fields
- \`${inlineCodeFieldName}\` (optional): ${inlineLanguage} code to execute in the persistent runtime session. Emitting this field means the current step is a code step; omitting it signals that you are providing the final answer.

### Runtime APIs (available inside \`${inlineCodeFieldName}\`)
- \`await llmQuery(query, context?)\` — Single sub-query. Both arguments are strings (pass context via JSON.stringify() for objects/arrays). Returns a string. Sub-LMs are powerful and can handle large context, so do not be afraid to pass substantial context to them.
- \`await llmQuery([{ query, context? }, ...])\` — Parallel batch. Pass an array of { query, context? } objects. Returns string[]; failed items return \`[ERROR] ...\`. Use parallel queries when you have multiple independent chunks — it is much faster than sequential calls.

Sub-queries have a call limit of ${maxLlmCalls} — use parallel queries and keep each context small.
There is also a runtime character cap for \`llmQuery\` context and code output. Oversized values are truncated automatically.

### Iteration strategy
1. **Explore first**: before doing any analysis, inspect the context — check its type, size, structure, and a sample. Do not try to solve everything in the first step.
2. **Plan a chunking strategy**: figure out how to break the context into smart chunks (by section, by index range, by regex pattern, etc.) based on what you observe.
3. **Use code for structural work**: filter, map, slice, regex, property access — use \`${inlineCodeFieldName}\` for anything computable.
4. **Use \`llmQuery\` for semantic work**: summarization, interpretation, or answering questions about content. Keep each query focused but do not be afraid to pass substantial context.
5. **Build up answers in variables**: use variables as buffers to accumulate intermediate results across steps, then combine them for the final answer.
6. **Handle truncated output**: runtime output may be truncated. If it appears incomplete, rerun with narrower scope or smaller slices.
7. **Verify before finishing**: check that your outputs look correct before emitting the final answer.

### Example (iterative analysis of \`${firstFieldName}\`)
Step 1 (explore context — only code field, no business output fields):
\`\`\`
${inlineCodeFieldName}: var n = ${firstFieldName}.length; n
\`\`\`

Step 2 (inspect structure and plan chunking):
\`\`\`
${inlineCodeFieldName}: var sample = JSON.stringify(${firstFieldName}.slice(0, 2)); sample
\`\`\`

Step 3 (semantic batch — query sub-LMs on chunks with context):
\`\`\`
${inlineCodeFieldName}: var chunks = [${firstFieldName}.slice(0, 5), ${firstFieldName}.slice(5, 10)]
results = await llmQuery(chunks.map(c => ({ query: "Summarize the key points", context: JSON.stringify(c) })))
results
\`\`\`

Step 4 (aggregate in a buffer variable):
\`\`\`
${inlineCodeFieldName}: var ok = results.filter(r => !String(r).startsWith("[ERROR]"))
var combined = ok.join("\\n"); combined
\`\`\`

Step 5 (finish — no code field, only business output fields):
\`\`\`
<required output fields here — do NOT include ${inlineCodeFieldName}>
\`\`\`

### Important
- **Intermediate steps**: emit ONLY \`${inlineCodeFieldName}\`. Do not include any business output fields alongside code.
- **Final step**: provide all required business output fields. Do not include \`${inlineCodeFieldName}\` in the final step.
- Each step is either a code step or the final answer — never both.${runtimeUsageNotesSection}`;

    return baseDefinition ? `${inlineBody}\n\n${baseDefinition}` : inlineBody;
  }

  const rlmBody = `## Iterative Context Analysis

You have a persistent ${language} REPL via the \`codeInterpreter\` function. Variables and state persist across calls. Use it to interactively explore, transform, and analyze context. You are strongly encouraged to use sub-LM queries for semantic analysis.

### Pre-loaded context variables
The following variables are available in the interpreter session:
${contextVarList}

### APIs
- \`await llmQuery(query, context?)\` — Single sub-query. Both arguments are strings (pass context via JSON.stringify() for objects/arrays). Returns a string. Sub-LMs are powerful and can handle large context, so do not be afraid to pass substantial context to them.
- \`await llmQuery([{ query, context? }, ...])\` — Parallel batch. Pass an array of { query, context? } objects. Returns string[]; failed items return \`[ERROR] ...\`. Use parallel queries when you have multiple independent chunks — it is much faster than sequential calls.

Sub-queries have a call limit of ${maxLlmCalls} — use parallel queries and keep each context small.
There is also a runtime character cap for \`llmQuery\` context and \`codeInterpreter\` output. Oversized values are truncated automatically.

### Iteration strategy
1. **Explore context first**: before any analysis, inspect the type, size, and structure of your context. Check a sample to understand the data shape.
2. **Plan a chunking strategy**: based on what you observe, figure out how to break the context into smart chunks (by section headers, by index ranges, by regex patterns, etc.).
3. **Iterate in small steps**: run short code, inspect output, then decide the next step. Do not try to solve everything in one call.
4. **Use code for structural work**: filter, map, slice, regex, property access — anything computable.
5. **Use \`llmQuery\` for semantic understanding**: summarization, interpretation, classification, or answering questions about content.
6. **Build up answers in variables**: use variables as buffers to accumulate results across calls, then aggregate them for the final answer.
7. **Handle truncation**: you will only see truncated output from the REPL. If output appears incomplete, rerun with narrower scope.
8. **Verify before final answer**: if outputs look empty or unexpected, reassess and rerun. Always surface key intermediate checks so you can validate assumptions.

### Example
Analyzing \`${firstFieldName}\`:

**Call 1** — explore context:
\`\`\`
var n = ${firstFieldName}.length
var sample = JSON.stringify(${firstFieldName}.slice(0, 2))
return { count: n, sample }
\`\`\`
→ { count: 42, sample: "[...]" }

**Call 2** — plan and chunk:
\`\`\`
var chunkSize = Math.ceil(n / 4)
var chunks = []
for (var i = 0; i < n; i += chunkSize) {
  chunks.push(${firstFieldName}.slice(i, i + chunkSize))
}
return chunks.length
\`\`\`
→ 4

**Call 3** — run semantic queries on chunks concurrently:
\`\`\`
results = await llmQuery(
  chunks.map(chunk => ({
    query: "Summarize the key points",
    context: JSON.stringify(chunk)
  }))
)
return results
\`\`\`
→ ["Summary of chunk 0...", "Summary of chunk 1...", ...]

**Call 4** — handle failed batch items if any:
\`\`\`
var ok = results.filter(r => !String(r).startsWith("[ERROR]"))
var failed = results.filter(r => String(r).startsWith("[ERROR]"))
return { okCount: ok.length, failedCount: failed.length }
\`\`\`
→ { okCount: 4, failedCount: 0 }

**Call 5** — aggregate into final answer:
\`\`\`
answer = await llmQuery("Synthesize these summaries into a final answer", ok.join("\\n"))
return answer
\`\`\`
→ "Final synthesized answer..."

Then provide the final answer with the required output fields.

### Guidelines
- Use code for structural work (filter, map, slice, regex, property access); use \`llmQuery\` for semantic understanding.
- Keep \`llmQuery\` context small and within the configured runtime cap (\`maxRuntimeChars\`).
- Keep codeInterpreter output concise; return or print summaries/counts instead of massive dumps.
- If output includes \`...[truncated N chars]\`, treat it as incomplete and retry with narrower context.
- For batched \`llmQuery\`, keep successes and retry only failed \`[ERROR] ...\` items.
- If \`llmQuery\` fails, use try/catch and retry with a smaller chunk or different query.
- Keep long values in variables; avoid retyping large snippets.${runtimeUsageNotesSection}`;

  return baseDefinition ? `${rlmBody}\n\n${baseDefinition}` : rlmBody;
}
