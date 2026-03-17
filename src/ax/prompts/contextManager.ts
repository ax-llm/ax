/**
 * Semantic Context Management for the AxAgent RLM loop.
 *
 * Manages the action log by evaluating step importance via hindsight heuristics,
 * generating compact tombstones for resolved errors, and pruning low-value entries
 * to maximize context window utility.
 */

import type { AxAIService } from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';
import {
  extractTopLevelDurableWriteTargets,
  extractTopLevelDeclaredNames,
  stripJsStringsAndComments,
} from '../util/jsAnalysis.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionLogTag =
  | 'error'
  | 'dead-end'
  | 'foundational'
  | 'pivot'
  | 'superseded';

export type ActionLogStepKind =
  | 'explore'
  | 'transform'
  | 'query'
  | 'finalize'
  | 'error';

export type ActionReplayMode = 'full' | 'omit';

type DiscoveryModuleSection = {
  module: string;
  text: string;
};

type DiscoveryFunctionSection = {
  qualifiedName: string;
  text: string;
};

export type ActionLogEntry = {
  turn: number;
  code: string;
  output: string;
  actorFieldsOutput: string;
  tags: ActionLogTag[];
  summary?: string;
  producedVars?: string[];
  referencedVars?: string[];
  stateDelta?: string;
  stepKind?: ActionLogStepKind;
  replayMode?: ActionReplayMode;
  /** 0-5 importance score set by hindsight evaluation. */
  rank?: number;
  /** Compact summary replacing full code+output when rendered. */
  tombstone?: string;
  /** @internal Pending tombstone generation. */
  _tombstonePromise?: Promise<string>;
  /** @internal Parsed discovery module sections for prompt-facing filtering. */
  _discoveryModuleSections?: readonly DiscoveryModuleSection[];
  /** @internal Parsed discovery callable sections for prompt-facing filtering. */
  _discoveryFunctionSections?: readonly DiscoveryFunctionSection[];
  /** @internal Direct qualified callable usages like `db.search(...)`. */
  _directQualifiedCalls?: readonly string[];
};

/** Resolved config passed to `manageContext`. */
export type ContextManagementEffectiveConfig = {
  errorPruning: boolean;
  hindsightEvaluation: boolean;
  tombstoning:
    | boolean
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined;
  pruneRank: number;
  rankPruneGraceTurns: number;
  pruneUsedDocs: boolean;
  actionReplay: 'full' | 'adaptive' | 'minimal';
  recentFullActions: number;
  stateSummary: { enabled: boolean; maxEntries?: number; maxChars?: number };
  stateInspection: { enabled: boolean; contextThreshold?: number };
  checkpoints: {
    enabled: boolean;
    triggerChars?: number;
    summarizerOptions?: Omit<AxProgramForwardOptions<string>, 'functions'>;
  };
};

export type ActionLogBuildPolicy = {
  actionReplay?: 'full' | 'adaptive' | 'minimal';
  recentFullActions?: number;
  pruneUsedDocs?: boolean;
  restoreNotice?: string;
  stateSummary?: string;
  checkpointSummary?: string;
  checkpointTurns?: readonly number[];
};

export type CheckpointSummaryState = {
  fingerprint: string;
  summary: string;
  turns: number[];
};

export type ActionLogReplayPlan = {
  promptFacingEntries: ActionLogEntry[];
  checkpointEntries: ActionLogEntry[];
  historyText: string;
  historyChars: number;
};

export type RuntimeStateSnapshotEntry = {
  name: string;
  type: string;
  ctor?: string;
  size?: string;
  preview?: string;
  restorable?: boolean;
};

export type RuntimeStateSnapshot = {
  version: 1;
  entries: RuntimeStateSnapshotEntry[];
};

export type RuntimeStateVariableProvenance = {
  createdTurn: number;
  lastReadTurn?: number;
  stepKind?: ActionLogStepKind;
  source?: string;
  code?: string;
};

// ---------------------------------------------------------------------------
// Heuristic helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extracts a rough error signature from output text.
 * Uses the first `XxxError: message` line for comparison.
 */
export function extractErrorSignature(output: string): string {
  const match = output.match(/^(\w+Error:\s*.{0,60})/m);
  return match?.[1] ?? output.slice(0, 80);
}

/**
 * Extracts variable names declared via `var`, `let`, or `const`.
 */
export function extractDeclaredVariables(code: string): string[] {
  return extractTopLevelDeclaredNames(code);
}

export function extractDurableWriteTargets(code: string): string[] {
  return extractTopLevelDurableWriteTargets(code);
}

const JS_KEYWORDS = new Set([
  'var',
  'let',
  'const',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'delete',
  'typeof',
  'void',
  'in',
  'of',
  'instanceof',
  'this',
  'class',
  'extends',
  'super',
  'import',
  'export',
  'default',
  'from',
  'as',
  'async',
  'await',
  'yield',
  'true',
  'false',
  'null',
  'undefined',
  'console',
  'log',
]);

/**
 * Extracts all identifiers referenced in code (approximate).
 * Filters out JavaScript keywords.
 */
