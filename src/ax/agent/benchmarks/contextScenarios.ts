/**
 * Deterministic, offline scenarios + harness for the context-compression spike.
 *
 * Drives AxAgent with a scripted `AxMockAIService` + stub `AxCodeRuntime` (the
 * pattern from `ctx-vs-task.test.ts`) so a sweep runs with zero API keys and is
 * fully deterministic. Shared by the regression test
 * (`context-compression.test.ts`) and the runnable demo
 * (`src/examples/context-compression-spike.ts`).
 *
 * Forward-compat seam: the comparison axis is `contextPolicy.preset`
 * ({@link AX_CONTEXT_PRESETS}). A future plan-aware "foresight" retention
 * strategy becomes a new preset value (or `contextPolicy` field); adding it to
 * that array is the only change needed to A/B it against today's four presets.
 * The aggregator (`AxContextMetricsCollector`) is policy-agnostic and measures
 * it unchanged. Do NOT add foresight logic here — this file only measures the
 * existing (hindsight) baseline.
 *
 * Internal benchmark helper — NOT exported from `src/ax/index.ts`.
 */
import { AxMockAIService } from '../../ai/mock/api.js';
import type { AxAIService } from '../../ai/types.js';
import type { AxAgentFunction } from '../index.js';
import { agent } from '../index.js';
import type { AxCodeRuntime, AxContextPolicyPreset } from '../rlm.js';
import {
  AxContextMetricsCollector,
  type AxContextMetricsSummary,
} from './contextMetrics.js';

/** The existing comparison axis: all shipped trajectory-compaction presets. */
export const AX_CONTEXT_PRESETS: readonly AxContextPolicyPreset[] = [
  'full',
  'checkpointed',
  'adaptive',
  'lean',
];

type AxScriptedTurn =
  | { kind: 'log'; chars: number }
  | { kind: 'error'; message: string }
  | { kind: 'final'; answer: string };

export type AxContextScenario = {
  name: string;
  description: string;
  signature: string;
  contextFields: string[];
  input: Record<string, unknown>;
  maxTurns: number;
  /** Ordered code payloads the mock returns for each EXECUTOR turn. */
  executorTurns: AxScriptedTurn[];
};

/**
 * Three scenarios exercising distinct trajectory-compaction paths:
 * - `short-clean`: no pressure (baseline; ratio ~0, no checkpoints).
 * - `long-padded`: many large logged blobs cross the `compact` budget mid-run.
 * - `error-recovery`: an errored turn later resolved (exercises tombstones).
 */
export const AX_CONTEXT_SCENARIOS: readonly AxContextScenario[] = [
  {
    name: 'short-clean',
    description: 'Two compact turns that never cross the budget.',
    signature: 'notes:string, query:string -> answer:string',
    contextFields: ['notes'],
    input: { notes: 'Short note about the task.', query: 'Summarize.' },
    maxTurns: 10,
    executorTurns: [{ kind: 'final', answer: 'short' }],
  },
  {
    name: 'long-padded',
    description: 'Several large logged blobs grow the action log past budget.',
    signature: 'notes:string, query:string -> answer:string',
    contextFields: ['notes'],
    input: {
      notes: 'Incident log with many noisy lines.',
      query: 'Work in multiple compact turns, then finalize.',
    },
    maxTurns: 12,
    executorTurns: [
      { kind: 'log', chars: 2600 },
      { kind: 'log', chars: 2600 },
      { kind: 'log', chars: 2600 },
      { kind: 'log', chars: 2600 },
      { kind: 'log', chars: 2600 },
      { kind: 'final', answer: 'analyzed' },
    ],
  },
  {
    name: 'error-recovery',
    description: 'An errored turn resolved by a later successful turn.',
    signature: 'notes:string, query:string -> answer:string',
    contextFields: ['notes'],
    input: { notes: 'Task notes.', query: 'Recover from the failure.' },
    maxTurns: 10,
    executorTurns: [
      { kind: 'error', message: 'SimulatedError: transient failure' },
      { kind: 'log', chars: 400 },
      { kind: 'final', answer: 'recovered' },
    ],
  },
];

