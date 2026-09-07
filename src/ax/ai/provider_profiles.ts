import { AxAIAnthropic } from './anthropic/api.js';
import type { AxAIAnthropicChatRequest } from './anthropic/types.js';
import {
  axFetchJsonSpeech,
  axFetchMetaTranscription,
  axFetchMultipartTranscription,
} from './audio/api.js';
import type { AxAIFeatures } from './base.js';
import { axBaseAIDefaultConfig } from './base.js';
import {
  axModelInfoMeta,
  axModelInfoMetaMessages,
  axModelInfoMetaSpark,
} from './meta/info.js';
import { axCreateMetaRealtimeApi } from './meta/realtime.js';
import { AxAIMetaModel, type AxAIMetaResponsesConfig } from './meta/types.js';
import {
  type AxAIOpenAIArgs,
  AxAIOpenAIBase,
  type AxOpenAIReasoningContentMode,
} from './openai/api.js';
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from './openai/chat_types.js';
import { AxAIOpenAIResponsesBase } from './openai/responses_api_base.js';
import type {
  AxAIOpenAIResponsesConfig,
  AxAIOpenAIResponsesRequest,
} from './openai/responses_types.js';
import {
  axAIProviderAliases,
  axAIProviderProfileIds,
  axAIProviderProfiles,
} from './provider_profiles.generated.js';
import {
  type AxServiceTierMap,
  axNormalizeRequestedServiceTier,
  axResolveServiceTier,
} from './service_tier.js';
import type {
  AxAICredentialProvider,
  AxAIInputModelList,
  AxAIServiceOptions,
  AxModelInfo,
  AxServiceTier,
  AxSpeechRequest,
  AxSpeechResponse,
  AxStructuredOutputRung,
  AxTranscriptionRequest,
  AxTranscriptionResponse,
} from './types.js';
import {
  axCreateGrokRealtimeApi,
  axResolveGrokRealtimeAudioConfig,
  axShouldUseGrokRealtime,
} from './x-grok/api.js';

export type AxAIProfileId = keyof typeof axAIProviderProfiles;
export type AxAIProfileTransport =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-generate-content'
  | 'webllm';

export type AxAIProfileCapabilities = {
  functions: boolean;
  functionEmulation?: boolean;
  streaming: boolean;
  structuredOutputs: boolean;
  structuredOutputModes: readonly AxStructuredOutputRung[];
  thinking: boolean;
  multiTurn: boolean;
  serviceTiers?: readonly AxServiceTier[];
  thinkingBudget?: boolean;
  showThoughts?: boolean;
  images?: boolean;
  audio?: boolean;
  audioOutput?: boolean;
  files?: { uploadMethod: 'inline' | 'upload' | 'cloud' };
  webSearch?: boolean;
  caching?: {
    types: readonly ('ephemeral' | 'persistent')[];
    cacheBreakpoints?: boolean;
  };
};

export type AxAIProfileRequestRules = {
  reasoning?: 'thinking-object' | 'effort' | 'openrouter';
  toolChoice?: 'supported' | 'unforced' | 'no-named';
  defaultThinkingLevel?:
    | NonNullable<AxAIServiceOptions['thinkingTokenBudget']>
    | 'xhigh'
    | 'max';
  effortMap?: Readonly<Record<string, string | null>>;
  unsupportedThinkingLevels?: Readonly<Record<string, string>>;
  dropWhenThinking?: readonly string[];
  dropFields?: readonly string[];
  copyFields?: Readonly<Record<string, string>>;
  renameFields?: Readonly<Record<string, string>>;
  enumMaps?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  constructObjects?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  imageURLShape?: 'object';
  reasoningObjectFields?: readonly string[];
  optionDialect?: 'search-parameters';
  thinkingBoolean?: { path: readonly string[] };
  serviceTierMap?: AxServiceTierMap;
};

export type AxAIProfileModelRule = {
  match: {
    exact?: readonly string[];
    prefix?: readonly string[];
    contains?: readonly string[];
  };
  capabilities?: Partial<AxAIProfileCapabilities>;
  request?: AxAIProfileRequestRules;
  response?: {
    reasoningFields?: readonly string[];
    reasoningDetailsFields?: readonly string[];
  };
  replay?: {
    assistantReasoningField?: string;
    assistantReasoningDetailsField?: string;
  };
};

export type AxAIProfileAuthentication = {
  type: 'bearer' | 'api-key-header' | 'api-key-query' | 'x-api-key' | 'none';
  header?: string;
  required: boolean;
};

export type AxAIProfileOperation = {
  path: string;
  dialect: string;
  url?: string;
};

export type AxAIProfileEndpoint = {
  scheme?: string;
  hostField: string;
  hostSuffix: string;
  path: string;
  fields?: Readonly<Record<string, readonly string[]>>;
  required: readonly string[];
  defaults?: Readonly<Record<string, string>>;
  normalizers?: Readonly<Record<string, 'api-version'>>;
  apiVersionField?: string;
};

type ProfileSpec = {
  id: string;
  name: string;
  aliases: readonly string[];
  transport: AxAIProfileTransport;
  baseURL: string | null;
  requiresApiURL: boolean;
  auth: AxAIProfileAuthentication;
  headers?: Readonly<Record<string, string>>;
  defaults: { model: string; embedModel?: string };
  capabilities: AxAIProfileCapabilities;
  operations: Readonly<Record<string, AxAIProfileOperation>>;
  endpoint?: AxAIProfileEndpoint;
  capabilityGates?: Readonly<Record<string, { option: string; min: string }>>;
  request?: AxAIProfileRequestRules;
  modelRules: readonly AxAIProfileModelRule[];
  sources: readonly string[];
  reviewedAt: string;
};

