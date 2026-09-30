import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { AxAIAnthropic } from '../../../src/ax/ai/anthropic/api.js';
import { AxAIAnthropicModel } from '../../../src/ax/ai/anthropic/types.js';
import { AxBalancer } from '../../../src/ax/ai/balance.js';
import {
  AxInMemoryBalancerStatsStore,
  axUpdateBalancerRouteStats,
  createBalancerRouteStats,
  sampleBalancerRouteHealth,
} from '../../../src/ax/ai/balance_adaptive.js';
import { resetDroppedSamplingWarnings } from '../../../src/ax/ai/base.js';
import { axGetSupportedAIModels } from '../../../src/ax/ai/catalog.js';
import { AxAICohereEmbedModel } from '../../../src/ax/ai/cohere/types.js';
import {
  AxAIGoogleGemini,
  axAIGoogleGeminiLiveAudioDefaultConfig,
} from '../../../src/ax/ai/google-gemini/api.js';
import {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
} from '../../../src/ax/ai/google-gemini/types.js';
import { AxMultiServiceRouter } from '../../../src/ax/ai/multiservice.js';
import { AxAIOpenAI } from '../../../src/ax/ai/openai/api.js';
import { AxAIOpenAIModel } from '../../../src/ax/ai/openai/chat_types.js';
import {
  axResolveOpenAIChatReasoningEffort,
  axResolveOpenAIResponsesReasoningEffort,
} from '../../../src/ax/ai/openai/effort.js';
import { AxAIOpenAIResponses } from '../../../src/ax/ai/openai/responses_api_base.js';
import { axGetAIProfile } from '../../../src/ax/ai/provider_profiles.js';
import { AxProviderRouter } from '../../../src/ax/ai/router.js';
import { ai } from '../../../src/ax/ai/wrap.js';
import {
  axAIGrokDefaultConfig,
  axAIGrokVoiceDefaultConfig,
} from '../../../src/ax/ai/x-grok/api.js';
import { axValidateToolArguments } from '../../../src/ax/dsp/toolArguments.js';
import {
  AxAIServiceAuthenticationError,
  AxAIServiceError,
  AxAIServiceNetworkError,
  AxAIServiceResponseError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
  apiCall,
} from '../../../src/ax/util/apicall.js';
import {
  goldenValue,
  NumberLiteral,
  restoreNumberLiterals,
} from './number-literals.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axai'
);

function stable(value: unknown, preserveOrder = false): unknown {
  if (value instanceof NumberLiteral) return value;
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
    `${restoreNumberLiterals(JSON.stringify(stable({ name, ...fixture }), null, 2))}\n`
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
// The simple-chat fixtures check that sampling parameters reach the wire, so
// they pin models that still accept them: the current defaults (Claude
// Sonnet 5, Gemini 3.6 Flash) drop temperature and candidate counts, and the
// Gemini API returns one candidate on every Gemini 3 model (probed 2026-09-27).
const anthropicSamplingModel = 'claude-haiku-4-5';
const geminiSamplingModel = 'gemini-2.5-flash';
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

  validateChatRequest(req: any) {
    if (this.name === 'Typesafe')
      new AxAITypesafe({ apiKey: 'fixture' }).validateChatRequest(req);
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

// A single client's `models` list maps keys to real models (AxBaseAI
// getModelByKey). A request that names a key sends the key's model and gets the
// key's modelConfig and option defaults underneath its own settings; a key used
// as the client default resolves the model id only.
const modelKeyList = [
  {
    key: 'smart',
    model: 'gpt-5.4',
    description: 'Smarter answers',
    modelConfig: { maxTokens: 64 },
    thinkingTokenBudget: 'low',
  },
  {
    key: 'embed-small',
    embedModel: 'text-embedding-3-small',
    description: 'Small embeddings',
  },
];
const modelKeyChatResponse = [
  {
    status: 200,
    json: {
      id: 'chatcmpl_model_key',
      object: 'chat.completion',
      model: 'gpt-5.4',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'ok' },
        },
      ],
    },
  },
];

writeFixture('openai-model-key-resolves-model-and-defaults', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-5.4-mini',
  service_options: { models: modelKeyList },
  request: {
    model: 'smart',
    chat_prompt: [{ role: 'user', content: 'Hi' }],
    model_config: { stream: false },
  },
  transport_responses: modelKeyChatResponse,
  expected_transport_request: {
    json: {
      model: 'gpt-5.4',
      max_completion_tokens: 64,
      reasoning_effort: 'medium',
    },
  },
});

writeFixture('openai-model-key-request-config-overrides-key-defaults', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-5.4-mini',
  service_options: { models: modelKeyList },
  request: {
    model: 'smart',
    chat_prompt: [{ role: 'user', content: 'Hi' }],
    model_config: { stream: false, maxTokens: 32 },
  },
  transport_responses: modelKeyChatResponse,
  expected_transport_request: {
    json: {
      model: 'gpt-5.4',
      max_completion_tokens: 32,
      reasoning_effort: 'medium',
    },
  },
});

writeFixture('openai-model-key-client-default-resolves-model-only', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'smart',
  service_options: { models: modelKeyList },
  request: {
    chat_prompt: [{ role: 'user', content: 'Hi' }],
    model_config: { stream: false },
  },
  transport_responses: modelKeyChatResponse,
  expected_transport_request: { json: { model: 'gpt-5.4' } },
  expected_transport_json_absent: ['max_completion_tokens', 'reasoning_effort'],
});

writeFixture('openai-model-key-resolves-embed-model', {
  kind: 'ai_embed',
  provider: 'openai',
  model: 'gpt-5.4-mini',
  embed_model: 'text-embedding-3-large',
  service_options: { models: modelKeyList },
  request: { texts: ['a'], embed_model: 'embed-small' },
  transport_responses: [
    {
      status: 200,
      json: {
        data: [{ embedding: [0.1], index: 0 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      },
    },
  ],
  expected_transport_request: { json: { model: 'text-embedding-3-small' } },
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
  model: responsesDefaultModel,
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
      max_output_tokens: 64,
      reasoning: { effort: 'low' },
      include: ['file_search_call.results'],
    },
  },
  // The default model's info marks temperature notSupported, so the
  // request's temperature never reaches the wire.
  expected_transport_json_absent: ['temperature'],
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
  // The nested Chat Completions shape is a 400 on the Responses API.
  expected_transport_json_absent: ['text.format.json_schema'],
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

// TypeScript's AxSpeechResponse for one speak response, from the provider's
// real speak() against a fetch stub. Mistral and Grok go through ai(), which
// builds their provider profiles.
async function tsSpeechResponse(
  provider: 'openai' | 'google-gemini' | 'mistral' | 'grok',
  request: Record<string, unknown>,
  response: () => Response
): Promise<{ output: Record<string, Json>; body: Json; url: string }> {
  let body: Json = null;
  let url = '';
  const fetch = async (target: unknown, init?: RequestInit) => {
    url = String(target);
    body = JSON.parse(String(init?.body ?? 'null')) as Json;
    return response();
  };
  const client =
    provider === 'openai'
      ? new AxAIOpenAI({ apiKey: 'test-key', options: { fetch } })
      : provider === 'google-gemini'
        ? new AxAIGoogleGemini({ apiKey: 'test-key', options: { fetch } })
        : ai({
            name: provider,
            apiKey: 'test-key',
            options: { fetch },
          } as never);
  const output = await client.speak(request as never);
  return {
    output: JSON.parse(JSON.stringify(output)) as Record<string, Json>,
    body,
    url,
  };
}

// TypeScript's speak() error message for one response, or '' when it
// resolves.
async function tsSpeechError(
  provider: 'openai' | 'google-gemini',
  request: Record<string, unknown>,
  response: () => Response
): Promise<string> {
  try {
    await tsSpeechResponse(provider, request, response);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const jsonResponse = (json: unknown) => () =>
  new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const binaryResponse = (bytes: Uint8Array, contentType: string) => () =>
  new Response(bytes, {
    status: 200,
    headers: { 'content-type': contentType },
  });

// Speech outputs now use TypeScript's exact response keys.
function portSpeechOutput(
  _older: Record<string, Json>,
  ts: Record<string, Json>
): Record<string, Json> {
  return ts;
}

// The Responses profile delegates speech to the OpenAI speech endpoint.
writeFixture('responses-speak', {
  kind: 'ai_speak',
  provider: 'openai-responses',
  request: { text: 'hello', voice: 'alloy', format: 'mp3' },
  transport_responses: [{ status: 200, json: { data: 'base64-speech' } }],
  expected_output: {
    format: 'mp3',
    data: 'base64-speech',
    mimeType: 'audio/mpeg',
    transcript: 'hello',
  },
  expected_transport_request: {
    url: 'https://api.openai.com/v1/audio/speech',
    json: {
      model: 'gpt-4o-mini-tts',
      input: 'hello',
      voice: 'alloy',
      response_format: 'mp3',
    },
  },
});

// OpenAI's /audio/speech answers with the audio bytes. A port's transport
// hands a binary speak body on as base64 text, here with no Content-Type, so
// the mime type comes from the format; TS reads the same bytes with
// Content-Type audio/mpeg, the mime type of mp3.
{
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
  const request = {
    text: 'Hello there',
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    format: 'mp3',
  };
  const ts = await tsSpeechResponse(
    'openai',
    request,
    () =>
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
  );
  writeFixture('openai-speak-binary-body', {
    kind: 'ai_speak',
    provider: 'openai',
    request,
    transport_responses: [
      { status: 200, body: Buffer.from(bytes).toString('base64') },
    ],
    expected_output: portSpeechOutput(
      { audio: Buffer.from(bytes).toString('base64'), format: 'mp3' },
      ts.output
    ),
    expected_transport_request: {
      url: 'https://api.openai.com/v1/audio/speech',
      json: ts.body,
    },
  });
}

// Speak requests and responses as TypeScript's real providers build and read
// them: OpenAI's defaults (gpt-4o-mini-tts, a voice object's id, pcm sent as
// pcm16, speed), Mistral's and Grok's profile dialects, the JSON bodies
// axFetchJsonSpeech reads, and Gemini audio with no or snake_case mime data.
// Ports return the exact TypeScript response shape.
{
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
  const pcm = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
  const speakFixture = async (
    name: string,
    provider: 'openai' | 'google-gemini' | 'mistral' | 'grok',
    request: Record<string, unknown>,
    response: () => Response,
    transport: Record<string, Json>,
    older: (ts: Record<string, Json>) => Record<string, Json>
  ) => {
    const ts = await tsSpeechResponse(provider, request, response);
    // The runners compare the request as a subset, so name the speech keys
    // TS leaves out (such as Mistral's `voice`) that a port must leave out.
    const tsKeys = Object.keys((ts.body ?? {}) as Record<string, Json>);
    const absent = [
      'model',
      'voice',
      'voice_id',
      'speed',
      'response_format',
      'language',
    ].filter((key) => !tsKeys.includes(key));
    writeFixture(name, {
      kind: 'ai_speak',
      provider,
      request: request as Json,
      transport_responses: [{ status: 200, ...transport }],
      expected_output: portSpeechOutput(older(ts.output), ts.output),
      expected_transport_request: { url: ts.url, json: ts.body },
      expected_transport_json_absent: absent,
    });
  };
  const binaryOlder = (ts: Record<string, Json>) => ({
    audio: ts.data,
    format: ts.format,
  });

  await speakFixture(
    'openai-speak-default-model',
    'openai',
    { text: 'Hello there' },
    binaryResponse(mp3, 'audio/mpeg'),
    { body: b64(mp3) },
    binaryOlder
  );
  // The port never sees the Content-Type of a binary body, so the stub sends
  // the type TS's axAudioMimeType gives pcm.
  await speakFixture(
    'openai-speak-voice-object-speed-pcm',
    'openai',
    { text: 'Hello there', voice: { id: 'verse' }, speed: 1.25, format: 'pcm' },
    binaryResponse(pcm, 'audio/pcm'),
    { body: b64(pcm) },
    binaryOlder
  );
  await speakFixture(
    'mistral-speak-default-model',
    'mistral',
    { text: 'Hello there' },
    binaryResponse(mp3, 'audio/mpeg'),
    { body: b64(mp3) },
    binaryOlder
  );
  await speakFixture(
    'mistral-speak-voice-id',
    'mistral',
    { text: 'Hello there', voice: 'Paul', format: 'wav' },
    binaryResponse(wav, 'audio/wav'),
    { body: b64(wav) },
    binaryOlder
  );
  await speakFixture(
    'grok-speak-speed',
    'grok',
    { text: 'Hello there', speed: 1.2 },
    binaryResponse(mp3, 'audio/mpeg'),
    { body: b64(mp3) },
    binaryOlder
  );
  // A binary body's Content-Type is its mime type (here with a rate), as TS
  // reads it; the ports' hosts hand it on beside the base64 body.
  await speakFixture(
    'openai-speak-binary-content-type',
    'openai',
    { text: 'Hello there', format: 'pcm' },
    binaryResponse(pcm, 'audio/pcm;rate=24000'),
    { body: b64(pcm), headers: { 'content-type': 'audio/pcm;rate=24000' } },
    binaryOlder
  );
  await speakFixture(
    'openai-speak-json-audio-data',
    'openai',
    { text: 'Hello there' },
    jsonResponse({ audio_data: b64(mp3) }),
    { json: { audio_data: b64(mp3) } },
    binaryOlder
  );
  // A JSON Content-Type makes the body JSON, as TS reads it, even for an
  // operation that answers with binary audio.
  await speakFixture(
    'openai-speak-json-content-type-body',
    'openai',
    { text: 'Hello there' },
    jsonResponse({ audio_data: b64(mp3) }),
    {
      body: JSON.stringify({ audio_data: b64(mp3) }),
      headers: { 'content-type': 'application/json' },
    },
    binaryOlder
  );
  await speakFixture(
    'openai-speak-json-nested-audio-and-mime-type',
    'openai',
    { text: 'Hello there', format: 'wav' },
    jsonResponse({ audio: { data: b64(wav) }, mimeType: 'audio/wav' }),
    { json: { audio: { data: b64(wav) }, mimeType: 'audio/wav' } },
    binaryOlder
  );
  // Reject both missing data and the removed bare audio-string fallback.
  for (const body of [{ status: 'ok' }, { audio: 'legacy-base64' }]) {
    const request = { text: 'Hello there' };
    const message = await tsSpeechError('openai', request, jsonResponse(body));
    if (!message) throw new Error('TS speak accepted a JSON body without data');
    writeFixture(
      'audio' in body
        ? 'openai-speak-json-legacy-audio-rejected'
        : 'openai-speak-json-without-audio-data',
      {
        kind: 'ai_error',
        method: 'speak',
        provider: 'openai',
        request,
        transport_responses: [{ status: 200, json: body }],
        expected_error_contains: message,
      }
    );
  }
  const geminiOlder = (ts: Record<string, Json>) => ({
    audio: ts.data,
    format: ts.format,
  });
  await speakFixture(
    'gemini-tts-no-mime-type',
    'google-gemini',
    { text: 'Hello from Ax.' },
    jsonResponse({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ inlineData: { data: b64(pcm) } }],
          },
        },
      ],
    }),
    {
      json: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ inlineData: { data: b64(pcm) } }],
            },
          },
        ],
      },
    },
    geminiOlder
  );
  await speakFixture(
    'gemini-tts-snake-case-inline-data',
    'google-gemini',
    { text: 'Hello from Ax.' },
    jsonResponse({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { inline_data: { data: b64(wav), mime_type: 'audio/wav' } },
            ],
          },
        },
      ],
    }),
    {
      json: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { inline_data: { data: b64(wav), mime_type: 'audio/wav' } },
              ],
            },
          },
        ],
      },
    },
    (ts) => ({ ...geminiOlder(ts), mime_type: ts.mimeType })
  );
}

