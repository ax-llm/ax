/**
 * AWS Bedrock provider types for AX integration
 * Supports Claude, GPT OSS, and Titan models
 */

import type { AxModelConfig } from '@ax-llm/ax';

// All Bedrock models
export enum AxAIBedrockModel {
  // Claude models
  ClaudeOpus45 = 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  ClaudeSonnet4 = 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  Claude37Sonnet = 'anthropic.claude-3-7-sonnet-20250219-v1:0',
  Claude35Sonnet = 'anthropic.claude-3-5-sonnet-20240620-v1:0',

  // GPT OSS models
  GptOss120B = 'openai.gpt-oss-120b-1:0',
  GptOss20B = 'openai.gpt-oss-20b-1:0',
}

// Embed models
export enum AxAIBedrockEmbedModel {
  TitanEmbedV2 = 'amazon.titan-embed-text-v2:0',
}

export interface AxAIBedrockConfig extends AxModelConfig {
  model: AxAIBedrockModel;
  embedModel?: AxAIBedrockEmbedModel;
  region?: string;
  fallbackRegions?: string[];
  gptRegion?: string;
  gptFallbackRegions?: string[];
}

// ============================================================================
// Claude Request/Response Types
// ============================================================================

export interface BedrockClaudeRequest {
  anthropic_version: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: 'text'; text: string }>;
  }>;
  system?: string;
  temperature?: number;
  top_p?: number;
}

export interface BedrockClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// GPT OSS Request/Response Types (OpenAI-compatible format)
// ============================================================================

export interface BedrockGptRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
}

export interface BedrockGptResponse {
  id?: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content:
        | string
        | Array<{ type?: string; text?: string; content?: string }>;
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Titan Embed Request/Response Types
// ============================================================================

export interface BedrockTitanEmbedRequest {
  inputText: string;
  dimensions?: number;
  normalize?: boolean;
}

export interface BedrockTitanEmbedResponse {
  embedding: number[];
  inputTextTokenCount: number;
}

// Union types for all models
export type BedrockChatRequest = BedrockClaudeRequest | BedrockGptRequest;
export type BedrockChatResponse = BedrockClaudeResponse | BedrockGptResponse;
