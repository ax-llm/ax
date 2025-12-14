import { describe, expect, it } from 'vitest';
import { AxAIOpenAIModel } from '../openai/chat_types.js';
import { AxAIAzureOpenAI } from './api.js';

const createAI = (version: string) =>
  new AxAIAzureOpenAI({
    apiKey: 'key',
    resourceName: 'https://example.openai.azure.com/',
    deploymentName: 'deployment',
    version,
  });

describe('AxAIAzureOpenAI structured outputs support', () => {
  it('should not advertise structured outputs for older Azure API versions', () => {
    const ai = createAI('2024-02-15-preview');
    const features = ai.getFeatures(AxAIOpenAIModel.GPT5Mini);
    expect(features.structuredOutputs).toBe(false);
  });

  it('should advertise structured outputs for Azure API versions that support it', () => {
    const ai = createAI('2024-08-01-preview');
    const features = ai.getFeatures(AxAIOpenAIModel.GPT5Mini);
    expect(features.structuredOutputs).toBe(true);
  });

  it('should accept api-version= prefix in version argument', () => {
    const ai = createAI('api-version=2024-10-21');
    const features = ai.getFeatures(AxAIOpenAIModel.GPT5Mini);
    expect(features.structuredOutputs).toBe(true);

    // Ensure we don't generate malformed query strings like api-version=api-version=...
    expect((ai as any).apiURL).toContain('api-version=2024-10-21');
    expect((ai as any).apiURL).not.toContain('api-version=api-version=');
  });
});
