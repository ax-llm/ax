/*
 * AxAgent context map:
 * - Stores a compact orientation cache for repeated questions over the same
 *   long context.
 * - Injects the map into the RLM distiller prompt.
 * - Updates once after successful runs while the map is still evolving.
 *
 * This example is deterministic and does not require an API key.
 *
 * Run: npm run tsx src/examples/rlm-context-map.ts
 */

import {
  AxAgentContextMap,
  type AxChatRequest,
  type AxChatResponse,
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

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const makeUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

const corpus = [
  'Incident corpus: checkout reliability, Q2.',
  'Records are newline-delimited JSON.',
  'Each record type is one of incident, service, mitigation, metric.',
  'incident records use incident_id, severity, tenant_tier, and service_id.',
  'service records use service_id, owner, and deploy_channel.',
  'mitigation records use incident_id, action, started_at, and recovered_at.',
  'metric records use service_id, name, p95_ms, and window.',
  'Enterprise checkout incidents repeatedly reference service_id svc-checkout-edge.',
].join('\n');

const runtime: AxCodeRuntime = {
  getUsageInstructions: () =>
    'This example runtime returns deterministic outputs for context-map smoke tests.',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (code.includes('final("inspect incident schema"')) {
          (globals?.final as (...args: unknown[]) => void)(
            'inspect incident schema',
            {
              selectedFields: ['incident_id', 'service_id', 'tenant_tier'],
            }
          );
        }

        if (code.includes('final("answer with schema detail"')) {
          (globals?.final as (...args: unknown[]) => void)(
            'answer with schema detail',
            {
              answer:
                'Use incident_id and service_id to join incidents to services.',
            }
          );
        }

        return 'executed';
      },
      patchGlobals: async () => {},
      close: () => {},
    };
  },
};

const map = new AxAgentContextMap(undefined, {
  maxChars: 1_200,
  infiniteEvolve: false,
  evolveSteps: 1,
});

const policyCalls: string[] = [];
const distillerPrompts: string[] = [];
const distillerUserPrompts: string[] = [];
const distillerCachedUserPrompts: string[] = [];
const executorPrompts: string[] = [];
let updateCount = 0;

const ai = new AxMockAIService<string>({
  features: { functions: false, streaming: false },
  chatResponse: async (req): Promise<AxChatResponse> => {
    const systemPrompt = getPromptText(req.chatPrompt[0]);

    if (systemPrompt.includes('context-map Distiller')) {
      policyCalls.push('distiller');
      return {
        results: [
          {
            index: 0,
            content: [
              'Diagnosis: The run learned reusable schema orientation for the incident corpus.',
              'Item Tags: {}',
              'Cache Candidates: [{"section":"parsing_schema","value":"Incident corpus records are newline-delimited JSON keyed by record type; incident records use incident_id, service_id, severity, and tenant_tier.","transferability":"future questions can join or filter incident records without rediscovering schema","rationale":"This describes corpus structure rather than the latest answer."}]',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    if (systemPrompt.includes('context-map Cartographer')) {
      policyCalls.push('cartographer');
      return {
        results: [
          {
            index: 0,
            content:
              'Operations: [{"type":"ADD","section":"parsing_schema","content":"Incident corpus records are newline-delimited JSON keyed by record type; incident records use incident_id, service_id, severity, and tenant_tier."}]',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    if (systemPrompt.includes('You (`distiller`)')) {
      distillerPrompts.push(systemPrompt);
      const userPrompts = req.chatPrompt
        .filter((msg) => msg.role === 'user')
        .map((msg) => getPromptText(msg));
      distillerUserPrompts.push(userPrompts.join('\n'));
      distillerCachedUserPrompts.push(
        req.chatPrompt
          .filter((msg) => msg.role === 'user' && msg.cache === true)
          .map((msg) => getPromptText(msg))
          .join('\n')
      );
      return {
        results: [
          {
            index: 0,
            content:
              'Javascript Code: final("inspect incident schema", {"fields":["incident_id","service_id","tenant_tier"]})',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeUsage(),
      };
    }

    if (systemPrompt.includes('You (`executor`)')) {
      executorPrompts.push(systemPrompt);
      return {
        results: [
          {
            index: 0,
            content:
              'Javascript Code: final("answer with schema detail", {"answer":"Use incident_id and service_id to join incidents to services."})',
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
            'Answer: Use incident_id and service_id to join incidents to services.',
          finishReason: 'stop',
        },
      ],
      modelUsage: makeUsage(),
    };
  },
});

const analyzer = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
  runtime,
  contextCache: { ttlSeconds: 3600 },
  contextMap: {
    map,
    onUpdate: ({ map: updatedMap }) => {
      updateCount += 1;
      assert(
        updatedMap.text.includes('newline-delimited JSON'),
        'context map update did not persist learned schema orientation'
      );
    },
  },
});

const first = await analyzer.forward(ai, {
  context: corpus,
  query: 'Which fields connect incidents to services?',
});

const second = await analyzer.forward(ai, {
  context: corpus,
  query: 'Which fields should I inspect for enterprise checkout incidents?',
});

assert(
  first.answer.includes('incident_id') && first.answer.includes('service_id'),
  'first answer did not include expected schema fields'
);
assert(
  second.answer.includes('incident_id') && second.answer.includes('service_id'),
  'second answer did not include expected schema fields'
);
assert(
  updateCount === 1,
  `expected one context-map update, saw ${updateCount}`
);
assert(
  policyCalls.join(' -> ') === 'distiller -> cartographer',
  `unexpected policy calls: ${policyCalls.join(' -> ')}`
);
assert(
  distillerPrompts.length === 2,
  `expected two RLM distiller prompts, saw ${distillerPrompts.length}`
);
assert(
  executorPrompts.every((prompt) => !prompt.includes('newline-delimited JSON')),
  'context map leaked into executor prompt'
);
assert(
  distillerPrompts[1]?.includes('### Context Map') &&
    !distillerPrompts[1]?.includes('newline-delimited JSON'),
  'context map body should not be injected into the distiller system prompt'
);
assert(
  distillerUserPrompts[1]?.includes('Context Map:') &&
    distillerUserPrompts[1]?.includes('newline-delimited JSON'),
  'frozen context map was not injected into the second distiller input prompt'
);
assert(
  distillerCachedUserPrompts[1]?.includes('Context Map:') &&
    distillerCachedUserPrompts[1]?.includes('newline-delimited JSON'),
  'context map input was not rendered in the cached user prompt'
);

console.log('Context map example: PASS');
console.log(JSON.stringify(map.snapshot(), null, 2));
