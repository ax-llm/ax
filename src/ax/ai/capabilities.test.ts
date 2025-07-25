import { describe, it, expect, vi } from 'vitest';
import {
  axAnalyzeRequestRequirements,
  axValidateProviderCapabilities,
  axScoreProvidersForRequest,
  axSelectOptimalProvider,
  axGetCompatibilityReport,
  axGetProvidersWithMediaSupport,
  axGetFormatCompatibility,
} from './capabilities.js';
import type { AxAIService, AxAIFeatures, AxChatRequest } from './types.js';

// Mock provider factory
function createMockProvider(name: string, features: AxAIFeatures): AxAIService {
  return {
    getName: () => name,
    getFeatures: () => features,
    getId: () => `mock-${name}`,
    getModelList: () => undefined,
    getMetrics: () => ({
      latency: {
        chat: { mean: 0, p95: 0, p99: 0, samples: [] },
        embed: { mean: 0, p95: 0, p99: 0, samples: [] },
      },
      errors: {
        chat: { count: 0, rate: 0, total: 0 },
        embed: { count: 0, rate: 0, total: 0 },
      },
    }),
    getLogger: () => () => {},
    getLastUsedChatModel: () => undefined,
    getLastUsedEmbedModel: () => undefined,
    getLastUsedModelConfig: () => undefined,
    chat: vi.fn(),
    embed: vi.fn(),
    setOptions: vi.fn(),
    getOptions: () => ({}),
  } as AxAIService;
}

const mockOpenAI = createMockProvider('OpenAI', {
  functions: true,
  streaming: true,
  media: {
    images: {
      supported: true,
      formats: ['image/jpeg', 'image/png'],
      maxSize: 20 * 1024 * 1024,
      detailLevels: ['high', 'low', 'auto'],
    },
    audio: {
      supported: true,
      formats: ['wav', 'mp3'],
      maxDuration: 25 * 60,
    },
    files: {
      supported: true,
      formats: ['text/plain', 'application/pdf'],
      maxSize: 512 * 1024 * 1024,
      uploadMethod: 'upload',
    },
    urls: {
      supported: false,
      webSearch: true,
      contextFetching: false,
    },
  },
  caching: { supported: false, types: [] },
  thinking: false,
  multiTurn: true,
});

const mockGemini = createMockProvider('Gemini', {
  functions: true,
  streaming: true,
  media: {
    images: {
      supported: true,
      formats: ['image/jpeg', 'image/png', 'image/webp'],
      maxSize: 20 * 1024 * 1024,
      detailLevels: ['high', 'low', 'auto'],
    },
    audio: {
      supported: true,
      formats: ['wav', 'mp3', 'aac'],
      maxDuration: 9.5 * 60,
    },
    files: {
      supported: true,
      formats: ['application/pdf', 'text/plain'],
      maxSize: 2 * 1024 * 1024 * 1024,
      uploadMethod: 'cloud',
    },
    urls: {
      supported: true,
      webSearch: true,
      contextFetching: true,
    },
  },
  caching: { supported: false, types: [] },
  thinking: false,
  multiTurn: true,
});

const mockAnthropic = createMockProvider('Anthropic', {
  functions: true,
  streaming: true,
  functionCot: true,
  media: {
    images: {
      supported: true,
      formats: ['image/jpeg', 'image/png'],
      maxSize: 5 * 1024 * 1024,
      detailLevels: ['high', 'low', 'auto'],
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
      uploadMethod: 'none',
    },
    urls: {
      supported: false,
      webSearch: false,
      contextFetching: false,
    },
  },
  caching: { supported: true, types: ['ephemeral'] },
  thinking: true,
  multiTurn: true,
});

const mockCohere = createMockProvider('Cohere', {
  functions: true,
  streaming: true,
  media: {
    images: { supported: false, formats: [], maxSize: 0, detailLevels: [] },
    audio: { supported: false, formats: [], maxDuration: 0 },
    files: { supported: false, formats: [], maxSize: 0, uploadMethod: 'none' },
    urls: { supported: false, webSearch: false, contextFetching: false },
  },
  caching: { supported: false, types: [] },
  thinking: false,
  multiTurn: true,
});

