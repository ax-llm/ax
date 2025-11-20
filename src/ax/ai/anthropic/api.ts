import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxAIRefusalError } from '../../util/apicall.js';
import { AxBaseAI, axBaseAIDefaultConfig } from '../base.js';
import type {
  AxAIInputModelList,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxInternalChatRequest,
  AxModelConfig,
  AxTokenUsage,
} from '../types.js';
import { axModelInfoAnthropic } from './info.js';
import {
  type AxAIAnthropicChatError,
  type AxAIAnthropicChatRequest,
  type AxAIAnthropicChatResponse,
  type AxAIAnthropicChatResponseDelta,
  type AxAIAnthropicConfig,
  type AxAIAnthropicContentBlockDeltaEvent,
  type AxAIAnthropicContentBlockStartEvent,
  type AxAIAnthropicErrorEvent,
  type AxAIAnthropicMessageDeltaEvent,
  type AxAIAnthropicMessageStartEvent,
  AxAIAnthropicModel,
  type AxAIAnthropicThinkingConfig,
  AxAIAnthropicVertexModel,
} from './types.js';

/**
 * Clean function schema for Anthropic API compatibility
 * Anthropic uses input_schema and may not support certain JSON Schema fields
 */
const cleanSchemaForAnthropic = (schema: any): any => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const cleaned = { ...schema };

  // Remove fields that might cause issues with Anthropic
  delete cleaned.additionalProperties;
  delete cleaned.default;
  delete cleaned.optional;
  delete cleaned.oneOf;
  delete cleaned.anyOf;
  delete cleaned.allOf;

  // Recursively clean properties
  if (cleaned.properties && typeof cleaned.properties === 'object') {
    cleaned.properties = Object.fromEntries(
      Object.entries(cleaned.properties).map(([key, value]) => [
        key,
        cleanSchemaForAnthropic(value),
      ])
    );
  }

  // Recursively clean items (for arrays)
  if (cleaned.items) {
    cleaned.items = cleanSchemaForAnthropic(cleaned.items);
  }

  return cleaned;
};

export const axAIAnthropicDefaultConfig = (): AxAIAnthropicConfig =>
  structuredClone({
    model: AxAIAnthropicModel.Claude37Sonnet,
    maxTokens: 40000, // Ensure maxTokens is higher than highest thinking budget
    thinkingTokenBudgetLevels: {
      minimal: 1024,
      low: 5000,
      medium: 10000,
      high: 20000,
      highest: 32000,
    },
    ...axBaseAIDefaultConfig(),
  });

export const axAIAnthropicVertexDefaultConfig = (): AxAIAnthropicConfig =>
  structuredClone({
    model: AxAIAnthropicVertexModel.Claude37Sonnet,
    maxTokens: 40000, // Ensure maxTokens is higher than highest thinking budget
    thinkingTokenBudgetLevels: {
      minimal: 1024,
      low: 5000,
      medium: 10000,
      high: 20000,
      highest: 32000,
    },
    ...axBaseAIDefaultConfig(),
  });

// Helper type to extract model keys from the models array
type ExtractModelKeys<T> = T extends readonly { key: infer K }[] ? K : never;

export interface AxAIAnthropicArgs<TModelKey = string> {
  name: 'anthropic';
  apiKey?: string | (() => Promise<string>);
  projectId?: string;
  region?: string;
  config?: Readonly<Partial<AxAIAnthropicConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  models?: AxAIInputModelList<
    AxAIAnthropicModel | AxAIAnthropicVertexModel,
    undefined,
    TModelKey
  >;
}