export function extractReferencedIdentifiers(code: string): Set<string> {
  const sanitized = stripJsStringsAndComments(code);
  const identRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null = identRegex.exec(sanitized);
  while (match !== null) {
    if (match[1] && !JS_KEYWORDS.has(match[1])) {
      ids.add(match[1]);
    }
    match = identRegex.exec(sanitized);
  }
  return ids;
}

/**
 * Extracts identifiers that are read from earlier runtime state.
 * Current-turn top-level declarations are excluded so replacements like
 * `const data = ...` do not look like reads of a prior `data`.
 */
export function extractReadIdentifiers(code: string): Set<string> {
  const reads = extractReferencedIdentifiers(code);
  for (const declared of extractDeclaredVariables(code)) {
    reads.delete(declared);
  }
  return reads;
}

const HINDSIGHT_TAGS = new Set<ActionLogTag>([
  'dead-end',
  'foundational',
  'pivot',
  'superseded',
]);

function truncateInline(text: string, maxChars = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function hasCompletionSignal(code: string): boolean {
  return /\b(final|ask_clarification)\s*\(/.test(code);
}

function inferStepKind(entry: Readonly<ActionLogEntry>): ActionLogStepKind {
  if (entry.tags.includes('error')) return 'error';
  if (hasCompletionSignal(entry.code)) return 'finalize';
  if (
    /\b(llmQuery|listModuleFunctions|getFunctionDefinitions)\s*\(/.test(
      entry.code
    )
  ) {
    return 'query';
  }
  if ((entry.producedVars?.length ?? 0) > 0) return 'transform';
  return 'explore';
}

function buildStateDelta(entry: Readonly<ActionLogEntry>): string {
  const producedVars = entry.producedVars ?? [];
  if (producedVars.length > 0) {
    return `Updated live runtime values: ${producedVars.join(', ')}`;
  }

  switch (entry.stepKind) {
    case 'query':
      return 'Gathered external or semantic evidence without creating durable runtime values';
    case 'finalize':
      return 'Prepared completion payload for the responder';
    case 'error':
      return 'Did not produce a durable runtime state update';
    default:
      return 'Inspected runtime state without creating durable runtime values';
  }
}

function buildEntrySummary(entry: Readonly<ActionLogEntry>): string {
  if (entry.tombstone) {
    return entry.tombstone;
  }

  const label =
    entry.stepKind === 'error'
      ? 'Error step'
      : entry.stepKind === 'query'
        ? 'Query step'
        : entry.stepKind === 'transform'
          ? 'Transform step'
          : entry.stepKind === 'finalize'
            ? 'Finalize step'
            : 'Explore step';
  const observation = truncateInline(entry.output || '(no output)');
  const actorFields = truncateInline(
    entry.actorFieldsOutput.replace(/^Actor fields:\s*/i, ''),
    80
  );
  const stateDelta = entry.stateDelta ?? 'No durable runtime state update';
  const actorFieldSuffix = actorFields ? ` Actor fields: ${actorFields}.` : '';

  return `[SUMMARY]: ${label}. ${stateDelta}. Result: ${observation}.${actorFieldSuffix}`;
}

function clearHindsightEvaluation(entry: ActionLogEntry): void {
  entry.rank = undefined;
  entry.tags = entry.tags.filter((tag) => !HINDSIGHT_TAGS.has(tag));
}

function ensureEntryMetadata(entry: ActionLogEntry): void {
  if (!entry.producedVars) {
    entry.producedVars = extractDurableWriteTargets(entry.code);
  }
  if (!entry.referencedVars) {
    entry.referencedVars = [...extractReferencedIdentifiers(entry.code)];
  }
  if (!entry.stepKind) {
    entry.stepKind = inferStepKind(entry);
  }
  if (!entry.stateDelta) {
    entry.stateDelta = buildStateDelta(entry);
  }
  if (!entry.summary) {
    entry.summary = buildEntrySummary(entry);
  }
}

function splitMarkdownSections(
  text: string,
  headerPattern: RegExp
): Array<{ key: string; text: string }> {
  const matches = [...text.matchAll(headerPattern)];
  if (matches.length === 0) {
    return [];
  }

  return matches
    .map((match, index) => {
      const key = match[1]?.trim();
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? text.length;
      if (!key) {
        return undefined;
      }

      return {
        key,
        text: text.slice(start, end).trim(),
      };
    })
    .filter((section): section is { key: string; text: string } =>
      Boolean(section)
    );
}

function extractDiscoveryModuleSections(
  entry: Readonly<ActionLogEntry>
): readonly DiscoveryModuleSection[] {
  if (!/\blistModuleFunctions\s*\(/.test(entry.code)) {
    return [];
  }

  return splitMarkdownSections(entry.output, /^### Module `([^`]+)`/gm).map(
    (section) => ({
      module: section.key,
      text: section.text,
    })
  );
}

function extractDiscoveryFunctionSections(
  entry: Readonly<ActionLogEntry>
): readonly DiscoveryFunctionSection[] {
  if (!/\bgetFunctionDefinitions\s*\(/.test(entry.code)) {
    return [];
  }

  return splitMarkdownSections(entry.output, /^### `([^`]+)`/gm).map(
    (section) => ({
      qualifiedName: section.key,
      text: section.text,
    })
  );
}

function extractDirectQualifiedCallableUsages(code: string): string[] {
  const sanitized = stripJsStringsAndComments(code);
  const usages = new Set<string>();
  const callPattern =
    /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  let match = callPattern.exec(sanitized);

  while (match) {
    const namespace = match[1];
    const name = match[2];
    if (namespace && name) {
      usages.add(`${namespace}.${name}`);
    }
    match = callPattern.exec(sanitized);
  }

  return [...usages];
}

function ensureDiscoveryMetadata(entry: ActionLogEntry): void {
  if (!entry._discoveryModuleSections) {
    entry._discoveryModuleSections = extractDiscoveryModuleSections(entry);
  }
  if (!entry._discoveryFunctionSections) {
    entry._discoveryFunctionSections = extractDiscoveryFunctionSections(entry);
  }
  if (!entry._directQualifiedCalls) {
    entry._directQualifiedCalls = extractDirectQualifiedCallableUsages(
      entry.code
    );
  }
}

function getPrimaryActionSource(entry: ActionLogEntry): string | undefined {
  ensureDiscoveryMetadata(entry);

  return entry._directQualifiedCalls?.find(Boolean);
}

export function buildRuntimeStateProvenance(
  entries: readonly ActionLogEntry[]
): Map<string, RuntimeStateVariableProvenance> {
  const provenance = new Map<string, RuntimeStateVariableProvenance>();

  for (const entry of entries) {
    const mutableEntry = entry as ActionLogEntry;
    ensureEntryMetadata(mutableEntry);
    const source = getPrimaryActionSource(mutableEntry);

    for (const name of mutableEntry.producedVars ?? []) {
      provenance.set(name, {
        createdTurn: mutableEntry.turn,
        stepKind: mutableEntry.stepKind,
        source,
        code: mutableEntry.code,
      });
    }

    const readRefs = extractReadIdentifiers(mutableEntry.code);
    for (const name of readRefs) {
      const current = provenance.get(name);
      if (!current) {
        continue;
      }

      current.lastReadTurn = Math.max(
        current.lastReadTurn ?? current.createdTurn,
        mutableEntry.turn
      );
    }
  }

  return provenance;
}

function buildFutureSuccessfulQualifiedCallSets(
  entries: readonly ActionLogEntry[]
): Array<Set<string>> {
  const futureCalls: Array<Set<string>> = Array.from(
    { length: entries.length },
    () => new Set<string>()
  );
  const seen = new Set<string>();

  for (let i = entries.length - 1; i >= 0; i--) {
    futureCalls[i] = new Set(seen);
    const entry = entries[i];
    if (!entry || entry.tags.includes('error')) {
      continue;
    }
    ensureDiscoveryMetadata(entry);
    for (const qualifiedName of entry._directQualifiedCalls ?? []) {
      seen.add(qualifiedName);
    }
  }

  return futureCalls;
}

function applyDiscoveryDocPruning(
  entry: Readonly<ActionLogEntry>,
  laterSuccessfulCalls: ReadonlySet<string>
): ActionLogEntry | undefined {
  const mutableEntry = entry as ActionLogEntry;
  ensureDiscoveryMetadata(mutableEntry);

  const functionSections = mutableEntry._discoveryFunctionSections ?? [];
  if (functionSections.length > 0) {
    const keptSections = functionSections.filter(
      (section) => !laterSuccessfulCalls.has(section.qualifiedName)
    );

    if (keptSections.length === functionSections.length) {
      return mutableEntry;
    }
    if (keptSections.length === 0) {
      return undefined;
    }

    return {
      ...mutableEntry,
      output: keptSections.map((section) => section.text).join('\n\n'),
      summary: undefined,
      _discoveryFunctionSections: keptSections,
    };
  }

  const moduleSections = mutableEntry._discoveryModuleSections ?? [];
  if (moduleSections.length > 0) {
    const usedModules = new Set(
      [...laterSuccessfulCalls].map(
        (qualifiedName) => qualifiedName.split('.')[0]!
      )
    );
    const keptSections = moduleSections.filter(
      (section) => !usedModules.has(section.module)
    );

    if (keptSections.length === moduleSections.length) {
      return mutableEntry;
    }
    if (keptSections.length === 0) {
      return undefined;
    }

    return {
      ...mutableEntry,
      output: keptSections.map((section) => section.text).join('\n\n'),
      summary: undefined,
      _discoveryModuleSections: keptSections,
    };
  }

  return mutableEntry;
}

export function getPromptFacingActionLogEntries(
  entries: readonly ActionLogEntry[],
  options?: Readonly<{
    pruneUsedDocs?: boolean;
  }>
): ActionLogEntry[] {
  if (!options?.pruneUsedDocs || entries.length === 0) {
    return [...entries];
  }

  const futureSuccessfulCalls = buildFutureSuccessfulQualifiedCallSets(entries);

  return entries.flatMap((entry, index) => {
    const promptFacingEntry = applyDiscoveryDocPruning(
      entry,
      futureSuccessfulCalls[index] ?? new Set<string>()
    );
    return promptFacingEntry ? [promptFacingEntry] : [];
  });
}

function buildFutureReferenceSets(
  entries: readonly ActionLogEntry[]
): Array<Set<string>> {
  const futureRefs: Array<Set<string>> = Array.from(
    { length: entries.length },
    () => new Set<string>()
  );
  const seen = new Set<string>();

  for (let i = entries.length - 1; i >= 0; i--) {
    futureRefs[i] = new Set(seen);
    for (const ref of entries[i]?.referencedVars ?? []) {
      seen.add(ref);
    }
  }

  return futureRefs;
}

function assignReplayModes(
  entries: readonly ActionLogEntry[],
  policy: Readonly<ActionLogBuildPolicy>
): void {
  const actionReplay = policy.actionReplay ?? 'full';
  const recentFullActions = Math.max(policy.recentFullActions ?? 1, 0);

  for (const entry of entries) {
    ensureEntryMetadata(entry);
  }

  const futureRefs = buildFutureReferenceSets(entries);
  const recentStart = Math.max(entries.length - recentFullActions, 0);

  entries.forEach((entry, index) => {
    if (entry.tombstone) {
      entry.replayMode = 'full';
      return;
    }

    if (actionReplay === 'full') {
      entry.replayMode = 'full';
      return;
    }

    const keepRecent = index >= recentStart;
    const unresolvedError = entry.tags.includes('error');
    const policyViolation = entry.output.startsWith('[POLICY]');
    const laterReferences = futureRefs[index] ?? new Set<string>();
    const producedVars = entry.producedVars ?? [];
    const referencedLater = producedVars.some((name) =>
      laterReferences.has(name)
    );

    if (keepRecent || unresolvedError || policyViolation) {
      entry.replayMode = 'full';
      return;
    }

    if (actionReplay === 'adaptive' && referencedLater) {
      entry.replayMode = 'full';
      return;
    }

    entry.replayMode = 'omit';
  });
}

// ---------------------------------------------------------------------------
// Hindsight Evaluation
// ---------------------------------------------------------------------------

/**
 * Heuristic-based importance scoring for an action log entry.
 * Evaluates entry `prev` given the following entry `curr`.
 *
 * | prev    | curr                        | Tag          | Rank |
 * |---------|-----------------------------|--------------|------|
 * | error   | success                     | dead-end     | 0    |
 * | error   | error (same signature)      | dead-end     | 0    |
 * | error   | error (different signature) | pivot        | 3    |
 * | success | success (references prev)   | foundational | 5    |
 * | success | success (no reference)      | superseded   | 1    |
 * | success | error                       | (keep as-is) | —    |
 */
export function evaluateHindsight(
  prev: ActionLogEntry,
  curr: ActionLogEntry
): void {
  ensureEntryMetadata(prev);
  ensureEntryMetadata(curr);
  clearHindsightEvaluation(prev);

  const prevIsError = prev.tags.includes('error');
  const currIsError = curr.tags.includes('error');

  if (prevIsError && !currIsError) {
    // Dead-end: previous errored, current succeeded
    prev.rank = 0;
    addTag(prev, 'dead-end');
    return;
  }

  if (prevIsError && currIsError) {
    // Compare error signatures to distinguish pivot from repeated dead-end
    const prevSig = extractErrorSignature(prev.output);
    const currSig = extractErrorSignature(curr.output);
    if (prevSig !== currSig) {
      prev.rank = 3;
      addTag(prev, 'pivot');
    } else {
      prev.rank = 0;
      addTag(prev, 'dead-end');
    }
    return;
  }

  if (!prevIsError && !currIsError) {
    // Both succeeded — check if curr clearly builds on prev.
    const prevVars = prev.producedVars ?? extractDeclaredVariables(prev.code);
    if (
      prevVars.length === 0 ||
      prev.stepKind === 'explore' ||
      prev.stepKind === 'query'
    ) {
      return;
    }

    const currRefs = extractReadIdentifiers(curr.code);
    const overlap = prevVars.filter((v) => currRefs.has(v));

    if (overlap.length > 0) {
      prev.rank = 5;
      addTag(prev, 'foundational');
      return;
    }

    if (prev.stepKind === 'transform') {
      prev.rank = 1;
      addTag(prev, 'superseded');
    }
    return;
  }

  // prevIsError = false, currIsError = true: unusual regression — keep prev as-is
}

function addTag(entry: ActionLogEntry, tag: ActionLogTag): void {
  if (!entry.tags.includes(tag)) {
    entry.tags.push(tag);
  }
}

function buildDeterministicResolvedErrorTombstone(
  errorEntry: Readonly<ActionLogEntry>,
  resolutionEntry: Readonly<ActionLogEntry>
): string {
  const informativeLine =
    errorEntry.output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => /\b\w+Error:/.test(line) && !line.startsWith('[')) ??
    errorEntry.output
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          Boolean(line) && !line.startsWith('[') && !line.startsWith('...')
      )
      .at(-1) ??
    extractErrorSignature(errorEntry.output);
  const signature = truncateInline(informativeLine, 96);
  return `[TOMBSTONE]: Resolved ${signature} in turn ${resolutionEntry.turn}.`;
}

function isDeterministicResolvedErrorTombstone(text: string): boolean {
  return text.startsWith('[TOMBSTONE]: Resolved ');
}

// ---------------------------------------------------------------------------
// Tombstone Generation
// ---------------------------------------------------------------------------

type InternalSummaryForwardOptions = Omit<
  AxProgramForwardOptions<any>,
  'functions'
>;

const TOMBSTONE_SUMMARIZER_DESCRIPTION = `You are an internal AxAgent tombstone summarizer.

Write the output field \`tombstone\` as exactly one concise line.
- Start with \`[TOMBSTONE]:\`
- Summarize the resolved error and the successful fix.
- Mention one failed approach to avoid when possible.
- Do not include code fences, bullet points, or extra prose.
- Keep it roughly 20-40 tokens.`;

const CHECKPOINT_SUMMARIZER_DESCRIPTION = `You are an internal AxAgent checkpoint summarizer.

Write the output field \`checkpointSummary\` as plain text with exactly these labels in this order:
Objective:
Durable state:
Evidence:
Conclusions:
Actor fields:
Next step:

Rules:
- Keep only information needed to continue the task.
- Preserve exact function names, module names, ids, field names, literals, and query formats when they matter.
- Keep enough evidence to avoid repeating invalid callable names, invalid query formats, or wrong assumptions.
- Do not restate raw code or quote large outputs.
- Use "none" when a section has nothing worth preserving.
- Be concise and factual, but prefer slightly more detail over losing task-critical specifics.`;

function sanitizeInternalSummaryOptions(
  options: Readonly<InternalSummaryForwardOptions> | undefined
): Omit<InternalSummaryForwardOptions, 'mem' | 'description' | 'maxSteps'> {
  const {
    mem: _mem,
    description: _description,
    maxSteps: _maxSteps,
    ...rest
  } = options ?? {};

  return rest;
}

function buildInternalSummaryProgramOptions(
  description: string,
  traceLabel: string,
  options: Readonly<InternalSummaryForwardOptions> | undefined
): InternalSummaryForwardOptions {
  const sanitized = sanitizeInternalSummaryOptions(options);

  return {
    ...sanitized,
    description,
    traceLabel: sanitized.traceLabel ?? traceLabel,
    maxSteps: 1,
  };
}

function buildInternalSummaryCallOptions(
  options: Readonly<InternalSummaryForwardOptions> | undefined
): InternalSummaryForwardOptions {
  return {
    ...sanitizeInternalSummaryOptions(options),
    maxSteps: 1,
  };
}

/**
 * Generates a tombstone summary for a resolved error entry.
 * Uses an internal single-step AxGen program and falls back on any failure.
 */
export async function generateTombstoneAsync(
  ai: AxAIService,
  summarizerOptions:
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined,
  requestForwardOptions: Readonly<InternalSummaryForwardOptions> | undefined,
  errorEntry: Readonly<ActionLogEntry>,
  resolutionEntry: Readonly<ActionLogEntry>
): Promise<string> {
  const summarizer = new AxGen<
    {
      errorCode: string;
      errorOutput: string;
      resolutionCode: string;
    },
    { tombstone: string }
  >(
    'errorCode:string, errorOutput:string, resolutionCode:string -> tombstone:string',
    {
      ...buildInternalSummaryProgramOptions(
        TOMBSTONE_SUMMARIZER_DESCRIPTION,
        'ax-agent-tombstone-summary',
        summarizerOptions
      ),
    }
  );

  try {
    const result = await summarizer.forward(
      ai,
      {
        errorCode: errorEntry.code.slice(0, 500),
        errorOutput: errorEntry.output.slice(0, 300),
        resolutionCode: resolutionEntry.code.slice(0, 500),
      },
      buildInternalSummaryCallOptions(requestForwardOptions)
    );
    const text =
      typeof result.tombstone === 'string'
        ? result.tombstone.trim()
        : String(result.tombstone).trim();
    return (
      text ||
      buildDeterministicResolvedErrorTombstone(errorEntry, resolutionEntry)
    );
  } catch {
    return buildDeterministicResolvedErrorTombstone(
      errorEntry,
      resolutionEntry
    );
  }
}

function serializeCheckpointEntries(
  entries: readonly ActionLogEntry[]
): string {
  return entries
    .map((entry) => {
      ensureEntryMetadata(entry);
      const actorFields = entry.actorFieldsOutput
        .replace(/^Actor fields:\s*/i, '')
        .trim();

      return [
        `Turn: ${entry.turn}`,
        `Step kind: ${entry.stepKind ?? 'explore'}`,
        `Referenced inputs: ${(entry.referencedVars ?? []).join(', ') || 'none'}`,
        `Durable values written: ${(entry.producedVars ?? []).join(', ') || 'none'}`,
        `State delta: ${entry.stateDelta ?? 'none'}`,
        `Observed result: ${truncateInline(entry.output || '(no output)', 360)}`,
        `Actor fields: ${actorFields || 'none'}`,
        `Code excerpt: ${truncateInline(entry.code || '(no code)', 360)}`,
      ].join('\n');
    })
    .join('\n\n');
}

function buildFallbackCheckpointSummary(
  entries: readonly ActionLogEntry[]
): string {
  const objectives = new Set<string>();
  const durableValues = new Set<string>();
  const evidence: string[] = [];
  const actorFields: string[] = [];
  let nextStep = 'Continue from the latest live runtime state.';

  for (const entry of entries) {
    ensureEntryMetadata(entry);
    objectives.add(entry.stepKind ?? 'explore');
    for (const value of entry.producedVars ?? []) {
      durableValues.add(value);
    }
    const observation = truncateInline(entry.output || '(no output)', 200);
    evidence.push(`Turn ${entry.turn}: ${observation}`);
    const trimmedActorFields = entry.actorFieldsOutput
      .replace(/^Actor fields:\s*/i, '')
      .trim();
    if (trimmedActorFields) {
      actorFields.push(`Turn ${entry.turn}: ${trimmedActorFields}`);
    }
    nextStep =
      entry.stepKind === 'finalize'
        ? 'Complete the responder handoff.'
        : 'Continue from the latest live runtime state.';
  }

  return [
    `Objective: ${[...objectives].join(', ') || 'none'}`,
    `Durable state: ${[...durableValues].join(', ') || 'none'}`,
    `Evidence: ${evidence.join(' | ') || 'none'}`,
    `Conclusions: Preserve the durable state and evidence above.`,
    `Actor fields: ${actorFields.join(' | ') || 'none'}`,
    `Next step: ${nextStep}`,
  ].join('\n');
}

export async function generateCheckpointSummaryAsync(
  ai: AxAIService,
  summarizerOptions:
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined,
  requestForwardOptions: Readonly<InternalSummaryForwardOptions> | undefined,
  entries: readonly ActionLogEntry[]
): Promise<string> {
  const summarizer = new AxGen<
    { turns: string },
    { checkpointSummary: string }
  >('turns:string -> checkpointSummary:string', {
    ...buildInternalSummaryProgramOptions(
      CHECKPOINT_SUMMARIZER_DESCRIPTION,
      'ax-agent-checkpoint-summary',
      summarizerOptions
    ),
  });

  try {
    const result = await summarizer.forward(
      ai,
      { turns: serializeCheckpointEntries(entries) },
      buildInternalSummaryCallOptions(requestForwardOptions)
    );
    const text =
      typeof result.checkpointSummary === 'string'
        ? result.checkpointSummary.trim()
        : String(result.checkpointSummary).trim();
    return text || buildFallbackCheckpointSummary(entries);
  } catch {
    return buildFallbackCheckpointSummary(entries);
  }
}

// ---------------------------------------------------------------------------
// manageContext — main orchestration
// ---------------------------------------------------------------------------

/**
 * Manages the action log after a new entry is pushed.
 *
 * Four phases run in order:
 * 1. Hindsight evaluation (tag + rank the previous entry)
 * 2. Tombstone generation (fire async for resolved errors)
 * 3. Error pruning (remove error entries, respecting tombstones)
 * 4. Rank-based pruning (remove low-rank entries)
 *
 * Mutates `entries` in-place.
 */
export async function manageContext(
  entries: ActionLogEntry[],
  newIndex: number,
  config: Readonly<ContextManagementEffectiveConfig>,
  ai?: AxAIService,
  requestForwardOptions?: Readonly<InternalSummaryForwardOptions>
): Promise<void> {
  const newEntry = entries[newIndex];
  if (!newEntry) return;

  ensureEntryMetadata(newEntry);

  const newEntryIsError = newEntry.tags.includes('error');

  // --- Phase 1: Hindsight evaluation of the PREVIOUS entry ---
  if (config.hindsightEvaluation && entries.length >= 2) {
    const prev = entries[entries.length - 2]!;
    evaluateHindsight(prev, newEntry);
  }

  // --- Phase 2: Tombstone generation for resolved errors ---
  if (config.errorPruning || config.tombstoning) {
    for (const entry of entries) {
      if (!entry.tags.includes('error')) {
        continue;
      }

      const idx = entries.indexOf(entry);
      const next = entries[idx + 1];
      if (!next || next.tags.includes('error')) {
        continue;
      }

      if (config.errorPruning && !entry.tombstone) {
        entry.tombstone = buildDeterministicResolvedErrorTombstone(entry, next);
      }

      const shouldGenerateModelTombstone =
        Boolean(config.tombstoning) &&
        Boolean(ai) &&
        !entry._tombstonePromise &&
        (!entry.tombstone ||
          isDeterministicResolvedErrorTombstone(entry.tombstone));
      if (!shouldGenerateModelTombstone || !ai) {
        continue;
      }

      const forwardOptions =
        typeof config.tombstoning === 'object' ? config.tombstoning : undefined;
      entry._tombstonePromise = generateTombstoneAsync(
        ai,
        forwardOptions,
        requestForwardOptions,
        entry,
        next
      );
      entry._tombstonePromise
        .then((ts) => {
          entry.tombstone = ts;
        })
        .catch(() => {
          // Tombstone failure is non-fatal.
        })
        .finally(() => {
          entry._tombstonePromise = undefined;
        });
    }
  }

  // --- Phase 3: Error pruning (respects tombstones) ---
  if (config.errorPruning && !newEntryIsError) {
    const pruned = entries.filter(
      (e) =>
        !e.tags.includes('error') || // not an error → keep
        e.tombstone != null || // has tombstone → keep (compact)
        e._tombstonePromise != null // pending tombstone → keep (will be compact)
    );
    entries.length = 0;
    entries.push(...pruned);
  }

  // --- Phase 4: Rank-based pruning ---
  if (config.hindsightEvaluation) {
    const latestTurn = entries[entries.length - 1]?.turn ?? newEntry.turn;
    const pruned = entries.filter(
      (e, i) =>
        i === entries.length - 1 || // always keep last entry
        e.rank === undefined || // unscored → keep
        (!e.tags.includes('error') &&
          latestTurn - e.turn < config.rankPruneGraceTurns) || // keep successful entries for a short grace window
        e.rank >= config.pruneRank || // above threshold → keep
        e.tombstone != null || // tombstoned → keep (already compact)
        e._tombstonePromise != null // pending tombstone → keep
    );
    entries.length = 0;
    entries.push(...pruned);
  }
}

// ---------------------------------------------------------------------------
// Action log serialization
// ---------------------------------------------------------------------------

/**
 * Serializes action log entries into a string for the actor prompt.
 *
 * Tombstoned entries render as compact one-liners.
 * Normal entries render with full code blocks.
 */
export function buildActionLog(entries: readonly ActionLogEntry[]): string {
  return buildActionLogWithPolicy(entries, {});
}

function renderActionReplayEntry(
  entry: Readonly<ActionLogEntry>,
  checkpointTurns: ReadonlySet<number>
): string {
  if (
    checkpointTurns.has(entry.turn) &&
    !entry.tags.includes('error') &&
    entry.replayMode !== 'full'
  ) {
    return '';
  }

  if (entry.tombstone) {
    return `Action ${entry.turn}:\n${entry.tombstone}`;
  }

  switch (entry.replayMode) {
    case 'omit':
      ensureEntryMetadata(entry as ActionLogEntry);
      return `Action ${entry.turn}:\n${entry.summary ?? buildEntrySummary(entry)}`;
    default:
      return `Action ${entry.turn}:\n\`\`\`javascript\n${entry.code}\n\`\`\`\nResult:\n${entry.output}${entry.actorFieldsOutput}`;
  }
}

export function buildActionLogReplayPlan(
  entries: readonly ActionLogEntry[],
  policy: Readonly<ActionLogBuildPolicy>
): ActionLogReplayPlan {
  const promptFacingEntries = getPromptFacingActionLogEntries(entries, {
    pruneUsedDocs: policy.pruneUsedDocs,
  });

  if (promptFacingEntries.length === 0) {
    return {
      promptFacingEntries,
      checkpointEntries: [],
      historyText: '',
      historyChars: 0,
    };
  }

  assignReplayModes(promptFacingEntries, policy);

  const checkpointEntries = promptFacingEntries.filter(
    (entry) => !entry.tags.includes('error') && entry.replayMode !== 'full'
  );
  const checkpointTurns = new Set(policy.checkpointTurns ?? []);
  const historyText = promptFacingEntries
    .map((entry) => renderActionReplayEntry(entry, checkpointTurns))
    .filter(Boolean)
    .join('\n\n');

  return {
    promptFacingEntries,
    checkpointEntries,
    historyText,
    historyChars: historyText.length,
  };
}

export function buildActionLogWithPolicy(
  entries: readonly ActionLogEntry[],
  policy: Readonly<ActionLogBuildPolicy>
): string {
  const replayPlan = buildActionLogReplayPlan(entries, policy);

  if (
    replayPlan.promptFacingEntries.length === 0 &&
    !policy.stateSummary &&
    !policy.checkpointSummary
  ) {
    return '';
  }

  const parts: string[] = [];
  if (policy.restoreNotice) {
    parts.push(policy.restoreNotice);
  }
  if (policy.stateSummary) {
    parts.push(`Live Runtime State:\n${policy.stateSummary}`);
  }
  if (replayPlan.historyText) {
    parts.push(replayPlan.historyText);
  }
  if (policy.checkpointSummary) {
    parts.push(`Checkpoint Summary:\n${policy.checkpointSummary}`);
  }

  return parts.join('\n\n');
}

export function buildActionEvidenceSummary(
  entries: readonly ActionLogEntry[],
  options?: Readonly<{
    stateSummary?: string;
    checkpointSummary?: string;
    checkpointTurns?: readonly number[];
    pruneUsedDocs?: boolean;
  }>
): string {
  const promptFacingEntries = getPromptFacingActionLogEntries(entries, {
    pruneUsedDocs: options?.pruneUsedDocs,
  });
  const checkpointTurns = new Set(options?.checkpointTurns ?? []);
  const summaries = promptFacingEntries
    .map((entry) => {
      if (checkpointTurns.has(entry.turn) && !entry.tags.includes('error')) {
        return '';
      }
      ensureEntryMetadata(entry);
      const detail =
        entry.tombstone ?? entry.summary ?? buildEntrySummary(entry);
      return `- Action ${entry.turn}: ${detail}`;
    })
    .filter(Boolean)
    .join('\n');

  const parts = ['Actor stopped without calling final(...). Evidence summary:'];
  if (options?.checkpointSummary) {
    parts.push(`Checkpoint summary:\n${options.checkpointSummary}`);
  }
  if (summaries) {
    parts.push(summaries);
  } else if (!options?.checkpointSummary) {
    parts.push('- No actions were taken.');
  }
  if (options?.stateSummary) {
    parts.push(`Current runtime state:\n${options.stateSummary}`);
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Runtime state inspection
// ---------------------------------------------------------------------------

/**
 * Builds JavaScript code that introspects `globalThis` in the worker session.
 * The code enumerates all user-defined variables, reporting their name, type,
 * size, and a truncated preview.
 */
export function buildInspectRuntimeCode(
  reservedNames: readonly string[],
  baselineNames: readonly string[] = []
): string {
  const skipList = [...reservedNames, ...baselineNames]
    .map((n) => `'${n}'`)
    .join(',');
  return `(() => {
  const skip = new Set([${skipList}]);
  const truncate = (text, maxChars) =>
    text.length <= maxChars ? text : text.slice(0, maxChars - 3) + '...';
  const previewAtom = (value) => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    const valueType = typeof value;
    if (valueType === 'string') return JSON.stringify(truncate(value, 40));
    if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
      return String(value);
    }
    if (valueType === 'symbol') return String(value);
    if (valueType === 'function') {
      return '[function ' + (value.name || 'anonymous') + ']';
    }
    if (Array.isArray(value)) return '[array(' + value.length + ')]';
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
    }
    if (value instanceof Error) {
      return (value.name || 'Error') + ': ' + (value.message || '');
    }
    if (value instanceof Map) return '[map(' + value.size + ')]';
    if (value instanceof Set) return '[set(' + value.size + ')]';
    const ctorName =
      value && value.constructor && typeof value.constructor.name === 'string'
        ? value.constructor.name
        : '';
    return ctorName && ctorName !== 'Object' ? '[' + ctorName + ']' : '[object]';
  };
  const previewValue = (value, type, ctor) => {
    if (type === 'array') {
      const items = value.slice(0, 3).map((item) => previewAtom(item));
      return '[' + items.join(', ') + (value.length > 3 ? ', ...' : '') + ']';
    }
    if (type === 'map') {
      const items = Array.from(value.entries())
        .slice(0, 3)
        .map(([key, item]) => previewAtom(key) + ' => ' + previewAtom(item));
      return 'Map(' + value.size + ') {' + items.join(', ') + (value.size > 3 ? ', ...' : '') + '}';
    }
    if (type === 'set') {
      const items = Array.from(value.values())
        .slice(0, 5)
        .map((item) => previewAtom(item));
      return 'Set(' + value.size + ') {' + items.join(', ') + (value.size > 5 ? ', ...' : '') + '}';
    }
    if (type === 'date') return previewAtom(value);
    if (type === 'error') return previewAtom(value);
    if (type === 'function') return previewAtom(value);
    if (type === 'object') {
      const keys = Object.keys(value);
      const shown = keys.slice(0, 4);
      const prefix = ctor && ctor !== 'Object' ? ctor + ' ' : '';
      return prefix + '{' + shown.join(', ') + (keys.length > shown.length ? ', ...' : '') + '}';
    }
    return previewAtom(value);
  };
  const describeSize = (value, type) => {
    if (type === 'string') return value.length + ' chars';
    if (type === 'array') return value.length + ' items';
    if (type === 'map' || type === 'set') return value.size + ' items';
    if (type === 'object') return Object.keys(value).length + ' keys';
    return undefined;
  };
  const describeType = (value) => {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) return { type: 'array', ctor: 'Array' };
    if (value instanceof Map) return { type: 'map', ctor: 'Map' };
    if (value instanceof Set) return { type: 'set', ctor: 'Set' };
    if (value instanceof Date) return { type: 'date', ctor: 'Date' };
    if (value instanceof Error) {
      return {
        type: 'error',
        ctor:
          typeof value.name === 'string' && value.name.trim()
            ? value.name
            : 'Error',
      };
    }
    const type = typeof value;
    if (type !== 'object') return { type };
    const ctor =
      value && value.constructor && typeof value.constructor.name === 'string'
        ? value.constructor.name
        : undefined;
    return { type: 'object', ctor };
  };
  const entries = Object.getOwnPropertyNames(globalThis)
    .filter((name) => !skip.has(name) && !name.startsWith('_'))
    .sort()
    .flatMap((name) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
        if (!descriptor) return [];
        if (
          'get' in descriptor &&
          typeof descriptor.get === 'function' &&
          !('value' in descriptor)
        ) {
          return [{ name, type: 'accessor', preview: '[getter omitted]' }];
        }
        const value = 'value' in descriptor ? descriptor.value : globalThis[name];
        const meta = describeType(value);
        const size = describeSize(value, meta.type);
        const preview = previewValue(value, meta.type, meta.ctor);
        return [
          {
            name,
            type: meta.type,
            ...(meta.ctor ? { ctor: meta.ctor } : {}),
            ...(size ? { size } : {}),
            ...(preview ? { preview: truncate(preview, 96) } : {}),
          },
        ];
      } catch {
        return [{ name, type: 'unknown', preview: '[unavailable]' }];
      }
    });
  return JSON.stringify({ version: 1, entries });
})()`;
}

export function buildInspectRuntimeBaselineCode(): string {
  return `(() => JSON.stringify(Object.getOwnPropertyNames(globalThis).sort()))()`;
}
