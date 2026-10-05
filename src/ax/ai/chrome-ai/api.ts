import type { AxAPI } from '../../util/apicall.js';
import { AxBaseAI } from '../base.js';
import type {
  AxAIInputModelList,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatResponse,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxTokenUsage,
} from '../types.js';

import { axModelInfoChromeAI } from './info.js';
import {
  type AxAIChromeAIChatRequest,
  type AxAIChromeAIChatResponse,
  type AxAIChromeAIChatResponseDelta,
  type AxAIChromeAIConfig,
  type AxAIChromeAIEmbedModel,
  type AxAIChromeAIEmbedRequest,
  type AxAIChromeAIEmbedResponse,
  AxAIChromeAIModel,
  type AxAIChromeAIModelId,
  type ChromeAILanguageModel,
  type ChromeAIPromptOptions,
  type ChromeAISession,
} from './types.js';

export const axAIChromeAIDefaultConfig = (): AxAIChromeAIConfig =>
  structuredClone({
    model: AxAIChromeAIModel.GeminiNano,
  });

export const axAIChromeAICreativeConfig = (): AxAIChromeAIConfig =>
  structuredClone({
    model: AxAIChromeAIModel.GeminiNano,
    temperature: 0.4,
  });

export interface AxAIChromeAIArgs<TModelKey = string> {
  name: 'chrome-ai';
  languageModel?: ChromeAILanguageModel;
  config?: Readonly<Partial<AxAIChromeAIConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  models?: AxAIInputModelList<
    AxAIChromeAIModelId,
    AxAIChromeAIEmbedModel,
    TModelKey
  >;
}

/**
 * Gets the LanguageModel API from caller options or the global scope.
 * Works in Chrome 138+ where the API is available on globalThis (or window.ai).
 */
function getLanguageModelAPI(
  supplied?: ChromeAILanguageModel
): ChromeAILanguageModel {
  if (supplied) {
    return supplied;
  }
  const g = globalThis as unknown as {
    LanguageModel?: ChromeAILanguageModel;
    ai?: { languageModel?: ChromeAILanguageModel };
  };
  const lm = g.LanguageModel ?? g.ai?.languageModel;
  if (!lm) {
    throw new Error(
      'Chrome built-in AI (LanguageModel) is not available. ' +
        'Requires Chrome 138+ with the Prompt API enabled.'
    );
  }
  return lm;
}

/**
 * Safely destroys or closes a ChromeAISession.
 */
function destroySession(session: ChromeAISession): void {
  try {
    if (typeof session.destroy === 'function') {
      session.destroy();
    } else if (typeof session.close === 'function') {
      session.close();
    }
  } catch {
    // Ignore cleanup error
  }
}

