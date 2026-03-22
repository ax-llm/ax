import fs from 'node:fs';

import {
  AxAIGoogleGeminiModel,
  ai,
  ax,
  f,
  type AxContextCacheRegistry,
  type AxFunction,
} from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;

if (!apiKey) {
  throw new Error('GOOGLE_APIKEY is not configured');
}

const assetPath = './src/examples/assets/kitten.jpeg';
const imageData = fs.readFileSync(assetPath).toString('base64');

const longPrefix = `
You are part of a live context caching verification run.
Your job is to follow the instructions carefully and answer very briefly.
This prefix is intentionally repeated to ensure Gemini explicit cache creation has enough static content.

Rules:
- Keep answers short.
- If a structured output function is available, prefer returning the final answer directly.
- Do not call extra tools unless needed.
`.repeat(100);

type CapturedCall = {
  url: string;
  body?: any;
};

type Breakpoint = 'after-examples' | 'after-functions' | 'system';

const userId = 'live-cache-verify-user';
const registryStore = new Map<string, unknown>();

const createContextCacheRegistry = (
  _redis: unknown,
  userId: string
): AxContextCacheRegistry => ({
  get: async (key: string) => registryStore.get(`${userId}:${key}`) as any,
  set: async (key: string, value: unknown) => {
    registryStore.set(`${userId}:${key}`, value);
  },
});

const getToolNames = (body: any): string[] =>
  body?.tools?.flatMap((tool: any) =>
    Array.isArray(tool?.function_declarations)
      ? tool.function_declarations.map((fn: any) => String(fn.name))
      : []
  ) ?? [];

const summarizeContents = (contents: any[] | undefined) =>
  (contents ?? []).map((content) => ({
    role: content.role,
    parts: (content.parts ?? []).map((part: any) => {
      if (part.text) {
        return { type: 'text', preview: String(part.text).slice(0, 80) };
      }
      if (part.inlineData) {
        return { type: 'inlineData', mimeType: part.inlineData.mimeType };
      }
      if (part.functionCall) {
        return { type: 'functionCall', name: part.functionCall.name };
      }
      if (part.functionResponse) {
        return { type: 'functionResponse', name: part.functionResponse.name };
      }
      return { type: 'other' };
    }),
  }));

const createWrappedFetch = (calls: CapturedCall[]) => {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    let body: any;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }
    calls.push({ url: String(url), body });
    return fetch(url, init);
  };
};

const createLiveGemini = (args: {
  calls: CapturedCall[];
  contextCache: {
    registry: AxContextCacheRegistry;
    ttlSeconds: number;
    minTokens: number;
    cacheBreakpoint?: Breakpoint;
  };
}) =>
  ai({
    name: 'google-gemini',
    apiKey,
    config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
    options: {
      fetch: createWrappedFetch(args.calls),
      contextCache: args.contextCache,
    },
  });

const runLegacyMultimodalCheck = async () => {
  const calls: CapturedCall[] = [];
  const registryEvents: string[] = [];
  const registry = createContextCacheRegistry(undefined, userId);
  const instrumentedRegistry: AxContextCacheRegistry = {
    get: async (key) => {
      registryEvents.push(`get:${key}`);
      return registry.get(key);
    },
    set: async (key, value) => {
      registryEvents.push(`set:${key}`);
      return registry.set(key, value);
    },
  };
  const llm = createLiveGemini({
    calls,
    contextCache: {
      registry: instrumentedRegistry,
      ttlSeconds: 3600,
      minTokens: 2048,
    },
  });

  const gen = ax('imageInput:image -> description:string', {
    description: `${longPrefix}\nDescribe the image in one short sentence.`,
  });
  gen.setExamples([
    {
      imageInput: { mimeType: 'image/jpeg', data: imageData },
      description: 'A kitten on a bed.',
    },
  ]);

  const result = await gen.forward(
    llm,
    { imageInput: { mimeType: 'image/jpeg', data: imageData } },
    {
      stream: false,
      examplesInSystem: true,
    }
  );

  const cacheCreateCall = calls.find((call) =>
    call.url.includes('/cachedContents')
  );
  const generateCall = calls.find((call) =>
    call.url.includes(':generateContent')
  );

  if (!cacheCreateCall || !generateCall) {
    throw new Error(
      `Legacy multimodal check did not observe both cache and generate calls: ${calls
        .map((c) => c.url)
        .join(', ')}`
    );
  }

  return {
    result,
    registryKey: registryEvents.find((e) => e.startsWith('get:'))?.slice(4),
    cacheCreateContents: summarizeContents(cacheCreateCall.body?.contents),
    generateContents: summarizeContents(generateCall.body?.contents),
  };
};