// Chat wire bodies from TS's real OpenAI and Anthropic-profile chat against a
// fetch stub.
{
  const openaiResponse: Record<string, Json> = {
    id: 'chatcmpl_wire',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'ok' },
      },
    ],
  };
  const wireFixture = async (
    name: string,
    provider: 'openai' | 'meta-messages',
    chatPrompt: Json,
    response: Record<string, Json>,
    pick: (body: Record<string, Json>) => Record<string, Json>
  ) => {
    let body: Record<string, Json> = {};
    const fetch = async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, Json>;
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client =
      provider === 'openai'
        ? new AxAIOpenAI({ apiKey: 'test-key', options: { fetch } })
        : ai({
            name: provider,
            apiKey: 'test-key',
            options: { fetch },
          } as never);
    await client.chat({ chatPrompt } as never, { stream: false });
    writeFixture(name, {
      kind: 'ai_chat',
      provider,
      request: { chat_prompt: chatPrompt, model_config: { stream: false } },
      transport_responses: [{ status: 200, json: response }],
      expected_transport_request: { json: pick(body) },
    });
  };
  // A url part reaches the model as text: its cached content, or else its
  // title, description and url, each that is set on its own line. (TS's
  // Responses mapping writes the same text, but its user input item also
  // carries `type: 'message'`, which the ports' Responses mapping leaves out.)
  const urlPrompt: Json = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Read these' },
        {
          type: 'url',
          url: 'https://example.com/',
          title: 'Example',
          description: 'A sample page',
        },
        { type: 'url', url: 'https://example.org/' },
      ],
    },
  ];
  await wireFixture(
    'openai-url-part-as-text',
    'openai',
    urlPrompt,
    openaiResponse,
    (body) => ({ messages: body.messages })
  );
  // A file part's filename reaches OpenAI: Chat Completions rejects inline
  // file data without one (HTTP 400, "Missing required parameter:
  // 'messages[0].content[1].file.file_id'").
  await wireFixture(
    'openai-file-part-filename',
    'openai',
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize it' },
          {
            type: 'file',
            mimeType: 'application/pdf',
            data: 'JVBERi0=',
            filename: 'report.pdf',
          },
        ],
      },
    ],
    openaiResponse,
    (body) => ({ messages: body.messages })
  );
  // Chat Completions input audio: a part without a format takes it from its
  // mime type, and only data and format go out (OpenAI answers HTTP 400 to
  // any other input_audio key).
  await wireFixture(
    'openai-audio-part-format-from-mime-type',
    'openai',
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is said?' },
          {
            type: 'audio',
            data: 'UklGRg==',
            mimeType: 'audio/wav',
            sampleRate: 24000,
            channels: 1,
          },
        ],
      },
    ],
    openaiResponse,
    (body) => ({ messages: body.messages })
  );
  // With neither a format nor a mime type, TS rejects the part with its
  // message.
  {
    let message = '';
    try {
      await new AxAIOpenAI({
        apiKey: 'test-key',
        options: { fetch: async () => new Response('{}') },
      }).chat(
        {
          chatPrompt: [
            { role: 'user', content: [{ type: 'audio', data: 'UklGRg==' }] },
          ],
        } as never,
        { stream: false }
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message.includes('unknown format')) {
      throw new Error(`TS accepted audio of unknown format: ${message}`);
    }
    writeFixture('openai-audio-part-unknown-format', {
      kind: 'ai_error',
      method: 'chat',
      provider: 'openai',
      request: {
        chat_prompt: [
          { role: 'user', content: [{ type: 'audio', data: 'UklGRg==' }] },
        ],
        model_config: { stream: false },
      },
      transport_responses: [],
      expected_error_contains: message,
    });
  }
  // TS's Responses mapping sends an audio part's format as it is, so a part
  // without one sends none. (No OpenAI Responses model takes audio input
  // today: "Audio input is not available.")
  {
    let body: Record<string, Json> = {};
    const fetch = async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, Json>;
      return new Response(
        JSON.stringify({
          id: 'resp_audio',
          output: [
            {
              id: 'msg_audio',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'ok' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };
    const chatPrompt = [
      { role: 'user', content: [{ type: 'audio', data: 'UklGRg==' }] },
    ];
    await new AxAIOpenAIResponses({
      apiKey: 'test-key',
      options: { fetch },
    }).chat({ chatPrompt } as never, { stream: false });
    const input = body.input as { content: { input_audio?: Json }[] }[];
    const inputAudio = input[0]?.content[0]?.input_audio;
    if (JSON.stringify(inputAudio) !== JSON.stringify({ data: 'UklGRg==' })) {
      throw new Error(`TS Responses audio part: ${JSON.stringify(inputAudio)}`);
    }
    writeFixture('responses-audio-part-without-format', {
      kind: 'ai_chat',
      provider: 'openai-responses',
      request: { chat_prompt: chatPrompt, model_config: { stream: false } },
      transport_responses: [
        {
          status: 200,
          json: {
            id: 'resp_audio',
            output: [
              {
                id: 'msg_audio',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'ok' }],
              },
            ],
          },
        },
      ],
      // The user input item's other keys differ (TS adds type: 'message'),
      // so the wire bytes pin the audio part alone.
      expected_transport_wire_json_contains: [
        '"input_audio":{"data":"UklGRg=="}',
      ],
    });
  }
  await wireFixture(
    'meta-messages-url-part-as-text',
    'meta-messages',
    urlPrompt,
    {
      id: 'meta-messages-url',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    (body) => ({ messages: body.messages })
  );
}

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

// As in TS (responses_api.ts), an OpenAI Responses request sends the call's
// promptCacheRetention; GPT-6 Astra refuses it, so TS strips it there
// (responses_client.ts).
for (const [name, model, sent] of [
  ['openai-responses-prompt-cache-retention', 'gpt-5.4-mini', true],
  ['openai-responses-astra-drops-prompt-cache-retention', 'gpt-6-astra', false],
] as const) {
  writeFixture(name, {
    kind: 'ai_chat',
    provider: 'openai-responses',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'hi' }],
      model_config: { stream: false },
    },
    options: { promptCacheRetention: '24h' },
    transport_responses: [
      {
        status: 200,
        json: {
          id: 'r1',
          model,
          output: [
            {
              type: 'message',
              id: 'm1',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'ok' }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ],
    ...(sent
      ? {
          expected_transport_request: {
            json: { prompt_cache_retention: '24h' },
          },
        }
      : { expected_transport_json_absent: ['prompt_cache_retention'] }),
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

// Extended thinking can say a short acknowledgement, end that turn with the
// interaction IN_PROGRESS, think, and then answer in a second turn.
const geminiLiveTurnOutput = (
  remoteId: string,
  content: string,
  finishReason: string | null
) => ({
  results: [
    {
      index: 0,
      id: '0',
      content,
      function_calls: [],
      finish_reason: finishReason,
    },
  ],
  remote_id: remoteId,
  model_usage: null,
});

writeFixture('gemini-live-realtime-audio-extended-thinking-two-turns', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  model: 'gemini-3.8-live-extended-thinking',
  events: [
    {
      id: 'gemini_live_ack',
      serverContent: { outputTranscription: { text: 'Let me think.' } },
    },
    {
      id: 'gemini_live_ack_done',
      serverContent: { turnComplete: true, interactionStatus: 'IN_PROGRESS' },
    },
    {
      id: 'gemini_live_answer',
      serverContent: { outputTranscription: { text: 'Hello there.' } },
    },
    {
      id: 'gemini_live_answer_more',
      serverContent: { outputTranscription: { text: ' How are you?' } },
    },
    {
      id: 'gemini_live_done',
      serverContent: { turnComplete: true, interactionStatus: 'IDLE' },
    },
  ],
  expected_output: [
    geminiLiveTurnOutput('gemini_live_ack', 'Let me think.', null),
    geminiLiveTurnOutput('gemini_live_ack_done', '', null),
    geminiLiveTurnOutput('gemini_live_answer', ' Hello there.', null),
    geminiLiveTurnOutput('gemini_live_answer_more', ' How are you?', null),
    geminiLiveTurnOutput('gemini_live_done', '', 'stop'),
  ],
});

writeFixture('gemini-live-realtime-audio-turn-break-keeps-existing-space', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  model: 'gemini-3.8-live-extended-thinking',
  events: [
    {
      id: 'gemini_live_ack',
      serverContent: { outputTranscription: { text: 'One moment. ' } },
    },
    {
      id: 'gemini_live_ack_done',
      serverContent: { turnComplete: true, interactionStatus: 'IN_PROGRESS' },
    },
    {
      id: 'gemini_live_answer',
      serverContent: { outputTranscription: { text: 'Done.' } },
    },
    {
      id: 'gemini_live_done',
      serverContent: { turnComplete: true, interactionStatus: 'IDLE' },
    },
  ],
  expected_output: [
    geminiLiveTurnOutput('gemini_live_ack', 'One moment. ', null),
    geminiLiveTurnOutput('gemini_live_ack_done', '', null),
    geminiLiveTurnOutput('gemini_live_answer', 'Done.', null),
    geminiLiveTurnOutput('gemini_live_done', '', 'stop'),
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
  model: anthropicSamplingModel,
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
        model: anthropicSamplingModel,
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
      model: anthropicSamplingModel,
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
      model: anthropicSamplingModel,
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
  model: geminiSamplingModel,
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
        modelVersion: geminiSamplingModel,
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
      model: geminiSamplingModel,
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
        modelVersion: geminiSamplingModel,
        mapsWidgetContextToken: 'maps-token',
      },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiSamplingModel}:generateContent`,
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
        temperature: 0.2,
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
              parametersJsonSchema: {
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
  model: geminiSamplingModel,
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
              parametersJsonSchema: {
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

// fn() emits additionalProperties: false on every object schema. Gemini's
// OpenAPI-subset `parameters` field rejects it (and nullable type unions) with
// HTTP 400, so tool schemas must travel unchanged as `parametersJsonSchema`.
const geminiFnToolSchema: Json = {
  type: 'object',
  title: 'Schema',
  properties: {
    city: { type: 'string', description: 'City' },
    options: {
      type: 'object',
      properties: {
        units: { type: ['string', 'null'], description: 'Units' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  required: ['city'],
  additionalProperties: false,
};

writeFixture('gemini-tool-parameters-json-schema', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  request: {
    chat_prompt: [{ role: 'user', content: 'Weather in Paris?' }],
    functions: [
      {
        name: 'getWeather',
        description: 'Get the current weather for a city',
        parameters: geminiFnToolSchema,
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
                    id: 'weather-call-1',
                    name: 'getWeather',
                    args: { city: 'Paris' },
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
            id: 'weather-call-1',
            type: 'function',
            function: { name: 'getWeather', params: { city: 'Paris' } },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    model_usage: null,
  },
  expected_transport_request: {
    json: {
      tools: [
        {
          function_declarations: [
            {
              name: 'getWeather',
              description: 'Get the current weather for a city',
              parametersJsonSchema: geminiFnToolSchema,
            },
          ],
        },
      ],
      toolConfig: { function_calling_config: { mode: 'AUTO' } },
    },
  },
});

// Gemini 3 signs function-call turns with an opaque thoughtSignature. It must be
// captured into thought_blocks and replayed as thought_signature on the first
// functionCall part of that turn, or the next tool-loop request is rejected
// with HTTP 400 "Function call is missing a thought_signature".
const geminiWeatherFunction: Json = {
  name: 'getWeather',
  description: 'Get the current weather for a city',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
};

writeFixture('gemini-3-thought-signature-function-call-capture', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.6-flash',
  request: {
    chat_prompt: [{ role: 'user', content: 'Weather in Paris and Rome?' }],
    functions: [geminiWeatherFunction],
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
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'weather-paris',
                    name: 'getWeather',
                    args: { city: 'Paris' },
                  },
                  thoughtSignature: 'sig-weather-step-1',
                },
                {
                  functionCall: {
                    id: 'weather-rome',
                    name: 'getWeather',
                    args: { city: 'Rome' },
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
            id: 'weather-paris',
            type: 'function',
            function: { name: 'getWeather', params: { city: 'Paris' } },
          },
          {
            id: 'weather-rome',
            type: 'function',
            function: { name: 'getWeather', params: { city: 'Rome' } },
          },
        ],
        thought_blocks: [
          { data: '', encrypted: false, signature: 'sig-weather-step-1' },
        ],
        finish_reason: 'function_call',
      },
    ],
    model_usage: null,
  },
  expected_transport_request: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
  },
});

writeFixture('gemini-3-thought-summary-signature-capture', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.6-flash',
  request: {
    chat_prompt: [{ role: 'user', content: 'Weather in Paris?' }],
    functions: [geminiWeatherFunction],
    model_config: { stream: false, showThoughts: true },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              role: 'model',
              parts: [
                { text: 'Look up the Paris forecast.', thought: true },
                {
                  functionCall: {
                    id: 'weather-paris',
                    name: 'getWeather',
                    args: { city: 'Paris' },
                  },
                  thought_signature: 'sig-summary-step-1',
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
        thought: 'Look up the Paris forecast.',
        thought_blocks: [
          {
            data: 'Look up the Paris forecast.',
            encrypted: false,
            signature: 'sig-summary-step-1',
          },
        ],
        function_calls: [
          {
            id: 'weather-paris',
            type: 'function',
            function: { name: 'getWeather', params: { city: 'Paris' } },
          },
        ],
        finish_reason: 'function_call',
      },
    ],
    model_usage: null,
  },
  expected_transport_request: {
    json: { generationConfig: { thinkingConfig: { includeThoughts: true } } },
  },
});

writeFixture('gemini-3-thought-signature-stream-capture', {
  kind: 'ai_stream',
  provider: 'google-gemini',
  model: 'gemini-3.6-flash',
  request: {
    chat_prompt: [{ role: 'user', content: 'Weather in Paris?' }],
    functions: [geminiWeatherFunction],
    model_config: { stream: true },
  },
  transport_responses: [
    {
      status: 200,
      body:
        'data: {"candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[{"text":"Look up the Paris forecast.","thought":true}]}}]}\n\n' +
        'data: {"responseId":"gem_sig_stream","candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[{"functionCall":{"id":"weather-paris","name":"getWeather","args":{"city":"Paris"}},"thoughtSignature":"sig-stream-step-1"}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":5,"totalTokenCount":17}}\n\n' +
        'data: [DONE]\n\n',
    },
  ],
  expected_output: [
    {
      results: [
        {
          index: 0,
          content: '',
          thought: 'Look up the Paris forecast.',
          thought_blocks: [
            { data: 'Look up the Paris forecast.', encrypted: false },
          ],
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
          content: '',
          thought_blocks: [
            { data: '', encrypted: false, signature: 'sig-stream-step-1' },
          ],
          function_calls: [
            {
              id: 'weather-paris',
              type: 'function',
              function: { name: 'getWeather', params: { city: 'Paris' } },
            },
          ],
          finish_reason: 'function_call',
        },
      ],
      remote_id: 'gem_sig_stream',
      model_usage: {
        ai: 'google-gemini',
        model: 'gemini-3.6-flash',
        tokens: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      },
    },
  ],
  expected_transport_request: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse',
  },
});

// The history ends on the parallel-call turn so the golden does not depend on
// how consecutive function results are grouped into user turns.
writeFixture('gemini-3-thought-signature-replay', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.6-flash',
  request: {
    chat_prompt: [
      { role: 'user', content: 'Weather in Paris, then Rome and a jacket?' },
      {
        role: 'assistant',
        function_calls: [
          {
            id: 'weather-paris',
            type: 'function',
            function: { name: 'getWeather', params: { city: 'Paris' } },
          },
        ],
        thought_blocks: [
          { data: '', encrypted: false, signature: 'sig-weather-step-1' },
        ],
      },
      {
        role: 'function',
        function_id: 'weather-paris',
        result: '{"forecast":"sunny"}',
      },
      {
        role: 'assistant',
        functionCalls: [
          {
            id: 'weather-rome',
            type: 'function',
            function: { name: 'getWeather', params: '{"city":"Rome"}' },
          },
          {
            id: 'jacket-rome',
            type: 'function',
            function: { name: 'pickJacket', params: { city: 'Rome' } },
          },
        ],
        thoughtBlocks: [
          {
            data: 'Rome next, ',
            encrypted: false,
            signature: 'sig-weather-step-2',
          },
          { data: 'then a jacket.', encrypted: false },
        ],
      },
    ],
    functions: [
      geminiWeatherFunction,
      {
        name: 'pickJacket',
        description: 'Pick a jacket for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
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
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    json: {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Weather in Paris, then Rome and a jacket?' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'weather-paris',
                name: 'getWeather',
                args: { city: 'Paris' },
              },
              thought_signature: 'sig-weather-step-1',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'weather-paris',
                name: 'getWeather',
                response: { result: '{"forecast":"sunny"}' },
              },
            },
          ],
        },
        {
          role: 'model',
          parts: [
            { text: 'Rome next, then a jacket.' },
            {
              functionCall: {
                id: 'weather-rome',
                name: 'getWeather',
                args: { city: 'Rome' },
              },
              thought_signature: 'sig-weather-step-2',
            },
            {
              functionCall: {
                id: 'jacket-rome',
                name: 'pickJacket',
                args: { city: 'Rome' },
              },
            },
          ],
        },
      ],
    },
  },
});

writeFixture('gemini-3-thought-signature-replay-without-function-calls', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.6-flash',
  request: {
    chat_prompt: [
      { role: 'user', content: 'Is it sunny in Paris?' },
      {
        role: 'assistant',
        content: 'Yes, it is sunny.',
        thought_blocks: [
          {
            data: 'Recall the forecast.',
            encrypted: false,
            signature: 'sig-answer-1',
          },
        ],
      },
      { role: 'user', content: 'And tomorrow?' },
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
            content: { parts: [{ text: 'Rain is likely.' }] },
          },
        ],
      },
    },
  ],
  expected_output: {
    results: [
      {
        index: 0,
        content: 'Rain is likely.',
        function_calls: [],
        finish_reason: 'stop',
      },
    ],
    model_usage: null,
  },
  expected_transport_request: {
    json: {
      contents: [
        { role: 'user', parts: [{ text: 'Is it sunny in Paris?' }] },
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Recall the forecast.',
              thought_signature: 'sig-answer-1',
            },
            { text: 'Yes, it is sunny.' },
          ],
        },
        { role: 'user', parts: [{ text: 'And tomorrow?' }] },
      ],
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

// The Gemini API's batchEmbedContents takes the task type as `taskType` on
// each request, unlike Vertex :predict.
writeFixture('gemini-embeddings-task-type', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: geminiDefaultEmbedModel,
  service_options: { embedType: 'RETRIEVAL_DOCUMENT' },
  request: { texts: ['one'] },
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
          taskType: 'RETRIEVAL_DOCUMENT',
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
  // One request: apiCall would otherwise send a 429 again (maxRetries 3).
  service_options: { retry: { maxRetries: 0 } },
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

// A call's beta routes that call onto v1beta1, and wins over the service's
// (TS getVertexApiURL(model, options.beta); src/ax/ai/call_options.test.ts).
const vertexCallUrl = (version: string, operation: string) =>
  `https://us-central1-aiplatform.googleapis.com/${version}/projects/demo-project/locations/us-central1/publishers/google/models/gemini-3.5-flash:${operation}`;
const vertexCallResponse = {
  status: 200,
  json: {
    candidates: [
      { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
    ],
  },
};
writeFixture('vertex-gemini-per-call-beta', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.5-flash',
  service_options: { projectId: 'demo-project', region: 'us-central1' },
  options: { beta: true },
  request: {
    chat_prompt: [{ role: 'user', content: 'hi' }],
    model_config: { stream: false },
  },
  transport_responses: [vertexCallResponse],
  expected_transport_request: {
    method: 'POST',
    url: vertexCallUrl('v1beta1', 'generateContent'),
  },
});
writeFixture('vertex-gemini-per-call-beta-over-service', {
  kind: 'ai_chat',
  provider: 'google-gemini',
  model: 'gemini-3.5-flash',
  service_options: {
    projectId: 'demo-project',
    region: 'us-central1',
    beta: true,
  },
  options: { beta: false },
  request: {
    chat_prompt: [{ role: 'user', content: 'hi' }],
    model_config: { stream: false },
  },
  transport_responses: [vertexCallResponse],
  expected_transport_request: {
    method: 'POST',
    url: vertexCallUrl('v1', 'generateContent'),
  },
});
writeFixture('vertex-gemini-per-call-beta-stream', {
  kind: 'ai_stream',
  provider: 'google-gemini',
  model: 'gemini-3.5-flash',
  service_options: { projectId: 'demo-project', region: 'us-central1' },
  options: { beta: true },
  request: {
    chat_prompt: [{ role: 'user', content: 'hi' }],
    model_config: { stream: true },
  },
  transport_responses: [
    {
      status: 200,
      body: 'data: {"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"ok"}]}}]}\n\ndata: [DONE]\n\n',
    },
  ],
  expected_transport_request: {
    url: vertexCallUrl('v1beta1', 'streamGenerateContent?alt=sse'),
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

// Vertex :predict reads an instance's task type only from `task_type`; given
// `taskType` it silently embeds as RETRIEVAL_QUERY (#708).
writeFixture('vertex-gemini-embed-task-type', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: 'gemini-embedding-001',
  service_options: {
    project_id: 'demo-project',
    region: 'us-central1',
    embed_type: 'RETRIEVAL_DOCUMENT',
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
    url: 'https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-embedding-001:predict',
    headers: { Authorization: 'Bearer test-key' },
    json: {
      instances: [{ content: 'hello world', task_type: 'RETRIEVAL_DOCUMENT' }],
    },
  },
});

// Vertex serves gemini-embedding-2 only at locations/global through
// :embedContent, one text per request and with no task type (#715).
const vertexEmbedContentUrl = (version: string) =>
  `https://aiplatform.googleapis.com/${version}/projects/demo-project/locations/global/publishers/google/models/gemini-embedding-2:embedContent`;

writeFixture('vertex-gemini-embedding-2-global-embed-content', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: 'gemini-embedding-2',
  service_options: {
    project_id: 'demo-project',
    region: 'us-central1',
    auto_truncate: false,
    embed_type: 'RETRIEVAL_DOCUMENT',
  },
  request: { texts: ['hello world'], dimensions: 768 },
  transport_responses: [
    {
      status: 200,
      json: {
        embedding: { values: [0.1, 0.2, 0.3] },
        usageMetadata: { promptTokenCount: 3, totalTokenCount: 3 },
      },
    },
  ],
  expected_output: {
    embeddings: [[0.1, 0.2, 0.3]],
    model_usage: {
      ai: 'google-gemini',
      model: 'gemini-embedding-2',
      tokens: { prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 },
    },
  },
  expected_transport_request: {
    method: 'POST',
    url: vertexEmbedContentUrl('v1'),
    headers: { Authorization: 'Bearer test-key' },
    json: {
      content: { parts: [{ text: 'hello world' }] },
      autoTruncate: false,
      outputDimensionality: 768,
    },
  },
  expected_transport_json_absent: [
    'instances',
    'parameters',
    'task_type',
    'taskType',
  ],
});

writeFixture('vertex-gemini-embedding-2-multi-region-beta', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: 'gemini-embedding-2',
  service_options: { project_id: 'demo-project', region: 'us', beta: true },
  request: { texts: ['hello world'] },
  transport_responses: [
    { status: 200, json: { embedding: { values: [0.1, 0.2, 0.3] } } },
  ],
  expected_output: { embeddings: [[0.1, 0.2, 0.3]] },
  expected_transport_request: {
    url: vertexEmbedContentUrl('v1beta1'),
    json: { content: { parts: [{ text: 'hello world' }] } },
  },
  expected_transport_json_absent: ['autoTruncate', 'outputDimensionality'],
});

// :embedContent fuses every part of a request into one vector, so more than
// one text is rejected before any request.
writeFixture('vertex-gemini-embedding-2-rejects-multiple-texts', {
  kind: 'ai_error',
  method: 'embed',
  provider: 'google-gemini',
  embed_model: 'gemini-embedding-2',
  service_options: { project_id: 'demo-project', region: 'us-central1' },
  request: { texts: ['one', 'two'] },
  transport_responses: [],
  expected_error_contains:
    'gemini-embedding-2 on Vertex embeds one text per request',
  expected_transport_request_count: 0,
});

// An explicit base URL replaces the Vertex host, as it does for every other
// Vertex call.
writeFixture('vertex-gemini-embedding-2-base-url-override', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: 'gemini-embedding-2',
  base_url: 'https://vertex.test/v1',
  service_options: { project_id: 'demo-project', region: 'us-central1' },
  request: { texts: ['hello world'] },
  transport_responses: [
    { status: 200, json: { embedding: { values: [0.1, 0.2, 0.3] } } },
  ],
  expected_output: { embeddings: [[0.1, 0.2, 0.3]] },
  expected_transport_request: {
    url: 'https://vertex.test/v1/projects/demo-project/locations/global/publishers/google/models/gemini-embedding-2:embedContent',
  },
});

// An endpointId deployment keeps the regional :predict call and its task type.
writeFixture('vertex-gemini-embedding-2-endpoint-keeps-predict', {
  kind: 'ai_embed',
  provider: 'google-gemini',
  embed_model: 'gemini-embedding-2',
  service_options: {
    project_id: 'demo-project',
    region: 'us-central1',
    endpoint_id: 'endpoint-42',
    embed_type: 'RETRIEVAL_DOCUMENT',
  },
  request: { texts: ['hello world'] },
  transport_responses: [
    {
      status: 200,
      json: { predictions: [{ embeddings: { values: [0.4, 0.5] } }] },
    },
  ],
  expected_output: { embeddings: [[0.4, 0.5]] },
  expected_transport_request: {
    url: 'https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/endpoints/endpoint-42:predict',
    json: {
      instances: [{ content: 'hello world', task_type: 'RETRIEVAL_DOCUMENT' }],
    },
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

// Responses before GPT-6 has no cache breakpoints, but as in TS
// (responses_api.ts, axResolveOpenAIPromptCacheKey) the request still sends
// prompt_cache_key.
writeFixture('openai-responses-prompt-cache-disabled', {
  kind: 'ai_chat',
  provider: 'openai-responses',
  model: 'gpt-5.6-luna',
  service_options: { contextCache: {}, promptCacheKey: 'responses-key' },
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
  expected_transport_request: { json: { prompt_cache_key: 'responses-key' } },
  expected_transport_json_absent: ['prompt_cache_options'],
});

// Every Responses request sends prompt_cache_key: the promptCacheKey, else the
// sessionId, the call's before the service's (src/ax/ai/call_options.test.ts).
const responsesCacheKeyResponse = {
  status: 200,
  json: {
    id: 'resp_cache_key',
    model: 'gpt-5.4-mini',
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    output: [
      {
        id: 'msg_cache_key',
        type: 'message',
        content: [{ type: 'output_text', text: 'ok', annotations: [] }],
      },
    ],
  },
};
for (const [name, fixture, key] of [
  [
    'openai-responses-prompt-cache-key-from-session-id',
    { options: { sessionId: 'session-1' } },
    'session-1',
  ],
  [
    'openai-responses-prompt-cache-key-prefers-prompt-cache-key',
    { options: { promptCacheKey: 'key-1', sessionId: 'session-1' } },
    'key-1',
  ],
  [
    'openai-responses-prompt-cache-key-from-service-session',
    { service_options: { sessionId: 'service-session' } },
    'service-session',
  ],
  [
    'openai-responses-prompt-cache-key-call-session-over-service',
    {
      service_options: { sessionId: 'service-session' },
      options: { sessionId: 'call-session' },
    },
    'call-session',
  ],
  [
    'openai-responses-prompt-cache-key-service-key-over-call-session',
    {
      service_options: { promptCacheKey: 'service-key' },
      options: { sessionId: 'call-session' },
    },
    'service-key',
  ],
  [
    'openai-responses-prompt-cache-key-gpt-6-without-caching',
    { model: 'gpt-6-luna', options: { sessionId: 'session-6' } },
    'session-6',
  ],
  ['openai-responses-prompt-cache-key-absent-without-key', {}, undefined],
] as const) {
  writeFixture(name, {
    kind: 'ai_chat',
    provider: 'openai-responses',
    model: 'gpt-5.4-mini',
    // The call's options stay call options only beside service options.
    service_options: {},
    ...fixture,
    request: {
      chat_prompt: [{ role: 'user', content: 'hi' }],
      model_config: { stream: false },
    },
    transport_responses: [responsesCacheKeyResponse],
    ...(key === undefined
      ? {
          expected_transport_json_absent: [
            'prompt_cache_key',
            'prompt_cache_options',
          ],
        }
      : {
          expected_transport_request: {
            url: 'https://api.openai.com/v1/responses',
            json: { prompt_cache_key: key },
          },
          expected_transport_json_absent: ['prompt_cache_options'],
        }),
  });
}

// TS reads a call's timeout in milliseconds and bounds the wait for the
// response headers with it (base.ts, apiCall; src/ax/ai/call_options.test.ts).
// Until the next major version the ports take it as timeoutMs, which reaches
// the transport as timeout_ms; each port's timeout_http_roundtrip example pins
// the HTTP behavior.
const callTimeoutChat = {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'gpt-6-luna',
  service_options: {},
  request: {
    chat_prompt: [{ role: 'user', content: 'hi' }],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_call_timeout', 'gpt-6-luna'),
  ],
};
writeFixture('call-timeout-ms-reaches-transport', {
  description:
    "Port-only: a call's timeoutMs (TS's per-call timeout, in milliseconds) reaches the transport as timeout_ms.",
  ...callTimeoutChat,
  options: { timeout: 250 },
  expected_transport_request: { timeout_ms: 250 },
  expected_warnings: [],
});
writeFixture('call-timeout-ms-reaches-stream-transport', {
  description:
    "Port-only: a stream call's timeoutMs reaches the transport as timeout_ms.",
  kind: 'ai_stream',
  provider: 'openai',
  model: 'gpt-6-luna',
  service_options: {},
  options: { timeout: 250 },
  request: {
    chat_prompt: [{ role: 'user', content: 'hi' }],
    model_config: { stream: true },
  },
  transport_responses: [
    {
      status: 200,
      body: 'data: {"id":"chatcmpl_call_timeout","model":"gpt-6-luna","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    },
  ],
  expected_transport_request: { timeout_ms: 250 },
});
writeFixture('call-timeout-ms-from-client-options-embed', {
  description:
    "Port-only: a timeoutMs in the client's options applies to each embed request, as TS's service timeout does.",
  kind: 'ai_embed',
  provider: 'openai',
  embed_model: 'text-embedding-3-small',
  service_options: { timeoutMs: 250 },
  request: { texts: ['hello'] },
  transport_responses: [
    {
      status: 200,
      json: {
        data: [{ embedding: [0.1, 0.2], index: 0 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      },
    },
  ],
  expected_transport_request: { timeout_ms: 250 },
});
writeFixture('call-timeout-milliseconds-default', {
  description:
    'A per-call timeout is milliseconds and reaches the transport without warnings.',
  ...callTimeoutChat,
  options: { timeout: 30 },
  expected_transport_request: { timeout_ms: 30 },
  expected_warnings: [],
});
writeFixture('call-timeout-with-timeout-ms-does-not-warn', {
  description:
    'Port-only: a per-call timeout beside timeoutMs does not warn, and timeoutMs applies.',
  ...callTimeoutChat,
  options: { timeout: 30, timeoutMs: 60000 },
  expected_transport_request: { timeout_ms: 60000 },
  expected_warnings: [],
});

// TS apiCall's request-layer retry (src/ax/util/apicall.ts), run against the
// fixture's scripted responses with a fixed Math.random (retry_random) and
// Date.now (retry_now_ms), and setTimeout recording each retry delay instead
// of waiting. The ports' runners record their retry delays the same way.
type RetryReply =
  | {
      status: number;
      json?: Json;
      body?: string;
      headers?: Record<string, string>;
    }
  | { network_error: string };
const retryNow = 1_800_000_000_000;
const runRequestRetry = async (
  replies: RetryReply[],
  random: number,
  run: (fetch: typeof globalThis.fetch) => Promise<unknown>
) => {
  const delays: number[] = [];
  let requests = 0;
  const fetch = (async () => {
    const reply = replies[requests];
    requests++;
    if (!reply) throw new Error('scripted fetch exhausted');
    if ('network_error' in reply) throw new TypeError(reply.network_error);
    return new Response(reply.body ?? JSON.stringify(reply.json ?? {}), {
      status: reply.status,
      headers: {
        'content-type':
          reply.body === undefined ? 'application/json' : 'text/event-stream',
        ...reply.headers,
      },
    });
  }) as typeof globalThis.fetch;
  const saved = {
    random: Math.random,
    now: Date.now,
    setTimeout: globalThis.setTimeout,
  };
  Math.random = () => random;
  Date.now = () => retryNow;
  globalThis.setTimeout = ((handler: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return saved.setTimeout(handler, 0);
  }) as typeof globalThis.setTimeout;
  let error: unknown;
  try {
    await run(fetch);
  } catch (caught) {
    error = caught;
  } finally {
    Math.random = saved.random;
    Date.now = saved.now;
    globalThis.setTimeout = saved.setTimeout;
  }
  return { requests, delays, error };
};
const retryChatRequest = {
  chat_prompt: [{ role: 'user', content: 'hi' }],
  model_config: { stream: false },
};
const retryStreamRequest = {
  chat_prompt: [{ role: 'user', content: 'hi' }],
  model_config: { stream: true },
};
const retryOk = compatibleResponse('chatcmpl_retry', 'gpt-5.4-mini');
const retryStreamOk = {
  status: 200,
  body: 'data: {"id":"chatcmpl_retry","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
};
const retryEmbedOk = {
  status: 200,
  json: {
    data: [{ embedding: [0.1, 0.2], index: 0 }],
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: 1, total_tokens: 1 },
  },
};
const retryStatus = (status: number, headers?: Record<string, string>) => ({
  status,
  json: { error: { message: `upstream ${status}`, type: 'server_error' } },
  ...(headers ? { headers } : {}),
});
const retryNetwork = { network_error: 'fetch failed' };
const retryHttpDate = new Date(retryNow + 3000).toUTCString();
type RetryCase = {
  name: string;
  description: string;
  method?: 'chat' | 'stream' | 'embed';
  replies: RetryReply[];
  random?: number;
  serviceOptions?: Record<string, Json>;
  options?: Record<string, Json>;
  error?: { type: string; status?: number; contains?: string };
};
const retryCases: RetryCase[] = [
  {
    name: 'request-retry-statuses-then-success',
    description:
      'apiCall sends a non-streaming chat again for each listed status, after its jittered backoff.',
    replies: [retryStatus(503), retryStatus(429), retryOk],
  },
  {
    name: 'request-retry-status-exhausted',
    description:
      'apiCall surfaces the status error once maxRetries (default 3) retries are spent.',
    replies: [
      retryStatus(503),
      retryStatus(503),
      retryStatus(503),
      retryStatus(503),
    ],
    error: { type: 'AxAIServiceStatusError', status: 503 },
  },
  {
    name: 'request-retry-network-then-success',
    description: 'apiCall sends a request again after a network failure.',
    replies: [retryNetwork, retryOk],
  },
  {
    name: 'request-retry-network-exhausted',
    description:
      'apiCall surfaces the network error once maxRetries retries are spent.',
    replies: [retryNetwork, retryNetwork, retryNetwork, retryNetwork],
    error: {
      type: 'AxAIServiceNetworkError',
      contains: 'Network Error: fetch failed',
    },
  },
  {
    name: 'request-retry-unlisted-status-not-retried',
    description: 'A status the retry config does not list surfaces at once.',
    replies: [retryStatus(501), retryOk],
    error: { type: 'AxAIServiceStatusError', status: 501 },
  },
  {
    name: 'request-retry-auth-not-retried',
    description: 'A 401 surfaces at once, even when the retry config lists it.',
    replies: [retryStatus(401), retryOk],
    options: { retry: { retryableStatusCodes: [401, 503] } },
    error: { type: 'AxAIServiceAuthenticationError' },
  },
  {
    name: 'request-retry-after-seconds',
    description:
      'A Retry-After in seconds replaces the backoff when it is no longer than maxDelayMs.',
    replies: [retryStatus(429, { 'Retry-After': '2' }), retryOk],
  },
  {
    name: 'request-retry-after-http-date',
    description:
      'A Retry-After HTTP date waits until that time, from the clock (retry_now_ms).',
    replies: [retryStatus(503, { 'Retry-After': retryHttpDate }), retryOk],
  },
  {
    name: 'request-retry-after-past-http-date',
    description:
      'A Retry-After HTTP date already past sends the request again at once.',
    replies: [
      retryStatus(503, { 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' }),
      retryOk,
    ],
  },
  {
    name: 'request-retry-after-above-max-delay',
    description: 'A Retry-After longer than maxDelayMs keeps the backoff.',
    replies: [retryStatus(503, { 'Retry-After': '120' }), retryOk],
  },
  {
    name: 'request-retry-after-unparsed',
    description:
      'A Retry-After that is neither seconds nor an HTTP date keeps the backoff.',
    replies: [retryStatus(503, { 'Retry-After': 'soon' }), retryOk],
  },
  {
    name: 'request-retry-jitter-low',
    description: 'The backoff is multiplied by 0.75 + 0.5 * Math.random().',
    replies: [retryStatus(503), retryStatus(503), retryOk],
    random: 0,
  },
  {
    name: 'request-retry-jitter-high',
    description: 'The backoff is multiplied by 0.75 + 0.5 * Math.random().',
    replies: [retryStatus(503), retryStatus(503), retryOk],
    random: 0.9,
  },
  {
    name: 'request-retry-max-delay-caps-backoff',
    description: 'maxDelayMs caps the backoff before the jitter.',
    replies: [retryStatus(503), retryStatus(503), retryStatus(503), retryOk],
    options: {
      retry: { initialDelayMs: 100, backoffFactor: 10, maxDelayMs: 500 },
    },
  },
  {
    name: 'request-retry-call-options-over-client',
    description:
      "The call's retry options replace the client's (options.retry ?? this.retry).",
    replies: [retryStatus(503), retryOk],
    serviceOptions: { retry: { maxRetries: 0 } },
    options: { retry: { maxRetries: 1, initialDelayMs: 10 } },
  },
  {
    name: 'request-retry-client-max-retries-zero',
    description:
      "The client's retry: { maxRetries: 0 } sends each request once.",
    replies: [retryStatus(503), retryOk],
    serviceOptions: { retry: { maxRetries: 0 } },
    error: { type: 'AxAIServiceStatusError', status: 503 },
  },
  {
    name: 'request-retry-custom-status-codes',
    description: 'retryableStatusCodes replaces the list of statuses to retry.',
    replies: [retryStatus(418), retryOk],
    options: { retry: { retryableStatusCodes: [418] } },
  },
  {
    name: 'request-retry-custom-status-codes-drop-default',
    description: 'A status left out of retryableStatusCodes is not retried.',
    replies: [retryStatus(503), retryOk],
    options: { retry: { retryableStatusCodes: [418] } },
    error: { type: 'AxAIServiceStatusError', status: 503 },
  },
  {
    name: 'request-retry-embed',
    description: 'An embed request goes through the same retry.',
    method: 'embed',
    replies: [retryStatus(503), retryEmbedOk],
  },
  {
    name: 'request-retry-stream-open-status',
    description:
      "A stream's request goes through the same retry, jitter included.",
    method: 'stream',
    replies: [retryStatus(503), retryStreamOk],
  },
  {
    name: 'request-retry-stream-open-retry-after',
    description: "A stream's request honors Retry-After.",
    method: 'stream',
    replies: [retryStatus(429, { 'Retry-After': '3' }), retryStreamOk],
  },
  {
    name: 'request-retry-stream-open-network',
    description: "A stream's request goes out again after a network failure.",
    method: 'stream',
    replies: [retryNetwork, retryStreamOk],
  },
];
for (const {
  name,
  description,
  method = 'chat',
  replies,
  random = 0.5,
  serviceOptions = {},
  options,
  error,
} of retryCases) {
  const {
    requests,
    delays,
    error: raised,
  } = await runRequestRetry(replies, random, async (fetch) => {
    const client = ai({
      name: 'openai',
      apiKey: 'test-key',
      config: { model: AxAIOpenAIModel.GPT54Mini },
      embedModel: 'text-embedding-3-small',
      options: { ...(serviceOptions as object), fetch },
    } as never);
    if (method === 'embed') {
      await client.embed({ texts: ['hi'] }, options as never);
      return;
    }
    const response = await client.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { stream: method === 'stream' },
      } as never,
      { ...(options as object), stream: method === 'stream' } as never
    );
    if (method === 'stream') {
      const reader = (response as ReadableStream<unknown>).getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
  });
  if (error === undefined && raised !== undefined) {
    throw new Error(`${name}: TypeScript failed: ${String(raised)}`);
  }
  if (error !== undefined) {
    const typed = raised as
      | { name?: string; status?: number; message?: string }
      | undefined;
    if (
      typed?.name !== error.type ||
      (error.status !== undefined && typed.status !== error.status)
    ) {
      throw new Error(
        `${name}: TypeScript raised ${typed?.name} ${typed?.status}`
      );
    }
    if (error.contains && !typed.message?.includes(error.contains)) {
      throw new Error(`${name}: TypeScript message ${typed.message}`);
    }
  }
  writeFixture(name, {
    description: `${description} TS request count and delays from src/ax/util/apicall.ts.`,
    kind:
      error === undefined
        ? method === 'chat'
          ? 'ai_chat'
          : method === 'stream'
            ? 'ai_stream'
            : 'ai_embed'
        : 'ai_error',
    ...(error === undefined ? {} : { method }),
    provider: 'openai',
    model: 'gpt-5.4-mini',
    ...(method === 'embed' ? { embed_model: 'text-embedding-3-small' } : {}),
    service_options: serviceOptions,
    ...(options === undefined ? {} : { options }),
    request:
      method === 'embed'
        ? { texts: ['hi'] }
        : method === 'stream'
          ? retryStreamRequest
          : retryChatRequest,
    transport_responses: replies as Json,
    retry_random: random,
    retry_now_ms: retryNow,
    expected_transport_request_count: requests,
    expected_retry_delays_ms: delays,
    ...(error === undefined
      ? {}
      : {
          expected_error_type: error.type,
          ...(error.status === undefined
            ? {}
            : { expected_status: error.status }),
          ...(error.contains === undefined
            ? {}
            : { expected_error_contains: error.contains }),
        }),
  });
}

// A Gemini context-cache create goes through the same retry: TS sends the
// cachedContents request through apiCall.
{
  const replies: RetryReply[] = [
    { status: 503, json: { error: { message: 'upstream 503', code: 503 } } },
    {
      status: 200,
      json: {
        name: 'cachedContents/retry-cache',
        expireTime: '2099-01-01T00:00:00Z',
      },
    },
    {
      status: 200,
      json: {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      },
    },
  ];
  const chatPrompt: Json[] = [
    { role: 'system', content: 'Cache this', cache: true },
    { role: 'user', content: 'hi' },
  ];
  const options = { contextCache: { minTokens: 0 } };
  const { requests, delays, error } = await runRequestRetry(
    replies,
    0.5,
    async (fetch) => {
      const client = ai({
        name: 'google-gemini',
        apiKey: 'test-key',
        config: { model: AxAIGoogleGeminiModel.Gemini38Flash },
        options: { fetch },
      } as never);
      await client.chat(
        { chatPrompt } as never,
        {
          ...options,
          stream: false,
        } as never
      );
    }
  );
  if (error !== undefined || requests !== 3) {
    throw new Error(
      `request-retry-context-cache-create: TypeScript sent ${requests} requests: ${String(error)}`
    );
  }
  writeFixture('request-retry-context-cache-create', {
    description:
      'A Gemini context-cache create goes through the same retry. TS request count and delays from src/ax/util/apicall.ts.',
    kind: 'ai_chat',
    provider: 'google-gemini',
    model: AxAIGoogleGeminiModel.Gemini38Flash,
    service_options: {},
    options,
    request: { chat_prompt: chatPrompt, model_config: { stream: false } },
    transport_responses: replies as Json,
    retry_random: 0.5,
    retry_now_ms: retryNow,
    expected_transport_request_count: requests,
    expected_retry_delays_ms: delays,
  });
}

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
// Node 22 rejects disjoint duplicate capture names. These two exact rewrites
// preserve their matching semantics on older reference runtimes: alternatives
// clear unmatched captures, and an unmatched backreference matches empty text.
// Keep the original patterns in the fixture so every generated target exercises
// the modern syntax. Runtimes that accept it must agree with the rewrites.
const ecmaPortableOracles: Readonly<Record<string, string>> = {
  '(?<x>a)|(?<x>b)': '(a)|(b)',
  '(?:(?<x>a)|(?<x>b))+\\k<x>': '(?:(a)|(b))+\\1\\2',
};
const ecmaPatternValid = (pattern: string, input: string): boolean => {
  try {
    axValidateToolArguments({ pattern }, input);
    return true;
  } catch {
    return false;
  }
};
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
    const pattern = item.schema.pattern;
    const oracle = ecmaPortableOracles[pattern];
    const valid = ecmaPatternValid(oracle ?? pattern, item.arguments);
    if (oracle) {
      let nativeSyntaxSupported = true;
      try {
        new RegExp(pattern);
      } catch {
        nativeSyntaxSupported = false;
      }
      if (
        nativeSyntaxSupported &&
        ecmaPatternValid(pattern, item.arguments) !== valid
      ) {
        throw new Error(`Portable regex oracle differs for ${pattern}`);
      }
    }
    return { ...item, valid };
  }),
});

// Typesafe adapter fixtures exercise the public provider and record its wire contract.
const { AxAITypesafe } = await import('../../../src/ax/ai/typesafe/api.js');
const { validateTypesafeRequest, decodeTypesafeResponse } = await import(
  '../../../src/ax/ai/typesafe/validate.js'
);

for (const [label, threshold, probability] of [
  ['default', undefined, 0.5],
  ['below', 0.9, 0.899],
  ['equal', 0.9, 0.9],
  ['zero', 0, 0],
  ['one', 1, 1],
] as const) {
  const request = {
    chatPrompt: [
      { role: 'user' as const, content: 'Checkout is unavailable.' },
    ],
    responseFormat: {
      type: 'json_schema' as const,
      schema: {
        name: 'decision',
        schema: {
          type: 'object' as const,
          properties: {
            urgent: {
              type: 'boolean' as const,
              description: 'Urgent?\ntrue: Core task blocked\nfalse: Routine',
            },
          },
          required: ['urgent'],
        },
      },
      fieldDescriptions: {
        urgent: {
          description: 'Urgent?',
          valueDescriptions: { true: 'Core task blocked', false: 'Routine' },
        },
      },
    },
    modelConfig: { stream: false },
  };
  const raw = {
    model: 'jev-latest',
    answers: { urgent: { type: 'noul', noul: probability } },
    usage: { input_tokens: 7, output_tokens: 1 },
  };
  let captured: unknown;
  const client = new AxAITypesafe({
    apiKey: 'test-key',
    trueThreshold: threshold,
    options: {
      fetch: async (_url, init) => {
        captured = JSON.parse(String(init?.body));
        return Response.json(raw);
      },
    },
  });
  const response = await client.chat(request);
  writeFixture(`typesafe-adapter-threshold-${label}`, {
    kind: 'ai_chat',
    provider: 'typesafe',
    model: 'jev-latest',
    service_options:
      threshold === undefined ? {} : { trueThreshold: threshold },
    request: request as Json,
    transport_responses: [raw],
    expected_output: response as Json,
    expected_transport_request: {
      method: 'POST',
      url: 'https://api.typesafe.ai/v1/systemone',
      json: captured as Json,
    },
    expected_transport_request_count: 1,
    expected_transport_json_absent: ['trueThreshold', 'temperature', 'stream'],
  });
}

const typesafeQuestions = {
  urgent: {
    type: 'noul' as const,
    instructions: { task: 'Urgent?' },
    criteria: { true: ['Core task blocked'], false: null },
  },
  team: {
    type: 'choice' as const,
    criteria: { support: { scope: 'Product help' }, billing: null },
  },
  severity: {
    type: 'score' as const,
    instructions: null,
    criteria: [null, { description: 'Limited impact' }, 'Core outage'] as const,
  },
};
const typesafeNativeRequest = {
  model: 'jev-latest',
  state: { ticket: 'Checkout unavailable', context: [null, 2, true] },
  questions: typesafeQuestions,
};
const typesafeRaw = {
  model: 'jev-latest',
  usage: { input_tokens: 21, output_tokens: 3 },
  answers: {
    urgent: { type: 'noul', noul: 0.85 },
    team: {
      type: 'choice',
      choice: 'support',
      probabilities: { support: 0.8, billing: 0.2 },
      confidence: 0.7,
    },
    severity: {
      type: 'score',
      score: 1.5,
      probabilities: { '0': 0.1, '1': 0.3, '2': 0.6 },
      confidence: 0.8,
      legend: {
        '0': null,
        '1': { description: 'Limited impact' },
        '2': 'Core outage',
      },
    },
  },
};
validateTypesafeRequest(typesafeNativeRequest);
writeFixture('typesafe-native-rich-questions', {
  kind: 'ai_typesafe_native',
  operation: 'system_one',
  request: typesafeNativeRequest,
  response: typesafeRaw,
  expected_transport_request_count: 1,
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.typesafe.ai/v1/systemone',
    json: typesafeNativeRequest,
  },
  expected_output: decodeTypesafeResponse(
    typesafeRaw,
    typesafeQuestions
  ) as Json,
});
for (const kind of ['choice', 'score'] as const) {
  const question =
    kind === 'choice'
      ? { type: kind, criteria: { '0': null, '1': null, '2': null } }
      : { type: kind, criteria: [null, null, null] as const };
  const request = {
    model: 'jev-latest',
    state: null,
    questions: { decision: question },
  };
  validateTypesafeRequest(request);
  for (const [label, values, valid] of [
    ['lower-boundary', [0.33, 0.33, 0.33], true],
    ['upper-boundary', [0.34, 0.34, 0.33], true],
    ['below-tolerance', [0.33, 0.33, 0.3299999999], false],
    ['above-tolerance', [0.34, 0.34, 0.3300000001], false],
  ] as const) {
    const answer = {
      type: kind,
      confidence: 0.5,
      probabilities: Object.fromEntries(
        values.map((value, i) => [String(i), value])
      ),
      ...(kind === 'choice'
        ? { choice: '0' }
        : { score: 1.5, legend: { '0': null, '1': null, '2': null } }),
    };
    const raw = { ...typesafeRaw, answers: { decision: answer } };
    const fixture = {
      kind: 'ai_typesafe_native',
      operation: 'system_one',
      request,
      response: raw,
      expected_transport_request_count: 1,
    };
    if (valid) {
      const output = decodeTypesafeResponse(raw, request.questions);
      if (output !== raw)
        throw new Error('Expected unchanged Typesafe response');
      writeFixture(`typesafe-native-${kind}-${label}`, {
        ...fixture,
        expected_output: output as Json,
      });
    } else {
      try {
        decodeTypesafeResponse(raw, request.questions);
        throw new Error('Expected invalid probability distribution');
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith(
            'Typesafe: invalid probability distribution'
          )
        )
          throw error;
        writeFixture(`typesafe-native-${kind}-${label}`, {
          ...fixture,
          expected_error_contains: 'Typesafe',
        });
      }
    }
  }
}

const catalog = {
  models: [
    {
      name: 'jev-latest',
      description: 'Latest Jev',
      release_date: '2026-09-01',
    },
  ],
};
writeFixture('typesafe-native-model-catalog', {
  kind: 'ai_typesafe_native',
  operation: 'models',
  response: catalog,
  expected_transport_request_count: 1,
  expected_transport_request: {
    method: 'GET',
    url: 'https://api.typesafe.ai/v1/models',
  },
  expected_transport_absent: ['json', 'data'],
  expected_output: (await new (
    await import('../../../src/ax/ai/typesafe/client.js')
  ).AxAITypesafeClient({
    apiKey: 'test-key',
    options: { fetch: async () => Response.json(catalog) },
  }).listModels()) as Json,
});
for (const [name, question] of [
  ['score-too-short', { type: 'score', criteria: [null] }],
  ['score-too-long', { type: 'score', criteria: Array(11).fill(null) }],
  [
    'choice-too-many',
    {
      type: 'choice',
      criteria: Object.fromEntries(
        Array.from({ length: 256 }, (_, i) => [String(i), null])
      ),
    },
  ],
  ['noul-unknown-criterion', { type: 'noul', criteria: { maybe: null } }],
] as const) {
  const request = {
    model: 'jev-latest',
    state: null,
    questions: { decision: question },
  };
  try {
    validateTypesafeRequest(request as any);
    throw new Error('Expected invalid native request');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message === 'Expected invalid native request'
    )
      throw error;
    writeFixture(`typesafe-native-${name}`, {
      kind: 'ai_typesafe_native',
      operation: 'system_one',
      request: request as Json,
      expected_transport_request_count: 0,
      expected_error_contains:
        question.type === 'score'
          ? 'Score'
          : question.type === 'choice'
            ? 'Choice'
            : 'criteria',
    });
  }
}

const typesafeFieldCases = [
  ['number-bounded', { type: 'number', minimum: 1, maximum: 5 }, true],
  ['number', { type: 'number' }, true],
  ['string', { type: 'string' }, true],
  ['optional', { type: 'boolean' }, false],
  ['array', { type: 'array', items: { type: 'boolean' } }, true],
  [
    'nested',
    {
      type: 'object',
      properties: { flag: { type: 'boolean' } },
      required: ['flag'],
    },
    true,
  ],
] as const;
for (const [label, field, required] of typesafeFieldCases) {
  const request = {
    chatPrompt: [{ role: 'user', content: 'classify' }],
    modelConfig: { stream: false },
    responseFormat: {
      type: 'json_schema',
      schema: {
        name: 'decision',
        schema: {
          type: 'object',
          properties: { result: field },
          required: required ? ['result'] : [],
        },
      },
    },
  };
  let calls = 0;
  const client = new AxAITypesafe({
    apiKey: 'test-key',
    options: {
      fetch: async () => {
        calls++;
        throw new Error('unexpected transport');
      },
    },
  });
  try {
    await client.chat(request as any);
    throw new Error('expected rejection');
  } catch (error) {
    if (calls || !(error instanceof Error) || !error.message.includes('result'))
      throw error;
  }
  writeFixture(`typesafe-reject-${label}`, {
    kind: 'ai_chat',
    provider: 'typesafe',
    request,
    expected_error_contains: 'result',
    expected_transport_request_count: 0,
  });
}
const typesafeMultiRequest = {
  chatPrompt: [{ role: 'user' as const, content: 'Checkout is unavailable' }],
  modelConfig: { stream: false },
  responseFormat: {
    type: 'json_schema' as const,
    schema: {
      name: 'decision',
      schema: {
        type: 'object' as const,
        properties: {
          urgent: { type: 'boolean' as const },
          team: { type: 'string' as const, enum: ['support', 'billing'] },
        },
        required: ['urgent', 'team'],
      },
    },
    fieldDescriptions: {
      team: {
        description: 'Responsible team',
        valueDescriptions: {
          support: 'Product help',
          billing: 'Payment questions',
        },
      },
    },
  },
};
for (const [label, patch, errorText] of [
  [
    'tools',
    {
      functions: [
        {
          name: 'lookup',
          description: 'Lookup',
          parameters: { type: 'object', properties: {} },
        },
      ],
    },
    'does not support',
  ],
  [
    'temperature',
    { modelConfig: { temperature: 0.7, stream: false } },
    'does not support',
  ],
  ['samples', { modelConfig: { n: 2, stream: false } }, 'does not support'],
  [
    'invalid-samples',
    { modelConfig: { n: true, stream: false } },
    'does not support',
  ],
  [
    'media',
    {
      chatPrompt: [
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/png', image: 'AAAA' }],
        },
      ],
    },
    'text input only',
  ],
] as const) {
  const request = { ...typesafeMultiRequest, ...patch };
  let calls = 0;
  const client = new AxAITypesafe({
    apiKey: 'test-key',
    options: {
      fetch: async () => {
        calls++;
        throw new Error('unexpected transport');
      },
    },
  });
  try {
    await client.chat(request as any);
    throw new Error('expected rejection');
  } catch (error) {
    if (
      calls ||
      !(error instanceof Error) ||
      !error.message.includes(errorText)
    )
      throw error;
  }
  writeFixture(`typesafe-reject-${label}`, {
    kind: 'ai_chat',
    provider: 'typesafe',
    request: request as Json,
    expected_error_contains: errorText,
    expected_transport_request_count: 0,
  });
}
const multiRaw = {
  model: 'jev-latest',
  answers: {
    urgent: typesafeRaw.answers.urgent,
    team: typesafeRaw.answers.team,
  },
  usage: typesafeRaw.usage,
};
let multiPayload: unknown;
const multiClient = new AxAITypesafe({
  apiKey: 'test-key',
  options: {
    fetch: async (_url, init) => {
      multiPayload = JSON.parse(String(init?.body));
      return Response.json(multiRaw);
    },
  },
});
const multiResult = await multiClient.chat(
  stable(typesafeMultiRequest) as typeof typesafeMultiRequest
);
writeFixture('typesafe-adapter-multiple-fields', {
  kind: 'ai_chat',
  provider: 'typesafe',
  request: typesafeMultiRequest,
  transport_responses: [multiRaw],
  expected_output: multiResult as Json,
  expected_transport_request_count: 1,
  expected_transport_request: { json: multiPayload as Json },
});
for (const [name, mutate] of [
  [
    'missing-answer',
    (raw: any) => {
      delete raw.answers.team;
    },
  ],
  [
    'wrong-label',
    (raw: any) => {
      raw.answers.team.choice = 'engineering';
    },
  ],
  [
    'wrong-probabilities',
    (raw: any) => {
      raw.answers.team.probabilities.support = 0.1;
    },
  ],
  [
    'wrong-probability',
    (raw: any) => {
      raw.answers.urgent.noul = 1.1;
    },
  ],
  [
    'wrong-type',
    (raw: any) => {
      raw.answers.urgent.type = 'score';
    },
  ],
  [
    'wrong-usage',
    (raw: any) => {
      raw.usage.input_tokens = -1;
    },
  ],
] as const) {
  const raw = structuredClone(multiRaw);
  mutate(raw);
  const client = new AxAITypesafe({
    apiKey: 'test-key',
    options: {
      fetch: async () => Response.json(raw),
      retry: { maxRetries: 0 },
    },
  });
  try {
    await client.chat(typesafeMultiRequest);
    throw new Error('expected rejection');
  } catch (error) {
    if (!(error instanceof Error) || error.message === 'expected rejection')
      throw error;
  }
  writeFixture(`typesafe-malformed-${name}`, {
    kind: 'ai_chat',
    provider: 'typesafe',
    request: typesafeMultiRequest,
    transport_responses: [raw],
    expected_error_contains: 'Typesafe',
    expected_transport_request_count: 1,
  });
}

// Real Typesafe validation behind the optional service hook; no transport is used by eligibility checks.
for (const supported of [false, true]) {
  const decisionSpec = {
    name: 'Typesafe',
    features: routerFeatures({
      functions: false,
      streaming: false,
      structuredOutputs: true,
      requiresStructuredOutput: true,
    }),
  };
  const fallbackSpec = {
    name: 'Generative',
    features: routerFeatures({ streaming: false, structuredOutputs: true }),
  };
  const request = {
    chatPrompt: [{ role: 'user', content: 'Outage' }],
    modelConfig: { stream: false },
    ...(supported
      ? {
          responseFormat: {
            type: 'json_schema',
            schema: {
              name: 'decision',
              schema: {
                type: 'object',
                properties: { urgent: { type: 'boolean' } },
                required: ['urgent'],
              },
            },
          },
        }
      : {}),
  };
  const services = [
    new FixtureAIService(decisionSpec),
    new FixtureAIService(fallbackSpec),
  ];
  const router = new AxProviderRouter({
    providers: {
      primary: services[0] as any,
      alternatives: [services[1] as any],
    },
    routing: { capability: { allowDegradation: true } },
    processing: {},
  });
  const recommendation = await router.getRoutingRecommendation(request as any);
  writeFixture(
    `typesafe-routing-${supported ? 'supported' : 'reject-degradation'}`,
    {
      kind: 'ai_provider_router',
      services: [decisionSpec, fallbackSpec],
      primary_index: 0,
      alternative_indices: [1],
      routing: { capability: { allowDegradation: true } },
      request,
      expected_output: {
        recommendation: { provider: recommendation.provider.getName() },
      },
    }
  );
  const balancer = new AxBalancer(services as any, {
    comparator: AxBalancer.inputOrderComparator,
    debug: false,
  });
  const output = await balancer.chat(request as any, {});
  writeFixture(`typesafe-balancer-${supported ? 'supported' : 'reject'}`, {
    kind: 'ai_balancer',
    services: [decisionSpec, fallbackSpec],
    options: { strategy: 'input_order', debug: false },
    operations: [{ name: 'chat', request, options: {} }],
    expected_output: {
      outputs: { chat: output as any },
      serviceCalls: services
        .map((s) => normalizeFixtureServiceCalls(s.requests))
        .filter((calls) => calls.length > 0),
    },
  });
}

// An incompatible decision provider must stay excluded after a generative service fails.
const typesafeFallbackSpecs = [
  {
    name: 'Unavailable',
    features: routerFeatures(),
    responses: [{ error: { type: 'network', message: 'temporary failure' } }],
  },
  {
    name: 'Typesafe',
    features: routerFeatures({
      functions: false,
      streaming: false,
      requiresStructuredOutput: true,
    }),
  },
  { name: 'Backup', features: routerFeatures() },
];
const typesafeFallbackServices = typesafeFallbackSpecs.map(
  (spec) => new FixtureAIService(spec)
);
const typesafeFallbackBalancer = new AxBalancer(
  typesafeFallbackServices as any,
  {
    comparator: AxBalancer.inputOrderComparator,
    debug: false,
    maxRetries: 1,
  }
);
const typesafeFallbackRequest = {
  chatPrompt: [{ role: 'user', content: 'Write a reply' }],
};
const typesafeFallbackResponse = await typesafeFallbackBalancer.chat(
  typesafeFallbackRequest as any,
  {}
);
if (typesafeFallbackServices[1].requests.length)
  throw new Error('Incompatible fallback was executed');
writeFixture('typesafe-balancer-fallback-reject', {
  kind: 'ai_balancer',
  services: typesafeFallbackSpecs,
  options: { strategy: 'input_order', debug: false, maxRetries: 1 },
  operations: [{ name: 'chat', request: typesafeFallbackRequest, options: {} }],
  expected_output: {
    outputs: { chat: typesafeFallbackResponse as Json },
    serviceCalls: typesafeFallbackServices
      .map((service) => normalizeFixtureServiceCalls(service.requests))
      .filter((calls) => calls.length > 0),
  },
});

// ---------------------------------------------------------------------------
// Sept-2026 models: GPT-6 Sol/Luna, Claude 5.x, Gemini 3.8 audio + Live.
// ---------------------------------------------------------------------------

// GPT-6 Sol and Luna run on Responses from both factory routes, keep the
// GPT-5.6 effort ladders (so `none` is sent explicitly), and drop sampling.
for (const provider of ['openai', 'openai-responses']) {
  (['none', 'minimal', 'low', 'medium', 'high', 'highest'] as const).forEach(
    (budget, index) => {
      const model =
        index % 2 === 0 ? AxAIOpenAIModel.GPT6Sol : AxAIOpenAIModel.GPT6Luna;
      writeFixture(`${provider}-gpt-6-reasoning-${budget}`, {
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
          },
        },
        transport_responses: [
          {
            status: 200,
            json: {
              id: 'resp_gpt6',
              model,
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              output: [
                {
                  id: 'msg_gpt6',
                  type: 'message',
                  content: [
                    { type: 'output_text', text: 'ok', annotations: [] },
                  ],
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
            reasoning: {
              effort: axResolveOpenAIResponsesReasoningEffort(model, budget),
            },
            stream: false,
          },
        },
        expected_transport_json_absent: ['temperature', 'top_p'],
      });
    }
  );
}

writeFixture('gpt-6-sol-native-none-accepted', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT6Sol,
  request: {
    chat_prompt: [{ role: 'user', content: 'answer' }],
    model_config: { stream: false, reasoning: { effort: 'none' } },
  },
  transport_responses: [
    {
      status: 200,
      json: { id: 'r1', model: AxAIOpenAIModel.GPT6Sol, output: [] },
    },
  ],
  expected_transport_request: {
    url: 'https://api.openai.com/v1/responses',
    json: { reasoning: { effort: 'none' } },
  },
});

writeFixture('gpt-6-luna-configuration-update-rejected', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT6Luna,
  request: {
    chat_prompt: [{ role: 'user', content: 'reason' }],
    previous_response_id: 'r1',
    session_input: [
      { type: 'configuration_update', reasoning: { effort: 'high' } },
    ],
  },
  expected_error_contains: 'configuration_update requires GPT-6 Astra',
  expected_transport_request_count: 0,
});

writeFixture('gpt-6-sol-prompt-cache-breakpoints', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT6Sol,
  service_options: { contextCache: {}, promptCacheKey: 'sol-prefix' },
  request: {
    chat_prompt: [{ role: 'user', content: 'cached' }],
    model_config: { thinkingTokenBudget: 'low' },
  },
  transport_responses: [
    {
      status: 200,
      json: { id: 'r1', model: AxAIOpenAIModel.GPT6Sol, output: [] },
    },
  ],
  expected_transport_request: {
    method: 'POST',
    url: 'https://api.openai.com/v1/responses',
    json: {
      model: AxAIOpenAIModel.GPT6Sol,
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
      prompt_cache_key: 'sol-prefix',
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    },
  },
});

