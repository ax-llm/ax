import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxBalancer } from '../../../src/ax/ai/balance.js';
import {
  AxInMemoryBalancerStatsStore,
  axUpdateBalancerRouteStats,
  createBalancerRouteStats,
  sampleBalancerRouteHealth,
} from '../../../src/ax/ai/balance_adaptive.js';
import { axGetSupportedAIModels } from '../../../src/ax/ai/catalog.js';
import { AxAICohereEmbedModel } from '../../../src/ax/ai/cohere/types.js';
import { axAIGoogleGeminiLiveAudioDefaultConfig } from '../../../src/ax/ai/google-gemini/api.js';
import { AxAIGoogleGeminiEmbedModel } from '../../../src/ax/ai/google-gemini/types.js';
import { AxMultiServiceRouter } from '../../../src/ax/ai/multiservice.js';
import { AxAIOpenAIModel } from '../../../src/ax/ai/openai/chat_types.js';
import {
  axResolveOpenAIChatReasoningEffort,
  axResolveOpenAIResponsesReasoningEffort,
} from '../../../src/ax/ai/openai/effort.js';
import { axGetAIProfile } from '../../../src/ax/ai/provider_profiles.js';
import { AxProviderRouter } from '../../../src/ax/ai/router.js';
import {
  axAIGrokDefaultConfig,
  axAIGrokVoiceDefaultConfig,
} from '../../../src/ax/ai/x-grok/api.js';
import { axValidateToolArguments } from '../../../src/ax/dsp/toolArguments.js';
import {
  AxAIServiceAuthenticationError,
  AxAIServiceNetworkError,
  AxAIServiceResponseError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../../../src/ax/util/apicall.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axai'
);

function stable(value: unknown, preserveOrder = false): unknown {
  if (Array.isArray(value))
    return value.map((item) => stable(item, preserveOrder));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (preserveOrder ? 0 : a.localeCompare(b)))
        .map(([key, item]) => [
          key,
          stable(item, preserveOrder || key === 'validation_cases'),
        ])
    );
  }
  return value;
}

function writeFixture(name: string, fixture: Fixture): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

mkdirSync(outDir, { recursive: true });

const profileDefaultModel = (id: Parameters<typeof axGetAIProfile>[0]) =>
  axGetAIProfile(id).defaultModel as string;
const responsesDefaultModel = profileDefaultModel('openai-responses');
const azureDefaultModel = profileDefaultModel('azure-openai');
const deepseekDefaultModel = profileDefaultModel('deepseek');
const deepseekResponsesDefaultModel = profileDefaultModel('deepseek-responses');
const mistralDefaultModel = profileDefaultModel('mistral');
const rekaDefaultModel = profileDefaultModel('reka');
const cohereDefaultModel = profileDefaultModel('cohere');
const cohereDefaultEmbedModel = AxAICohereEmbedModel.EmbedEnglishV30;
const grokDefaultModel = axAIGrokDefaultConfig().model as string;
const grokVoiceDefaultModel = axAIGrokVoiceDefaultConfig().model as string;
const geminiDefaultModel = profileDefaultModel('google-gemini');
const geminiLiveDefaultModel = axAIGoogleGeminiLiveAudioDefaultConfig()
  .model as string;
const geminiDefaultEmbedModel = 'gemini-embedding-2';
const anthropicDefaultModel = profileDefaultModel('anthropic');
const catalogAll = axGetSupportedAIModels();
const catalogText = axGetSupportedAIModels({ type: 'text' });
const catalogEmbeddings = axGetSupportedAIModels({ type: 'embeddings' });
const catalogCode = axGetSupportedAIModels({ type: 'code' });
const catalogAudio = axGetSupportedAIModels({ type: 'audio' });
const catalogImage = axGetSupportedAIModels({ type: 'image' });
const catalogProviderNames = catalogAll.map((provider) => provider.name);
const profileRegistry = JSON.parse(
  readFileSync(
    join(process.cwd(), 'ir/axcore/data/provider-profile-registry.json'),
    'utf8'
  )
) as {
  registryVersion: string;
  supportedProfileIds: string[];
  profiles: Record<
    string,
    { aliases: string[]; catalogStatus: string; [key: string]: Json }
  >;
  deferredCatalogProviderIds: string[];
};
const descriptorCoveredProviderIds = profileRegistry.supportedProfileIds.filter(
  (id) => profileRegistry.profiles[id]?.catalogStatus === 'descriptor-covered'
);
const deferredProviderIds: string[] = [];
const openAIProvider = catalogAll.find(
  (provider) => provider.name === 'openai'
);
const textOpenAIProvider = catalogText.find(
  (provider) => provider.name === 'openai'
);
const embeddingOpenAIProvider = catalogEmbeddings.find(
  (provider) => provider.name === 'openai'
);
const codeOpenAIProvider = catalogCode.find(
  (provider) => provider.name === 'openai'
);
const audioOpenAIProvider = catalogAudio.find(
  (provider) => provider.name === 'openai'
);
const imageMetaProvider = catalogImage.find(
  (provider) => provider.name === 'meta'
);
const geminiCatalogProvider = catalogAll.find(
  (provider) => provider.name === 'google-gemini'
);
const geminiEmbeddingModel = geminiCatalogProvider?.models.find(
  (model) => model.name === AxAIGoogleGeminiEmbedModel.GeminiEmbedding2
);
const firstCatalog = axGetSupportedAIModels();
const firstOpenAI = firstCatalog.find((provider) => provider.name === 'openai');
const firstOpenAIModel = firstOpenAI?.models.find(
  (model) => model.name === AxAIOpenAIModel.GPT5Mini
);
firstOpenAI?.models.push({
  name: 'mutated',
  provider: 'openai',
  type: 'text',
  isDefault: false,
  capabilities: {
    thinkingBudget: false,
    thinkingLevels: [],
    showThoughts: false,
    structuredOutputs: false,
    temperature: true,
    topP: true,
    audioInput: false,
    audioOutput: false,
    serviceTiers: [],
  },
});
if (firstOpenAIModel) {
  firstOpenAIModel.promptTokenCostPer1M = 999;
  firstOpenAIModel.capabilities.structuredOutputs = false;
}
const clonedOpenAIModel = axGetSupportedAIModels()
  .find((provider) => provider.name === 'openai')
  ?.models.find((model) => model.name === AxAIOpenAIModel.GPT5Mini);

function catalogSnapshot(catalog: unknown): Json {
  return JSON.parse(JSON.stringify(catalog)) as Json;
}

const routerFeatures = (overrides: Record<string, unknown> = {}) => ({
  functions: false,
  streaming: false,
  media: {
    images: { supported: false, formats: [] },
    audio: {
      supported: false,
      formats: [],
      output: { supported: false, formats: [] },
    },
    files: { supported: false, formats: [], uploadMethod: 'none' },
    urls: { supported: false, webSearch: false, contextFetching: false },
  },
  caching: { supported: false, types: [] },
  thinking: false,
  multiTurn: true,
  ...overrides,
});

class FixtureAIService {
  id: string;
  name: string;
  modelList?: any[];
  features: any;
  requests: any[] = [];
  options: Record<string, unknown> = {};
  lastChat?: unknown;
  lastEmbed?: unknown;
  lastConfig?: unknown;
  responses: any[] = [];
  metricsValue: any;
  estimatedCost: number;

  constructor(spec: {
    name: string;
    id?: string;
    modelList?: any[];
    features?: any;
    responses?: any[];
    metrics?: any;
    estimatedCost?: number;
  }) {
    this.name = spec.name;
    this.id = spec.id ?? `${spec.name}-id`;
    this.modelList = spec.modelList;
    this.features = spec.features ?? routerFeatures();
    this.responses = [...(spec.responses ?? [])];
    this.metricsValue = spec.metrics ?? { service: this.name, calls: 0 };
    this.estimatedCost = spec.estimatedCost ?? 0;
  }

  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getFeatures() {
    return this.features;
  }
  getModelList() {
    return this.modelList;
  }
  getMetrics() {
    const out = structuredClone(this.metricsValue);
    if (out && typeof out === 'object' && 'calls' in out) {
      out.calls = this.requests.length;
    }
    return out;
  }
  getLogger() {
    return (message: string) => this.requests.push({ logger: message });
  }
  getLastUsedChatModel() {
    return this.lastChat;
  }
  getLastUsedEmbedModel() {
    return this.lastEmbed;
  }
  getLastUsedModelConfig() {
    return this.lastConfig;
  }
  setOptions(options: Record<string, unknown>) {
    this.options = options;
  }
  getOptions() {
    return this.options;
  }
  async chat(req: any, opt?: any) {
    this.lastChat = req.model;
    this.lastConfig = req.modelConfig;
    this.requests.push({ method: 'chat', req, opt });
    if (this.responses.length > 0) {
      const next = this.responses.shift();
      if (next?.error) {
        throw fixtureAIError(next.error);
      }
      return structuredClone(next.response ?? next);
    }
    return { results: [{ index: 0, content: `${this.name} chat` }] };
  }
  async embed(req: any, opt?: any) {
    this.lastEmbed = req.embedModel;
    this.requests.push({ method: 'embed', req, opt });
    return { embeddings: [[1, 2]], modelUsage: { ai: this.name } };
  }
  async transcribe(req: any, opt?: any) {
    this.requests.push({ method: 'transcribe', req, opt });
    return { text: `${this.name} transcript` };
  }
  async speak(req: any, opt?: any) {
    this.requests.push({ method: 'speak', req, opt });
    return { audio: 'pcm' };
  }
  getEstimatedCost() {
    return this.estimatedCost;
  }
}

const normalizeFixtureServiceCalls = (calls: any[]) =>
  calls.map((call) => ({
    method: call.method,
    ...(call.opt !== undefined ? { opt: call.opt } : {}),
  }));

function fixtureAIError(spec: any): Error {
  const message = spec.message ?? 'fixture error';
  switch (spec.type ?? 'network') {
    case 'status':
      return new AxAIServiceStatusError(
        spec.status ?? 500,
        spec.statusText ?? 'Fixture',
        'fixture://ai',
        {},
        {}
      );
    case 'authentication':
      return new AxAIServiceAuthenticationError('fixture://ai', {}, {});
    case 'response':
      return new AxAIServiceResponseError(message, 'fixture://ai', {});
    case 'timeout':
      return new AxAIServiceTimeoutError(
        'fixture://ai',
        spec.timeoutMs ?? 1000,
        {}
      );
    case 'plain':
      return new Error(message);
    default:
      return new AxAIServiceNetworkError(
        new Error(message),
        'fixture://ai',
        {},
        {}
      );
  }
}

const balancerMetrics = (chatMean: number, embedMean = chatMean) => ({
  latency: {
    chat: {
      mean: chatMean,
      p95: chatMean + 5,
      p99: chatMean + 9,
      samples: [chatMean],
    },
    embed: {
      mean: embedMean,
      p95: embedMean + 5,
      p99: embedMean + 9,
      samples: [embedMean],
    },
  },
  errors: {
    chat: { count: 0, rate: 0, total: 1 },
    embed: { count: 0, rate: 0, total: 1 },
  },
});

writeFixture('provider-profile-registry', {
  kind: 'ai_provider_registry',
  alias_expectations: Object.fromEntries(
    Object.values(profileRegistry.profiles).flatMap((profile) =>
      profile.aliases.map((alias) => [alias, profile.id])
    )
  ),
  expected_output: profileRegistry,
});

writeFixture('model-catalog-audit', {
  kind: 'ai_model_catalog_audit',
  ts_catalog_evidence: {
    providerCount: catalogAll.length,
    providerNames: catalogProviderNames,
    returnedProviderNames: catalogAll.map((provider) => provider.name),
    openaiDefaultModel: openAIProvider?.defaultModel ?? null,
    openaiFirstModel: openAIProvider?.models.at(0)?.name ?? null,
    textOpenAIFirstModel: textOpenAIProvider?.models.at(0)?.name ?? null,
    textFilterIncludesCode:
      textOpenAIProvider?.models.some((model) => model.type === 'code') ??
      false,
    embeddingsFilterOnlyEmbeddings:
      embeddingOpenAIProvider?.models.every(
        (model) => model.type === 'embeddings'
      ) ?? false,
    codeFilterOnlyCode:
      codeOpenAIProvider?.models.every((model) => model.type === 'code') ??
      false,
    audioFilterOnlyAudio:
      audioOpenAIProvider?.models.every((model) => model.type === 'audio') ??
      false,
    imageFilterOnlyImage:
      imageMetaProvider?.models.every((model) => model.type === 'image') ??
      false,
    geminiDefaultEmbedModel: geminiCatalogProvider?.defaultEmbedModel ?? null,
    geminiEmbedding2: geminiEmbeddingModel
      ? {
          type: geminiEmbeddingModel.type,
          isDefault: geminiEmbeddingModel.isDefault,
          promptTokenCostPer1M:
            geminiEmbeddingModel.promptTokenCostPer1M ?? null,
        }
      : null,
    clonedMetadata:
      clonedOpenAIModel?.promptTokenCostPer1M !== 999 &&
      clonedOpenAIModel?.capabilities.structuredOutputs !== false,
  },
  expected_output: {
    catalogVersion: 'provider-model-catalog-audit-v1',
    source: 'src/ax/ai/catalog.ts',
    providerCount: catalogProviderNames.length,
    providerNames: catalogProviderNames,
    descriptorCoveredProviderIds,
    deferredProviderIds,
    filterOptions: ['all', 'text', 'embeddings', 'code', 'audio', 'image'],
    semantics: {
      codeMatchesTextFilter: true,
      modelSort: 'price-then-name',
      providerSort: 'cheapest-model-then-display-name',
      metadataClonedPerCall: true,
      dynamicProvidersMayHaveEmptyModels: true,
    },
    nextMilestone:
      'Generated catalog provider clients match the active catalog',
  },
});

for (const [fixtureName, modelType, catalog] of [
  ['model-catalog-runtime-all', null, catalogAll],
  ['model-catalog-runtime-text', 'text', catalogText],
  ['model-catalog-runtime-embeddings', 'embeddings', catalogEmbeddings],
  ['model-catalog-runtime-code', 'code', catalogCode],
  ['model-catalog-runtime-audio', 'audio', catalogAudio],
  ['model-catalog-runtime-image', 'image', catalogImage],
] as const) {
  const openai = catalog.find((provider) => provider.name === 'openai');
  writeFixture(fixtureName, {
    kind: 'ai_model_catalog_runtime',
    model_type: modelType,
    check_clone: true,
    expected_output: {
      providerCount: catalog.length,
      providerNames: catalog.map((provider) => provider.name),
      modelCount: catalog.reduce(
        (count, provider) => count + provider.models.length,
        0
      ),
      openaiFirstModel: openai?.models.at(0)?.name ?? null,
      openaiModelTypes: [
        ...new Set(openai?.models.map((model) => model.type) ?? []),
      ].sort(),
      catalog: catalogSnapshot(catalog),
    },
  });
}

const routerServiceSpecs = [
  {
    name: 'A',
    id: 'A-id',
    modelList: [
      { key: 'chat-a', description: 'Chat A', model: 'a-model' },
      { key: 'embed-a', description: 'Embed A', embedModel: 'a-embed' },
    ],
    features: routerFeatures({
      functions: true,
      streaming: true,
      media: {
        images: { supported: true, formats: ['png'] },
        audio: {
          supported: false,
          formats: [],
          output: { supported: false, formats: [] },
        },
        files: { supported: false, formats: [], uploadMethod: 'none' },
        urls: { supported: false, webSearch: false, contextFetching: false },
      },
      caching: { supported: true, types: ['ephemeral'] },
    }),
  },
  {
    name: 'B',
    id: 'B-id',
    modelList: [{ key: 'chat-b', description: 'Chat B', model: 'b-model' }],
    features: routerFeatures(),
  },
];
const routerServiceA = new FixtureAIService(routerServiceSpecs[0]);
const routerServiceB = new FixtureAIService(routerServiceSpecs[1]);
const multiRouter = new AxMultiServiceRouter([
  routerServiceA as any,
  routerServiceB as any,
]);
const multiChat = await multiRouter.chat(
  {
    model: 'chat-a',
    chatPrompt: [{ role: 'user', content: 'hi' }],
    modelConfig: { temperature: 0.2 },
  } as any,
  { trace: 'chat' } as any
);
const multiEmbed = await multiRouter.embed(
  { embedModel: 'embed-a', texts: ['x'] } as any,
  { trace: 'embed' } as any
);
const multiTranscribe = await multiRouter.transcribe(
  { text: 'x' } as any,
  { trace: 'transcribe' } as any
);
const multiSpeak = await multiRouter.speak(
  { text: 'y' } as any,
  { trace: 'speak' } as any
);
multiRouter.setOptions({ debug: true } as any);

writeFixture('multiservice-router-runtime', {
  kind: 'ai_multiservice_router',
  services: routerServiceSpecs,
  router_entries: [
    { kind: 'service', service_index: 0 },
    { kind: 'service', service_index: 1 },
  ],
  operations: [
    {
      name: 'chat',
      request: {
        model: 'chat-a',
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { temperature: 0.2 },
      },
      options: { trace: 'chat' },
    },
    {
      name: 'embed',
      request: { embedModel: 'embed-a', texts: ['x'] },
      options: { trace: 'embed' },
    },
    {
      name: 'transcribe',
      request: { text: 'x' },
      options: { trace: 'transcribe' },
    },
    { name: 'speak', request: { text: 'y' }, options: { trace: 'speak' } },
    { name: 'set_options', options: { debug: true } },
  ],
  expected_output: {
    modelList: multiRouter.getModelList() as any,
    outputs: {
      chat: multiChat as any,
      embed: multiEmbed as any,
      transcribe: multiTranscribe as any,
      speak: multiSpeak as any,
    },
    lastChat: multiRouter.getLastUsedChatModel() as Json,
    lastConfig: multiRouter.getLastUsedModelConfig() as Json,
    metrics: multiRouter.getMetrics() as any,
    options: multiRouter.getOptions() as any,
    serviceCalls: [normalizeFixtureServiceCalls(routerServiceA.requests)],
  },
});

let duplicateModelKeyError = '';
try {
  new AxMultiServiceRouter([
    new FixtureAIService(routerServiceSpecs[0]) as any,
    new FixtureAIService(routerServiceSpecs[0]) as any,
  ]);
} catch (error) {
  duplicateModelKeyError =
    error instanceof Error ? error.message.replaceAll('`', "'") : String(error);
}
writeFixture('multiservice-router-duplicate-key', {
  kind: 'ai_multiservice_router',
  services: [routerServiceSpecs[0], routerServiceSpecs[0]],
  router_entries: [
    { kind: 'service', service_index: 0 },
    { kind: 'service', service_index: 1 },
  ],
  expected_error_contains: duplicateModelKeyError,
});

const keyServiceSpec = {
  name: 'Key',
  id: 'Key-id',
  features: routerFeatures(),
};
const keyService = new FixtureAIService(keyServiceSpec);
const keyRouter = new AxMultiServiceRouter([
  { key: 'direct', description: 'Direct key', service: keyService as any },
]);
const keyChat = await keyRouter.chat(
  { model: 'direct', chatPrompt: [{ role: 'user', content: 'go' }] } as any,
  { trace: 'direct' } as any
);
writeFixture('multiservice-router-key-entry', {
  kind: 'ai_multiservice_router',
  services: [keyServiceSpec],
  router_entries: [
    {
      kind: 'key',
      key: 'direct',
      description: 'Direct key',
      service_index: 0,
    },
  ],
  operations: [
    {
      name: 'chat',
      request: {
        model: 'direct',
        chatPrompt: [{ role: 'user', content: 'go' }],
      },
      options: { trace: 'direct' },
    },
  ],
  expected_output: {
    outputs: { chat: keyChat as any },
    serviceCalls: [normalizeFixtureServiceCalls(keyService.requests)],
  },
});

const textOnlySpec = {
  name: 'TextOnly',
  id: 'TextOnly-id',
  features: routerFeatures({ functions: true, streaming: false }),
};
const visionSpec = {
  name: 'Vision',
  id: 'Vision-id',
  features: routerFeatures({
    functions: true,
    streaming: true,
    media: {
      images: { supported: true, formats: ['jpeg', 'png'] },
      audio: {
        supported: false,
        formats: [],
        output: { supported: false, formats: [] },
      },
      files: { supported: false, formats: [], uploadMethod: 'none' },
      urls: { supported: false, webSearch: false, contextFetching: false },
    },
  }),
};
const routingRequest = {
  chatPrompt: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'see' },
        {
          type: 'image',
          image: 'first-image-bytes',
          mimeType: 'image/jpeg',
          details: 'high',
          cache: true,
          optimize: 'quality',
          altText: 'first diagram',
        },
        { type: 'text', text: 'then compare' },
        {
          type: 'image',
          image: 'second-image-bytes',
          mimeType: 'image/png',
          details: 'low',
          cache: false,
          optimize: 'size',
          altText: 'second diagram',
        },
      ],
    },
  ],
  functions: [{ name: 'tool' }],
  modelConfig: { stream: true },
};
const textOnlyProvider = new FixtureAIService(textOnlySpec);
const visionProvider = new FixtureAIService(visionSpec);
const providerRouter = new AxProviderRouter({
  providers: {
    primary: textOnlyProvider as any,
    alternatives: [visionProvider as any],
  },
  routing: {
    preferenceOrder: ['capability'],
    capability: { requireExactMatch: false, allowDegradation: true },
  },
  processing: {},
});
const recommendation = await providerRouter.getRoutingRecommendation(
  routingRequest as any
);
const providerRouterValidation = await providerRouter.validateRequest(
  routingRequest as any
);
const providerRouterStats = providerRouter.getRoutingStats();
await providerRouter.chat(
  routingRequest as any,
  {
    traceLabel: 'native-image-preservation',
  } as any
);
const forwardedContent = visionProvider.requests[0]?.req?.chatPrompt?.[0]
  ?.content as Json;
writeFixture('provider-router-recommendation', {
  kind: 'ai_provider_router',
  services: [textOnlySpec, visionSpec],
  primary_index: 0,
  alternative_indices: [1],
  routing: {
    capability: { requireExactMatch: false, allowDegradation: true },
  },
  request: routingRequest,
  expected_output: {
    recommendation: {
      provider: recommendation.provider.getName(),
      processingApplied: recommendation.processingApplied,
      degradations: recommendation.degradations,
      warnings: recommendation.warnings,
    },
    forwardedContent,
    validation: providerRouterValidation as Json | any,
    stats: providerRouterStats as any,
  },
});

const degradedRequest = {
  chatPrompt: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'see' },
        { type: 'image', image: 'abc', cache: true },
        { type: 'audio', data: 'pcm', format: 'wav' },
      ],
    },
  ],
  functions: [{ name: 'tool' }],
  modelConfig: { stream: true },
};
const degradedRouter = new AxProviderRouter({
  providers: {
    primary: new FixtureAIService(textOnlySpec) as any,
    alternatives: [],
  },
  routing: {
    preferenceOrder: ['capability'],
    capability: { requireExactMatch: false, allowDegradation: true },
  },
  processing: {},
});
const degradedRecommendation = await degradedRouter.getRoutingRecommendation(
  degradedRequest as any
);
writeFixture('provider-router-degradation', {
  kind: 'ai_provider_router',
  services: [textOnlySpec],
  primary_index: 0,
  alternative_indices: [],
  routing: {
    capability: { requireExactMatch: false, allowDegradation: true },
  },
  request: degradedRequest,
  expected_output: {
    recommendation: {
      provider: degradedRecommendation.provider.getName(),
      processingApplied: degradedRecommendation.processingApplied,
      degradations: degradedRecommendation.degradations,
      warnings: degradedRecommendation.warnings,
    },
    validation: (await degradedRouter.validateRequest(
      degradedRequest as any
    )) as Json | any,
    stats: degradedRouter.getRoutingStats() as any,
  },
});

// Compare native file routing with TypeScript, including fallback policy.
for (const variant of ['native', 'extracted', 'degrade', 'skip'] as const) {
  const supported = variant === 'native';
  const spec = {
    name: supported ? 'Files' : 'Text',
    features: routerFeatures({
      media: {
        ...routerFeatures().media,
        files: {
          supported,
          formats: supported ? ['application/pdf'] : [],
          uploadMethod: supported ? 'inline' : 'none',
        },
      },
    }),
  };
  const service = new FixtureAIService(spec);
  const processing = {
    fallbackBehavior: variant === 'skip' ? 'skip' : 'degrade',
  };
  const request = {
    chatPrompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read this file' },
          {
            type: 'file',
            data: 'JVBERi0=',
            mimeType: 'application/pdf',
            filename: 'report.pdf',
            cache: true,
            ...(supported || variant === 'extracted'
              ? { extractedText: 'Extracted report' }
              : {}),
          },
          { type: 'text', text: 'Then summarize' },
        ],
      },
    ],
  };
  const router = new AxProviderRouter({
    providers: { primary: service as any, alternatives: [] },
    routing: {
      preferenceOrder: ['capability'],
      capability: { requireExactMatch: false, allowDegradation: true },
    },
    processing: processing as any,
  });
  const rec = await router.getRoutingRecommendation(request as any);
  const validation = await router.validateRequest(request as any);
  const stats = router.getRoutingStats();
  await router.chat(request as any, { processingOptions: processing } as any);
  writeFixture(`provider-router-files-${variant}`, {
    kind: 'ai_provider_router',
    services: [spec],
    primary_index: 0,
    alternative_indices: [],
    routing: {
      capability: { requireExactMatch: false, allowDegradation: true },
    },
    processing,
    request,
    expected_output: {
      recommendation: {
        provider: rec.provider.getName(),
        processingApplied: rec.processingApplied,
        degradations: rec.degradations,
        warnings: rec.warnings,
      },
      validation: validation as any,
      stats: stats as any,
      forwardedContent: service.requests[0]?.req?.chatPrompt?.[0]
        ?.content as Json,
    },
  });
}

