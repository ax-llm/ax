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

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)])
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
    showThoughts: false,
    structuredOutputs: false,
    temperature: true,
    topP: true,
    audioInput: false,
    audioOutput: false,
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
    filterOptions: ['all', 'text', 'embeddings', 'code', 'audio'],
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

for (const [fixtureName, model] of [
  ['gemini-37-flash-server-managed-sampling', 'gemini-3.7-flash'],
  ['gemini-36-flash-server-managed-sampling', 'gemini-3.6-flash'],
  ['gemini-35-flash-lite-server-managed-sampling', 'gemini-3.5-flash-lite'],
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
          candidateCount: 1,
          maxOutputTokens: 64,
          responseMimeType: 'text/plain',
        },
      },
    },
    expected_transport_json_absent: [
      'generationConfig.temperature',
      'generationConfig.topP',
      'generationConfig.topK',
    ],
  });
}

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
            id: 'search',
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