describe('axAnalyzeRequestRequirements', () => {
  it('should detect image requirements', () => {
    const request: AxChatRequest = {
      chatPrompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', image: 'base64data', mimeType: 'image/jpeg' },
          ],
        },
      ],
    };

    const requirements = axAnalyzeRequestRequirements(request);

    expect(requirements.hasImages).toBe(true);
    expect(requirements.hasAudio).toBe(false);
    expect(requirements.contentTypes.has('image')).toBe(true);
    expect(requirements.estimatedTokens).toBeGreaterThan(0);
  });

  it('should detect function requirements', () => {
    const request: AxChatRequest = {
      chatPrompt: [{ role: 'user', content: 'Call this function' }],
      functions: [{ name: 'test_function', description: 'A test function' }],
    };

    const requirements = axAnalyzeRequestRequirements(request);

    expect(requirements.requiresFunctions).toBe(true);
  });

  it('should detect streaming requirements', () => {
    const request: AxChatRequest = {
      chatPrompt: [{ role: 'user', content: 'Stream this response' }],
      modelConfig: { stream: true },
    };

    const requirements = axAnalyzeRequestRequirements(request);

    expect(requirements.requiresStreaming).toBe(true);
  });

  it('should detect caching requirements', () => {
    const request: AxChatRequest = {
      chatPrompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Cache this', cache: true }],
        },
      ],
    };

    const requirements = axAnalyzeRequestRequirements(request);

    expect(requirements.requiresCaching).toBe(true);
  });
});