export type AxAIProfileSummary = Readonly<{
  id: AxAIProfileId;
  name: string;
  aliases: readonly string[];
  transport: AxAIProfileTransport;
  baseURL?: string;
  requiresApiURL: boolean;
  endpoint?: Readonly<AxAIProfileEndpoint>;
  defaultModel?: string;
  defaultEmbedModel?: string;
  authentication: Readonly<AxAIProfileAuthentication>;
  operations: Readonly<Record<string, Readonly<AxAIProfileOperation>>>;
  modelRules: readonly Readonly<AxAIProfileModelRule>[];
  capabilities: Readonly<AxAIProfileCapabilities>;
  unsupportedThinkingLevels?: readonly NonNullable<
    AxAIServiceOptions['thinkingTokenBudget']
  >[];
  sources: readonly string[];
  reviewedAt: string;
}>;

const profiles = axAIProviderProfiles as unknown as Readonly<
  Record<AxAIProfileId, ProfileSpec>
>;

const aliases = axAIProviderAliases as unknown as Readonly<
  Record<string, AxAIProfileId>
>;

export const axAIProfiles = (): readonly AxAIProfileSummary[] =>
  axAIProviderProfileIds.map((id) => {
    const profile = profiles[id];
    return {
      id,
      name: profile.name,
      aliases: profile.aliases,
      transport: profile.transport,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
      requiresApiURL: profile.requiresApiURL,
      ...(profile.endpoint ? { endpoint: profile.endpoint } : {}),
      ...(profile.defaults.model
        ? { defaultModel: profile.defaults.model }
        : {}),
      ...(profile.defaults.embedModel
        ? { defaultEmbedModel: profile.defaults.embedModel }
        : {}),
      authentication: profile.auth,
      operations: profile.operations,
      modelRules: profile.modelRules,
      capabilities: profile.capabilities,
      ...(profile.request?.unsupportedThinkingLevels
        ? {
            unsupportedThinkingLevels: Object.keys(
              profile.request.unsupportedThinkingLevels
            ) as NonNullable<AxAIServiceOptions['thinkingTokenBudget']>[],
          }
        : {}),
      sources: profile.sources,
      reviewedAt: profile.reviewedAt,
    };
  });

export const axGetAIProfile = (name: string): AxAIProfileSummary => {
  const profile = resolveProfile(name);
  return axAIProfiles().find((candidate) => candidate.id === profile.id)!;
};

export const axResolveAIProfileId = (name: string): AxAIProfileId => {
  const id = aliases[name.toLowerCase()];
  if (!id) {
    throw new Error(
      `Unknown AI profile "${name}". Use one of: ${axAIProviderProfileIds.join(', ')}`
    );
  }
  return id;
};

const resolveProfile = (name: string): ProfileSpec =>
  profiles[axResolveAIProfileId(name)];

const matchesRule = (model: string, rule: AxAIProfileModelRule): boolean =>
  (rule.match.exact?.includes(model) ?? false) ||
  (rule.match.prefix?.some((prefix) => model.startsWith(prefix)) ?? false) ||
  (rule.match.contains?.some((part) =>
    model.toLowerCase().includes(part.toLowerCase())
  ) ??
    false);

const resolveModelRule = (
  profile: ProfileSpec,
  model: string
): AxAIProfileModelRule | undefined =>
  profile.modelRules.find((rule) => matchesRule(model, rule));

const emptyMedia = (
  capabilities: AxAIProfileCapabilities
): AxAIFeatures['media'] => ({
  images: {
    supported: capabilities.images ?? false,
    formats: capabilities.images ? ['image/jpeg', 'image/png'] : [],
  },
  audio: {
    supported: capabilities.audio ?? false,
    formats: capabilities.audio ? ['wav', 'mp3', 'pcm16'] : [],
    output: {
      supported: capabilities.audioOutput ?? false,
      formats: capabilities.audioOutput ? ['wav', 'mp3', 'pcm16'] : [],
    },
  },
  files: capabilities.files
    ? {
        supported: true,
        formats: ['application/pdf', 'text/plain'],
        uploadMethod: capabilities.files.uploadMethod,
      }
    : { supported: false, formats: [], uploadMethod: 'none' },
  urls: {
    supported: false,
    webSearch: capabilities.webSearch ?? false,
    contextFetching: false,
  },
});

export const axResolveAIProfileFeatures = (
  name: string,
  model: string
): AxAIFeatures => {
  const profile = resolveProfile(name);
  const rule = resolveModelRule(profile, model);
  const capabilities = { ...profile.capabilities, ...rule?.capabilities };
  return {
    functions: capabilities.functions,
    functionEmulation: capabilities.functionEmulation,
    streaming: capabilities.streaming,
    structuredOutputs: capabilities.structuredOutputs,
    structuredOutputModes: capabilities.structuredOutputModes,
    hasThinkingBudget:
      capabilities.thinkingBudget ?? capabilities.thinking ?? false,
    hasShowThoughts:
      capabilities.showThoughts ?? capabilities.thinking ?? false,
    media: emptyMedia(capabilities),
    caching: capabilities.caching
      ? {
          supported: true,
          types: [...capabilities.caching.types],
          cacheBreakpoints: capabilities.caching.cacheBreakpoints,
        }
      : { supported: false, types: [] },
    thinking: capabilities.thinking,
    multiTurn: capabilities.multiTurn,
    serviceTiers: capabilities.serviceTiers ?? [],
  };
};