const balancerSlowSpec = {
  name: 'Slow',
  id: 'Slow-id',
  modelList: [
    { key: 'balanced-chat', description: 'Slow chat', model: 'slow-model' },
  ],
  features: routerFeatures({ functions: true, structuredOutputs: true }),
  metrics: balancerMetrics(200, 70),
};
const balancerFastSpec = {
  name: 'Fast',
  id: 'Fast-id',
  modelList: [
    { key: 'balanced-chat', description: 'Fast chat', model: 'fast-model' },
  ],
  features: routerFeatures({ streaming: true, structuredOutputs: true }),
  metrics: balancerMetrics(20, 30),
};
const balancerDefaultServices = [
  new FixtureAIService(balancerSlowSpec),
  new FixtureAIService(balancerFastSpec),
];
const balancerDefault = new AxBalancer(balancerDefaultServices as any, {
  debug: false,
});
const balancerDefaultChat = await balancerDefault.chat(
  {
    model: 'fixture-model',
    chatPrompt: [{ role: 'user', content: 'balance' }],
  } as any,
  { trace: 'balance-default' } as any
);
balancerDefault.setOptions({ debug: true, trace: 'all' } as any);
writeFixture('balancer-runtime-metric', {
  kind: 'ai_balancer',
  services: [balancerSlowSpec, balancerFastSpec],
  options: { strategy: 'metric', debug: false },
  operations: [
    {
      name: 'chat',
      request: {
        model: 'fixture-model',
        chatPrompt: [{ role: 'user', content: 'balance' }],
      },
      options: { trace: 'balance-default' },
    },
    { name: 'set_options', options: { debug: true, trace: 'all' } },
  ],
  expected_output: {
    id: balancerDefault.getId(),
    name: balancerDefault.getName(),
    modelList: balancerDefault.getModelList() as any,
    features: balancerDefault.getFeatures() as any,
    outputs: { chat: balancerDefaultChat as any },
    metrics: balancerDefault.getMetrics() as any,
    options: balancerDefault.getOptions() as any,
    lastChat: balancerDefault.getLastUsedChatModel() as Json,
    lastConfig: balancerDefault.getLastUsedModelConfig() as Json,
    serviceCalls: balancerDefaultServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const retryPrimarySpec = {
  name: 'RetryPrimary',
  id: 'RetryPrimary-id',
  features: routerFeatures(),
  metrics: balancerMetrics(100),
  responses: [
    { error: { type: 'network', message: 'first network miss' } },
    { error: { type: 'network', message: 'second network miss' } },
  ],
};
const retryBackupSpec = {
  name: 'RetryBackup',
  id: 'RetryBackup-id',
  features: routerFeatures(),
  metrics: balancerMetrics(300),
};
const balancerRetryServices = [
  new FixtureAIService(retryPrimarySpec),
  new FixtureAIService(retryBackupSpec),
];
const balancerRetry = new AxBalancer(balancerRetryServices as any, {
  comparator: AxBalancer.inputOrderComparator,
  debug: false,
  maxRetries: 2,
});
const balancerRetryChat = await balancerRetry.chat(
  {
    model: 'retry-model',
    chatPrompt: [{ role: 'user', content: 'retry' }],
  } as any,
  { trace: 'retry' } as any
);
writeFixture('balancer-input-order-retry', {
  kind: 'ai_balancer',
  services: [retryPrimarySpec, retryBackupSpec],
  options: { strategy: 'input_order', debug: false, maxRetries: 2 },
  operations: [
    {
      name: 'chat',
      request: {
        model: 'retry-model',
        chatPrompt: [{ role: 'user', content: 'retry' }],
      },
      options: { trace: 'retry' },
    },
  ],
  expected_output: {
    outputs: { chat: balancerRetryChat as any },
    lastChat: balancerRetry.getLastUsedChatModel() as Json,
    serviceCalls: balancerRetryServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const overload529PrimarySpec = {
  name: 'Overload529Primary',
  id: 'Overload529Primary-id',
  features: routerFeatures(),
  metrics: balancerMetrics(100),
  responses: [
    { error: { type: 'status', status: 529, message: 'overloaded' } },
    { error: { type: 'status', status: 529, message: 'overloaded' } },
  ],
};
const overload529BackupSpec = {
  name: 'Overload529Backup',
  id: 'Overload529Backup-id',
  features: routerFeatures(),
  metrics: balancerMetrics(300),
};
const balancerOverload529Services = [
  new FixtureAIService(overload529PrimarySpec),
  new FixtureAIService(overload529BackupSpec),
];
const balancerOverload529 = new AxBalancer(balancerOverload529Services as any, {
  comparator: AxBalancer.inputOrderComparator,
  debug: false,
  maxRetries: 2,
});
const balancerOverload529Chat = await balancerOverload529.chat(
  {
    model: 'overload-model',
    chatPrompt: [{ role: 'user', content: 'overload' }],
  } as any,
  { trace: 'overload' } as any
);
writeFixture('balancer-status-529-failover', {
  kind: 'ai_balancer',
  services: [overload529PrimarySpec, overload529BackupSpec],
  options: { strategy: 'input_order', debug: false, maxRetries: 2 },
  operations: [
    {
      name: 'chat',
      request: {
        model: 'overload-model',
        chatPrompt: [{ role: 'user', content: 'overload' }],
      },
      options: { trace: 'overload' },
    },
  ],
  expected_output: {
    outputs: { chat: balancerOverload529Chat as any },
    lastChat: balancerOverload529.getLastUsedChatModel() as Json,
    serviceCalls: balancerOverload529Services
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

// Proves balancer failover on the STREAMING path: a stream() call whose primary hits a
// retryable 529 must fail over to the healthy backup, same as chat(). The ports route
// balancer.stream() through the chat() failover loop, so the streamed deltas come from the
// backup. TS AxBalancer has no separate stream(), so the expected single-result delta is the
// failover chat result wrapped as one stream chunk (every port's stream wrapper collapses a
// single-result response to [{ results: [result] }]). serviceCalls are not asserted because
// the stream wrapper adds `stream: true` to the recorded options.
const overload529StreamPrimarySpec = {
  name: 'Overload529StreamPrimary',
  id: 'Overload529StreamPrimary-id',
  features: routerFeatures(),
  metrics: balancerMetrics(100),
  responses: [
    { error: { type: 'status', status: 529, message: 'overloaded' } },
    { error: { type: 'status', status: 529, message: 'overloaded' } },
  ],
};
const overload529StreamBackupSpec = {
  name: 'Overload529StreamBackup',
  id: 'Overload529StreamBackup-id',
  features: routerFeatures(),
  metrics: balancerMetrics(300),
};
const balancerOverload529StreamServices = [
  new FixtureAIService(overload529StreamPrimarySpec),
  new FixtureAIService(overload529StreamBackupSpec),
];
const balancerOverload529Stream = new AxBalancer(
  balancerOverload529StreamServices as any,
  { comparator: AxBalancer.inputOrderComparator, debug: false, maxRetries: 2 }
);
const balancerOverload529StreamChat = await balancerOverload529Stream.chat(
  {
    model: 'overload-model',
    chatPrompt: [{ role: 'user', content: 'overload' }],
  } as any,
  { trace: 'overload' } as any
);
writeFixture('balancer-status-529-stream-failover', {
  kind: 'ai_balancer',
  services: [overload529StreamPrimarySpec, overload529StreamBackupSpec],
  options: { strategy: 'input_order', debug: false, maxRetries: 2 },
  operations: [
    {
      name: 'stream',
      request: {
        model: 'overload-model',
        chatPrompt: [{ role: 'user', content: 'overload' }],
      },
      options: { trace: 'overload' },
    },
  ],
  expected_output: {
    outputs: { stream: [balancerOverload529StreamChat as any] },
  },
});

const textOnlyBalancerSpec = {
  name: 'TextBalancer',
  id: 'TextBalancer-id',
  features: routerFeatures(),
  metrics: balancerMetrics(10),
};
const imageBalancerSpec = {
  name: 'ImageBalancer',
  id: 'ImageBalancer-id',
  features: routerFeatures({
    media: {
      images: { supported: true, formats: ['png', 'jpeg'] },
      audio: {
        supported: false,
        formats: [],
        output: { supported: false, formats: [] },
      },
      files: { supported: false, formats: [], uploadMethod: 'none' },
      urls: { supported: false, webSearch: false, contextFetching: false },
    },
  }),
  metrics: balancerMetrics(50),
};
const balancerCapabilityServices = [
  new FixtureAIService(textOnlyBalancerSpec),
  new FixtureAIService(imageBalancerSpec),
];
const balancerCapability = new AxBalancer(balancerCapabilityServices as any, {
  comparator: AxBalancer.inputOrderComparator,
  debug: false,
});
const balancerCapabilityChat = await balancerCapability.chat(
  {
    model: 'vision-model',
    chatPrompt: [{ role: 'user', content: 'look' }],
    capabilities: { requiresImages: true },
  } as any,
  { trace: 'vision' } as any
);
writeFixture('balancer-capability-filter', {
  kind: 'ai_balancer',
  services: [textOnlyBalancerSpec, imageBalancerSpec],
  options: { strategy: 'input_order', debug: false },
  operations: [
    {
      name: 'chat',
      request: {
        model: 'vision-model',
        chatPrompt: [{ role: 'user', content: 'look' }],
        capabilities: { requiresImages: true },
      },
      options: { trace: 'vision' },
    },
  ],
  expected_output: {
    outputs: { chat: balancerCapabilityChat as any },
    lastChat: balancerCapability.getLastUsedChatModel() as Json,
    serviceCalls: balancerCapabilityServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const adaptiveModelList = [
  {
    key: 'adaptive-chat',
    description: 'Equivalent adaptive route',
    model: 'provider-model',
  },
];
const adaptiveStatsObservations = [
  { outcome: 'failure' as const },
  { outcome: 'success' as const, latencyMs: 200 },
  { outcome: 'success' as const, latencyMs: 400 },
];
const adaptiveStats = adaptiveStatsObservations.reduce(
  (stats, observation) => axUpdateBalancerRouteStats(stats, observation),
  createBalancerRouteStats()
);
const adaptiveRandomValues = [0.5, 0.25, 0.5, 0.5, 0.25];
const originalRandom = Math.random;
let adaptiveRandomIndex = 0;
Math.random = () =>
  adaptiveRandomValues[adaptiveRandomIndex++] ??
  adaptiveRandomValues[adaptiveRandomValues.length - 1]!;
const adaptiveHealth = sampleBalancerRouteHealth(adaptiveStats, 1_000);
Math.random = originalRandom;
const roundAdaptive = (value: number) => Math.round(value * 1e9) / 1e9;
const adaptiveStatsExpected = {
  stats: {
    version: adaptiveStats.version,
    observations: adaptiveStats.observations,
    successes: adaptiveStats.successes,
    failureEwma: roundAdaptive(adaptiveStats.failureEwma),
    logLatencyMean: roundAdaptive(adaptiveStats.logLatencyMean),
    logLatencyM2: roundAdaptive(adaptiveStats.logLatencyM2),
  },
  health: {
    failureProbability: roundAdaptive(adaptiveHealth.failureProbability),
    deadlineMissProbability: roundAdaptive(
      adaptiveHealth.deadlineMissProbability
    ),
  },
  score: roundAdaptive(
    0.01 +
      0.05 *
        (adaptiveHealth.failureProbability +
          (1 - adaptiveHealth.failureProbability) *
            adaptiveHealth.deadlineMissProbability)
  ),
};
writeFixture('balancer-adaptive-stats-math', {
  kind: 'ai_balancer',
  services: [
    {
      name: 'AdaptiveStats',
      id: 'adaptive-stats',
      features: routerFeatures(),
      metrics: balancerMetrics(10),
    },
  ],
  options: { strategy: 'input_order' },
  operations: [
    {
      name: 'adaptive_stats',
      observations: adaptiveStatsObservations,
      random_values: adaptiveRandomValues,
      deadline_ms: 1_000,
      estimated_cost: 0.01,
      bad_outcome_cost: 0.05,
    },
  ],
  expected_output: { outputs: { adaptive_stats: adaptiveStatsExpected } },
});

const adaptiveCostHighSpec = {
  name: 'AdaptiveCostHigh',
  id: 'adaptive-cost-high',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(10),
  estimatedCost: 0.03,
};
const adaptiveCostLowSpec = {
  name: 'AdaptiveCostLow',
  id: 'adaptive-cost-low',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(20),
  estimatedCost: 0.01,
};
const adaptiveCostServices = [
  new FixtureAIService(adaptiveCostHighSpec),
  new FixtureAIService(adaptiveCostLowSpec),
];
const adaptiveCostOptions = {
  strategy: {
    type: 'adaptive' as const,
    deadlineMs: 1_000,
    badOutcomeCost: 0,
    expectedTokens: { promptTokens: 100, completionTokens: 50 },
  },
};
const adaptiveCostBalancer = new AxBalancer(
  adaptiveCostServices as any,
  adaptiveCostOptions
);
const adaptiveCostRequest = {
  model: 'adaptive-chat',
  chatPrompt: [{ role: 'user', content: 'pick the cheaper route' }],
};
const adaptiveCostChat = await adaptiveCostBalancer.chat(
  adaptiveCostRequest as any,
  {}
);
writeFixture('balancer-adaptive-cost-ranking', {
  kind: 'ai_balancer',
  services: [adaptiveCostHighSpec, adaptiveCostLowSpec],
  options: adaptiveCostOptions,
  operations: [{ name: 'chat', request: adaptiveCostRequest, options: {} }],
  expected_output: {
    outputs: { chat: adaptiveCostChat as any },
    serviceCalls: adaptiveCostServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const adaptiveFailurePrimarySpec = {
  name: 'AdaptiveFailurePrimary',
  id: 'adaptive-failure-primary',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(10),
  estimatedCost: 0,
  responses: [
    { error: { type: 'network', message: 'adaptive transient miss' } },
  ],
};
const adaptiveFailureBackupSpec = {
  name: 'AdaptiveFailureBackup',
  id: 'adaptive-failure-backup',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(20),
  estimatedCost: 1,
};
const adaptiveFailureServices = [
  new FixtureAIService(adaptiveFailurePrimarySpec),
  new FixtureAIService(adaptiveFailureBackupSpec),
];
const adaptiveFailureOptions = {
  strategy: {
    type: 'adaptive' as const,
    deadlineMs: 1_000,
    badOutcomeCost: 0,
  },
  maxRetries: 9,
};
const adaptiveFailureBalancer = new AxBalancer(
  adaptiveFailureServices as any,
  adaptiveFailureOptions
);
const adaptiveFailureRequest = {
  model: 'adaptive-chat',
  chatPrompt: [{ role: 'user', content: 'fail over once' }],
};
const adaptiveFailureChat = await adaptiveFailureBalancer.chat(
  adaptiveFailureRequest as any,
  {}
);
writeFixture('balancer-adaptive-single-attempt-failover', {
  kind: 'ai_balancer',
  services: [adaptiveFailurePrimarySpec, adaptiveFailureBackupSpec],
  options: adaptiveFailureOptions,
  operations: [{ name: 'chat', request: adaptiveFailureRequest, options: {} }],
  expected_output: {
    outputs: { chat: adaptiveFailureChat as any },
    serviceCalls: adaptiveFailureServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const adaptiveCapabilityFilteredSpec = {
  name: 'AdaptiveCapabilityFiltered',
  id: 'adaptive-capability-filtered',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(5),
  estimatedCost: 0,
};
const adaptiveCapabilityFirstSpec = {
  name: 'AdaptiveCapabilityFirst',
  id: 'adaptive-capability-first',
  modelList: adaptiveModelList,
  features: imageBalancerSpec.features,
  metrics: balancerMetrics(20),
  estimatedCost: 0.01,
};
const adaptiveCapabilitySecondSpec = {
  name: 'AdaptiveCapabilitySecond',
  id: 'adaptive-capability-second',
  modelList: adaptiveModelList,
  features: imageBalancerSpec.features,
  metrics: balancerMetrics(10),
  estimatedCost: 0.01,
};
const adaptiveCapabilityServices = [
  new FixtureAIService(adaptiveCapabilityFilteredSpec),
  new FixtureAIService(adaptiveCapabilityFirstSpec),
  new FixtureAIService(adaptiveCapabilitySecondSpec),
];
const adaptiveCapabilityOptions = {
  strategy: {
    type: 'adaptive' as const,
    deadlineMs: 1_000,
    badOutcomeCost: 0,
  },
};
const adaptiveCapabilityBalancer = new AxBalancer(
  adaptiveCapabilityServices as any,
  adaptiveCapabilityOptions
);
const adaptiveCapabilityRequest = {
  model: 'adaptive-chat',
  chatPrompt: [{ role: 'user', content: 'use a vision-capable route' }],
  capabilities: { requiresImages: true },
};
const adaptiveCapabilityChat = await adaptiveCapabilityBalancer.chat(
  adaptiveCapabilityRequest as any,
  {}
);
writeFixture('balancer-adaptive-capability-stable-tie', {
  kind: 'ai_balancer',
  services: [
    adaptiveCapabilityFilteredSpec,
    adaptiveCapabilityFirstSpec,
    adaptiveCapabilitySecondSpec,
  ],
  options: adaptiveCapabilityOptions,
  operations: [
    { name: 'chat', request: adaptiveCapabilityRequest, options: {} },
  ],
  expected_output: {
    outputs: { chat: adaptiveCapabilityChat as any },
    serviceCalls: adaptiveCapabilityServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const adaptiveExhaustedPrimarySpec = {
  name: 'AdaptiveExhaustedPrimary',
  id: 'adaptive-exhausted-primary',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(10),
  estimatedCost: 0,
  responses: [{ error: { type: 'network', message: 'first adaptive miss' } }],
};
const adaptiveExhaustedBackupSpec = {
  name: 'AdaptiveExhaustedBackup',
  id: 'adaptive-exhausted-backup',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(20),
  estimatedCost: 1,
  responses: [{ error: { type: 'network', message: 'final adaptive miss' } }],
};
writeFixture('balancer-adaptive-exhaustion', {
  kind: 'ai_balancer',
  services: [adaptiveExhaustedPrimarySpec, adaptiveExhaustedBackupSpec],
  options: {
    strategy: {
      type: 'adaptive',
      deadlineMs: 1_000,
      badOutcomeCost: 0,
    },
    maxRetries: 20,
  },
  operations: [
    {
      name: 'chat',
      request: {
        model: 'adaptive-chat',
        chatPrompt: [{ role: 'user', content: 'exhaust every route once' }],
      },
      options: {},
    },
  ],
  expected_error_contains: 'final adaptive miss',
});

const adaptiveStreamPrimarySpec = {
  name: 'AdaptiveStreamPrimary',
  id: 'adaptive-stream-primary',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(10),
  estimatedCost: 0,
  responses: [
    { error: { type: 'status', status: 529, message: 'stream overloaded' } },
  ],
};
const adaptiveStreamBackupSpec = {
  name: 'AdaptiveStreamBackup',
  id: 'adaptive-stream-backup',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(20),
  estimatedCost: 1,
};
const adaptiveStreamServices = [
  new FixtureAIService(adaptiveStreamPrimarySpec),
  new FixtureAIService(adaptiveStreamBackupSpec),
];
const adaptiveStreamOptions = {
  strategy: {
    type: 'adaptive' as const,
    deadlineMs: 1_000,
    badOutcomeCost: 0,
  },
};
const adaptiveStreamBalancer = new AxBalancer(
  adaptiveStreamServices as any,
  adaptiveStreamOptions
);
const adaptiveStreamRequest = {
  model: 'adaptive-chat',
  chatPrompt: [{ role: 'user', content: 'buffer the healthy route' }],
};
const adaptiveStreamChat = await adaptiveStreamBalancer.chat(
  adaptiveStreamRequest as any,
  {}
);
writeFixture('balancer-adaptive-incremental-stream-failover', {
  kind: 'ai_balancer',
  services: [adaptiveStreamPrimarySpec, adaptiveStreamBackupSpec],
  options: adaptiveStreamOptions,
  operations: [{ name: 'stream', request: adaptiveStreamRequest, options: {} }],
  expected_output: {
    outputs: { stream: [adaptiveStreamChat as any] },
  },
});

const adaptiveBestEffortSpec = {
  name: 'AdaptiveBestEffort',
  id: 'adaptive-best-effort',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(10),
  estimatedCost: 0,
};
const adaptiveBestEffortService = new FixtureAIService(adaptiveBestEffortSpec);
let adaptiveBestEffortGets = 0;
let adaptiveBestEffortObserves = 0;
let adaptiveBestEffortEvents = 0;
const adaptiveBestEffortStore = {
  async get() {
    adaptiveBestEffortGets++;
    throw new Error('fixture store read failed');
  },
  async observe() {
    adaptiveBestEffortObserves++;
    throw new Error('fixture store write failed');
  },
};
const adaptiveBestEffortOptions = {
  strategy: {
    type: 'adaptive' as const,
    deadlineMs: 1_000,
    badOutcomeCost: 0,
    namespace: 'best-effort',
    routeKey: () => 'best-effort-route',
    statsStore: adaptiveBestEffortStore,
    onRoutingEvent: () => {
      adaptiveBestEffortEvents++;
      throw new Error('fixture event hook failed');
    },
  },
};
const adaptiveBestEffortBalancer = new AxBalancer(
  [adaptiveBestEffortService] as any,
  adaptiveBestEffortOptions
);
const adaptiveBestEffortRequest = {
  model: 'adaptive-chat',
  chatPrompt: [{ role: 'user', content: 'ignore observer failures' }],
};
const adaptiveBestEffortChat = await adaptiveBestEffortBalancer.chat(
  adaptiveBestEffortRequest as any,
  {}
);
writeFixture('balancer-adaptive-store-event-failures', {
  kind: 'ai_balancer',
  adaptive_best_effort: true,
  services: [adaptiveBestEffortSpec],
  options: {
    strategy: {
      type: 'adaptive',
      deadlineMs: 1_000,
      badOutcomeCost: 0,
      namespace: 'best-effort',
    },
  },
  operations: [
    { name: 'chat', request: adaptiveBestEffortRequest, options: {} },
  ],
  expected_output: {
    outputs: { chat: adaptiveBestEffortChat as any },
    bestEffort: {
      storeGets: adaptiveBestEffortGets,
      storeObserves: adaptiveBestEffortObserves,
      eventCalls: adaptiveBestEffortEvents,
    },
    serviceCalls: [
      normalizeFixtureServiceCalls(adaptiveBestEffortService.requests),
    ],
  },
});

const adaptiveSharedStore = new AxInMemoryBalancerStatsStore();
const adaptiveSharedKey = {
  namespace: 'shared',
  slice: 'workflow-a',
  logicalModel: 'adaptive-chat',
  routeKey: 'shared-route',
};
const adaptiveIsolatedKey = {
  ...adaptiveSharedKey,
  slice: 'workflow-b',
};
await adaptiveSharedStore.observe(adaptiveSharedKey, {
  outcome: 'success',
  latencyMs: 100,
});
await adaptiveSharedStore.observe(adaptiveSharedKey, { outcome: 'failure' });
await adaptiveSharedStore.observe(adaptiveIsolatedKey, {
  outcome: 'success',
  latencyMs: 300,
});
writeFixture('balancer-adaptive-shared-store-isolation', {
  kind: 'ai_balancer',
  services: [adaptiveBestEffortSpec],
  options: { strategy: 'input_order' },
  operations: [
    {
      name: 'adaptive_store',
      writes: [
        {
          key: adaptiveSharedKey,
          observation: { outcome: 'success', latencyMs: 100 },
        },
        { key: adaptiveSharedKey, observation: { outcome: 'failure' } },
        {
          key: adaptiveIsolatedKey,
          observation: { outcome: 'success', latencyMs: 300 },
        },
      ],
      reads: [adaptiveSharedKey, adaptiveIsolatedKey],
    },
  ],
  expected_output: {
    outputs: {
      adaptive_store: {
        states: [
          (await adaptiveSharedStore.get(adaptiveSharedKey)) as any,
          (await adaptiveSharedStore.get(adaptiveIsolatedKey)) as any,
        ],
      },
    },
  },
});

writeFixture('balancer-adaptive-invalid-namespace', {
  kind: 'ai_balancer',
  services: [adaptiveBestEffortSpec],
  options: {
    strategy: {
      type: 'adaptive',
      deadlineMs: 1_000,
      badOutcomeCost: 0,
      namespace: '',
    },
  },
  operations: [],
  expected_error_contains: 'namespace',
});

const adaptiveDuplicateRouteSpec = {
  ...adaptiveBestEffortSpec,
  name: 'AdaptiveDuplicateRoute',
};
writeFixture('balancer-adaptive-duplicate-route-key', {
  kind: 'ai_balancer',
  services: [adaptiveBestEffortSpec, adaptiveDuplicateRouteSpec],
  options: {
    strategy: {
      type: 'adaptive',
      deadlineMs: 1_000,
      badOutcomeCost: 0,
    },
  },
  operations: [],
  expected_error_contains: 'unique',
});

const adaptiveUnavailablePricingSpec = {
  name: 'AdaptiveUnavailablePricing',
  id: 'adaptive-unavailable-pricing',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(20),
};
const adaptivePricedSpec = {
  name: 'AdaptivePriced',
  id: 'adaptive-priced',
  modelList: adaptiveModelList,
  features: routerFeatures(),
  metrics: balancerMetrics(10),
  estimatedCost: 0.01,
};
const adaptiveUnavailablePricingServices = [
  new FixtureAIService(adaptiveUnavailablePricingSpec),
  new FixtureAIService(adaptivePricedSpec),
];
const adaptiveUnavailablePricingBalancer = new AxBalancer(
  adaptiveUnavailablePricingServices as any,
  adaptiveCostOptions
);
const adaptiveUnavailablePricingRequest = {
  model: 'adaptive-chat',
  chatPrompt: [{ role: 'user', content: 'treat unavailable pricing as zero' }],
};
const adaptiveUnavailablePricingChat =
  await adaptiveUnavailablePricingBalancer.chat(
    adaptiveUnavailablePricingRequest as any,
    {}
  );
writeFixture('balancer-adaptive-unavailable-pricing', {
  kind: 'ai_balancer',
  services: [adaptiveUnavailablePricingSpec, adaptivePricedSpec],
  options: adaptiveCostOptions,
  operations: [
    {
      name: 'chat',
      request: adaptiveUnavailablePricingRequest,
      options: {},
    },
  ],
  expected_output: {
    outputs: { chat: adaptiveUnavailablePricingChat as any },
    serviceCalls: adaptiveUnavailablePricingServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const adaptiveNonChatServices = [
  new FixtureAIService(adaptiveCostHighSpec),
  new FixtureAIService(adaptiveCostLowSpec),
];
const adaptiveNonChatBalancer = new AxBalancer(
  adaptiveNonChatServices as any,
  adaptiveCostOptions
);
const adaptiveEmbedRequest = {
  embedModel: 'fixture-embed',
  texts: ['ordered operation'],
};
const adaptiveEmbed = await adaptiveNonChatBalancer.embed(
  adaptiveEmbedRequest as any,
  {}
);
writeFixture('balancer-adaptive-non-chat-remains-ordered', {
  kind: 'ai_balancer',
  services: [adaptiveCostHighSpec, adaptiveCostLowSpec],
  options: adaptiveCostOptions,
  operations: [{ name: 'embed', request: adaptiveEmbedRequest, options: {} }],
  expected_output: {
    outputs: { embed: adaptiveEmbed as any },
    serviceCalls: adaptiveNonChatServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

const exhaustedSpec = {
  name: 'Exhausted',
  id: 'Exhausted-id',
  features: routerFeatures(),
  metrics: balancerMetrics(10),
  responses: [
    { error: { type: 'network', message: 'first exhausted miss' } },
    { error: { type: 'network', message: 'final exhausted miss' } },
  ],
};
let exhaustedError = '';
try {
  const exhaustedBalancer = new AxBalancer(
    [new FixtureAIService(exhaustedSpec)] as any,
    {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
      maxRetries: 2,
    }
  );
  await exhaustedBalancer.chat({
    model: 'exhausted-model',
    chatPrompt: [{ role: 'user', content: 'fail' }],
  } as any);
} catch (error) {
  exhaustedError =
    error instanceof Error ? error.message.replaceAll('`', "'") : String(error);
}
writeFixture('balancer-max-retries-error', {
  kind: 'ai_balancer',
  services: [exhaustedSpec],
  options: { strategy: 'input_order', debug: false, maxRetries: 2 },
  operations: [
    {
      name: 'chat',
      request: {
        model: 'exhausted-model',
        chatPrompt: [{ role: 'user', content: 'fail' }],
      },
    },
  ],
  expected_error_contains: exhaustedError,
});

writeFixture('responses-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'openai-responses',
  expected_output: {
    id: 'openai-responses',
    name: 'OpenAI Responses',
    defaultModel: responsesDefaultModel,
    defaultEmbedModel: 'text-embedding-3-small',
    operations: {
      chat: { method: 'POST', path: '/responses', body: 'json', stream: false },
      stream_chat: {
        method: 'POST',
        path: '/responses',
        body: 'json',
        stream: true,
      },
      embed: {
        method: 'POST',
        path: '/embeddings',
        body: 'json',
        stream: false,
      },
      transcribe: {
        method: 'POST',
        path: '/audio/transcriptions',
        body: 'multipart',
        stream: false,
      },
      speak: {
        method: 'POST',
        path: '/audio/speech',
        body: 'json',
        stream: false,
      },
      realtime: {
        method: 'WS',
        path: '/realtime',
        body: 'json',
        stream: true,
        grammar: 'openai_realtime_compatible',
      },
    },
    features: {
      media: {
        audio: { supported: true, output: { supported: true } },
      },
    },
  },
});

writeFixture('gemini-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'google-gemini',
  expected_output: {
    id: 'google-gemini',
    name: 'Google Gemini',
    defaultModel: geminiDefaultModel,
    defaultEmbedModel: geminiDefaultEmbedModel,
    auth: 'api_key_header',
    apiKeyHeader: 'x-goog-api-key',
    operations: {
      chat: {
        method: 'POST',
        path: '/models/{model}:generateContent',
        body: 'json',
        stream: false,
      },
      stream_chat: {
        method: 'POST',
        path: '/models/{model}:streamGenerateContent?alt=sse',
        body: 'json',
        stream: true,
      },
      embed: {
        method: 'POST',
        path: '/models/{model}:batchEmbedContents',
        body: 'json',
        stream: false,
      },
      realtime: {
        method: 'WS',
        path: '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
        body: 'json',
        stream: true,
        grammar: 'gemini_live_bidi',
      },
    },
    features: {
      media: {
        images: { supported: true },
        audio: { supported: true, output: { supported: true } },
        files: { supported: true, upload_method: 'cloud' },
      },
      caching: { supported: true, types: ['persistent'] },
      thinking: true,
    },
  },
});

writeFixture('anthropic-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'anthropic',
  expected_output: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: anthropicDefaultModel,
    auth: 'x-api-key',
    baseUrl: 'https://api.anthropic.com',
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'structured-outputs-2025-11-13, web-search-2025-03-05',
    },
    operations: {
      chat: {
        method: 'POST',
        path: '/v1/messages',
        body: 'json',
        stream: false,
      },
      stream_chat: {
        method: 'POST',
        path: '/v1/messages',
        body: 'json',
        stream: true,
      },
    },
    features: {
      media: {
        images: { supported: true },
        audio: { supported: false, output: { supported: false } },
      },
      caching: { supported: true, types: ['ephemeral'] },
      thinking: true,
    },
  },
});

writeFixture('azure-openai-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'azure-openai',
  expected_output: {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    defaultModel: azureDefaultModel,
    defaultEmbedModel: 'text-embedding-3-small',
    auth: 'api_key_header',
    apiKeyHeader: 'api-key',
    apiVersion: '2024-02-15-preview',
    operations: {
      chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: false,
      },
      stream_chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: true,
      },
      embed: {
        method: 'POST',
        path: '/embeddings',
        body: 'json',
        stream: false,
      },
    },
    features: {
      media: {
        images: { supported: true },
      },
      thinking: true,
    },
  },
});

writeFixture('deepseek-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'deepseek',
  expected_output: {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultModel: deepseekDefaultModel,
    auth: 'bearer',
    baseUrl: 'https://api.deepseek.com',
    operations: {
      chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: false,
      },
      stream_chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: true,
      },
    },
    features: {
      structured_outputs: false,
      thinking: false,
      media: { images: { supported: false } },
    },
  },
});

writeFixture('mistral-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'mistral',
  expected_output: {
    id: 'mistral',
    name: 'Mistral AI',
    defaultModel: mistralDefaultModel,
    defaultEmbedModel: 'mistral-embed',
    baseUrl: 'https://api.mistral.ai/v1',
    operations: {
      chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: false,
      },
      embed: {
        method: 'POST',
        path: '/embeddings',
        body: 'json',
        stream: false,
      },
    },
  },
});

writeFixture('reka-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'reka',
  expected_output: {
    id: 'reka',
    name: 'Reka',
    defaultModel: rekaDefaultModel,
    baseUrl: 'https://api.reka.ai/v1',
    operations: {
      chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: false,
      },
    },
  },
});

writeFixture('cohere-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'cohere',
  expected_output: {
    id: 'cohere',
    name: 'Cohere',
    defaultModel: cohereDefaultModel,
    defaultEmbedModel: cohereDefaultEmbedModel,
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    operations: {
      chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: false,
      },
      embed: {
        method: 'POST',
        path: '/embeddings',
        body: 'json',
        stream: false,
      },
    },
  },
});

writeFixture('grok-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'grok',
  expected_output: {
    id: 'grok',
    name: 'xAI Grok',
    defaultModel: grokDefaultModel,
    baseUrl: 'https://api.x.ai/v1',
    operations: {
      chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: false,
      },
      stream_chat: {
        method: 'POST',
        path: '/chat/completions',
        body: 'json',
        stream: true,
      },
      realtime: {
        method: 'WS',
        path: '/realtime',
        body: 'json',
        stream: true,
        grammar: 'openai_realtime_compatible',
      },
    },
    features: {
      media: {
        images: { supported: true },
        audio: { supported: true, realtime: true, output: { supported: true } },
        urls: { web_search: true },
      },
      thinking: false,
    },
  },
});

writeFixture('deepseek-responses-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'deepseek-responses',
  expected_output: {
    id: 'deepseek-responses',
    name: 'DeepSeek Responses',
    defaultModel: deepseekResponsesDefaultModel,
    auth: 'bearer',
    baseUrl: 'https://api.deepseek.com',
    operations: {
      chat: {
        method: 'POST',
        path: '/responses',
        body: 'json',
        stream: false,
      },
      stream_chat: {
        method: 'POST',
        path: '/responses',
        body: 'json',
        stream: true,
      },
    },
    features: {
      structured_outputs: false,
      thinking: true,
      media: { images: { supported: false } },
    },
  },
});

const compatibleResponse = (id: string, model: string, content = 'ok') => ({
  status: 200,
  json: {
    id,
    object: 'chat.completion',
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    },
  },
});

const compatibleExpectedOutput = (
  aiName: string,
  remoteId: string,
  model: string,
  content = 'ok'
) => ({
  results: [
    {
      index: 0,
      id: '0',
      content,
      function_calls: [],
      finish_reason: 'stop',
    },
  ],
  remote_id: remoteId,
  model_usage: {
    ai: aiName,
    model,
    tokens: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    },
  },
});

for (const tierCase of [
  {
    name: 'profile-service-tier-openai-standard',
    provider: 'openai',
    model: profileDefaultModel('openai'),
    url: 'https://api.openai.com/v1/chat/completions',
    expected: 'default',
  },
  {
    name: 'profile-service-tier-mistral-standard',
    provider: 'mistral',
    model: mistralDefaultModel,
    url: 'https://api.mistral.ai/v1/chat/completions',
    expected: 'standard_only',
  },
  {
    name: 'profile-service-tier-groq-priority',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    requested: 'priority',
    expected: 'performance',
  },
  {
    name: 'profile-service-tier-openrouter-standard-omitted',
    provider: 'openrouter',
    model: 'openai/gpt-5-mini',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    expected: null,
  },
] as const) {
  const requested = tierCase.requested ?? 'standard';
  writeFixture(tierCase.name, {
    kind: 'ai_chat',
    provider: tierCase.provider,
    model: tierCase.model,
    service_options: { serviceTier: requested },
    request: {
      chat_prompt: [{ role: 'user', content: 'use requested service tier' }],
      model_config: { stream: false },
    },
    transport_responses: [
      compatibleResponse(`chatcmpl_${tierCase.provider}_tier`, tierCase.model),
    ],
    expected_output: compatibleExpectedOutput(
      tierCase.provider,
      `chatcmpl_${tierCase.provider}_tier`,
      tierCase.model
    ),
    expected_transport_request: {
      method: 'POST',
      url: tierCase.url,
      json:
        tierCase.expected === null ? {} : { service_tier: tierCase.expected },
    },
    ...(tierCase.expected === null
      ? { expected_transport_json_absent: ['service_tier'] }
      : {}),
  });
}

writeFixture('profile-service-tier-unsupported-error', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: anthropicDefaultModel,
  service_options: { serviceTier: 'priority' },
  request: {
    chat_prompt: [{ role: 'user', content: 'use priority' }],
    model_config: { stream: false },
  },
  expected_error_contains: 'service tier priority is not verified',
});

writeFixture('profile-service-tier-exact-model-opt-in', {
  kind: 'ai_chat',
  provider: 'openai-compatible',
  model: 'custom-flex',
  base_url: 'https://compatible.test/v1',
  service_options: {
    serviceTier: 'flex',
    modelInfo: [
      {
        name: 'custom-flex',
        supported: { serviceTiers: ['flex'] },
      },
    ],
  },
  request: {
    chat_prompt: [{ role: 'user', content: 'use flex' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_custom_flex', 'custom-flex'),
  ],
  expected_output: compatibleExpectedOutput(
    'openai-compatible',
    'chatcmpl_custom_flex',
    'custom-flex'
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://compatible.test/v1/chat/completions',
    json: { service_tier: 'flex' },
  },
});

writeFixture('profile-service-tier-response-normalization', {
  kind: 'ai_chat',
  provider: 'cerebras',
  model: 'gpt-oss-120b',
  service_options: { serviceTier: 'priority' },
  request: {
    chat_prompt: [{ role: 'user', content: 'use priority' }],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        ...compatibleResponse('chatcmpl_cerebras_tier', 'gpt-oss-120b').json,
        service_tier_used: 'performance',
      },
    },
  ],
  expected_output: {
    ...compatibleExpectedOutput(
      'cerebras',
      'chatcmpl_cerebras_tier',
      'gpt-oss-120b'
    ),
    model_usage: {
      ai: 'cerebras',
      model: 'gpt-oss-120b',
      tokens: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
        service_tier: 'priority',
      },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    json: { service_tier: 'priority' },
  },
});

writeFixture('azure-openai-compatible-chat', {
  kind: 'ai_chat',
  provider: 'azure-openai',
  model: azureDefaultModel,
  resource_name: 'example',
  deployment_name: 'deployment',
  api_version: 'api-version=2024-02-15-preview',
  request: {
    chat_prompt: [{ role: 'user', content: 'hello azure' }],
    model_config: { stream: false, maxTokens: 32 },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_azure', azureDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'azure-openai',
    'chatcmpl_azure',
    azureDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://example.openai.azure.com/openai/deployments/deployment/chat/completions?api-version=2024-02-15-preview',
    headers: { 'api-key': 'test-key' },
    json: {
      model: azureDefaultModel,
      messages: [{ role: 'user', content: 'hello azure' }],
      max_completion_tokens: 32,
    },
  },
});

writeFixture('deepseek-openai-compatible-chat', {
  kind: 'ai_chat',
  provider: 'deepseek',
  model: deepseekDefaultModel,
  request: {
    chat_prompt: [{ role: 'user', content: 'hello deepseek' }],
    functions: [{ name: 'lookup', description: 'Lookup', parameters: {} }],
    function_call: 'none',
    model_config: {
      stream: false,
      temperature: 0.3,
      topP: 0.9,
      presencePenalty: 0.2,
      frequencyPenalty: 0.1,
      thinkingTokenBudget: 'highest',
    },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_deepseek', deepseekDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'deepseek',
    'chatcmpl_deepseek',
    deepseekDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.deepseek.com/chat/completions',
    json: {
      model: deepseekDefaultModel,
      messages: [{ role: 'user', content: 'hello deepseek' }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    },
  },
});

writeFixture('deepseek-service-default-thinking', {
  kind: 'ai_chat',
  provider: 'deepseek',
  model: deepseekDefaultModel,
  request: {
    chat_prompt: [{ role: 'user', content: 'think by default' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_deepseek_default', deepseekDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'deepseek',
    'chatcmpl_deepseek_default',
    deepseekDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.deepseek.com/chat/completions',
    json: {
      model: deepseekDefaultModel,
      messages: [{ role: 'user', content: 'think by default' }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    },
  },
});

for (const profileCase of [
  {
    name: 'grok-default-max-thinking',
    provider: 'grok',
    model: 'grok-4.6',
    url: 'https://api.x.ai/v1/chat/completions',
    effort: 'xhigh',
  },
  {
    name: 'groq-gpt-oss-default-max-thinking',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    effort: 'high',
  },
  {
    name: 'cerebras-gemma-default-max-thinking',
    provider: 'cerebras',
    model: 'gemma-4-31b',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    effort: 'high',
  },
  {
    name: 'deepinfra-deepseek-default-max-thinking',
    provider: 'deepinfra',
    model: 'deepseek-ai/DeepSeek-R1-0528',
    url: 'https://api.deepinfra.com/v1/openai/chat/completions',
    effort: 'high',
  },
] as const) {
  writeFixture(profileCase.name, {
    kind: 'ai_chat',
    provider: profileCase.provider,
    model: profileCase.model,
    request: {
      chat_prompt: [{ role: 'user', content: 'think by default' }],
      model_config: { stream: false },
    },
    transport_responses: [
      compatibleResponse(
        `chatcmpl_${profileCase.provider}_default`,
        profileCase.model
      ),
    ],
    expected_output: compatibleExpectedOutput(
      profileCase.provider,
      `chatcmpl_${profileCase.provider}_default`,
      profileCase.model
    ),
    expected_transport_request: {
      method: 'POST',
      url: profileCase.url,
      json: {
        model: profileCase.model,
        messages: [{ role: 'user', content: 'think by default' }],
        reasoning_effort: profileCase.effort,
      },
    },
  });
}

writeFixture('groq-gpt-oss-explicit-none-error', {
  kind: 'ai_chat',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  service_options: { thinkingTokenBudget: 'none' },
  request: {
    chat_prompt: [{ role: 'user', content: 'answer directly' }],
    model_config: { stream: false },
  },
  expected_error_contains: 'does not support the none effort level',
});

writeFixture('deepseek-service-thinking-budget', {
  kind: 'ai_chat',
  provider: 'deepseek',
  model: deepseekDefaultModel,
  service_options: { thinkingTokenBudget: 'medium' },
  request: {
    chat_prompt: [{ role: 'user', content: 'think' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_deepseek_budget', deepseekDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'deepseek',
    'chatcmpl_deepseek_budget',
    deepseekDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.deepseek.com/chat/completions',
    json: {
      model: deepseekDefaultModel,
      messages: [{ role: 'user', content: 'think' }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'medium',
    },
  },
});

writeFixture('deepseek-service-low-thinking-budget', {
  kind: 'ai_chat',
  provider: 'deepseek',
  model: deepseekDefaultModel,
  service_options: { thinkingTokenBudget: 'low' },
  request: {
    chat_prompt: [{ role: 'user', content: 'think efficiently' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_deepseek_low_budget', deepseekDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'deepseek',
    'chatcmpl_deepseek_low_budget',
    deepseekDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.deepseek.com/chat/completions',
    json: {
      model: deepseekDefaultModel,
      messages: [{ role: 'user', content: 'think efficiently' }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    },
  },
});

writeFixture('deepseek-service-reasoning-effort', {
  kind: 'ai_chat',
  provider: 'deepseek',
  model: deepseekDefaultModel,
  service_options: { reasoning_effort: 'max' },
  request: {
    chat_prompt: [{ role: 'user', content: 'think hard' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_deepseek_effort', deepseekDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'deepseek',
    'chatcmpl_deepseek_effort',
    deepseekDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.deepseek.com/chat/completions',
    json: {
      model: deepseekDefaultModel,
      messages: [{ role: 'user', content: 'think hard' }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    },
  },
});

writeFixture('openrouter-deepseek-explicit-none-thinking', {
  kind: 'ai_chat',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4',
  service_options: { thinkingTokenBudget: 'none' },
  request: {
    chat_prompt: [{ role: 'user', content: 'answer directly' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_openrouter_none', 'deepseek/deepseek-v4'),
  ],
  expected_output: compatibleExpectedOutput(
    'openrouter',
    'chatcmpl_openrouter_none',
    'deepseek/deepseek-v4'
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    json: {
      model: 'deepseek/deepseek-v4',
      messages: [{ role: 'user', content: 'answer directly' }],
      reasoning: { effort: 'none' },
    },
  },
});

writeFixture('openai-chat-ignores-deepseek-reasoning-content', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT56,
  request: {
    chat_prompt: [
      { role: 'user', content: 'Continue.' },
      {
        role: 'assistant',
        content: 'Previous answer.',
        thought: 'DeepSeek-only trace.',
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'chatcmpl_openai_reasoning_extension',
        object: 'chat.completion',
        model: AxAIOpenAIModel.GPT56,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'done',
              reasoning_content: 'provider-private reasoning',
            },
            finish_reason: 'stop',
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: '0',
        content: 'done',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'chatcmpl_openai_reasoning_extension',
    model_usage: null,
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    json: {
      model: AxAIOpenAIModel.GPT56,
      messages: [
        { role: 'user', content: 'Continue.' },
        { role: 'assistant', content: 'Previous answer.' },
      ],
    },
  },
});

writeFixture('deepseek-openai-compatible-reasoning-tool-loop', {
  kind: 'ai_chat',
  provider: 'deepseek',
  model: deepseekDefaultModel,
  request: {
    chat_prompt: [
      { role: 'user', content: 'Continue the warehouse lookup.' },
      {
        role: 'assistant',
        thought: 'Use the warehouse query.',
        functionCalls: [
          {
            id: 'call-0',
            type: 'function',
            function: { name: 'query', params: { region: 'North' } },
          },
        ],
      },
      {
        role: 'function',
        functionId: 'call-0',
        result: '{"ok":true}',
      },
    ],
    functions: [
      { name: 'query', description: 'Query warehouse', parameters: {} },
    ],
    model_config: { stream: false, thinkingTokenBudget: 'high' },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'chatcmpl_deepseek_reasoning',
        object: 'chat.completion',
        model: deepseekDefaultModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'Use the warehouse query.',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'query',
                    arguments: '{"region":"East"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: '0',
        content: null,
        thought: 'Use the warehouse query.',
        thought_blocks: [
          { data: 'Use the warehouse query.', encrypted: false },
        ],
        function_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'query',
              params: { region: 'East' },
            },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    remote_id: 'chatcmpl_deepseek_reasoning',
    model_usage: null,
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.deepseek.com/chat/completions',
    json: {
      model: deepseekDefaultModel,
      messages: [
        { role: 'user', content: 'Continue the warehouse lookup.' },
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'Use the warehouse query.',
          tool_calls: [
            {
              id: 'call-0',
              type: 'function',
              function: { name: 'query', arguments: '{"region":"North"}' },
            },
          ],
        },
        {
          role: 'tool',
          content: '{"ok":true}',
          tool_call_id: 'call-0',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'query',
            description: 'Query warehouse',
          },
        },
      ],
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    },
  },
});

writeFixture('deepseek-openai-compatible-streaming-reasoning', {
  kind: 'ai_stream',
  provider: 'deepseek',
  model: deepseekDefaultModel,
  request: {
    chat_prompt: [{ role: 'user', content: 'Stream the plan.' }],
    model_config: { thinkingTokenBudget: 'medium' },
  },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body:
        `data: {"id":"chatcmpl_deepseek_stream","model":"${deepseekDefaultModel}","choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning_content":"plan"},"finish_reason":null}]}\n\n` +
        `data: {"id":"chatcmpl_deepseek_stream","model":"${deepseekDefaultModel}","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n` +
        'data: [DONE]\n\n',
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: '0',
          content: null,
          thought: 'plan',
          thought_blocks: [{ data: 'plan', encrypted: false }],
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'chatcmpl_deepseek_stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: 'done',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'chatcmpl_deepseek_stream',
      model_usage: null,
    },
  ],
});

writeFixture('deepseek-responses-reasoning-tool-loop', {
  kind: 'ai_chat',
  provider: 'deepseek-responses',
  model: deepseekResponsesDefaultModel,
  request: {
    chat_prompt: [
      { role: 'user', content: 'Continue the warehouse lookup.' },
      {
        role: 'assistant',
        thought: 'Use the warehouse query.',
        functionCalls: [
          {
            id: 'call-0',
            type: 'function',
            function: { name: 'query', params: { region: 'North' } },
          },
        ],
      },
      {
        role: 'function',
        functionId: 'call-0',
        result: '{"ok":true}',
      },
    ],
    functions: [
      { name: 'query', description: 'Query warehouse', parameters: {} },
    ],
    model_config: { stream: false, thinkingTokenBudget: 'high' },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'resp_deepseek_responses',
        model: deepseekResponsesDefaultModel,
        output: [
          {
            id: 'reasoning-1',
            type: 'reasoning',
            content: 'Use the warehouse query.',
            status: 'completed',
          },
          {
            id: 'item-1',
            call_id: 'call-1',
            type: 'function_call',
            name: 'query',
            arguments: '{"region":"East"}',
            status: 'completed',
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'item-1',
        content: '',
        thought: 'Use the warehouse query.',
        thought_blocks: [
          { data: 'Use the warehouse query.', encrypted: false },
        ],
        function_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'query',
              params: { region: 'East' },
            },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    remote_id: 'resp_deepseek_responses',
    model_usage: {
      ai: 'deepseek-responses',
      model: deepseekResponsesDefaultModel,
      tokens: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        reasoning_tokens: 2,
      },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.deepseek.com/responses',
    json: {
      model: deepseekResponsesDefaultModel,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Continue the warehouse lookup.' },
          ],
        },
        { type: 'reasoning', content: 'Use the warehouse query.' },
        {
          type: 'function_call',
          call_id: 'call-0',
          name: 'query',
          arguments: '{"region":"North"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call-0',
          output: '{"ok":true}',
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'query',
          description: 'Query warehouse',
          parameters: {},
        },
      ],
      tool_choice: 'auto',
      reasoning: { effort: 'high' },
      stream: false,
    },
  },
});

writeFixture('deepseek-responses-streaming-reasoning-tool', {
  kind: 'ai_stream',
  provider: 'deepseek-responses',
  model: deepseekResponsesDefaultModel,
  request: {
    chat_prompt: [{ role: 'user', content: 'Stream the lookup plan.' }],
    model_config: { thinkingTokenBudget: 'medium' },
  },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body:
        'data: {"type":"response.reasoning_text.delta","response_id":"resp_deepseek_stream","item_id":"reasoning-1","delta":"plan"}\n\n' +
        'data: {"type":"response.function_call_arguments.delta","response_id":"resp_deepseek_stream","item_id":"call-1","delta":"{\\"region\\":\\"East\\"}"}\n\n' +
        `data: {"type":"response.completed","response":{"id":"resp_deepseek_stream","model":"${deepseekResponsesDefaultModel}","usage":{"input_tokens":4,"output_tokens":3,"total_tokens":7,"output_tokens_details":{"reasoning_tokens":1}}}}\n\n` +
        'data: [DONE]\n\n',
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: 'reasoning-1',
          content: '',
          function_calls: [],
          finish_reason: null,
          thought: 'plan',
          thought_blocks: [{ data: 'plan', encrypted: false }],
        },
      ],
      remote_id: 'resp_deepseek_stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: 'call-1',
          content: '',
          finish_reason: 'function_call',
          function_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: null, params: '{"region":"East"}' },
            },
          ],
        },
      ],
      remote_id: 'resp_deepseek_stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'resp_deepseek_stream',
      model_usage: {
        ai: 'deepseek-responses',
        model: deepseekResponsesDefaultModel,
        tokens: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
          reasoning_tokens: 1,
        },
      },
    },
  ],
  expected_transport_request: {
    url: 'https://api.deepseek.com/responses',
    json: {
      model: deepseekResponsesDefaultModel,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Stream the lookup plan.' }],
        },
      ],
      reasoning: { effort: 'high' },
      stream: true,
    },
  },
});

