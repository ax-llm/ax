/**
 * Runtime primitive registry.
 *
 * The RLM stage templates (distiller.md, executor.md) advertise a small
 * set of built-in async functions to the LLM: `final`, `askClarification`,
 * `llmQuery`, `inspectRuntime`, `reportSuccess`/`reportFailure`,
 * `discover`, etc.
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
  /** Optional required flag name. */
  readonly enabledBy?: string;
  /** Optional flag names where at least one must be truthy. */
  readonly enabledByAny?: readonly string[];
  /** Short purpose statement rendered above the overloads. */
  readonly description: string;
  /** Signature overloads rendered as separate backticked lines. */
  readonly signatures: readonly AxRuntimePrimitiveSignature[];
  /** Optional examples rendered under the overload list. */
  readonly examples?: readonly AxRuntimePrimitiveExample[];
}

export type AxRuntimePrimitiveSignature = {
  readonly code: string;
  readonly enabledBy?: string;
  readonly enabledByAny?: readonly string[];
  readonly disabledBy?: string;
};

export type AxRuntimePrimitiveExample = {
  readonly code: string;
  readonly enabledBy?: string;
  readonly enabledByAny?: readonly string[];
  readonly disabledBy?: string;
};

/**
 * Canonical, ordered registry of RLM actor primitives. Order here is the
 * order rendered into the prompt.
 */
export const axRuntimePrimitives: readonly AxRuntimePrimitive[] = [
  {
    id: 'llmQuery',
    stages: ['distiller', 'executor'],
    description:
      'Ask focused questions about the narrowed context you pass in.',
    signatures: [
      {
        code: 'await llmQuery([{ query: string, context: any }, ...]): string[]',
      },
    ],
  },
  {
    id: 'final',
    stages: ['distiller', 'executor'],
    description:
      'End the turn. Use `final(task)` when the answer is direct; use `final(task, context)` to hand gathered evidence to downstream synthesis.',
    signatures: [{ code: 'await final(task: string, context?: object)' }],
  },
  {
    id: 'askClarification',
    stages: ['distiller', 'executor'],
    description:
      'Ask the user for clarification when genuinely blocked on an ambiguity you cannot resolve.',
    signatures: [
      {
        code: "await askClarification(spec: string | { question: string, type?: 'text'|'date'|'number'|'single_choice'|'multiple_choice', choices?: string[] }): void",
      },
    ],
  },
  {
    id: 'reportSuccess',
    stages: ['executor'],
    enabledBy: 'hasAgentStatusCallback',
    description:
      'Report a sub-task as **succeeded** to the user. Mid-run progress signal — does NOT end the turn. Use whenever a meaningful step lands; you may call it many times per turn. Use `final(...)` to end the turn.',
    signatures: [{ code: 'await reportSuccess(message: string)' }],
  },
  {
    id: 'reportFailure',
    stages: ['executor'],
    enabledBy: 'hasAgentStatusCallback',
    description:
      'Report a sub-task as **failed** to the user. Mid-run failure signal — does NOT end the turn; the actor continues and may retry. Use `final(...)` to end the turn.',
    signatures: [{ code: 'await reportFailure(message: string)' }],
  },
  {
    id: 'inspectRuntime',
    stages: ['distiller', 'executor'],
    enabledBy: 'hasInspectRuntime',
    description:
      "Returns a compact snapshot of variables you've created in this session. Use to re-ground yourself when the conversation is long.",
    signatures: [{ code: 'await inspectRuntime(): string' }],
  },
  {
    id: 'discover',
    stages: ['distiller', 'executor'],
    enabledByAny: ['discoveryMode', 'skillsMode'],
    description:
      'Load tool docs and skill guides into the next turn. Use one batched call.',
    signatures: [
      {
        code: 'await discover(item: string): void',
        enabledBy: 'discoveryMode',
      },
      {
        code: 'await discover(items: string[]): void',
        enabledBy: 'discoveryMode',
      },
      {
        code: 'await discover(request: { skills: string | string[] }): void',
        enabledBy: 'skillsMode',
        disabledBy: 'discoveryMode',
      },
      {
        code: 'await discover(request: { tools?: string | string[], skills?: string | string[] }): void',
        enabledByAny: ['discoveryMode+skillsMode'],
      },
    ],
    examples: [
      { code: "await discover('db');", enabledBy: 'discoveryMode' },
      {
        code: "await discover(['db', 'db.search']);",
        enabledBy: 'discoveryMode',
      },
      {
        code: "await discover({ skills: ['release checklist'] });",
        enabledBy: 'skillsMode',
        disabledBy: 'discoveryMode',
      },
      {
        code: "await discover({ tools: ['db'], skills: ['release checklist'] });",
        enabledByAny: ['discoveryMode+skillsMode'],
      },
    ],
  },
  {
    id: 'recall',
    stages: ['distiller', 'executor'],
    enabledBy: 'memoriesMode',
    description:
      'Recall memories by description. Matched `{id, content}` entries land on `inputs.memories` next turn — read it to see what landed. Returns nothing.',
    signatures: [{ code: 'await recall(searches: string[]): void' }],
  },
  {
    id: 'used',
    stages: ['distiller', 'executor'],
    enabledBy: 'usageTrackingMode',
    description:
      'Declare a loaded memory id or skill id that actually influenced this turn. Loaded-but-unused entries must be omitted. Returns nothing.',
    signatures: [{ code: 'await used(id: string, reason?: string): void' }],
  },
];