for (const inputTokens of [272000, 272001]) {
  const long = inputTokens > 272000;
  writeFixture(`gpt-6-luna-cache-cost-threshold-${inputTokens}`, {
    kind: 'ai_chat',
    provider: 'openai',
    model: AxAIOpenAIModel.GPT6Luna,
    request: {
      chat_prompt: [{ role: 'user', content: 'measure' }],
      model_config: { stream: false, thinkingTokenBudget: 'low' },
    },
    transport_responses: [
      {
        status: 200,
        json: {
          id: 'r_cost',
          model: AxAIOpenAIModel.GPT6Luna,
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
      ((inputTokens - 30000) * (long ? 0.2 : 0.1) +
        10000 * (long ? 0.02 : 0.01) +
        20000 * (long ? 0.25 : 0.125) +
        100 * (long ? 0.75 : 0.5)) /
      1000000,
  });
}

// Amazon Bedrock serves the same models as `openai.<model>` on bedrock-mantle
// and through cross-Region inference profiles such as `us.openai.<model>` and
// `global.openai.<model>` on bedrock-runtime. The IDs keep the model's
// contracts: GPT-6 runs on Responses without sampling parameters, and both
// families keep their effort ladders.
const bedrockRuntimeURL =
  'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1';
const bedrockMantleURL = 'https://bedrock-mantle.us-west-2.api.aws/openai/v1';
const bedrockResponse = (model: string) => ({
  status: 200,
  json: {
    id: 'resp_bedrock',
    model,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    output: [
      {
        id: 'msg_bedrock',
        type: 'message',
        content: [{ type: 'output_text', text: 'ok', annotations: [] }],
      },
    ],
  },
});

for (const [provider, model, budget] of [
  ['openai-responses', 'us.openai.gpt-6-sol', 'minimal'],
  ['openai-responses', 'global.openai.gpt-6-astra', 'highest'],
  ['openai', 'global.openai.gpt-6-luna', 'none'],
] as const) {
  const astra = model.includes('astra');
  writeFixture(`bedrock-${model.replaceAll('.', '-')}-on-${provider}`, {
    kind: 'ai_chat',
    provider,
    model,
    base_url: bedrockRuntimeURL,
    request: {
      chat_prompt: [{ role: 'user', content: 'reason' }],
      model_config: {
        stream: false,
        thinkingTokenBudget: budget,
        temperature: 0.5,
        topP: 0.9,
        ...(astra ? { presencePenalty: 1, frequencyPenalty: 1 } : {}),
      },
    },
    transport_responses: [bedrockResponse(model)],
    expected_transport_request: {
      method: 'POST',
      url: `${bedrockRuntimeURL}/responses`,
      json: {
        model,
        reasoning: {
          effort: axResolveOpenAIResponsesReasoningEffort(model, budget),
        },
        stream: false,
      },
    },
    expected_transport_json_absent: [
      'temperature',
      'top_p',
      ...(astra ? ['presence_penalty', 'frequency_penalty'] : []),
    ],
  });
}

// Bedrock's Chat Completions refuses Astra's function tools and points to
// /v1/responses, so the openai provider routes the call there.
const bedrockTool = {
  name: 'lookup',
  description: 'Look up a record',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
};
writeFixture('bedrock-openai-gpt-6-astra-tools-use-responses', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'openai.gpt-6-astra',
  base_url: bedrockMantleURL,
  request: {
    chat_prompt: [{ role: 'user', content: 'Look up record 7' }],
    functions: [bedrockTool],
    model_config: { stream: false, temperature: 0.5 },
  },
  transport_responses: [bedrockResponse('openai.gpt-6-astra')],
  expected_transport_request: {
    method: 'POST',
    url: `${bedrockMantleURL}/responses`,
    json: {
      model: 'openai.gpt-6-astra',
      tools: [{ type: 'function', ...bedrockTool }],
    },
  },
  expected_transport_json_absent: ['temperature'],
});

writeFixture('bedrock-us-openai-gpt-6-astra-none-rejected', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'us.openai.gpt-6-astra',
  base_url: bedrockRuntimeURL,
  request: {
    chat_prompt: [{ role: 'user', content: 'reason' }],
    model_config: { stream: false, thinkingTokenBudget: 'none' },
  },
  expected_error_contains: 'does not support disabling reasoning',
  expected_transport_request_count: 0,
});

// GPT-5.6 stays on Chat Completions, where Bedrock's ID keeps the 5.6 ladder.
writeFixture('bedrock-us-openai-gpt-5-6-sol-chat-effort', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'us.openai.gpt-5.6-sol',
  base_url: bedrockRuntimeURL,
  request: {
    chat_prompt: [{ role: 'user', content: 'reason' }],
    model_config: { stream: false, thinkingTokenBudget: 'minimal' },
  },
  transport_responses: [compatibleResponse('chat_bedrock', 'gpt-5.6-sol')],
  expected_transport_request: {
    method: 'POST',
    url: `${bedrockRuntimeURL}/chat/completions`,
    json: {
      model: 'us.openai.gpt-5.6-sol',
      reasoning_effort: axResolveOpenAIChatReasoningEffort(
        'us.openai.gpt-5.6-sol',
        'minimal'
      ),
    },
  },
});

