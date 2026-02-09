/**
 * RLM (Recursive Language Model) interfaces and prompt builder.
 *
 * Pluggable interpreter interface — anyone can implement for any runtime.
 * No Node.js-specific imports; browser-safe.
 */

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
  contextFieldNames: string[]
): string {
  const contextVarList = contextFieldNames.join(', ');

  const rlmPrompt = `${baseDefinition ? `${baseDefinition}\n\n` : ''}## Code Interpreter

You have a persistent ${language} REPL via the \`codeInterpreter\` function.
Variables and state persist across calls.

### Pre-loaded context variables
The following variables are available in the interpreter session: ${contextVarList}

### Available APIs
- \`await llmQuery(query, context?)\` — Ask a sub-LM a natural-language question. Optionally pass a context string.
- \`await llmQueryBatched([{ query, context? }, ...])\` — Run multiple sub-LM queries in parallel.
- \`print(...args)\` — Print output (appears in the function result).

### Workflow
1. First, peek at the context to understand its structure (e.g. \`typeof ${contextFieldNames[0] ?? 'context'}\`, \`${contextFieldNames[0] ?? 'context'}.length\`, \`${contextFieldNames[0] ?? 'context'}.slice(0, 500)\`).
2. Use string operations, regex, chunking, and iteration to process the context.
3. For semantic analysis of chunks, use \`await llmQuery(question, chunk)\`.
4. For parallel analysis, use \`await llmQueryBatched([...])\`.
5. Aggregate results as needed.
6. When done, provide your final answer with the required output fields.

### Tips
- Never try to pass the full context to llmQuery — chunk it first.
- Use code for structural operations (split, filter, count, regex) and llmQuery for semantic understanding.
- Use \`var\` (not \`const\`/\`let\`) to persist variables across calls for synchronous code.
- When using \`await\`, use bare assignments (e.g. \`results = await llmQuery(...)\`) to persist values.
- The last expression value is auto-returned for synchronous code. When using \`await\`, code runs inside a wrapper function, so use \`return <value>\` to produce output.
- If \`llmQuery\` fails with an error, use try/catch and retry with a smaller chunk or different query.`;

  return rlmPrompt;
}