describe('axValidateProviderCapabilities', () => {
  it('should validate provider supports all requirements', () => {
    const requirements = {
      hasImages: true,
      hasAudio: false,
      hasFiles: false,
      hasUrls: false,
      requiresFunctions: true,
      requiresStreaming: true,
      requiresCaching: false,
      contentTypes: new Set(['image']),
      estimatedTokens: 100,
    };

    const result = axValidateProviderCapabilities(mockOpenAI, requirements);

    expect(result.isSupported).toBe(true);
    expect(result.missingCapabilities).toHaveLength(0);
  });

  it('should identify missing capabilities', () => {
    const requirements = {
      hasImages: false,
      hasAudio: true,
      hasFiles: false,
      hasUrls: false,
      requiresFunctions: true,
      requiresStreaming: true,
      requiresCaching: false,
      contentTypes: new Set(['audio']),
      estimatedTokens: 100,
    };

    const result = axValidateProviderCapabilities(mockCohere, requirements);

    expect(result.isSupported).toBe(false);
    expect(result.missingCapabilities).toContain('Audio support');
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('should provide warnings for limitations', () => {
    const requirements = {
      hasImages: true,
      hasAudio: false,
      hasFiles: false,
      hasUrls: false,
      requiresFunctions: false,
      requiresStreaming: false,
      requiresCaching: false,
      contentTypes: new Set(['image']),
      estimatedTokens: 100,
    };

    const result = axValidateProviderCapabilities(mockAnthropic, requirements);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('size limit');
  });
});

describe('axScoreProvidersForRequest', () => {
  it('should score providers based on capability match', () => {
    const requirements = {
      hasImages: true,
      hasAudio: true,
      hasFiles: false,
      hasUrls: false,
      requiresFunctions: true,
      requiresStreaming: true,
      requiresCaching: false,
      contentTypes: new Set(['image', 'audio']),
      estimatedTokens: 200,
    };

    const providers = [mockOpenAI, mockGemini, mockAnthropic, mockCohere];
    const scores = axScoreProvidersForRequest(providers, requirements);

    // OpenAI and Gemini should score higher as they support both images and audio
    expect(scores[0].provider.getName()).toMatch(/OpenAI|Gemini/);
    expect(scores[0].score).toBeGreaterThan(scores[2].score);

    // Cohere should score lowest as it supports neither
    const cohereScore = scores.find((s) => s.provider.getName() === 'Cohere');
    expect(cohereScore).toBeDefined();
    expect(cohereScore!.score).toBeLessThan(scores[0].score);
  });

  it('should prioritize providers with exact capability matches', () => {
    const requirements = {
      hasImages: false,
      hasAudio: false,
      hasFiles: false,
      hasUrls: true,
      requiresFunctions: false,
      requiresStreaming: false,
      requiresCaching: false,
      contentTypes: new Set(['url']),
      estimatedTokens: 50,
    };

    const providers = [mockOpenAI, mockGemini];
    const scores = axScoreProvidersForRequest(providers, requirements);

    // Gemini should score higher as it supports URLs
    expect(scores[0].provider.getName()).toBe('Gemini');
  });
});

describe('axSelectOptimalProvider', () => {
  it('should select best provider for requirements', () => {
    const request: AxChatRequest = {
      chatPrompt: [
        {
          role: 'user',
          content: [{ type: 'image', image: 'base64', mimeType: 'image/jpeg' }],
        },
      ],
    };

    const providers = [mockOpenAI, mockCohere];
    const selected = axSelectOptimalProvider(request, providers);

    expect(selected.getName()).toBe('OpenAI');
  });

  it('should throw error when requireExactMatch is true and no provider fully supports', () => {
    const request: AxChatRequest = {
      chatPrompt: [
        {
          role: 'user',
          content: [{ type: 'audio', data: 'audiodata', format: 'wav' }],
        },
      ],
    };

    const providers = [mockCohere]; // Cohere doesn't support audio

    expect(() =>
      axSelectOptimalProvider(request, providers, { requireExactMatch: true })
    ).toThrow();
  });

  it('should throw error when no providers available', () => {
    const request: AxChatRequest = {
      chatPrompt: [{ role: 'user', content: 'test' }],
    };

    expect(() => axSelectOptimalProvider(request, [])).toThrow(
      'No providers available'
    );
  });
});

describe('axGetCompatibilityReport', () => {
  it('should generate comprehensive compatibility report', () => {
    const request: AxChatRequest = {
      chatPrompt: [
        {
          role: 'user',
          content: [
            { type: 'image', image: 'base64', mimeType: 'image/jpeg' },
            { type: 'audio', data: 'audiodata', format: 'wav' },
          ],
        },
      ],
      functions: [{ name: 'test', description: 'test' }],
    };

    const providers = [mockOpenAI, mockCohere];
    const report = axGetCompatibilityReport(request, providers);

    expect(report.requirements).toBeDefined();
    expect(report.providerScores).toHaveLength(2);
    expect(report.recommendedProvider?.getName()).toBe('OpenAI');
    expect(report.summary).toContain('OpenAI');
    expect(typeof report.summary).toBe('string');
  });
});

describe('axGetProvidersWithMediaSupport', () => {
  it('should filter providers by media type support', () => {
    const providers = [mockOpenAI, mockGemini, mockAnthropic, mockCohere];

    const imageProviders = axGetProvidersWithMediaSupport(providers, 'images');
    expect(imageProviders).toHaveLength(3); // OpenAI, Gemini, Anthropic

    const audioProviders = axGetProvidersWithMediaSupport(providers, 'audio');
    expect(audioProviders).toHaveLength(2); // OpenAI, Gemini

    const urlProviders = axGetProvidersWithMediaSupport(providers, 'urls');
    expect(urlProviders).toHaveLength(1); // Gemini
  });
});

describe('axGetFormatCompatibility', () => {
  it('should map formats to supporting providers', () => {
    const providers = [mockOpenAI, mockGemini, mockCohere];
    const compatibility = axGetFormatCompatibility(providers, 'images');

    expect(compatibility['image/jpeg']).toHaveLength(2); // OpenAI, Gemini
    expect(compatibility['image/png']).toHaveLength(2); // OpenAI, Gemini
    expect(compatibility['image/webp']).toHaveLength(1); // Gemini only
  });

  it('should handle providers with no format support', () => {
    const providers = [mockCohere]; // No image support
    const compatibility = axGetFormatCompatibility(providers, 'images');

    expect(Object.keys(compatibility)).toHaveLength(0);
  });
});
