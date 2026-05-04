/**
 * Runtime primitive registry.
 *
 * The RLM actor templates (single-stage-actor.md, context-actor.md,
 * task-actor.md) all
 * advertise a small set of built-in async functions to the LLM: `final`,
 * `askClarification`, `llmQuery`, `inspect_runtime`, `success`/`failed`,
 * `discoverModules`/`discoverFunctions`, etc.
 *
 * Historically these were hand-written into each template as bullet lists,
 * which drifted apart as primitives were added. This module is the single
 * source of truth: each primitive is declared once with its stages and
 * gating flag, and the templates render the filtered list via a
 * `{{ primitivesList }}` variable.
 */

export type AxRuntimePrimitiveStage = 'context' | 'task' | 'combined';

export interface AxRuntimePrimitive {
  /** Stable id; used for testing / debugging. */
  readonly id: string;
  /** Which actor stages advertise this primitive. */
  readonly stages: readonly AxRuntimePrimitiveStage[];
  /**
   * Optional gating flag name. If set, the primitive is only rendered when
   * `flags[enabledBy]` is truthy. Useful for conditional primitives like
   * `inspect_runtime` (only when the runtime supports `inspectGlobals`) or
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
    stages: ['context', 'task', 'combined'],
    lines: [
      'Ask focused questions about the narrowed context you pass in.\n`await llmQuery([{ query: string, context: any }, ...]): string[]`',
    ],
  },
  {
    id: 'final',
    stages: ['context', 'task', 'combined'],
    lines: [
      'Signal completion. Pass a concise instruction and the raw evidence; the responder synthesizes the output. Omit `context` when the answer is directly known.\n`await final(task: string, context?: object)`',
    ],
  },
  {
    id: 'askClarification',
    stages: ['context', 'task', 'combined'],
    lines: [
      "Ask the user for clarification when genuinely blocked on an ambiguity you cannot resolve.\n`await askClarification(spec: string | { question: string, type?: 'text'|'date'|'number'|'single_choice'|'multiple_choice', choices?: string[] }): void`",
    ],
  },
  {
    id: 'success',
    stages: ['task', 'combined'],
    enabledBy: 'hasAgentStatusCallback',
    lines: [
      'Report a successful sub-task completion to the user.\n`await success(message: string)`',
    ],
  },
  {
    id: 'failed',
    stages: ['task', 'combined'],
    enabledBy: 'hasAgentStatusCallback',
    lines: [
      'Report a failed sub-task to the user.\n`await failed(message: string)`',
    ],
  },
  {
    id: 'inspect_runtime',
    stages: ['context', 'task', 'combined'],
    enabledBy: 'hasInspectRuntime',
    lines: [
      'Returns a compact snapshot of user-defined variables in the current session (name, type, size, preview). Use this to re-ground yourself when the conversation is long.\n`await inspect_runtime(): string`',
    ],
  },
  {
    id: 'discoverModules',
    stages: ['task', 'combined'],
    enabledBy: 'discoveryMode',
    lines: [
      'Discover available functions in each module (docs become available next turn).\n`await discoverModules(modules: string[]): void`',
      'Discover full definitions for specified functions (docs become available next turn).\n`await discoverFunctions(functions: string[]): void`',
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
