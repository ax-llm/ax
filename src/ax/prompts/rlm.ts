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
  execute(code: string): Promise<unknown>;
  close(): void;
}

/**
 * RLM configuration for AxAgent.
 */
export interface AxRLMConfig {
  /** Input fields holding long context (will be removed from the LLM prompt). */
  contextFields: string[];
  /** Code interpreter for the REPL loop. Required. */
  interpreter: AxCodeInterpreter;
  /** Cap on recursive sub-LM calls (default: 50). */
  maxLlmCalls?: number;
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

### Available APIs
- \`await llmQuery(query, context?)\` — Ask a sub-LM a natural-language question. Optionally pass a context string (for objects/arrays, use JSON.stringify()). Returns a string.
- \`await llmQueryBatched([{ query, context? }, ...])\` — Run multiple sub-LM queries in parallel (same context rules as llmQuery). Returns string[]. Each query counts toward the call limit.
- \`print(...args)\` — Print output (appears in the function result).

### Workflow
1. The variable schemas are described above — use property names directly in code. Probe only for runtime size (e.g. \`${firstFieldName}.length\`).
2. Use code to process the context — property access, array methods (.map, .filter), string operations, regex, or iteration as appropriate for the data type.
3. For semantic analysis, pass relevant subsets to llmQuery — strings directly, objects/arrays via JSON.stringify().
4. For parallel analysis, use \`await llmQueryBatched([...])\`.
5. Aggregate results as needed.
6. When done, provide your final answer with the required output fields.

### Tips
- Keep llmQuery context small — for strings, chunk the text; for structured data, filter or slice to relevant items.
- Use code for structural operations (.map, .filter, property access for objects; split, regex for strings) and llmQuery for semantic understanding.
- Use \`var\` (not \`const\`/\`let\`) to persist variables across calls for synchronous code.
- When using \`await\`, use bare assignments (e.g. \`results = await llmQuery(...)\`) to persist values.
- The last expression value is auto-returned for synchronous code. When using \`await\`, code runs inside a wrapper function, so use \`return <value>\` to produce output.
- If \`llmQuery\` fails with an error, use try/catch and retry with a smaller chunk or different query.`;

  return rlmPrompt;
}