function flagEnabled(
  flags: Readonly<Record<string, boolean | undefined>>,
  flag: string | undefined
): boolean {
  if (!flag) return true;
  if (flag.includes('+')) {
    return flag.split('+').every((part) => Boolean(flags[part]));
  }
  return Boolean(flags[flag]);
}

function anyFlagEnabled(
  flags: Readonly<Record<string, boolean | undefined>>,
  flagNames: readonly string[] | undefined
): boolean {
  if (!flagNames || flagNames.length === 0) return true;
  return flagNames.some((flag) => flagEnabled(flags, flag));
}

function primitiveEnabled(
  primitive: AxRuntimePrimitive,
  flags: Readonly<Record<string, boolean | undefined>>
): boolean {
  return (
    flagEnabled(flags, primitive.enabledBy) &&
    anyFlagEnabled(flags, primitive.enabledByAny)
  );
}

function entryEnabled(
  entry: Readonly<{
    enabledBy?: string;
    enabledByAny?: readonly string[];
    disabledBy?: string;
  }>,
  flags: Readonly<Record<string, boolean | undefined>>
): boolean {
  return (
    flagEnabled(flags, entry.enabledBy) &&
    anyFlagEnabled(flags, entry.enabledByAny) &&
    (!entry.disabledBy || !flagEnabled(flags, entry.disabledBy))
  );
}

export function renderRuntimePrimitive(
  primitive: AxRuntimePrimitive,
  flags: Readonly<Record<string, boolean | undefined>>,
  override?: readonly string[]
): string {
  if (override) {
    return override.join('\n\n');
  }

  const signatures = primitive.signatures
    .filter((signature) => entryEnabled(signature, flags))
    .map((signature) => `\`${signature.code}\``);

  const examples = (primitive.examples ?? [])
    .filter((example) => entryEnabled(example, flags))
    .map((example) => example.code);

  const parts = [primitive.description, ...signatures];
  if (examples.length > 0) {
    parts.push(`Examples:\n\`\`\`js\n${examples.join('\n')}\n\`\`\``);
  }

  return parts.join('\n');
}

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
    if (!primitiveEnabled(p, flags)) continue;
    blocks.push(renderRuntimePrimitive(p, flags, overrides?.get(p.id)));
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
    return primitiveEnabled(p, flags);
  });
}
