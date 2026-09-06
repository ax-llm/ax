import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiCall } from './apicall.js';

describe('apiCall verbose header redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const okFetch = () =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

  it('does not print the raw Authorization bearer token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockFetch = okFetch();

    await apiCall(
      {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        verbose: true,
        headers: { Authorization: 'Bearer sk-secret123' },
      },
      { test: 'data' }
    );

    const logged = logSpy.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(' '))
      .join('\n');

    expect(logged).not.toContain('sk-secret123');
    expect(logged).toContain('***');
  });

  it('does not print the raw x-api-key value', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockFetch = okFetch();

    await apiCall(
      {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        verbose: true,
        headers: { 'x-api-key': 'top-secret-api-key' },
      },
      { test: 'data' }
    );

    const logged = logSpy.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(' '))
      .join('\n');

    expect(logged).not.toContain('top-secret-api-key');
    expect(logged).toContain('***');
  });

  it('fully redacts cookie values containing spaces', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockFetch = okFetch();

    await apiCall(
      {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        verbose: true,
        headers: { Cookie: 'session=COOKIE_SECRET; theme=dark' },
      },
      { test: 'data' }
    );

    const logged = logSpy.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(' '))
      .join('\n');

    expect(logged).not.toContain('COOKIE_SECRET');
    expect(logged).toContain('"Cookie": "***"');
  });

  it('still sends the original credential to fetch', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockFetch = okFetch();

    await apiCall(
      {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        verbose: true,
        headers: { Authorization: 'Bearer sk-secret123' },
      },
      { test: 'data' }
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    expect((requestInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-secret123'
    );
  });
});