// Bedrock documents the same explicit breakpoints on its Responses API.
writeFixture('bedrock-us-openai-gpt-6-sol-prompt-cache-breakpoints', {
  kind: 'ai_chat',
  provider: 'openai',
  model: 'us.openai.gpt-6-sol',
  base_url: bedrockRuntimeURL,
  service_options: { contextCache: {}, promptCacheKey: 'sol-prefix' },
  request: {
    chat_prompt: [{ role: 'user', content: 'cached' }],
    model_config: { thinkingTokenBudget: 'low' },
  },
  transport_responses: [bedrockResponse('us.openai.gpt-6-sol')],
  expected_transport_request: {
    method: 'POST',
    url: `${bedrockRuntimeURL}/responses`,
    json: {
      model: 'us.openai.gpt-6-sol',
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
      prompt_cache_key: 'sol-prefix',
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    },
  },
});

writeFixture('bedrock-us-openai-gpt-6-astra-features', {
  kind: 'ai_provider_features',
  provider: 'openai',
  model: 'us.openai.gpt-6-astra',
  base_url: bedrockRuntimeURL,
  expected_output: {
    functions: true,
    thinking: true,
    caching: { supported: true, types: ['ephemeral'] },
  },
});

// GPT-6 reports a served priority request as `fast`.
writeFixture('openai-served-fast-tier-reads-as-priority', {
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
        supported: { serviceTiers: ['priority'] },
        serviceTierPricing: {
          priority: { promptTokenCostPer1M: 4, completionTokenCostPer1M: 16 },
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
        id: 'chatcmpl_fast_tier',
        object: 'chat.completion',
        model: 'custom-tier-pricing',
        service_tier: 'fast',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      },
    },
  ],
  expected_estimated_cost: (1000 * 4 + 500 * 16) / 1000000,
});

