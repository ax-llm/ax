/**
 * Runtime primitive registry.
 *
 * The RLM stage templates (distiller.md, executor.md) advertise a small
 * set of built-in async functions to the LLM: `final`, `askClarification`,
 * `llmQuery`, `inspectRuntime`, `success`/`failed`, `discoverModules`/
 * `discoverFunctions`, etc.
 *
 * Historically these were hand-written into each template as bullet lists,
 * which drifted apart as primitives were added. This module is the single
 * source of truth: each primitive is declared once with its stages and
 * gating flag, and the templates render the filtered list via a
 * `{{ primitivesList }}` variable.
 */

export type AxRuntimePrimitiveStage = 'distiller' | 'executor';

export interface AxRuntimePrimitive {
  /** Stable id; used for testing / debugging. */
  readonly id: string;
  /** Which actor stages advertise this primitive. */
  readonly stages: readonly AxRuntimePrimitiveStage[];
  /**
   * Optional gating flag name. If set, the primitive is only rendered when
   * `flags[enabledBy]` is truthy. Useful for conditional primitives like
   * `inspectRuntime` (only when the runtime supports `inspectGlobals`) or
   * `success`/`failed` (only when an agent status callback is wired).
   */
  readonly enabledBy?: string;
  /**
   * Pre-formatted callable blocks. Each entry renders as a self-contained
   * description-then-signature block (description on one line, backticked
   * signature on the next). Multiple entries model overloads
   * (`final(message)` vs `final(task, context)`); they are emitted as
   * separate blocks separated by a blank line.
   */
  readonly lines: readonly string[];
}

/**
 * Canonical, ordered registry of RLM actor primitives. Order here is the
 * order rendered into the prompt.
 */
export const axRuntimePrimitives: readonly AxRuntimePrimitive[] = [
  {
    id: 'llmQuery',
    stages: ['distiller', 'executor'],
    lines: [
      'Ask focused questions about the narrowed context you pass in.\n`await llmQuery([{ query: string, context: any }, ...]): string[]`',
    ],
  },
  {
    id: 'final',
    stages: ['distiller', 'executor'],
    lines: [
      'Signal completion. Pass a concise instruction and the raw evidence; the responder synthesizes the output. Omit `context` when the answer is directly known.\n`await final(task: string, context?: object)`',
    ],
  },
  {
    id: 'askClarification',
    stages: ['distiller', 'executor'],
    lines: [
      "Ask the user for clarification when genuinely blocked on an ambiguity you cannot resolve.\n`await askClarification(spec: string | { question: string, type?: 'text'|'date'|'number'|'single_choice'|'multiple_choice', choices?: string[] }): void`",
    ],
  },
  {
    id: 'success',
    stages: ['executor'],
    enabledBy: 'hasAgentStatusCallback',
    lines: [
      'Report a successful sub-task completion to the user.\n`await success(message: string)`',
    ],
  },
  {
    id: 'failed',
    stages: ['executor'],
    enabledBy: 'hasAgentStatusCallback',
    lines: [
      'Report a failed sub-task to the user.\n`await failed(message: string)`',
    ],
  },
  {
    id: 'inspectRuntime',
    stages: ['distiller', 'executor'],
    enabledBy: 'hasInspectRuntime',
    lines: [
      'Returns a compact snapshot of user-defined variables in the current session (name, type, size, preview). Use this to re-ground yourself when the conversation is long.\n`await inspectRuntime(): string`',
    ],
  },
  {
    id: 'discoverModules',
    stages: ['executor'],
    enabledBy: 'discoveryMode',
    lines: [
      'Discover available functions in each module (docs become available next turn).\n`await discoverModules(modules: string[]): void`',
      'Discover full definitions for specified functions (docs become available next turn).\n`await discoverFunctions(functions: string[]): void`',
    ],
  },
  {
    id: 'consult',
    stages: ['executor'],
    enabledBy: 'skillsMode',
    lines: [
      'Consult skill guides by description. Matched skill bodies are added to the system prompt for subsequent turns. Read the **Loaded Skills** section to see what landed.\n`await consult(searches: string[]): void`',
    ],
  },
  {
    id: 'recall',
    stages: ['distiller', 'executor'],
    enabledBy: 'memoriesMode',
    lines: [
      'Recall memories by description. Matched `{id, content}` entries are appended to `inputs.memories` for subsequent turns. Read `inputs.memories` next turn to see what landed.\n`await recall(searches: string[]): void`',
    ],
  },
];

/**
 * Render the filtered primitive list as a markdown block for the prompt.
 * Stage-gates and flag-gates primitives; omits any gated-out entries so the
 * prompt stays tight. Each rendered entry is a description-then-signature
 * block; entries are separated by blank lines.
 */
export function renderPrimitivesList(
  stage: AxRuntimePrimitiveStage,
  flags: Readonly<Record<string, boolean | undefined>>,
  overrides?: ReadonlyMap<string, readonly string[]>
): string {
  const blocks: string[] = [];
  for (const p of axRuntimePrimitives) {
    if (!p.stages.includes(stage)) continue;
    if (p.enabledBy && !flags[p.enabledBy]) continue;
    const lines = overrides?.get(p.id) ?? p.lines;
    for (const block of lines) {
      blocks.push(block);
    }
  }
  return blocks.join('\n\n');
}

/**
 * Returns the list of primitive ids that *would* be rendered for the given
 * stage and flag set. Used by AxAgent to enumerate which primitives are
 * candidates for optimization in the current configuration.
 */
export function visibleRuntimePrimitives(
  stage: AxRuntimePrimitiveStage,
  flags: Readonly<Record<string, boolean | undefined>>
): readonly AxRuntimePrimitive[] {
  return axRuntimePrimitives.filter((p) => {
    if (!p.stages.includes(stage)) return false;
    if (p.enabledBy && !flags[p.enabledBy]) return false;
    return true;
  });
}
