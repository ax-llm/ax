/**
 * AWS Bedrock Provider for AX Library
 *
 * Supports Claude, GPT OSS, and Titan Embed models for use with AX's
 * compiler, signatures, flows, and optimization features.
 *
 * Usage:
 *   const ai = new AxAIBedrock({
 *     region: 'us-east-2',
 *     config: { model: AxAIBedrockModel.ClaudeSonnet4 }
 *   });
 *
 *   const sig = new AxSignature('input -> output');
 *   const gen = new AxGen(sig, { ai });
 *   const result = await gen.forward({ input: 'test' });
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxAPI,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxTokenUsage,
} from '@ax-llm/ax';
import { type AxAIFeatures, AxBaseAI, axBaseAIDefaultConfig } from '@ax-llm/ax';
import { axModelInfoBedrock } from './info.js';
import {
  type AxAIBedrockConfig,
  type AxAIBedrockEmbedModel,
  AxAIBedrockModel,
  type BedrockChatRequest,
  type BedrockChatResponse,
  type BedrockClaudeRequest,
  type BedrockClaudeResponse,
  type BedrockGptRequest,
  type BedrockGptResponse,
  type BedrockTitanEmbedRequest,
  type BedrockTitanEmbedResponse,
} from './types.js';

// ============================================================================
// IMPLEMENTATION - Converts between AX format and Bedrock format
// ============================================================================

type ModelFamily = 'claude' | 'gpt' | 'titan';

class AxAIBedrockImpl
  implements
    AxAIServiceImpl<
      AxAIBedrockModel,
      AxAIBedrockEmbedModel,
      BedrockChatRequest,
      BedrockTitanEmbedRequest,
      BedrockChatResponse,
      never, // No streaming for now
      BedrockTitanEmbedResponse
    >
{
  private clients: Map<string, BedrockRuntimeClient> = new Map();
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
      stopSequences: this.config.stopSequences,
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

  /**
   * Detect model family from model ID
   */
  private getModelFamily(modelId: string): ModelFamily {
    if (
      modelId.includes('anthropic.claude') ||
      modelId.includes('us.anthropic.claude')
    ) {
      return 'claude';
    }
    if (modelId.includes('openai.gpt')) {
      return 'gpt';
    }
    if (modelId.includes('amazon.titan-embed')) {
      return 'titan';
    }
    throw new Error(`Unknown model family for: ${modelId}`);
  }

  /**
   * Get appropriate regions for model
   */
  private getRegionsForModel(modelId: string): string[] {
    const family = this.getModelFamily(modelId);
    if (family === 'gpt') {
      return [this.gptRegion, ...this.gptFallbackRegions];
    }
    return [this.primaryRegion, ...this.fallbackRegions];
  }

  /**
   * Regional failover logic - tries primary region, then fallbacks
   */
  private async invokeWithFailover<T>(
    modelId: string,
    handler: (client: BedrockRuntimeClient) => Promise<T>
  ): Promise<T> {
    const regions = this.getRegionsForModel(modelId);
    let lastError: Error | undefined;

    for (const region of regions) {
      try {
        const client = this.getClient(region);
        return await handler(client);
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[Bedrock] Region ${region} failed for ${modelId}:`,
          error
        );
      }
    }

    throw lastError || new Error(`All Bedrock regions failed for ${modelId}`);
  }

  /**
   * Transform AX chat request → Bedrock request (Claude or GPT)
   */
  createChatReq = async (
    req: Readonly<AxInternalChatRequest<AxAIBedrockModel>>,
    _config: Readonly<AxAIServiceOptions>
  ): Promise<[AxAPI, BedrockChatRequest]> => {
    const family = this.getModelFamily(req.model);
    const maxTokens =
      req.modelConfig?.maxTokens ?? this.config.maxTokens ?? 4096;
    const temperature = req.modelConfig?.temperature ?? this.config.temperature;
    const topP = req.modelConfig?.topP ?? this.config.topP;

    let bedrockRequest: BedrockChatRequest;

    if (family === 'claude') {
      // Extract system messages for Claude
      const systemMessages = req.chatPrompt
        .filter((msg) => msg.role === 'system')
        .map((msg) => msg.content)
        .join('\n\n');

      // Convert other messages to Claude format
      const messages = req.chatPrompt
        .filter((msg) => msg.role !== 'system')
        .map((msg) => {
          if (msg.role === 'user') {
            return {
              role: 'user' as const,
              content:
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content),
            };
          }
          if (msg.role === 'assistant') {
            return {
              role: 'assistant' as const,
              content: msg.content || '',
            };
          }
          throw new Error(`Unsupported role: ${msg.role}`);
        });

      bedrockRequest = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages,
        ...(systemMessages ? { system: systemMessages } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
      } as BedrockClaudeRequest;
    } else if (family === 'gpt') {
      // GPT uses OpenAI-style format with system messages in array
      const messages = req.chatPrompt
        .filter((msg) => msg.role !== 'function') // Skip function messages
        .map((msg) => {
          // Get content based on role
          let content: string;
          if ('content' in msg) {
            content =
              typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content);
          } else {
            content = '';
          }

          return {
            role: msg.role as 'system' | 'user' | 'assistant',
            content,
          };
        });

      bedrockRequest = {
        messages,
        max_tokens: maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
      } as BedrockGptRequest;
    } else {
      throw new Error(`Chat not supported for model family: ${family}`);
    }

    // Create API config with local call (uses SDK instead of HTTP)
    const apiConfig: AxAPI = {
      name: `bedrock-${family}`,
      localCall: async <TRequest, TResponse>(data: TRequest) => {
        const reqBody = data as unknown as BedrockChatRequest;
        const result = await this.invokeWithFailover(
          req.model,
          async (client) => {
            const command = new InvokeModelCommand({
              modelId: req.model,
              body: JSON.stringify(reqBody),
              contentType: 'application/json',
              accept: 'application/json',
            });
            const response = await client.send(command);
            return JSON.parse(new TextDecoder().decode(response.body));
          }
        );
        return result as TResponse;
      },
    };

    return [apiConfig, bedrockRequest];
  };

  /**
   * Transform Bedrock response → AX chat response (Claude or GPT)
   */
  createChatResp(resp: Readonly<BedrockChatResponse>): AxChatResponse {
    // Detect response type
    if ('content' in resp && Array.isArray(resp.content)) {
      // Claude response
      return this.createClaudeChatResp(resp as BedrockClaudeResponse);
    } else if ('choices' in resp && Array.isArray(resp.choices)) {
      // GPT response
      return this.createGptChatResp(resp as BedrockGptResponse);
    }
    throw new Error('Unknown response format');
  }

  /**
   * Handle Claude-specific response format
   */
  private createClaudeChatResp(
    resp: Readonly<BedrockClaudeResponse>
  ): AxChatResponse {
    // Extract text content from response
    let content = '';
    for (const block of resp.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    // Track token usage for AX's optimizer
    this.tokensUsed = {
      promptTokens: resp.usage.input_tokens,
      completionTokens: resp.usage.output_tokens,
      totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
    };

    // Map finish reason
    let finishReason: AxChatResponseResult['finishReason'];
    switch (resp.stop_reason) {
      case 'end_turn':
      case 'stop_sequence':
        finishReason = 'stop';
        break;
      case 'max_tokens':
        finishReason = 'length';
        break;
      default:
        finishReason = undefined;
    }

    return {
      results: [
        {
          index: 0,
          id: resp.id,
          content,
          finishReason,
        },
      ],
      remoteId: resp.id,
    };
  }

  /**
   * Handle GPT-specific response format
   */
  private createGptChatResp(
    resp: Readonly<BedrockGptResponse>
  ): AxChatResponse {
    const choice = resp.choices[0];
    if (!choice) {
      throw new Error('No choices in GPT response');
    }

    // Extract content (can be string or array)
    let content = '';
    if (typeof choice.message.content === 'string') {
      content = choice.message.content;
    } else if (Array.isArray(choice.message.content)) {
      content = choice.message.content
        .map((part) => {
          if (typeof part === 'string') return part;
          return part.text || part.content || '';
        })
        .join('');
    }

    // Track token usage if available
    if (resp.usage) {
      this.tokensUsed = {
        promptTokens: resp.usage.prompt_tokens,
        completionTokens: resp.usage.completion_tokens,
        totalTokens: resp.usage.total_tokens,
      };
    }

    // Map finish reason
    let finishReason: AxChatResponseResult['finishReason'];
    switch (choice.finish_reason) {
      case 'stop':
        finishReason = 'stop';
        break;
      case 'length':
        finishReason = 'length';
        break;
      case 'content_filter':
        finishReason = 'content_filter';
        break;
      default:
        finishReason = undefined;
    }

    return {
      results: [
        {
          index: choice.index,
          id: resp.id,
          content,
          finishReason,
        },
      ],
      remoteId: resp.id,
    };
  }

  /**
   * Create embed request for Titan
   */
  createEmbedReq = async (
    req: Readonly<AxInternalEmbedRequest<AxAIBedrockEmbedModel>>
  ): Promise<[AxAPI, BedrockTitanEmbedRequest]> => {
    if (!req.texts || req.texts.length === 0) {
      throw new Error('No texts provided for embedding');
    }

    const embedRequest: BedrockTitanEmbedRequest = {
      inputText: req.texts[0], // Take first text
      dimensions: 512,
      normalize: true,
    };

    const apiConfig: AxAPI = {
      name: 'bedrock-titan-embed',
      localCall: async <TRequest, TResponse>(data: TRequest) => {
        const reqBody = data as unknown as BedrockTitanEmbedRequest;
        const result = await this.invokeWithFailover(
          req.embedModel,
          async (client) => {
            const command = new InvokeModelCommand({
              modelId: req.embedModel,
              body: JSON.stringify(reqBody),
              contentType: 'application/json',
              accept: 'application/json',
            });
            const response = await client.send(command);
            return JSON.parse(new TextDecoder().decode(response.body));
          }
        );
        return result as TResponse;
      },
    };

    return [apiConfig, embedRequest];
  };

  /**
   * Create embed response from Titan
   */
  createEmbedResp(resp: Readonly<BedrockTitanEmbedResponse>): AxEmbedResponse {
    return {
      embeddings: [resp.embedding],
    };
  }
}

// ============================================================================
// PROVIDER CLASS - Main entry point
// ============================================================================

export class AxAIBedrock extends AxBaseAI<
  AxAIBedrockModel,
  AxAIBedrockEmbedModel,
  BedrockChatRequest,
  BedrockTitanEmbedRequest,
  BedrockChatResponse,
  never, // No streaming yet
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
    // Merge user config with defaults
    const fullConfig: AxAIBedrockConfig = {
      ...axBaseAIDefaultConfig(),
      model: AxAIBedrockModel.ClaudeSonnet4,
      region,
      fallbackRegions,
      gptRegion,
      gptFallbackRegions,
      ...config,
    };

    // Create implementation
    const aiImpl = new AxAIBedrockImpl(
      fullConfig,
      region,
      fallbackRegions,
      gptRegion,
      gptFallbackRegions
    );

    // Define feature support
    const supportFor = (): AxAIFeatures => ({
      functions: false, // Not implemented yet - add when needed
      streaming: false, // Not implemented yet - add when needed
      functionCot: false,
      hasThinkingBudget: false,
      hasShowThoughts: false,
      media: {
        images: {
          supported: false, // Add when needed
          formats: [],
        },
        audio: {
          supported: false,
          formats: [],
        },
        files: {
          supported: false,
          formats: [],
          uploadMethod: 'none',
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
      multiTurn: true, // All models support multi-turn conversations
    });

    // Initialize base class
    super(aiImpl, {
      name: 'Bedrock',
      apiURL: '', // Not used - we use SDK directly
      headers: async () => ({}), // AWS SDK handles auth
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
// Re-export types for convenience
export { AxAIBedrockEmbedModel, AxAIBedrockModel } from './types.js';