const searchWeb: AxFunction = {
  name: 'searchWeb',
  description: 'Search the web for information.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  func: async ({ query }: { query: string }) => ({
    query,
    result: 'mock search result',
  }),
};

const structuredSig = f()
  .input('question', f.string())
  .output(
    'routingDecision',
    f.object({
      answer: f.string(),
      source: f.string(),
    })
  )
  .build();

const runToolCheck = async (cacheBreakpoint: Breakpoint) => {
  const calls: CapturedCall[] = [];
  const registryEvents: string[] = [];
  const registry = createContextCacheRegistry(
    undefined,
    `${userId}-${cacheBreakpoint}`
  );
  const instrumentedRegistry: AxContextCacheRegistry = {
    get: async (key) => {
      registryEvents.push(`get:${key}`);
      return registry.get(key);
    },
    set: async (key, value) => {
      registryEvents.push(`set:${key}`);
      return registry.set(key, value);
    },
  };
  const llm = createLiveGemini({
    calls,
    contextCache: {
      registry: instrumentedRegistry,
      ttlSeconds: 3600,
      minTokens: 2048,
      cacheBreakpoint,
    },
  });

  const gen = ax(structuredSig, {
    description: `${longPrefix}\nReturn the final answer directly if possible.`,
    functions: [searchWeb],
    structuredOutputMode: 'function',
  });
  gen.setExamples([
    {
      question: 'How should I answer a simple routing question?',
      routingDecision: {
        answer: 'Return the final structured result directly.',
        source: 'example',
      },
    },
  ]);

  const output = await gen.forward(
    llm,
    { question: 'Reply with a direct cached-context verification answer.' },
    {
      stream: false,
    }
  );

  const cacheCreateCall = calls.find((call) =>
    call.url.includes('/cachedContents')
  );
  const generateCall = calls.find((call) =>
    call.url.includes(':generateContent')
  );

  if (!cacheCreateCall || !generateCall) {
    throw new Error(
      `${cacheBreakpoint} tool check did not observe both cache and generate calls: ${calls
        .map((c) => c.url)
        .join(', ')}`
    );
  }

  return {
    cacheBreakpoint,
    output,
    registryKey: registryEvents.find((e) => e.startsWith('get:'))?.slice(4),
    cacheCreate: {
      toolNames: getToolNames(cacheCreateCall.body),
      hasToolConfig: Boolean(cacheCreateCall.body?.toolConfig),
      contents: summarizeContents(cacheCreateCall.body?.contents),
    },
    generate: {
      cachedContent: generateCall.body?.cachedContent,
      toolNames: getToolNames(generateCall.body),
      hasToolConfig: Boolean(generateCall.body?.toolConfig),
      contents: summarizeContents(generateCall.body?.contents),
    },
  };
};

const main = async () => {
  console.log('\n=== Live legacy multimodal check ===');
  const multimodal = await runLegacyMultimodalCheck();
  console.log(JSON.stringify(multimodal, null, 2));

  console.log('\n=== Live tool checks ===');
  const afterExamples = await runToolCheck('after-examples');
  console.log(JSON.stringify(afterExamples, null, 2));

  const afterFunctions = await runToolCheck('after-functions');
  console.log(JSON.stringify(afterFunctions, null, 2));

  const system = await runToolCheck('system');
  console.log(JSON.stringify(system, null, 2));

  if (afterExamples.registryKey === afterFunctions.registryKey) {
    throw new Error(
      'after-examples and after-functions should produce different live registry keys when examples are present'
    );
  }

  if (system.registryKey !== afterFunctions.registryKey) {
    throw new Error(
      'system and after-functions should share the same live registry key when Gemini caches only system prompt and tool state'
    );
  }

  if (
    system.cacheCreate.toolNames.length === 0 ||
    system.generate.toolNames.length > 0
  ) {
    throw new Error(
      'system breakpoint should cache Gemini tool state and omit request-time tools/toolConfig from generateContent'
    );
  }

  console.log('\nLive Gemini verification completed.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
