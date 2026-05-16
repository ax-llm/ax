import {
  type AxAgentContextEvent,
  type AxAgentState,
  type AxChatRequest,
  type AxCodeRuntime,
  type AxCodeSessionSnapshot,
  AxMockAIService,
  agent,
} from '@ax-llm/ax';

const getPromptText = (
  message: AxChatRequest<unknown>['chatPrompt'][number] | undefined
): string => {
  if (!message || !('content' in message)) {
    return '';
  }

  const { content } = message;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (part): part is Extract<typeof part, { type: 'text' }> =>
        part.type === 'text'
    )
    .map((part) => part.text)
    .join('\n');
};

const makeUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

const findContextPressureLine = (prompt: string): string =>
  prompt.split('\n').find((line) => line.startsWith('Context Pressure:')) ??
  '(missing)';

const createIncidentRuntime = (): AxCodeRuntime => ({
  getUsageInstructions: () =>
    'This example runtime returns deterministic outputs for context-management smoke tests.',
  createSession(globals) {
    const bindings: Record<string, unknown> = {};

    const snapshot = (): AxCodeSessionSnapshot => ({
      version: 1,
      entries: Object.entries(bindings).map(([name, value]) => ({
        name,
        type: Array.isArray(value) ? 'array' : typeof value,
        ctor: Array.isArray(value)
          ? 'Array'
          : value && typeof value === 'object'
            ? 'Object'
            : undefined,
        size:
          typeof value === 'string'
            ? `${value.length} chars`
            : Array.isArray(value)
              ? `${value.length} items`
              : value && typeof value === 'object'
                ? `${Object.keys(value as Record<string, unknown>).length} keys`
                : undefined,
        preview:
          typeof value === 'string'
            ? value.slice(0, 80)
            : JSON.stringify(value).slice(0, 80),
      })),
      bindings,
    });

    return {
      execute: async (code: string) => {
        if (globals?.final && code.includes('final(')) {
          const finalArgs = code.includes('investigate checkout incident')
            ? [
                'investigate checkout incident',
                {
                  selectedFacts: [
                    'cache miss rate doubled for enterprise tenants',
                    'rollback recovered checkout latency',
                  ],
                  exactFormat: 'Root cause / Impact / Next step',
                },
              ]
            : [
                'write the final incident response',
                {
                  finalAnswer:
                    bindings.finalAnswer ??
                    'Root cause: unknown. Impact: unknown. Next step: investigate.',
                },
              ];
          (globals.final as (...args: unknown[]) => void)(...finalArgs);
          return 'final accepted';
        }

        if (code.includes('triggerError')) {
          throw new Error('Execution timed out while reading verbose trace');
        }

        if (code.includes('recoveredSignal')) {
          bindings.recoveredSignal = 'rollback restored latency to 820ms';
          return 'rollback restored latency to 820ms';
        }

        if (code.includes('rootCause')) {
          bindings.rootCause =
            'tenant-scoped pricing_rules_v2 cache key regression';
          return String(bindings.rootCause);
        }

        if (code.includes('impactNote')) {
          bindings.impactNote =
            'confirmed customer impact was delayed price calculation before order submit';
          return String(bindings.impactNote);
        }

        if (code.includes('finalAnswer')) {
          bindings.finalAnswer = [
            `Root cause: ${bindings.rootCause}`,
            `Impact: ${bindings.impactNote}`,
            `Next step: patch cache warming and keep pricing_rules_v2 disabled until verified`,
          ].join('\n');
          return String(bindings.finalAnswer);
        }

        return 'ok';
      },
      inspectGlobals: async () => JSON.stringify(snapshot()),
      snapshotGlobals: async () => snapshot(),
      patchGlobals: async (restored) => {
        Object.assign(bindings, restored);
      },
      close: () => {},
    };
  },
});

const formatEvent = (event: AxAgentContextEvent): string => {
  if (event.kind === 'budget_check') {
    return [
      `${event.stage} turn ${event.turn}`,
      event.kind,
      `pressure=${event.pressure}`,
      `mutable=${event.mutablePromptChars}`,
      `effective=${event.effectiveBudgetChars}`,
      `checkpoint=${String(event.checkpointActive)}`,
    ].join(' | ');
  }

  if (
    event.kind === 'checkpoint_created' ||
    event.kind === 'checkpoint_cleared'
  ) {
    return [
      `${event.stage} turn ${event.turn}`,
      event.kind,
      `reason=${event.reason}`,
      `turns=${event.coveredTurns.join(',') || 'none'}`,
      event.summaryChars ? `summaryChars=${event.summaryChars}` : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' | ');
  }

  if (event.kind === 'tombstone_created') {
    return [
      `${event.stage} turn ${event.turn}`,
      event.kind,
      `resolvedBy=${event.resolvedByTurn}`,
      `source=${event.source}`,
      `summaryChars=${event.summaryChars}`,
    ].join(' | ');
  }

  return `${event.stage} turn ${event.turn} | ${event.kind}`;
};

const mainEvents: AxAgentContextEvent[] = [];
const contextPressureLines: string[] = [];
let executorTurnCount = 0;

