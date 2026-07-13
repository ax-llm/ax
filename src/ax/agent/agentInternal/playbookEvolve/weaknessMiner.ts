/**
 * LLM weakness miner for `agent.playbook().evolve()` — one call per failure cluster.
 *
 * Unlike the playbook engine's reflector (which sees only a serialized
 * answer), the miner sees the failing runs' action-log excerpts, function
 * calls, and tool errors, so its root causes are grounded in what the agent
 * actually did. A deterministic verifier then drops any evidence quote that
 * is not a real substring of the provided excerpts and discards weaknesses
 * with no surviving quote — plausible-but-fabricated weaknesses do not reach
 * the proposal stage.
 */

import type { AxAIService } from '../../../ai/types.js';
import { AxGen } from '../../../dsp/generate.js';
import { f } from '../../../dsp/sig.js';
import type { AxAgentFailureCluster } from './failureClusters.js';
import type { AxAgentPlaybookWeakness } from './playbookEvolveTypes.js';

const EXCERPT_CHARS_PER_RECORD = 2000;
const MAX_RECORDS_PER_CLUSTER = 4;
const TASK_SUMMARY_CHARS = 240;

const MINER_DESCRIPTION =
  'You are a failure analyst for an LLM agent harness. You receive one ' +
  'cluster of failed agent runs sharing an error signature, with excerpts ' +
  'of what the agent actually did. Identify the single recurring weakness, ' +
  'its root cause, and one narrow, durable avoidance rule the agent should ' +
  'recall while acting. Ground every claim: evidenceQuotes must be verbatim ' +
  'substrings copied from the excerpts. Keep proposedGuidance concise, ' +
  'imperative, and general to the failure mode (not one task). Use ' +
  'configRecommendations only for setup problems no prompt text can fix ' +
  '(missing tools, timeouts, model choice).';

const minerSignature = f()
  .input('clusterSignature', f.string('Shared error signature of the cluster.'))
  .input('taskSummaries', f.string('One line per failing task.'))
  .input(
    'actionLogExcerpts',
    f.string('Excerpts of the failing runs, centered on the failure.')
  )
  .input(
    'functionCallSummary',
    f.string('Digest of runtime/tool calls in the failing runs.').optional()
  )
  .input('toolErrors', f.string('Tool errors observed.').optional())
  .input(
    'currentPlaybook',
    f.string('The failure-avoidance playbook currently applied.').optional()
  )
  .output(
    'weaknessDescription',
    f.string('The recurring weakness, one sentence.')
  )
  .output('rootCause', f.string('Why the runs fail, mechanically.'))
  .output(
    'proposedGuidance',
    f.string('The avoidance rule to add to the playbook — concise, imperative.')
  )
  .output(
    'evidenceQuotes',
    f
      .string(
        'Verbatim substrings from actionLogExcerpts proving the weakness.'
      )
      .array()
  )
  .output(
    'configRecommendations',
    f
      .string('Setup/config suggestions no prompt text can fix.')
      .array()
      .optional()
  )
  .build();

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Deterministic excerpt: a window of the action log centered on the first
 * occurrence of the cluster signature (tail of the log when absent — errors
 * cluster near the end).
 */
export function buildFailureExcerpt(
  actionLog: string,
  signature: string,
  maxChars = EXCERPT_CHARS_PER_RECORD
): string {
  if (actionLog.length <= maxChars) {
    return actionLog;
  }
  const hit = actionLog.indexOf(signature.slice(0, 40));
  if (hit < 0) {
    return actionLog.slice(-maxChars);
  }
  const start = Math.max(0, hit - Math.floor(maxChars / 2));
  return actionLog.slice(start, start + maxChars);
}

/**
 * Coerce a model-produced array field to an array. The structured-JSON
 * extraction path passes a scalar through as-is, so an array-typed output
 * (evidenceQuotes / configRecommendations) can arrive as a single value —
 * wrap it (like the ACE reflector's bulletTags guard) rather than dropping
 * it. Exported for testing.
 */
export function coerceToArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value != null ? [value] : [];
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Keep only quotes that appear verbatim (whitespace-insensitively) in the
 * excerpts. Exported for testing.
 */
export function verifyEvidenceQuotes(
  quotes: readonly unknown[],
  excerpts: string
): string[] {
  const haystack = collapse(excerpts);
  return quotes
    .map((quote) => String(quote))
    .filter((quote) => {
      const needle = collapse(quote);
      return needle.length > 0 && haystack.includes(needle);
    });
}

export async function mineWeakness(args: {
  ai: Readonly<AxAIService>;
  cluster: AxAgentFailureCluster;
  currentPlaybook?: string;
  index: number;
}): Promise<AxAgentPlaybookWeakness | undefined> {
  const records = args.cluster.records.slice(0, MAX_RECORDS_PER_CLUSTER);

  const taskSummaries = records
    .map((record, i) => {
      const label = record.task.id ?? `#${i + 1}`;
      const input = truncate(
        JSON.stringify(record.task.input) ?? '',
        TASK_SUMMARY_CHARS
      );
      return `- ${label} (score ${record.score.toFixed(2)}): ${input}`;
    })
    .join('\n');

  const excerpts = records
    .map((record, i) => {
      const body = record.error
        ? `Run threw: ${record.error}`
        : buildFailureExcerpt(
            record.prediction?.actionLog ?? '',
            args.cluster.signature
          );
      return `--- run ${i + 1} ---\n${body}`;
    })
    .join('\n\n');

  const functionCallSummary = records
    .flatMap((record) => record.prediction?.functionCalls ?? [])
    .slice(0, 20)
    .map(
      (call) =>
        `${call.qualifiedName}(${truncate(JSON.stringify(call.arguments) ?? '', 120)})${call.error ? ` -> ERROR ${truncate(call.error, 120)}` : ''}`
    )
    .join('\n');

  const toolErrors = records
    .flatMap((record) => record.prediction?.toolErrors ?? [])
    .slice(0, 10)
    .join('\n');

  const miner = new AxGen<any, any>(minerSignature, {
    description: MINER_DESCRIPTION,
  });
  const mined = await miner.forward(args.ai as AxAIService, {
    clusterSignature: args.cluster.signature,
    taskSummaries,
    actionLogExcerpts: excerpts,
    functionCallSummary: functionCallSummary || undefined,
    toolErrors: toolErrors || undefined,
    currentPlaybook: args.currentPlaybook,
  });

  // A scalar evidenceQuotes must be wrapped, not dropped — see coerceToArray.
  const evidenceQuotes = verifyEvidenceQuotes(
    coerceToArray((mined as { evidenceQuotes?: unknown }).evidenceQuotes),
    excerpts
  );
  if (evidenceQuotes.length === 0) {
    return undefined;
  }

  return {
    id: `weakness-${args.index + 1}`,
    clusterSignature: args.cluster.signature,
    description: String(mined.weaknessDescription ?? ''),
    rootCause: String(mined.rootCause ?? ''),
    proposedGuidance: String(mined.proposedGuidance ?? ''),
    evidenceQuotes,
    taskIds: args.cluster.taskIds,
    configRecommendations: coerceToArray(mined.configRecommendations).map(
      String
    ),
  };
}
