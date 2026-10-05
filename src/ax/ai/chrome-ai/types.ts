import type { AxModelConfig } from '../types.js';

/**
 * Chrome AI: Model for text generation
 * Chrome ships with Gemini Nano as its built-in AI model
 */
export enum AxAIChromeAIModel {
  GeminiNano = 'gemini-nano',
}

export type AxAIChromeAIModelId = AxAIChromeAIModel | (string & {});

/**
 * Chrome AI: Model options for text generation
 */
export type AxAIChromeAIConfig = AxModelConfig & {
  model: AxAIChromeAIModelId;
};

/**
 * Chrome AI: Minimal LanguageModel interface
 * Typed inline to avoid external dependency on @types/dom-chromium-ai
 * Based on the Chrome Prompt API spec:
 * https://developer.chrome.com/docs/ai/prompt-api
 */
export interface ChromeAILanguageModel {
  /** Legacy sampling parameters are available in Chrome extensions. */
  params?(): Promise<{
    defaultTemperature: number;
    maxTemperature: number;
    defaultTopK: number;
    maxTopK: number;
  } | null>;
  availability?(options?: {
    temperature?: number;
    topK?: number;
  }): Promise<
    | 'available'
    | 'downloadable'
    | 'downloading'
    | 'unavailable'
    | 'readily'
    | 'after-download'
    | 'no'
  >;
  capabilities?(options?: { temperature?: number; topK?: number }): Promise<{
    available:
      | 'readily'
      | 'after-download'
      | 'no'
      | 'available'
      | 'downloadable'
      | 'downloading'
      | 'unavailable';
    defaultTemperature?: number;
    maxTemperature?: number;
    defaultTopK?: number;
    maxTopK?: number;
  }>;
  create(options?: ChromeAICreateOptions): Promise<ChromeAISession>;
}

export interface ChromeAICreateOptions {
  systemPrompt?: string;
  initialPrompts?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  topK?: number;
  expectedInputLanguages?: string[];
  expectedOutputLanguage?: string;
  signal?: AbortSignal;
}

export interface ChromeAIPromptOptions {
  responseConstraint?: object;
  signal?: AbortSignal;
}

export interface ChromeAISession {
  prompt(input: string, options?: ChromeAIPromptOptions): Promise<string>;
  promptStreaming(
    input: string,
    options?: ChromeAIPromptOptions
  ): ReadableStream<string> | AsyncIterable<string>;
  destroy?(): void;
  close?(): void;
}

/**
 * Chrome AI: Synthetic chat request
 * Maps ax's multi-message format to Chrome AI's session + prompt model
 */
export type AxAIChromeAIChatRequest = {
  model: AxAIChromeAIModelId;
  /** Messages to be passed as initialPrompts (all except the last user message) */
  initialPrompts: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  /** The final user message to be passed to session.prompt() */
  prompt: string;
  /** JSON schema for constrained decoding via responseConstraint */
  responseConstraint?: object;
  temperature?: number;
  topK?: number;
  stream?: boolean;
};

/**
 * Chrome AI: Synthetic chat response
 * Wraps Chrome AI's text response into an OpenAI-like structure for ax
 */
export type AxAIChromeAIChatResponse = {
  id: string;
  content: string;
  finishReason: 'stop' | 'length';
};

/**
 * Chrome AI: Streaming response delta
 * Chrome AI's promptStreaming() returns successive text chunks.
 */
export type AxAIChromeAIChatResponseDelta = {
  id: string;
  /** New text in this chunk */
  content: string;
  done: boolean;
};

/**
 * Chrome AI doesn't support embeddings
 * Placeholders for consistency with the framework
 */
export type AxAIChromeAIEmbedModel = never;
export type AxAIChromeAIEmbedRequest = never;
export type AxAIChromeAIEmbedResponse = never;