// Claude 5.x thinking. Every model here rejects sampling parameters.
writeFixture('anthropic-opus-5-5-adaptive-thinking-request', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  request: {
    chat_prompt: [{ role: 'user', content: 'Think then answer.' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'high',
      temperature: 0.4,
      topP: 0.8,
      topK: 20,
    },
  },
  transport_responses: [
    {
      status: 200,
      json: {
        id: 'msg_opus55_think',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
      },
    },
  ],
  expected_transport_request: {
    json: {
      model: 'claude-opus-5-5',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    },
  },
  expected_transport_json_absent: ['temperature', 'top_p', 'top_k'],
});

const claudeNoneResponse = (model: string) => ({
  status: 200,
  json: {
    id: 'msg_none',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    model,
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  },
});

// Thinking cannot be switched off on these, so `none` asks for the least.
for (const [fixtureName, model] of [
  [
    'anthropic-opus-5-5-none-clamps-to-low-and-hides-thoughts',
    'claude-opus-5-5',
  ],
  [
    'anthropic-fable-5-1-none-clamps-to-low-and-hides-thoughts',
    'claude-fable-5-1',
  ],
  ['anthropic-fable-5-none-clamps-to-low-and-hides-thoughts', 'claude-fable-5'],
  [
    'anthropic-qualified-opus-5-5-is-not-opus-5',
    'publishers/anthropic/models/claude-opus-5-5',
  ],
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'anthropic',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'hi' }],
      model_config: { stream: false, thinkingTokenBudget: 'none' },
    },
    transport_responses: [claudeNoneResponse(model)],
    expected_transport_request: {
      json: {
        thinking: { type: 'adaptive', display: 'omitted' },
        output_config: { effort: 'low' },
      },
    },
  });
}

// These think by default but accept an explicit off switch.
for (const [fixtureName, model] of [
  ['anthropic-opus-5-none-disables-thinking', 'claude-opus-5'],
  ['anthropic-sonnet-5-none-disables-thinking', 'claude-sonnet-5'],
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'anthropic',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'hi' }],
      model_config: { stream: false, thinkingTokenBudget: 'none' },
    },
    transport_responses: [claudeNoneResponse(model)],
    expected_transport_request: {
      json: { thinking: { type: 'disabled' } },
    },
    expected_transport_json_absent: ['output_config'],
  });
}

writeFixture('anthropic-opus-5-disabled-thinking-rejects-xhigh', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'claude-opus-5',
  request: {
    chat_prompt: [{ role: 'user', content: 'hi' }],
    model_config: {
      stream: false,
      thinkingTokenBudget: 'none',
      effort: 'xhigh',
    },
  },
  expected_error_contains: "cannot disable thinking at effort 'xhigh'",
  expected_transport_request_count: 0,
});

const claudeSearchTool = {
  name: 'search',
  description: 'Search docs',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
};

// Opus 5.5 and Fable 5.1 answer a forced tool choice with a 400.
for (const [fixtureName, model, functionCall] of [
  [
    'anthropic-opus-5-5-forced-tool-choice-rejected',
    'claude-opus-5-5',
    'required',
  ],
  [
    'anthropic-fable-5-1-named-tool-choice-rejected',
    'claude-fable-5-1',
    { type: 'function', function: { name: 'search' } },
  ],
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'anthropic',
    model,
    request: {
      chat_prompt: [{ role: 'user', content: 'Search docs' }],
      functions: [claudeSearchTool],
      function_call: functionCall,
      model_config: { stream: false },
    },
    expected_error_contains: 'does not support explicitly forced tool choices',
    expected_transport_request_count: 0,
  });
}