const reasoningAdapterFor = (
  profile: ProfileSpec
): AxOpenAIReasoningContentMode => {
  const responseFields = profile.modelRules.flatMap(
    (rule) => rule.response?.reasoningFields ?? []
  );
  const responseDetailsFields = profile.modelRules.flatMap(
    (rule) => rule.response?.reasoningDetailsFields ?? []
  );
  const assistantField = profile.modelRules.find(
    (rule) => rule.replay?.assistantReasoningField
  )?.replay?.assistantReasoningField;
  const assistantDetailsField = profile.modelRules.find(
    (rule) => rule.replay?.assistantReasoningDetailsField
  )?.replay?.assistantReasoningDetailsField;
  if (
    !assistantField &&
    !assistantDetailsField &&
    responseFields.length === 0 &&
    responseDetailsFields.length === 0
  ) {
    return 'none';
  }
  return {
    ...(assistantField || responseFields[0]
      ? { assistantField: assistantField ?? responseFields[0] }
      : {}),
    responseFields: [...new Set(responseFields)],
    ...(assistantDetailsField ? { assistantDetailsField } : {}),
    responseDetailsFields: [...new Set(responseDetailsFields)],
  };
};

const applyImageURLShape = (payload: Record<string, unknown>): void => {
  const messages = payload.messages;
  if (!Array.isArray(messages)) return;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      if (record.type !== 'image_url') continue;
      const image = record.image_url;
      if (typeof image === 'string') record.image_url = { url: image };
      else if (image && typeof image === 'object') {
        record.image_url = { url: (image as { url?: unknown }).url };
      }
    }
  }
};

const snakeCaseObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(snakeCaseObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      snakeCaseObject(item),
    ])
  );
};

const applyRequestRules = (
  payload: Record<string, unknown>,
  rules: AxAIProfileRequestRules | undefined,
  options: Readonly<AxAIServiceOptions>
): void => {
  if (!rules) return;
  const budget = options.thinkingTokenBudget;
  const requestedEffort =
    budget ??
    (typeof payload.reasoning_effort === 'string'
      ? payload.reasoning_effort
      : rules.defaultThinkingLevel);
  const unsupportedThinkingMessage = requestedEffort
    ? rules.unsupportedThinkingLevels?.[requestedEffort]
    : undefined;
  if (unsupportedThinkingMessage) throw new Error(unsupportedThinkingMessage);
  const mappedEffort = requestedEffort
    ? rules.effortMap?.[requestedEffort]
    : undefined;

  if (requestedEffort && rules.effortMap) {
    if (mappedEffort === null) delete payload.reasoning_effort;
    else if (mappedEffort !== undefined)
      payload.reasoning_effort = mappedEffort;
  }

  const hasReasoning =
    requestedEffort !== undefined &&
    requestedEffort !== 'none' &&
    (mappedEffort !== null || !rules.effortMap);
  const hasSerializableReasoningEffort =
    requestedEffort !== undefined && mappedEffort !== null;
  if (rules.thinkingBoolean) {
    let target = payload;
    const path = rules.thinkingBoolean.path;
    for (const part of path.slice(0, -1)) {
      const current = target[part];
      const nested =
        current && typeof current === 'object' && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>) }
          : {};
      target[part] = nested;
      target = nested;
    }
    target[path[path.length - 1]!] = requestedEffort !== 'none';
  }
  if (rules.reasoning === 'thinking-object') {
    payload.thinking = { type: hasReasoning ? 'enabled' : 'disabled' };
  } else if (rules.reasoning === 'openrouter') {
    if (
      hasSerializableReasoningEffort &&
      typeof payload.reasoning_effort === 'string'
    ) {
      payload.reasoning = { effort: payload.reasoning_effort };
    }
    delete payload.reasoning_effort;
  }

  if (rules.toolChoice === 'unforced') {
    const choice = payload.tool_choice;
    const choiceType =
      choice && typeof choice === 'object'
        ? (choice as { type?: unknown }).type
        : undefined;
    const forcedFunction =
      choice && typeof choice === 'object'
        ? ((choice as { name?: unknown }).name ??
          (choice as { function?: { name?: unknown } }).function?.name)
        : undefined;
    const axGeneratedChoice =
      options.functionCallSource === 'ax' && forcedFunction === '__axOutput';
    const callerForcedChoice =
      choice === 'required' ||
      (choice !== undefined &&
        choice !== 'auto' &&
        choice !== 'none' &&
        choiceType !== 'auto' &&
        !axGeneratedChoice);
    if (callerForcedChoice) {
      throw new Error(
        'This deployment profile does not support explicitly forced tool choices'
      );
    }
    if (choice === 'none') delete payload.tools;
    delete payload.tool_choice;
  } else if (rules.toolChoice === 'no-named') {
    const choice = payload.tool_choice;
    if (
      choice &&
      typeof choice === 'object' &&
      ['tool', 'function'].includes(
        String((choice as { type?: unknown }).type ?? '')
      )
    ) {
      const namedChoice = choice as {
        type: string;
        name?: string;
        function?: { name?: string };
      };
      const name = namedChoice.name ?? namedChoice.function?.name;
      const outputTools = Array.isArray(payload.tools)
        ? payload.tools.filter(
            (tool) => (tool.name ?? tool.function?.name) === '__axOutput'
          )
        : [];
      if (
        options.functionCallSource !== 'ax' ||
        name !== '__axOutput' ||
        outputTools.length !== 1
      ) {
        throw new Error(
          'This deployment profile does not support explicitly named tool choices'
        );
      }
      // Requiring the sole output tool is equivalent to forcing it by name.
      payload.tools = outputTools;
      payload.tool_choice =
        namedChoice.type === 'tool' ? { type: 'any' } : 'required';
    }
  }
  if (hasReasoning) {
    for (const field of rules.dropWhenThinking ?? []) delete payload[field];
  }
  for (const field of rules.dropFields ?? []) delete payload[field];
  for (const [from, to] of Object.entries(rules.copyFields ?? {})) {
    if (payload[from] !== undefined) payload[to] = payload[from];
  }
  for (const [from, to] of Object.entries(rules.renameFields ?? {})) {
    if (payload[from] !== undefined) {
      payload[to] = payload[from];
      delete payload[from];
    }
  }
  for (const [field, mapping] of Object.entries(rules.enumMaps ?? {})) {
    const value = payload[field];
    if (typeof value === 'string' && value in mapping) {
      payload[field] = mapping[value];
    }
  }
  for (const [target, fields] of Object.entries(rules.constructObjects ?? {})) {
    const nested = Object.fromEntries(
      Object.entries(fields)
        .filter(([, source]) => payload[source] !== undefined)
        .map(([nestedField, source]) => [nestedField, payload[source]])
    );
    if (Object.keys(nested).length > 0) payload[target] = nested;
  }
  if (rules.imageURLShape === 'object') applyImageURLShape(payload);
  if (rules.optionDialect === 'search-parameters') {
    const raw =
      (options as Record<string, unknown>).searchParameters ??
      (options as Record<string, unknown>).search_parameters;
    if (raw !== undefined) payload.search_parameters = snakeCaseObject(raw);
  }
};