writeFixture('mistral-openai-compatible-chat', {
  kind: 'ai_chat',
  provider: 'mistral',
  model: mistralDefaultModel,
  request: {
    chat_prompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image', image: 'aW1hZ2U=', mimeType: 'image/png' },
        ],
      },
    ],
    model_config: { stream: false, maxTokens: 48 },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_mistral', mistralDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'mistral',
    'chatcmpl_mistral',
    mistralDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.mistral.ai/v1/chat/completions',
    json: {
      model: mistralDefaultModel,
      max_tokens: 48,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('reka-openai-compatible-chat', {
  kind: 'ai_chat',
  provider: 'reka',
  model: rekaDefaultModel,
  request: {
    chat_prompt: [{ role: 'user', content: 'hello reka' }],
    model_config: { stream: false },
  },
  transport_responses: [compatibleResponse('chatcmpl_reka', rekaDefaultModel)],
  expected_output: compatibleExpectedOutput(
    'reka',
    'chatcmpl_reka',
    rekaDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.reka.ai/v1/chat/completions',
    json: {
      model: rekaDefaultModel,
      messages: [{ role: 'user', content: 'hello reka' }],
    },
  },
});

writeFixture('cohere-openai-compatible-chat', {
  kind: 'ai_chat',
  provider: 'cohere',
  model: cohereDefaultModel,
  request: {
    chat_prompt: [{ role: 'user', content: 'hello cohere' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_cohere', cohereDefaultModel),
  ],
  expected_output: compatibleExpectedOutput(
    'cohere',
    'chatcmpl_cohere',
    cohereDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.cohere.ai/compatibility/v1/chat/completions',
    json: {
      model: cohereDefaultModel,
      messages: [{ role: 'user', content: 'hello cohere' }],
    },
  },
});

writeFixture('grok-openai-compatible-chat', {
  kind: 'ai_chat',
  provider: 'grok',
  model: grokDefaultModel,
  request: {
    chat_prompt: [{ role: 'user', content: 'hello grok' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'medium',
      presencePenalty: 0.5,
      frequencyPenalty: 0.5,
      stopSequences: ['END'],
      searchParameters: {
        mode: 'auto',
        returnCitations: true,
        maxSearchResults: 3,
        sources: [{ type: 'web', country: 'US', safeSearch: true }],
      },
    },
  },
  transport_responses: [compatibleResponse('chatcmpl_grok', grokDefaultModel)],
  expected_output: compatibleExpectedOutput(
    'grok',
    'chatcmpl_grok',
    grokDefaultModel
  ),
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.x.ai/v1/chat/completions',
    json: {
      model: grokDefaultModel,
      messages: [{ role: 'user', content: 'hello grok' }],
      reasoning_effort: 'medium',
      search_parameters: {
        mode: 'auto',
        return_citations: true,
        max_search_results: 3,
        sources: [{ type: 'web', country: 'US', safe_search: true }],
      },
    },
  },
});

const openAIReasoningBudgets = [
  'minimal',
  'low',
  'medium',
  'high',
  'highest',
  'none',
] as const;
const openAIReasoningModels = [
  'gpt-5.6',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const;

for (const [index, budget] of openAIReasoningBudgets.entries()) {
  const model = openAIReasoningModels[index % openAIReasoningModels.length]!;
  const chatEffort = axResolveOpenAIChatReasoningEffort(model, budget);
  const responsesEffort = axResolveOpenAIResponsesReasoningEffort(
    model,
    budget
  );
  writeFixture(`openai-gpt-5-6-chat-reasoning-${budget}`, {
    kind: 'ai_chat',
    provider: 'openai',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'reason' }],
      model_config: {
        stream: false,
        reasoningEffort: 'xhigh',
        thinkingTokenBudget: budget,
      },
    },
    transport_responses: [compatibleResponse(`chat_${budget}`, model)],
    expected_transport_request: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      json: {
        model,
        messages: [{ role: 'user', content: 'reason' }],
        reasoning_effort: chatEffort,
      },
    },
  });

  writeFixture(`openai-gpt-5-6-responses-reasoning-${budget}`, {
    kind: 'ai_chat',
    provider: 'openai-responses',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'reason' }],
      model_config: {
        stream: false,
        reasoning: { effort: 'xhigh', summary: 'auto' },
        thinkingTokenBudget: budget,
      },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          id: `resp_${budget}`,
          model,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          output: [
            {
              id: `msg_${budget}`,
              type: 'message',
              content: [{ type: 'output_text', text: 'ok', annotations: [] }],
            },
          ],
        },
      },
    ],
    expected_transport_request: {
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      json: {
        model,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'reason' }],
          },
        ],
        reasoning:
          responsesEffort === 'none'
            ? { effort: responsesEffort }
            : { effort: responsesEffort, summary: 'auto' },
        stream: false,
      },
    },
    ...(responsesEffort === 'none'
      ? { expected_transport_json_absent: ['reasoning.summary'] }
      : {}),
  });
}