writeFixture('anthropic-opus-5-5-ax-output-choice-is-dropped', {
  kind: 'ai_chat',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  request: {
    chat_prompt: [{ role: 'user', content: 'Return the structured output' }],
    functions: [
      {
        name: '__axOutput',
        description: 'Emit output',
        parameters: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    ],
    function_call: { type: 'function', function: { name: '__axOutput' } },
    model_config: { stream: false },
  },
  options: { functionCallSource: 'ax' },
  transport_responses: [claudeNoneResponse('claude-opus-5-5')],
  expected_transport_json_absent: ['tool_choice'],
});

// Opus 5+, Fable 5+ keep a later system message in place.
for (const [fixtureName, model] of [
  ['anthropic-opus-5-mid-conversation-system-preserved', 'claude-opus-5'],
  ['anthropic-fable-5-1-mid-conversation-system-preserved', 'claude-fable-5-1'],
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_chat',
    provider: 'anthropic',
    model,
    request: {
      chat_prompt: [
        { role: 'system', content: 'Initial policy.' },
        { role: 'user', content: 'Start.' },
        { role: 'system', content: 'From now on, be terse.' },
      ],
      model_config: { stream: false },
    },
    transport_responses: [claudeNoneResponse(model)],
    expected_transport_request: {
      json: {
        system: [{ type: 'text', text: 'Initial policy.' }],
        messages: [
          { role: 'user', content: 'Start.' },
          { role: 'system', content: 'From now on, be terse.' },
        ],
      },
    },
  });
}

// Gemini audio defaults: `speak()` uses 3.8 Flash TTS and `transcribe()` the
// dedicated 3.5 Transcribe model; both are JSON generateContent calls. The
// speak outputs carry TS's AxSpeechResponse keys, from TS's real speak(),
// next to the ports' older ones.
const geminiSpeechBody = (mimeType: string, data: string) => ({
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ inlineData: { mimeType, data } }],
      },
    },
  ],
});

{
  const request = { text: 'Hello from Ax.' };
  const json = geminiSpeechBody('audio/wav', 'UklGRg==');
  const ts = await tsSpeechResponse('google-gemini', request, () =>
    Response.json(json)
  );
  writeFixture('gemini-38-flash-tts-speak-default-model', {
    kind: 'ai_speak',
    provider: 'google-gemini',
    request,
    transport_responses: [{ status: 200, json }],
    expected_output: portSpeechOutput(
      { audio: 'UklGRg==', format: 'wav', mime_type: 'audio/wav' },
      ts.output
    ),
    expected_transport_request: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent',
      json: {
        contents: [{ role: 'user', parts: [{ text: 'Hello from Ax.' }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      },
    },
  });
}

{
  const request = {
    text: 'Hello from Ax.',
    model: 'gemini-3.1-flash-tts-preview',
  };
  const json = geminiSpeechBody(
    'audio/l16; rate=24000; channels=1',
    'AAAAAA=='
  );
  const ts = await tsSpeechResponse('google-gemini', request, () =>
    Response.json(json)
  );
  writeFixture('gemini-31-flash-tts-raw-pcm-is-labelled-pcm16', {
    kind: 'ai_speak',
    provider: 'google-gemini',
    request,
    transport_responses: [{ status: 200, json }],
    expected_output: portSpeechOutput(
      {
        audio: 'AAAAAA==',
        format: 'pcm16',
        mime_type: 'audio/l16; rate=24000; channels=1',
        sample_rate: 24000,
        channels: 1,
      },
      ts.output
    ),
    expected_transport_request: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent',
    },
  });
}

// Headerless PCM carries its sample rate and channel count only in the mime
// parameters: keys are case-insensitive and non-numeric parameters are skipped.
{
  const request = {
    text: 'Hello from Ax.',
    model: 'gemini-3.1-flash-tts-preview',
  };
  const json = geminiSpeechBody(
    'audio/L16;codec=pcm;RATE=16000;Channels=2',
    'AAAAAA=='
  );
  const ts = await tsSpeechResponse('google-gemini', request, () =>
    Response.json(json)
  );
  writeFixture('gemini-tts-raw-pcm-mime-parameters-are-parsed', {
    kind: 'ai_speak',
    provider: 'google-gemini',
    request,
    transport_responses: [{ status: 200, json }],
    expected_output: portSpeechOutput(
      {
        audio: 'AAAAAA==',
        format: 'pcm16',
        mime_type: 'audio/L16;codec=pcm;RATE=16000;Channels=2',
        sample_rate: 16000,
        channels: 2,
      },
      ts.output
    ),
    expected_transport_request: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent',
    },
  });
}

writeFixture('gemini-35-transcribe-default-model', {
  kind: 'ai_transcribe',
  provider: 'google-gemini',
  request: { audio: { data: 'UklGRg==', mimeType: 'audio/wav' } },
  transport_responses: [
    {
      status: 200,
      json: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ audioTranscription: { text: '10 9 8' } }],
            },
            finishReason: 'STOP',
          },
        ],
      },
    },
  ],
  expected_output: { text: '10 9 8' },
  expected_transport_request: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent',
    json: {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } },
            { text: 'Generate a transcript of the speech in this audio.' },
          ],
        },
      ],
    },
  },
});

// 3.8 Live refuses every thinking setting; Extended Thinking requires a level
// (Gemini's usual `medium` when none is asked for) and refuses `minimal`.
for (const { fixtureName, model, modelConfig, expectedThinkingConfig } of [
  {
    fixtureName: 'gemini-38-live-sends-no-thinking-config',
    model: 'gemini-3.8-live',
    modelConfig: { thinkingTokenBudget: 'high', showThoughts: true },
    expectedThinkingConfig: undefined,
  },
  {
    fixtureName: 'gemini-38-live-extended-thinking-defaults-to-medium',
    model: 'gemini-3.8-live-extended-thinking',
    modelConfig: {},
    expectedThinkingConfig: { thinkingLevel: 'medium' },
  },
  {
    fixtureName: 'gemini-38-live-extended-thinking-minimal-clamps-to-low',
    model: 'gemini-3.8-live-extended-thinking',
    modelConfig: { thinkingTokenBudget: 'minimal', showThoughts: true },
    expectedThinkingConfig: { thinkingLevel: 'low', includeThoughts: true },
  },
] as const) {
  writeFixture(fixtureName, {
    kind: 'ai_realtime',
    provider: 'google-gemini',
    model,
    request: {
      model,
      chat_prompt: [{ role: 'user', content: 'Answer with audio.' }],
      model_config: modelConfig,
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
          ...(expectedThinkingConfig
            ? { thinkingConfig: expectedThinkingConfig }
            : {}),
        },
        outputAudioTranscription: {},
      },
    },
  });
}

// The expensive-model gate (AxBaseAI._chat1). A model whose model info sets
// isExpensive is rejected before any request unless the call options, or the
// selected model-key entry, set useExpensiveModel: 'yes'. The AI's own
// constructor options don't count. Each fixture records what the TS client
// did: the error it threw and how many requests reached fetch.
const expensiveCustomModelInfo = [
  {
    name: 'my-premium-model',
    promptTokenCostPer1M: 1,
    completionTokenCostPer1M: 1,
    isExpensive: true,
  },
];
const expensiveChatCompletion = {
  id: 'chatcmpl-expensive',
  object: 'chat.completion',
  created: 1,
  model: 'my-premium-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
};
for (const testCase of [
  {
    name: 'expensive-model-rejected-without-confirmation',
    provider: 'openai',
    model: 'gpt-5.5-pro',
  },
  {
    name: 'expensive-model-client-option-does-not-confirm',
    provider: 'openai',
    model: 'gpt-5.5-pro',
    serviceOptions: { useExpensiveModel: 'yes' },
  },
  {
    name: 'expensive-model-dated-name-normalized',
    provider: 'openai',
    model: 'gpt-5.5-pro-2026-05-01',
  },
  {
    name: 'expensive-model-responses-catalog',
    provider: 'openai-responses',
    model: 'o3-pro',
  },
  {
    name: 'expensive-model-key-resolves-to-expensive-model',
    provider: 'openai',
    model: 'gpt-5.4-mini',
    requestModel: 'premium',
    models: [{ key: 'premium', model: 'gpt-5.5-pro', description: 'Premium' }],
  },
  {
    name: 'expensive-model-key-entry-confirms',
    provider: 'openai',
    model: 'gpt-5.4-mini',
    requestModel: 'premium',
    models: [
      {
        key: 'premium',
        model: 'my-premium-model',
        description: 'Premium',
        useExpensiveModel: 'yes',
      },
    ],
    modelInfo: expensiveCustomModelInfo,
    respond: true,
  },
  {
    // A key used as the client's default model resolves the model id only;
    // its entry's useExpensiveModel does not confirm.
    name: 'expensive-model-client-default-key-entry-does-not-confirm',
    provider: 'openai',
    model: 'premium',
    models: [
      {
        key: 'premium',
        model: 'my-premium-model',
        description: 'Premium',
        useExpensiveModel: 'yes',
      },
    ],
    modelInfo: expensiveCustomModelInfo,
    respond: true,
  },
  {
    name: 'expensive-model-info-rejected-without-confirmation',
    provider: 'openai',
    model: 'my-premium-model',
    modelInfo: expensiveCustomModelInfo,
  },
  {
    name: 'expensive-model-call-option-confirms',
    provider: 'openai',
    model: 'my-premium-model',
    modelInfo: expensiveCustomModelInfo,
    callOptions: { useExpensiveModel: 'yes' },
    respond: true,
  },
] as const) {
  let fetchCount = 0;
  const args = {
    apiKey: 'test-key',
    config: { model: testCase.model, stream: false },
    options: {
      fetch: async () => {
        fetchCount++;
        return Response.json(expensiveChatCompletion);
      },
      ...('serviceOptions' in testCase ? testCase.serviceOptions : {}),
    },
    ...('models' in testCase ? { models: testCase.models } : {}),
    ...('modelInfo' in testCase ? { modelInfo: testCase.modelInfo } : {}),
  };
  const client =
    testCase.provider === 'openai-responses'
      ? new AxAIOpenAIResponses(args as any)
      : new AxAIOpenAI({ name: 'openai', ...args } as any);
  const request = {
    ...('requestModel' in testCase ? { model: testCase.requestModel } : {}),
    chatPrompt: [{ role: 'user' as const, content: 'Hello' }],
    modelConfig: { stream: false },
  };
  let errorMessage: string | undefined;
  try {
    await client.chat(
      request as any,
      'callOptions' in testCase ? testCase.callOptions : undefined
    );
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const serviceOptions = {
    ...('serviceOptions' in testCase ? testCase.serviceOptions : {}),
    ...('models' in testCase ? { models: testCase.models } : {}),
    ...('modelInfo' in testCase ? { modelInfo: testCase.modelInfo } : {}),
  };
  writeFixture(testCase.name, {
    kind: 'ai_chat',
    provider: testCase.provider,
    model: testCase.model,
    ...(Object.keys(serviceOptions).length > 0
      ? { service_options: serviceOptions as Json }
      : {}),
    request: {
      ...('requestModel' in testCase ? { model: testCase.requestModel } : {}),
      chat_prompt: [{ role: 'user', content: 'Hello' }],
      model_config: { stream: false },
    },
    ...('callOptions' in testCase
      ? { options: testCase.callOptions as Json }
      : {}),
    ...('respond' in testCase
      ? { transport_responses: [expensiveChatCompletion] }
      : {}),
    ...(errorMessage ? { expected_error_contains: errorMessage } : {}),
    expected_transport_request_count: fetchCount,
  });
}

// Streaming goes through the same gate (AxBaseAI.chat -> _chat1), so a
// streamed request for an expensive model is rejected before fetch too.
const expensiveStreamBody =
  'data: {"id":"chatcmpl-expensive-stream","object":"chat.completion.chunk","created":1,"model":"my-premium-model","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n' +
  'data: {"id":"chatcmpl-expensive-stream","object":"chat.completion.chunk","created":1,"model":"my-premium-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';
for (const testCase of [
  {
    name: 'expensive-model-stream-rejected-without-confirmation',
    model: 'gpt-5.5-pro',
    callOptions: { stream: true },
  },
  {
    name: 'expensive-model-stream-call-option-confirms',
    model: 'my-premium-model',
    modelInfo: expensiveCustomModelInfo,
    callOptions: { stream: true, useExpensiveModel: 'yes' },
    respond: true,
  },
] as const) {
  let fetchCount = 0;
  const client = new AxAIOpenAI({
    name: 'openai',
    apiKey: 'test-key',
    config: { model: testCase.model },
    options: {
      fetch: async () => {
        fetchCount++;
        return new Response(expensiveStreamBody, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    },
    ...('modelInfo' in testCase ? { modelInfo: testCase.modelInfo } : {}),
  } as any);
  let errorMessage: string | undefined;
  try {
    const stream = await client.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Hello' }],
        modelConfig: { stream: true },
      },
      testCase.callOptions
    );
    if (stream instanceof ReadableStream) {
      const reader = stream.getReader();
      while (!(await reader.read()).done) {
        // Drain the stream so the request completes.
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  writeFixture(testCase.name, {
    kind: 'ai_stream',
    provider: 'openai',
    model: testCase.model,
    ...('modelInfo' in testCase
      ? { service_options: { modelInfo: testCase.modelInfo as Json } }
      : {}),
    request: { chat_prompt: [{ role: 'user', content: 'Hello' }] },
    options: testCase.callOptions as Json,
    ...('respond' in testCase
      ? { transport_responses: [{ status: 200, body: expensiveStreamBody }] }
      : {}),
    ...(errorMessage ? { expected_error_contains: errorMessage } : {}),
    expected_transport_request_count: fetchCount,
  });
}

// Wire JSON escaping (RFC 8259): tab, CR, U+0001, U+007F and a non-BMP emoji in
// a prompt, in tool-call args and in a tool result. OpenAI takes tool-call args
// as a JSON string, so that text is encoded twice. Each runner encodes the
// recorded request with its HTTP body encoder and checks the bytes against the
// TS encoder's output, strict JSON validity, and a lossless round trip.
const wireJSONText =
  'tab\there cr\rhere ctl\u0001here del\u007fhere emoji\u{1F600}here';
writeFixture('openai-wire-json-control-characters', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT54Mini,
  request: {
    chat_prompt: [
      { role: 'user', content: wireJSONText },
      {
        role: 'assistant',
        functionCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', params: { q: wireJSONText } },
          },
        ],
      },
      { role: 'function', functionId: 'call-1', result: wireJSONText },
    ],
    functions: [
      {
        name: 'lookup',
        description: 'Look up text',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      },
    ],
    model_config: { stream: false },
  },
  transport_responses: [
    compatibleResponse('chatcmpl_wire_json', AxAIOpenAIModel.GPT54Mini),
  ],
  expected_output: compatibleExpectedOutput(
    'openai',
    'chatcmpl_wire_json',
    AxAIOpenAIModel.GPT54Mini
  ),
  expected_transport_wire_json_contains: [
    JSON.stringify(wireJSONText),
    JSON.stringify(JSON.stringify({ q: wireJSONText })),
  ],
});

// Wire JSON numbers as TS JSON.stringify writes them (Number's toString):
// shortest round-trip digits, integral values without ".0", exponent form only
// below 1e-6 and from 1e21 up, and -0 as 0. The numbers sit in a tool schema,
// which goes into the body as is, and in tool-call args, which OpenAI takes as
// a JSON string, so there they are encoded twice. The literals keep 2.0, -0.0,
// 1e16 and 1.152921504606847e18 floats in the runners' JSON parsers. The
// needles must appear in the body TS itself sends.
const wireNumbers = [
  0,
  new NumberLiteral('-0.0'),
  new NumberLiteral('2.0'),
  2.5,
  -1234.56789,
  1234.56789,
  12345678.9,
  0.30000000000000004,
  0.0001,
  0.00001,
  0.000001,
  1e-7,
  1.5e-7,
  5e-324,
  new NumberLiteral('1e16'),
  9007199254740994,
  new NumberLiteral('1.152921504606847e18'),
  123456789012345680000,
  1e21,
  1.7976931348623157e308,
];
const wireNumbersRequest = {
  chat_prompt: [
    { role: 'user', content: 'Record the numbers' },
    {
      role: 'assistant',
      functionCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'record', params: { n: wireNumbers } },
        },
      ],
    },
    { role: 'function', functionId: 'call-1', result: 'recorded' },
  ],
  functions: [
    {
      name: 'record',
      description: 'Record numbers',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'array', items: { type: 'number' }, default: wireNumbers },
        },
        required: ['n'],
      },
    },
  ],
  model_config: { stream: false },
};
const wireNumbersResponse = compatibleResponse(
  'chatcmpl_wire_numbers',
  AxAIOpenAIModel.GPT54Mini
);
const wireNumbersGolden = goldenValue(wireNumbersRequest);
let wireNumbersBody = '';
await new AxAIOpenAI({
  name: 'openai',
  apiKey: 'test-key',
  config: { model: AxAIOpenAIModel.GPT54Mini },
  options: {
    fetch: async (_url: unknown, init?: RequestInit) => {
      wireNumbersBody = String(init?.body);
      return Response.json(wireNumbersResponse.json);
    },
  },
} as any).chat({
  chatPrompt: wireNumbersGolden.chat_prompt,
  functions: wireNumbersGolden.functions,
  modelConfig: wireNumbersGolden.model_config,
} as any);
const wireNumberNeedles = [
  `"default":${JSON.stringify(goldenValue(wireNumbers))}`,
  JSON.stringify(JSON.stringify({ n: goldenValue(wireNumbers) })),
];
for (const needle of wireNumberNeedles) {
  if (!wireNumbersBody.includes(needle)) {
    throw new Error(`TS wire JSON lacks ${needle}: ${wireNumbersBody}`);
  }
}
writeFixture('openai-wire-json-numbers', {
  kind: 'ai_chat',
  provider: 'openai',
  model: AxAIOpenAIModel.GPT54Mini,
  request: wireNumbersRequest as unknown as Json,
  transport_responses: [wireNumbersResponse],
  expected_output: compatibleExpectedOutput(
    'openai',
    'chatcmpl_wire_numbers',
    AxAIOpenAIModel.GPT54Mini
  ),
  expected_transport_wire_json_contains: wireNumberNeedles,
});

