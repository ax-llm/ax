/** AWS Bedrock provider backed by the native AWS SDK Converse API. */

import { Buffer } from 'node:buffer';
import {
  BedrockRuntimeClient,
  type ContentBlock,
  ConverseCommand,
  type ConverseCommandOutput,
  type ConverseRequest,
  ConverseStreamCommand,
  type ConverseStreamOutput,
  type DocumentBlock,
  type DocumentFormat,
  type ImageBlock,
  type ImageFormat,
  InvokeModelCommand,
  type Message,
  type SystemContentBlock,
  type TokenUsage,
  type ToolConfiguration,
  type ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxAPI,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxServiceTier,
  AxTokenUsage,
} from '@ax-llm/ax';
import { type AxAIFeatures, AxBaseAI, axBaseAIDefaultConfig } from '@ax-llm/ax';
import {
  type AxAIBedrockModelCapabilities,
  axGetBedrockModelCapabilities,
  axModelInfoBedrock,
} from './info.js';
import {
  type AxAIBedrockConfig,
  type AxAIBedrockEmbedModel,
  AxAIBedrockModel,
  type BedrockTitanEmbedRequest,
  type BedrockTitanEmbedResponse,
} from './types.js';

type AxBedrockChatRequest = Omit<AxChatRequest, 'model'> &
  Required<Pick<AxChatRequest<AxAIBedrockModel>, 'model'>>;

type AxBedrockEmbedRequest = Omit<AxEmbedRequest, 'embedModel'> &
  Required<Pick<AxEmbedRequest<AxAIBedrockEmbedModel>, 'embedModel'>>;

type BedrockConverseResponse = {
  response: ConverseCommandOutput;
  model: AxAIBedrockModel;
  showThoughts: boolean;
};

type BedrockConverseStreamEvent = {
  event: ConverseStreamOutput;
  model: AxAIBedrockModel;
  requestId?: string;
  showThoughts: boolean;
};

type CacheTtl = '5m' | '1h';

const IMAGE_FORMATS: Record<string, ImageFormat> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// cspell:ignore msword openxmlformats officedocument spreadsheetml wordprocessingml
const DOCUMENT_FORMATS: Record<string, DocumentFormat> = {
  'application/msword': 'doc',
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
};

const THINKING_BUDGETS = {
  minimal: 1024,
  low: 4096,
  medium: 10000,
  high: 20000,
  highest: 32000,
} as const;

const THINKING_EFFORT = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  highest: 'max',
} as const;