class AxAIAnthropicImpl
  implements
    AxAIServiceImpl<
      AxAIAnthropicModel | AxAIAnthropicVertexModel,
      unknown,
      AxAIAnthropicChatRequest,
      unknown,
      AxAIAnthropicChatResponse,
      AxAIAnthropicChatResponseDelta,
      unknown
    >
{
  private tokensUsed: AxTokenUsage | undefined;
  private currentPromptConfig?: AxAIServiceOptions;
  private usedStructuredOutput: boolean = false;

  constructor(
    private config: AxAIAnthropicConfig,
    private isVertex: boolean
  ) {}

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed;
  }

  getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stream: config.stream,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      n: config.n,
    } as AxModelConfig;
  }

  createChatReq = async (
    req: Readonly<
      AxInternalChatRequest<AxAIAnthropicModel | AxAIAnthropicVertexModel>
    >,
    config: Readonly<AxAIServiceOptions>
  ): Promise<[AxAPI, AxAIAnthropicChatRequest]> => {
    // Store config for use in response methods
    this.currentPromptConfig = config;

    const model = req.model;
    const stream = req.modelConfig?.stream ?? this.config.stream;

    let apiConfig: AxAPI;
    if (this.isVertex) {
      apiConfig = {
        name: stream
          ? `/models/${model}:streamRawPredict?alt=sse`
          : `/models/${model}:rawPredict`,
      };
    } else {
      apiConfig = {
        name: '/messages',
      };
    }

    let toolsChoice:
      | { tool_choice: { type: 'auto' | 'any' | 'tool'; name?: string } }
      | undefined;

    if (req.functionCall && req.functions && req.functions.length > 0) {
      if (typeof req.functionCall === 'string') {
        switch (req.functionCall) {
          case 'auto':
            toolsChoice = { tool_choice: { type: 'auto' as const } };
            break;
          case 'required':
            toolsChoice = { tool_choice: { type: 'any' as const } };
            break;
          case 'none':
            throw new Error('functionCall none not supported');
        }
      } else if ('function' in req.functionCall) {
        toolsChoice = {
          tool_choice: {
            type: 'tool' as const,
            name: req.functionCall.function.name,
          },
        };
      } else {
        throw new Error('Invalid function call type, must be string or object');
      }
    }

    const system = req.chatPrompt
      .filter((msg) => msg.role === 'system')
      .map((msg) => ({
        type: 'text' as const,
        text: msg.content,
        ...(msg.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));

    const otherMessages = req.chatPrompt.filter((msg) => msg.role !== 'system');

    // Compose tools from request function definitions and static config tools
    const functionToolsFromReq: AxAIAnthropicChatRequest['tools'] | undefined =
      req.functions?.map((v) => {
        const dummyParameters = {
          type: 'object',
          properties: {
            dummy: {
              type: 'string',
              description: 'An optional dummy parameter, do not use',
            },
          },
          required: [],
        } as const;

        let input_schema = v.parameters
          ? cleanSchemaForAnthropic(v.parameters)
          : undefined;

        if (
          input_schema === undefined ||
          (input_schema &&
            typeof input_schema === 'object' &&
            Object.keys(input_schema).length === 0)
        ) {
          input_schema = { ...dummyParameters } as any;
        } else if (
          input_schema &&
          typeof input_schema === 'object' &&
          (input_schema as any).type === 'object' &&
          (!('properties' in (input_schema as any)) ||
            !(input_schema as any).properties ||
            Object.keys((input_schema as any).properties).length === 0)
        ) {
          input_schema = {
            ...(input_schema as any),
            properties: {
              dummy: {
                type: 'string',
                description: 'An optional dummy parameter, do not use',
              },
            },
            required: [],
          } as any;
        }

        return {
          name: v.name,
          description: v.description,
          input_schema,
        };
      });

    const configToolsRaw = this.config.tools ?? [];
    const configToolsCleaned: AxAIAnthropicChatRequest['tools'] =
      configToolsRaw.map((tool: any) => {
        if (tool && typeof tool === 'object' && 'type' in tool) {
          // Server tools (e.g., web_search) are passed through as-is
          return tool;
        }
        // Function-style tools: ensure input_schema is cleaned
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema
            ? cleanSchemaForAnthropic(tool.input_schema)
            : undefined,
          ...(tool.cache_control ? { cache_control: tool.cache_control } : {}),
        };
      });

    let tools: AxAIAnthropicChatRequest['tools'] | undefined = [
      ...(functionToolsFromReq ?? []),
      ...configToolsCleaned,
    ];

    // Anthropic Vertex does not support server tools like web_search; filter them out
    if (this.isVertex && tools.length > 0) {
      tools = tools.filter(
        (t: any) => !(t && typeof t === 'object' && 'type' in t)
      );
    }
    if (tools.length === 0) {
      tools = undefined;
    }

    const maxTokens = req.modelConfig?.maxTokens ?? this.config.maxTokens;
    const stopSequences =
      req.modelConfig?.stopSequences ?? this.config.stopSequences;
    const temperature = req.modelConfig?.temperature;
    const topP = req.modelConfig?.topP; // do not fallback to config by default
    const topK = req.modelConfig?.topK ?? this.config.topK;
    const n = req.modelConfig?.n ?? this.config.n;

    if (n && n > 1) {
      throw new Error('Anthropic does not support sampling (n > 1)');
    }

    // Handle thinking configuration
    let thinkingConfig: AxAIAnthropicThinkingConfig | undefined;

    if (this.config.thinking?.budget_tokens) {
      thinkingConfig = this.config.thinking;
    }

    // Override based on prompt-specific config
    if (config?.thinkingTokenBudget) {
      const levels = this.config.thinkingTokenBudgetLevels;

      switch (config.thinkingTokenBudget) {
        case 'none':
          // When thinkingTokenBudget is 'none', disable thinking entirely
          thinkingConfig = undefined;
          break;
        case 'minimal':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.minimal ?? 1024,
          };
          break;
        case 'low':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.low ?? 5000,
          };
          break;
        case 'medium':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.medium ?? 10000,
          };
          break;
        case 'high':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.high ?? 20000,
          };
          break;
        case 'highest':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.highest ?? 32000,
          };
          break;
      }
    }

    // If per-call options selected a model via key that mapped numeric budget to a level,
    // map that level into concrete budget here when not provided via thinkingTokenBudget.
    if (!thinkingConfig && (config as any)?.thinkingTokenBudget === undefined) {
      const _levels = this.config.thinkingTokenBudgetLevels;
      // No-op: rely on defaults
    }

    const messages = createMessages(otherMessages, !!thinkingConfig);

    // If the outgoing messages include an assistant message that starts with a tool_use
    // block (i.e., we are pre-supplying a function call), Anthropic requires the final
    // assistant message to start with a thinking/redacted_thinking block when thinking
    // is enabled. Since we do not have a prior thinking block to echo here, disable thinking
    // for this request to comply with their requirement.
    const hasAssistantStartingWithToolUse = messages.some(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.length > 0 &&
        (m.content[0] as any)?.type === 'tool_use'
    );
    if (hasAssistantStartingWithToolUse) {
      thinkingConfig = undefined;
    }

    // Handle structured output using native output_format parameter
    let outputFormat: { type: 'json_schema'; schema: any } | undefined;
    this.usedStructuredOutput = false;
    if (req.responseFormat) {
      if (
        req.responseFormat.type === 'json_schema' &&
        req.responseFormat.schema
      ) {
        // Anthropic supports structured output natively via output_format parameter
        const schema =
          req.responseFormat.schema.schema || req.responseFormat.schema;

        outputFormat = {
          type: 'json_schema',
          schema: cleanSchemaForAnthropic(schema),
        };
        this.usedStructuredOutput = true;
      }
    }

    const reqValue: AxAIAnthropicChatRequest = {
      ...(this.isVertex
        ? { anthropic_version: 'vertex-2023-10-16' }
        : { model }),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(stopSequences && stopSequences.length > 0
        ? { stop_sequences: stopSequences }
        : {}),
      // Only include temperature when thinking is not enabled
      ...(temperature !== undefined && !thinkingConfig ? { temperature } : {}),
      // Only include top_p when thinking is not enabled, or when it's >= 0.95
      ...(topP !== undefined && (!thinkingConfig || topP >= 0.95)
        ? { top_p: topP }
        : {}),
      // Only include top_k when thinking is not enabled
      ...(topK && !thinkingConfig ? { top_k: topK } : {}),
      ...toolsChoice,
      ...(tools ? { tools } : {}),
      ...(stream ? { stream: true } : {}),
      ...(system ? { system } : {}),
      ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
      ...(outputFormat ? { output_format: outputFormat } : {}),
      messages,
    };

    return [apiConfig, reqValue];
  };

  createChatResp = (
    resp: Readonly<AxAIAnthropicChatResponse | AxAIAnthropicChatError>
  ): AxChatResponse => {
    if (resp.type === 'error') {
      // Use AxAIRefusalError for authentication and API errors that could be refusal-related
      throw new AxAIRefusalError(
        resp.error.message,
        undefined, // model not specified in error response
        undefined // requestId not specified in error response
      );
    }

    const finishReason = mapFinishReason(resp.stop_reason);

    // Determine if thoughts should be shown
    const showThoughts =
      this.currentPromptConfig?.thinkingTokenBudget !== 'none' &&
      this.currentPromptConfig?.showThoughts !== false;

    // Aggregate all content blocks into a single result to avoid mixing
    // thinking text into the normal content while still exposing function calls.
    let aggregatedContent = '';
    let aggregatedThought = '';
    let anyRedacted = false;
    let lastSignature: string | undefined;
    const aggregatedFunctionCalls: NonNullable<
      AxChatResponseResult['functionCalls']
    > = [];

    // Collect citations from text blocks (citations are embedded here)
    const citations: NonNullable<AxChatResponseResult['citations']> = [];

    for (const block of resp.content) {
      switch (block.type) {
        case 'text':
          aggregatedContent += block.text ?? '';
          // Map citations if present on the text block
          if (Array.isArray((block as any).citations)) {
            for (const c of (block as any).citations) {
              if (c?.url) {
                citations.push({
                  url: String(c.url),
                  title: typeof c.title === 'string' ? c.title : undefined,
                  snippet:
                    typeof c.cited_text === 'string' ? c.cited_text : undefined,
                });
              }
            }
          }
          break;
        case 'thinking':
        case 'redacted_thinking':
          if (showThoughts) {
            aggregatedThought +=
              (block as any).thinking ?? (block as any).data ?? '';
          }
          if (block.type === 'redacted_thinking') anyRedacted = true;
          if (typeof (block as any).signature === 'string') {
            lastSignature = (block as any).signature as string;
          }
          break;
        case 'tool_use':
          aggregatedFunctionCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, params: block.input },
          });
          break;
      }
    }

    const result: AxChatResponseResult = {
      index: 0,
      id: resp.id,
      finishReason,
    };

    if (aggregatedContent) {
      result.content = aggregatedContent;
    }
    if (aggregatedThought) {
      result.thought = aggregatedThought;
      result.thoughtBlock = {
        data: aggregatedThought,
        encrypted: anyRedacted,
        ...(lastSignature ? { signature: lastSignature } : {}),
      };
    }
    if (aggregatedFunctionCalls.length > 0) {
      result.functionCalls = aggregatedFunctionCalls;
    }

    // When using native structured outputs via output_format parameter,
    // the JSON response is returned in text content (not as a function call).
    // The text content is guaranteed to be valid JSON matching the schema.
    // The framework's processResponse will parse this JSON content automatically.
    if (citations.length > 0) {
      result.citations = citations;
    }

    const results = [result];

    this.tokensUsed = {
      promptTokens: resp.usage.input_tokens,
      completionTokens: resp.usage.output_tokens,
      totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
      cacheCreationTokens: resp.usage.cache_creation_input_tokens,
      cacheReadTokens: resp.usage.cache_read_input_tokens,
    };

    return { results, remoteId: resp.id };
  };

  createChatStreamResp = (
    resp: Readonly<AxAIAnthropicChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    if (!('type' in resp)) {
      throw new Error('Invalid Anthropic streaming event');
    }

    const sstate = state as {
      indexIdMap: Record<number, string>;
    };

    if (!sstate.indexIdMap) {
      sstate.indexIdMap = {};
    }

    if (resp.type === 'error') {
      const { error } = resp as unknown as AxAIAnthropicErrorEvent;
      throw new AxAIRefusalError(
        error.message,
        undefined, // model not specified in error event
        undefined // requestId not specified in error event
      );
    }

    const index = 0;

    if (resp.type === 'message_start') {
      const { message } = resp as unknown as AxAIAnthropicMessageStartEvent;
      const results = [{ index, content: '', id: message.id }];

      this.tokensUsed = {
        promptTokens: message.usage?.input_tokens ?? 0,
        completionTokens: message.usage?.output_tokens ?? 0,
        totalTokens:
          (message.usage?.input_tokens ?? 0) +
          (message.usage?.output_tokens ?? 0),
      };
      return { results };
    }

    if (resp.type === 'content_block_start') {
      const { content_block: contentBlock } =
        resp as unknown as AxAIAnthropicContentBlockStartEvent;

      if (contentBlock.type === 'text') {
        const annos: NonNullable<AxChatResponseResult['citations']> = [];
        if (Array.isArray((contentBlock as any).citations)) {
          for (const c of (contentBlock as any).citations) {
            if (c?.url) {
              annos.push({
                url: String(c.url),
                title: typeof c.title === 'string' ? c.title : undefined,
                snippet:
                  typeof c.cited_text === 'string' ? c.cited_text : undefined,
              });
            }
          }
        }
        return {
          results: [
            {
              index,
              content: contentBlock.text,
              ...(annos.length ? { citations: annos } : {}),
            },
          ],
        };
      }
      if (contentBlock.type === 'thinking') {
        // Determine if thoughts should be shown
        const showThoughts =
          this.currentPromptConfig?.thinkingTokenBudget !== 'none' &&
          this.currentPromptConfig?.showThoughts !== false;
        if (showThoughts) {
          return {
            results: [
              {
                index,
                thought: contentBlock.thinking,
                thoughtBlock: {
                  data: contentBlock.thinking,
                  encrypted: false,
                },
              },
            ],
          };
        }
        return {
          results: [{ index, content: '' }],
        };
      }
      if (contentBlock.type === 'tool_use') {
        if (
          typeof contentBlock.id === 'string' &&
          typeof resp.index === 'number' &&
          !sstate.indexIdMap[resp.index]
        ) {
          sstate.indexIdMap[resp.index] = contentBlock.id;
          const functionCalls = [
            {
              id: contentBlock.id,
              type: 'function' as const,
              function: {
                name: contentBlock.name,
                params: '',
              },
            },
          ];
          return {
            results: [{ index, functionCalls }],
          };
        }
      }
      if (
        contentBlock.type === 'web_search_tool_result' ||
        contentBlock.type === 'server_tool_use'
      ) {
        return {
          results: [{ index, content: '' }],
        };
      }
    }

    if (resp.type === 'content_block_delta') {
      const { delta } = resp as unknown as AxAIAnthropicContentBlockDeltaEvent;
      // Emit standalone annotations when Anthropic streams citations separately
      if ((delta as any).type === 'citations_delta') {
        const c = (delta as any).citation;
        if (c && typeof c.url === 'string' && c.url.length > 0) {
          const annos: NonNullable<AxChatResponseResult['citations']> = [
            {
              url: String(c.url),
              title: typeof c.title === 'string' ? c.title : undefined,
              snippet:
                typeof c.cited_text === 'string' ? c.cited_text : undefined,
            },
          ];
          return {
            results: [
              {
                index,
                content: '',
                citations: annos,
              },
            ],
          };
        }
        return { results: [{ index, content: '' }] };
      }
      if (delta.type === 'text_delta') {
        const annos: NonNullable<AxChatResponseResult['citations']> = [];
        if (Array.isArray((delta as any).citations)) {
          for (const c of (delta as any).citations) {
            if (c?.url) {
              annos.push({
                url: String(c.url),
                title: typeof c.title === 'string' ? c.title : undefined,
                snippet:
                  typeof c.cited_text === 'string' ? c.cited_text : undefined,
              });
            }
          }
        }
        return {
          results: [
            {
              index,
              content: delta.text,
              ...(annos.length ? { citations: annos } : {}),
            },
          ],
        };
      }
      if (delta.type === 'thinking_delta') {
        // Determine if thoughts should be shown
        const showThoughts =
          this.currentPromptConfig?.thinkingTokenBudget !== 'none' &&
          this.currentPromptConfig?.showThoughts !== false;
        if (showThoughts) {
          return {
            results: [
              {
                index,
                thought: delta.thinking,
                thoughtBlock: { data: delta.thinking, encrypted: false },
              },
            ],
          };
        }
        return {
          results: [{ index, content: '' }],
        };
      }
      if (delta.type === 'signature_delta') {
        // Signature deltas are handled internally by Anthropic,
        // we don't need to expose them in the response
        return {
          results: [{ index, content: '' }],
        };
      }
      if (delta.type === 'input_json_delta') {
        const id = sstate.indexIdMap[resp.index];
        if (!id) {
          return { results: [{ index, content: '' }] };
        }
        const functionCalls = [
          {
            id,
            type: 'function' as const,
            function: {
              name: '',
              params: delta.partial_json,
            },
          },
        ];
        return {
          results: [{ index, functionCalls }],
        };
      }
    }

    if (resp.type === 'message_delta') {
      const { delta, usage } =
        resp as unknown as AxAIAnthropicMessageDeltaEvent;

      this.tokensUsed = {
        promptTokens: 0,
        completionTokens: usage.output_tokens,
        totalTokens: usage.output_tokens,
      };

      const results = [
        {
          index,
          content: '',
          finishReason: mapFinishReason(delta.stop_reason),
        },
      ];
      return { results };
    }

    return {
      results: [{ index, content: '' }],
    };
  };
}

