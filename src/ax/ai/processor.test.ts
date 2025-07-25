import { describe, it, expect, vi } from 'vitest';
import {
  axProcessContentForProvider,
  axAnalyzeChatPromptRequirements,
} from './processor.js';
import { axSelectOptimalProvider } from './capabilities.js';
import { AxMediaNotSupportedError } from '../util/apicall.js';
import type { AxAIService, AxAIFeatures } from './types.js';

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

const mockImageSupportedProvider = createMockProvider('ImageProvider', {
  functions: true,
  streaming: true,
  media: {
    images: { supported: true, formats: ['image/jpeg'], maxSize: 1024 },
    audio: { supported: false, formats: [], maxDuration: 0 },
    files: { supported: false, formats: [], maxSize: 0, uploadMethod: 'none' },
    urls: { supported: false, webSearch: false, contextFetching: false },
  },
  caching: { supported: false, types: [] },
  thinking: false,
  multiTurn: true,
});

const mockTextOnlyProvider = createMockProvider('TextOnly', {
  functions: true,
  streaming: true,
  media: {
    images: { supported: false, formats: [], maxSize: 0 },
    audio: { supported: false, formats: [], maxDuration: 0 },
    files: { supported: false, formats: [], maxSize: 0, uploadMethod: 'none' },
    urls: { supported: false, webSearch: false, contextFetching: false },
  },
  caching: { supported: false, types: [] },
  thinking: false,
  multiTurn: true,
});

describe('axProcessContentForProvider', () => {
  it('should handle string content directly', async () => {
    const content = 'Hello world';
    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider
    );

    expect(result).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('should handle text content in array', async () => {
    const content = [{ type: 'text', text: 'Hello world' }];
    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider
    );

    expect(result).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('should use alt text for images when provider does not support images', async () => {
    const content = [
      {
        type: 'image',
        image: 'base64data',
        mimeType: 'image/jpeg',
        altText: 'A beautiful sunset',
      },
    ];

    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider
    );

    expect(result).toEqual([{ type: 'text', text: 'A beautiful sunset' }]);
  });

  it('should use imageToText service when available', async () => {
    const content = [
      {
        type: 'image',
        image: 'base64data',
        mimeType: 'image/jpeg',
      },
    ];

    const mockImageToText = vi
      .fn()
      .mockResolvedValue('AI description of image');

    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider,
      { imageToText: mockImageToText }
    );

    expect(mockImageToText).toHaveBeenCalledWith('base64data');
    expect(result).toEqual([{ type: 'text', text: 'AI description of image' }]);
  });

  it('should throw error when fallbackBehavior is error and no support', async () => {
    const content = [
      {
        type: 'image',
        image: 'base64data',
        mimeType: 'image/jpeg',
      },
    ];

    await expect(
      axProcessContentForProvider(content, mockTextOnlyProvider, {
        fallbackBehavior: 'error',
      })
    ).rejects.toThrow(AxMediaNotSupportedError);
  });

  it('should skip content when fallbackBehavior is skip', async () => {
    const content = [
      { type: 'text', text: 'Hello' },
      {
        type: 'image',
        image: 'base64data',
        mimeType: 'image/jpeg',
      },
      { type: 'text', text: 'World' },
    ];

    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider,
      { fallbackBehavior: 'skip' }
    );

    expect(result).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ]);
  });

  it('should handle audio with transcription', async () => {
    const content = [
      {
        type: 'audio',
        data: 'audiodata',
        format: 'wav',
        transcription: 'Hello from audio',
      },
    ];

    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider
    );

    expect(result).toEqual([{ type: 'text', text: 'Hello from audio' }]);
  });

  it('should handle files with extracted text', async () => {
    const content = [
      {
        type: 'file',
        data: 'filedata',
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        extractedText: 'Document content',
      },
    ];

    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider
    );

    expect(result).toEqual([{ type: 'text', text: 'Document content' }]);
  });

  it('should handle URLs with cached content', async () => {
    const content = [
      {
        type: 'url',
        url: 'https://example.com',
        title: 'Example Site',
        cachedContent: 'Website content here',
      },
    ];

    const result = await axProcessContentForProvider(
      content,
      mockTextOnlyProvider
    );

    expect(result).toEqual([{ type: 'text', text: 'Website content here' }]);
  });
});

describe('axAnalyzeChatPromptRequirements', () => {
  it('should detect image requirements', () => {
    const chatPrompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', image: 'base64', mimeType: 'image/jpeg' },
        ],
      },
    ];

    const requirements = axAnalyzeChatPromptRequirements(chatPrompt);

    expect(requirements).toEqual({
      hasImages: true,
      hasAudio: false,
      hasFiles: false,
      hasUrls: false,
    });
  });

  it('should detect multiple media types', () => {
    const chatPrompt = [
      {
        role: 'user',
        content: [
          { type: 'image', image: 'base64', mimeType: 'image/jpeg' },
          { type: 'audio', data: 'audiodata', format: 'wav' },
          { type: 'url', url: 'https://example.com' },
        ],
      },
    ];

    const requirements = axAnalyzeChatPromptRequirements(chatPrompt);

    expect(requirements).toEqual({
      hasImages: true,
      hasAudio: true,
      hasFiles: false,
      hasUrls: true,
    });
  });
});

describe('axSelectOptimalProvider', () => {
  it('should select provider that supports required media types', () => {
    const request = {
      chatPrompt: [
        {
          role: 'user' as const,
          content: [
            { type: 'image' as const, image: 'base64', mimeType: 'image/jpeg' },
          ],
        },
      ],
    };

    const providers = [mockTextOnlyProvider, mockImageSupportedProvider];

    const selected = axSelectOptimalProvider(request, providers);

    expect(selected.getName()).toBe('ImageProvider');
  });

  it('should select any provider when no specific requirements', () => {
    const request = {
      chatPrompt: [{ role: 'user' as const, content: 'test' }],
    };

    const providers = [mockTextOnlyProvider];

    const selected = axSelectOptimalProvider(request, providers);

    expect(selected.getName()).toBe('TextOnly');
  });

  it('should throw error when no providers available', () => {
    const request = {
      chatPrompt: [{ role: 'user' as const, content: 'test' }],
    };

    expect(() => axSelectOptimalProvider(request, [])).toThrow(
      'No providers available'
    );
  });
});
