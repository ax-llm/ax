/**
 * Gemini Context Cache Tool Debug Example
 *
 * This is a local, no-network repro for Gemini explicit context caching.
 * It captures:
 * - the external registry key Ax uses for the cache
 * - the cachedContents.create payload
 * - the follow-up generateContent payload
 *
 * It also exercises the structured-output function fallback path so we can
 * verify that the synthetic structured-output function remains formally
 * declared when context caching is enabled.
 *
 * Run:
 *   npm run tsx src/examples/gemini-context-cache-tool-debug.ts
 */

import {
  AxAIGoogleGeminiModel,
  ai,
  ax,
  f,
  type AxContextCacheRegistry,
  type AxContextCacheRegistryEntry,
  type AxFunction,
} from '@ax-llm/ax';

type Breakpoint = 'after-examples' | 'after-functions' | 'system';

const STRUCTURED_OUTPUT_FUNCTION = '__finalResult';

const routerTool: AxFunction = {
  name: 'searchWeb',
  description: 'Search the web for relevant information.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
    },
    required: ['query'],
  },
  func: async ({ query }: { query: string }) => ({
    query,
    results: ['mock result'],
  }),
};

const signature = f()
  .input('question', f.string('Question to answer'))
  .output(
    'routingDecision',
    f.object({
      answer: f.string(),
      source: f.string(),
    })
  )
  .build();

const fewShotExamples = [
  {
    question: 'How should I look up current weather?',
    routingDecision: {
      answer: 'Use the search tool to gather current weather information.',
      source: 'example',
    },
  },
];

