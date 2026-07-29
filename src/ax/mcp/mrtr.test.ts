import { describe, expect, it, vi } from 'vitest';
import { axMCPFulfillInputRequests } from './mrtr.js';

describe('axMCPFulfillInputRequests', () => {
  it('fulfills roots, sampling, and elicitation using the shared handlers', async () => {
    const sampling = vi.fn(async () => ({
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'Paris' },
      model: 'test-model',
    }));
    const elicitation = vi.fn(async () => ({
      action: 'accept' as const,
      content: { username: 'octocat' },
    }));

    await expect(
      axMCPFulfillInputRequests(
        {
          roots: { method: 'roots/list' },
          sample: {
            method: 'sampling/createMessage',
            params: { messages: [], maxTokens: 16 },
          },
          elicit: {
            method: 'elicitation/create',
            params: {
              message: 'Username?',
              requestedSchema: { type: 'object', properties: {} },
            },
          },
        },
        {
          roots: [{ uri: 'file:///workspace' }],
          sampling,
          elicitation,
        }
      )
    ).resolves.toEqual({
      roots: { roots: [{ uri: 'file:///workspace' }] },
      sample: {
        role: 'assistant',
        content: { type: 'text', text: 'Paris' },
        model: 'test-model',
      },
      elicit: { action: 'accept', content: { username: 'octocat' } },
    });
  });

  it('reports a protocol violation when a requested handler is missing', async () => {
    await expect(
      axMCPFulfillInputRequests(
        {
          prompt: {
            method: 'elicitation/create',
            params: {
              message: 'Continue?',
              requestedSchema: { type: 'object', properties: {} },
            },
          },
        },
        {}
      )
    ).rejects.toThrow(
      'MCP protocol violation: server requested elicitation/create without a matching client handler'
    );
  });
});