export class AxAIChromeAIImpl
  implements
    AxAIServiceImpl<
      AxAIChromeAIModelId,
      AxAIChromeAIEmbedModel,
      AxAIChromeAIChatRequest,
      AxAIChromeAIEmbedRequest,
      AxAIChromeAIChatResponse,
      AxAIChromeAIChatResponseDelta,
      AxAIChromeAIEmbedResponse
    >
{
  private tokensUsed: AxTokenUsage | undefined;
  private readonly suppliedLanguageModel?: ChromeAILanguageModel;

  constructor(
    private config: AxAIChromeAIConfig,
    languageModel?: ChromeAILanguageModel
  ) {
    this.suppliedLanguageModel = languageModel;
  }

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed;
  }

  getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topK: config.topK,
      stream: config.stream,
    } as AxModelConfig;
  }

  createChatReq(
    req: Readonly<AxInternalChatRequest<AxAIChromeAIModelId>>,
    options?: Readonly<AxAIServiceOptions>
  ): [AxAPI, AxAIChromeAIChatRequest] {
    const model = req.model;

    // Separate system prompt and build initialPrompts for multi-turn context
    const initialPrompts: AxAIChromeAIChatRequest['initialPrompts'] = [];
    let lastUserMessage = '';

    for (let i = 0; i < req.chatPrompt.length; i++) {
      const msg = req.chatPrompt[i];
      const isLastMessage = i === req.chatPrompt.length - 1;

      if (msg.role === 'system') {
        initialPrompts.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'user') {
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .map((part) => {
              if (part.type === 'text') return part.text;
              if (part.type === 'image') {
                return part.altText ?? `[Image: ${part.mimeType}]`;
              }
              if (part.type === 'audio') {
                return (
                  part.transcription ??
                  `[Audio: ${part.mimeType ?? 'application/octet-stream'}]`
                );
              }
              if (part.type === 'url') {
                return (
                  part.cachedContent ??
                  [part.title, part.description, part.url]
                    .filter(Boolean)
                    .join('\n')
                );
              }
              return (
                part.extractedText ??
                `[File: ${part.filename ?? 'file'} (${part.mimeType})]`
              );
            })
            .join('\n');
        }

        if (isLastMessage) {
          lastUserMessage = content;
        } else {
          initialPrompts.push({ role: 'user', content });
        }
      } else if (msg.role === 'assistant') {
        const content = msg.content || '';
        initialPrompts.push({ role: 'assistant', content });
      } else if (msg.role === 'function') {
        // Chrome AI doesn't support function calling directly.
        // Include tool results as assistant context for continuity.
        const content = msg.content?.length
          ? msg.content
              .map((part) => {
                if (part.type === 'text') return part.text;
                if (part.type === 'image') {
                  return part.altText ?? `[Image: ${part.mimeType}]`;
                }
                if (part.type === 'audio') {
                  return (
                    part.transcription ??
                    `[Audio: ${part.mimeType ?? 'application/octet-stream'}]`
                  );
                }
                if (part.type === 'url') {
                  return (
                    part.cachedContent ??
                    [part.title, part.description, part.url]
                      .filter(Boolean)
                      .join('\n')
                  );
                }
                return (
                  part.extractedText ??
                  `[File: ${part.filename ?? 'file'} (${part.mimeType})]`
                );
              })
              .join('\n')
          : typeof msg.result === 'string'
            ? msg.result
            : JSON.stringify(msg.result);
        initialPrompts.push({ role: 'assistant', content });
      }
    }

    if (!lastUserMessage && req.chatPrompt.length > 0) {
      const lastMsg = req.chatPrompt[req.chatPrompt.length - 1];
      if (lastMsg.role !== 'user') {
        lastUserMessage = '';
      }
    }

    // Map responseFormat to Chrome AI's responseConstraint
    let responseConstraint: object | undefined;
    if (req.responseFormat?.schema) {
      if (typeof req.responseFormat.schema === 'string') {
        try {
          responseConstraint = JSON.parse(req.responseFormat.schema);
        } catch {
          // If parsing fails, skip the constraint
        }
      } else if (
        typeof req.responseFormat.schema === 'object' &&
        req.responseFormat.schema !== null
      ) {
        responseConstraint =
          (req.responseFormat.schema as { schema?: object }).schema ||
          (req.responseFormat.schema as object);
      }
    }

    const apiConfig = {
      name: '/prompt',
      localCall: async <TRequest, TResponse>(
        data: TRequest,
        stream?: boolean
      ): Promise<TResponse | ReadableStream<TResponse>> => {
        const reqData = data as unknown as AxAIChromeAIChatRequest;
        const languageModel = getLanguageModelAPI(this.suppliedLanguageModel);

        if (typeof languageModel.availability === 'function') {
          const availability = await languageModel.availability();
          if (availability === 'unavailable' || availability === 'no') {
            throw new Error(
              'Chrome built-in AI model is not available on this device.'
            );
          }
        } else if (typeof languageModel.capabilities === 'function') {
          const caps = await languageModel.capabilities();
          if (caps.available === 'no' || caps.available === 'unavailable') {
            throw new Error(
              'Chrome built-in AI model is not available on this device.'
            );
          }
        }

        let { temperature, topK } = reqData;
        if ((temperature === undefined) !== (topK === undefined)) {
          const params = languageModel.params
            ? await languageModel.params()
            : await languageModel.capabilities?.();
          temperature ??= params?.defaultTemperature;
          topK ??= params?.defaultTopK;
          if (temperature === undefined || topK === undefined) {
            throw new Error(
              'Chrome AI sampling requires both temperature and topK, or neither. ' +
                'Supply both values or use a Chrome extension with LanguageModel.params().'
            );
          }
        }

        const session = await languageModel.create({
          ...(reqData.initialPrompts.length > 0
            ? { initialPrompts: reqData.initialPrompts }
            : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(topK !== undefined ? { topK } : {}),
          signal: options?.abortSignal,
        });

        let streamOwnsSession = false;
        try {
          const promptOptions: ChromeAIPromptOptions = {
            ...(reqData.responseConstraint
              ? { responseConstraint: reqData.responseConstraint }
              : {}),
            ...(options?.abortSignal ? { signal: options.abortSignal } : {}),
          };

          const hasPromptOptions = Object.keys(promptOptions).length > 0;

          if (stream) {
            const result = this.handleStreaming(
              session,
              reqData.prompt,
              hasPromptOptions ? promptOptions : undefined
            );
            streamOwnsSession = true;
            return result as TResponse | ReadableStream<TResponse>;
          }

          const content = await session.prompt(
            reqData.prompt,
            hasPromptOptions ? promptOptions : undefined
          );

          const response: AxAIChromeAIChatResponse = {
            id: `chrome-ai-${Date.now()}`,
            content,
            finishReason: 'stop',
          };

          return response as TResponse | ReadableStream<TResponse>;
        } finally {
          if (!streamOwnsSession) {
            destroySession(session);
          }
        }
      },
    };

    const reqValue: AxAIChromeAIChatRequest = {
      model,
      initialPrompts,
      prompt: lastUserMessage,
      ...(responseConstraint ? { responseConstraint } : {}),
      ...(req.modelConfig?.temperature !== undefined
        ? { temperature: req.modelConfig.temperature }
        : this.config.temperature !== undefined
          ? { temperature: this.config.temperature }
          : {}),
      ...(req.modelConfig?.topK !== undefined
        ? { topK: req.modelConfig.topK }
        : this.config.topK !== undefined
          ? { topK: this.config.topK }
          : {}),
      stream: req.modelConfig?.stream ?? this.config.stream,
    };

    return [apiConfig, reqValue];
  }

  /**
   * Handle streaming from Chrome AI's promptStreaming().
   * Wraps ReadableStream or AsyncIterable into AxAIChromeAIChatResponseDelta chunks.
   */
  private handleStreaming(
    session: ChromeAISession,
    prompt: string,
    options?: ChromeAIPromptOptions
  ): ReadableStream<AxAIChromeAIChatResponseDelta> {
    const id = `chrome-ai-${Date.now()}`;
    const rawStream = session.promptStreaming(prompt, options);

    let sessionDestroyed = false;
    const cleanup = () => {
      if (!sessionDestroyed) {
        sessionDestroyed = true;
        destroySession(session);
      }
    };

    if (
      rawStream &&
      typeof (rawStream as ReadableStream<string>).getReader === 'function'
    ) {
      const reader = (rawStream as ReadableStream<string>).getReader();

      return new ReadableStream<AxAIChromeAIChatResponseDelta>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();

            if (done) {
              cleanup();
              controller.close();
              return;
            }

            const delta: AxAIChromeAIChatResponseDelta = {
              id,
              content: value ?? '',
              done: false,
            };

            controller.enqueue(delta);
          } catch (error) {
            cleanup();
            controller.error(error);
          }
        },
        cancel() {
          cleanup();
        },
      });
    }

    if (
      rawStream &&
      typeof (rawStream as AsyncIterable<string>)[Symbol.asyncIterator] ===
        'function'
    ) {
      const iterator = (rawStream as AsyncIterable<string>)[
        Symbol.asyncIterator
      ]();

      return new ReadableStream<AxAIChromeAIChatResponseDelta>({
        async pull(controller) {
          try {
            const { done, value } = await iterator.next();

            if (done) {
              cleanup();
              controller.close();
              return;
            }

            const delta: AxAIChromeAIChatResponseDelta = {
              id,
              content: value ?? '',
              done: false,
            };

            controller.enqueue(delta);
          } catch (error) {
            cleanup();
            controller.error(error);
          }
        },
        cancel() {
          cleanup();
        },
      });
    }

    throw new Error('Chrome AI promptStreaming did not return a valid stream');
  }

  createEmbedReq = (
    _req: Readonly<AxInternalEmbedRequest<AxAIChromeAIEmbedModel>>
  ): [AxAPI, AxAIChromeAIEmbedRequest] => {
    throw new Error('Chrome AI does not support embeddings');
  };

  createChatResp = (
    resp: Readonly<AxAIChromeAIChatResponse>
  ): AxChatResponse => {
    const results = [
      {
        index: 0,
        id: resp.id,
        content: resp.content,
        finishReason: resp.finishReason,
      },
    ];

    return { results, remoteId: resp.id };
  };

  createChatStreamResp = (
    resp: Readonly<AxAIChromeAIChatResponseDelta>,
    _state: object
  ): AxChatResponse => {
    const finishReason = resp.done ? ('stop' as const) : undefined;

    const results = [
      {
        index: 0,
        id: resp.id,
        content: resp.content,
        finishReason,
      },
    ];

    return { results, remoteId: resp.id };
  };

  createEmbedResp(_resp: Readonly<AxAIChromeAIEmbedResponse>): AxEmbedResponse {
    throw new Error('Chrome AI does not support embeddings');
  }
}

