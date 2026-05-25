import {
  type AxChatRequest,
  AxJSRuntime,
  AxMockAIService,
  agent,
  f,
  fn,
} from '@ax-llm/ax';

const concreteRequest =
  'Send the password-reset email to ada@example.com and report the actual result or failure';

const forbiddenGenericRequest =
  'Perform the requested action and report the actual result or failure';

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

let distillerPromptChecked = false;
let executorPromptChecked = false;
let sentResetTo: string | undefined;

const supportTools = [
  fn('sendPasswordReset')
    .description('Send a password-reset email to a customer address.')
    .namespace('support')
    .arg('email', f.string('Customer email address'))
    .arg('reason', f.string('Why this reset is being sent'))
    .returns(f.json('Password-reset send result'))
    .handler(async ({ email, reason }) => {
      sentResetTo = email;
      return {
        ok: true,
        email,
        reason,
        messageId: 'reset-ada-001',
      };
    })
    .build(),
];

const mockAI = new AxMockAIService<string>({
  features: { functions: false, streaming: false },
  chatResponse: async (req) => {
    const systemPrompt = getPromptText(req.chatPrompt[0]);
    const userPrompt = getPromptText(req.chatPrompt[1]);

    if (systemPrompt.includes('You (`distiller`)')) {
      if (
        !systemPrompt.includes('The `request` string must be self-contained')
      ) {
        throw new Error('Distiller prompt is missing the self-contained rule.');
      }
      if (!systemPrompt.includes('final("<concrete action and target>", {})')) {
        throw new Error(
          'Distiller prompt is missing the concrete passthrough.'
        );
      }
      if (systemPrompt.includes(forbiddenGenericRequest)) {
        throw new Error(
          'Distiller prompt still contains the generic fallback.'
        );
      }

      distillerPromptChecked = true;

      return {
        results: [
          {
            index: 0,
            content: [
              'Javascript Code: await final(',
              `  ${JSON.stringify(concreteRequest)},`,
              '  {',
              '    resolvedReferences: [',
              '      {',
              '        phrase: "yes, do it",',
              '        resolvedTo: "send a password-reset email to ada@example.com",',
              '        evidenceTurnIds: ["turn-1", "turn-2"]',
              '      }',
              '    ],',
              '    evidenceSnippets: [',
              '      { turnId: "turn-1", role: "user", snippet: "Can you send Ada a password reset at ada@example.com?" },',
              '      { turnId: "turn-2", role: "assistant", snippet: "I can do that after you confirm." },',
              '      { turnId: "turn-3", role: "user", snippet: "yes, do it" }',
              '    ]',
              '  }',
              ')',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    if (systemPrompt.includes('You (`executor`)')) {
      if (!userPrompt.includes(concreteRequest)) {
        throw new Error(
          'Executor prompt did not receive the concrete request.'
        );
      }
      if (userPrompt.includes(forbiddenGenericRequest)) {
        throw new Error('Executor prompt received the generic fallback.');
      }
      if (!userPrompt.includes('resolvedReferences')) {
        throw new Error('Executor prompt did not receive distilled evidence.');
      }

      executorPromptChecked = true;

      return {
        results: [
          {
            index: 0,
            content: [
              'Javascript Code: const executorRequest = inputs.executorRequest;',
              `if (executorRequest !== ${JSON.stringify(concreteRequest)}) { throw new Error("executorRequest was not concrete"); }`,
              `if (executorRequest.includes(${JSON.stringify('requested action')})) { throw new Error("executorRequest is generic"); }`,
              'if (!inputs.distilledContext?.resolvedReferences?.length) { throw new Error("missing resolvedReferences evidence"); }',
              'const email = executorRequest.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0];',
              'if (!email) { throw new Error("could not extract target email"); }',
              'const sendResult = await support.sendPasswordReset({',
              '  email,',
              '  reason: "resolved from distilled follow-up context"',
              '});',
              'await final("Report the password-reset handoff result", {',
              '  executorRequest,',
              '  distilledContext: inputs.distilledContext,',
              '  sendResult',
              '});',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    if (!userPrompt.includes('Report the password-reset handoff result')) {
      throw new Error('Responder did not receive executor final task.');
    }
    if (!userPrompt.includes('reset-ada-001')) {
      throw new Error('Responder did not receive the tool result evidence.');
    }

    return {
      results: [
        {
          index: 0,
          content: 'Status: PASS',
          finishReason: 'stop',
        },
      ],
      modelUsage: makeUsage(),
    };
  },
});

const assistant = agent(
  'conversationHistory:json, userRequest:string -> status:string',
  {
    ai: mockAI,
    contextFields: ['conversationHistory'],
    runtime: new AxJSRuntime(),
    functions: supportTools,
    maxTurns: 4,
  }
);

const result = await assistant.forward(mockAI, {
  conversationHistory: [
    {
      id: 'turn-1',
      role: 'user',
      text: 'Can you send Ada a password reset at ada@example.com?',
    },
    {
      id: 'turn-2',
      role: 'assistant',
      text: 'I can do that after you confirm.',
    },
  ],
  userRequest: 'yes, do it',
});

if (!distillerPromptChecked) {
  throw new Error('Distiller prompt was not checked.');
}
if (!executorPromptChecked) {
  throw new Error('Executor prompt was not checked.');
}
if (sentResetTo !== 'ada@example.com') {
  throw new Error(
    `Expected reset email to ada@example.com, saw ${sentResetTo}`
  );
}
if (result.status !== 'PASS') {
  throw new Error(`Expected final status PASS, saw ${result.status}`);
}

console.log('Distiller prompt contract: PASS');
console.log('Executor request:', concreteRequest);
console.log('Tool target:', sentResetTo);
console.log('Final status:', result.status);