function decodeBase64(value: string): Uint8Array {
  const payload = value.startsWith('data:')
    ? value.slice(value.indexOf(',') + 1)
    : value;
  return Uint8Array.from(Buffer.from(payload, 'base64'));
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function toBedrockDocument(
  value: string | object | undefined
): NonNullable<ConverseRequest['additionalModelRequestFields']> {
  if (value === undefined) return {};
  if (typeof value !== 'string') {
    return value as NonNullable<
      ConverseRequest['additionalModelRequestFields']
    >;
  }
  try {
    return JSON.parse(value) as NonNullable<
      ConverseRequest['additionalModelRequestFields']
    >;
  } catch {
    return value;
  }
}

function fromBedrockDocument(
  value: NonNullable<ConverseRequest['additionalModelRequestFields']>
): string | object {
  if (typeof value === 'string' || typeof value === 'object') return value;
  return JSON.stringify(value);
}

function imageFormat(mimeType: string): ImageFormat {
  const format = IMAGE_FORMATS[mimeType.toLowerCase()];
  if (!format) {
    throw new Error(`Unsupported Bedrock image MIME type: ${mimeType}`);
  }
  return format;
}

function documentFormat(mimeType: string, filename?: string): DocumentFormat {
  const fromMime = DOCUMENT_FORMATS[mimeType.toLowerCase()];
  if (fromMime) return fromMime;

  const extension = filename?.split('.').pop()?.toLowerCase();
  if (
    extension &&
    ['csv', 'doc', 'docx', 'html', 'md', 'pdf', 'txt', 'xls', 'xlsx'].includes(
      extension
    )
  ) {
    return extension as DocumentFormat;
  }
  throw new Error(`Unsupported Bedrock document MIME type: ${mimeType}`);
}

function documentName(filename?: string): string {
  const name = (filename ?? 'document')
    .replace(/[^A-Za-z0-9\s\-()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || 'document';
}

function imageBlock(item: { image: string; mimeType: string }): ImageBlock {
  return {
    format: imageFormat(item.mimeType),
    source: { bytes: decodeBase64(item.image) },
  };
}

function documentBlock(item: {
  data?: string;
  fileUri?: string;
  filename?: string;
  mimeType: string;
}): DocumentBlock {
  const source = item.data
    ? { bytes: decodeBase64(item.data) }
    : item.fileUri?.startsWith('s3://')
      ? { s3Location: { uri: item.fileUri } }
      : undefined;
  if (!source) {
    throw new Error(
      'Bedrock document inputs require inline base64 data or an s3:// URI'
    );
  }
  return {
    format: documentFormat(item.mimeType, item.filename),
    name: documentName(item.filename),
    source,
  };
}

function cachePoint(ttl: CacheTtl): ContentBlock {
  return { cachePoint: { type: 'default', ttl } };
}

function mapStopReason(
  reason: ConverseCommandOutput['stopReason']
): AxChatResponseResult['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'tool_use':
      return 'function_call';
    case 'content_filtered':
    case 'guardrail_intervened':
      return 'content_filter';
    case 'malformed_model_output':
    case 'malformed_tool_use':
      return 'error';
    default:
      return undefined;
  }
}

function mapServiceTier(
  tier?: string
): AxTokenUsage['serviceTier'] | undefined {
  switch (tier) {
    case 'flex':
      return 'flex';
    case 'priority':
      return 'priority';
    case 'default':
    case 'reserved':
      return 'standard';
    default:
      return undefined;
  }
}

function mapTokenUsage(
  usage: TokenUsage | undefined,
  serviceTier?: string
): AxTokenUsage {
  const promptTokens = usage?.inputTokens ?? 0;
  const completionTokens = usage?.outputTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
    cacheCreationTokens: usage?.cacheWriteInputTokens,
    cacheReadTokens: usage?.cacheReadInputTokens,
    serviceTier: mapServiceTier(serviceTier),
  };
}

function requestedServiceTier(
  tier: AxServiceTier | undefined
): ConverseRequest['serviceTier'] | undefined {
  switch (tier) {
    case 'standard':
      return { type: 'default' };
    case 'flex':
      return { type: 'flex' };
    case 'priority':
      return { type: 'priority' };
    default:
      return undefined;
  }
}

function streamError(
  event: ConverseStreamOutput
): { error: Error; status?: number } | undefined {
  if ('throttlingException' in event && event.throttlingException) {
    return {
      error: new Error(
        event.throttlingException.message ?? 'Bedrock throttled'
      ),
      status: 429,
    };
  }
  if (
    'serviceUnavailableException' in event &&
    event.serviceUnavailableException
  ) {
    return {
      error: new Error(
        event.serviceUnavailableException.message ?? 'Bedrock unavailable'
      ),
      status: 503,
    };
  }
  if ('internalServerException' in event && event.internalServerException) {
    return {
      error: new Error(
        event.internalServerException.message ?? 'Bedrock internal error'
      ),
      status: 500,
    };
  }
  if ('modelStreamErrorException' in event && event.modelStreamErrorException) {
    return {
      error: new Error(
        event.modelStreamErrorException.message ?? 'Bedrock stream error'
      ),
      status: event.modelStreamErrorException.originalStatusCode,
    };
  }
  if ('validationException' in event && event.validationException) {
    return {
      error: new Error(
        event.validationException.message ?? 'Invalid Bedrock stream request'
      ),
      status: 400,
    };
  }
  return undefined;
}

class AxAIBedrockImpl
  implements
    AxAIServiceImpl<
      AxAIBedrockModel,
      AxAIBedrockEmbedModel,
      ConverseRequest,
      BedrockTitanEmbedRequest,
      BedrockConverseResponse,
      BedrockConverseStreamEvent,
      BedrockTitanEmbedResponse
    >
{
  private clients = new Map<string, BedrockRuntimeClient>();
  private tokensUsed?: AxTokenUsage;

  constructor(
    private config: AxAIBedrockConfig,
    private primaryRegion: string,
    private fallbackRegions: string[],
    private gptRegion: string,
    private gptFallbackRegions: string[]
  ) {}

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed;
  }

  getModelConfig(): AxModelConfig {
    return {
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      topP: this.config.topP,
      topK: this.config.topK,
      stopSequences: this.config.stopSequences,
      effort: this.config.effort,
    };
  }

  private getClient(region: string): BedrockRuntimeClient {
    let client = this.clients.get(region);
    if (!client) {
      client = new BedrockRuntimeClient({ region });
      this.clients.set(region, client);
    }
    return client;
  }

  private getRegionsForModel(model: AxAIBedrockModel): string[] {
    const capabilities = axGetBedrockModelCapabilities(model);
    return capabilities.family === 'gpt'
      ? [this.gptRegion, ...this.gptFallbackRegions]
      : [this.primaryRegion, ...this.fallbackRegions];
  }

  private async invokeWithFailover<T>(
    model: AxAIBedrockModel | AxAIBedrockEmbedModel,
    regions: readonly string[],
    handler: (client: BedrockRuntimeClient) => Promise<T>
  ): Promise<T> {
    let lastError: Error | undefined;
    for (const region of regions) {
      try {
        return await handler(this.getClient(region));
      } catch (error) {
        lastError = error as Error;
        console.warn(`[Bedrock] Region ${region} failed for ${model}:`, error);
      }
    }
    throw lastError ?? new Error(`All Bedrock regions failed for ${model}`);
  }

  private resolveCacheTtl(
    model: AxAIBedrockModel,
    options: Readonly<AxAIServiceOptions> | undefined,
    hasExplicitBreakpoint: boolean
  ): CacheTtl | undefined {
    const capabilities = axGetBedrockModelCapabilities(model);
    const cachingRequested =
      hasExplicitBreakpoint || options?.contextCache !== undefined;
    if (!cachingRequested) return undefined;
    if (capabilities.cacheTTLs.length === 0) {
      throw new Error(`Prompt caching is not supported for ${model}`);
    }

    const ttlSeconds = options?.contextCache?.ttlSeconds ?? 300;
    if (ttlSeconds <= 300) return '5m';
    if (ttlSeconds <= 3600 && capabilities.cacheTTLs.includes('1h')) {
      return '1h';
    }
    throw new Error(
      `Prompt-cache TTL ${ttlSeconds}s is not supported for ${model}`
    );
  }

  private createMessages(
    req: Readonly<AxBedrockChatRequest>,
    capabilities: Readonly<AxAIBedrockModelCapabilities>,
    ttl: CacheTtl | undefined,
    autoCache: boolean,
    maxMessageCachePoints: number
  ): { messages: Message[]; system: SystemContentBlock[] } {
    const messages: Message[] = [];
    const system: SystemContentBlock[] = [];
    let cachePoints = 0;

    const addCachePoint = <T extends ContentBlock | SystemContentBlock>(
      target: T[],
      requested: boolean
    ) => {
      if (!requested) return;
      if (!ttl) {
        throw new Error(`Prompt caching is not supported for ${req.model}`);
      }
      if (cachePoints >= maxMessageCachePoints) {
        throw new Error('Bedrock supports at most four cache checkpoints');
      }
      target.push(cachePoint(ttl) as T);
      cachePoints++;
    };

    const pushMessage = (
      role: 'user' | 'assistant',
      content: ContentBlock[]
    ) => {
      const previous = messages.at(-1);
      if (previous?.role === role) {
        previous.content = [...(previous.content ?? []), ...content];
      } else {
        messages.push({ role, content });
      }
    };

    const systemMessages = req.chatPrompt.filter(
      (message) => message.role === 'system'
    );
    for (const [index, message] of systemMessages.entries()) {
      system.push({ text: message.content });
      addCachePoint(
        system,
        Boolean(message.cache) ||
          (autoCache && index === systemMessages.length - 1)
      );
    }

    for (const message of req.chatPrompt) {
      if (message.role === 'system') continue;

      if (message.role === 'user') {
        const content: ContentBlock[] = [];
        let hasDocument = false;
        let hasText = false;
        if (typeof message.content === 'string') {
          content.push({ text: message.content });
          hasText = true;
        } else {
          for (const item of message.content) {
            switch (item.type) {
              case 'text':
                content.push({ text: item.text });
                hasText = true;
                addCachePoint(content, Boolean(item.cache));
                break;
              case 'image':
                if (!capabilities.images) {
                  throw new Error(
                    `Image input is not supported for ${req.model}`
                  );
                }
                content.push({ image: imageBlock(item) });
                addCachePoint(content, Boolean(item.cache));
                break;
              case 'file':
                if (!capabilities.files) {
                  throw new Error(
                    `Document input is not supported for ${req.model}`
                  );
                }
                content.push({ document: documentBlock(item) });
                hasDocument = true;
                addCachePoint(content, Boolean(item.cache));
                break;
              case 'audio':
                throw new Error(
                  `Audio input is not supported for ${req.model}`
                );
              case 'url':
                throw new Error(`URL input is not supported for ${req.model}`);
            }
          }
        }
        if (hasDocument && !hasText) {
          content.unshift({
            text: 'Use the attached document to answer the request.',
          });
        }
        addCachePoint(content, Boolean(message.cache));
        pushMessage('user', content);
        continue;
      }

      if (message.role === 'assistant') {
        const content: ContentBlock[] = [];
        for (const block of message.thoughtBlocks ?? []) {
          content.push({
            reasoningContent: block.encrypted
              ? { redactedContent: decodeBase64(block.data) }
              : {
                  reasoningText: {
                    text: block.data,
                    ...(block.signature ? { signature: block.signature } : {}),
                  },
                },
          });
        }
        if (message.content) content.push({ text: message.content });
        for (const call of message.functionCalls ?? []) {
          content.push({
            toolUse: {
              toolUseId: call.id,
              name: call.function.name,
              input: toBedrockDocument(call.function.params),
            },
          });
        }
        addCachePoint(content, Boolean(message.cache));
        pushMessage('assistant', content);
        continue;
      }

      const toolContent: ToolResultContentBlock[] = [];
      if (message.content?.length) {
        for (const item of message.content) {
          switch (item.type) {
            case 'text':
              toolContent.push({ text: item.text });
              break;
            case 'image':
              toolContent.push({ image: imageBlock(item) });
              break;
            case 'file':
              toolContent.push({ document: documentBlock(item) });
              break;
            case 'audio':
              toolContent.push({
                text:
                  item.transcription ??
                  `[Audio result: ${item.mimeType ?? 'application/octet-stream'}]`,
              });
              break;
            case 'url':
              toolContent.push({
                text:
                  item.cachedContent ??
                  [item.title, item.description, item.url]
                    .filter(Boolean)
                    .join('\n'),
              });
              break;
          }
        }
      } else {
        try {
          toolContent.push({ json: JSON.parse(message.result) });
        } catch {
          toolContent.push({ text: message.result });
        }
      }
      const isClaude5 =
        req.model.includes('claude-sonnet-5') ||
        req.model.includes('claude-opus-5');
      const content: ContentBlock[] = [
        {
          toolResult: {
            toolUseId: message.functionId,
            content: toolContent,
            ...(!isClaude5
              ? {
                  status: message.isError
                    ? ('error' as const)
                    : ('success' as const),
                }
              : {}),
          },
        },
      ];
      addCachePoint(content, Boolean(message.cache));
      pushMessage('user', content);
    }

    // A contextCache option must always produce at least one native checkpoint.
    // System and tool schemas are preferred stable prefixes; without either,
    // cache the final message prefix instead of silently disabling caching.
    if (autoCache && ttl && cachePoints === 0 && maxMessageCachePoints === 4) {
      const lastMessage = messages.at(-1);
      if (lastMessage?.content) addCachePoint(lastMessage.content, true);
    }

    return { messages, system };
  }

  private createToolConfig(
    req: Readonly<AxBedrockChatRequest>,
    ttl: CacheTtl | undefined,
    autoCache: boolean
  ): ToolConfiguration | undefined {
    if (!req.functions?.length || req.functionCall === 'none') return undefined;

    const tools: NonNullable<ToolConfiguration['tools']> = req.functions.map(
      (fn) => ({
        toolSpec: {
          name: fn.name,
          description: fn.description,
          inputSchema: {
            json: fn.parameters ?? { type: 'object', properties: {} },
          },
        },
      })
    );
    if (ttl && (autoCache || req.functions.some((fn) => Boolean(fn.cache)))) {
      tools.push({ cachePoint: { type: 'default', ttl } });
    }

    const toolChoice: ToolConfiguration['toolChoice'] =
      req.functionCall === 'required'
        ? { any: {} }
        : typeof req.functionCall === 'object'
          ? { tool: { name: req.functionCall.function.name } }
          : { auto: {} };
    return { tools, toolChoice };
  }

  createChatReq = async (
    req: Readonly<AxBedrockChatRequest>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<[AxAPI, ConverseRequest]> => {
    const capabilities = axGetBedrockModelCapabilities(req.model);
    const hasExplicitBreakpoint =
      req.chatPrompt.some((message) => Boolean(message.cache)) ||
      Boolean(req.functions?.some((fn) => fn.cache));
    const ttl = this.resolveCacheTtl(req.model, options, hasExplicitBreakpoint);
    const autoCache = options?.contextCache !== undefined;
    const toolCacheRequested = Boolean(
      capabilities.functions &&
        ttl &&
        req.functions?.length &&
        req.functionCall !== 'none' &&
        (autoCache || req.functions.some((fn) => Boolean(fn.cache)))
    );
    const { messages, system } = this.createMessages(
      req,
      capabilities,
      ttl,
      autoCache,
      toolCacheRequested ? 3 : 4
    );

    const modelConfig = { ...this.config, ...req.modelConfig };
    const thinkingBudget = options?.thinkingTokenBudget;
    let thinkingActive = false;
    let additionalModelRequestFields: Record<string, unknown> | undefined;
    let effort = modelConfig.effort;

    if (capabilities.thinking === 'adaptive') {
      if (thinkingBudget === 'none') {
        if (capabilities.thinkingAlwaysOn) {
          throw new Error(
            `Adaptive thinking cannot be disabled for ${req.model}`
          );
        }
        if (capabilities.thinkingDefault) {
          additionalModelRequestFields = { thinking: { type: 'disabled' } };
        }
      } else if (
        capabilities.thinkingDefault ||
        thinkingBudget !== undefined ||
        effort !== undefined
      ) {
        thinkingActive = true;
        additionalModelRequestFields = { thinking: { type: 'adaptive' } };
        if (thinkingBudget) effort = THINKING_EFFORT[thinkingBudget];
      }
    } else if (
      capabilities.thinking === 'budget' &&
      thinkingBudget &&
      thinkingBudget !== 'none'
    ) {
      thinkingActive = true;
      additionalModelRequestFields = {
        thinking: {
          type: 'enabled',
          budget_tokens: THINKING_BUDGETS[thinkingBudget],
        },
      };
    }

    if (modelConfig.topK !== undefined && !thinkingActive) {
      additionalModelRequestFields = {
        ...additionalModelRequestFields,
        top_k: modelConfig.topK,
      };
    }

    const outputConfig: ConverseRequest['outputConfig'] = {};
    if (effort && capabilities.thinking === 'adaptive') {
      outputConfig.effort = effort;
    }
    if (
      req.responseFormat?.type === 'json_schema' &&
      req.responseFormat.schema &&
      capabilities.structuredOutputModes.includes('native')
    ) {
      const schema =
        req.responseFormat.schema.schema ?? req.responseFormat.schema;
      outputConfig.textFormat = {
        type: 'json_schema',
        structure: {
          jsonSchema: {
            schema: JSON.stringify(schema),
            name:
              typeof schema.title === 'string' && schema.title.length > 0
                ? schema.title
                : 'ax_response',
          },
        },
      };
    }

    const toolConfig = capabilities.functions
      ? this.createToolConfig(req, ttl, autoCache)
      : undefined;
    if (
      options?.serviceTier &&
      options.serviceTier !== 'auto' &&
      !capabilities.serviceTiers.includes(options.serviceTier)
    ) {
      throw new Error(
        `Service tier ${options.serviceTier} is not supported for ${req.model}`
      );
    }
    const serviceTier = requestedServiceTier(options?.serviceTier);
    const request: ConverseRequest = {
      modelId: req.model,
      messages,
      ...(system.length ? { system } : {}),
      inferenceConfig: {
        maxTokens: modelConfig.maxTokens ?? 4096,
        ...(!thinkingActive && modelConfig.temperature !== undefined
          ? { temperature: modelConfig.temperature }
          : {}),
        ...(!thinkingActive && modelConfig.topP !== undefined
          ? { topP: modelConfig.topP }
          : {}),
        ...(modelConfig.stopSequences?.length
          ? { stopSequences: modelConfig.stopSequences }
          : {}),
      },
      ...(toolConfig ? { toolConfig } : {}),
      ...(additionalModelRequestFields
        ? {
            additionalModelRequestFields:
              additionalModelRequestFields as NonNullable<
                ConverseRequest['additionalModelRequestFields']
              >,
          }
        : {}),
      ...(Object.keys(outputConfig).length ? { outputConfig } : {}),
      ...(serviceTier ? { serviceTier } : {}),
    };

    const showThoughts = options?.showThoughts === true;
    const abortSignal = options?.abortSignal;
    const apiConfig: AxAPI = {
      name: 'bedrock-converse',
      localCall: async <TRequest, TResponse>(
        data: TRequest,
        stream?: boolean
      ) => {
        const requestData = data as ConverseRequest;
        if (stream) {
          return this.createConverseStream(
            req.model,
            requestData,
            showThoughts,
            abortSignal
          ) as ReadableStream<TResponse>;
        }
        const response = await this.invokeWithFailover(
          req.model,
          this.getRegionsForModel(req.model),
          async (client) =>
            await client.send(new ConverseCommand(requestData), { abortSignal })
        );
        return {
          response,
          model: req.model,
          showThoughts,
        } as TResponse;
      },
    };

    return [apiConfig, request];
  };

  private createConverseStream(
    model: AxAIBedrockModel,
    request: ConverseRequest,
    showThoughts: boolean,
    parentSignal?: AbortSignal
  ): ReadableStream<BedrockConverseStreamEvent> {
    const regions = this.getRegionsForModel(model);
    let currentAbort: AbortController | undefined;
    let cancelled = false;

    return new ReadableStream<BedrockConverseStreamEvent>({
      start: (controller) => {
        const run = async () => {
          let lastError: Error | undefined;
          let emitted = false;
          for (const region of regions) {
            if (cancelled || parentSignal?.aborted) break;
            currentAbort = new AbortController();
            const onAbort = () => currentAbort?.abort(parentSignal?.reason);
            parentSignal?.addEventListener('abort', onAbort, { once: true });
            try {
              const output = await this.getClient(region).send(
                new ConverseStreamCommand(request),
                { abortSignal: currentAbort.signal }
              );
              if (!output.stream) {
                throw new Error('Bedrock returned no Converse stream');
              }
              for await (const event of output.stream) {
                const failure = streamError(event);
                if (
                  failure &&
                  !emitted &&
                  failure.status &&
                  failure.status >= 500
                ) {
                  throw failure.error;
                }
                controller.enqueue({
                  event,
                  model,
                  requestId: output.$metadata.requestId,
                  showThoughts,
                });
                emitted = true;
              }
              controller.close();
              return;
            } catch (error) {
              lastError = error as Error;
              if (emitted || cancelled || parentSignal?.aborted) {
                controller.error(error);
                return;
              }
              console.warn(
                `[Bedrock] Region ${region} failed for ${model}:`,
                error
              );
            } finally {
              parentSignal?.removeEventListener('abort', onAbort);
            }
          }
          controller.error(
            lastError ?? new DOMException('Aborted', 'AbortError')
          );
        };
        void run();
      },
      cancel: (reason) => {
        cancelled = true;
        currentAbort?.abort(reason);
      },
    });
  }

  createChatResp(resp: Readonly<BedrockConverseResponse>): AxChatResponse {
    const message =
      resp.response.output && 'message' in resp.response.output
        ? resp.response.output.message
        : undefined;
    const result: AxChatResponseResult = {
      index: 0,
      id: resp.response.$metadata.requestId,
      finishReason: mapStopReason(resp.response.stopReason),
    };
    let content = '';
    const functionCalls: NonNullable<AxChatResponseResult['functionCalls']> =
      [];
    const thoughtBlocks: NonNullable<AxChatResponseResult['thoughtBlocks']> =
      [];

    for (const block of message?.content ?? []) {
      if ('text' in block && typeof block.text === 'string') {
        content += block.text;
      } else if ('toolUse' in block && block.toolUse) {
        functionCalls.push({
          id: block.toolUse.toolUseId ?? '',
          type: 'function',
          function: {
            name: block.toolUse.name ?? '',
            params:
              block.toolUse.input === undefined || block.toolUse.input === null
                ? undefined
                : fromBedrockDocument(block.toolUse.input),
          },
        });
      } else if ('reasoningContent' in block && block.reasoningContent) {
        const reasoning = block.reasoningContent;
        if ('reasoningText' in reasoning && reasoning.reasoningText) {
          thoughtBlocks.push({
            data: reasoning.reasoningText.text ?? '',
            encrypted: false,
            ...(reasoning.reasoningText.signature
              ? { signature: reasoning.reasoningText.signature }
              : {}),
          });
        } else if (
          'redactedContent' in reasoning &&
          reasoning.redactedContent
        ) {
          thoughtBlocks.push({
            data: encodeBase64(reasoning.redactedContent),
            encrypted: true,
          });
        }
      }
    }

    if (content) result.content = content;
    if (functionCalls.length) result.functionCalls = functionCalls;
    if (thoughtBlocks.length) {
      result.thoughtBlocks = thoughtBlocks;
      if (resp.showThoughts) {
        result.thought = thoughtBlocks
          .filter((block) => !block.encrypted)
          .map((block) => block.data)
          .join('');
      }
    }

    this.tokensUsed = mapTokenUsage(
      resp.response.usage,
      resp.response.serviceTier?.type
    );
    return {
      results: [result],
      remoteId: resp.response.$metadata.requestId,
      remoteRequestId: resp.response.$metadata.requestId,
    };
  }

  classifyStreamErrorStatus = (
    resp: Readonly<BedrockConverseStreamEvent>
  ): number | undefined => streamError(resp.event)?.status;

  createChatStreamResp = (
    resp: Readonly<BedrockConverseStreamEvent>,
    state: object
  ): AxChatResponse => {
    const failure = streamError(resp.event);
    if (failure) throw failure.error;

    const streamState = state as { toolIds?: Record<number, string> };
    streamState.toolIds ??= {};
    const result: AxChatResponseResult = { index: 0 };
    const event = resp.event;

    if ('messageStart' in event && event.messageStart) {
      result.id = resp.requestId;
      result.content = '';
    } else if ('contentBlockStart' in event && event.contentBlockStart) {
      const blockIndex = event.contentBlockStart.contentBlockIndex ?? 0;
      const start = event.contentBlockStart.start;
      if (start && 'toolUse' in start && start.toolUse) {
        const id = start.toolUse.toolUseId ?? '';
        streamState.toolIds[blockIndex] = id;
        result.functionCalls = [
          {
            id,
            type: 'function',
            function: { name: start.toolUse.name ?? '', params: '' },
          },
        ];
      } else {
        result.content = '';
      }
    } else if ('contentBlockDelta' in event && event.contentBlockDelta) {
      const blockIndex = event.contentBlockDelta.contentBlockIndex ?? 0;
      const delta = event.contentBlockDelta.delta;
      if (delta && 'text' in delta && typeof delta.text === 'string') {
        result.content = delta.text;
      } else if (delta && 'toolUse' in delta && delta.toolUse) {
        result.functionCalls = [
          {
            id: streamState.toolIds[blockIndex] ?? '',
            type: 'function',
            function: { name: '', params: delta.toolUse.input ?? '' },
          },
        ];
      } else if (
        delta &&
        'reasoningContent' in delta &&
        delta.reasoningContent
      ) {
        const reasoning = delta.reasoningContent;
        if ('text' in reasoning && typeof reasoning.text === 'string') {
          result.thoughtBlocks = [{ data: reasoning.text, encrypted: false }];
          if (resp.showThoughts) result.thought = reasoning.text;
        } else if (
          'signature' in reasoning &&
          typeof reasoning.signature === 'string'
        ) {
          result.thoughtBlocks = [
            { data: '', encrypted: false, signature: reasoning.signature },
          ];
        } else if (
          'redactedContent' in reasoning &&
          reasoning.redactedContent
        ) {
          result.thoughtBlocks = [
            {
              data: encodeBase64(reasoning.redactedContent),
              encrypted: true,
            },
          ];
        }
      } else {
        result.content = '';
      }
    } else if ('messageStop' in event && event.messageStop) {
      result.content = '';
      result.finishReason = mapStopReason(event.messageStop.stopReason);
    } else if ('metadata' in event && event.metadata) {
      this.tokensUsed = mapTokenUsage(
        event.metadata.usage,
        event.metadata.serviceTier?.type
      );
      result.content = '';
    } else {
      result.content = '';
    }

    return {
      results: [result],
      remoteId: resp.requestId,
      remoteRequestId: resp.requestId,
    };
  };

  supportsImplicitCaching = (model: AxAIBedrockModel): boolean =>
    axGetBedrockModelCapabilities(model).cacheTTLs.length > 0;

  createEmbedReq = async (
    req: Readonly<AxBedrockEmbedRequest>
  ): Promise<[AxAPI, BedrockTitanEmbedRequest]> => {
    if (!req.texts?.length) throw new Error('No texts provided for embedding');

    const embedRequest: BedrockTitanEmbedRequest = {
      inputText: req.texts[0],
      dimensions: this.config.dimensions,
      normalize: true,
    };
    const apiConfig: AxAPI = {
      name: 'bedrock-titan-embed',
      localCall: async <TRequest, TResponse>(data: TRequest) => {
        const request = data as BedrockTitanEmbedRequest;
        const regions = [this.primaryRegion, ...this.fallbackRegions];
        return (await this.invokeWithFailover(
          req.embedModel,
          regions,
          async (client) => {
            const response = await client.send(
              new InvokeModelCommand({
                modelId: req.embedModel,
                body: JSON.stringify(request),
                contentType: 'application/json',
                accept: 'application/json',
              })
            );
            return JSON.parse(new TextDecoder().decode(response.body));
          }
        )) as TResponse;
      },
    };
    return [apiConfig, embedRequest];
  };

  createEmbedResp(resp: Readonly<BedrockTitanEmbedResponse>): AxEmbedResponse {
    return { embeddings: [resp.embedding] };
  }
}

export class AxAIBedrock extends AxBaseAI<
  AxAIBedrockModel,
  AxAIBedrockEmbedModel,
  ConverseRequest,
  BedrockTitanEmbedRequest,
  BedrockConverseResponse,
  BedrockConverseStreamEvent,
  BedrockTitanEmbedResponse,
  string
> {
  constructor({
    region = 'us-east-2',
    fallbackRegions = ['us-west-2', 'us-east-1'],
    gptRegion = 'us-west-2',
    gptFallbackRegions = ['us-east-1'],
    config,
    options,
  }: Readonly<{
    region?: string;
    fallbackRegions?: string[];
    gptRegion?: string;
    gptFallbackRegions?: string[];
    config: Readonly<Partial<AxAIBedrockConfig>>;
    options?: Readonly<AxAIServiceOptions>;
  }>) {
    const fullConfig: AxAIBedrockConfig = {
      ...axBaseAIDefaultConfig(),
      model: AxAIBedrockModel.ClaudeSonnet5,
      region,
      fallbackRegions,
      gptRegion,
      gptFallbackRegions,
      ...config,
    };

    const aiImpl = new AxAIBedrockImpl(
      fullConfig,
      region,
      fallbackRegions,
      gptRegion,
      gptFallbackRegions
    );

    const supportFor = (model: AxAIBedrockModel): AxAIFeatures => {
      const capabilities = axGetBedrockModelCapabilities(model);
      return {
        functions: capabilities.functions,
        streaming: capabilities.streaming,
        functionCot: capabilities.functionCot,
        hasThinkingBudget: capabilities.thinking === 'budget',
        hasShowThoughts: capabilities.showThoughts,
        structuredOutputs:
          capabilities.structuredOutputModes.includes('native'),
        structuredOutputModes: capabilities.structuredOutputModes,
        media: {
          images: {
            supported: capabilities.images,
            formats: capabilities.images ? Object.keys(IMAGE_FORMATS) : [],
            maxSize: capabilities.images ? 3.75 * 1024 * 1024 : 0,
            detailLevels: capabilities.images ? ['high', 'low', 'auto'] : [],
          },
          audio: { supported: false, formats: [] },
          files: {
            supported: capabilities.files,
            formats: capabilities.files ? Object.keys(DOCUMENT_FORMATS) : [],
            maxSize: capabilities.files ? 4.5 * 1024 * 1024 : 0,
            uploadMethod: capabilities.files ? 'inline' : 'none',
          },
          urls: {
            supported: false,
            webSearch: false,
            contextFetching: false,
          },
        },
        caching: {
          supported: capabilities.cacheTTLs.length > 0,
          types: capabilities.cacheTTLs.length ? ['ephemeral'] : [],
          cacheBreakpoints: true,
        },
        thinking: capabilities.thinking !== 'none',
        multiTurn: true,
        serviceTiers: capabilities.serviceTiers,
      };
    };

    super(aiImpl, {
      name: 'Bedrock',
      apiURL: '',
      headers: async () => ({}),
      modelInfo: axModelInfoBedrock,
      defaults: {
        model: fullConfig.model,
        embedModel: fullConfig.embedModel,
      },
      options,
      supportFor,
    });
  }
}

export type { AxAIBedrockConfig } from './types.js';
export { AxAIBedrockEmbedModel, AxAIBedrockModel } from './types.js';