const stripCacheControl = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'cache_control')
      .map(([key, child]) => [key, stripCacheControl(child)])
  );
};

const applyExactModelInfoOverride = (
  features: AxAIFeatures,
  model: string,
  modelInfo: readonly AxModelInfo[] | undefined
): AxAIFeatures => {
  const override = modelInfo?.find(
    (item) => item.name === model || item.aliases?.includes(model)
  )?.supported;
  if (!override) return features;
  const hasThinkingOverride =
    override.thinkingBudget !== undefined ||
    override.showThoughts !== undefined;
  let structuredOutputModes = features.structuredOutputModes;
  if (override.structuredOutputModes !== undefined) {
    structuredOutputModes = [...override.structuredOutputModes];
  } else if (override.structuredOutputs !== undefined) {
    const withoutNative = (structuredOutputModes ?? []).filter(
      (mode) => mode !== 'native'
    );
    structuredOutputModes = override.structuredOutputs
      ? ['native', ...withoutNative]
      : withoutNative;
  }
  return {
    ...features,
    hasThinkingBudget:
      override.thinkingBudget ?? features.hasThinkingBudget ?? false,
    hasShowThoughts: override.showThoughts ?? features.hasShowThoughts ?? false,
    structuredOutputs: structuredOutputModes
      ? structuredOutputModes.includes('native')
      : (override.structuredOutputs ?? features.structuredOutputs ?? false),
    ...(structuredOutputModes ? { structuredOutputModes } : {}),
    thinking: hasThinkingOverride
      ? Boolean(override.thinkingBudget || override.showThoughts)
      : features.thinking,
    serviceTiers:
      override.serviceTiers !== undefined
        ? [...override.serviceTiers]
        : features.serviceTiers,
  };
};

const applyProfileChatRequest = <TModel>(
  profile: ProfileSpec,
  request: Readonly<AxAIOpenAIChatRequest<TModel>>,
  options: Readonly<AxAIServiceOptions>,
  modelInfo: readonly AxModelInfo[] | undefined,
  profileArgs: Record<string, unknown>
): AxAIOpenAIChatRequest<TModel> => {
  const payload = { ...request } as Record<string, unknown>;
  const model = String(request.model);
  const rule = resolveModelRule(profile, model);
  const features = applyExactModelInfoOverride(
    applyCapabilityGates(
      profile,
      axResolveAIProfileFeatures(profile.id, model),
      profileArgs
    ),
    model,
    modelInfo
  );

  const requestedTier =
    options.serviceTier ?? (payload.service_tier as unknown);
  delete payload.service_tier;
  const mappedTier = axResolveServiceTier({
    requested: requestedTier,
    supported: features.serviceTiers,
    mapping: rule?.request?.serviceTierMap ?? profile.request?.serviceTierMap,
    provider: profile.id,
    model,
  });
  if (mappedTier !== undefined) payload.service_tier = mappedTier;

  if (
    options.thinkingTokenBudget &&
    options.thinkingTokenBudget !== 'none' &&
    !features.thinking
  ) {
    throw new Error(
      `Thinking is not verified for profile ${profile.id} and model ${model}; add an exact modelInfo override to opt in`
    );
  }
  const responseFormat = payload.response_format as
    | { type?: unknown }
    | undefined;
  if (responseFormat?.type === 'json_schema' && !features.structuredOutputs) {
    throw new Error(
      `Structured output is not verified for profile ${profile.id} and model ${model}: native JSON Schema is unsupported`
    );
  }
  if (
    responseFormat?.type === 'json_object' &&
    !features.structuredOutputModes?.includes('json_object')
  ) {
    throw new Error(
      `Structured output is not verified for profile ${profile.id} and model ${model}: JSON object mode is unsupported`
    );
  }

  applyRequestRules(payload, profile.request, options);
  applyRequestRules(payload, rule?.request, options);
  if (profile.id === 'meta-chat' && Array.isArray(payload.messages)) {
    payload.messages = (payload.messages as Array<Record<string, unknown>>).map(
      (message) => ({
        ...message,
        ...(Array.isArray(message.content)
          ? {
              content: (message.content as Array<Record<string, unknown>>).map(
                (part) => {
                  if (part.type !== 'image_url') return part;
                  const image = part.image_url as
                    | Record<string, unknown>
                    | undefined;
                  if (!image || image.details === undefined) return part;
                  const { details, ...rest } = image;
                  return { ...part, image_url: { ...rest, detail: details } };
                }
              ),
            }
          : {}),
      })
    );
  }
  return payload as AxAIOpenAIChatRequest<TModel>;
};

