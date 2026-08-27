import {
  axFetchJsonSpeech,
  axFetchMultipartTranscription,
} from './audio/api.js';
import type { AxAIFeatures } from './base.js';
import { axBaseAIDefaultConfig } from './base.js';
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
import type {
  AxAICredentialProvider,
  AxAIInputModelList,
  AxAIServiceOptions,
  AxModelInfo,
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
  streaming: boolean;
  structuredOutputs: boolean;
  structuredOutputModes: readonly AxStructuredOutputRung[];
  thinking: boolean;
  multiTurn: boolean;
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
  toolChoice?: 'supported' | 'unforced';
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
    const forcedFunction =
      choice && typeof choice === 'object'
        ? (choice as { function?: { name?: unknown } }).function?.name
        : undefined;
    const axGeneratedChoice =
      options.functionCallSource === 'ax' && forcedFunction === '__axOutput';
    const callerForcedChoice =
      choice === 'required' ||
      (choice !== undefined &&
        choice !== 'auto' &&
        choice !== 'none' &&
        !axGeneratedChoice);
    if (callerForcedChoice) {
      throw new Error(
        'This deployment profile does not support explicitly forced tool choices'
      );
    }
    if (choice === 'none') delete payload.tools;
    delete payload.tool_choice;
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
  'openai' | 'openai-responses' | 'anthropic' | 'google-gemini' | 'webllm'
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
      modelInfo: args.modelInfo ?? [],
      models: normalizeProfileModelPresets(args.models),
      supportFor: (model) =>
        applyExactModelInfoOverride(
          applyCapabilityGates(
            profile,
            axResolveAIProfileFeatures(profile.id, model),
            args as Record<string, unknown>
          ),
          model,
          args.modelInfo
        ),
      reasoningContentMode: reasoningAdapterFor(profile),
      realtime,
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

    super({
      apiKey: apiKey || 'local-no-key',
      credentialProvider: args.credentialProvider,
      credentialProfile: profile.id,
      apiURL,
      config,
      options: args.options,
      modelInfo: args.modelInfo ?? [],
      models: args.models,
      supportFor: (model) =>
        applyExactModelInfoOverride(
          applyCapabilityGates(
            profile,
            axResolveAIProfileFeatures(profile.id, model),
            args as Record<string, unknown>
          ),
          model,
          args.modelInfo
        ),
      responsesReqUpdater: (request) => {
        const payload = { ...request } as Record<string, unknown>;
        applyRequestRules(payload, profile.request, args.options ?? {});
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
  }
}

export type AxAIOpenAIProfileArgs<TModelKey> = AxAIOpenAIArgs<
  AxAIProfileId,
  string,
  string,
  TModelKey
>;