const createGenerator = () => {
  const generator = ax(signature, {
    description:
      'You are a routing assistant. Use tools when needed and return a final structured result.',
    functions: [routerTool],
    structuredOutputMode: 'function',
  });

  generator.setExamples(fewShotExamples);

  return generator;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const getToolNames = (body: any): string[] =>
  body?.tools?.flatMap((tool: any) =>
    Array.isArray(tool?.function_declarations)
      ? tool.function_declarations.map((fn: any) => String(fn.name))
      : []
  ) ?? [];

const getAllowedFunctionNames = (body: any): string[] =>
  body?.toolConfig?.allowedFunctionNames ??
  body?.toolConfig?.function_calling_config?.allowedFunctionNames ??
  [];

const createMockResponse = () => ({
  candidates: [
    {
      content: {
        parts: [
          {
            functionCall: {
              name: STRUCTURED_OUTPUT_FUNCTION,
              args: {
                routingDecision: {
                  answer: 'Use the cached tool declarations.',
                  source: 'mock',
                },
              },
            },
          },
        ],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 24,
    candidatesTokenCount: 6,
    totalTokenCount: 30,
    cachedContentTokenCount: 12,
    thoughtsTokenCount: 0,
  },
});

const createCaptureFetch = (breakpoint: Breakpoint) => {
  const calls: Array<{ url: string; body?: any }> = [];

  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    let body: any;

    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }

    calls.push({ url: String(url), body });

    if (String(url).includes('/cachedContents')) {
      return new Response(
        JSON.stringify({
          name: `cachedContents/${breakpoint}-cache`,
          expireTime: '2099-01-01T00:00:00Z',
          usageMetadata: { totalTokenCount: 4096 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify(createMockResponse()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { calls, fetch };
};

const runBreakpoint = async (cacheBreakpoint: Breakpoint) => {
  const generator = createGenerator();
  const llm = ai({
    name: 'google-gemini',
    apiKey: 'test-key',
    config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
  });

  const { calls, fetch } = createCaptureFetch(cacheBreakpoint);
  llm.setOptions({ fetch });

  const registryValues = new Map<string, AxContextCacheRegistryEntry>();
  const registryEvents: Array<{ op: 'get' | 'set'; key: string }> = [];
  const registry: AxContextCacheRegistry = {
    get: async (key: string) => {
      registryEvents.push({ op: 'get', key });
      return registryValues.get(key);
    },
    set: async (key: string, value: Readonly<AxContextCacheRegistryEntry>) => {
      registryEvents.push({ op: 'set', key });
      registryValues.set(key, value);
    },
  };

  const output = await generator.forward(
    llm,
    { question: 'Where should this request go?' },
    {
      stream: false,
      contextCache: {
        minTokens: 0,
        cacheBreakpoint,
        registry,
      },
    }
  );

  const cacheCreateCall = calls.find((call) =>
    call.url.includes('/cachedContents')
  );
  const generateCall = calls.find((call) =>
    call.url.includes(':generateContent')
  );
  const registryKey = registryEvents.find((event) => event.op === 'get')?.key;

  assert(
    cacheCreateCall,
    `missing cache create call for ${cacheBreakpoint}; saw URLs: ${calls
      .map((call) => call.url)
      .join(', ')}`
  );
  assert(
    generateCall,
    `missing generate call for ${cacheBreakpoint}; saw URLs: ${calls
      .map((call) => call.url)
      .join(', ')}`
  );
  assert(registryKey, `missing registry key for ${cacheBreakpoint}`);

  const cacheToolNames = getToolNames(cacheCreateCall.body);
  const generateToolNames = getToolNames(generateCall.body);
  const cacheAllowedFunctionNames = getAllowedFunctionNames(
    cacheCreateCall.body
  );
  const generateAllowedFunctionNames = getAllowedFunctionNames(
    generateCall.body
  );

  const expectsCachedTools = cacheBreakpoint !== 'system';

  if (expectsCachedTools) {
    assert(
      cacheToolNames.includes('searchWeb') &&
        cacheToolNames.includes(STRUCTURED_OUTPUT_FUNCTION),
      `${cacheBreakpoint}: expected cache create request to include both tool declarations`
    );
    assert(
      generateToolNames.length === 0,
      `${cacheBreakpoint}: expected cached generate request to omit tools`
    );
    assert(
      cacheAllowedFunctionNames.includes(STRUCTURED_OUTPUT_FUNCTION) ||
        cacheAllowedFunctionNames.length === 0,
      `${cacheBreakpoint}: expected cached tool config to preserve allowed function names when present`
    );
  } else {
    assert(
      cacheToolNames.length === 0,
      `${cacheBreakpoint}: expected cache create request to omit tools`
    );
    assert(
      generateToolNames.includes('searchWeb') &&
        generateToolNames.includes(STRUCTURED_OUTPUT_FUNCTION),
      `${cacheBreakpoint}: expected generate request to include both tool declarations`
    );
    assert(
      generateAllowedFunctionNames.includes(STRUCTURED_OUTPUT_FUNCTION) ||
        generateAllowedFunctionNames.length === 0,
      `${cacheBreakpoint}: expected generate tool config to preserve allowed function names when present`
    );
  }

  assert(
    generateCall.body?.cachedContent ===
      `cachedContents/${cacheBreakpoint}-cache`,
    `${cacheBreakpoint}: expected cachedContent reference on generate request`
  );
  assert(
    output.routingDecision.answer === 'Use the cached tool declarations.',
    `${cacheBreakpoint}: expected structured output function response to parse`
  );

  return {
    cacheBreakpoint,
    registryKey,
    output,
    cacheCreate: {
      url: cacheCreateCall.url,
      toolNames: cacheToolNames,
      allowedFunctionNames: cacheAllowedFunctionNames,
      hasToolConfig: Boolean(cacheCreateCall.body?.toolConfig),
    },
    generate: {
      url: generateCall.url,
      cachedContent: generateCall.body?.cachedContent,
      toolNames: generateToolNames,
      allowedFunctionNames: generateAllowedFunctionNames,
      hasToolConfig: Boolean(generateCall.body?.toolConfig),
    },
  };
};

const breakpoints: Breakpoint[] = [
  'after-examples',
  'after-functions',
  'system',
];

const results: Awaited<ReturnType<typeof runBreakpoint>>[] = [];

for (const breakpoint of breakpoints) {
  const result = await runBreakpoint(breakpoint);
  results.push(result);

  console.log(`\n=== ${breakpoint} ===`);
  console.log(
    JSON.stringify(
      {
        registryKey: result.registryKey,
        output: result.output,
        cacheCreate: result.cacheCreate,
        generate: result.generate,
      },
      null,
      2
    )
  );
}

const afterExamplesResult = results.find(
  (result) => result.cacheBreakpoint === 'after-examples'
);
const afterFunctionsResult = results.find(
  (result) => result.cacheBreakpoint === 'after-functions'
);

assert(afterExamplesResult, 'missing after-examples result');
assert(afterFunctionsResult, 'missing after-functions result');
assert(
  afterExamplesResult.registryKey !== afterFunctionsResult.registryKey,
  'expected after-examples and after-functions to produce different cache keys when examples are present'
);

console.log('\nAll Gemini context-cache tool checks passed.');