// Tool-call arguments on the wire in TS's key order: JSON.stringify writes an
// object's keys in its own-property order (array-index keys first in numeric
// order, then insertion order), for Chat's tool_calls[].function.arguments and
// Responses' function_call arguments alike. The request goes into the fixture
// as request_json text: the canonical fixture sort would reorder the params
// object's keys.
const keyOrderParams = {
  zeta: 1,
  alpha: 'x',
  '10': 'ten',
  '2': 'two',
  nested: { y: 1, x: 2 },
};
const keyOrderRequest = {
  chat_prompt: [
    { role: 'user', content: 'Look it up' },
    {
      role: 'assistant',
      functionCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'lookup', params: keyOrderParams },
        },
      ],
    },
    { role: 'function', functionId: 'call-1', result: 'found' },
  ],
  functions: [
    {
      name: 'lookup',
      description: 'Look something up',
      parameters: {
        type: 'object',
        properties: { zeta: { type: 'number' }, alpha: { type: 'string' } },
      },
    },
  ],
  model_config: { stream: false },
};
const keyOrderNeedle = `"arguments":${JSON.stringify(JSON.stringify(keyOrderParams))}`;
for (const [name, provider, AIClass, response] of [
  [
    'openai-tool-call-arguments-key-order',
    'openai',
    AxAIOpenAI,
    compatibleResponse('chatcmpl_key_order', AxAIOpenAIModel.GPT54Mini).json,
  ],
  [
    'openai-responses-tool-call-arguments-key-order',
    'openai-responses',
    AxAIOpenAIResponses,
    {
      id: 'resp_key_order',
      object: 'response',
      created_at: 0,
      model: AxAIOpenAIModel.GPT54Mini,
      status: 'completed',
      output: [
        {
          type: 'message',
          id: 'msg_key_order',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'ok', annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    },
  ],
] as const) {
  let body = '';
  await new (AIClass as any)({
    apiKey: 'test-key',
    config: { model: AxAIOpenAIModel.GPT54Mini },
    options: {
      fetch: async (_url: unknown, init?: RequestInit) => {
        body = String(init?.body);
        return Response.json(response);
      },
    },
  }).chat({
    chatPrompt: keyOrderRequest.chat_prompt,
    functions: keyOrderRequest.functions,
    modelConfig: keyOrderRequest.model_config,
  } as any);
  if (!body.includes(keyOrderNeedle)) {
    throw new Error(`${name}: TS wire lacks ${keyOrderNeedle}: ${body}`);
  }
  writeFixture(name, {
    kind: 'ai_chat',
    provider,
    model: AxAIOpenAIModel.GPT54Mini,
    request_json: JSON.stringify(keyOrderRequest),
    transport_responses: [{ status: 200, json: response as unknown as Json }],
    expected_transport_wire_json_contains: [keyOrderNeedle],
  });
}

// Sampling parameters on the wire. Each TS provider class starts from its own
// default config: temperature 0 for the OpenAI Chat profiles, Anthropic and
// Gemini (axBaseAIDefaultConfig), temperature 0.7 and topP 1 for
// openai-responses (axAIOpenAIResponsesDefaultConfig), nothing for the other
// Responses profiles. AxBaseAI merges the AI config, the model key's config and
// the request's modelConfig over it (resolveChatModelConfig). Model info marks
// the sampling parameters a model rejects (notSupported), and whether it takes
// them once reasoning is off (supported.samplingWithoutReasoning,
// reasoningOffByDefault): a default for such a parameter is never sent; an
// explicit value is sent when the request's reasoning effort allows it, and
// otherwise dropped with a one-time warning (applySamplingSupport). A profile
// without model info falls back to OpenAI's for an exact o-series name
// (samplingModelInfo). Each fixture records what the real TS client sent: the
// sampling fields it wrote, the ones it left out, and its warnings.
const samplingWireKeys: Record<string, string[]> = {
  'openai-chat': [
    'temperature',
    'top_p',
    'max_completion_tokens',
    'n',
    'presence_penalty',
    'frequency_penalty',
    'reasoning_effort',
  ],
  'openai-responses': [
    'temperature',
    'top_p',
    'max_output_tokens',
    'presence_penalty',
    'frequency_penalty',
    'reasoning.effort',
  ],
  'anthropic-messages': [
    'temperature',
    'top_p',
    'top_k',
    'max_tokens',
    'thinking.type',
  ],
  'gemini-generate-content': [
    'generationConfig.temperature',
    'generationConfig.topP',
    'generationConfig.topK',
    'generationConfig.maxOutputTokens',
    'generationConfig.candidateCount',
    'generationConfig.frequencyPenalty',
    'generationConfig.presencePenalty',
  ],
};
const samplingResponse = (transport: string, model: string) => {
  switch (transport) {
    case 'openai-responses':
      return {
        status: 200,
        json: {
          id: 'resp_sampling',
          model,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          output: [
            {
              id: 'msg_sampling',
              type: 'message',
              content: [{ type: 'output_text', text: 'ok', annotations: [] }],
            },
          ],
        },
      };
    case 'anthropic-messages':
      return {
        status: 200,
        json: {
          id: 'msg_sampling',
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      };
    case 'gemini-generate-content':
      return {
        status: 200,
        json: {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'ok' }] },
              finishReason: 'STOP',
            },
          ],
          modelVersion: model,
          responseId: 'gem_sampling',
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        },
      };
    default:
      return compatibleResponse('chatcmpl_sampling', model);
  }
};
const samplingJsonPath = (value: unknown, dotted: string): unknown =>
  dotted
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value
    );
// Runs one chat on the real TS client and returns the body it sent and the
// sampling warnings it logged.
const samplingChat = async (
  args: Record<string, unknown>,
  response: { json: unknown },
  modelConfig: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<{ body: unknown; url: string; warnings: string[] }> => {
  let body: unknown;
  let url = '';
  const warnings: string[] = [];
  const originalWarn = console.warn;
  resetDroppedSamplingWarnings();
  console.warn = (message?: unknown) => {
    if (/^Ax (dropped|raised) /.test(String(message))) {
      warnings.push(String(message));
    }
  };
  try {
    await ai({
      ...args,
      options: {
        fetch: async (input: unknown, init?: RequestInit) => {
          if (body === undefined) {
            body = JSON.parse(String(init?.body));
            url = String(input);
          }
          return Response.json(response.json);
        },
      },
    } as any).chat(
      {
        chatPrompt: [{ role: 'user', content: 'Hi' }],
        modelConfig: { stream: false, ...modelConfig },
      },
      options as any
    );
  } finally {
    console.warn = originalWarn;
  }
  return { body, url, warnings };
};
// Vertex clients take the access token from a function.
const vertexTestKey = async () => 'test-key';
const samplingModels: {
  provider: string;
  model: string;
  // Names the fixture instead of the provider (the Vertex rows).
  label?: string;
  base_url?: string;
  // TS ai() arguments and the matching fixture keys (azure-openai, Vertex).
  args?: Record<string, unknown>;
  fixtureArgs?: Record<string, Json>;
  penalties?: boolean;
  reasoning?: boolean;
  // Takes temperature 1 where it rejects other temperatures.
  temperatureOne?: boolean;
  // Anthropic thinking rules.
  thinking?: boolean;
  // Gemini penalties, candidate count and temperature floor.
  gemini?: boolean;
}[] = [
  // GPT-5.6 and 5.5 reject sampling unless a request turns reasoning off;
  // GPT-5.1 to 5.4 do not reason by default, so they take it unless a request
  // turns reasoning on; gpt-5, gpt-5-mini, gpt-5-nano and the o-series never
  // take it (probed 2026-09-27).
  {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    penalties: true,
    reasoning: true,
    temperatureOne: true,
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    penalties: true,
    reasoning: true,
    temperatureOne: true,
  },
  {
    provider: 'openai',
    model: 'gpt-5-mini',
    penalties: true,
    temperatureOne: true,
  },
  { provider: 'openai', model: 'gpt-4.1', penalties: true },
  { provider: 'openai', model: 'o3', penalties: true, temperatureOne: true },
  {
    provider: 'openai-responses',
    model: 'gpt-5.6-luna',
    penalties: true,
    reasoning: true,
    temperatureOne: true,
  },
  {
    provider: 'openai-responses',
    model: 'gpt-5.4-mini',
    penalties: true,
    reasoning: true,
    temperatureOne: true,
  },
  { provider: 'openai-responses', model: 'gpt-4.1', penalties: true },
  {
    provider: 'openai-responses',
    model: 'o3',
    penalties: true,
    temperatureOne: true,
  },
  // A profile carries no model info of its own, so GPT-5.x gets every
  // parameter, while an o-series name falls back to OpenAI's info.
  {
    provider: 'openai-compatible',
    model: 'gpt-5.6-luna',
    base_url: 'https://compatible.test/v1',
  },
  {
    provider: 'openai-compatible',
    model: 'o3',
    base_url: 'https://compatible.test/v1',
    penalties: true,
  },
  {
    provider: 'azure-openai',
    model: 'o3-mini',
    args: {
      resourceName: 'example',
      deploymentName: 'o3-mini',
      version: 'api-version=2024-10-21',
    },
    fixtureArgs: {
      resource_name: 'example',
      deployment_name: 'o3-mini',
      api_version: 'api-version=2024-10-21',
    },
    penalties: true,
    temperatureOne: true,
  },
  { provider: 'meta', model: profileDefaultModel('meta') },
  { provider: 'deepseek-responses', model: deepseekResponsesDefaultModel },
  // Anthropic (probed 2026-09-27): Sonnet 5 deprecated sampling (only
  // temperature 1); Opus 4.6 and Haiku 4.5 take every value with thinking off
  // and, while thinking, temperature 1, top_p >= 0.95 and no top_k, but never
  // temperature and top_p together. Vertex was not probed and keeps the
  // historical wire (the Haiku 4.5 Vertex row is the pair's negative).
  {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    thinking: true,
    temperatureOne: true,
  },
  { provider: 'anthropic', model: 'claude-opus-4-6', thinking: true },
  { provider: 'anthropic', model: anthropicSamplingModel, thinking: true },
  {
    provider: 'anthropic',
    label: 'anthropic-vertex',
    model: 'claude-opus-4-8',
    args: { apiKey: vertexTestKey, projectId: 'demo-project', region: 'us' },
    fixtureArgs: {
      service_options: { projectId: 'demo-project', region: 'us' },
    },
    thinking: true,
    temperatureOne: true,
  },
  {
    provider: 'anthropic',
    label: 'anthropic-vertex',
    model: 'claude-opus-4-6',
    args: { apiKey: vertexTestKey, projectId: 'demo-project', region: 'us' },
    fixtureArgs: {
      service_options: { projectId: 'demo-project', region: 'us' },
    },
    thinking: true,
  },
  {
    provider: 'anthropic',
    label: 'anthropic-vertex',
    model: 'claude-haiku-4-5@20251001',
    args: { apiKey: vertexTestKey, projectId: 'demo-project', region: 'us' },
    fixtureArgs: {
      service_options: { projectId: 'demo-project', region: 'us' },
    },
    thinking: true,
  },
  // Gemini: the server-managed Flash models ignore temperature, topP and topK;
  // the Gemini API rejects the penalties and, on Gemini 3, more than one
  // candidate; Gemini 3 takes no temperature below 1. Vertex keeps its wire.
  { provider: 'google-gemini', model: 'gemini-3.6-flash', gemini: true },
  { provider: 'google-gemini', model: 'gemini-3.5-flash', gemini: true },
  { provider: 'google-gemini', model: 'gemini-2.5-flash', gemini: true },
  {
    provider: 'google-gemini',
    label: 'google-gemini-vertex',
    model: 'gemini-3.5-flash',
    args: {
      apiKey: vertexTestKey,
      projectId: 'demo-project',
      region: 'us-central1',
    },
    fixtureArgs: {
      service_options: { projectId: 'demo-project', region: 'us-central1' },
    },
    gemini: true,
  },
  {
    provider: 'google-gemini',
    label: 'google-gemini-vertex',
    model: 'gemini-2.5-flash',
    args: {
      apiKey: vertexTestKey,
      projectId: 'demo-project',
      region: 'us-central1',
    },
    fixtureArgs: {
      service_options: { projectId: 'demo-project', region: 'us-central1' },
    },
    gemini: true,
  },
];
const samplingCases: {
  id: string;
  aiConfig?: Record<string, Json>;
  requestConfig?: Record<string, number>;
  budget?: 'none' | 'low';
  penalties?: boolean;
  reasoning?: boolean;
  temperatureOne?: boolean;
  thinking?: boolean;
  gemini?: boolean;
}[] = [
  { id: 'defaults' },
  {
    id: 'ai-config',
    aiConfig: { temperature: 0.7, topP: 0.9, maxTokens: 123 },
  },
  {
    id: 'request-config',
    requestConfig: { temperature: 0.5, topP: 0.8, maxTokens: 77 },
  },
  {
    id: 'ai-and-request-config',
    aiConfig: { temperature: 0.7, topP: 0.9, maxTokens: 123 },
    requestConfig: { temperature: 0.5 },
  },
  {
    id: 'request-penalties',
    requestConfig: { presencePenalty: 0.1, frequencyPenalty: 0.2, n: 2 },
    penalties: true,
  },
  // thinkingTokenBudget sets the request's reasoning effort; the ports carry
  // it in the request's model_config.
  {
    id: 'reasoning-none',
    requestConfig: { temperature: 0.5, topP: 0.8 },
    budget: 'none',
    reasoning: true,
  },
  {
    id: 'reasoning-low',
    requestConfig: { temperature: 0.5 },
    budget: 'low',
    reasoning: true,
  },
  {
    id: 'configured-effort-none',
    aiConfig: { temperature: 0.3, reasoningEffort: 'none' },
    reasoning: true,
  },
  // The value a model takes where it rejects every other temperature.
  {
    id: 'temperature-one',
    requestConfig: { temperature: 1 },
    temperatureOne: true,
  },
  // Anthropic: every sampling field with thinking off, while thinking, and the
  // values a thinking model takes.
  {
    id: 'sampling-thinking-off',
    requestConfig: { temperature: 0.5, topP: 0.9, topK: 40 },
    thinking: true,
  },
  {
    id: 'sampling-thinking-low',
    requestConfig: { temperature: 0.5, topP: 0.9, topK: 40 },
    budget: 'low',
    thinking: true,
  },
  {
    id: 'sampling-thinking-accepted',
    requestConfig: { temperature: 1, topP: 0.95 },
    budget: 'low',
    thinking: true,
  },
  // Anthropic: an explicit top_p alone, which goes in place of the default
  // temperature where a model rejects the pair.
  {
    id: 'top-p-only',
    requestConfig: { topP: 0.9 },
    thinking: true,
  },
  // Gemini: a temperature below 1, topK, both penalties and two candidates.
  {
    id: 'gemini-limits',
    requestConfig: {
      temperature: 0.2,
      topK: 40,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      n: 2,
    },
    gemini: true,
  },
];
for (const row of samplingModels) {
  const transport = axGetAIProfile(row.provider as any).transport as string;
  const wireKeys = samplingWireKeys[transport]!;
  for (const testCase of samplingCases) {
    if (testCase.penalties && !row.penalties) continue;
    if (testCase.reasoning && !row.reasoning) continue;
    if (testCase.temperatureOne && !row.temperatureOne) continue;
    if (testCase.thinking && !row.thinking) continue;
    if (testCase.gemini && !row.gemini) continue;
    const response = samplingResponse(transport, row.model);
    const { body, warnings } = await samplingChat(
      {
        name: row.provider,
        apiKey: 'test-key',
        ...(row.base_url ? { apiURL: row.base_url } : {}),
        ...(row.args ?? {}),
        config: { model: row.model, ...(testCase.aiConfig ?? {}) },
      },
      response,
      testCase.requestConfig ?? {},
      testCase.budget ? { thinkingTokenBudget: testCase.budget } : undefined
    );
    const sent: Record<string, Json> = {};
    const absent: string[] = [];
    for (const key of wireKeys) {
      const value = samplingJsonPath(body, key);
      if (value === undefined) {
        absent.push(key);
        continue;
      }
      const parts = key.split('.');
      let target = sent;
      for (const part of parts.slice(0, -1)) {
        target[part] ??= {};
        target = target[part] as Record<string, Json>;
      }
      target[parts[parts.length - 1]!] = value as Json;
    }
    const modelSlug = row.model.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    writeFixture(
      `sampling-${row.label ?? row.provider}-${modelSlug}-${testCase.id}`,
      {
        kind: 'ai_chat',
        provider: row.provider,
        model: row.model,
        ...(row.base_url ? { base_url: row.base_url } : {}),
        ...(row.fixtureArgs ?? {}),
        ...(testCase.aiConfig ? { model_config: testCase.aiConfig } : {}),
        request: {
          chat_prompt: [{ role: 'user', content: 'Hi' }],
          model_config: {
            stream: false,
            ...(testCase.requestConfig ?? {}),
            ...(testCase.budget
              ? { thinkingTokenBudget: testCase.budget }
              : {}),
          },
        },
        transport_responses: [response as unknown as Json],
        expected_transport_request: { json: sent },
        ...(absent.length > 0
          ? { expected_transport_json_absent: absent }
          : {}),
        expected_warnings: warnings,
      }
    );
  }
}

// A profile without a base URL of its own needs the caller's: TS
// resolveProfileURL throws "<Name> requires apiURL" instead of sending the
// provider's key to another host, and so does ai() in every port. The ports
// that read OPENAI_BASE_URL take it for openai-compatible, so it is unset.
for (const provider of ['openai-compatible', 'databricks', 'vertex-ai']) {
  let message = '';
  try {
    ai({ name: provider, apiKey: 'test-key' } as any);
  } catch (error) {
    message = (error as Error).message;
  }
  if (!message.endsWith(' requires apiURL')) {
    throw new Error(`TS ${provider} did not require apiURL: ${message}`);
  }
  writeFixture(`requires-api-url-${provider}`, {
    kind: 'ai_chat',
    provider,
    model: 'gpt-5.4-mini',
    env: { OPENAI_BASE_URL: null },
    request: {
      chat_prompt: [{ role: 'user', content: 'Hi' }],
      model_config: { stream: false },
    },
    transport_responses: [],
    expected_error_contains: message,
    expected_transport_request_count: 0,
  });
}

// Credentials from the environment stay with their own provider. TS reads no
// environment, so these fixtures are port-only; where TS makes a request, it
// supplies the expected URL (the provider's own). The ports read
// OPENAI_API_KEY and OPENAI_BASE_URL only for openai, openai-responses and
// openai-compatible, and ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL only for
// anthropic: before, an OpenAI or Anthropic key from the environment went to
// other providers' servers, and other providers' keys went to OPENAI_BASE_URL.
const credentialEnv = {
  OPENAI_API_KEY: 'openai-env-key',
  OPENAI_APIKEY: null,
  OPENAI_BASE_URL: 'https://openai-proxy.test/v1',
  ANTHROPIC_API_KEY: 'anthropic-env-key',
  ANTHROPIC_BASE_URL: 'https://anthropic-proxy.test/v1',
} as const;
for (const [provider, model, message] of [
  [
    'groq',
    'llama-3.3-70b-versatile',
    'groq requires api_key or credential_provider (OPENAI_API_KEY is only read for openai, openai-responses and openai-compatible)',
  ],
  [
    'meta-messages',
    profileDefaultModel('meta-messages'),
    'meta-messages requires api_key or credential_provider (ANTHROPIC_API_KEY is only read for anthropic)',
  ],
] as const) {
  writeFixture(`credential-env-key-not-sent-to-${provider}`, {
    kind: 'ai_chat',
    provider,
    model,
    no_api_key: true,
    env: credentialEnv,
    request: {
      chat_prompt: [{ role: 'user', content: 'Hi' }],
      model_config: { stream: false },
    },
    transport_responses: [],
    expected_error_contains: message,
    expected_transport_request_count: 0,
  });
}
// anthropic keeps its own ANTHROPIC_BASE_URL, so that one is unset there.
for (const [provider, model, env] of [
  ['groq', 'llama-3.3-70b-versatile', credentialEnv],
  [
    'anthropic',
    anthropicSamplingModel,
    { ...credentialEnv, ANTHROPIC_BASE_URL: null },
  ],
  ['meta-messages', profileDefaultModel('meta-messages'), credentialEnv],
] as const) {
  const transport = axGetAIProfile(provider).transport as string;
  const response = samplingResponse(transport, model);
  const { url } = await samplingChat(
    { name: provider, apiKey: 'test-key', config: { model } },
    response,
    {}
  );
  if (url.includes('proxy.test')) {
    throw new Error(`TS ${provider} used an env base URL: ${url}`);
  }
  writeFixture(`credential-env-base-url-not-used-by-${provider}`, {
    kind: 'ai_chat',
    provider,
    model,
    env,
    request: {
      chat_prompt: [{ role: 'user', content: 'Hi' }],
      model_config: { stream: false },
    },
    transport_responses: [response as unknown as Json],
    expected_transport_request: { url },
  });
}
{
  const response = samplingResponse('openai-chat', 'gpt-5.4-mini');
  writeFixture('credential-env-key-for-openai', {
    kind: 'ai_chat',
    provider: 'openai',
    model: 'gpt-5.4-mini',
    no_api_key: true,
    env: { ...credentialEnv, OPENAI_BASE_URL: null },
    request: {
      chat_prompt: [{ role: 'user', content: 'Hi' }],
      model_config: { stream: false },
    },
    transport_responses: [response as unknown as Json],
    expected_transport_request: {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: 'Bearer openai-env-key' },
    },
  });
}
// Provider errors never carry credentials. TypeScript's AxAIServiceError keeps
// the URL and the request body, and never the request headers, which hold the
// API key or the credential provider's tokens. includeRequestBodyInErrors
// (default true; the call option overrides the client option) takes the body
// out of the error TypeScript prints. The ports' errors have no printed form
// with a body, so their error request is that printed view: the URL, plus the
// body unless includeRequestBodyInErrors is false. Go, Rust and C++ errors keep
// no request at all; every port checks the secret appears nowhere in the error.
const errorApiKey = 'sk-fixture-secret-key-7b41';
const errorCredentialToken = 'fixture-credential-token-5d08';
const errorBodyMarker = 'fixture-body-marker-2c9e';
const errorPrompt = [{ role: 'user', content: errorBodyMarker }];
const errorResponse = (status: number) => ({
  status,
  json: { error: { message: `scripted ${status}`, code: 'invalid_request' } },
});
type ErrorClient = {
  chat: (request: any, options?: any) => Promise<unknown>;
};

