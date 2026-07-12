import { afterEach, describe, expect, it, vi } from 'vitest';

import { AxMCPStreamableHTTPTransport } from './httpStreamTransport.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    status: init?.status ?? 200,
    headers,
  });
}

function sseResponse(events: string): Response {
  return new Response(events, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('AxMCPStreamableHTTPTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses protocol and session headers only after negotiation', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { jsonrpc: '2.0', id: 'init', result: {} },
        { headers: { 'MCP-Session-Id': 'session-1' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp',
      {
        authorization: 'Bearer test',
      }
    );

    await transport.send({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {},
    });
    transport.setProtocolVersion('2025-11-25');
    await transport.sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;

    expect(firstHeaders.Authorization).toBe('Bearer test');
    expect(firstHeaders['MCP-Protocol-Version']).toBeUndefined();
    expect(secondHeaders['MCP-Protocol-Version']).toBe('2025-11-25');
    expect(secondHeaders['MCP-Session-Id']).toBe('session-1');
  });

  it('parses POST SSE responses and forwards server notifications', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(
        [
          'event: message',
          'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"hello"}}',
          '',
          'id: event-1',
          'event: message',
          'data: {"jsonrpc":"2.0","id":"req-1","result":{"ok":true}}',
          '',
        ].join('\n')
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp'
    );
    const messages: unknown[] = [];
    transport.setMessageHandler((message) => {
      messages.push(message);
    });

    const response = await transport.send({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'tools/list',
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { ok: true },
    });
    expect(messages).toEqual([
      {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', data: 'hello' },
      },
    ]);
  });

  it('rejects SSE streams that end before a response is received', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          [
            'event: message',
            'data: {"jsonrpc":"2.0","method":"notifications/message"}',
            '',
          ].join('\n')
        )
      )
    );

    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp'
    );

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'tools/list',
      })
    ).rejects.toThrow(/ended before MCP response/);
  });

  it('resumes POST SSE streams after empty priming events', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return sseResponse(['id: event-0', 'retry: 0', 'data:', ''].join('\n'));
      }
      return sseResponse(
        [
          'id: event-1',
          'event: message',
          'data: {"jsonrpc":"2.0","id":"req-1","result":{"ok":true}}',
          '',
        ].join('\n')
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp'
    );

    const response = await transport.send({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'tools/list',
    });

    const secondCall = fetchMock.mock.calls[1]?.[1];
    const secondHeaders = secondCall?.headers as Record<string, string>;

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { ok: true },
    });
    expect(secondCall?.method).toBe('GET');
    expect(secondHeaders['Last-Event-ID']).toBe('event-0');
  });

  it('guards configured endpoints by default', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const transport = new AxMCPStreamableHTTPTransport('https://10.0.0.1/mcp');

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'initialize',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows explicit local development endpoint exceptions', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 'init', result: {} })
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new AxMCPStreamableHTTPTransport(
      'http://localhost:8787/mcp',
      {
        ssrfProtection: { allowHTTP: true, allowLoopback: true },
      }
    );

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'init',
        method: 'initialize',
      })
    ).resolves.toMatchObject({ id: 'init' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries safe requests using HTTP-date Retry-After', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        return new Response('', {
          status: 503,
          headers: { 'Retry-After': new Date(Date.now()).toUTCString() },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: 'list-1', result: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp',
      { retry: { maxAttempts: 2, baseDelayMs: 0 } }
    );

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'list-1',
        method: 'tools/list',
      })
    ).resolves.toMatchObject({ id: 'list-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry ambiguous tools/call requests', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp',
      { retry: { maxAttempts: 3, baseDelayMs: 0 } }
    );

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'mutate' },
      })
    ).rejects.toThrow('HTTP error 503');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('enforces configured response-size limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 'large-1',
          result: { value: 'x'.repeat(200) },
        })
      )
    );
    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp',
      { maxResponseBytes: 64 }
    );
    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'large-1',
        method: 'tools/list',
      })
    ).rejects.toThrow('exceeded 64 bytes');
  });

  it('sends and correlates legacy 2025-03-26 JSON-RPC batches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const requests = JSON.parse(String(init?.body)) as Array<{
          id: string;
          method: string;
        }>;
        return jsonResponse(
          requests.toReversed().map((request) => ({
            jsonrpc: '2.0',
            id: request.id,
            result: { method: request.method },
          }))
        );
      })
    );
    const transport = new AxMCPStreamableHTTPTransport(
      'https://mcp.example/mcp'
    );
    transport.setProtocolVersion('2025-03-26');

    await expect(
      transport.sendBatch([
        { jsonrpc: '2.0', id: 'one', method: 'tools/list' },
        { jsonrpc: '2.0', id: 'two', method: 'prompts/list' },
      ])
    ).resolves.toEqual([
      { jsonrpc: '2.0', id: 'one', result: { method: 'tools/list' } },
      { jsonrpc: '2.0', id: 'two', result: { method: 'prompts/list' } },
    ]);
    transport.setProtocolVersion('2025-06-18');
    await expect(
      transport.sendBatch([
        { jsonrpc: '2.0', id: 'three', method: 'tools/list' },
      ])
    ).rejects.toThrow('batching is not allowed');
  });
});
