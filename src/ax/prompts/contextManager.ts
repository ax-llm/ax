/**
 * Semantic Context Management for the AxAgent RLM loop.
 *
 * Manages the action log by evaluating step importance via hindsight heuristics,
 * generating compact tombstones for resolved errors, and pruning low-value entries
 * to maximize context window utility.
 */

import type { AxAIService, AxChatResponse } from '../ai/types.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';

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

export type ActionReplayMode = 'full' | 'summary' | 'omit';

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
  actionReplay: 'full' | 'adaptive' | 'minimal';
  recentFullActions: number;
  successSummarization:
    | boolean
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined;
  stateSummary?: { enabled?: boolean; maxEntries?: number };
};

export type ActionLogBuildPolicy = {
  actionReplay?: 'full' | 'adaptive' | 'minimal';
  recentFullActions?: number;
  stateSummary?: string;
  successSummarization?: boolean;
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
  const vars: string[] = [];
  const declRegex = /(?:^|[\n;])\s*(?:var|let|const)\s+(\w+)/g;
  let match: RegExpExecArray | null = declRegex.exec(code);
  while (match !== null) {
    if (match[1]) vars.push(match[1]);
    match = declRegex.exec(code);
  }
  return vars;
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
  const identRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null = identRegex.exec(code);
  while (match !== null) {
    if (match[1] && !JS_KEYWORDS.has(match[1])) {
      ids.add(match[1]);
    }
    match = identRegex.exec(code);
  }
  return ids;
}

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
    return `Created live runtime values: ${producedVars.join(', ')}`;
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

