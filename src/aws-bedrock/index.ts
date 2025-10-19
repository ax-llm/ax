/**
 * AWS Bedrock Provider for AX
 *
 * Production-ready AWS Bedrock integration supporting Claude, GPT OSS, and Titan Embed models.
 *
 * @example
 * ```typescript
 * import { AxAIBedrock, AxAIBedrockModel } from '@ax-llm/ax-ai-aws-bedrock';
 *
 * const ai = new AxAIBedrock({
 *   region: 'us-east-2',
 *   config: { model: AxAIBedrockModel.ClaudeSonnet4 }
 * });
 *
 * const response = await ai.chat({
 *   chatPrompt: [
 *     { role: 'system', content: 'You are a helpful assistant.' },
 *     { role: 'user', content: 'What is AWS Bedrock?' }
 *   ]
 * });
 * ```
 *
 * @packageDocumentation
 */

export { AxAIBedrock } from './api.js';
export { axModelInfoBedrock } from './info.js';
export { AxAIBedrockEmbedModel, AxAIBedrockModel } from './types.js';

export type {
  AxAIBedrockConfig,
  BedrockChatRequest,
  BedrockChatResponse,
  BedrockClaudeRequest,
  BedrockClaudeResponse,
  BedrockGptRequest,
  BedrockGptResponse,
  BedrockTitanEmbedRequest,
  BedrockTitanEmbedResponse,
} from './types.js';