const resolveProfileURL = (
  profile: ProfileSpec,
  args: Record<string, unknown>
): string => {
  if (typeof args.apiURL === 'string' && args.apiURL.length > 0) {
    return args.apiURL;
  }
  if (profile.endpoint) {
    const endpointValues: Record<string, unknown> = {
      ...profile.endpoint.defaults,
    };
    for (const [field, fieldAliases] of Object.entries(
      profile.endpoint.fields ?? {}
    )) {
      for (const alias of fieldAliases) {
        if (args[alias] !== undefined && args[alias] !== '') {
          endpointValues[field] = args[alias];
        }
      }
    }
    for (const field of profile.endpoint.required) {
      if (endpointValues[field] === undefined || endpointValues[field] === '') {
        throw new Error(`${profile.name} endpoint field ${field} is required`);
      }
    }
    const rawHost = String(endpointValues[profile.endpoint.hostField]);
    const host = rawHost.includes('://')
      ? rawHost.replace(/\/$/, '')
      : `${profile.endpoint.scheme ?? 'https'}://${rawHost}${profile.endpoint.hostSuffix}`;
    let endpointPath = profile.endpoint.path;
    for (const [field, rawValue] of Object.entries(endpointValues)) {
      let replacement = String(rawValue);
      if (profile.endpoint.normalizers?.[field] === 'api-version') {
        replacement =
          new URLSearchParams(
            replacement.includes('api-version=') ? replacement : ''
          ).get('api-version') ?? replacement;
      }
      endpointPath = endpointPath.replaceAll(
        `{${field}}`,
        encodeURIComponent(replacement)
      );
      endpointValues[field] = replacement;
    }
    const endpointURL = new URL(`${host}${endpointPath}`);
    if (profile.endpoint.apiVersionField) {
      const field = profile.endpoint.apiVersionField;
      const queryName = profile.endpoint.normalizers?.[field];
      const value = endpointValues[field];
      if (queryName && value !== undefined && value !== '') {
        endpointURL.searchParams.set(queryName, String(value));
      }
    }
    return endpointURL.toString().replace(/\/$/, '');
  }
  if (profile.baseURL) return profile.baseURL;
  throw new Error(`${profile.name} requires apiURL`);
};

const applyCapabilityGates = (
  profile: ProfileSpec,
  features: AxAIFeatures,
  args: Record<string, unknown>
): AxAIFeatures => {
  const gate = profile.capabilityGates?.structuredOutputs;
  if (!gate) return features;
  const raw = String(args[gate.option] ?? '');
  const value = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
  const structuredOutputs = value >= gate.min;
  const withoutNative = (features.structuredOutputModes ?? []).filter(
    (mode) => mode !== 'native'
  );
  return {
    ...features,
    structuredOutputs,
    structuredOutputModes: structuredOutputs
      ? ['native', ...withoutNative]
      : withoutNative,
  };
};

const validateProfileKey = (
  profile: ProfileSpec,
  apiKey?: string,
  credentialProvider?: AxAICredentialProvider
): string => {
  if (profile.auth.required && !apiKey && !credentialProvider) {
    throw new Error(`${profile.name} API key not set`);
  }
  return apiKey ?? '';
};

const normalizeProfileModelPresets = <TModelKey>(
  models: AxAIProfileArgs<TModelKey>['models']
): AxAIProfileArgs<TModelKey>['models'] =>
  models?.map((item) => {
    const value = item as unknown as {
      config?: Record<string, unknown>;
      modelConfig?: Record<string, unknown>;
    };
    if (!value.config) return item;
    return {
      ...item,
      modelConfig: { ...value.config, ...value.modelConfig },
      ...(value.config.serviceTier !== undefined
        ? {
            serviceTier: axNormalizeRequestedServiceTier(
              value.config.serviceTier
            ),
          }
        : {}),
    };
  });

const profileHeaders = (
  profile: ProfileSpec,
  apiKey: string
): Record<string, string> => {
  if (!apiKey || profile.auth.type === 'none') return {};
  if (profile.auth.type === 'api-key-header') {
    return { [profile.auth.header ?? 'api-key']: apiKey };
  }
  if (profile.auth.type === 'x-api-key') return { 'x-api-key': apiKey };
  return { Authorization: `Bearer ${apiKey}` };
};

export type AxAIProfileArgs<TModelKey = string> = {
  name: AxAIProfileId;
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  apiURL?: string;
  config?: Partial<AxAIOpenAIConfig<string, string>>;
  options?: Readonly<AxAIServiceOptions> & Record<string, unknown>;
  modelInfo?: AxModelInfo[];
  models?: AxAIInputModelList<string, string, TModelKey>;
  resourceName?: string;
  deploymentName?: string;
  version?: string;
};

export type AxAIDeploymentProfileId = Exclude<
  AxAIProfileId,
  | 'openai'
  | 'openai-responses'
  | 'anthropic'
  | 'google-gemini'
  | 'webllm'
  | 'meta'
  | 'meta-chat'
  | 'meta-messages'
>;

export type AxAIDeploymentProfileArgs<TModelKey = string> = Omit<
  AxAIProfileArgs<TModelKey>,
  'name'
> & { name: AxAIDeploymentProfileId };

export class AxAIOpenAIProfile<TModelKey = string> extends AxAIOpenAIBase<
  string,
  string,
  TModelKey