/**
 * AxAIChromeAI: Adapter for Chrome's built-in AI (Prompt API)
 *
 * Chrome ships with Gemini Nano, accessible via the LanguageModel API.
 * This adapter enables ax-llm to use Chrome's built-in model for
 * chat completions with structured output support.
 *
 * Key characteristics:
 * - TypeScript/JavaScript only, running inside Chrome (not an AxIR provider)
 * - No API key required — runs locally
 * - Supports structured outputs via responseConstraint (JSON schema)
 * - No function/tool calling support
 * - No embeddings support
 * - Fresh session per request (no context leakage)
 *
 * @example
 * ```typescript
 * const chromeAI = ai({ name: 'chrome-ai' });
 * const gen = ax('question -> answer');
 * const result = await gen.forward(chromeAI, { question: 'What is 2+2?' });
 * ```
 */
export class AxAIChromeAI<TModelKey = AxAIChromeAIModelId> extends AxBaseAI<
  AxAIChromeAIModelId,
  AxAIChromeAIEmbedModel,
  AxAIChromeAIChatRequest,
  AxAIChromeAIEmbedRequest,
  AxAIChromeAIChatResponse,
  AxAIChromeAIChatResponseDelta,
  AxAIChromeAIEmbedResponse,
  TModelKey
> {
  constructor({
    languageModel,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIChromeAIArgs<TModelKey>, 'name'>> = {}) {
    const Config = {
      ...axAIChromeAIDefaultConfig(),
      ...config,
    };

    const aiImpl = new AxAIChromeAIImpl(Config, languageModel);

    super(aiImpl, {
      name: 'ChromeAI',
      apiURL: undefined, // No URL needed for local inference
      headers: async () => ({}), // No headers needed
      modelInfo: axModelInfoChromeAI,
      defaults: { model: Config.model },
      supportFor: (_model: AxAIChromeAIModelId) => ({
        functions: false, // Chrome AI doesn't support function/tool calling
        streaming: true,
        structuredOutputs: true,
        structuredOutputModes: ['native'] as const,
        hasThinkingBudget: false,
        hasShowThoughts: false,
        media: {
          images: {
            supported: false,
            formats: [],
          },
          audio: {
            supported: false,
            formats: [],
          },
          files: {
            supported: false,
            formats: [],
            uploadMethod: 'none' as const,
          },
          urls: {
            supported: false,
            webSearch: false,
            contextFetching: false,
          },
        },
        caching: {
          supported: false,
          types: [],
        },
        thinking: false,
        multiTurn: true,
      }),
      options,
      models,
    });
  }
}