writeFixture('openai-legacy-reasoning-control', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-5.5',
  request: {
    chat_prompt: [{ role: 'user', content: 'reason' }],
    model_config: { stream: false, thinkingTokenBudget: 'low' },
  },
  transport_responses: [compatibleResponse('chat_legacy', 'gpt-5.5')],
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    json: {
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'reason' }],
      reasoning_effort: axResolveOpenAIChatReasoningEffort('gpt-5.5', 'low'),
    },
  },
});

writeFixture('openai-legacy-reasoning-none-control', {
  kind: 'ai_chat',
  provider: 'openai-responses',
  model: 'gpt-5.5',
  request: {
    chat_prompt: [{ role: 'user', content: 'reason' }],
    model_config: {
      stream: false,
      reasoning: { effort: 'high', summary: 'auto' },
      thinkingTokenBudget: 'none',
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'resp_legacy_none',
        model: 'gpt-5.5',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        output: [
          {
            id: 'msg_legacy_none',
            type: 'message',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
      },
    },
  ],
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/responses',
    json: {
      model: 'gpt-5.5',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'reason' }],
        },
      ],
      stream: false,
    },
  },
  expected_transport_json_absent: ['reasoning'],
});

writeFixture('responses-simple-chat', {
  kind: 'ai_chat',
  provider: 'openai-responses',
  request: {
    chat_prompt: [
      { role: 'system', content: 'Answer briefly.' },
      { role: 'user', content: 'What is Ax?' },
    ],
    model_config: {
      stream: false,
      temperature: 0.2,
      maxTokens: 64,
      reasoning: { effort: 'low' },
      include: ['file_search_call.results'],
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'resp_1',
        model: responsesDefaultModel,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        output: [
          {
            id: 'msg_1',
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Ax is portable.',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://axllm.dev',
                    title: 'Ax',
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_1',
        content: 'Ax is portable.',
        citations: [{ url: 'https://axllm.dev', title: 'Ax' }],
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'resp_1',
    model_usage: {
      ai: 'openai-responses',
      model: responsesDefaultModel,
      tokens: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/responses',
    json: {
      model: responsesDefaultModel,
      instructions: 'Answer briefly.',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'What is Ax?' }],
        },
      ],
      stream: false,
      temperature: 0.2,
      max_output_tokens: 64,
      reasoning: { effort: 'low' },
      include: ['file_search_call.results'],
    },
  },
});

writeFixture('responses-tool-call', {
  kind: 'ai_chat',
  provider: 'openai-responses',
  request: {
    chat_prompt: [{ role: 'user', content: 'Search docs' }],
    functions: [
      {
        name: 'search',
        description: 'Search docs',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
    function_call: 'auto',
    response_format: {
      type: 'json_schema',
      schema: {
        name: 'search_result',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    },
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'resp_tool',
        model: responsesDefaultModel,
        output: [
          {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'search',
            arguments: '{"query":"Search docs"}',
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'fc_1',
        content: '',
        function_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search', params: { query: 'Search docs' } },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    remote_id: 'resp_tool',
    model_usage: null,
  },
  expected_transport_request: {
    json: {
      tools: [
        {
          type: 'function',
          name: 'search',
          description: 'Search docs',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      tool_choice: 'auto',
      text: {
        format: {
          type: 'json_schema',
          json_schema: {
            name: 'search_result',
            schema: {
              type: 'object',
              properties: { answer: { type: 'string' } },
              required: ['answer'],
            },
          },
        },
      },
    },
  },
});

writeFixture('responses-forced-function-tool-choice', {
  kind: 'ai_chat',
  provider: 'openai-responses',
  request: {
    chat_prompt: [{ role: 'user', content: 'Search docs' }],
    functions: [
      {
        name: 'search',
        description: 'Search docs',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
    function_call: {
      type: 'function',
      function: { name: 'search' },
    },
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'resp_forced_tool',
        model: responsesDefaultModel,
        output: [
          {
            id: 'fc_forced',
            type: 'function_call',
            call_id: 'call_forced',
            name: 'search',
            arguments: '{"query":"Search docs"}',
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'fc_forced',
        content: '',
        function_calls: [
          {
            id: 'call_forced',
            type: 'function',
            function: { name: 'search', params: { query: 'Search docs' } },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    remote_id: 'resp_forced_tool',
    model_usage: null,
  },
  expected_transport_request: {
    json: {
      tools: [
        {
          type: 'function',
          name: 'search',
          description: 'Search docs',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      tool_choice: { type: 'function', name: 'search' },
    },
  },
  expected_transport_json_absent: ['tool_choice.function'],
});

writeFixture('responses-streaming-text', {
  kind: 'ai_stream',
  provider: 'openai-responses',
  request: {
    chat_prompt: [{ role: 'user', content: 'stream' }],
  },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body:
        'data: {"type":"response.output_text.delta","response_id":"resp_stream","item_id":"msg_1","delta":"hel"}\n\n' +
        'data: {"type":"response.output_text.delta","response_id":"resp_stream","item_id":"msg_1","delta":"lo"}\n\n' +
        `data: {"type":"response.completed","response":{"id":"resp_stream","model":"${responsesDefaultModel}","usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}\n\n` +
        'data: [DONE]\n\n',
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: 'msg_1',
          content: 'hel',
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'resp_stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: 'msg_1',
          content: 'lo',
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'resp_stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'resp_stream',
      model_usage: {
        ai: 'openai-responses',
        model: responsesDefaultModel,
        tokens: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      },
    },
  ],
  expected_transport_request: {
    url: 'https://api.openai.com/v1/responses',
    json: {
      stream: true,
    },
  },
});

writeFixture('responses-audio-input-request', {
  kind: 'ai_chat',
  provider: 'openai-responses',
  request: {
    chat_prompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this' },
          { type: 'audio', data: 'UklGRg==', format: 'wav' },
        ],
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'resp_audio',
        model: responsesDefaultModel,
        output: [
          {
            id: 'msg_audio',
            type: 'message',
            content: [{ type: 'output_text', text: 'Heard it.' }],
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_audio',
        content: 'Heard it.',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'resp_audio',
    model_usage: null,
  },
  expected_transport_request: {
    json: {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Transcribe this' },
            {
              type: 'input_audio',
              input_audio: { data: 'UklGRg==', format: 'wav' },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('responses-transcribe', {
  kind: 'ai_transcribe',
  provider: 'openai-responses',
  request: {
    audio: 'base64-audio',
    model: 'whisper-1',
    format: 'json',
    language: 'en',
  },
  transport_responses: [
    {
      status: 200,
      json: { text: 'hello world', language: 'en', duration: 1.25 },
    },
  ],
  expected_output: { text: 'hello world', language: 'en', duration: 1.25 },
  expected_transport_request: {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    data: {
      file: 'base64-audio',
      model: 'whisper-1',
      response_format: 'json',
      language: 'en',
    },
  },
});

writeFixture('responses-speak', {
  kind: 'ai_speak',
  provider: 'openai-responses',
  request: { text: 'hello', voice: 'alloy', format: 'mp3' },
  transport_responses: [{ status: 200, json: { audio: 'base64-speech' } }],
  expected_output: { audio: 'base64-speech', format: 'mp3' },
  expected_transport_request: {
    url: 'https://api.openai.com/v1/audio/speech',
    json: {
      model: 'tts-1',
      input: 'hello',
      voice: 'alloy',
      response_format: 'mp3',
    },
  },
});

writeFixture('responses-realtime-event', {
  kind: 'ai_realtime',
  provider: 'openai-responses',
  events: [
    { type: 'response.text.delta', id: 'rt_1', item_id: 'item_1', delta: 'hi' },
    {
      type: 'response.done',
      response: {
        id: 'rt_resp',
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      },
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: 'item_1',
          content: 'hi',
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'rt_1',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'rt_resp',
      model_usage: {
        ai: 'openai-responses',
        model: responsesDefaultModel,
        tokens: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      },
    },
  ],
});

writeFixture('responses-realtime-audio-grammar-reuse', {
  kind: 'ai_realtime',
  provider: 'openai-responses',
  request: {
    model: responsesDefaultModel,
    chat_prompt: [
      { role: 'system', content: 'Speak briefly.' },
      { role: 'user', content: 'Say hi.' },
    ],
    audio: {
      output: { voice: 'alloy', sampleRate: 24000 },
      input: { sampleRate: 24000 },
    },
  },
  expected_setup: {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: responsesDefaultModel,
      output_modalities: ['audio'],
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 } },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'alloy' },
      },
      instructions: 'Speak briefly.',
    },
  },
  expected_input: [
    {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Say hi.' }],
      },
    },
    { type: 'response.create', response: { output_modalities: ['audio'] } },
  ],
  events: [],
  expected_output: [],
});

writeFixture('meta-responses-reasoning-image-replay', {
  kind: 'ai_chat',
  provider: 'meta',
  model: 'muse-image-1.0',
  request: {
    model: 'muse-image-1.0',
    chat_prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Paint a lighthouse', cache: true }],
      },
      {
        role: 'assistant',
        content: 'First draft',
        phase: 'final_answer',
        thought_blocks: [
          { data: 'Checking style', phase: 'commentary', encrypted: false },
          {
            id: 'reasoning-old',
            data: 'Kept the composition',
            summary: 'Kept the composition',
            encrypted: true,
            encrypted_content: 'opaque-old',
          },
        ],
        images: [
          { id: 'image-old', data: 'b2xkLWltYWdl', mime_type: 'image/png' },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'file',
            fileUri: 'https://example.com/reference.png',
            mimeType: 'image/png',
          },
        ],
      },
    ],
    model_config: {
      stream: false,
      imageGeneration: {
        size: '1024x1536',
        outputFormat: 'png',
        enableImageSearch: true,
      },
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'meta-image-response',
        model: 'muse-image-1.0',
        output: [
          {
            id: 'commentary-new',
            type: 'message',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'Refining light.' }],
          },
          {
            id: 'reasoning-new',
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'Adjusted sunset.' }],
            encrypted_content: 'opaque-new',
          },
          {
            id: 'final-new',
            type: 'message',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'Updated.' }],
          },
          {
            id: 'image-new',
            type: 'image_generation_call',
            result: 'bmV3LWltYWdl',
          },
        ],
      },
    },
  ],
  expected_transport_request: {
    url: 'https://api.meta.ai/v1/responses',
    json: {
      model: 'muse-image-1.0',
      store: false,
      tools: [
        {
          type: 'image_generation',
          size: '1024x1536',
          output_format: 'png',
          enable_image_search: true,
        },
      ],
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Paint a lighthouse',
            },
          ],
        },
        {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: 'Checking style' }],
        },
        {
          type: 'image_generation_call',
          id: 'image-old',
          status: 'completed',
          result: null,
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'First draft' }],
          phase: 'final_answer',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'https://example.com/reference.png',
              detail: 'auto',
            },
          ],
        },
      ],
    },
  },
  expected_output: {
    results: [
      {
        index: 0,
        id: 'image-new',
        content: 'Updated.',
        phase: 'final_answer',
        thought: 'Adjusted sunset.',
        thought_blocks: [
          {
            data: 'Refining light.',
            encrypted: false,
            id: 'commentary-new',
            phase: 'commentary',
          },
          {
            data: 'Adjusted sunset.',
            encrypted: true,
            id: 'reasoning-new',
            summary: 'Adjusted sunset.',
            encrypted_content: 'opaque-new',
          },
        ],
        images: [
          {
            id: 'image-new',
            data: 'bmV3LWltYWdl',
            mime_type: 'image/png',
          },
        ],
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'meta-image-response',
    model_usage: null,
  },
});

const metaParallelItems = ['one', 'two'].map((id) => ({
  type: 'function_call',
  id: `item-${id}`,
  call_id: `call-${id}`,
  name: 'lookup',
  arguments: JSON.stringify({ city: id }),
}));
const metaCall = (id: string, params: Json, name: Json = 'lookup'): Json => ({
  id: `call-${id}`,
  type: 'function',
  function: { name, params },
});
const metaDelta = (id: string, overrides: Record<string, Json> = {}): Json => ({
  results: [
    {
      index: 0,
      id,
      content: '',
      function_calls: [],
      finish_reason: null,
      ...overrides,
    },
  ],
  remote_id: 'meta-parallel',
  model_usage: null,
});
writeFixture('meta-responses-parallel-calls', {
  kind: 'ai_chat',
  provider: 'meta',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [{ role: 'user', content: 'Look up both cities' }],
    model_config: { stream: false },
  },
  transport_responses: [
    { status: 200, json: { id: 'meta-parallel', output: metaParallelItems } },
  ],
  expected_output: metaDelta('item-two', {
    function_calls: [
      metaCall('one', { city: 'one' }),
      metaCall('two', { city: 'two' }),
    ],
    finish_reason: 'function_call',
  }),
});
const metaParallelEvents: Json[] = [
  ...metaParallelItems.map((item) => ({
    type: 'response.output_item.added',
    response_id: 'meta-parallel',
    item: { ...item, arguments: '' },
  })),
  ...metaParallelItems.map((item) => ({
    type: 'response.function_call_arguments.delta',
    response_id: 'meta-parallel',
    item_id: item.id,
    delta: item.arguments,
  })),
  ...metaParallelItems.map((item) => ({
    type: 'response.output_item.done',
    response_id: 'meta-parallel',
    item,
  })),
  {
    type: 'response.output_text.delta',
    response_id: 'meta-parallel',
    item_id: 'message-final',
    delta: 'Done',
  },
  {
    type: 'response.output_item.done',
    response_id: 'meta-parallel',
    item: {
      type: 'message',
      id: 'message-final',
      phase: 'final_answer',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Done' }],
    },
  },
  { type: 'response.completed', response: { id: 'meta-parallel' } },
];
writeFixture('meta-responses-parallel-stream-replay', {
  kind: 'ai_stream',
  provider: 'meta',
  model: 'muse-spark-1.3',
  request: { chat_prompt: [{ role: 'user', content: 'Look up both cities' }] },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body: metaParallelEvents
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
    },
  ],
  expected_output: [
    ...['one', 'two'].map((id) =>
      metaDelta(`item-${id}`, {
        function_calls: [metaCall(id, '')],
        finish_reason: 'function_call',
      })
    ),
    ...['one', 'two'].map((id) =>
      metaDelta(`item-${id}`, {
        function_calls: [metaCall(id, JSON.stringify({ city: id }), null)],
        finish_reason: 'function_call',
      })
    ),
    ...['one', 'two'].map((id) =>
      metaDelta(`item-${id}`, { finish_reason: 'function_call' })
    ),
    metaDelta('message-final', { content: 'Done' }),
    metaDelta('message-final', {
      phase: 'final_answer',
      finish_reason: 'stop',
    }),
    metaDelta('0', { finish_reason: 'stop' }),
  ],
});
for (const payload of ['image', 'encrypted'] as const) {
  const image = payload === 'image';
  writeFixture(`meta-responses-${payload}-only-replay`, {
    kind: 'ai_chat',
    provider: 'meta',
    model: image ? 'muse-image-1.0' : 'muse-spark-1.3',
    request: {
      chat_prompt: [
        {
          role: 'assistant',
          ...(image
            ? {
                images: [
                  { id: 'image-old', data: 'AAAA', mime_type: 'image/webp' },
                ],
              }
            : {
                thought_blocks: [
                  {
                    id: 'reasoning-old',
                    data: '',
                    encrypted: true,
                    encrypted_content: 'opaque-old',
                  },
                ],
              }),
        },
        { role: 'user', content: 'Continue' },
      ],
      model_config: { stream: false },
    },
    transport_responses: [
      { status: 200, json: { id: 'meta-parallel', output: [] } },
    ],
    expected_transport_request: {
      json: {
        input: [
          image
            ? {
                type: 'image_generation_call',
                id: 'image-old',
                status: 'completed',
                result: null,
              }
            : {
                type: 'reasoning',
                id: 'reasoning-old',
                summary: [{ type: 'summary_text', text: '' }],
                encrypted_content: 'opaque-old',
              },
          { role: 'user', content: [{ type: 'input_text', text: 'Continue' }] },
        ],
      },
    },
    expected_output: metaDelta('0', { finish_reason: 'stop' }),
  });
}
for (const { suffix, part, input, error } of [
  {
    suffix: '16khz',
    part: { sampleRate: 16000, channels: 1 },
    input: {},
    error: '',
  },
  {
    suffix: 'stereo-rejected',
    part: { sampleRate: 16000, channels: 2 },
    input: {},
    error: 'requires mono PCM audio',
  },
  {
    suffix: 'rate-conflict-rejected',
    part: { sampleRate: 16000, channels: 1 },
    input: { sampleRate: 24000 },
    error: 'Conflicting realtime audio sample rates',
  },
]) {
  writeFixture(`meta-voice-item-metadata-${suffix}`, {
    kind: 'ai_realtime',
    provider: 'meta',
    model: 'muse-voice-transcribe-1.0',
    options: { apiKey: 'meta-key' },
    request: {
      model: 'muse-voice-transcribe-1.0',
      audio: { input },
      chat_prompt: [
        {
          role: 'user',
          content: [{ type: 'audio', format: 'pcm16', data: 'AAE=', ...part }],
        },
      ],
    },
    expected_setup: error
      ? {}
      : {
          model: 'muse-voice-transcribe-1.0',
          authorization: { accessToken: 'Bearer meta-key' },
          mode: 'PUSH_TO_TALK',
          audioEncoding: 'PCM_16KHZ',
        },
    ...(error
      ? { expected_error_contains: error }
      : {
          expected_input: [
            { type: 'binary', data: 'AAE=' },
            { type: 'endStream' },
          ],
        }),
  });
}

writeFixture('meta-responses-encrypted-replay', {
  kind: 'ai_chat',
  provider: 'meta',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [
      { role: 'user', content: 'Solve it' },
      {
        role: 'assistant',
        content: 'First answer',
        thought_blocks: [
          {
            id: 'reasoning-old',
            data: '',
            encrypted: true,
            encrypted_content: 'opaque-old',
          },
        ],
      },
      { role: 'user', content: 'Continue' },
    ],
    model_config: {
      stream: false,
      promptCacheKey: 'spark-session',
      promptCacheRetention: '24h',
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'meta-spark-response',
        model: 'muse-spark-1.3',
        output: [
          {
            id: 'reasoning-new',
            type: 'reasoning',
            encrypted_content: 'opaque-new',
          },
          {
            id: 'message-new',
            type: 'message',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        ],
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      },
    },
  ],
  expected_transport_request: {
    url: 'https://api.meta.ai/v1/responses',
    json: {
      model: 'muse-spark-1.3',
      store: false,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: 'spark-session',
      prompt_cache_retention: '24h',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'Solve it' }] },
        {
          type: 'reasoning',
          id: 'reasoning-old',
          summary: [{ type: 'summary_text', text: '' }],
          encrypted_content: 'opaque-old',
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'First answer' }],
        },
        { role: 'user', content: [{ type: 'input_text', text: 'Continue' }] },
      ],
    },
  },
  expected_output: {
    results: [
      {
        index: 0,
        id: 'message-new',
        content: 'Done.',
        phase: 'final_answer',
        thought_blocks: [
          {
            data: '',
            encrypted: true,
            id: 'reasoning-new',
            encrypted_content: 'opaque-new',
          },
        ],
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'meta-spark-response',
    model_usage: {
      ai: 'meta',
      model: 'muse-spark-1.3',
      tokens: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
  },
});

for (const [suffix, terminal] of [
  [
    'failed',
    {
      type: 'response.failed',
      response: {
        id: 'r1',
        error: { message: 'Provider failed while generating' },
      },
    },
  ],
  ['error', { type: 'error', message: 'Provider failed while generating' }],
] as const) {
  writeFixture(`meta-responses-stream-${suffix}`, {
    kind: 'ai_error',
    method: 'stream',
    provider: 'meta',
    model: 'muse-spark-1.3',
    request: { chat_prompt: [{ role: 'user', content: 'test' }] },
    options: { stream: true },
    transport_responses: [
      {
        status: 200,
        body: [
          {
            type: 'response.output_text.delta',
            item_id: 'msg1',
            delta: 'Answer: Done',
          },
          terminal,
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
      },
    ],
    expected_error_contains: 'Provider failed while generating',
    expected_error_type: 'AxAIServiceResponseError',
    expected_request_count: 1,
  });
}

writeFixture('meta-responses-stream-incomplete', {
  kind: 'ai_stream',
  provider: 'meta',
  model: 'muse-spark-1.3',
  request: { chat_prompt: [{ role: 'user', content: 'test' }] },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body: [
        {
          type: 'response.output_text.delta',
          item_id: 'msg1',
          response_id: 'r1',
          delta: 'Answer: Done',
        },
        {
          type: 'response.incomplete',
          response: {
            id: 'r1',
            incomplete_details: { reason: 'max_output_tokens' },
          },
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: 'msg1',
          content: 'Answer: Done',
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'r1',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'length',
        },
      ],
      remote_id: 'r1',
      model_usage: null,
    },
  ],
});