const mockAI = new AxMockAIService<string>({
  features: { functions: false, streaming: false },
  chatResponse: async (req) => {
    const systemPrompt = getPromptText(req.chatPrompt[0]);
    const userPrompt = getPromptText(req.chatPrompt[1]);

    if (systemPrompt.includes('internal AxAgent trajectory summarizer')) {
      return {
        results: [
          {
            index: 0,
            content: [
              'Checkpoint Summary: Objective: produce a customer-safe incident response',
              'Current state and artifacts: rootCause, impactNote, recoveredSignal',
              'Exact callables and formats: final(answer:string, evidence?:object); Root cause / Impact / Next step',
              'Evidence: pricing_rules_v2 cache miss spike; rollback restored latency',
              'User constraints and preferences: keep the final answer concise and evidence-backed',
              'Failures to avoid: do not reread the verbose trace after it timed out',
              'Next step: finalize from the compact state and preserved runtime bindings',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    if (systemPrompt.includes('You (`distiller`)')) {
      contextPressureLines.push(
        `distiller: ${findContextPressureLine(userPrompt)}`
      );
      return {
        results: [
          {
            index: 0,
            content:
              'Javascript Code: final("investigate checkout incident", { format: "Root cause / Impact / Next step" })',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    if (systemPrompt.includes('You (`executor`)')) {
      executorTurnCount += 1;
      contextPressureLines.push(
        `executor turn ${executorTurnCount}: ${findContextPressureLine(userPrompt)}`
      );

      const codeByTurn: Record<number, string> = {
        1: 'Javascript Code: triggerError()',
        2: 'Javascript Code: const recoveredSignal = "rollback restored latency to 820ms"; console.log(recoveredSignal)',
        3: 'Javascript Code: const rootCause = "tenant-scoped pricing_rules_v2 cache key regression"; console.log(rootCause)',
        4: 'Javascript Code: const impactNote = "confirmed customer impact was delayed price calculation before order submit"; console.log(impactNote)',
        5: 'Javascript Code: const finalAnswer = [rootCause, impactNote, recoveredSignal].join("\\n"); console.log(finalAnswer)',
        6: 'Javascript Code: final(finalAnswer)',
      };

      return {
        results: [
          {
            index: 0,
            content:
              codeByTurn[executorTurnCount] ??
              'Javascript Code: final(finalAnswer)',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    return {
      results: [
        {
          index: 0,
          content:
            'Answer: Root cause: pricing_rules_v2 tenant cache key regression. Impact: delayed price calculation before submit. Next step: keep the flag off while patching cache warming.',
          finishReason: 'stop',
        },
      ],
      modelUsage: makeUsage(),
    };
  },
});

const incidentNotes = `
[09:00] Alert: Checkout latency exceeded 2.5s in us-west.
[09:02] Metrics: p95 latency rose from 640ms to 2.8s after deploy web-2026.03.01.1.
[09:03] Metrics: CPU on checkout-api stayed flat, but cache miss rate doubled from 14% to 31%.
[09:05] Logs: pricing_rules cache lookup miss for tenant enterprise-17 repeated 1,842 times in 5 minutes.
[09:08] Deploy note: pricing_rules_v2 hydration enabled for enterprise tenants only.
[09:18] Rollback: feature flag pricing_rules_v2 disabled for enterprise tenants.
[09:20] Metrics: cache miss rate fell to 16% and latency recovered to 820ms within 4 minutes.
[09:24] Follow-up: no evidence of payment failures; impact was delayed price calculation before order submit.
`.trim();

const contextAgent = agent(
  'incidentNotes:string, query:string -> answer:string "Analyze an incident with pressure-aware RLM context management"',
  {
    ai: mockAI,
    contextFields: ['incidentNotes'],
    runtime: createIncidentRuntime(),
    maxTurns: 6,
    contextPolicy: {
      preset: 'adaptive',
      budget: 'compact',
    },
    onContextEvent: (event) => {
      mainEvents.push(event);
    },
  }
);

const result = await contextAgent.forward(mockAI, {
  incidentNotes,
  query: [
    'Summarize the likely root cause, customer impact, and next step.',
    'Use the exact format: Root cause / Impact / Next step.',
    'Prefer concise evidence and do not repeat the raw incident log.',
    'padding '.repeat(13_000),
  ].join('\n'),
});

console.log('Final answer:');
console.log(result.answer);
console.log('\nContext pressure hints seen by actor:');
for (const line of contextPressureLines) {
  console.log(`- ${line}`);
}

console.log('\nContext events:');
for (const event of mainEvents) {
  console.log(`- ${formatEvent(event)}`);
}

const clearEvents: AxAgentContextEvent[] = [];
const quickMockAI = new AxMockAIService<string>({
  features: { functions: false, streaming: false },
  chatResponse: async (req) => {
    const systemPrompt = getPromptText(req.chatPrompt[0]);
    if (
      systemPrompt.includes('You (`distiller`)') ||
      systemPrompt.includes('You (`executor`)')
    ) {
      return {
        results: [
          {
            index: 0,
            content: 'Javascript Code: final("clear stale checkpoint", {})',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    return {
      results: [{ index: 0, content: 'Answer: cleared', finishReason: 'stop' }],
      modelUsage: makeUsage(),
    };
  },
});

const staleCheckpointAgent = agent('query:string -> answer:string', {
  ai: quickMockAI,
  contextFields: [],
  runtime: createIncidentRuntime(),
  contextPolicy: { preset: 'full' },
  onContextEvent: (event) => {
    clearEvents.push(event);
  },
});

const staleState: AxAgentState = {
  version: 1,
  runtimeBindings: {},
  runtimeEntries: [],
  actionLogEntries: [
    {
      turn: 1,
      code: 'console.log("old checkpointed work")',
      output: 'old checkpointed work',
      tags: [],
    },
  ],
  checkpointState: {
    fingerprint: 'stale',
    turns: [1],
    summary: 'stale summary',
  },
  provenance: {},
};

staleCheckpointAgent.setState(staleState);
await staleCheckpointAgent.forward(quickMockAI, {
  query: 'clear the stale checkpoint under full context policy',
});

console.log('\nCheckpoint clear events:');
for (const event of clearEvents) {
  console.log(`- ${formatEvent(event)}`);
}
