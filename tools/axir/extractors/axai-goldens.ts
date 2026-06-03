import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { axAIAnthropicDefaultConfig } from '../../../src/ax/ai/anthropic/api.js';
import { axAIAzureOpenAIDefaultConfig } from '../../../src/ax/ai/azure-openai/api.js';
import { AxBalancer } from '../../../src/ax/ai/balance.js';
import { axGetSupportedAIModels } from '../../../src/ax/ai/catalog.js';
import { axAICohereDefaultConfig } from '../../../src/ax/ai/cohere/api.js';
import { AxAICohereEmbedModel } from '../../../src/ax/ai/cohere/types.js';
import { axAIDeepSeekDefaultConfig } from '../../../src/ax/ai/deepseek/api.js';
import { axAIGoogleGeminiDefaultConfig } from '../../../src/ax/ai/google-gemini/api.js';
import { AxAIGoogleGeminiEmbedModel } from '../../../src/ax/ai/google-gemini/types.js';
import { axAIMistralDefaultConfig } from '../../../src/ax/ai/mistral/api.js';
import { AxMultiServiceRouter } from '../../../src/ax/ai/multiservice.js';
import { AxAIOpenAIModel } from '../../../src/ax/ai/openai/chat_types.js';
import { axAIOpenAIResponsesDefaultConfig } from '../../../src/ax/ai/openai/responses_api_base.js';
import { axAIRekaDefaultConfig } from '../../../src/ax/ai/reka/api.js';
import { AxProviderRouter } from '../../../src/ax/ai/router.js';
import { axAIGrokDefaultConfig } from '../../../src/ax/ai/x-grok/api.js';
import {
  AxAIServiceAuthenticationError,
  AxAIServiceNetworkError,
  AxAIServiceResponseError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../../../src/ax/util/apicall.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(process.cwd(), 'ir/conformance/axai');

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

const responsesDefaultModel = axAIOpenAIResponsesDefaultConfig()
  .model as string;
const azureDefaultModel = axAIAzureOpenAIDefaultConfig().model as string;
const deepseekDefaultModel = axAIDeepSeekDefaultConfig().model as string;
const mistralDefaultModel = axAIMistralDefaultConfig().model as string;
const rekaDefaultModel = axAIRekaDefaultConfig().model as string;
const cohereDefaultModel = axAICohereDefaultConfig().model as string;
const cohereDefaultEmbedModel = AxAICohereEmbedModel.EmbedEnglishV30;
const grokDefaultModel = axAIGrokDefaultConfig().model as string;
const geminiDefaultModel = axAIGoogleGeminiDefaultConfig().model as string;
const geminiDefaultEmbedModel = 'gemini-embedding-2';
const anthropicDefaultModel = axAIAnthropicDefaultConfig().model as string;
const catalogAll = axGetSupportedAIModels();
const catalogText = axGetSupportedAIModels({ type: 'text' });
const catalogEmbeddings = axGetSupportedAIModels({ type: 'embeddings' });
const catalogCode = axGetSupportedAIModels({ type: 'code' });
const catalogAudio = axGetSupportedAIModels({ type: 'audio' });
const catalogProviderNames = [
  'openai',
  'openai-responses',
  'azure-openai',
  'anthropic',
  'google-gemini',
  'cohere',
  'deepseek',
  'mistral',
  'huggingface',
  'reka',
  'grok',
];
const descriptorCoveredProviderIds = [
  'openai-compatible',
  'openai-responses',
  'google-gemini',
  'anthropic',
  'azure-openai',
  'deepseek',
  'mistral',
  'reka',
  'cohere',
  'grok',
];
const deferredProviderIds = ['huggingface'];
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

  constructor(spec: {
    name: string;
    id?: string;
    modelList?: any[];
    features?: any;
    responses?: any[];
    metrics?: any;
  }) {
    this.name = spec.name;
    this.id = spec.id ?? `${spec.name}-id`;
    this.modelList = spec.modelList;
    this.features = spec.features ?? routerFeatures();
    this.responses = [...(spec.responses ?? [])];
    this.metricsValue = spec.metrics ?? { service: this.name, calls: 0 };
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
    return 0;
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
  alias_expectations: {
    openai: 'openai-compatible',
    'openai-compatible': 'openai-compatible',
    compatible: 'openai-compatible',
    'openai-responses': 'openai-responses',
    openai_responses: 'openai-responses',
    responses: 'openai-responses',
    'google-gemini': 'google-gemini',
    google_gemini: 'google-gemini',
    gemini: 'google-gemini',
    anthropic: 'anthropic',
    claude: 'anthropic',
    'azure-openai': 'azure-openai',
    azure_openai: 'azure-openai',
    azure: 'azure-openai',
    deepseek: 'deepseek',
    mistral: 'mistral',
    reka: 'reka',
    cohere: 'cohere',
    grok: 'grok',
    xai: 'grok',
    'x-grok': 'grok',
    x_grok: 'grok',
  },
  expected_output: {
    registryVersion: 'provider-profile-registry-v1',
    supportedProfileIds: descriptorCoveredProviderIds,
    profiles: {
      'openai-compatible': {
        id: 'openai-compatible',
        generatedClient: 'OpenAICompatibleClient',
        aliases: ['openai-compatible', 'openai', 'compatible'],
        catalogStatus: 'descriptor-covered',
      },
      'openai-responses': {
        id: 'openai-responses',
        generatedClient: 'OpenAIResponsesClient',
        aliases: ['openai-responses', 'openai_responses', 'responses'],
        catalogStatus: 'descriptor-covered',
      },
      'google-gemini': {
        id: 'google-gemini',
        generatedClient: 'GoogleGeminiClient',
        aliases: ['google-gemini', 'google_gemini', 'gemini'],
        catalogStatus: 'descriptor-covered',
      },
      anthropic: {
        id: 'anthropic',
        generatedClient: 'AnthropicClient',
        aliases: ['anthropic', 'claude'],
        catalogStatus: 'descriptor-covered',
      },
      'azure-openai': {
        id: 'azure-openai',
        generatedClient: 'AzureOpenAIClient',
        aliases: ['azure-openai', 'azure_openai', 'azure'],
        catalogStatus: 'descriptor-covered',
      },
      deepseek: {
        id: 'deepseek',
        generatedClient: 'DeepSeekClient',
        aliases: ['deepseek'],
        catalogStatus: 'descriptor-covered',
      },
      mistral: {
        id: 'mistral',
        generatedClient: 'MistralClient',
        aliases: ['mistral'],
        catalogStatus: 'descriptor-covered',
      },
      reka: {
        id: 'reka',
        generatedClient: 'RekaClient',
        aliases: ['reka'],
        catalogStatus: 'descriptor-covered',
      },
      cohere: {
        id: 'cohere',
        generatedClient: 'CohereClient',
        aliases: ['cohere'],
        catalogStatus: 'descriptor-covered',
      },
      grok: {
        id: 'grok',
        generatedClient: 'GrokClient',
        aliases: ['grok', 'xai', 'x-grok', 'x_grok'],
        catalogStatus: 'descriptor-covered',
      },
    },
    deferredCatalogProviderIds: deferredProviderIds,
  },
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
    providerCount: 11,
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
      'Additional catalog provider clients complete except Hugging Face',
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
      images: { supported: true, formats: ['png'] },
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
        { type: 'image', image: 'abc', altText: 'diagram', cache: true },
      ],
    },
  ],
  functions: [{ name: 'tool' }],
  modelConfig: { stream: true },
};
const providerRouter = new AxProviderRouter({
  providers: {
    primary: new FixtureAIService(textOnlySpec) as any,
    alternatives: [new FixtureAIService(visionSpec) as any],
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
    validation: (await providerRouter.validateRequest(routingRequest as any)) as
      | Json
      | any,
    stats: providerRouter.getRoutingStats() as any,
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
    name: 'openai-responses',
    defaultModel: responsesDefaultModel,
    defaultEmbedModel: 'text-embedding-ada-002',
    operations: {
      chat: { method: 'POST', path: '/responses', body: 'json', stream: false },
      stream_chat: {
        method: 'POST',
        path: '/responses',
        body: 'json',
        stream: true,
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
        body: 'events',
        stream: true,
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
    name: 'GoogleGeminiAI',
    defaultModel: geminiDefaultModel,
    defaultEmbedModel: geminiDefaultEmbedModel,
    auth: 'api_key_query',
    apiKeyQuery: 'key',
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
    },
    features: {
      media: {
        images: { supported: true },
        audio: { supported: true, output: { supported: false } },
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
    name: 'anthropic',
    defaultModel: anthropicDefaultModel,
    auth: 'anthropic_key',
    baseUrl: 'https://api.anthropic.com/v1',
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'structured-outputs-2025-11-13, web-search-2025-03-05',
    },
    operations: {
      chat: { method: 'POST', path: '/messages', body: 'json', stream: false },
      stream_chat: {
        method: 'POST',
        path: '/messages',
        body: 'json',
        stream: true,
      },
    },
    features: {
      media: {
        images: { supported: true },
        audio: { supported: false, output: { supported: false } },
      },
      caching: { supported: true, types: ['ephemeral_block'] },
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
      thinking: true,
      media: { images: { supported: false } },
    },
  },
});

writeFixture('mistral-provider-descriptor', {
  kind: 'ai_provider_descriptor',
  provider: 'mistral',
  expected_output: {
    id: 'mistral',
    name: 'Mistral',
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
    name: 'Grok',
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
    },
    features: {
      media: {
        images: { supported: true },
        urls: { web_search: true },
      },
      thinking: true,
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
    'Azure OpenAI',
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
    'DeepSeek',
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
    'Mistral',
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
    'Reka',
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
    'Cohere',
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
    'Grok',
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
        id: '0',
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
      },
    },
  },
  expected_transport_request: {
    json: {
      model: 'claude-opus-4-8',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    },
  },
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
    ],
    remote_id: 'gem_resp_1',
    model_usage: {
      ai: 'GoogleGeminiAI',
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
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultModel}:generateContent?key=test-key`,
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
        ai: 'GoogleGeminiAI',
        model: geminiDefaultModel,
        tokens: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      },
    },
  ],
  expected_transport_request: {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultModel}:streamGenerateContent?alt=sse&key=test-key`,
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
    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiDefaultEmbedModel}:batchEmbedContents?key=test-key`,
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
