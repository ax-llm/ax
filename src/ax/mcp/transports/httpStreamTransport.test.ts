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
});
