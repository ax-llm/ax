/**
 * Runtime primitive registry.
 *
 * The RLM stage templates (distiller.md, executor.md) advertise a small
 * set of built-in async functions to the LLM: `final`, `askClarification`,
 * `llmQuery`, `inspectRuntime`, `reportSuccess`/`reportFailure`,
 * `discoverModules`/`discoverFunctions`, etc.
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
   * `reportSuccess`/`reportFailure` (only when an agent status callback is wired).
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
      'End the turn. Use `final(task)` when the answer is direct; use `final(task, context)` to hand gathered evidence to downstream synthesis.\n`await final(task: string, context?: object)`',
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
    id: 'reportSuccess',
    stages: ['executor'],
    enabledBy: 'hasAgentStatusCallback',
    lines: [
      'Report a sub-task as **succeeded** to the user. Mid-run progress signal — does NOT end the turn. Use whenever a meaningful step lands; you may call it many times per turn. Use `final(...)` to end the turn.\n`await reportSuccess(message: string)`',
    ],
  },
  {
    id: 'reportFailure',
    stages: ['executor'],
    enabledBy: 'hasAgentStatusCallback',
    lines: [
      'Report a sub-task as **failed** to the user. Mid-run failure signal — does NOT end the turn; the actor continues and may retry. Use `final(...)` to end the turn.\n`await reportFailure(message: string)`',
    ],
  },
  {
    id: 'inspectRuntime',
    stages: ['distiller', 'executor'],
    enabledBy: 'hasInspectRuntime',
    lines: [
      "Returns a compact snapshot of variables you've created in this session. Use to re-ground yourself when the conversation is long.\n`await inspectRuntime(): string`",
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
      'Consult skill guides by description. Matched skill bodies land in the **Loaded Skills** section next turn — read it to see what landed. Returns nothing.\n`await consult(searches: string[]): void`',
    ],
  },
  {
    id: 'recall',
    stages: ['distiller', 'executor'],
    enabledBy: 'memoriesMode',
    lines: [
      'Recall memories by description. Matched `{id, content}` entries land on `inputs.memories` next turn — read it to see what landed. Returns nothing.\n`await recall(searches: string[]): void`',
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