export class AxAIAnthropic<TModelKey = string> extends AxBaseAI<
  AxAIAnthropicModel | AxAIAnthropicVertexModel,
  unknown,
  AxAIAnthropicChatRequest,
  never,
  AxAIAnthropicChatResponse,
  AxAIAnthropicChatResponseDelta,
  never,
  TModelKey
> {
  // Static factory method for automatic type inference
  static create<const T extends AxAIAnthropicArgs<any>>(
    options: T
  ): T extends { models: infer M }
    ? AxAIAnthropic<ExtractModelKeys<M>>
    : AxAIAnthropic<string> {
    return new AxAIAnthropic(options) as any;
  }

  constructor({
    apiKey,
    projectId,
    region,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIAnthropicArgs<TModelKey>, 'name'>>) {
    const isVertex = projectId !== undefined && region !== undefined;

    let apiURL: string;
    let headers: () => Promise<Record<string, string>>;

    if (isVertex) {
      if (!apiKey) {
        throw new Error('Anthropic Vertex API key not set');
      }
      if (typeof apiKey !== 'function') {
        throw new Error(
          'Anthropic Vertex API key must be a function for token-based authentication'
        );
      }
      apiURL = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/anthropic/`;
      headers = async () => ({
        Authorization: `Bearer ${await apiKey()}`,
      });
    } else {
      if (!apiKey) {
        throw new Error('Anthropic API key not set');
      }
      apiURL = 'https://api.anthropic.com/v1';
      headers = async () => ({
        'anthropic-version': '2023-06-01',
        'anthropic-beta':
          'prompt-caching-2024-07-31,structured-outputs-2025-11-13',
        'x-api-key': typeof apiKey === 'function' ? await apiKey() : apiKey,
      });
    }

    const Config = {
      ...axAIAnthropicDefaultConfig(),
      ...config,
    };

    const aiImpl = new AxAIAnthropicImpl(Config, isVertex);

    const supportFor = (
      model: AxAIAnthropicModel | AxAIAnthropicVertexModel
    ) => {
      const mi = getModelInfo<
        AxAIAnthropicModel | AxAIAnthropicVertexModel,
        undefined,
        TModelKey
      >({
        model,
        modelInfo: axModelInfoAnthropic,
        models,
      });
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
        functionCot: true,
        media: {
          images: {
            supported: true,
            formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            maxSize: 5 * 1024 * 1024, // 5MB
            detailLevels: ['high', 'low', 'auto'] as (
              | 'high'
              | 'low'
              | 'auto'
            )[],
          },
          audio: {
            supported: false,
            formats: [],
            maxDuration: 0,
          },
          files: {
            supported: false,
            formats: [],
            maxSize: 0,
            uploadMethod: 'none' as 'inline' | 'upload' | 'cloud' | 'none',
          },
          urls: {
            supported: false,
            webSearch: false,
            contextFetching: false,
          },
        },
        caching: {
          supported: true,
          types: ['ephemeral'] as ('ephemeral' | 'persistent')[],
        },
        thinking: mi?.supported?.thinkingBudget ?? false,
        multiTurn: true,
      };
    };

    // Normalize per-model presets: allow provider-specific config on each model list item
    const normalizedModels = models?.map((item) => {
      const anyItem = item as any;
      const cfg = anyItem?.config as Partial<AxAIAnthropicConfig> | undefined;
      if (!cfg) return item;

      const modelConfig: Partial<AxModelConfig> = {};
      if (cfg.maxTokens !== undefined) modelConfig.maxTokens = cfg.maxTokens;
      if (cfg.temperature !== undefined)
        modelConfig.temperature = cfg.temperature;
      if (cfg.topP !== undefined) modelConfig.topP = cfg.topP as number;
      if (cfg.topK !== undefined) modelConfig.topK = cfg.topK as number;
      if (cfg.presencePenalty !== undefined)
        modelConfig.presencePenalty = cfg.presencePenalty as number;
      if (cfg.frequencyPenalty !== undefined)
        modelConfig.frequencyPenalty = cfg.frequencyPenalty as number;
      if (cfg.stopSequences !== undefined)
        modelConfig.stopSequences = cfg.stopSequences as string[];
      if ((cfg as any).endSequences !== undefined)
        (modelConfig as any).endSequences = (cfg as any).endSequences;
      if (cfg.stream !== undefined) modelConfig.stream = cfg.stream as boolean;
      if (cfg.n !== undefined) modelConfig.n = cfg.n as number;

      const out: any = { ...anyItem };
      if (Object.keys(modelConfig).length > 0) {
        out.modelConfig = { ...(anyItem.modelConfig ?? {}), ...modelConfig };
      }

      // Map numeric thinking budget to closest Ax level
      const numericBudget = cfg.thinking?.thinkingTokenBudget;
      if (typeof numericBudget === 'number') {
        const levels = Config.thinkingTokenBudgetLevels;
        const candidates = [
          ['minimal', levels?.minimal ?? 200],
          ['low', levels?.low ?? 800],
          ['medium', levels?.medium ?? 5000],
          ['high', levels?.high ?? 10000],
          ['highest', levels?.highest ?? 24500],
        ] as const;
        let bestName: 'minimal' | 'low' | 'medium' | 'high' | 'highest' =
          'minimal';
        let bestDiff = Number.POSITIVE_INFINITY;
        for (const [name, value] of candidates) {
          const diff = Math.abs(numericBudget - value);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestName = name as typeof bestName;
          }
        }
        out.thinkingTokenBudget = bestName;
      }
      if (cfg.thinking?.includeThoughts !== undefined) {
        out.showThoughts = !!cfg.thinking.includeThoughts;
      }

      return out as typeof item;
    });

    super(aiImpl, {
      name: 'Anthropic',
      apiURL,
      headers,
      modelInfo: axModelInfoAnthropic,
      defaults: { model: Config.model },
      options,
      supportFor,
      models: normalizedModels ?? models,
    });
  }
}

type AnthropicMsg = AxAIAnthropicChatRequest['messages'][0];
type AnthropicMsgRoleUser = Extract<AnthropicMsg, { role: 'user' }>;
type AnthropicMsgRoleUserToolResult = Extract<
  AnthropicMsgRoleUser['content'][0],
  { type: 'tool_result' }
>;

function createMessages(
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>,
  _thinkingEnabled?: boolean
): AxAIAnthropicChatRequest['messages'] {
  const items: AxAIAnthropicChatRequest['messages'] = chatPrompt.map((msg) => {
    switch (msg.role) {
      case 'function': {
        const content: AnthropicMsgRoleUserToolResult[] = [
          {
            type: 'tool_result' as const,
            content: msg.result,
            tool_use_id: msg.functionId,
            ...(msg.isError ? { is_error: true } : {}),
            ...(msg.cache ? { cache: { type: 'ephemeral' } } : {}),
          },
        ];

        return {
          role: 'user' as const,
          content,
        };
      }
      case 'user': {
        if (typeof msg.content === 'string') {
          return {
            role: 'user' as const,
            content: msg.content,
          };
        }
        const content = msg.content.map((v) => {
          switch (v.type) {
            case 'text':
              return {
                type: 'text' as const,
                text: v.text,
                ...(v.cache
                  ? { cache_control: { type: 'ephemeral' as const } }
                  : {}),
              };
            case 'image':
              return {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: v.mimeType,
                  data: v.image,
                },
                ...(v.cache
                  ? { cache_control: { type: 'ephemeral' as const } }
                  : {}),
              };
            default:
              throw new Error('Invalid content type');
          }
        });
        return {
          role: 'user' as const,
          content,
        };
      }
      case 'assistant': {
        let content: Extract<
          AxAIAnthropicChatRequest['messages'][0],
          { role: 'assistant' }
        >['content'] = '';

        // Preserve prior thinking blocks from memory when available
        const preservedThinkingBlocks: (
          | { type: 'thinking'; thinking: string; signature?: string }
          | { type: 'redacted_thinking'; data: string; signature?: string }
        )[] = [];
        const tb: any = (msg as any).thoughtBlock;
        if (tb && typeof tb.data === 'string' && tb.data.length > 0) {
          if (tb.encrypted) {
            preservedThinkingBlocks.push(
              tb.signature
                ? {
                    type: 'redacted_thinking',
                    data: tb.data,
                    signature: tb.signature,
                  }
                : { type: 'redacted_thinking', data: tb.data }
            );
          } else {
            preservedThinkingBlocks.push(
              tb.signature
                ? {
                    type: 'thinking',
                    thinking: tb.data,
                    signature: tb.signature,
                  }
                : { type: 'thinking', thinking: tb.data }
            );
          }
        }

        if (typeof msg.content === 'string') {
          // If we have preserved thinking, convert to block array and append text
          if (preservedThinkingBlocks.length > 0) {
            content = [
              ...preservedThinkingBlocks,
              { type: 'text' as const, text: msg.content },
            ];
          } else {
            content = msg.content;
          }
        }
        if (typeof msg.functionCalls !== 'undefined') {
          content = msg.functionCalls.map((v) => {
            let input: object = {};
            if (typeof v.function.params === 'string') {
              const raw = v.function.params;
              if (raw.trim().length === 0) {
                input = {};
              } else {
                try {
                  input = JSON.parse(raw);
                } catch {
                  throw new Error(
                    `Failed to parse function params JSON: ${raw}`
                  );
                }
              }
            } else if (typeof v.function.params === 'object') {
              input = v.function.params as object;
            }
            return {
              type: 'tool_use' as const,
              id: v.id,
              name: v.function.name,
              input,
              ...(msg.cache
                ? { cache_control: { type: 'ephemeral' as const } }
                : {}),
            };
          });
          if (Array.isArray(content) && preservedThinkingBlocks.length > 0) {
            content = [
              ...preservedThinkingBlocks,
              ...(content as Extract<
                AxAIAnthropicChatRequest['messages'][0],
                { role: 'assistant' }
              >['content'] as any[]),
            ];
          }
        }
        return {
          role: 'assistant' as const,
          content,
        };
      }
      default:
        throw new Error('Invalid role');
    }
  });

  const merged = mergeAssistantMessages(items);
  return trimAssistantStringContent(merged);
}

// Anthropic and some others need this in non-streaming mode
function mergeAssistantMessages(
  messages: Readonly<AxAIAnthropicChatRequest['messages']>
): AxAIAnthropicChatRequest['messages'] {
  const mergedMessages: AxAIAnthropicChatRequest['messages'] = [];

  for (const [i, cur] of messages.entries()) {
    // Continue if not an assistant message or first message
    if (cur.role !== 'assistant') {
      mergedMessages.push(cur);
      continue;
    }

    // Merge current message with the previous one if both are from the assistant
    if (i > 0 && messages.at(i - 1)?.role === 'assistant') {
      const lastMessage = mergedMessages.pop();

      mergedMessages.push({
        ...(lastMessage ? lastMessage : {}),
        ...cur,
      });
    } else {
      mergedMessages.push(cur);
    }
  }

  return mergedMessages;
}

function trimAssistantStringContent(
  messages: Readonly<AxAIAnthropicChatRequest['messages']>
): AxAIAnthropicChatRequest['messages'] {
  return messages.map((m) => {
    if (m.role === 'assistant' && typeof m.content === 'string') {
      return { ...m, content: m.content.replace(/\s+$/, '') };
    }
    return m;
  });
}

function mapFinishReason(
  stopReason?: AxAIAnthropicChatResponse['stop_reason'] | null
): AxChatResponse['results'][0]['finishReason'] | undefined {
  if (!stopReason) {
    return undefined;
  }
  switch (stopReason) {
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'function_call';
    case 'end_turn':
      return 'stop';
    default:
      return 'stop';
  }
}