for (const provider of ['meta', 'meta-chat', 'meta-messages']) {
  const outputTool = {
    name: '__axOutput',
    description: 'Emit output',
    parameters: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
  };
  const otherTool = {
    name: 'lookup',
    description: 'Look up a fact',
    parameters: { type: 'object', properties: {} },
  };
  const response =
    provider === 'meta'
      ? {
          id: 'r1',
          output: [
            {
              type: 'message',
              id: 'm1',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Done' }],
            },
          ],
        }
      : provider === 'meta-chat'
        ? {
            id: 'r1',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Done' },
                finish_reason: 'stop',
              },
            ],
          }
        : {
            id: 'r1',
            content: [{ type: 'text', text: 'Done' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
  writeFixture(`${provider}-ax-output-tool-choice`, {
    kind: 'ai_chat',
    provider,
    model: 'muse-spark-1.3',
    request: {
      chat_prompt: [{ role: 'user', content: 'Return the structured output' }],
      functions: [otherTool, outputTool],
      function_call: { type: 'function', function: { name: '__axOutput' } },
      model_config: { stream: false },
    },
    options: { functionCallSource: 'ax' },
    transport_responses: [{ status: 200, json: response }],
    expected_transport_request: {
      json: {
        tool_choice:
          provider === 'meta-messages' ? { type: 'any' } : 'required',
        tools:
          provider === 'meta-messages'
            ? [
                {
                  name: '__axOutput',
                  description: 'Emit output',
                  input_schema: outputTool.parameters,
                },
              ]
            : provider === 'meta-chat'
              ? [
                  {
                    type: 'function',
                    function: {
                      name: '__axOutput',
                      description: 'Emit output',
                      parameters: outputTool.parameters,
                    },
                  },
                ]
              : [
                  {
                    type: 'function',
                    name: '__axOutput',
                    description: 'Emit output',
                    parameters: outputTool.parameters,
                  },
                ],
      },
    },
    expected_request_count: 1,
  });
  writeFixture(`${provider}-caller-ax-output-tool-rejected`, {
    kind: 'ai_chat',
    provider,
    model: 'muse-spark-1.3',
    request: {
      chat_prompt: [{ role: 'user', content: 'Force a named tool' }],
      functions: [outputTool],
      function_call: { type: 'function', function: { name: '__axOutput' } },
      model_config: { stream: false },
    },
    expected_error_contains: 'does not support explicitly named tool choices',
  });
}

writeFixture('meta-responses-streaming-reasoning', {
  kind: 'ai_stream',
  provider: 'meta',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [{ role: 'user', content: 'Think' }],
    model_config: { thinkingTokenBudget: 'highest' },
  },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body:
        'data: {"type":"response.reasoning_summary_text.delta","response_id":"meta-stream","item_id":"reasoning-1","delta":"Checked"}\n\n' +
        'data: {"type":"response.reasoning_summary_text.done","response_id":"meta-stream","item_id":"reasoning-1","text":"Checked facts"}\n\n' +
        'data: {"type":"response.output_item.done","response_id":"meta-stream","item":{"type":"reasoning","id":"reasoning-1","summary":[{"type":"summary_text","text":"Checked facts"}],"encrypted_content":"opaque-stream"}}\n\n' +
        'data: {"type":"response.output_text.delta","response_id":"meta-stream","item_id":"message-1","delta":"Done"}\n\n' +
        'data: {"type":"response.completed","response":{"id":"meta-stream","model":"muse-spark-1.3","usage":{"input_tokens":2,"output_tokens":2,"total_tokens":4}}}\n\n' +
        'data: [DONE]\n\n',
    },
  ],
  expected_transport_request: {
    url: 'https://api.meta.ai/v1/responses',
    json: {
      store: false,
      reasoning: { effort: 'xhigh', summary: 'auto' },
      stream: true,
    },
  },
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: 'reasoning-1',
          content: '',
          thought: 'Checked',
          thought_blocks: [
            { id: 'reasoning-1', data: 'Checked', encrypted: false },
          ],
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'meta-stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: 'reasoning-1',
          content: '',
          thought: 'Checked facts',
          thought_blocks: [
            {
              id: 'reasoning-1',
              data: 'Checked facts',
              summary: 'Checked facts',
              encrypted: false,
            },
          ],
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'meta-stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: 'reasoning-1',
          content: '',
          thought: 'Checked facts',
          thought_blocks: [
            {
              id: 'reasoning-1',
              data: 'Checked facts',
              summary: 'Checked facts',
              encrypted: true,
              encrypted_content: 'opaque-stream',
            },
          ],
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'meta-stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: 'message-1',
          content: 'Done',
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'meta-stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'meta-stream',
      model_usage: {
        ai: 'meta',
        model: 'muse-spark-1.3',
        tokens: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      },
    },
  ],
});

for (const format of [undefined, 'png', 'jpeg'] as const) {
  const name = `meta-image-format-${format ?? 'default'}`;
  writeFixture(name, {
    kind: 'ai_chat',
    provider: 'meta',
    model: 'muse-image-1.0',
    request: {
      chat_prompt: [{ role: 'user', content: 'Draw a boat' }],
      model_config: {
        stream: false,
        ...(format ? { imageGeneration: { outputFormat: format } } : {}),
      },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          id: name,
          model: 'muse-image-1.0',
          output: [
            { type: 'image_generation_call', id: 'base64', result: 'AAAA' },
            {
              type: 'image_generation_call',
              id: 'url',
              result: 'https://example.com/image',
            },
            {
              type: 'image_generation_call',
              id: 'data-url',
              result: 'data:image/png;base64,BBBB',
            },
          ],
        },
      },
    ],
    expected_transport_request: {
      json: {
        tools: [{ type: 'image_generation', output_format: format ?? 'webp' }],
      },
    },
    expected_output: {
      results: [
        {
          index: 0,
          id: 'data-url',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
          images: [
            {
              id: 'base64',
              data: 'AAAA',
              mime_type: `image/${format ?? 'webp'}`,
            },
            {
              id: 'url',
              url: 'https://example.com/image',
              mime_type: `image/${format ?? 'webp'}`,
            },
            { id: 'data-url', data: 'BBBB', mime_type: 'image/png' },
          ],
        },
      ],
      remote_id: name,
      model_usage: null,
    },
  });
}

writeFixture('meta-image-streaming-partial', {
  kind: 'ai_stream',
  provider: 'meta',
  model: 'muse-image-1.0',
  request: {
    chat_prompt: [{ role: 'user', content: 'Draw a boat' }],
    model_config: { stream: true, imageGeneration: { outputFormat: 'jpeg' } },
  },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body:
        'data: {"type":"response.image_generation_call.partial_image","response_id":"image-stream","item_id":"image-1","partial_image_index":0,"partial_image_b64":"AAAA"}\n\n' +
        'data: {"type":"response.output_item.done","response_id":"image-stream","item":{"type":"image_generation_call","id":"image-1","status":"completed","result":"BBBB"}}\n\n' +
        'data: {"type":"response.completed","response":{"id":"image-stream","model":"muse-image-1.0","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n' +
        'data: [DONE]\n\n',
    },
  ],
  expected_transport_request: {
    json: {
      store: false,
      tools: [{ type: 'image_generation', output_format: 'jpeg' }],
      stream: true,
    },
  },
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: 'image-1',
          content: '',
          images: [
            {
              id: 'image-1',
              data: 'AAAA',
              mime_type: 'image/jpeg',
              is_delta: true,
            },
          ],
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'image-stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: 'image-1',
          content: '',
          images: [{ id: 'image-1', data: 'BBBB', mime_type: 'image/jpeg' }],
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'image-stream',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'image-stream',
      model_usage: {
        ai: 'meta',
        model: 'muse-image-1.0',
        tokens: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    },
  ],
});

writeFixture('meta-image-audio-rejected', {
  kind: 'ai_chat',
  provider: 'meta',
  model: 'muse-image-1.0',
  request: {
    chat_prompt: [
      {
        role: 'user',
        content: [{ type: 'audio', data: 'AAAA', format: 'wav' }],
      },
    ],
    model_config: { stream: false },
  },
  expected_error_contains: 'does not support input_audio input',
});

writeFixture('meta-chat-reasoning', {
  kind: 'ai_chat',
  provider: 'meta-chat',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [{ role: 'user', content: 'Reason briefly' }],
    model_config: { stream: false, thinkingTokenBudget: 'highest' },
  },
  transport_responses: [compatibleResponse('meta_chat', 'muse-spark-1.3')],
  expected_transport_request: {
    url: 'https://api.meta.ai/v1/chat/completions',
    json: { reasoning_effort: 'xhigh' },
  },
});

writeFixture('meta-responses-multimodal', {
  kind: 'ai_chat',
  provider: 'meta',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe these' },
          {
            type: 'file',
            fileUri: 'https://example.com/image.png',
            mimeType: 'image/png',
          },
          { type: 'audio', data: 'AAAA', format: 'wav' },
          {
            type: 'file',
            fileUri: 'https://example.com/brief.pdf',
            mimeType: 'application/pdf',
          },
          {
            type: 'file',
            fileUri: 'https://example.com/clip.mp4',
            mimeType: 'video/mp4',
          },
        ],
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'meta-mm',
        model: 'muse-spark-1.3',
        output: [
          {
            id: 'message-mm',
            type: 'message',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
      },
    },
  ],
  expected_transport_request: {
    json: {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe these' },
            {
              type: 'input_image',
              image_url: 'https://example.com/image.png',
              detail: 'auto',
            },
            {
              type: 'input_audio',
              input_audio: { data: 'AAAA', format: 'wav' },
            },
            { type: 'input_file', file_url: 'https://example.com/brief.pdf' },
            { type: 'input_video', video_url: 'https://example.com/clip.mp4' },
          ],
        },
      ],
    },
  },
});

writeFixture('meta-chat-multimodal', {
  kind: 'ai_chat',
  provider: 'meta-chat',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe these' },
          {
            type: 'file',
            fileUri: 'https://example.com/image.png',
            mimeType: 'image/png',
          },
          { type: 'audio', data: 'AAAA', format: 'wav' },
          {
            type: 'file',
            fileUri: 'https://example.com/brief.pdf',
            mimeType: 'application/pdf',
          },
          {
            type: 'file',
            fileUri: 'https://example.com/clip.mp4',
            mimeType: 'video/mp4',
          },
        ],
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [compatibleResponse('meta-chat-mm', 'muse-spark-1.3')],
  expected_transport_request: {
    json: {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe these' },
            {
              type: 'image_url',
              image_url: {
                url: 'https://example.com/image.png',
                detail: 'auto',
              },
            },
            {
              type: 'input_audio',
              input_audio: { data: 'AAAA', format: 'wav' },
            },
            {
              type: 'file',
              file: { file_url: 'https://example.com/brief.pdf' },
            },
            {
              type: 'video_url',
              video_url: { url: 'https://example.com/clip.mp4' },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('meta-messages-reasoning', {
  kind: 'ai_chat',
  provider: 'meta-messages',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [
      {
        role: 'user',
        cache: true,
        content: [
          { type: 'audio', data: 'AAAA', format: 'wav' },
          {
            type: 'file',
            fileUri: 'https://example.com/brief.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      schema: {
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    },
    model_config: { stream: false, thinkingTokenBudget: 'highest' },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'meta_messages',
        type: 'message',
        model: 'muse-spark-1.3',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
  ],
  expected_transport_request: {
    url: 'https://api.meta.ai/v1/messages',
    json: {
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: {
        effort: 'xhigh',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'audio',
              source: { type: 'base64', media_type: 'audio/wav', data: 'AAAA' },
            },
            {
              type: 'document',
              source: { type: 'url', url: 'https://example.com/brief.pdf' },
            },
          ],
        },
      ],
    },
  },
  expected_transport_json_absent: [
    'reasoning_effort',
    'stop_sequences',
    'top_k',
  ],
});

writeFixture('meta-messages-multimodal', {
  kind: 'ai_chat',
  provider: 'meta-messages',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe these' },
          {
            type: 'file',
            fileUri: 'https://example.com/image.png',
            mimeType: 'image/png',
          },
          { type: 'audio', data: 'AAAA', format: 'wav' },
          {
            type: 'file',
            fileUri: 'https://example.com/brief.pdf',
            mimeType: 'application/pdf',
          },
          {
            type: 'file',
            fileUri: 'https://example.com/clip.mp4',
            mimeType: 'video/mp4',
          },
        ],
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'meta-messages-mm',
        model: 'muse-spark-1.3',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      },
    },
  ],
  expected_transport_request: {
    json: {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe these' },
            {
              type: 'image',
              source: { type: 'url', url: 'https://example.com/image.png' },
            },
            {
              type: 'audio',
              source: { type: 'base64', media_type: 'audio/wav', data: 'AAAA' },
            },
            {
              type: 'document',
              source: { type: 'url', url: 'https://example.com/brief.pdf' },
            },
            {
              type: 'video',
              source: { type: 'url', url: 'https://example.com/clip.mp4' },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('meta-reasoning-none-rejected', {
  kind: 'ai_chat',
  provider: 'meta',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [{ role: 'user', content: 'Do not reason' }],
    model_config: { stream: false, thinkingTokenBudget: 'none' },
  },
  expected_error_contains: 'does not support reasoning level none',
});

writeFixture('meta-messages-tool-none', {
  kind: 'ai_chat',
  provider: 'meta-messages',
  model: 'muse-spark-1.3',
  request: {
    chat_prompt: [{ role: 'user', content: 'Do not use tools' }],
    functions: [
      {
        name: 'lookup',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ],
    function_call: 'none',
    model_config: { stream: false, thinkingTokenBudget: 'minimal' },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'meta-none',
        model: 'muse-spark-1.3',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      },
    },
  ],
  expected_transport_request: {
    json: {
      tool_choice: { type: 'none' },
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'low' },
    },
  },
  expected_transport_json_absent: [
    'reasoning_effort',
    'stop_sequences',
    'top_k',
  ],
});

for (const provider of ['meta', 'meta-chat', 'meta-messages']) {
  writeFixture(`${provider}-named-tool-rejected`, {
    kind: 'ai_chat',
    provider,
    model: 'muse-spark-1.3',
    request: {
      chat_prompt: [{ role: 'user', content: 'Force a tool' }],
      functions: [
        {
          name: 'lookup',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      ],
      function_call: { type: 'function', function: { name: 'lookup' } },
      model_config: { stream: false },
    },
    expected_error_contains: 'does not support explicitly named tool choices',
  });
}

writeFixture('meta-voice-transcribe', {
  kind: 'ai_transcribe',
  provider: 'meta',
  request: {
    audio: {
      data: 'UklGRg==',
      format: 'wav',
      mimeType: 'audio/wav',
      filename: 'voice.wav',
    },
    model: 'muse-voice-transcribe-1.0',
    mode: 'diarization',
    languageBias: ['en', 'es'],
    keywords: ['Ax'],
    partialMode: 'delta',
    emitAudioProgress: true,
    sessionId: 'caller-session',
  },
  transport_responses: [
    {
      status: 200,
      json: {
        sessionId: 'voice-session',
        transcript: 'Hello world',
        audioDurationMs: 2250,
        turns: [
          {
            turnId: 'turn-1',
            startMs: 250,
            endMs: 2250,
            transcript: 'Hello world',
            speaker: 'speaker-1',
          },
        ],
      },
    },
  ],
  expected_transport_request: {
    url: 'https://api.meta.ai/v1/asr/transcribe?sessionId=caller-session',
    data: {
      audio: {
        data: 'UklGRg==',
        format: 'wav',
        mimeType: 'audio/wav',
        filename: 'voice.wav',
      },
      request: JSON.stringify({
        audioEncoding: 'WAV',
        emitAudioProgress: true,
        keywords: ['Ax'],
        languageBias: ['en', 'es'],
        mode: 'DIARIZATION',
        model: 'muse-voice-transcribe-1.0',
        partialMode: 'DELTA',
      }),
    },
  },
  expected_output: {
    text: 'Hello world',
    duration: 2.25,
    session_id: 'voice-session',
    segments: [
      {
        id: 'turn-1',
        text: 'Hello world',
        start: 0.25,
        end: 2.25,
        speaker: 'speaker-1',
      },
    ],
  },
});

writeFixture('meta-voice-transcribe-sse', {
  kind: 'ai_transcribe',
  provider: 'meta',
  request: {
    model: 'muse-voice-transcribe-1.0',
    audio: { data: 'UklGRg==', format: 'wav', sampleRate: 16000, channels: 1 },
    partialMode: 'cumulative',
    emitAudioProgress: true,
  },
  transport_responses: [
    {
      status: 200,
      body:
        'data: {"type":"speechStart","turnId":"turn-1","audioProcessedMs":0}\n\n' +
        'data: {"type":"transcript","transcript":"Hello","audioProcessedMs":100}\n\n' +
        'data: {"type":"speaker","label":"speaker-1"}\n\n' +
        'data: {"type":"speechStart","turnId":"turn-2","audioProcessedMs":120}\n\n' +
        'data: {"type":"transcript","transcript":"Second","audioProcessedMs":200}\n\n' +
        'data: {"type":"speaker","label":"speaker-2"}\n\n' +
        'data: {"type":"speechComplete","turnId":"turn-1","transcript":"Hello world","audioProcessedMs":300}\n\n' +
        'data: {"type":"speechComplete","turnId":"turn-2","transcript":"Second turn","audioProcessedMs":400}\n\n' +
        'data: {"type":"audioProgress","sessionId":"voice-sse","audioProcessedMs":450}\n\n',
    },
  ],
  expected_transport_request: { headers: { Accept: 'text/event-stream' } },
  expected_output: {
    text: 'Hello world\nSecond turn',
    duration: 0.45,
    audio_processed_ms: 450,
    session_id: 'voice-sse',
    segments: [
      {
        id: 'turn-1',
        text: 'Hello world',
        start: 0,
        end: 0.3,
        speaker: 'speaker-1',
      },
      {
        id: 'turn-2',
        text: 'Second turn',
        start: 0.12,
        end: 0.4,
        speaker: 'speaker-2',
      },
    ],
  },
});

for (const [name, request, error] of [
  [
    'model',
    { model: 'muse-spark-1.3', audio: { data: 'AAAA', format: 'wav' } },
    'requires muse-voice-transcribe-1.0',
  ],
  [
    'format',
    {
      model: 'muse-voice-transcribe-1.0',
      audio: { data: 'AAAA', format: 'mp3' },
    },
    'requires WAV audio',
  ],
  [
    'rate',
    {
      model: 'muse-voice-transcribe-1.0',
      audio: { data: 'AAAA', format: 'wav', sampleRate: 44100 },
    },
    'requires 16000 Hz or 24000 Hz',
  ],
] as const) {
  writeFixture(`meta-voice-transcribe-invalid-${name}`, {
    kind: 'ai_unsupported',
    method: 'transcribe',
    provider: 'meta',
    request,
    expected_error_contains: error,
  });
}

const metaRealtimeDelta = (
  id: string,
  content: string,
  audioProcessedMs: number,
  name?: string,
  transcript?: string,
  isFinal = false
) => ({
  results: [
    {
      index: 0,
      id,
      content,
      ...(name ? { name } : {}),
      ...(transcript !== undefined
        ? { transcript: { text: transcript, is_final: isFinal } }
        : {}),
      audio_processed_ms: audioProcessedMs,
      function_calls: [],
      finish_reason: null,
    },
  ],
  model_usage: null,
});

writeFixture('meta-voice-realtime', {
  kind: 'ai_realtime',
  provider: 'meta',
  request: {
    model: 'muse-voice-transcribe-1.0',
    chat_prompt: [
      {
        role: 'user',
        content: [{ type: 'audio', data: 'AAE=', format: 'pcm16' }],
      },
    ],
    audio: { input: { sampleRate: 24000, channels: 1 } },
    model_config: {
      realtimeTranscription: {
        mode: 'diarization',
        languageBias: ['en'],
        keywords: ['Ax'],
        partialMode: 'cumulative',
        emitAudioProgress: true,
      },
    },
  },
  options: { apiKey: 'meta-key' },
  expected_setup: {
    model: 'muse-voice-transcribe-1.0',
    authorization: { accessToken: 'Bearer meta-key' },
    mode: 'DIARIZATION',
    languageBias: ['en'],
    keywords: ['Ax'],
    partialMode: 'CUMULATIVE',
    emitAudioProgress: true,
    audioEncoding: 'PCM_24KHZ',
  },
  expected_input: [{ type: 'binary', data: 'AAE=' }, { type: 'endStream' }],
  events: [
    { type: 'speechStart', turnId: 'turn-1', audioProcessedMs: 0 },
    { type: 'transcript', transcript: 'Hello', audioProcessedMs: 100 },
    { type: 'speaker', label: 'speaker-1', audioProcessedMs: 100 },
    { type: 'speechStart', turnId: 'turn-2', audioProcessedMs: 150 },
    { type: 'transcript', transcript: 'Second', audioProcessedMs: 200 },
    { type: 'speaker', label: 'speaker-2', audioProcessedMs: 200 },
    {
      type: 'speechComplete',
      turnId: 'turn-1',
      transcript: 'Hello world',
      audioProcessedMs: 300,
    },
    {
      type: 'speechComplete',
      turnId: 'turn-2',
      transcript: 'Second turn',
      audioProcessedMs: 400,
    },
    { type: 'audioProgress', audioProcessedMs: 400 },
  ],
  expected_output: [
    metaRealtimeDelta('turn-1', '', 0),
    metaRealtimeDelta('turn-1', '', 100, undefined, 'Hello'),
    metaRealtimeDelta('turn-1', '', 100, 'speaker-1'),
    metaRealtimeDelta('turn-2', '', 150),
    metaRealtimeDelta('turn-2', '', 200, undefined, 'Second'),
    metaRealtimeDelta('turn-2', '', 200, 'speaker-2'),
    metaRealtimeDelta(
      'turn-1',
      'Hello world',
      300,
      'speaker-1',
      'Hello world',
      true
    ),
    metaRealtimeDelta(
      'turn-2',
      'Second turn',
      400,
      'speaker-2',
      'Second turn',
      true
    ),
    metaRealtimeDelta('turn-2', '', 400, 'speaker-2'),
  ],
});

writeFixture('meta-voice-realtime-contract', {
  kind: 'ai_realtime',
  provider: 'meta',
  request: {
    model: 'muse-voice-transcribe-1.0',
    chat_prompt: [
      {
        role: 'user',
        content: [{ type: 'audio', data: 'AAE=', format: 'pcm16' }],
      },
    ],
    audio: { input: { sampleRate: 16000, channels: 1 } },
  },
  options: {
    apiKey: 'meta-key',
    sessionId: 'caller-session',
    realtimeTranscription: { zdrOverride: true },
  },
  expected_setup: {
    model: 'muse-voice-transcribe-1.0',
    authorization: { accessToken: 'Bearer meta-key' },
    mode: 'PUSH_TO_TALK',
    audioEncoding: 'PCM_16KHZ',
    zdrOverride: true,
  },
  expected_input: [{ type: 'binary', data: 'AAE=' }, { type: 'endStream' }],
  events: [
    { type: 'speechStart', turnId: 'turn-1', audioProcessedMs: 0 },
    {
      type: 'transcript',
      transcript: 'Hello',
      final: false,
      audioProcessedMs: 100,
    },
    { type: 'speaker', label: 'speaker-1', audioProcessedMs: 100 },
    { type: 'speechStart', turnId: 'turn-2', audioProcessedMs: 150 },
    {
      type: 'transcript',
      transcript: 'Second',
      final: false,
      audioProcessedMs: 200,
    },
    { type: 'speaker', label: 'speaker-2', audioProcessedMs: 200 },
    {
      type: 'speechComplete',
      turnId: 'turn-1',
      transcript: 'Hello world',
      audioProcessedMs: 300,
    },
    {
      type: 'speechComplete',
      turnId: 'turn-2',
      transcript: 'Second turn',
      audioProcessedMs: 400,
    },
    { type: 'audioProgress', audioProcessedMs: 400 },
  ],
  expected_output: [
    metaRealtimeDelta('turn-1', '', 0),
    metaRealtimeDelta('turn-1', '', 100, undefined, 'Hello'),
    metaRealtimeDelta('turn-1', '', 100, 'speaker-1'),
    metaRealtimeDelta('turn-2', '', 150),
    metaRealtimeDelta('turn-2', '', 200, undefined, 'Second'),
    metaRealtimeDelta('turn-2', '', 200, 'speaker-2'),
    metaRealtimeDelta(
      'turn-1',
      'Hello world',
      300,
      'speaker-1',
      'Hello world',
      true
    ),
    metaRealtimeDelta(
      'turn-2',
      'Second turn',
      400,
      'speaker-2',
      'Second turn',
      true
    ),
    metaRealtimeDelta('turn-2', '', 400, 'speaker-2'),
  ],
});

for (const partialMode of ['delta', 'cumulative']) {
  writeFixture(`meta-voice-transcribe-${partialMode}-final`, {
    kind: 'ai_transcribe',
    provider: 'meta',
    request: { audio: { data: 'AAE=', format: 'wav' }, partialMode },
    transport_responses: [
      {
        status: 200,
        body: [
          { type: 'transcript', transcript: 'Hello', final: false },
          {
            type: 'transcript',
            transcript: partialMode === 'delta' ? ' world' : 'Hello world',
            final: false,
          },
          { type: 'transcript', transcript: 'Hello world.', final: true },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
      },
    ],
    expected_output: {
      text: 'Hello world.',
      segments: [{ id: '0', text: 'Hello world.' }],
    },
  });
}

writeFixture('meta-voice-transcribe-overlap-order', {
  kind: 'ai_transcribe',
  provider: 'meta',
  request: {
    audio: { data: 'AAE=', format: 'wav' },
    partialMode: 'cumulative',
    mode: 'endpointing',
  },
  transport_responses: [
    {
      status: 200,
      body: [
        { type: 'speechStart', turnId: 'first', audioProcessedMs: 100 },
        { type: 'speechStart', turnId: 'second', audioProcessedMs: 200 },
        { type: 'speechComplete', turnId: 'second', transcript: 'Second.' },
        { type: 'speechComplete', turnId: 'first', transcript: 'First.' },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
    },
  ],
  expected_output: {
    text: 'First.\nSecond.',
    duration: 0.2,
    audio_processed_ms: 200,
    segments: [
      { id: 'first', text: 'First.', start: 0.1 },
      { id: 'second', text: 'Second.', start: 0.2 },
    ],
  },
});

writeFixture('meta-voice-realtime-corrections', {
  kind: 'ai_realtime',
  provider: 'meta',
  request: { model: 'muse-voice-transcribe-1.0' },
  events: [
    { type: 'speechStart', turnId: 'turn', audioProcessedMs: 0 },
    { type: 'transcript', transcript: 'I scream', audioProcessedMs: 100 },
    { type: 'transcript', transcript: 'Ice cream', audioProcessedMs: 200 },
    {
      type: 'speechComplete',
      turnId: 'turn',
      transcript: 'Ice cream.',
      audioProcessedMs: 300,
    },
  ],
  expected_output: [
    metaRealtimeDelta('turn', '', 0),
    metaRealtimeDelta('turn', '', 100, undefined, 'I scream'),
    metaRealtimeDelta('turn', '', 200, undefined, 'Ice cream'),
    metaRealtimeDelta('turn', 'Ice cream.', 300, undefined, 'Ice cream.', true),
  ],
});

writeFixture('meta-voice-realtime-overlap-final-order', {
  kind: 'ai_realtime',
  provider: 'meta',
  request: { model: 'muse-voice-transcribe-1.0' },
  events: [
    { type: 'speechStart', turnId: 1, audioProcessedMs: 100 },
    { type: 'speechStart', turnId: 2, audioProcessedMs: 200 },
    {
      type: 'speechComplete',
      turnId: 2,
      transcript: 'Second.',
      audioProcessedMs: 300,
    },
    {
      type: 'speechComplete',
      turnId: 1,
      transcript: 'First.',
      audioProcessedMs: 400,
    },
  ],
  expected_output: [
    metaRealtimeDelta('1', '', 100),
    metaRealtimeDelta('2', '', 200),
    metaRealtimeDelta('2', '', 300, undefined, 'Second.', true),
    {
      ...metaRealtimeDelta('1', 'First.', 400, undefined, 'First.', true),
      results: [
        ...metaRealtimeDelta('1', 'First.', 400, undefined, 'First.', true)
          .results,
        {
          index: 0,
          id: '2',
          content: 'Second.',
          transcript: { text: 'Second.', is_final: true },
          function_calls: [],
          finish_reason: null,
        },
      ],
    },
  ],
});

writeFixture('grok-realtime-audio-session-and-events', {
  kind: 'ai_realtime',
  provider: 'grok',
  model: grokVoiceDefaultModel,
  request: {
    model: grokVoiceDefaultModel,
    chat_prompt: [
      { role: 'system', content: 'You are a concise voice agent.' },
      { role: 'user', content: 'Say hello.' },
    ],
    audio: {
      output: { voice: 'eve', sampleRate: 24000 },
      input: { sampleRate: 24000 },
    },
  },
  expected_setup: {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: grokVoiceDefaultModel,
      output_modalities: ['audio'],
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 } },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'eve' },
      },
      instructions: 'You are a concise voice agent.',
    },
  },
  expected_input: [
    {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Say hello.' }],
      },
    },
    { type: 'response.create', response: { output_modalities: ['audio'] } },
  ],
  events: [
    {
      type: 'response.output_audio_transcript.delta',
      response_id: 'grok_rt',
      delta: 'hello ',
    },
    {
      type: 'response.output_audio.delta',
      response_id: 'grok_rt',
      delta: 'AQI=',
    },
    {
      type: 'response.done',
      response: {
        id: 'grok_rt',
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      },
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: 'grok_rt',
          content: 'hello ',
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'grok_rt',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: 'grok_rt',
          content: '',
          function_calls: [],
          finish_reason: null,
          audio: { data: 'AQI=', format: 'pcm16', is_delta: true },
        },
      ],
      remote_id: 'grok_rt',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'grok_rt',
      model_usage: {
        ai: 'grok',
        model: grokVoiceDefaultModel,
        tokens: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      },
    },
  ],
});

