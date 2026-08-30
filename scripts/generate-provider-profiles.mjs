#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const sourcePath = path.join(repoRoot, 'ir/axcore/data/provider-profiles.json');
const targetPath = path.join(
  repoRoot,
  'src/ax/ai/provider_profiles.generated.ts'
);
const aliasesPath = path.join(repoRoot, 'ir/axcore/data/provider-aliases.json');
const registryPath = path.join(
  repoRoot,
  'ir/axcore/data/provider-profile-registry.json'
);
const descriptorsPath = path.join(
  repoRoot,
  'ir/axcore/data/provider-descriptors.json'
);
const matrixPath = path.join(repoRoot, 'docs/AI_PROFILES_MATRIX.md');
const check = process.argv.includes('--check');
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const ids = Object.keys(source.profiles);
const resolvedProfiles = Object.fromEntries(
  Object.entries(source.profiles).map(([id, profile]) => {
    const serviceTierProfile = source.serviceTierProfiles?.[id];
    return [
      id,
      {
        ...profile,
        capabilities: {
          ...profile.capabilities,
          serviceTiers: serviceTierProfile?.supported ?? [],
        },
        ...(serviceTierProfile
          ? {
              request: {
                ...(profile.request ?? {}),
                serviceTierMap: serviceTierProfile.requestMap,
              },
            }
          : {}),
      },
    ];
  })
);
const aliases = {};
const allowedTransports = new Set([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'gemini-generate-content',
  'webllm',
]);
const allowedDialects = new Set([
  ...allowedTransports,
  'gemini-live-bidi',
  'openai-embeddings',
  'openai-realtime',
  'openai-speech',
  'openai-transcription',
  'mistral-speech',
  'xai-realtime',
  'xai-speech',
  'xai-transcription',
]);
const allowedAuth = new Set([
  'bearer',
  'api-key-header',
  'api-key-query',
  'x-api-key',
  'none',
]);
const ruleRank = { exact: 0, prefix: 1, contains: 2 };
const allowedStructuredOutputModes = new Set([
  'native',
  'function',
  'json_object',
]);
const allowedRequestRuleKeys = new Set([
  'reasoning',
  'toolChoice',
  'defaultThinkingLevel',
  'effortMap',
  'unsupportedThinkingLevels',
  'dropWhenThinking',
  'dropFields',
  'copyFields',
  'renameFields',
  'enumMaps',
  'constructObjects',
  'imageURLShape',
  'reasoningObjectFields',
  'optionDialect',
  'thinkingBoolean',
  'serviceTierMap',
]);
const allowedServiceTiers = new Set(['auto', 'standard', 'flex', 'priority']);
const validateStructuredOutputModes = (capabilities, context) => {
  const modes = capabilities?.structuredOutputModes;
  if (!Array.isArray(modes)) {
    throw new Error(`${context}.structuredOutputModes must be an array`);
  }
  if (
    modes.some((mode) => !allowedStructuredOutputModes.has(mode)) ||
    new Set(modes).size !== modes.length
  ) {
    throw new Error(
      `${context}.structuredOutputModes must contain unique legal modes`
    );
  }
  if (modes.includes('native') !== Boolean(capabilities.structuredOutputs)) {
    throw new Error(
      `${context}.structuredOutputs must match native mode availability`
    );
  }
  if (modes.includes('function') && !capabilities.functions) {
    throw new Error(
      `${context} cannot advertise function output when functions=false`
    );
  }
};
const validateStringMap = (value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  if (Object.values(value).some((item) => typeof item !== 'string')) {
    throw new Error(`${context} values must be strings`);
  }
};
const validateRequestRules = (rules, context) => {
  if (!rules) return;
  for (const key of Object.keys(rules)) {
    if (!allowedRequestRuleKeys.has(key)) {
      throw new Error(`${context} has unsupported request transform ${key}`);
    }
  }
  if (
    rules.reasoning &&
    !['thinking-object', 'effort', 'openrouter'].includes(rules.reasoning)
  ) {
    throw new Error(
      `${context} has invalid reasoning dialect ${rules.reasoning}`
    );
  }
  if (
    rules.toolChoice &&
    !['supported', 'unforced'].includes(rules.toolChoice)
  ) {
    throw new Error(`${context} has invalid tool choice rule`);
  }
  if (
    rules.defaultThinkingLevel &&
    !['minimal', 'low', 'medium', 'high', 'highest', 'xhigh', 'max'].includes(
      rules.defaultThinkingLevel
    )
  ) {
    throw new Error(`${context} has invalid default thinking level`);
  }
  if (
    rules.defaultThinkingLevel &&
    rules.effortMap &&
    !Object.hasOwn(rules.effortMap, rules.defaultThinkingLevel)
  ) {
    throw new Error(
      `${context}.effortMap must map default thinking level ${rules.defaultThinkingLevel}`
    );
  }
  for (const key of [
    'dropWhenThinking',
    'dropFields',
    'reasoningObjectFields',
  ]) {
    if (
      rules[key] &&
      (!Array.isArray(rules[key]) ||
        rules[key].some((item) => typeof item !== 'string'))
    ) {
      throw new Error(`${context}.${key} must be a string array`);
    }
  }
  for (const key of ['copyFields', 'renameFields']) {
    if (rules[key]) validateStringMap(rules[key], `${context}.${key}`);
  }
  if (
    rules.effortMap &&
    Object.values(rules.effortMap).some(
      (item) => item !== null && typeof item !== 'string'
    )
  ) {
    throw new Error(`${context}.effortMap values must be strings or null`);
  }
  if (rules.unsupportedThinkingLevels) {
    validateStringMap(
      rules.unsupportedThinkingLevels,
      `${context}.unsupportedThinkingLevels`
    );
  }
  for (const [field, mapping] of Object.entries(rules.enumMaps ?? {})) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new Error(`${context}.enumMaps.${field} must be an object`);
    }
  }
  for (const [target, fields] of Object.entries(rules.constructObjects ?? {})) {
    validateStringMap(fields, `${context}.constructObjects.${target}`);
  }
  if (rules.imageURLShape && rules.imageURLShape !== 'object') {
    throw new Error(`${context} has invalid image URL shape`);
  }
  if (rules.optionDialect && rules.optionDialect !== 'search-parameters') {
    throw new Error(`${context} has invalid option dialect`);
  }
  if (rules.thinkingBoolean) {
    const path = rules.thinkingBoolean.path;
    if (
      !Array.isArray(path) ||
      path.length !== 2 ||
      path.some((part) => typeof part !== 'string' || !part)
    ) {
      throw new Error(
        `${context}.thinkingBoolean.path must name a nested object and field`
      );
    }
  }
  if (
    rules.serviceTierMap &&
    Object.entries(rules.serviceTierMap).some(
      ([tier, value]) =>
        !allowedServiceTiers.has(tier) ||
        (value !== null && typeof value !== 'string')
    )
  ) {
    throw new Error(`${context}.serviceTierMap has invalid tiers or values`);
  }
};

