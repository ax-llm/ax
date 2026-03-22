import {
  type AxChatRequest,
  type AxCodeRuntime,
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

const testMockAI = new AxMockAIService<string>({
  features: { functions: false, streaming: false },
  chatResponse: async (req) => {
    const systemPrompt = getPromptText(req.chatPrompt[0]);
    const userPrompt = getPromptText(req.chatPrompt[1]);

    if (systemPrompt.includes('Code Generation Agent')) {
      actorTurnCount += 1;
      if (actorTurnCount === 2) {
        const liveStateBlock = userPrompt
          .split('Live Runtime State:\n')[1]
          ?.split('\n\n')[0];

        console.log('Captured Live Runtime State block:\n');
        console.log(liveStateBlock ?? '(missing)');
        console.log('\n---');

        return {
          results: [
            {
              index: 0,
              content: 'Javascript Code: final("done")',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'mock-ai',
            model: 'mock-model',
            tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        };
      }

      return {
        results: [
          {
            index: 0,
            content: [
              'Javascript Code: const rows = [{ id: 1, name: "Widget", score: 0.98 }, { id: 2, name: "Gadget", score: 0.73 }];',
              'const bestRow = rows[0];',
              'const summary = { bestName: bestRow.name, count: rows.length };',
              'console.log(summary.count)',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'mock-ai',
          model: 'mock-model',
          tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      };
    }

    return {
      results: [
        {
          index: 0,
          content: 'Answer: done',
          finishReason: 'stop',
        },
      ],
      modelUsage: {
        ai: 'mock-ai',
        model: 'mock-model',
        tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    };
  },
});

let hasRuntimeState = false;
let actorTurnCount = 0;

const runtime: AxCodeRuntime = {
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (
          code.includes(
            'JSON.stringify(Object.getOwnPropertyNames(globalThis).sort())'
          )
        ) {
          return JSON.stringify(['setImmediate', 'clearImmediate']);
        }

        if (
          code.includes('Object.getOwnPropertyDescriptor(globalThis, name)')
        ) {
          return JSON.stringify({
            version: 1,
            entries: hasRuntimeState
              ? [
                  {
                    name: 'rows',
                    type: 'array',
                    size: '2 items',
                    preview: '[{"id":1,"name":"Widget","score":0.98}, ...]',
                  },
                  {
                    name: 'bestRow',
                    type: 'object',
                    ctor: 'Object',
                    size: '3 keys',
                    preview: '{id, name, score}',
                  },
                  {
                    name: 'summary',
                    type: 'object',
                    ctor: 'Object',
                    size: '2 keys',
                    preview: '{bestName, count}',
                  },
                ]
              : [],
          });
        }

        if (globals?.final && code.includes('final(')) {
          (globals.final as (...args: unknown[]) => void)('done');
          return 'done';
        }

        if (!hasRuntimeState) {
          console.log('First actor code:\n');
          console.log(code);
          console.log('\n---');
        }

        if (
          code.includes('const rows = [') &&
          code.includes('const bestRow = rows[0]') &&
          code.includes('const summary =')
        ) {
          hasRuntimeState = true;
          return '2';
        }

        return 'ok';
      },
      patchGlobals: async () => {},
      close: () => {},
    };
  },
};

const runtimeStateAgent = agent('question:string -> answer:string', {
  ai: testMockAI,
  contextFields: ['question'] as const,
  runtime,
  maxTurns: 2,
  contextPolicy: {
    preset: 'checkpointed',
    budget: 'balanced',
  },
});

const result = await runtimeStateAgent.forward(testMockAI, {
  question: 'Show me the live runtime state after one working turn.',
});

console.log('Final answer:', result.answer);
