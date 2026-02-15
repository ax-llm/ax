/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

import { toFieldType } from '../dsp/prompt.js';
import type { AxIField } from '../dsp/sig.js';

/**
 * A code interpreter that can create persistent sessions.
 * Implement this interface for your target runtime (Node.js, browser, WASM, etc.).
 */
export interface AxCodeInterpreter {
  readonly language: string; // e.g. 'JavaScript', 'Python'
  createSession(globals?: Record<string, unknown>): AxCodeSession;
}

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
  runtime?: AxCodeInterpreter;
  /**
   * @deprecated Use `runtime` instead.
   * Backward-compatible alias.
   */
  interpreter?: AxCodeInterpreter;
  /** Cap on recursive sub-LM calls (default: 50). */
  maxLlmCalls?: number;
  /** Maximum characters passed into a single llmQuery context (default: 20000). */
  maxSubQueryContextChars?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** Maximum characters returned from one codeInterpreter call (default: 10000). */
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
- \`await llmQuery([{ query, context? }, ...])\` — Parallel sub-queries. Returns string[].

Sub-queries have a call limit — use parallel queries and keep each context small.
Target chunks should usually be <= 10,000 chars for semantic sub-calls.
There is also a hard runtime cap on context size per \`llmQuery\` call. If you hit a size error, chunk/filter the context into smaller pieces and retry.

### Iteration strategy
- Explore first: inspect type/size/sample before heavy processing.
- Iterate in small steps: run short code, inspect output, then decide next step.
- Verify before final answer: if outputs look empty/odd, reassess and rerun.
- Keep long values in variables; avoid retyping large snippets.
- Use \`llmQuery\` for semantic understanding, not for basic filtering/slicing.

### Execution rules
- Sync code: use \`var\` (not \`const\`/\`let\`) to persist variables across calls. The last expression is auto-returned.
- Async code (with \`await\`): use bare assignments (e.g. \`results = await ...\`) to persist. Use \`return\` to produce output.

### Example
Analyzing \`${firstFieldName}\`:

**Call 1** — probe:
\`\`\`
var n = ${firstFieldName}.length
n
\`\`\`
→ 42

**Call 2** — chunk and query in parallel:
\`\`\`
var chunks = []
for (var i = 0; i < n; i += 5) chunks.push(JSON.stringify(${firstFieldName}.slice(i, i + 5)))
results = await llmQuery(chunks.map(c => ({ query: "Summarize key points", context: c })))
return results
\`\`\`
→ ["Summary of chunk 1...", "Summary of chunk 2...", ...]

**Call 3** — aggregate:
\`\`\`
answer = await llmQuery("Synthesize these summaries into a final answer", results.join("\\n"))
return answer
\`\`\`
→ "Final synthesized answer..."

Then provide the final answer with the required output fields.

### Guidelines
- Use code for structural work (filter, map, slice, regex, property access); use \`llmQuery\` for semantic understanding.
- Keep \`llmQuery\` context small — target <= 10,000 chars, and chunk/filter/slice before passing.
- Keep codeInterpreter output concise; print summaries/counts instead of massive dumps.
- If \`llmQuery\` fails, use try/catch and retry with a smaller chunk or different query.`;

  return rlmPrompt;
}