async function tsProviderError(
  make: (fetch: typeof globalThis.fetch) => ErrorClient,
  status: number,
  callOptions?: Record<string, unknown>,
  stream = false
) {
  let fetchCount = 0;
  let sentHeaders = '';
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    fetchCount++;
    sentHeaders = JSON.stringify(init?.headers ?? {});
    return Response.json(errorResponse(status).json, { status });
  }) as typeof globalThis.fetch;
  try {
    await make(fetch).chat(
      { chatPrompt: errorPrompt, modelConfig: { stream } },
      callOptions
    );
  } catch (error) {
    if (!(error instanceof AxAIServiceError)) throw error;
    return { error, fetchCount, sentHeaders };
  }
  throw new Error('TS provider call did not fail');
}

function providerErrorFixture(
  name: string,
  result: Awaited<ReturnType<typeof tsProviderError>>,
  secret: string,
  bodyKey: 'messages' | 'contents',
  fixture: Fixture
) {
  const { error, fetchCount, sentHeaders } = result;
  if (!sentHeaders.includes(secret)) {
    throw new Error(`${name}: TS did not send ${secret}`);
  }
  // What a logger, tracer or error reporter prints or serializes.
  const printed = [
    String(error),
    error.stack ?? '',
    inspect(error, { depth: 20 }),
  ].join('\n');
  if (printed.includes(secret) || JSON.stringify(error).includes(secret)) {
    throw new Error(`${name}: the TS error carries ${secret}`);
  }
  const printsBody = printed.includes(errorBodyMarker);
  if (printsBody !== error.includeRequestBodyInErrors) {
    throw new Error(`${name}: the TS error prints its body against the flag`);
  }
  const requestBody = error.requestBody as Record<string, Json>;
  writeFixture(name, {
    kind: 'ai_error',
    ...fixture,
    request: {
      chat_prompt: errorPrompt,
      model_config: { stream: fixture.method === 'stream' },
    },
    expected_error_type: error.name,
    ...(error instanceof AxAIServiceStatusError
      ? { expected_status: error.status }
      : {}),
    expected_error_excludes: printsBody ? [secret] : [secret, errorBodyMarker],
    expected_error_request: {
      url: error.url,
      ...(printsBody ? { json: { [bodyKey]: requestBody[bodyKey] } } : {}),
    },
    expected_transport_request_count: fetchCount,
  });
}

const openAIErrorClient =
  (options: Record<string, unknown> = {}, credentials = false) =>
  (fetch: typeof globalThis.fetch): ErrorClient =>
    new AxAIOpenAI({
      name: 'openai',
      ...(credentials
        ? {
            credentialProvider: async () => ({
              Authorization: `Bearer ${errorCredentialToken}`,
            }),
          }
        : { apiKey: errorApiKey }),
      config: { model: AxAIOpenAIModel.GPT54Mini },
      options: { fetch, ...options },
    } as any);

providerErrorFixture(
  'provider-error-omits-credentials',
  await tsProviderError(openAIErrorClient(), 400),
  errorApiKey,
  'messages',
  {
    provider: 'openai',
    model: AxAIOpenAIModel.GPT54Mini,
    api_key: errorApiKey,
    transport_responses: [errorResponse(400)],
  }
);

providerErrorFixture(
  'provider-error-client-option-omits-body',
  await tsProviderError(
    openAIErrorClient({ includeRequestBodyInErrors: false }),
    400
  ),
  errorApiKey,
  'messages',
  {
    provider: 'openai',
    model: AxAIOpenAIModel.GPT54Mini,
    api_key: errorApiKey,
    service_options: { includeRequestBodyInErrors: false },
    transport_responses: [errorResponse(400)],
  }
);

// The call option wins over the client option.
providerErrorFixture(
  'provider-error-call-option-omits-body',
  await tsProviderError(
    openAIErrorClient({ includeRequestBodyInErrors: true }),
    400,
    { includeRequestBodyInErrors: false }
  ),
  errorApiKey,
  'messages',
  {
    provider: 'openai',
    model: AxAIOpenAIModel.GPT54Mini,
    api_key: errorApiKey,
    service_options: { includeRequestBodyInErrors: true },
    options: { includeRequestBodyInErrors: false },
    transport_responses: [errorResponse(400)],
  }
);

providerErrorFixture(
  'provider-error-omits-credential-provider-token',
  await tsProviderError(openAIErrorClient({}, true), 401),
  errorCredentialToken,
  'messages',
  {
    provider: 'openai',
    model: AxAIOpenAIModel.GPT54Mini,
    credential_provider_fixture: {
      headers: [{ Authorization: `Bearer ${errorCredentialToken}` }],
    },
    transport_responses: [errorResponse(401)],
    expected_status: 401,
  }
);

providerErrorFixture(
  'provider-error-anthropic-omits-api-key',
  await tsProviderError(
    (fetch) =>
      new AxAIAnthropic({
        apiKey: errorApiKey,
        config: { model: AxAIAnthropicModel.Claude5Sonnet },
        options: { fetch },
      } as any),
    401
  ),
  errorApiKey,
  'messages',
  {
    provider: 'anthropic',
    model: AxAIAnthropicModel.Claude5Sonnet,
    api_key: errorApiKey,
    transport_responses: [errorResponse(401)],
    expected_status: 401,
  }
);

providerErrorFixture(
  'provider-error-gemini-omits-api-key',
  await tsProviderError(
    (fetch) =>
      new AxAIGoogleGemini({
        apiKey: errorApiKey,
        config: { model: AxAIGoogleGeminiModel.Gemini36Flash },
        options: { fetch },
      } as any),
    400
  ),
  errorApiKey,
  'contents',
  {
    provider: 'google-gemini',
    model: AxAIGoogleGeminiModel.Gemini36Flash,
    api_key: errorApiKey,
    transport_responses: [errorResponse(400)],
  }
);

// The error left once the stream's retries run out.
const errorRetry = { maxRetries: 1, initialDelayMs: 0, maxDelayMs: 0 };
providerErrorFixture(
  'provider-error-stream-retries-omit-credentials',
  await tsProviderError(
    openAIErrorClient({ retry: errorRetry, includeRequestBodyInErrors: false }),
    500,
    undefined,
    true
  ),
  errorApiKey,
  'messages',
  {
    method: 'stream',
    provider: 'openai',
    model: AxAIOpenAIModel.GPT54Mini,
    api_key: errorApiKey,
    service_options: { retry: errorRetry, includeRequestBodyInErrors: false },
    transport_responses: [errorResponse(500), errorResponse(500)],
  }
);

// TS checks each chat prompt message before any request goes out
// (axValidateChatRequestMessage): a role that is not a non-empty string, an
// unknown role, and a user content item that is not an object or has no type
// fail with messages that show the value as JSON.stringify(value, null, 2)
// writes it, undefined when it is missing. The expected messages are TS's own.
// Ports classify all malformed messages as AxAIServiceResponseError.
async function tsChatPromptError(chatPrompt: unknown[]): Promise<string> {
  const llm = ai({ name: 'openai', apiKey: 'test-key' });
  llm.setOptions({
    fetch: (async () => {
      throw new Error('chat-prompt check: no request expected');
    }) as never,
  });
  try {
    await llm.chat({ chatPrompt: chatPrompt as never }, { stream: false });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('chat-prompt check: TS accepted the prompt');
}
for (const [name, chatPrompt] of [
  ['chat-message-missing-role', [{ content: 'hi' }]],
  ['chat-message-null-role', [{ role: null, content: 'hi' }]],
  ['chat-message-empty-role', [{ role: '', content: 'hi' }]],
  ['chat-message-number-role', [{ role: 5, content: 'hi' }]],
  ['chat-message-blank-role', [{ role: '  ', content: 'hi' }]],
  ['chat-message-unknown-role', [{ role: 'robot', content: 'hi' }]],
  [
    'chat-message-content-item-without-type',
    [{ role: 'user', content: [{ text: 'hi' }] }],
  ],
  [
    'chat-message-content-item-null-type',
    [{ role: 'user', content: [{ type: null, text: 'hi' }] }],
  ],
  [
    'chat-message-content-item-empty-type',
    [{ role: 'user', content: [{ type: '', text: 'hi' }] }],
  ],
  ['chat-message-content-item-not-object', [{ role: 'user', content: ['hi'] }]],
  ['chat-message-content-item-null', [{ role: 'user', content: [null] }]],
  ['chat-message-content-item-list', [{ role: 'user', content: [['hi']] }]],
] as const) {
  writeFixture(name, {
    kind: 'ai_error',
    request: { chat_prompt: chatPrompt },
    expected_error_contains: await tsChatPromptError([...chatPrompt]),
    expected_error_type: 'AxAIServiceResponseError',
  });
}

// Core owns the request a provider error keeps (@ai_error_request), and the
// normalizer and the request-carrying ai.error intrinsics build every error
// from it, so no call site can hand a raw transport call (headers included) to
// an error. "view" calls the op directly; "normalize" gives the normalizer the
// raw call. The URL and body come from TypeScript's AxAIServiceError for the
// same request (apiCall with a rejecting fetch); the snake_case flag, the
// multipart `data` body, the body-less GET and a non-object call are the ports'
// own request shapes, which TypeScript's apiCall has no counterpart for.
const viewSecret = 'sk-view-secret-3e1f';
const viewHeaders = {
  Authorization: `Bearer ${viewSecret}`,
  'x-api-key': viewSecret,
  'x-goog-api-key': viewSecret,
};
const viewUrl = 'https://api.openai.com/v1/chat/completions';
const viewBody = {
  model: AxAIOpenAIModel.GPT54Mini,
  messages: [{ role: 'user', content: errorBodyMarker }],
};
async function tsApiCallError(
  status: number,
  includeRequestBodyInErrors?: boolean
) {
  const error = await apiCall(
    {
      url: viewUrl,
      headers: viewHeaders,
      fetch: (async () =>
        Response.json(errorResponse(status).json, {
          status,
        })) as typeof globalThis.fetch,
      retry: { maxRetries: 0 },
      ...(includeRequestBodyInErrors === undefined
        ? {}
        : { includeRequestBodyInErrors }),
    },
    viewBody
  ).catch((e: unknown) => e);
  if (!(error instanceof AxAIServiceError)) {
    throw new Error('TS apiCall did not fail with an AxAIServiceError');
  }
  const printed = `${String(error)}\n${JSON.stringify(error)}`;
  if (printed.includes(viewSecret)) {
    throw new Error('the TS error carries a request header');
  }
  // The view is what TypeScript's error keeps where it can be read or logged:
  // the URL, and the body when includeRequestBodyInErrors lets it show.
  const view: Record<string, Json> = { url: error.url };
  if (printed.includes(errorBodyMarker)) {
    view.json = error.requestBody as Json;
  }
  return { error, view };
}
const viewCall = (extra: Record<string, Json> = {}) => ({
  method: 'POST',
  url: viewUrl,
  headers: viewHeaders,
  json: viewBody,
  stream: false,
  ...extra,
});
const tsDefaultView = (await tsApiCallError(400)).view;
const tsNoBodyView = (await tsApiCallError(400, false)).view;
if (!('json' in tsDefaultView) || 'json' in tsNoBodyView) {
  throw new Error('TS error body does not follow includeRequestBodyInErrors');
}
writeFixture('provider-error-request-view', {
  kind: 'ai_error_request',
  operation: 'view',
  cases: [
    { call: viewCall(), expected: tsDefaultView },
    {
      call: viewCall(),
      options: { includeRequestBodyInErrors: true },
      expected: tsDefaultView,
    },
    {
      call: viewCall(),
      options: { includeRequestBodyInErrors: false },
      expected: tsNoBodyView,
    },
    {
      call: viewCall(),
      options: { include_request_body_in_errors: false },
      expected: tsNoBodyView,
    },
    {
      call: viewCall(),
      options: {
        includeRequestBodyInErrors: true,
        include_request_body_in_errors: false,
      },
      expected: tsDefaultView,
    },
    {
      call: {
        method: 'POST',
        url: 'https://api.openai.com/v1/audio/transcriptions',
        headers: viewHeaders,
        data: { model: 'whisper-1', file: errorBodyMarker },
      },
      expected: {
        url: 'https://api.openai.com/v1/audio/transcriptions',
        data: { model: 'whisper-1', file: errorBodyMarker },
      },
    },
    {
      call: {
        method: 'GET',
        url: 'https://api.typesafe.ai/v1/models',
        headers: viewHeaders,
      },
      expected: { url: 'https://api.typesafe.ai/v1/models' },
    },
    { call: { headers: viewHeaders }, expected: {} },
    { call: null, expected: null },
  ],
});

const normalizeCase = (
  status: number,
  tsResult: Awaited<ReturnType<typeof tsApiCallError>>,
  options?: Record<string, Json>,
  errorType?: string
) => ({
  status,
  body: errorResponse(status).json,
  call: viewCall(),
  ...(options ? { options } : {}),
  expected_error_type: errorType ?? tsResult.error.name,
  expected_status: status,
  expected_error_excludes:
    'json' in tsResult.view ? [viewSecret] : [viewSecret, errorBodyMarker],
  expected_error_request: tsResult.view,
});
writeFixture('provider-error-normalizer-drops-headers', {
  kind: 'ai_error_request',
  operation: 'normalize',
  cases: [
    normalizeCase(400, await tsApiCallError(400)),
    normalizeCase(401, await tsApiCallError(401)),
    normalizeCase(400, await tsApiCallError(400, false), {
      includeRequestBodyInErrors: false,
    }),
    // The ports map 408 and 504 to AxAIServiceTimeoutError (TypeScript keeps a
    // status error), which pins the timeout intrinsic with a raw call too.
    normalizeCase(
      504,
      await tsApiCallError(504, false),
      { includeRequestBodyInErrors: false },
      'AxAIServiceTimeoutError'
    ),
  ],
});

// Gemini Live takes the API key in its WebSocket URL, and TypeScript encodes it
// with encodeURIComponent (src/ax/ai/google-gemini/live_audio.ts).
const liveKey = 'key with/special&chars=é';
const liveDescriptor = JSON.parse(
  readFileSync(
    join(process.cwd(), 'ir/axcore/data/provider-descriptors.json'),
    'utf8'
  )
)['google-gemini'].operations.realtime as { url: string };
writeFixture('gemini-live-ws-url-encodes-key', {
  kind: 'ai_realtime',
  provider: 'google-gemini',
  model: 'gemini-3.8-live',
  api_key: liveKey,
  expected_ws_url: `${liveDescriptor.url}?key=${encodeURIComponent(liveKey)}`,
});

// AxGen's portable message uses function_id. Normalize that host spelling to
// the same Responses call_id TypeScript sends for functionId.
{
  let body: Record<string, Json> = {};
  const response = {
    id: 'resp_tool_output',
    output: [
      {
        id: 'msg_tool_output',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '12 units' }],
      },
    ],
  };
  await new AxAIOpenAIResponses({
    apiKey: 'test-key',
    config: { model: AxAIOpenAIModel.GPT6Luna },
    options: {
      fetch: async (_url: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, Json>;
        return Response.json(response);
      },
    },
  }).chat(
    {
      chatPrompt: [
        {
          role: 'function',
          functionId: 'call_inventory',
          result: '12 units available',
        },
      ],
    } as never,
    { stream: false }
  );
  writeFixture('openai-responses-generated-tool-result-id', {
    kind: 'ai_chat',
    provider: 'openai-responses',
    model: AxAIOpenAIModel.GPT6Luna,
    request: {
      chat_prompt: [
        {
          role: 'function',
          function_id: 'call_inventory',
          result: '12 units available',
        },
      ],
      model_config: { stream: false },
    },
    transport_responses: [{ status: 200, json: response }],
    expected_transport_request: { json: { input: body.input } },
  });
}
