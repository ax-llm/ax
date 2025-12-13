import { describe, expect, it, vi } from 'vitest';

import { AxTokenLimitError, apiCall } from './apicall.js';

describe('apiCall Token Limit Detection', () => {
  it('should detect OpenAI context_length_exceeded error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: {
          code: 'context_length_exceeded',
          message: 'Context length exceeded',
        },
      }),
      text: async () =>
        JSON.stringify({
          error: {
            code: 'context_length_exceeded',
            message: 'Context length exceeded',
          },
        }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          cancel: async () => {},
        }),
      }, // Mock stream for safeReadResponseBody check
    } as any);

    const apiConfig = {
      name: 'openai',
      url: 'https://api.openai.com/v1',
      fetch: mockFetch,
    };

    await expect(apiCall(apiConfig, {})).rejects.toThrow(AxTokenLimitError);
  });

  it('should detect Anthropic prompt too long error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        type: 'invalid_request_error',
        error: {
          message: 'prompt is too long',
        },
      }),
      text: async () =>
        JSON.stringify({
          type: 'invalid_request_error',
          error: {
            message: 'prompt is too long',
          },
        }),
    } as any);

    const apiConfig = {
      name: 'anthropic',
      url: 'https://api.anthropic.com/v1',
      fetch: mockFetch,
    };

    await expect(apiCall(apiConfig, {})).rejects.toThrow(AxTokenLimitError);
  });

  it('should detect Google Gemini INVALID_ARGUMENT token limit error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: 'Token limit exceeded',
        },
      }),
      text: async () =>
        JSON.stringify({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Token limit exceeded',
          },
        }),
    } as any);

    const apiConfig = {
      name: 'gemini',
      url: 'https://generativelanguage.googleapis.com/v1',
      fetch: mockFetch,
    };

    await expect(apiCall(apiConfig, {})).rejects.toThrow(AxTokenLimitError);
  });

  it('should detect generic token limit keywords in body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        message: 'Something about token limit being hit',
      }),
      text: async () =>
        JSON.stringify({
          message: 'Something about token limit being hit',
        }),
    } as any);

    const apiConfig = {
      name: 'generic',
      url: 'https://api.example.com/v1',
      fetch: mockFetch,
    };

    await expect(apiCall(apiConfig, {})).rejects.toThrow(AxTokenLimitError);
  });

  it('should NOT throw AxTokenLimitError for unrelated 400 errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: {
          code: 'invalid_parameter',
          message: 'Invalid parameter value',
        },
      }),
      text: async () =>
        JSON.stringify({
          error: {
            code: 'invalid_parameter',
            message: 'Invalid parameter value',
          },
        }),
    } as any);

    const apiConfig = {
      name: 'openai',
      url: 'https://api.openai.com/v1',
      fetch: mockFetch,
    };

    // Should match standard status error, NOT AxTokenLimitError
    await expect(apiCall(apiConfig, {})).rejects.toThrow(/HTTP 400/);
    try {
      await apiCall(apiConfig, {});
    } catch (e: any) {
      expect(e.name).not.toBe('AxTokenLimitError');
      expect(e.name).toBe('AxAIServiceStatusError');
    }
  });
});