for (const { fixtureName, model, expectedThinkingConfig } of [
  {
    fixtureName: 'gemini-31-live-thinking-level',
    model: 'gemini-3.1-flash-live-preview',
    expectedThinkingConfig: {
      thinkingLevel: 'high',
      includeThoughts: true,
    },
  },
  {
    fixtureName: 'gemini-25-live-thinking-budget',
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    expectedThinkingConfig: {
      thinkingBudget: 10000,
      includeThoughts: true,
    },
  },
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_realtime',
    provider: 'google-gemini',
    model,
    request: {
      model,
      chat_prompt: [{ role: 'user', content: 'Answer with audio.' }],
      model_config: {
        thinkingTokenBudget: 'high',
        showThoughts: true,
      },
      audio: { output: { voice: 'Kore', transcript: true } },
    },
    expected_setup: {
      setup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          thinkingConfig: expectedThinkingConfig,
        },
        outputAudioTranscription: {},
      },
    },
  });
}

for (const profile of ['gemini', 'google_gemini'] as const) {
  const model = 'gemini-3.1-flash-live-preview';
  writeFixture(
    `gemini-live-thinking-profile-alias-${profile.replace('_', '-')}`,
    {
      kind: 'ai_realtime',
      provider: profile,
      model,
      request: {
        model,
        chat_prompt: [{ role: 'user', content: 'Answer with audio.' }],
        model_config: { thinkingTokenBudget: 'high' },
        audio: { output: { voice: 'Kore', transcript: true } },
      },
      expected_setup: {
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
            },
            thinkingConfig: { thinkingLevel: 'high' },
          },
          outputAudioTranscription: {},
        },
      },
    }
  );
}

writeFixture('gemini-live-thinking-native-vertex-path', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  model: 'gemini-3.1-flash-live-preview',
  service_options: { projectId: 'demo-project', region: 'us-central1' },
  request: {
    model: 'gemini-3.1-flash-live-preview',
    chat_prompt: [{ role: 'user', content: 'Answer with audio.' }],
    model_config: { thinkingTokenBudget: 'high' },
    audio: { output: { voice: 'Kore', transcript: true } },
  },
  expected_setup: {
    setup: {
      model: 'models/gemini-3.1-flash-live-preview',
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
        thinkingConfig: { thinkingLevel: 'high' },
      },
      outputAudioTranscription: {},
    },
  },
});

writeFixture('gemini-3-live-numeric-thinking-budget-rejected', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  model: 'gemini-3.1-flash-live-preview',
  request: {
    model: 'gemini-3.1-flash-live-preview',
    chat_prompt: [{ role: 'user', content: 'Answer with audio.' }],
    model_config: { thinkingTokenBudget: 2048 },
    audio: { output: { voice: 'Kore' } },
  },
  // The realtime conformance runner invokes setup when this assertion is
  // present; the resolver must fail before the placeholder can be compared.
  expected_setup: {},
  expected_error_contains: 'does not support numeric thinkingTokenBudget',
});

writeFixture('gemini-live-realtime-audio-session-and-events', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  model: geminiLiveDefaultModel,
  request: {
    model: geminiLiveDefaultModel,
    chat_prompt: [
      { role: 'system', content: 'Answer with audio.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Live question' },
          { type: 'audio', data: 'AAAA', format: 'pcm16', sampleRate: 16000 },
        ],
      },
    ],
    audio: { output: { voice: 'Kore', transcript: true } },
  },
  expected_setup: {
    setup: {
      model: `models/${geminiLiveDefaultModel}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
      },
      outputAudioTranscription: {},
      systemInstruction: { parts: [{ text: 'Answer with audio.' }] },
    },
  },
  expected_input: [
    {
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'Live question' }] }],
        turnComplete: false,
      },
    },
    {
      realtimeInput: {
        audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' },
      },
    },
    { realtimeInput: { audioStreamEnd: true } },
  ],
  events: [
    {
      id: 'gemini_live_1',
      serverContent: { outputTranscription: { text: 'spoken ' } },
    },
    {
      id: 'gemini_live_2',
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AQI=' } }],
        },
      },
    },
    {
      id: 'gemini_live_3',
      toolCall: {
        functionCalls: [{ name: 'lookup', args: { q: 'ax' } }],
      },
    },
    {
      id: 'gemini_live_done',
      serverContent: { turnComplete: true },
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 4,
        totalTokenCount: 7,
      },
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          id: '0',
          content: 'spoken ',
          function_calls: [],
          finish_reason: null,
        },
      ],
      remote_id: 'gemini_live_1',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: null,
          audio: {
            data: 'AQI=',
            mimeType: 'audio/pcm',
            format: 'pcm16',
            sampleRate: 24000,
            is_delta: true,
          },
        },
      ],
      remote_id: 'gemini_live_2',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [
            {
              id: 'lookup',
              type: 'function',
              function: { name: 'lookup', params: { q: 'ax' } },
            },
          ],
          finish_reason: 'function_call',
        },
      ],
      remote_id: 'gemini_live_3',
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          id: '0',
          content: '',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'gemini_live_done',
      model_usage: {
        ai: 'google-gemini',
        model: geminiLiveDefaultModel,
        tokens: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      },
    },
  ],
});

writeFixture('gemini-live-realtime-audio-structured-output-error', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  request: {
    model: geminiLiveDefaultModel,
    chat_prompt: [{ role: 'user', content: 'nope' }],
    response_format: { type: 'json_schema', schema: { type: 'object' } },
  },
  expected_setup: {},
  expected_error_contains: 'structured response formats',
});

writeFixture('gemini-live-realtime-audio-pcm-validation-error', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  request: {
    model: geminiLiveDefaultModel,
    chat_prompt: [
      {
        role: 'user',
        content: [{ type: 'audio', data: 'UklGRg==', format: 'wav' }],
      },
    ],
  },
  expected_input: [],
  expected_error_contains: 'PCM',
});

writeFixture('anthropic-simple-chat', {
  kind: 'ai_chat',
  provider: 'anthropic',
  request: {
    chat_prompt: [
      { role: 'system', content: 'Answer briefly.', cache: true },
      { role: 'user', content: 'What is Ax?' },
    ],
    model_config: {
      stream: false,
      maxTokens: 64,
      temperature: 0.2,
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'msg_anthropic_1',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Ax is portable.',
            citations: [
              {
                url: 'https://axllm.dev',
                title: 'Ax',
                cited_text: 'Ax docs',
              },
            ],
          },
        ],
        model: anthropicDefaultModel,
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 8,
          output_tokens: 3,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 1,
        },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_anthropic_1',
        content: 'Ax is portable.',
        function_calls: [],
        finish_reason: 'stop',
        citations: [
          { url: 'https://axllm.dev', title: 'Ax', snippet: 'Ax docs' },
        ],
      },
    ],
    remote_id: 'msg_anthropic_1',
    model_usage: {
      ai: 'anthropic',
      model: anthropicDefaultModel,
      tokens: {
        prompt_tokens: 8,
        completion_tokens: 3,
        total_tokens: 14,
        cache_creation_tokens: 2,
        cache_read_tokens: 1,
      },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
    },
    json: {
      model: anthropicDefaultModel,
      max_tokens: 64,
      temperature: 0.2,
      system: [
        {
          type: 'text',
          text: 'Answer briefly.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: 'What is Ax?' }],
    },
  },
});

writeFixture('anthropic-cache-tool-request', {
  kind: 'ai_chat',
  provider: 'anthropic',
  request: {
    chat_prompt: [
      {
        role: 'user',
        cache: true,
        content: [
          { type: 'text', text: 'Look at this.' },
          { type: 'image', mimeType: 'image/png', image: 'iVBORw0=' },
        ],
      },
    ],
    functions: [
      {
        name: 'search',
        description: 'Search docs',
        cache: true,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
    function_call: 'required',
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'msg_tool',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'search',
            input: { query: 'Look at this.' },
          },
        ],
        model: anthropicDefaultModel,
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_tool',
        content: '',
        function_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'search', params: { query: 'Look at this.' } },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    remote_id: 'msg_tool',
    model_usage: {
      ai: 'anthropic',
      model: anthropicDefaultModel,
      tokens: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    },
  },
  expected_transport_request: {
    json: {
      tool_choice: { type: 'any' },
      tools: [
        {
          name: 'search',
          description: 'Search docs',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0=',
              },
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('anthropic-thinking-response', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  request: {
    chat_prompt: [{ role: 'user', content: 'Think then answer.' }],
    model_config: { stream: false, thinkingTokenBudget: 'high' },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'msg_think',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan', signature: 'sig1' },
          { type: 'redacted_thinking', data: 'secret', signature: 'sig2' },
          { type: 'text', text: 'Done.' },
        ],
        model: 'claude-opus-4-8',
        stop_reason: 'end_turn',
        usage: { input_tokens: 6, output_tokens: 5, speed: 'standard' },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_think',
        content: 'Done.',
        function_calls: [],
        finish_reason: 'stop',
        thought: 'plansecret',
        thought_blocks: [
          { data: 'plan', encrypted: false, signature: 'sig1' },
          { data: 'secret', encrypted: true, signature: 'sig2' },
        ],
      },
    ],
    remote_id: 'msg_think',
    model_usage: {
      ai: 'anthropic',
      model: 'claude-opus-4-8',
      tokens: {
        prompt_tokens: 6,
        completion_tokens: 5,
        total_tokens: 11,
        speed: 'standard',
      },
    },
  },
  expected_transport_request: {
    json: {
      model: 'claude-opus-4-8',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    },
  },
});

writeFixture('anthropic-sonnet-5-adaptive-thinking-request', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  request: {
    chat_prompt: [{ role: 'user', content: 'Think then answer.' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'highest',
      temperature: 0.4,
      topP: 0.8,
      topK: 20,
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'msg_sonnet5_think',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_sonnet5_think',
        content: 'Done.',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'msg_sonnet5_think',
    model_usage: {
      ai: 'anthropic',
      model: 'claude-sonnet-5',
      tokens: {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10,
      },
    },
  },
  expected_transport_request: {
    json: {
      model: 'claude-sonnet-5',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'max' },
    },
  },
  expected_transport_json_absent: ['temperature', 'top_p', 'top_k'],
});

writeFixture('anthropic-adaptive-thinking-hidden-request', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  request: {
    chat_prompt: [{ role: 'user', content: 'Think privately then answer.' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'high',
      showThoughts: false,
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'msg_hidden_think',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-opus-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_hidden_think',
        content: 'Done.',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'msg_hidden_think',
    model_usage: {
      ai: 'anthropic',
      model: 'claude-opus-4-6',
      tokens: {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10,
      },
    },
  },
  expected_transport_request: {
    json: {
      model: 'claude-opus-4-6',
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'high' },
    },
  },
});

// TS detects adaptive Claude models with `includes`, because Vertex/router
// qualified ids can prefix the canonical Anthropic model name. Exercise that
// exact distinction: a startsWith-only port would leak every sampling field.
writeFixture('anthropic-qualified-adaptive-model-request', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'publishers/anthropic/models/claude-opus-4-7',
  request: {
    chat_prompt: [{ role: 'user', content: 'Think then answer.' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'medium',
      temperature: 0.4,
      topP: 0.8,
      topK: 20,
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'msg_qualified_adaptive',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        model: 'publishers/anthropic/models/claude-opus-4-7',
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: 'msg_qualified_adaptive',
        content: 'Done.',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'msg_qualified_adaptive',
    model_usage: {
      ai: 'anthropic',
      model: 'publishers/anthropic/models/claude-opus-4-7',
      tokens: {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10,
      },
    },
  },
  expected_transport_request: {
    json: {
      model: 'publishers/anthropic/models/claude-opus-4-7',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
    },
  },
  expected_transport_json_absent: ['temperature', 'top_p', 'top_k'],
});

writeFixture('anthropic-streaming-tool-thinking', {
  kind: 'ai_stream',
  provider: 'anthropic',
  request: {
    chat_prompt: [{ role: 'user', content: 'stream' }],
  },
  options: { stream: true },
  transport_responses: [
    {
      status: 200,
      body:
        `data: {"type":"message_start","message":{"id":"msg_stream_a","type":"message","role":"assistant","content":[],"model":"${anthropicDefaultModel}","stop_reason":null,"usage":{"input_tokens":4,"output_tokens":0,"cache_read_input_tokens":1}}}\n\n` +
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hel"}}\n\n' +
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_stream","name":"search","input":{}}}\n\n' +
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"Ax\\"}"}}\n\n' +
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"thinking_delta","thinking":"plan"}}\n\n' +
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":3}}\n\n',
    },
  ],
  expected_output: [
    {
      results: [{ index: 0, id: 'msg_stream_a', content: '' }],
      remote_id: 'msg_stream_a',
      model_usage: {
        ai: 'anthropic',
        model: anthropicDefaultModel,
        tokens: {
          prompt_tokens: 4,
          completion_tokens: 0,
          total_tokens: 5,
          cache_read_tokens: 1,
        },
      },
    },
    {
      results: [{ index: 0, content: 'hel' }],
      remote_id: 'msg_stream_a',
    },
    {
      results: [
        {
          index: 0,
          function_calls: [
            {
              id: 'toolu_stream',
              type: 'function',
              function: { name: 'search', params: '' },
            },
          ],
        },
      ],
      remote_id: 'msg_stream_a',
    },
    {
      results: [
        {
          index: 0,
          function_calls: [
            {
              id: 'toolu_stream',
              type: 'function',
              function: { name: 'search', params: '{"query":"Ax"}' },
            },
          ],
        },
      ],
      remote_id: 'msg_stream_a',
    },
    {
      results: [
        {
          index: 0,
          thought: 'plan',
          thought_blocks: [{ data: 'plan', encrypted: false }],
        },
      ],
      remote_id: 'msg_stream_a',
    },
    {
      results: [{ index: 0, content: '', finish_reason: 'function_call' }],
      remote_id: 'msg_stream_a',
      model_usage: {
        ai: 'anthropic',
        model: anthropicDefaultModel,
        tokens: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 8,
          cache_creation_tokens: 0,
          cache_read_tokens: 1,
        },
      },
    },
  ],
  expected_transport_request: {
    url: 'https://api.anthropic.com/v1/messages',
    json: { stream: true },
  },
});

writeFixture('gemini-simple-chat', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  request: {
    chat_prompt: [
      { role: 'system', content: 'Answer briefly.', cache: true },
      { role: 'user', content: 'What is Ax?' },
    ],
    model_config: {
      stream: false,
      temperature: 0.2,
      maxTokens: 64,
      n: 2,
      stopSequences: ['END'],
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        responseId: 'gem_resp_1',
        modelVersion: geminiDefaultModel,
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Ax is portable.' }] },
            citationMetadata: {
              citations: [
                {
                  uri: 'https://axllm.dev',
                  title: 'Ax',
                  license: 'CC',
                },
              ],
            },
            groundingMetadata: {
              googleMapsWidgetContextToken: 'maps-token',
            },
          },
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Ax runs everywhere.' }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          cachedContentTokenCount: 2,
          candidatesTokenCount: 4,
          thoughtsTokenCount: 1,
          totalTokenCount: 16,
        },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        content: 'Ax is portable.',
        function_calls: [],
        finish_reason: 'stop',
        citations: [{ url: 'https://axllm.dev', title: 'Ax', license: 'CC' }],
      },
      {
        index: 1,
        content: 'Ax runs everywhere.',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'gem_resp_1',
    model_usage: {
      ai: 'google-gemini',
      model: geminiDefaultModel,
      tokens: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 16,
        reasoning_tokens: 1,
        cache_read_tokens: 2,
      },
    },
    provider_metadata: {
      google: {
        modelVersion: geminiDefaultModel,
        mapsWidgetContextToken: 'maps-token',
      },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultModel}:generateContent`,
    headers: { 'x-goog-api-key': 'test-key' },
    json: {
      systemInstruction: {
        role: 'user',
        parts: [{ text: 'Answer briefly.' }],
      },
      contents: [{ role: 'user', parts: [{ text: 'What is Ax?' }] }],
      generationConfig: {
        candidateCount: 2,
        maxOutputTokens: 64,
        responseMimeType: 'text/plain',
        stopSequences: ['END'],
        temperature: 1,
      },
    },
  },
});

for (const serviceTier of ['standard', 'flex', 'priority'] as const) {
  writeFixture(`gemini-service-tier-${serviceTier}`, {
    kind: 'ai_chat',
    provider: 'google-gemini',
    service_options: { serviceTier },
    request: {
      chat_prompt: [{ role: 'user', content: `Use the ${serviceTier} tier.` }],
      model_config: { stream: false },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          responseId: `gemini_tier_${serviceTier}`,
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: 'ok' }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
            serviceTier,
          },
        },
      },
    ],
    expected_output: {
      results: [
        {
          index: 0,
          content: 'ok',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: `gemini_tier_${serviceTier}`,
      model_usage: {
        ai: 'google-gemini',
        model: geminiDefaultModel,
        tokens: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          service_tier: serviceTier,
        },
      },
    },
    expected_transport_request: {
      method: 'POST',
      url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultModel}:generateContent`,
      headers: { 'x-goog-api-key': 'test-key' },
      json: { service_tier: serviceTier },
    },
  });
}

writeFixture('gemini-service-tier-unspecified-normalizes-standard', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  request: {
    chat_prompt: [{ role: 'user', content: 'Use the default tier.' }],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        responseId: 'gemini_tier_unspecified',
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'ok' }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
          serviceTier: 'unspecified',
        },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        content: 'ok',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'gemini_tier_unspecified',
    model_usage: {
      ai: 'google-gemini',
      model: geminiDefaultModel,
      tokens: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        service_tier: 'standard',
      },
    },
  },
  expected_transport_json_absent: ['service_tier'],
});

writeFixture('gemini-service-tier-vertex-error', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.1-flash-lite',
  service_options: {
    projectId: 'demo-project',
    region: 'us-central1',
    serviceTier: 'flex',
  },
  request: {
    chat_prompt: [{ role: 'user', content: 'This combination is invalid.' }],
    model_config: { stream: false },
  },
  expected_error_contains: 'not supported by Vertex AI',
});

writeFixture('gemini-service-tier-live-error', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: geminiLiveDefaultModel,
  service_options: { serviceTier: 'flex' },
  request: {
    chat_prompt: [{ role: 'user', content: 'This combination is invalid.' }],
    model_config: { stream: false },
  },
  expected_error_contains: 'not supported by the Live API',
});

for (const { fixtureName, model, strictParameters } of [
  {
    fixtureName: 'gemini-38-flash-server-managed-sampling',
    model: 'gemini-3.8-flash',
    strictParameters: true,
  },
  {
    fixtureName: 'gemini-37-flash-server-managed-sampling',
    model: 'gemini-3.7-flash',
    strictParameters: true,
  },
  {
    fixtureName: 'gemini-36-flash-server-managed-sampling',
    model: 'gemini-3.6-flash',
    strictParameters: true,
  },
  {
    fixtureName: 'gemini-35-flash-lite-server-managed-sampling',
    model: 'gemini-3.5-flash-lite',
    strictParameters: false,
  },
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'google-gemini',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'Answer briefly.' }],
      model_config: {
        stream: false,
        maxTokens: 64,
        temperature: 0.2,
        topP: 0.8,
        topK: 20,
        ...(strictParameters ? { n: 2, frequencyPenalty: 0.4 } : {}),
      },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          responseId: `${fixtureName}-response`,
          modelVersion: model,
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: 'Done.' }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 2,
            candidatesTokenCount: 1,
            totalTokenCount: 3,
          },
        },
      },
    ],
    expected_output: {
      results: [
        {
          index: 0,
          content: 'Done.',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: `${fixtureName}-response`,
      model_usage: {
        ai: 'google-gemini',
        model,
        tokens: {
          prompt_tokens: 2,
          completion_tokens: 1,
          total_tokens: 3,
        },
      },
      provider_metadata: { google: { modelVersion: model } },
    },
    expected_transport_request: {
      method: 'POST',
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { 'x-goog-api-key': 'test-key' },
      json: {
        contents: [{ role: 'user', parts: [{ text: 'Answer briefly.' }] }],
        generationConfig: {
          ...(!strictParameters ? { candidateCount: 1 } : {}),
          maxOutputTokens: 64,
          responseMimeType: 'text/plain',
        },
      },
    },
    expected_transport_json_absent: [
      'generationConfig.temperature',
      'generationConfig.topP',
      'generationConfig.topK',
      ...(strictParameters
        ? [
            'generationConfig.candidateCount',
            'generationConfig.frequencyPenalty',
          ]
        : []),
    ],
  });
}

writeFixture('gemini-38-function-call-id-round-trip', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.8-flash',
  request: {
    chat_prompt: [
      { role: 'user', content: 'Look up Ax.' },
      {
        role: 'assistant',
        functionCalls: [
          {
            id: 'provider-call-1',
            type: 'function',
            function: { name: 'search', params: { query: 'Ax' } },
          },
        ],
      },
      {
        role: 'function',
        functionId: 'provider-call-1',
        result: '{"found":true}',
      },
    ],
    functions: [
      {
        name: 'search',
        description: 'Search docs',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'provider-call-2',
                    name: 'search',
                    args: { query: 'Ax function IDs' },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        content: '',
        function_calls: [
          {
            id: 'provider-call-2',
            type: 'function',
            function: {
              name: 'search',
              params: { query: 'Ax function IDs' },
            },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    model_usage: null,
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    headers: { 'x-goog-api-key': 'test-key' },
    json: {
      contents: [
        { role: 'user', parts: [{ text: 'Look up Ax.' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'provider-call-1',
                name: 'search',
                args: { query: 'Ax' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'provider-call-1',
                name: 'search',
                response: { result: '{"found":true}' },
              },
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'text/plain' },
      tools: [
        {
          function_declarations: [
            {
              name: 'search',
              description: 'Search docs',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
              },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('gemini-tool-call', {
  kind: 'ai_chat',
  provider: 'gemini',
  request: {
    chat_prompt: [{ role: 'user', content: 'Search docs' }],
    functions: [
      {
        name: 'search',
        description: 'Search docs',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
    function_call: {
      function: { name: 'search' },
    },
    response_format: {
      type: 'json_schema',
      schema: {
        name: 'search_result',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    },
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'gemini-search-1',
                    name: 'search',
                    args: { query: 'Search docs' },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        content: '',
        function_calls: [
          {
            id: 'gemini-search-1',
            type: 'function',
            function: { name: 'search', params: { query: 'Search docs' } },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    model_usage: null,
  },
  expected_transport_request: {
    json: {
      generationConfig: {
        candidateCount: 1,
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
      tools: [
        {
          function_declarations: [
            {
              name: 'search',
              description: 'Search docs',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
              },
            },
          ],
        },
      ],
      toolConfig: {
        function_calling_config: {
          mode: 'ANY',
          allowed_function_names: ['search'],
        },
      },
    },
  },
});

writeFixture('gemini-streaming-text', {
  kind: 'ai_stream',
  provider: 'google-gemini',
  request: {
    chat_prompt: [{ role: 'user', content: 'stream' }],
    model_config: { stream: true },
  },
  transport_responses: [
    {
      status: 200,
      body:
        'data: {"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"he"}]}}]}\n\n' +
        'data: {"responseId":"gem_stream","candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"llo"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}\n\n' +
        'data: [DONE]\n\n',
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          content: 'he',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      model_usage: null,
    },
    {
      results: [
        {
          index: 0,
          content: 'llo',
          function_calls: [],
          finish_reason: 'stop',
        },
      ],
      remote_id: 'gem_stream',
      model_usage: {
        ai: 'google-gemini',
        model: geminiDefaultModel,
        tokens: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      },
    },
  ],
  expected_transport_request: {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultModel}:streamGenerateContent?alt=sse`,
    headers: { 'x-goog-api-key': 'test-key' },
    json: { generationConfig: { responseMimeType: 'text/plain' } },
  },
});

