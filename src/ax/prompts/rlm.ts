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
}

/**
 * @deprecated Use `AxCodeRuntime` instead.
 */
export type AxCodeInterpreter = AxCodeRuntime;

/**
 * A persistent code execution session. Variables persist across `execute()` calls.
 */
export interface AxCodeSession {
  execute(code: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  close(): void;
}

/**
 * RLM configuration for AxAgent.
 */
export interface AxRLMConfig {
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
  contextFields: readonly AxIField[] | readonly string[]
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

  const rlmPrompt = `${baseDefinition ? `${baseDefinition}\n\n` : ''}## Code Interpreter

You have a persistent ${language} REPL via the \`codeInterpreter\` function.
Variables and state persist across calls.

### Pre-loaded context variables
The following variables are available in the interpreter session:
${contextVarList}

### APIs
- \`await llmQuery(query, context?)\` — Ask a sub-LM a natural-language question. Pass context as a string (use JSON.stringify() for objects/arrays). Returns a string.
- \`await llmQuery([{ query, context? }, ...])\` — Parallel sub-queries. Returns string[]; failed items return \`[ERROR] ...\`.

Sub-queries have a call limit — use parallel queries and keep each context small.
There is also a runtime character cap for \`llmQuery\` context and \`codeInterpreter\` output. Oversized values are truncated automatically.

### Iteration strategy
- This is iterative: do not try to solve everything in one step.
- Explore first: inspect type/size/sample before heavy processing.
- Iterate in small steps: run short code, inspect output, then decide next step.
- Verify before final answer: if outputs look empty/odd, reassess and rerun.
- Always print key intermediate checks so you can validate assumptions.
- Keep long values in variables; avoid retyping large snippets.
- Use \`llmQuery\` for semantic understanding, not for basic filtering/slicing.

### Execution rules
- Sync code: use \`var\` (not \`const\`/\`let\`) to persist variables across calls. The last expression is auto-returned.
- Async code (with \`await\`): use bare assignments (e.g. \`results = await ...\`) to persist. A simple trailing expression is also auto-returned, but explicit \`return\` is still the safest option.
- Convenience: \`return <expr>\` also works as a single-line sync snippet.

### Example
Analyzing \`${firstFieldName}\`:

**Call 1** — probe:
\`\`\`
var n = ${firstFieldName}.length
n
\`\`\`
→ 42

**Call 2** — filter/select relevant items first:
\`\`\`
var subset = ${firstFieldName}.slice(0, 5)
subset.length
\`\`\`
→ 5

**Call 3** — run semantic queries on selected context:
\`\`\`
results = await llmQuery(
  subset.map(item => ({
    query: "Summarize key points",
    context: JSON.stringify(item)
  }))
)
return results
\`\`\`
→ ["Summary 1...", "Summary 2...", ...]

**Call 4** — handle failed batch items if any:
\`\`\`
var ok = results.filter(r => !String(r).startsWith("[ERROR]"))
var failed = results.filter(r => String(r).startsWith("[ERROR]"))
return { okCount: ok.length, failedCount: failed.length }
\`\`\`
→ { okCount: 4, failedCount: 1 }

**Call 5** — aggregate:
\`\`\`
answer = await llmQuery("Synthesize these summaries into a final answer", ok.join("\\n"))
return answer
\`\`\`
→ "Final synthesized answer..."

Then provide the final answer with the required output fields.

### Guidelines
- Use code for structural work (filter, map, slice, regex, property access); use \`llmQuery\` for semantic understanding.
- Keep \`llmQuery\` context small and within the configured runtime cap (\`maxRuntimeChars\`).
- Keep codeInterpreter output concise; print summaries/counts instead of massive dumps.
- If output includes \`...[truncated N chars]\`, treat it as incomplete and retry with narrower context.
- For batched \`llmQuery\`, keep successes and retry only failed \`[ERROR] ...\` items.
- If \`llmQuery\` fails, use try/catch and retry with a smaller chunk or different query.`;

  return rlmPrompt;
}