function ensureEntryMetadata(entry: ActionLogEntry): void {
  if (!entry.producedVars) {
    entry.producedVars = extractDeclaredVariables(entry.code);
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
  const successSummarization = policy.successSummarization ?? false;

  for (const entry of entries) {
    ensureEntryMetadata(entry);
  }

  const futureRefs = buildFutureReferenceSets(entries);
  const recentStart = Math.max(entries.length - recentFullActions, 0);

  entries.forEach((entry, index) => {
    if (entry.tombstone) {
      entry.replayMode = 'summary';
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

    const summary = entry.summary ?? buildEntrySummary(entry);
    const isTrivialSuccess =
      !entry.tags.includes('error') &&
      producedVars.length === 0 &&
      truncateInline(entry.output).length <= 20;

    if (!entry.tags.includes('error') && !successSummarization) {
      entry.replayMode = 'omit';
      return;
    }

    if (summary && !isTrivialSuccess) {
      entry.replayMode = 'summary';
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
    // Both succeeded — check if curr builds on prev or supersedes it
    const prevVars = extractDeclaredVariables(prev.code);
    const currRefs = extractReferencedIdentifiers(curr.code);
    const overlap = prevVars.filter((v) => currRefs.has(v));

    if (overlap.length > 0) {
      prev.rank = 5;
      addTag(prev, 'foundational');
    } else {
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

// ---------------------------------------------------------------------------
// Tombstone Generation
// ---------------------------------------------------------------------------

/**
 * Generates a tombstone summary for a resolved error entry.
 * Uses a lightweight `ai.chat()` call — non-blocking, fire-and-forget.
 *
 * Falls back to a generic message on any failure.
 */
export async function generateTombstoneAsync(
  ai: AxAIService,
  forwardOptions:
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined,
  errorEntry: Readonly<ActionLogEntry>,
  resolutionEntry: Readonly<ActionLogEntry>
): Promise<string> {
  const prompt = `Summarize this resolved error in exactly one line (20-40 tokens).

Error code:
\`\`\`javascript
${errorEntry.code.slice(0, 500)}
\`\`\`

Error output:
${errorEntry.output.slice(0, 300)}

Resolution code:
\`\`\`javascript
${resolutionEntry.code.slice(0, 500)}
\`\`\`

Format: [TOMBSTONE]: Resolved [Error Type] in [Module]. Fix: [1-line-summary]. Avoid: [failed-approach].`;

  try {
    const response = await ai.chat({
      chatPrompt: [
        {
          role: 'system' as const,
          content: 'You are a concise code summarizer.',
        },
        { role: 'user' as const, content: prompt },
      ],
      ...(forwardOptions?.model ? { model: forwardOptions.model } : {}),
      ...(forwardOptions?.modelConfig
        ? { modelConfig: forwardOptions.modelConfig }
        : {}),
    });

    // Handle non-streaming response
    if (!isStreamResponse(response) && response.results?.[0]?.content) {
      const content = response.results[0].content;
      return typeof content === 'string' ? content.trim() : String(content);
    }

    return TOMBSTONE_FALLBACK;
  } catch {
    return TOMBSTONE_FALLBACK;
  }
}

const TOMBSTONE_FALLBACK =
  '[TOMBSTONE]: Error was resolved in subsequent turn.';

function isStreamResponse(
  response: AxChatResponse | ReadableStream<AxChatResponse>
): response is ReadableStream<AxChatResponse> {
  return (
    typeof response === 'object' && response !== null && 'getReader' in response
  );
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
  ai?: AxAIService
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
  if (config.tombstoning && ai) {
    for (const entry of entries) {
      if (
        entry.tags.includes('error') &&
        !entry.tombstone &&
        !entry._tombstonePromise
      ) {
        // Check if this error is followed by a non-error entry
        const idx = entries.indexOf(entry);
        const next = entries[idx + 1];
        if (next && !next.tags.includes('error')) {
          const forwardOptions =
            typeof config.tombstoning === 'object'
              ? config.tombstoning
              : undefined;
          entry._tombstonePromise = generateTombstoneAsync(
            ai,
            forwardOptions,
            entry,
            next
          );
          entry._tombstonePromise
            .then((ts) => {
              entry.tombstone = ts;
            })
            .catch(() => {
              // Tombstone failure is non-fatal
            })
            .finally(() => {
              entry._tombstonePromise = undefined;
            });
        }
      }
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
    const pruned = entries.filter(
      (e, i) =>
        i === entries.length - 1 || // always keep last entry
        e.rank === undefined || // unscored → keep
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

export function buildActionLogWithPolicy(
  entries: readonly ActionLogEntry[],
  policy: Readonly<ActionLogBuildPolicy>
): string {
  if (entries.length === 0 && !policy.stateSummary) return '';

  assignReplayModes(entries, policy);

  const renderedEntries = entries
    .map((entry) => {
      if (entry.tombstone) {
        return `Action ${entry.turn}:\n${entry.tombstone}`;
      }

      switch (entry.replayMode) {
        case 'omit':
          return '';
        case 'summary':
          return `Action ${entry.turn}:\n${entry.summary ?? buildEntrySummary(entry)}`;
        default:
          return `Action ${entry.turn}:\n\`\`\`javascript\n${entry.code}\n\`\`\`\nResult:\n${entry.output}${entry.actorFieldsOutput}`;
      }
    })
    .filter(Boolean)
    .join('\n\n');

  if (!policy.stateSummary) {
    return renderedEntries;
  }

  const parts = [`Live Runtime State:\n${policy.stateSummary}`];
  if (renderedEntries) {
    parts.push(renderedEntries);
  }

  return parts.join('\n\n');
}

export function buildActionEvidenceSummary(
  entries: readonly ActionLogEntry[],
  options?: Readonly<{ stateSummary?: string }>
): string {
  const summaries = entries
    .map((entry) => {
      ensureEntryMetadata(entry);
      const detail =
        entry.tombstone ?? entry.summary ?? buildEntrySummary(entry);
      return `- Action ${entry.turn}: ${detail}`;
    })
    .join('\n');

  const parts = ['Actor stopped without calling final(...). Evidence summary:'];
  if (summaries) {
    parts.push(summaries);
  } else {
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
  reservedNames: readonly string[]
): string {
  const skipList = reservedNames.map((n) => `'${n}'`).join(',');
  return `(() => {
  const skip = new Set([${skipList}]);
  return Object.entries(globalThis)
    .filter(([k]) => !skip.has(k) && !k.startsWith('_'))
    .map(([k, v]) => {
      const type = Array.isArray(v) ? 'array' : typeof v;
      let size = '';
      if (typeof v === 'string') size = v.length + ' chars';
      else if (Array.isArray(v)) size = v.length + ' items';
      else if (v && typeof v === 'object') size = Object.keys(v).length + ' keys';
      let preview = '';
      try {
        preview = JSON.stringify(v);
        if (preview.length > 80) preview = preview.slice(0, 80) + '...';
      } catch { preview = String(v).slice(0, 80); }
      return k + ': ' + type + (size ? ' (' + size + ')' : '') + ' = ' + preview;
    }).join('\\n') || '(no user variables)';
})()`;
}