writeFixture('gemini-media-request', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  request: {
    chat_prompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'inspect' },
          { type: 'image', data: 'image-base64', mimeType: 'image/png' },
          { type: 'audio', data: 'audio-base64', format: 'wav' },
          {
            type: 'file',
            fileUri: 'gs://bucket/doc.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          { finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        content: 'ok',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    model_usage: null,
  },
  expected_transport_request: {
    json: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'inspect' },
            { inlineData: { mimeType: 'image/png', data: 'image-base64' } },
            { inlineData: { mimeType: 'audio/wav', data: 'audio-base64' } },
            {
              fileData: {
                mimeType: 'application/pdf',
                fileUri: 'gs://bucket/doc.pdf',
              },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('gemini-embeddings', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: geminiDefaultEmbedModel,
  request: { texts: ['one', 'two'] },
  transport_responses: [
    {
      status: 200,
      json: {
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      },
    },
  ],
  expected_output: {
    embeddings: [
      [0.1, 0.2],
      [0.3, 0.4],
    ],
  },
  expected_transport_request: {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultEmbedModel}:batchEmbedContents`,
    headers: { 'x-goog-api-key': 'test-key' },
    json: {
      requests: [
        {
          model: `models/${geminiDefaultEmbedModel}`,
          content: { parts: [{ text: 'one' }] },
        },
        {
          model: `models/${geminiDefaultEmbedModel}`,
          content: { parts: [{ text: 'two' }] },
        },
      ],
    },
  },
});

writeFixture('gemini-embeddings-output-dimensionality', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: geminiDefaultEmbedModel,
  request: { texts: ['one'], dimensions: 512 },
  transport_responses: [
    {
      status: 200,
      json: { embeddings: [{ values: [0.1, 0.2] }] },
    },
  ],
  expected_output: { embeddings: [[0.1, 0.2]] },
  expected_transport_request: {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultEmbedModel}:batchEmbedContents`,
    headers: { 'x-goog-api-key': 'test-key' },
    json: {
      requests: [
        {
          model: `models/${geminiDefaultEmbedModel}`,
          content: { parts: [{ text: 'one' }] },
          outputDimensionality: 512,
        },
      ],
    },
  },
});

// The Go runtime handed embed/transcribe/speak responses straight to the
// normalizer without the status check chat performs, so a 4xx/5xx body -- which
// carries no results -- normalized to an empty success. A depleted-credits 429
// reached the caller as "no embeddings" with no error at all.
writeFixture('gemini-embed-rate-limit-surfaces-error', {
  kind: 'ai_error',
  method: 'embed',
  provider: 'google-gemini',
  embed_model: geminiDefaultEmbedModel,
  request: { texts: ['one'] },
  transport_responses: [
    {
      status: 429,
      json: {
        error: {
          message: 'Your prepayment credits are depleted',
          status: 'RESOURCE_EXHAUSTED',
        },
      },
    },
  ],
  expected_error_contains: 'prepayment credits are depleted',
  expected_status: 429,
});

writeFixture('openai-transcribe-error-surfaces-error', {
  kind: 'ai_error',
  method: 'transcribe',
  request: {
    audio: 'base64-audio',
    format: 'json',
    language: 'en',
    model: 'whisper-1',
  },
  transport_responses: [
    {
      status: 500,
      json: { error: { message: 'transcription backend unavailable' } },
    },
  ],
  expected_error_contains: 'transcription backend unavailable',
  expected_status: 500,
});

writeFixture('openai-speak-error-surfaces-error', {
  kind: 'ai_error',
  method: 'speak',
  request: { format: 'mp3', text: 'hello', voice: 'alloy' },
  transport_responses: [
    {
      status: 503,
      json: { error: { message: 'voice synthesis unavailable' } },
    },
  ],
  expected_error_contains: 'voice synthesis unavailable',
  expected_status: 503,
});

// The ported Gemini path built no thinkingConfig at all, so a caller that set a
// thinking budget got a model that did not think, and one that asked for the
// reasoning text back got a chat log with no thought in it. TypeScript maps both
// (src/ax/ai/google-gemini/api.ts:1043 and :1148); the port dropped them between
// merge_model_config, which accepts them, and the request, which never read them.
// An effort level is not a token count. Gemini's thinkingBudget is an int32 and
// rejects a level with a hard 400, while thinkingLevel is what the Gemini 3
// family documents — so a caller asking for high-effort reasoning broke every
// request rather than getting it. none becomes minimal because Gemini 3 cannot
// disable thinking, and highest is spelled high.
writeFixture('gemini-thinking-level-routes-away-from-the-budget', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.5-flash',
  request: {
    chat_prompt: [{ role: 'user', content: 'think hard' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'highest',
      showThoughts: true,
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      },
    },
  ],
  expected_transport_request: {
    json: {
      generationConfig: {
        thinkingConfig: { thinkingLevel: 'high', includeThoughts: true },
      },
    },
  },
});

writeFixture('gemini-thinking-config-reaches-the-request', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-2.5-flash',
  request: {
    chat_prompt: [{ role: 'user', content: 'think about this' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 2048,
      showThoughts: true,
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      },
    },
  ],
  expected_transport_request: {
    json: {
      generationConfig: {
        thinkingConfig: { thinkingBudget: 2048, includeThoughts: true },
      },
    },
  },
});

for (const {
  fixtureName,
  model,
  requested,
  expectedLevel,
  expectedThoughts,
} of [
  {
    fixtureName: 'gemini-38-minimal-clamps-to-low',
    model: 'gemini-3.8-flash',
    requested: 'minimal',
    expectedLevel: 'low',
    expectedThoughts: true,
  },
  {
    fixtureName: 'gemini-38-none-clamps-to-low-and-hides-thoughts',
    model: 'gemini-3.8-flash',
    requested: 'none',
    expectedLevel: 'low',
    expectedThoughts: false,
  },
  {
    fixtureName: 'gemini-37-minimal-clamps-to-low',
    model: 'gemini-3.7-flash',
    requested: 'minimal',
    expectedLevel: 'low',
    expectedThoughts: true,
  },
  {
    fixtureName: 'gemini-37-none-clamps-to-low-and-hides-thoughts',
    model: 'gemini-3.7-flash',
    requested: 'none',
    expectedLevel: 'low',
    expectedThoughts: false,
  },
  {
    fixtureName: 'gemini-31-pro-preserves-medium',
    model: 'gemini-3.1-pro-preview',
    requested: 'medium',
    expectedLevel: 'medium',
    expectedThoughts: true,
  },
  {
    fixtureName: 'gemini-31-image-medium-clamps-to-high',
    model: 'gemini-3.1-flash-image-preview',
    requested: 'medium',
    expectedLevel: 'high',
    expectedThoughts: true,
  },
  {
    fixtureName: 'gemini-legacy-3-pro-medium-clamps-to-high',
    model: 'gemini-3-pro-preview',
    requested: 'medium',
    expectedLevel: 'high',
    expectedThoughts: true,
  },
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'google-gemini',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'think about this' }],
      model_config: {
        stream: false,
        thinkingTokenBudget: requested,
        showThoughts: true,
      },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          candidates: [
            { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
          ],
        },
      },
    ],
    expected_transport_request: {
      json: {
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: expectedLevel,
            includeThoughts: expectedThoughts,
          },
        },
      },
    },
    expected_transport_json_absent: [
      'generationConfig.thinkingConfig.thinkingBudget',
    ],
  });
}

for (const {
  fixtureName,
  model,
  requested,
  expectedBudget,
  expectedThoughts,
} of [
  {
    fixtureName: 'gemini-25-flash-high-uses-numeric-budget',
    model: 'gemini-2.5-flash',
    requested: 'high',
    expectedBudget: 10000,
    expectedThoughts: true,
  },
  {
    fixtureName: 'gemini-25-flash-none-disables-thinking',
    model: 'gemini-2.5-flash',
    requested: 'none',
    expectedBudget: 0,
    expectedThoughts: false,
  },
  {
    fixtureName: 'gemini-25-pro-none-clamps-to-minimum-budget',
    model: 'gemini-2.5-pro',
    requested: 'none',
    expectedBudget: 200,
    expectedThoughts: false,
  },
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'google-gemini',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'think about this' }],
      model_config: {
        stream: false,
        thinkingTokenBudget: requested,
        showThoughts: true,
      },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          candidates: [
            { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
          ],
        },
      },
    ],
    expected_transport_request: {
      json: {
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: expectedBudget,
            includeThoughts: expectedThoughts,
          },
        },
      },
    },
    expected_transport_json_absent: [
      'generationConfig.thinkingConfig.thinkingLevel',
    ],
  });
}

writeFixture('gemini-37-custom-level-mapping-is-clamped', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.7-flash',
  request: {
    chat_prompt: [{ role: 'user', content: 'think about this' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'high',
      thinkingLevelMapping: { high: 'minimal' },
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      },
    },
  ],
  expected_transport_request: {
    json: {
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    },
  },
  expected_transport_json_absent: [
    'generationConfig.thinkingConfig.thinkingBudget',
  ],
});

writeFixture('gemini-25-custom-budget-rung-is-preserved', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-2.5-flash',
  request: {
    chat_prompt: [{ role: 'user', content: 'think about this' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'high',
      thinkingTokenBudgetLevels: { high: 12345 },
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      },
    },
  ],
  expected_transport_request: {
    json: {
      generationConfig: { thinkingConfig: { thinkingBudget: 12345 } },
    },
  },
  expected_transport_json_absent: [
    'generationConfig.thinkingConfig.thinkingLevel',
  ],
});

for (const { fixtureName, value, expectedError } of [
  {
    fixtureName: 'gemini-3-numeric-thinking-budget-rejected',
    value: 2048,
    expectedError: 'does not support numeric thinkingTokenBudget',
  },
  {
    fixtureName: 'gemini-3-unknown-thinking-level-rejected',
    value: 'extreme',
    expectedError: 'unsupported Gemini thinkingTokenBudget level',
  },
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'google-gemini',
    model: 'gemini-3.5-flash',
    request: {
      chat_prompt: [{ role: 'user', content: 'think about this' }],
      model_config: { stream: false, thinkingTokenBudget: value },
    },
    expected_error_contains: expectedError,
  });
}

for (const profile of ['gemini', 'google_gemini'] as const) {
  writeFixture(`gemini-thinking-profile-alias-${profile.replace('_', '-')}`, {
    kind: 'ai_chat',
    provider: profile,
    model: 'gemini-3.5-flash',
    request: {
      chat_prompt: [{ role: 'user', content: 'think hard' }],
      model_config: { stream: false, thinkingTokenBudget: 'high' },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          candidates: [
            { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
          ],
        },
      },
    ],
    expected_transport_request: {
      json: {
        generationConfig: { thinkingConfig: { thinkingLevel: 'high' } },
      },
    },
  });
}

writeFixture('gemini-thinking-native-vertex-path', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.5-flash',
  service_options: { projectId: 'demo-project', region: 'us-central1' },
  request: {
    chat_prompt: [{ role: 'user', content: 'think hard' }],
    model_config: { stream: false, thinkingTokenBudget: 'high' },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      },
    },
  ],
  expected_transport_request: {
    json: {
      generationConfig: { thinkingConfig: { thinkingLevel: 'high' } },
    },
  },
});

writeFixture('vertex-openai-gemini-model-does-not-inherit-native-thinking', {
  kind: 'ai_chat',
  provider: 'vertex-ai',
  model: 'gemini-3.5-flash',
  base_url: 'https://vertex.example.test/v1',
  request: {
    chat_prompt: [{ role: 'user', content: 'think hard' }],
    model_config: { stream: false, thinkingTokenBudget: 'high' },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      },
    },
  ],
  expected_transport_json_absent: [
    'generationConfig',
    'thinkingConfig',
    'thinkingLevel',
    'thinking_level',
    'thinkingBudget',
    'thinking_budget',
  ],
});

writeFixture('context-cache-rejection', {
  kind: 'ai_context_cache',
  operation: 'rejection',
  cases: [
    {
      args: [400, { error: { message: 'cachedContent is invalid' } }],
      expected: true,
    },
    {
      args: [404, { error: { message: 'cache does not exist' } }],
      expected: true,
    },
    {
      args: [500, { error: { message: 'cachedContents/cache-1 expired' } }],
      expected: false,
    },
    {
      args: [400, { error: { message: 'ordinary validation failure' } }],
      expected: false,
    },
  ],
});

writeFixture('context-cache-expiry', {
  kind: 'ai_context_cache',
  operation: 'expiry',
  cases: [
    { args: [1500, 1000], expected: 1500 },
    { args: [1000, 1000], expected: 0 },
    { args: ['2099-01-01T00:00:00Z', 1000], expected: 0 },
    { args: [null, 1000], expected: 0 },
  ],
});

writeFixture('context-cache-plan', {
  kind: 'ai_context_cache',
  operation: 'plan',
  cases: [
    {
      args: [false, true, '', {}, 1000, 300, true],
      expected: { action: 'none', managed: false },
    },
    {
      args: [true, true, 'cachedContents/explicit', {}, 1000, 300, true],
      expected: {
        action: 'use',
        cacheName: 'cachedContents/explicit',
        managed: false,
      },
    },
    {
      args: [
        true,
        true,
        '',
        { cacheName: 'cachedContents/fresh', expiresAt: 5000 },
        1000,
        300,
        true,
      ],
      expected: {
        action: 'use',
        cacheName: 'cachedContents/fresh',
        managed: true,
      },
    },
    {
      args: [
        true,
        true,
        '',
        { cacheName: 'cachedContents/near-expiry', expiresAt: 1200 },
        1000,
        300,
        true,
      ],
      expected: {
        action: 'refresh',
        cacheName: 'cachedContents/near-expiry',
        managed: true,
      },
    },
    {
      args: [true, true, '', {}, 1000, 300, true],
      expected: { action: 'create', managed: true },
    },
  ],
});

writeFixture('context-cache-recovery', {
  kind: 'ai_context_cache',
  operation: 'recovery',
  cases: [
    {
      args: [
        { cacheName: 'cachedContents/current', expiresAt: 5000 },
        'cachedContents/current',
        true,
      ],
      expected: {
        deleteInMemory: false,
        externalEntry: {
          cacheName: 'cachedContents/current',
          expiresAt: 0,
        },
        invalidated: true,
      },
    },
    {
      args: [
        { cacheName: 'cachedContents/current', expiresAt: 5000 },
        'cachedContents/current',
        false,
      ],
      expected: { deleteInMemory: true, invalidated: true },
    },
    {
      args: [
        { cacheName: 'cachedContents/replaced', expiresAt: 5000 },
        'cachedContents/stale',
        true,
      ],
      expected: { deleteInMemory: false, invalidated: false },
    },
  ],
});

writeFixture('http-method-descriptor', {
  kind: 'ai_context_cache',
  operation: 'gemini_ops',
  args: [
    'cachedContents/cache-1',
    3600,
    'gemini-key',
    'gemini-3.5-flash',
    { systemInstruction: { parts: [{ text: 'stable context' }] } },
  ],
  expected: {
    create: {
      method: 'POST',
      path: '/cachedContents',
      request: {
        model: 'models/gemini-3.5-flash',
        systemInstruction: { parts: [{ text: 'stable context' }] },
        ttl: '3600s',
      },
    },
    update: {
      method: 'PATCH',
      path: '/cachedContents/cache-1?updateMask=ttl',
      request: { ttl: '3600s' },
    },
    delete: {
      method: 'DELETE',
      path: '/cachedContents/cache-1',
      request: {},
    },
  },
});

writeFixture('vertex-gemini-us-resolved-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'google-gemini',
  options: { projectId: 'demo-project', region: 'us' },
  expected_output: {
    auth: 'bearer',
    baseUrl: 'https://aiplatform.us.rep.googleapis.com/v1',
    vertex: true,
    vertexParent: 'projects/demo-project/locations/us',
    vertexCacheBaseUrl: 'https://aiplatform.us.rep.googleapis.com/v1',
    operations: {
      chat: {
        path: '/projects/demo-project/locations/us/publishers/google/models/{model}:generateContent',
      },
      stream_chat: {
        path: '/projects/demo-project/locations/us/publishers/google/models/{model}:streamGenerateContent?alt=sse',
      },
      embed: {
        path: '/projects/demo-project/locations/us/publishers/google/models/{model}:predict',
      },
    },
  },
});

writeFixture('vertex-gemini-global-resolved-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'google-gemini',
  options: { project_id: 'demo-project', region: 'global' },
  expected_output: {
    baseUrl: 'https://aiplatform.googleapis.com/v1',
    vertexParent: 'projects/demo-project/locations/global',
  },
});

writeFixture('vertex-gemini-endpoint-and-base-url-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'google-gemini',
  options: {
    project_id: 'demo-project',
    region: 'europe-west4',
    endpoint_id: 'endpoint-42',
    base_url: 'https://vertex.test/v1',
  },
  expected_output: {
    baseUrl: 'https://vertex.test/v1',
    vertexCacheBaseUrl: 'https://vertex.test/v1',
    operations: {
      chat: {
        path: '/projects/demo-project/locations/europe-west4/endpoints/endpoint-42:generateContent',
      },
      embed: {
        path: '/projects/demo-project/locations/europe-west4/endpoints/endpoint-42:predict',
      },
    },
  },
});

writeFixture('vertex-anthropic-eu-resolved-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'anthropic',
  options: { projectId: 'demo-project', region: 'eu' },
  expected_output: {
    auth: 'bearer',
    baseUrl: 'https://aiplatform.eu.rep.googleapis.com/v1',
    vertex: true,
    headers: { 'anthropic-beta': 'web-search-2025-03-05' },
    operations: {
      chat: {
        path: '/projects/demo-project/locations/eu/publishers/anthropic/models/{model}:rawPredict',
      },
      stream_chat: {
        path: '/projects/demo-project/locations/eu/publishers/anthropic/models/{model}:streamRawPredict?alt=sse',
      },
    },
  },
});

writeFixture('vertex-gemini-us-chat', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.1-flash-lite',
  service_options: { projectId: 'demo-project', region: 'us' },
  request: {
    chat_prompt: [{ role: 'user', content: 'hi multi-region' }],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        responseId: 'vertex-gemini-1',
        modelVersion: 'gemini-3.1-flash-lite',
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'multi-region ok' }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 2,
          candidatesTokenCount: 2,
          totalTokenCount: 4,
        },
      },
    },
  ],
  expected_transport_request: {
    method: 'POST',
    url: 'https://aiplatform.us.rep.googleapis.com/v1/projects/demo-project/locations/us/publishers/google/models/gemini-3.1-flash-lite:generateContent',
    headers: { Authorization: 'Bearer test-key' },
    json: {
      contents: [{ role: 'user', parts: [{ text: 'hi multi-region' }] }],
    },
  },
});

writeFixture('vertex-gemini-regional-endpoint-embed', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: 'gemini-embedding-001',
  service_options: {
    project_id: 'demo-project',
    region: 'us-central1',
    endpoint_id: 'endpoint-42',
  },
  request: { texts: ['hello world'] },
  transport_responses: [
    {
      status: 200,
      json: {
        predictions: [{ embeddings: { values: [0.1, 0.2, 0.3] } }],
      },
    },
  ],
  expected_output: { embeddings: [[0.1, 0.2, 0.3]] },
  expected_transport_request: {
    method: 'POST',
    url: 'https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/endpoints/endpoint-42:predict',
    headers: { Authorization: 'Bearer test-key' },
    json: { instances: [{ content: 'hello world' }] },
  },
});

writeFixture('vertex-anthropic-us-chat', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  service_options: { projectId: 'demo-project', region: 'us' },
  request: {
    chat_prompt: [{ role: 'user', content: 'hi vertex anthropic' }],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'vertex-anthropic-1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-opus-4-8',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
  ],
  expected_transport_request: {
    method: 'POST',
    url: 'https://aiplatform.us.rep.googleapis.com/v1/projects/demo-project/locations/us/publishers/anthropic/models/claude-opus-4-8:rawPredict',
    headers: {
      Authorization: 'Bearer test-key',
      'anthropic-beta': 'web-search-2025-03-05',
    },
    json: {
      anthropic_version: 'vertex-2023-10-16',
      messages: [{ role: 'user', content: 'hi vertex anthropic' }],
    },
  },
  expected_transport_json_absent: ['model'],
});

writeFixture('vertex-gemini-eu-cache-operations', {
  kind: 'ai_context_cache',
  operation: 'gemini_ops',
  args: [
    'projects/demo-project/locations/eu/cachedContents/cache-1',
    3600,
    'vertex-token',
    'gemini-3.1-flash-lite',
    { systemInstruction: { parts: [{ text: 'stable context' }] } },
    { projectId: 'demo-project', region: 'eu' },
  ],
  expected: {
    create: {
      method: 'POST',
      base_url: 'https://aiplatform.eu.rep.googleapis.com/v1',
      path: '/projects/demo-project/locations/eu/cachedContents',
      request: {
        model:
          'projects/demo-project/locations/eu/publishers/google/models/gemini-3.1-flash-lite',
        systemInstruction: { parts: [{ text: 'stable context' }] },
        ttl: '3600s',
      },
    },
    update: {
      method: 'PATCH',
      base_url: 'https://aiplatform.eu.rep.googleapis.com/v1',
      path: '/projects/demo-project/locations/eu/cachedContents/cache-1?updateMask=ttl',
      request: { ttl: '3600s' },
    },
    delete: {
      method: 'DELETE',
      base_url: 'https://aiplatform.eu.rep.googleapis.com/v1',
      path: '/projects/demo-project/locations/eu/cachedContents/cache-1',
      request: {},
    },
  },
});

const openAIPromptCacheRequest = {
  chat_prompt: [
    { role: 'system', content: 'SYS', cache: true },
    { role: 'assistant', content: 'stable answer', functionCalls: [] },
    { role: 'user', content: 'VOLATILE' },
  ],
  model_config: { stream: false },
};

writeFixture('openai-gpt-5-6-prompt-cache-breakpoints', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-5.6-luna',
  service_options: {
    contextCache: {},
    promptCacheKey: 'conversation-42',
    sessionId: 'loses',
  },
  request: openAIPromptCacheRequest,
  expected_request_after: openAIPromptCacheRequest,
  transport_responses: [compatibleResponse('chatcmpl_cache', 'gpt-5.6-luna')],
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    json: {
      model: 'gpt-5.6-luna',
      prompt_cache_key: 'conversation-42',
      prompt_cache_options: { mode: 'explicit' },
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: 'SYS',
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'stable answer',
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ],
        },
        { role: 'user', content: 'VOLATILE' },
      ],
    },
  },
});

writeFixture('openai-gpt-5-6-explicit-tail-cache-breakpoint', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-5.6-luna',
  service_options: { prompt_cache_key: 'tail-key' },
  request: {
    chat_prompt: [
      { role: 'system', content: 'SYS', cache: true },
      { role: 'user', content: 'TAIL', cache: true },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_tail_cache', 'gpt-5.6-luna'),
  ],
  expected_transport_request: {
    json: {
      prompt_cache_key: 'tail-key',
      prompt_cache_options: { mode: 'explicit' },
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: 'SYS',
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'TAIL',
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('openai-legacy-prompt-cache-disabled', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-5.5',
  service_options: { contextCache: {}, promptCacheKey: 'must-not-send' },
  request: openAIPromptCacheRequest,
  transport_responses: [compatibleResponse('chatcmpl_legacy_cache', 'gpt-5.5')],
  expected_transport_json_absent: [
    'prompt_cache_key',
    'prompt_cache_options',
    'messages.0.content.0.prompt_cache_breakpoint',
  ],
});

writeFixture('azure-openai-prompt-cache-disabled', {
  kind: 'ai_chat',
  provider: 'azure-openai',
  model: 'gpt-5.6-luna',
  resource_name: 'example',
  deployment_name: 'deployment',
  api_version: 'api-version=2024-02-15-preview',
  service_options: { contextCache: {}, promptCacheKey: 'must-not-send' },
  request: openAIPromptCacheRequest,
  transport_responses: [
    compatibleResponse('chatcmpl_azure_cache', 'gpt-5.6-luna'),
  ],
  expected_transport_json_absent: ['prompt_cache_key', 'prompt_cache_options'],
});

writeFixture('openai-responses-prompt-cache-disabled', {
  kind: 'ai_chat',
  provider: 'openai-responses',
  model: 'gpt-5.6-luna',
  service_options: { contextCache: {}, promptCacheKey: 'must-not-send' },
  request: {
    chat_prompt: [{ role: 'user', content: 'responses stays unchanged' }],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'resp_cache_disabled',
        model: 'gpt-5.6-luna',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        output: [
          {
            id: 'msg_cache_disabled',
            type: 'message',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
      },
    },
  ],
  expected_transport_json_absent: ['prompt_cache_key', 'prompt_cache_options'],
});

writeFixture('openai-cache-write-usage-and-long-context-cost', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-5.6-luna',
  request: {
    chat_prompt: [{ role: 'user', content: 'measure cache write' }],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'chatcmpl_cache_usage',
        object: 'chat.completion',
        model: 'gpt-5.6-luna',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 300000,
          completion_tokens: 100,
          total_tokens: 300100,
          prompt_tokens_details: {
            cached_tokens: 0,
            cache_write_tokens: 100000,
          },
        },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: '0',
        content: 'ok',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'chatcmpl_cache_usage',
    model_usage: {
      ai: 'openai',
      model: 'gpt-5.6-luna',
      tokens: {
        prompt_tokens: 200000,
        completion_tokens: 100,
        total_tokens: 300100,
        cache_creation_tokens: 100000,
      },
    },
  },
  expected_estimated_cost: 0.10518,
});

writeFixture('openai-service-tier-long-context-cost-fallback', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'custom-tier-pricing',
  service_options: {
    serviceTier: 'priority',
    modelInfo: [
      {
        name: 'custom-tier-pricing',
        promptTokenCostPer1M: 2,
        completionTokenCostPer1M: 8,
        cacheReadTokenCostPer1M: 0.5,
        cacheWriteTokenCostPer1M: 2,
        longContextThreshold: 1000,
        longContextPromptTokenCostPer1M: 3,
        longContextCompletionTokenCostPer1M: 12,
        longContextCacheReadTokenCostPer1M: 0.75,
        supported: { serviceTiers: ['priority'] },
        serviceTierPricing: {
          priority: {
            promptTokenCostPer1M: 4,
            completionTokenCostPer1M: 16,
            cacheReadTokenCostPer1M: 1,
            cacheWriteTokenCostPer1M: 5,
          },
        },
      },
    ],
  },
  request: {
    chat_prompt: [{ role: 'user', content: 'price the applied tier' }],
    model_config: { stream: false },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'chatcmpl_tier_cost',
        object: 'chat.completion',
        model: 'custom-tier-pricing',
        service_tier: 'priority',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 3000,
          completion_tokens: 500,
          total_tokens: 3500,
          prompt_tokens_details: {
            cached_tokens: 1000,
            cache_write_tokens: 500,
          },
        },
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        id: '0',
        content: 'ok',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    remote_id: 'chatcmpl_tier_cost',
    model_usage: {
      ai: 'openai',
      model: 'custom-tier-pricing',
      tokens: {
        prompt_tokens: 1500,
        completion_tokens: 500,
        total_tokens: 3500,
        cache_read_tokens: 1000,
        cache_creation_tokens: 500,
        service_tier: 'priority',
      },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    json: { service_tier: 'priority' },
  },
  expected_estimated_cost: 0.0175,
});