const stubFn: AxAgentFunction = {
  name: 'lookup',
  description: 'Look something up',
  parameters: {
    type: 'object',
    properties: { q: { type: 'string', description: 'query' } },
    required: ['q'],
  },
  func: async () => 'result',
};

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

const getSystemPrompt = (
  chatPrompt: { role: string; content?: unknown }[]
): string => {
  const first = chatPrompt[0] as
    | { role: string; content?: unknown }
    | undefined;
  return typeof first?.content === 'string' ? first.content : '';
};

function renderExecutorTurn(turn: AxScriptedTurn): string {
  switch (turn.kind) {
    case 'log':
      return `Javascript Code: console.log(${JSON.stringify('x'.repeat(turn.chars))})`;
    case 'error':
      return `Javascript Code: throwError(${JSON.stringify(turn.message)})`;
    case 'final':
      return `Javascript Code: final("done", ${JSON.stringify({ answer: turn.answer })})`;
  }
}

/** Stub runtime that echoes logged blobs as output and routes final()/errors. */
const makeRuntime = (): AxCodeRuntime => ({
  // Scripted fake: opt out of the shared-session protocol.
  supportsSharedSessions: false,
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (code.includes('throwError(')) {
          const match = code.match(/throwError\((".*")\)/s);
          const message = match
            ? JSON.parse(match[1])
            : 'SimulatedError: failure';
          throw new Error(message);
        }
        if (code.includes('final(')) {
          const match = code.match(/final\("([^"]*)"(?:,\s*(\{[^}]*\}))?\)/);
          if (match && globals?.final) {
            const extra = match[2] ? JSON.parse(match[2]) : {};
            (globals.final as (...args: unknown[]) => void)(match[1], extra);
          }
          return 'submitted';
        }
        const logMatch = code.match(/console\.log\((".*")\)/s);
        if (logMatch) {
          try {
            return JSON.parse(logMatch[1]) as string;
          } catch {
            return logMatch[1];
          }
        }
        return 'executed';
      },
      patchGlobals: async () => {},
      close: () => {},
    };
  },
});

function buildScenarioMock(
  scenario: AxContextScenario
): AxMockAIService<unknown> {
  let executorTurnIndex = 0;
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const systemPrompt = getSystemPrompt(
        req.chatPrompt as { role: string; content?: unknown }[]
      );
      let content: string;
      if (systemPrompt.includes('You (`distiller`)')) {
        content = 'Javascript Code: final("distilled", {"evidence":"summary"})';
      } else if (systemPrompt.includes('You (`executor`)')) {
        const index = Math.min(
          executorTurnIndex++,
          scenario.executorTurns.length - 1
        );
        content = renderExecutorTurn(scenario.executorTurns[index]!);
      } else {
        content = 'Answer: done';
      }
      return {
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: makeModelUsage(),
      };
    },
  });
}

/** Run one scenario under one preset (budget 'compact') and return its metrics. */
export async function runOfflineScenario(
  scenario: AxContextScenario,
  preset: AxContextPolicyPreset
): Promise<AxContextMetricsSummary> {
  const collector = new AxContextMetricsCollector();
  const mockAI = buildScenarioMock(scenario);
  const offlineAgent = agent(scenario.signature, {
    contextFields: scenario.contextFields,
    functions: [stubFn],
    runtime: makeRuntime(),
    maxTurns: scenario.maxTurns,
    contextPolicy: { preset, budget: 'compact' },
    onContextEvent: collector.onEvent,
  });
  await offlineAgent.forward(
    mockAI as unknown as AxAIService,
    scenario.input as never
  );
  return collector.summarize(offlineAgent.getUsage());
}
