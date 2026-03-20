import {
  type AxChatRequest,
  AxAgentClarificationError,
  AxJSRuntime,
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

let actorTurnCount = 0;

const mockAI = new AxMockAIService<string>({
  features: { functions: false, streaming: false },
  chatResponse: async (req) => {
    const systemPrompt = getPromptText(req.chatPrompt[0]);
    const userPrompt = getPromptText(req.chatPrompt[1]);

    if (systemPrompt.includes('Code Generation Agent')) {
      actorTurnCount += 1;

      if (actorTurnCount === 1) {
        return {
          results: [
            {
              index: 0,
              content: [
                'Javascript Code: const tripPlan = { city: "Lisbon" };',
                `globalThis.tripDraft = \`Trip to \${tripPlan.city}\`;`,
                'askClarification({ question: "Which dates should I use?", type: "date" })',
              ].join('\n'),
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
            content: `Javascript Code: final(\`\${tripDraft} on \${inputs.travelDates}\`)`,
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    const reply =
      userPrompt.includes('June 1-5') && userPrompt.includes('Trip to Lisbon')
        ? 'Trip to Lisbon on June 1-5'
        : 'resume complete';

    return {
      results: [
        {
          index: 0,
          content: `Reply: ${reply}`,
          finishReason: 'stop',
        },
      ],
      modelUsage: makeUsage(),
    };
  },
});

const buildResumeAgent = () =>
  agent('tripRequest:string, travelDates?:string -> reply:string', {
    ai: mockAI,
    contextFields: [],
    runtime: new AxJSRuntime(),
    contextPolicy: {
      preset: 'adaptive',
      state: {
        summary: true,
        inspect: true,
        maxEntries: 6,
      },
      checkpoints: {
        enabled: false,
      },
    },
  });

const resumeAgent = buildResumeAgent();

console.log('Initial saved state:', resumeAgent.getState() ?? '(none)');

let savedState = resumeAgent.getState();

try {
  await resumeAgent.forward(mockAI, {
    tripRequest: 'Plan a Lisbon trip.',
  });
} catch (error) {
  if (!(error instanceof AxAgentClarificationError)) {
    throw error;
  }

  console.log('Clarification needed:', error.question);
  console.log(
    'Clarification payload:',
    JSON.stringify(error.clarification, null, 2)
  );

  savedState = error.getState();

  console.log(
    'Saved runtime bindings:',
    Object.keys(savedState?.runtimeBindings ?? {}).filter((key) =>
      key.startsWith('trip')
    )
  );
  console.log('Saved action count:', savedState?.actionLogEntries.length ?? 0);
  console.log(
    'tripDraft provenance:',
    JSON.stringify(savedState?.provenance.tripDraft ?? null, null, 2)
  );
}

if (!savedState) {
  throw new Error('Expected a saved AxAgent state after clarification.');
}

const resumedAgent = buildResumeAgent();
resumedAgent.setState(savedState);

const resumed = await resumedAgent.forward(mockAI, {
  tripRequest: 'Plan a Lisbon trip.',
  travelDates: 'June 1-5',
});

console.log('Resumed reply:', resumed.reply);