// The automatic factory route must agree with the explicit Responses provider.
for (const provider of ['openai', 'openai-responses']) {
  for (const budget of [
    'minimal',
    'low',
    'medium',
    'high',
    'highest',
  ] as const) {
    const model = AxAIOpenAIModel.GPT6Astra;
    writeFixture(`${provider}-astra-reasoning-${budget}`, {
      kind: 'ai_chat',
      provider,
      model,
      request: {
        chat_prompt: [{ role: 'user', content: 'reason' }],
        model_config: {
          stream: false,
          thinkingTokenBudget: budget,
          temperature: 0.5,
          topP: 0.9,
          presencePenalty: 1,
          frequencyPenalty: 1,
        },
      },
      transport_responses: [
        {
          status: 200,
          json: {
            id: 'resp_astra',
            model,
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            output: [
              {
                id: 'msg_astra',
                type: 'message',
                content: [{ type: 'output_text', text: 'ok', annotations: [] }],
              },
            ],
          },
        },
      ],
      expected_transport_request: {
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        json: {
          model,
          input: [
            { role: 'user', content: [{ type: 'input_text', text: 'reason' }] },
          ],
          reasoning: {
            effort: axResolveOpenAIResponsesReasoningEffort(model, budget),
          },
          stream: false,
        },
      },
      expected_transport_json_absent: [
        'temperature',
        'top_p',
        'presence_penalty',
        'frequency_penalty',
      ],
    });
  }
}

writeFixture('astra-session-completed-calls-and-response-boundaries', {
  kind: 'ai_session_events',
  model: AxAIOpenAIModel.GPT6Astra,
  cases: [
    {
      event: { type: 'response.created', response: { id: 'r1' } },
      expected_types: [],
    },
    {
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'item1',
          call_id: 'call1',
          name: 'lookup',
          arguments: '',
        },
      },
      expected_types: [],
    },
    {
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'item1',
        delta: '{"x":',
      },
      expected_types: [],
    },
    {
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          id: 'item1',
          call_id: 'call1',
          name: 'lookup',
          arguments: '{"x":1}',
        },
      },
      expected_types: ['tool.call'],
      expected_call: {
        id: 'call1',
        type: 'function',
        function: { name: 'lookup', params: { x: 1 } },
      },
      expected_response_id: 'r1',
    },
    {
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          id: 'item1',
          call_id: 'call1',
          name: 'lookup',
          arguments: '{"x":1}',
        },
      },
      expected_types: [],
    },
    {
      event: {
        type: 'response.completed',
        response: {
          id: 'r1',
          output: [],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        },
      },
      expected_types: ['response.completed'],
      expected_response_id: 'r1',
    },
    {
      event: { type: 'response.completed', response: { id: 'r1', output: [] } },
      expected_types: [],
    },
    {
      event: { type: 'response.created', response: { id: 'r2' } },
      expected_types: [],
    },
    {
      event: { type: 'response.completed', response: { id: 'r2', output: [] } },
      expected_types: ['response.completed'],
      expected_response_id: 'r2',
    },
  ],
});
writeFixture('astra-session-steering-acknowledgements', {
  kind: 'ai_session_events',
  model: AxAIOpenAIModel.GPT6Astra,
  cases: [
    {
      event: {
        type: 'response.steer.accepted',
        steer: { id: 's1', previous_response_id: 'r1' },
      },
      expected_types: ['steering'],
      expected_status: 'accepted',
      expected_response_id: 'r1',
    },
    {
      event: {
        type: 'response.steer.accepted',
        steer: { id: 's1', previous_response_id: 'r1' },
      },
      expected_types: [],
    },
    {
      event: {
        type: 'response.steer.pending',
        steer: { id: 's1', previous_response_id: 'r1' },
        required_input: [{ call_id: 'call1' }],
      },
      expected_types: ['steering'],
      expected_status: 'pending',
      expected_required_call_ids: ['call1'],
    },
    {
      event: {
        type: 'response.steer.pending',
        steer: { id: 's1', previous_response_id: 'r1' },
        required_input: [{ call_id: 'call1' }],
      },
      expected_types: [],
    },
    {
      event: {
        type: 'response.steer.pending',
        steer: { id: 's1', previous_response_id: 'r1' },
        required_input: [{ call_id: 'call2' }],
      },
      expected_types: ['steering'],
      expected_status: 'pending',
      expected_required_call_ids: ['call2'],
    },
    {
      event: {
        type: 'response.steer.failed',
        steer: { id: 's2', previous_response_id: 'r1' },
        error: { message: 'already closed' },
      },
      expected_types: ['steering'],
      expected_status: 'failed',
      expected_error: 'already closed',
    },
  ],
});

writeFixture('astra-pending-results-out-of-order', {
  kind: 'ai_session_state',
  model: AxAIOpenAIModel.GPT6Astra,
  path: 'root/left',
  max_steps: 3,
  cases: [
    {
      event: {
        type: 'tool.validated',
        call: { id: 'a' },
        execution: 'background',
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'tool.validated',
        call: { id: 'b' },
        execution: 'background',
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'tool.validated',
        call: { id: 'a' },
        execution: 'background',
      },
      expected_action: { type: 'wait', changed: false },
    },
    {
      event: { type: 'response.completed', id: 'r1' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'tool.result',
        id: 'b',
        result: { function_id: 'b', result: 'B' },
      },
      expected_action: {
        type: 'submit',
        results: [{ function_id: 'b', result: 'B' }],
        changed: true,
      },
    },
    {
      event: { type: 'results.submitted', ids: ['b'] },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'r2' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'tool.result',
        id: 'a',
        result: { function_id: 'a', result: 'A' },
      },
      expected_action: {
        type: 'submit',
        results: [{ function_id: 'a', result: 'A' }],
        changed: true,
      },
    },
    {
      event: { type: 'results.submitted', ids: ['a'] },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'r3' },
      expected_action: { type: 'validate', changed: true },
    },
    {
      event: { type: 'validated' },
      expected_action: { type: 'closed', changed: true },
    },
  ],
  expected_pending: [],
  expected_steps: 3,
});
writeFixture('astra-scoped-updates-and-cancellation', {
  kind: 'ai_session_state',
  model: AxAIOpenAIModel.GPT6Astra,
  path: 'root/left',
  max_steps: 3,
  cases: [
    {
      event: {
        type: 'update.queued',
        update: {
          id: '1',
          type: 'steer',
          target: 'root/right',
          text: 'Elsewhere',
        },
      },
      expected_action: { type: 'wait', changed: false },
    },
    {
      event: {
        type: 'update.queued',
        update: { id: '2', type: 'steer', target: 'root', text: 'Revise' },
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'update.applied', id: '2' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'update.applied', id: '2' },
      expected_action: { type: 'wait', changed: false },
    },
    {
      event: {
        type: 'tool.validated',
        call: { id: 'unresolved' },
        execution: 'background',
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'closed' },
      expected_action: { type: 'closed', changed: true },
    },
    {
      event: { type: 'tool.result', id: 'unresolved', result: 'too late' },
      expected_action: { type: 'closed', changed: false },
    },
  ],
  expected_pending: ['unresolved'],
  expected_steps: 0,
});

for (const inputTokens of [272000, 272001]) {
  const long = inputTokens > 272000;
  writeFixture(`astra-cache-cost-threshold-${inputTokens}`, {
    kind: 'ai_chat',
    provider: 'openai',
    model: AxAIOpenAIModel.GPT6Astra,
    request: {
      chat_prompt: [{ role: 'user', content: 'measure' }],
      model_config: { stream: false, thinkingTokenBudget: 'low' },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          id: 'r_cost',
          model: AxAIOpenAIModel.GPT6Astra,
          output: [],
          usage: {
            input_tokens: inputTokens,
            output_tokens: 100,
            total_tokens: inputTokens + 100,
            input_tokens_details: {
              cached_tokens: 10000,
              cache_write_tokens: 20000,
            },
          },
        },
      },
    ],
    expected_estimated_cost:
      ((inputTokens - 30000) * (long ? 20 : 10) +
        10000 * (long ? 2 : 1) +
        20000 * (long ? 25 : 12.5) +
        100 * (long ? 75 : 50)) /
      1000000,
  });
}
writeFixture('astra-native-none-rejected', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT6Astra,
  request: {
    chat_prompt: [{ role: 'user', content: 'reason' }],
    model_config: { reasoning: { effort: 'none' } },
  },
  expected_error_contains: 'Invalid Astra reasoning effort',
  expected_transport_request_count: 0,
});
writeFixture('astra-adjacent-reasoning-updates-rejected', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT6Astra,
  request: {
    chat_prompt: [{ role: 'user', content: 'reason' }],
    previous_response_id: 'r1',
    session_input: [
      { type: 'configuration_update', reasoning: { effort: 'low' } },
      { type: 'configuration_update', reasoning: { effort: 'high' } },
    ],
  },
  expected_error_contains: 'Adjacent configuration_update',
  expected_transport_request_count: 0,
});

writeFixture('astra-prompt-cache-content-remains-an-array', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT6Astra,
  service_options: { contextCache: {}, promptCacheKey: 'astra-prefix' },
  request: {
    chat_prompt: [{ role: 'user', content: 'cached' }],
    model_config: { thinkingTokenBudget: 'low' },
  },
  transport_responses: [
    {
      status: 200,
      json: { id: 'r1', model: AxAIOpenAIModel.GPT6Astra, output: [] },
    },
  ],
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/responses',
    json: {
      model: AxAIOpenAIModel.GPT6Astra,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'cached',
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ],
        },
      ],
      reasoning: { effort: 'low' },
      stream: false,
      prompt_cache_key: 'astra-prefix',
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    },
  },
});

writeFixture('astra-defer-final-output-with-pending-work', {
  kind: 'ai_session_state',
  model: AxAIOpenAIModel.GPT6Astra,
  path: 'root',
  max_steps: 3,
  cases: [
    {
      event: {
        type: 'tool.validated',
        call: { id: 'background' },
        execution: 'background',
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'tool.final', call: { id: 'final' } },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'tool.final', call: { id: 'final' } },
      expected_action: { type: 'wait', changed: false },
    },
    {
      event: { type: 'response.completed', id: 'r1' },
      expected_action: {
        type: 'submit',
        changed: true,
        results: [
          {
            function_id: 'final',
            result:
              'Not executed: incorporate the background tool results and queued updates before calling this finalization function again.',
          },
        ],
      },
    },
    {
      event: { type: 'results.submitted', ids: ['final'] },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'tool.result',
        id: 'background',
        result: { function_id: 'background', result: 'REF-42' },
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'r2' },
      expected_action: {
        type: 'submit',
        changed: true,
        results: [{ function_id: 'background', result: 'REF-42' }],
      },
    },
    {
      event: { type: 'results.submitted', ids: ['background'] },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'r3' },
      expected_action: { type: 'validate', changed: true },
    },
    {
      event: { type: 'validated' },
      expected_action: { type: 'closed', changed: true },
    },
  ],
  expected_pending: [],
  expected_steps: 3,
});

writeFixture('astra-native-steering-successor-no-replay', {
  kind: 'ai_session_state',
  model: AxAIOpenAIModel.GPT6Astra,
  path: 'root',
  max_steps: 3,
  cases: [
    {
      event: {
        type: 'update.queued',
        update: {
          id: 'u1',
          type: 'steer',
          target: 'root',
          text: 'Use the corrected answer.',
        },
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'native.queued', id: 'u1' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'parent' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'steering',
        status: 'accepted',
        steer_id: 's1',
        response_id: 'parent',
      },
      expected_action: { type: 'wait', changed: true, applied_id: 'u1' },
    },
    {
      event: {
        type: 'steering',
        status: 'accepted',
        steer_id: 's1',
        response_id: 'parent',
      },
      expected_action: { type: 'wait', changed: false },
    },
    {
      event: { type: 'response.completed', id: 'successor' },
      expected_action: { type: 'validate', changed: true },
    },
    {
      event: { type: 'validated' },
      expected_action: { type: 'closed', changed: true },
    },
    {
      event: {
        type: 'steering',
        status: 'pending',
        steer_id: 's1',
        response_id: 'parent',
        required_call_ids: [],
      },
      expected_action: { type: 'closed', changed: false },
    },
  ],
  expected_pending: [],
  expected_steps: 2,
});
writeFixture('astra-native-late-pending-input', {
  kind: 'ai_session_state',
  model: AxAIOpenAIModel.GPT6Astra,
  path: 'root',
  max_steps: 3,
  cases: [
    {
      event: {
        type: 'tool.validated',
        call: { id: 'c1' },
        execution: 'background',
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'update.queued',
        update: {
          id: 'u1',
          type: 'steer',
          target: 'root',
          text: 'Use the pending result.',
        },
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'native.queued', id: 'u1' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'steering',
        status: 'accepted',
        steer_id: 's1',
        response_id: 'parent',
      },
      expected_action: { type: 'wait', changed: true, applied_id: 'u1' },
    },
    {
      event: { type: 'response.completed', id: 'parent' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'tool.result',
        id: 'c1',
        result: { function_id: 'c1', result: 'REF-42' },
      },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'steering',
        status: 'pending',
        steer_id: 's1',
        response_id: 'parent',
        required_call_ids: ['c1'],
      },
      expected_action: {
        type: 'submit',
        changed: true,
        results: [{ function_id: 'c1', result: 'REF-42' }],
      },
    },
    {
      event: { type: 'results.submitted', ids: ['c1'] },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'successor' },
      expected_action: { type: 'validate', changed: true },
    },
    {
      event: { type: 'validated' },
      expected_action: { type: 'closed', changed: true },
    },
  ],
  expected_pending: [],
  expected_steps: 2,
});

writeFixture('astra-native-successor-before-ack', {
  kind: 'ai_session_state',
  model: AxAIOpenAIModel.GPT6Astra,
  path: 'root',
  max_steps: 4,
  cases: [
    {
      event: { type: 'response.completed', id: 'earlier' },
      expected_action: { type: 'validate', changed: true },
    },
    {
      event: {
        type: 'update.queued',
        update: {
          id: 'u1',
          type: 'steer',
          target: 'root',
          text: 'Correct the answer.',
        },
      },
      expected_action: { type: 'continue', changed: true },
    },
    {
      event: { type: 'native.queued', id: 'u1' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'parent' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: { type: 'response.completed', id: 'successor' },
      expected_action: { type: 'wait', changed: true },
    },
    {
      event: {
        type: 'steering',
        status: 'accepted',
        steer_id: 's1',
        response_id: 'parent',
      },
      expected_action: { type: 'validate', changed: true, applied_id: 'u1' },
    },
    {
      event: {
        type: 'steering',
        status: 'pending',
        steer_id: 's1',
        response_id: 'parent',
        required_call_ids: ['old'],
      },
      expected_action: { type: 'validate', changed: false },
    },
    {
      event: {
        type: 'steering',
        status: 'accepted',
        steer_id: 's1',
        response_id: 'parent',
      },
      expected_action: { type: 'validate', changed: false },
    },
    {
      event: { type: 'validated' },
      expected_action: { type: 'closed', changed: true },
    },
  ],
  expected_pending: [],
  expected_steps: 3,
});

writeFixture('astra-session-provider-errors-preserved', {
  kind: 'ai_session_events',
  model: AxAIOpenAIModel.GPT6Astra,
  cases: [
    {
      event: {
        type: 'response.failed',
        response: {
          id: 'failed-response',
          error: { code: 'server_error', message: 'Fixture provider failure' },
        },
      },
      expected_exception: 'Fixture provider failure',
    },
    {
      event: {
        type: 'error',
        error: {
          code: 'invalid_request_error',
          message: 'Fixture request rejected',
        },
      },
      expected_exception: 'Fixture request rejected',
    },
    {
      event: {
        type: 'response.incomplete',
        response: {
          id: 'limited-response',
          incomplete_details: { reason: 'max_output_tokens' },
        },
      },
      expected_exception: 'max_output_tokens',
    },
  ],
});

writeFixture('astra-session-transport-cursor', {
  kind: 'ai_session_events',
  model: AxAIOpenAIModel.GPT6Astra,
  cases: [
    {
      event: { type: 'response.created', response: { id: 'parent' } },
      expected_types: [],
      expected_active_id: 'parent',
    },
    {
      event: { type: 'response.created', response: { id: 'successor' } },
      expected_types: [],
      expected_active_id: 'successor',
    },
    {
      event: {
        type: 'response.completed',
        response: { id: 'parent', output: [] },
      },
      expected_types: ['response.completed'],
      expected_active_id: 'successor',
    },
    {
      event: { type: 'response.created', response: { id: 'parent' } },
      expected_types: [],
      expected_active_id: 'successor',
    },
    {
      event: {
        type: 'response.incomplete',
        response: {
          id: 'successor',
          output: [],
          incomplete_details: { reason: 'steered' },
        },
      },
      expected_types: ['response.completed'],
      expected_active_id: null,
    },
    {
      event: { type: 'response.created', response: { id: 'successor' } },
      expected_types: [],
      expected_active_id: null,
    },
    {
      event: {
        type: 'response.completed',
        response: { id: 'parent', output: [] },
      },
      expected_types: [],
      expected_active_id: null,
    },
  ],
});

// Evaluate the supported TypeScript validator, then replay identical raw values in every target.
const argumentValidationCases: { schema: any; arguments: Json }[] = [
  { schema: { const: {} }, arguments: null },
  { schema: { const: null }, arguments: {} },
  { schema: { const: false }, arguments: 0 },
  { schema: { enum: [true] }, arguments: 1 },
  { schema: { const: { z: 1, a: 2 } }, arguments: { z: 1, a: 2 } },
  { schema: { const: { z: 1, a: 2 } }, arguments: { a: 2, z: 1 } },
  {
    schema: { enum: [{ nested: [1, null, { z: true, a: false }] }] },
    arguments: { nested: [1, null, { a: false, z: true }] },
  },
  {
    schema: { $defs: { target: false }, $ref: '#/$defs/target' },
    arguments: 2,
  },
  { schema: { $defs: { target: {} }, $ref: '#/$defs/target' }, arguments: 2 },
  { schema: { allOf: [{ type: 'integer' }], $ref: '#/allOf/0' }, arguments: 2 },
  {
    schema: { allOf: [{ type: 'integer' }], $ref: '#/allOf/0' },
    arguments: '2',
  },
  {
    schema: { allOf: [{ type: 'integer' }], $ref: '#/allOf/00' },
    arguments: 2,
  },
  { schema: { type: 'integer' }, arguments: 1.5 },
  { schema: { type: ['string', 'null'] }, arguments: null },
  { schema: { type: ['string', 'null'] }, arguments: 3 },
  { schema: { minimum: 2, maximum: 4 }, arguments: 2 },
  { schema: { minimum: 2, maximum: 4 }, arguments: 1 },
  { schema: { minimum: 2, maximum: 4 }, arguments: 5 },
  { schema: { minLength: 2, maxLength: 2 }, arguments: '😀a' },
  { schema: { minLength: 2 }, arguments: '😀' },
  { schema: { maxLength: 1 }, arguments: '😀a' },
  { schema: { pattern: '[A-Z]{2}[0-9]+' }, arguments: 'prefix AB12 suffix' },
  { schema: { pattern: '^[A-Z]{2}[0-9]+$' }, arguments: 'prefix AB12 suffix' },
  { schema: { enum: ['a', 2, null] }, arguments: null },
  { schema: { enum: ['a', 2, null] }, arguments: '2' },
  { schema: { const: { a: [1, true] } }, arguments: { a: [1, true] } },
  { schema: { const: null }, arguments: false },
  { schema: { allOf: [{ minimum: 2 }, { maximum: 4 }] }, arguments: 5 },
  {
    schema: { anyOf: [{ type: 'integer' }, { const: 'yes' }] },
    arguments: 'yes',
  },
  {
    schema: { anyOf: [{ type: 'integer' }, { const: 'yes' }] },
    arguments: 'no',
  },
  {
    schema: { oneOf: [{ type: 'number' }, { type: 'integer' }] },
    arguments: 2,
  },
  {
    schema: { oneOf: [{ type: 'number' }, { type: 'integer' }] },
    arguments: 2.5,
  },
  { schema: { anyOf: [] }, arguments: {} },
  {
    schema: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: { type: 'integer' },
    },
    arguments: [1, 2],
  },
  { schema: { minItems: 2 }, arguments: [1] },
  { schema: { maxItems: 1 }, arguments: [1, 2] },
  { schema: { items: { type: 'integer' } }, arguments: [1, '2'] },
  {
    schema: {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    },
    arguments: { a: 'ok', extra: true },
  },
  { schema: { required: ['a'] }, arguments: {} },
  {
    schema: { additionalProperties: { type: 'integer', minimum: 0 } },
    arguments: { a: 1, b: -1 },
  },
  {
    schema: { additionalProperties: { type: 'integer', minimum: 0 } },
    arguments: { a: 1, b: 2 },
  },
  {
    schema: {
      $defs: { 'a/b~c': { type: 'integer', minimum: 2 } },
      $ref: '#/$defs/a~1b~0c',
    },
    arguments: 3,
  },
  {
    schema: {
      $defs: { n: { type: 'integer' } },
      properties: { nested: { items: { $ref: '#/$defs/n' } } },
    },
    arguments: { nested: [1, 'bad'] },
  },
  { schema: { $ref: '#/missing' }, arguments: {} },
  { schema: { $ref: 'https://example.com/schema' }, arguments: {} },
  {
    schema: { $defs: { loop: { $ref: '#/$defs/loop' } }, $ref: '#/$defs/loop' },
    arguments: {},
  },
  {
    schema: {
      $defs: { n: { type: 'integer' } },
      $ref: '#/$defs/n',
      type: 'string',
    },
    arguments: 3,
  },
];
writeFixture('session-raw-argument-validation', {
  kind: 'ai_session_state',
  model: 'gpt-6-astra',
  path: 'root',
  max_steps: 3,
  cases: [],
  expected_pending: [],
  expected_steps: 0,
  validation_cases: argumentValidationCases.map((item) => {
    let valid = true;
    try {
      axValidateToolArguments(item.schema, item.arguments);
    } catch {
      valid = false;
    }
    return { ...item, valid };
  }),
});
const ecmaSchemaPatterns: readonly string[] = [
  '(?<=a+)b',
  '(?<!a)b',
  '(a|b)\\1',
  '(?<x>a+)b\\k<x>',
  '\\1(a)',
  '(a)?b\\1',
  '(a|(b))+\\2',
  '(?=(a+))a*b\\1',
  '(?<=([ab]+)([bc]+))$',
  '^.$',
  '^..$',
  '\\w',
  '\\d',
  '\\s',
  'a$',
  '[^]',
  '[]',
  '[^a-c]',
  '[\\d-a]',
  '\\c_',
  '[\\c_]',
  '\\u{61}',
  '\\u12',
  '\\xzz',
  '\\8',
  '\\123',
  'a{,2}',
  'a{2,1}',
  '(?=a)?a',
  '(a*)*b',
  '(?:a|ab)*?b',
  '(a?){2}\\1',
  '(?<x>a)\\k<bad>',
  '{2}',
  '(?<1>a)',
  '(?<=\\1(a))b',
  '(?<x>a)|(?<x>b)',
  '(?:(?<x>a)|(?<x>b))+\\k<x>',
  '(?<\\u0061>a)\\k<a>',
  '(?<π>a)\\k<π>',
  '(?<😀>a)',
  '(?<x>a)(?<x>b)',
  '^a[ab]$',
];
const ecmaSchemaInputs: readonly string[] = [
  '',
  'a',
  'b',
  'ab',
  'aa',
  'aaa',
  'aaab',
  'aabaaa',
  'abc',
  'aba',
  'abab',
  'ba',
  'a\n',
  '😀',
  'é',
  '١',
  ' ',
  ' ',
  '﻿',
  'S',
  'u{61}',
  'u12',
  'xzz',
  '8',
  '\\c_',
  '\u001f',
  'baaabac',
];
writeFixture('session-ecmascript-pattern-validation', {
  kind: 'ai_session_state',
  model: 'gpt-6-astra',
  path: 'root',
  max_steps: 3,
  cases: [],
  expected_pending: [],
  expected_steps: 0,
  validation_cases: [
    ...ecmaSchemaPatterns.flatMap((pattern) =>
      ecmaSchemaInputs.map((input) => ({
        schema: { pattern },
        arguments: input,
      }))
    ),
    { schema: { pattern: '^(a|a)*$' }, arguments: 'a'.repeat(10000) },
    { schema: { pattern: '^.+$' }, arguments: 'a'.repeat(10000) },
    { schema: { pattern: '^(){1000}$' }, arguments: '' },
  ].map((item) => {
    let valid = true;
    try {
      axValidateToolArguments(item.schema, item.arguments);
    } catch {
      valid = false;
    }
    return { ...item, valid };
  }),
});