> {
  private readonly profileSpec: ProfileSpec;
  private readonly profileApiURL: string;

  constructor(args: Readonly<AxAIProfileArgs<TModelKey>>) {
    const profile = resolveProfile(args.name);
    if (profile.transport !== 'openai-chat') {
      throw new Error(`${profile.id} is not an OpenAI Chat profile`);
    }
    const apiKey = validateProfileKey(
      profile,
      args.apiKey,
      args.credentialProvider
    );
    const apiURL = resolveProfileURL(profile, args as Record<string, unknown>);
    const config = {
      model: profile.defaults.model,
      ...(profile.defaults.embedModel
        ? { embedModel: profile.defaults.embedModel }
        : {}),
      ...axBaseAIDefaultConfig(),
      ...args.config,
    } as AxAIOpenAIConfig<string, string>;
    const realtimeOperation = profile.operations.realtime;
    const realtime =
      realtimeOperation?.dialect === 'xai-realtime'
        ? {
            apiName: `${profile.name} Realtime`,
            shouldUse: axShouldUseGrokRealtime,
            resolveAudioConfig: axResolveGrokRealtimeAudioConfig,
            createApi: axCreateGrokRealtimeApi,
          }
        : undefined;

    super({
      apiKey: apiKey || 'local-no-key',
      credentialProvider: args.credentialProvider,
      credentialProfile: profile.id,
      apiURL,
      config,
      options: args.options,
      modelInfo:
        args.modelInfo ??
        (profile.id === 'meta-chat' ? axModelInfoMetaSpark : []),
      models: normalizeProfileModelPresets(args.models),
      supportFor: (model) =>
        applyExactModelInfoOverride(
          applyCapabilityGates(
            profile,
            axResolveAIProfileFeatures(profile.id, model),
            args as Record<string, unknown>
          ),
          model,
          args.modelInfo ??
            (profile.id === 'meta-chat' ? axModelInfoMetaSpark : undefined)
        ),
      reasoningContentMode: reasoningAdapterFor(profile),
      realtime,
      promptCaching: profile.id === 'meta-chat',
      promptCachingAllModels: profile.id === 'meta-chat',
      promptCacheBreakpoints: profile.id !== 'meta-chat',
      chatReqUpdater: (request, options) =>
        applyProfileChatRequest(
          profile,
          request,
          { ...(args.options ?? {}), ...options },
          args.modelInfo,
          args as Record<string, unknown>
        ),
    });
    this.setName(profile.name);
    this.setHeaders(async () => profileHeaders(profile, apiKey));
    this.profileSpec = profile;
    this.profileApiURL = apiURL;
  }

  override async transcribe(
    req: Readonly<AxTranscriptionRequest<string | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxTranscriptionResponse> {
    const operation = this.profileSpec.operations.transcribe;
    if (!operation) {
      throw new Error(
        `Transcription is not supported by profile ${this.profileSpec.id}`
      );
    }
    const serviceOptions = this.getOptions();
    const model = typeof req.model === 'string' ? req.model : undefined;
    const fields =
      operation.dialect === 'xai-transcription'
        ? {
            language: req.language,
            keyterm: req.prompt,
            format: true,
          }
        : {
            model,
            language: req.language,
            prompt: req.prompt,
            temperature: req.temperature,
            response_format: req.responseFormat ?? 'json',
          };
    return await axFetchMultipartTranscription({
      url: `${this.profileApiURL.replace(/\/$/, '')}${operation.path}`,
      headers: await this.buildHeaders(
        {},
        {
          operation: 'transcribe',
          method: 'POST',
          url: `${this.profileApiURL.replace(/\/$/, '')}${operation.path}`,
        }
      ),
      audio: req.audio,
      fields,
      fetch: options?.fetch ?? serviceOptions.fetch,
      abortSignal: options?.abortSignal ?? serviceOptions.abortSignal,
    });
  }

  override async speak(
    req: Readonly<AxSpeechRequest<string | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxSpeechResponse> {
    const operation = this.profileSpec.operations.speak;
    if (!operation) {
      throw new Error(
        `Speech is not supported by profile ${this.profileSpec.id}`
      );
    }
    const serviceOptions = this.getOptions();
    const format = req.format ?? 'mp3';
    const model = typeof req.model === 'string' ? req.model : undefined;
    const voice = typeof req.voice === 'object' ? req.voice.id : req.voice;
    let body: Record<string, unknown>;
    if (operation.dialect === 'xai-speech') {
      const codec =
        format === 'pcm16' || format === 'raw'
          ? 'pcm'
          : format === 'ulaw'
            ? 'mulaw'
            : format;
      body = {
        text: req.text,
        voice_id: voice ?? 'eve',
        language: req.language ?? 'auto',
        output_format: {
          codec,
          ...(req.sampleRate ? { sample_rate: req.sampleRate } : {}),
        },
        ...(req.speed !== undefined ? { speed: req.speed } : {}),
      };
    } else if (operation.dialect === 'mistral-speech') {
      body = {
        model: model ?? 'voxtral-mini-tts-2603',
        input: req.text,
        response_format: format,
        ...(voice ? { voice_id: voice } : {}),
      };
    } else {
      body = {
        model,
        input: req.text,
        voice: voice ?? 'alloy',
        response_format: format === 'pcm' ? 'pcm16' : format,
        ...(req.speed !== undefined ? { speed: req.speed } : {}),
      };
    }
    return await axFetchJsonSpeech({
      url: `${this.profileApiURL.replace(/\/$/, '')}${operation.path}`,
      headers: await this.buildHeaders(
        {},
        {
          operation: 'speak',
          method: 'POST',
          url: `${this.profileApiURL.replace(/\/$/, '')}${operation.path}`,
        }
      ),
      body,
      format,
      transcript: req.text,
      fetch: options?.fetch ?? serviceOptions.fetch,
      abortSignal: options?.abortSignal ?? serviceOptions.abortSignal,
    });
  }
}

export class AxAIOpenAIResponsesProfile<
  TModelKey = string,
> extends AxAIOpenAIResponsesBase<
  string,
  string,
  TModelKey,
  AxAIOpenAIResponsesRequest<string>
> {
  private readonly profileSpec: ProfileSpec;
  private readonly profileApiURL: string;

  constructor(args: Readonly<AxAIProfileArgs<TModelKey>>) {
    const profile = resolveProfile(args.name);
    if (profile.transport !== 'openai-responses') {
      throw new Error(`${profile.id} is not an OpenAI Responses profile`);
    }
    const apiKey = validateProfileKey(
      profile,
      args.apiKey,
      args.credentialProvider
    );
    const apiURL = resolveProfileURL(profile, args as Record<string, unknown>);
    const config = {
      model: profile.defaults.model,
      ...(profile.defaults.embedModel
        ? { embedModel: profile.defaults.embedModel }
        : {}),
      stream: true,
      ...args.config,
    } as AxAIOpenAIResponsesConfig<string, string>;
    if (profile.id === 'meta') {
      config.promptCaching = false;
      const metaConfig = config as AxAIMetaResponsesConfig;
      metaConfig.store ??= false;
      metaConfig.includeEncryptedReasoning ??= true;
      metaConfig.rejectReasoningNone ??= true;
      metaConfig.highestReasoningEffort ??= 'xhigh';
      config.defaultImageOutputFormat = 'webp';
      metaConfig.reasoningEffortMap ??= {
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        highest: 'xhigh',
      };
    }

    super({
      apiKey: apiKey || 'local-no-key',
      credentialProvider: args.credentialProvider,
      credentialProfile: profile.id,
      apiURL,
      config,
      options: args.options,
      modelInfo:
        args.modelInfo ?? (profile.id === 'meta' ? axModelInfoMeta : []),
      models: args.models,
      supportFor: (model) =>
        applyExactModelInfoOverride(
          applyCapabilityGates(
            profile,
            axResolveAIProfileFeatures(profile.id, model),
            args as Record<string, unknown>
          ),
          model,
          args.modelInfo ??
            (profile.id === 'meta' ? axModelInfoMeta : undefined)
        ),
      realtime:
        profile.id === 'meta'
          ? {
              shouldUse: (model) => model === 'muse-voice-transcribe-1.0',
              createApi: (request) =>
                axCreateMetaRealtimeApi(
                  request,
                  (config as AxAIOpenAIResponsesConfig<string, string>)
                    .realtimeTranscription,
                  args.credentialProvider
                    ? async () => {
                        const url = `${apiURL.replace(/^http/, 'ws').replace(/\/$/, '')}/asr/realtime`;
                        const headers = await args.credentialProvider!({
                          profile: profile.id,
                          operation: 'realtime',
                          method: 'WS',
                          url,
                        });
                        const authorization =
                          headers.Authorization ?? headers.authorization;
                        if (!authorization) {
                          throw new Error(
                            'Meta realtime credential provider must return an Authorization header'
                          );
                        }
                        return authorization.replace(/^Bearer\s+/i, '');
                      }
                    : undefined,
                  `${apiURL.replace(/^http/, 'ws').replace(/\/$/, '')}/asr/realtime`
                ),
            }
          : undefined,
      responsesReqUpdater: (request, options) => {
        const payload = { ...request } as Record<string, unknown>;
        const model = String(request.model);
        if (profile.id === 'meta' && model === 'muse-image-1.0') {
          const callerFunctions = request.tools?.filter(
            (tool) => tool.type === 'function'
          );
          if (callerFunctions?.length) {
            throw new Error(
              'muse-image-1.0 only permits the image_generation tool'
            );
          }
          const imageConfig = (
            config as AxAIOpenAIResponsesConfig<string, string>
          ).imageGeneration;
          payload.tools = [
            {
              type: 'image_generation',
              ...(imageConfig?.size ? { size: imageConfig.size } : {}),
              output_format: imageConfig?.outputFormat ?? 'webp',
              ...(imageConfig?.enableImageSearch !== undefined
                ? { enable_image_search: imageConfig.enableImageSearch }
                : {}),
              ...(imageConfig?.enableWebSearch !== undefined
                ? { enable_web_search: imageConfig.enableWebSearch }
                : {}),
              ...(imageConfig?.enableShell !== undefined
                ? { enable_shell: imageConfig.enableShell }
                : {}),
              ...(imageConfig?.reasoningStrength
                ? { reasoning_strength: imageConfig.reasoningStrength }
                : {}),
            },
          ];
          delete payload.tool_choice;
          delete payload.include;
          delete payload.reasoning;
          if (Array.isArray(request.input)) {
            // Image summaries are display-only; the signed image handle is the
            // provider's stateless editing context.
            const input = request.input.filter(
              (item) => typeof item === 'string' || item.type !== 'reasoning'
            );
            payload.input = input;
            for (const item of input) {
              if (!item || typeof item === 'string') continue;
              if (
                item.type !== 'message' &&
                item.type !== 'image_generation_call'
              ) {
                throw new Error(
                  'muse-image-1.0 accepts only text, reference images, and prior generated images'
                );
              }
              if (item.type === 'message' && Array.isArray(item.content)) {
                const unsupported = item.content.find(
                  (part: { type: string }) =>
                    part.type !== 'input_text' &&
                    part.type !== 'input_image' &&
                    part.type !== 'output_text'
                );
                if (unsupported) {
                  throw new Error(
                    `muse-image-1.0 does not support ${unsupported.type} input`
                  );
                }
              }
            }
          }
        }
        const features = applyExactModelInfoOverride(
          applyCapabilityGates(
            profile,
            axResolveAIProfileFeatures(profile.id, model),
            args as Record<string, unknown>
          ),
          model,
          args.modelInfo
        );
        const mappedTier = axResolveServiceTier({
          requested: payload.service_tier,
          supported: features.serviceTiers,
          mapping: profile.request?.serviceTierMap,
          provider: profile.id,
          model,
        });
        delete payload.service_tier;
        if (mappedTier !== undefined) payload.service_tier = mappedTier;
        applyRequestRules(payload, profile.request, options);
        if (profile.request?.reasoningObjectFields && payload.reasoning) {
          const reasoning = payload.reasoning as Record<string, unknown>;
          payload.reasoning = Object.fromEntries(
            profile.request.reasoningObjectFields
              .filter((field) => reasoning[field] !== undefined)
              .map((field) => [field, reasoning[field]])
          );
        }
        return payload as unknown as AxAIOpenAIResponsesRequest<string>;
      },
    });
    this.setName(profile.name);
    this.setHeaders(async () => profileHeaders(profile, apiKey));
    this.profileSpec = profile;
    this.profileApiURL = apiURL;
  }

  override async transcribe(
    req: Readonly<AxTranscriptionRequest<string | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxTranscriptionResponse> {
    const operation = this.profileSpec.operations.transcribe;
    if (!operation) {
      throw new Error(
        `Transcription is not supported by profile ${this.profileSpec.id}`
      );
    }
    if (operation.dialect !== 'meta-transcription') {
      throw new Error(`Unsupported transcription dialect ${operation.dialect}`);
    }
    const endpoint = new URL(
      `${this.profileApiURL.replace(/\/$/, '')}${operation.path}`
    );
    if (req.sessionId) endpoint.searchParams.set('sessionId', req.sessionId);
    const url = endpoint.toString();
    const serviceOptions = this.getOptions();
    const format = req.audio.format;
    if (
      format !== 'wav' &&
      !req.audio.mimeType?.toLowerCase().includes('wav')
    ) {
      throw new Error('Meta Voice batch transcription requires WAV audio');
    }
    if (req.audio.channels !== undefined && req.audio.channels !== 1) {
      throw new Error('Meta Voice batch transcription requires mono audio');
    }
    if (
      req.audio.sampleRate !== undefined &&
      req.audio.sampleRate !== 16_000 &&
      req.audio.sampleRate !== 24_000
    ) {
      throw new Error(
        'Meta Voice batch transcription requires 16000 Hz or 24000 Hz audio'
      );
    }
    if (req.language || req.prompt) {
      throw new Error(
        'Meta Voice uses languageBias and keywords instead of language or prompt'
      );
    }
    const model =
      typeof req.model === 'string'
        ? req.model
        : AxAIMetaModel.MuseVoiceTranscribe10;
    if (model !== AxAIMetaModel.MuseVoiceTranscribe10) {
      throw new Error(
        `Meta Voice transcribe requires ${AxAIMetaModel.MuseVoiceTranscribe10}`
      );
    }
    return await axFetchMetaTranscription({
      url,
      headers: await this.buildHeaders(
        {},
        {
          operation: 'transcribe',
          method: 'POST',
          url,
        }
      ),
      audio: req.audio,
      request: {
        model,
        audioEncoding: 'WAV',
        ...(req.mode ? { mode: req.mode.toUpperCase() } : {}),
        ...(req.languageBias?.length ? { languageBias: req.languageBias } : {}),
        ...(req.keywords?.length ? { keywords: req.keywords } : {}),
        ...(req.partialMode
          ? { partialMode: req.partialMode.toUpperCase() }
          : {}),
        ...(req.emitAudioProgress !== undefined
          ? { emitAudioProgress: req.emitAudioProgress }
          : {}),
      },
      partialMode: req.partialMode,
      sessionId: req.sessionId,
      acceptEventStream:
        req.partialMode !== undefined || req.emitAudioProgress === true,
      fetch: options?.fetch ?? serviceOptions.fetch,
      abortSignal: options?.abortSignal ?? serviceOptions.abortSignal,
    });
  }
}

export class AxAIAnthropicProfile<
  TModelKey = string,
> extends AxAIAnthropic<TModelKey> {
  constructor(args: Readonly<AxAIProfileArgs<TModelKey>>) {
    const profile = resolveProfile(args.name);
    if (profile.transport !== 'anthropic-messages') {
      throw new Error(`${profile.id} is not an Anthropic Messages profile`);
    }
    if (profile.id !== 'meta-messages') {
      throw new Error(`Unsupported Anthropic Messages profile ${profile.id}`);
    }
    if (profile.auth.required && !args.apiKey && !args.credentialProvider) {
      throw new Error(`${profile.name} API key not set`);
    }
    const apiURL = resolveProfileURL(profile, args as Record<string, unknown>);
    const key = args.apiKey;
    super({
      apiKey: key,
      credentialProvider: args.credentialProvider,
      config: args.config as any,
      options: args.options,
      models: args.models as any,
      _profile: {
        id: profile.id,
        name: profile.name,
        apiURL,
        headers: async () => profileHeaders(profile, key ?? ''),
        defaultModel: profile.defaults.model,
        modelInfo: args.modelInfo ?? axModelInfoMetaMessages,
        supportFor: (model: string) =>
          applyExactModelInfoOverride(
            axResolveAIProfileFeatures(profile.id, model),
            model,
            args.modelInfo ?? axModelInfoMetaMessages
          ),
        supportsToolChoiceNone: true,
        requestUpdater: (
          request: AxAIAnthropicChatRequest,
          options: Readonly<AxAIServiceOptions>
        ) => {
          const payload = { ...request } as Record<string, unknown>;
          const budget = options.thinkingTokenBudget;
          if (budget === 'none') {
            throw new Error(
              'Meta Muse Spark does not support reasoning level none'
            );
          }
          if (budget || payload.thinking) {
            payload.thinking = {
              type: 'adaptive',
              display:
                options.showThoughts === false ? 'omitted' : 'summarized',
            };
          }
          if (budget) {
            const effort =
              budget === 'minimal'
                ? 'low'
                : budget === 'highest'
                  ? 'xhigh'
                  : budget;
            payload.output_config = {
              ...((payload.output_config as Record<string, unknown>) ?? {}),
              effort,
            };
          }
          applyRequestRules(payload, profile.request, options);
          delete payload.reasoning_effort;
          delete payload.stop_sequences;
          delete payload.top_k;
          return stripCacheControl(payload) as AxAIAnthropicChatRequest;
        },
      },
    } as any);
  }
}

export type AxAIOpenAIProfileArgs<TModelKey> = AxAIOpenAIArgs<
  AxAIProfileId,
  string,
  string,
  TModelKey
>;