if (source.schemaVersion !== 'provider-profiles-v3') {
  throw new Error(`unsupported profile schema ${source.schemaVersion}`);
}

for (const id of Object.keys(source.serviceTierProfiles ?? {})) {
  if (!source.profiles[id]) {
    throw new Error(`service tier profile ${id} has no provider profile`);
  }
}

for (const [id, profile] of Object.entries(resolvedProfiles)) {
  if (profile.id !== id)
    throw new Error(`profile key ${id} does not match id ${profile.id}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
    throw new Error(`invalid profile id ${id}`);
  if (!allowedTransports.has(profile.transport))
    throw new Error(`profile ${id} has invalid transport ${profile.transport}`);
  if (!allowedAuth.has(profile.auth?.type))
    throw new Error(`profile ${id} has invalid auth type`);
  if (profile.auth.type === 'none' && profile.auth.required)
    throw new Error(`profile ${id} cannot require no authentication`);
  if (profile.auth.type === 'api-key-header' && !profile.auth.header)
    throw new Error(`profile ${id} must name its API key header`);
  const endpointModes = [
    Boolean(profile.baseURL),
    Boolean(profile.requiresApiURL),
    Boolean(profile.endpoint),
  ].filter(Boolean).length;
  if (profile.transport !== 'webllm' && endpointModes !== 1)
    throw new Error(`profile ${id} must declare exactly one endpoint mode`);
  if (profile.transport === 'webllm' && endpointModes !== 0)
    throw new Error(`profile ${id} must not declare an HTTP endpoint`);
  if (!profile.defaults || typeof profile.defaults !== 'object')
    throw new Error(`profile ${id} is missing defaults`);
  validateStructuredOutputModes(profile.capabilities, `profile ${id}`);
  if (
    profile.capabilities.serviceTiers &&
    (profile.capabilities.serviceTiers.some(
      (tier) => !allowedServiceTiers.has(tier)
    ) ||
      new Set(profile.capabilities.serviceTiers).size !==
        profile.capabilities.serviceTiers.length)
  ) {
    throw new Error(
      `profile ${id}.serviceTiers must contain unique legal tiers`
    );
  }
  if (!profile.operations || Object.keys(profile.operations).length === 0)
    throw new Error(`profile ${id} has no operation dialects`);
  for (const [operationName, operation] of Object.entries(profile.operations)) {
    if (profile.transport !== 'webllm' && !operation.path?.startsWith('/'))
      throw new Error(
        `profile ${id} operation ${operationName} has an invalid path`
      );
    if (!allowedDialects.has(operation.dialect))
      throw new Error(
        `profile ${id} operation ${operationName} has invalid dialect ${operation.dialect}`
      );
  }
  if (
    !profile.sources?.length ||
    !/^\d{4}-\d{2}-\d{2}$/.test(profile.reviewedAt)
  )
    throw new Error(`profile ${id} is missing source metadata`);
  for (const sourceURL of profile.sources) {
    if (!/^https:\/\//.test(sourceURL))
      throw new Error(`profile ${id} has a non-HTTPS source URL`);
  }
  let previousRuleRank = -1;
  const exactModels = new Set();
  validateRequestRules(profile.request, `profile ${id}`);
  for (const rule of profile.modelRules ?? []) {
    const matchKinds = Object.keys(rule.match ?? {}).filter(
      (key) => (rule.match[key] ?? []).length > 0
    );
    if (matchKinds.length !== 1 || ruleRank[matchKinds[0]] === undefined)
      throw new Error(`profile ${id} has an invalid model rule matcher`);
    const rank = ruleRank[matchKinds[0]];
    if (rank < previousRuleRank)
      throw new Error(
        `profile ${id} model rules violate exact-prefix-contains precedence`
      );
    previousRuleRank = rank;
    validateRequestRules(rule.request, `profile ${id} model rule`);
    validateStructuredOutputModes(
      { ...profile.capabilities, ...rule.capabilities },
      `profile ${id} model rule`
    );
    for (const model of rule.match.exact ?? []) {
      if (exactModels.has(model))
        throw new Error(`profile ${id} repeats exact model rule ${model}`);
      exactModels.add(model);
    }
  }
  for (const alias of profile.aliases) {
    const key = alias.toLowerCase();
    if (aliases[key] && aliases[key] !== id)
      throw new Error(`duplicate provider alias ${alias}`);
    aliases[key] = id;
  }
}

const output = `// Generated from ir/axcore/data/provider-profiles.json. Do not edit.\n// biome-ignore format: generated file\nexport const axAIProviderProfiles = ${JSON.stringify(resolvedProfiles, null, 2)} as const;\n\n// biome-ignore format: generated file\nexport const axAIProviderAliases = ${JSON.stringify(aliases, null, 2)} as const;\n\n// biome-ignore format: generated file\nexport const axAIProviderProfileIds = ${JSON.stringify(ids, null, 2)} as const;\n`;

const transportClient = {
  'openai-chat': 'OpenAICompatibleClient',
  'openai-responses': 'OpenAIResponsesClient',
  'anthropic-messages': 'AnthropicClient',
  'gemini-generate-content': 'GoogleGeminiClient',
  webllm: null,
};
const registry = {
  registryVersion: source.schemaVersion,
  supportedProfileIds: ids,
  profiles: Object.fromEntries(
    Object.entries(resolvedProfiles).map(([id, profile]) => [
      id,
      {
        id,
        aliases: profile.aliases,
        transport: profile.transport,
        generatedClient: transportClient[profile.transport],
        catalogStatus:
          profile.transport === 'webllm'
            ? 'typescript-only'
            : 'descriptor-covered',
      },
    ])
  ),
  deferredCatalogProviderIds: [],
};
const operationDescriptor = (name, operation) => ({
  ...operation,
  method: name === 'realtime' ? 'WS' : 'POST',
  path: operation.path,
  body: name === 'transcribe' ? 'multipart' : 'json',
  stream: name === 'stream_chat' || name === 'realtime',
  ...(name === 'speak' ? { response: 'binary' } : {}),
  dialect: operation.dialect,
});
const descriptors = Object.fromEntries(
  Object.entries(resolvedProfiles).map(([id, profile]) => {
    const operations = Object.fromEntries(
      Object.entries(profile.operations).map(([name, operation]) => [
        name,
        operationDescriptor(name, operation),
      ])
    );
    if (operations.chat && !operations.stream_chat) {
      operations.stream_chat = {
        ...operations.chat,
        stream: true,
      };
    }
    const authType =
      profile.auth.type === 'api-key-header'
        ? 'api_key_header'
        : profile.auth.type === 'api-key-query'
          ? 'api_key_query'
          : profile.auth.type;
    return [
      id,
      {
        ...profile,
        provider: id,
        baseUrl: profile.baseURL,
        auth: authType,
        authRequired: profile.auth.required,
        ...(profile.auth.header ? { apiKeyHeader: profile.auth.header } : {}),
        ...(profile.auth.type === 'api-key-query'
          ? { apiKeyQuery: profile.auth.query ?? 'key' }
          : {}),
        ...(profile.endpoint?.apiVersionField
          ? {
              apiVersion:
                profile.endpoint.defaults?.[profile.endpoint.apiVersionField] ??
                '',
            }
          : {}),
        defaultModel: profile.defaults.model,
        ...(profile.defaults.embedModel
          ? { defaultEmbedModel: profile.defaults.embedModel }
          : {}),
        operations,
        features: {
          functions: profile.capabilities.functions,
          streaming: profile.capabilities.streaming,
          structured_outputs: profile.capabilities.structuredOutputs,
          structured_output_modes: profile.capabilities.structuredOutputModes,
          thinking: profile.capabilities.thinking,
          multi_turn: profile.capabilities.multiTurn,
          service_tiers: profile.capabilities.serviceTiers ?? [],
          media: {
            images: {
              supported: profile.capabilities.images ?? false,
              formats: profile.capabilities.images
                ? ['image/jpeg', 'image/png']
                : [],
            },
            audio: {
              supported: profile.capabilities.audio ?? false,
              formats: profile.capabilities.audio
                ? ['wav', 'mp3', 'pcm16']
                : [],
              realtime: Boolean(profile.operations.realtime),
              output: {
                supported: profile.capabilities.audioOutput ?? false,
                formats: profile.capabilities.audioOutput
                  ? ['wav', 'mp3', 'pcm16']
                  : [],
              },
            },
            files: profile.capabilities.files
              ? {
                  supported: true,
                  formats: ['application/pdf', 'text/plain'],
                  upload_method: profile.capabilities.files.uploadMethod,
                }
              : { supported: false, formats: [], upload_method: 'none' },
            urls: {
              supported: false,
              web_search: profile.capabilities.webSearch ?? false,
              context_fetching: false,
            },
          },
          caching: profile.capabilities.caching
            ? {
                supported: true,
                types: profile.capabilities.caching.types,
                cache_breakpoints:
                  profile.capabilities.caching.cacheBreakpoints,
              }
            : { supported: false, types: [] },
        },
      },
    ];
  })
);
const jsonText = (value) => `${JSON.stringify(value)}\n`;
const markdownCell = (value) => String(value ?? '').replaceAll('|', '\\|');
const modelRuleCaveat = (rule) => {
  const matchKind = ['exact', 'prefix', 'contains'].find(
    (kind) => rule.match?.[kind]?.length
  );
  const selector = `${matchKind} ${(rule.match?.[matchKind] ?? [])
    .map((value) => `\`${value}\``)
    .join(', ')}`;
  const details = [];
  if (rule.capabilities?.thinking) details.push('thinking');
  if (rule.capabilities?.structuredOutputs === false) {
    details.push('no native structured output');
  }
  if (rule.capabilities?.structuredOutputModes) {
    details.push(
      `structured modes ${rule.capabilities.structuredOutputModes
        .map((mode) => `\`${mode}\``)
        .join(' -> ')}`
    );
  }
  if (rule.request?.defaultThinkingLevel) {
    details.push(`default thinking \`${rule.request.defaultThinkingLevel}\``);
  }
  if (rule.request?.toolChoice === 'unforced') {
    details.push('no forced tool choice');
  }
  return details.length ? `${selector}: ${details.join(', ')}` : selector;
};
const matrixRows = Object.values(resolvedProfiles).map((profile) => {
  const endpoint = profile.baseURL
    ? `\`${profile.baseURL}\``
    : profile.endpoint
      ? profile.endpoint.required.map((field) => `\`${field}\``).join(' + ')
      : profile.transport === 'webllm'
        ? 'Host runtime'
        : 'Required `apiURL`';
  const capabilities = [
    profile.capabilities.functions ? 'tools' : null,
    profile.capabilities.streaming ? 'stream' : null,
    profile.capabilities.structuredOutputs ? 'structured' : null,
    profile.capabilities.structuredOutputModes.length
      ? `modes ${profile.capabilities.structuredOutputModes.join(' -> ')}`
      : 'no verified structured mode',
    profile.capabilities.thinking ? 'thinking' : null,
    profile.capabilities.images ? 'images' : null,
    profile.capabilities.audio ? 'audio' : null,
    profile.capabilities.files ? 'files' : null,
    profile.capabilities.webSearch ? 'web search' : null,
    profile.capabilities.serviceTiers?.length
      ? `tiers ${profile.capabilities.serviceTiers.join('/')}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  const modelCaveat = (profile.modelRules ?? []).length
    ? profile.modelRules.map(modelRuleCaveat).join('; ')
    : 'Conservative defaults; use `modelInfo` for model-specific features';
  const sources = profile.sources
    .map(
      (sourceURL, index) =>
        `[source${profile.sources.length > 1 ? ` ${index + 1}` : ''}](${sourceURL})`
    )
    .join(', ');
  return `| \`${profile.id}\` | ${markdownCell(profile.transport)} | ${endpoint} | ${markdownCell(profile.auth.type)}${profile.auth.required ? '' : ' (optional)'} | ${markdownCell(capabilities || 'conservative')} | ${markdownCell(modelCaveat)} | ${sources} | ${profile.reviewedAt} |`;
});
const matrix = `# AI Deployment Profile Matrix\n\nThis file is generated from [\`ir/axcore/data/provider-profiles.json\`](../ir/axcore/data/provider-profiles.json). Do not edit it by hand. Capability values are deployment defaults; exact profile model rules and caller \`modelInfo\` overrides can refine them.\n\n| Profile | Transport | Endpoint | Auth | Default capabilities | Model caveat | Official sources | Reviewed |\n|---|---|---|---|---|---|---|---|\n${matrixRows.join('\n')}\n`;

if (check) {
  const current = readFileSync(targetPath, 'utf8');
  const stale =
    current !== output ||
    readFileSync(aliasesPath, 'utf8') !== jsonText(aliases) ||
    readFileSync(registryPath, 'utf8') !== jsonText(registry) ||
    readFileSync(descriptorsPath, 'utf8') !== jsonText(descriptors) ||
    readFileSync(matrixPath, 'utf8') !== matrix;
  if (stale) {
    console.error(
      'provider profile registry is stale; run npm run profiles:generate'
    );
    process.exit(1);
  }
} else {
  writeFileSync(targetPath, output);
  writeFileSync(aliasesPath, jsonText(aliases));
  writeFileSync(registryPath, jsonText(registry));
  writeFileSync(descriptorsPath, jsonText(descriptors));
  writeFileSync(matrixPath, matrix);
}
