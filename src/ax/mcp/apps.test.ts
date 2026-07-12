import { describe, expect, it, vi } from 'vitest';
import {
  AX_MCP_APP_RESOURCE_MIME_TYPE,
  AxMCPAppBridge,
  axMCPToolVisibleTo,
} from './apps.js';
import type { AxMCPClient } from './client.js';
import type { AxMCPTool } from './types.js';

function tool(
  name: string,
  visibility: readonly ('model' | 'app')[] = ['model', 'app']
): AxMCPTool {
  return {
    name,
    inputSchema: { type: 'object' },
    _meta: {
      ui: {
        resourceUri: 'ui://example/dashboard',
        visibility,
      },
    },
  };
}

describe('MCP Apps host bridge', () => {
  it('loads validated UI resources and constructs restrictive sandbox policy', async () => {
    const tools = [tool('dashboard'), tool('app_only', ['app'])];
    const client = {
      getTools: () => tools,
      getNamespace: () => 'weather',
      readResource: vi.fn(async () => ({
        contents: [
          {
            uri: 'ui://example/dashboard',
            mimeType: AX_MCP_APP_RESOURCE_MIME_TYPE,
            text: '<!doctype html><html><body>Weather</body></html>',
            _meta: {
              ui: {
                csp: {
                  connectDomains: ['https://api.example.com'],
                  resourceDomains: ['https://cdn.example.com'],
                },
                permissions: { clipboardWrite: {} },
              },
            },
          },
        ],
      })),
      callTool: vi.fn(async (name: string) => ({
        structuredContent: { called: name },
      })),
    } as unknown as AxMCPClient;
    const bridge = new AxMCPAppBridge({ client, tool: 'dashboard' });

    const resource = await bridge.loadResource();

    expect(resource).toMatchObject({
      uri: 'ui://example/dashboard',
      sandbox: 'allow-scripts allow-same-origin',
      permissionPolicy: 'clipboard-write',
    });
    expect(resource.contentSecurityPolicy).toContain("default-src 'none'");
    expect(resource.contentSecurityPolicy).toContain(
      "connect-src 'self' https://api.example.com"
    );
    expect(axMCPToolVisibleTo(tools[1]!, 'model')).toBe(false);
    expect(axMCPToolVisibleTo(tools[1]!, 'app')).toBe(true);
  });

  it('negotiates lifecycle and proxies only same-session app-visible tools', async () => {
    const tools = [tool('dashboard'), tool('app_only', ['app'])];
    const callTool = vi.fn(async (name: string) => ({
      structuredContent: { called: name },
    }));
    const updateModelContext = vi.fn();
    const client = {
      getTools: () => tools,
      getNamespace: () => 'weather',
      callTool,
    } as unknown as AxMCPClient;
    const bridge = new AxMCPAppBridge({
      client,
      tool: 'dashboard',
      updateModelContext,
      authorize: () => true,
    });

    await expect(
      bridge.handleViewMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: { appCapabilities: {} },
      })
    ).resolves.toMatchObject({ result: { hostCapabilities: {} } });
    await bridge.handleViewMessage({
      jsonrpc: '2.0',
      method: 'ui/notifications/initialized',
      params: {},
    });
    await expect(
      bridge.handleViewMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'app_only', arguments: { location: 'Vancouver' } },
      })
    ).resolves.toMatchObject({
      result: { structuredContent: { called: 'app_only' } },
    });
    await bridge.handleViewMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'ui/update-model-context',
      params: { structuredContent: { selection: 'rain' } },
    });

    expect(callTool).toHaveBeenCalledWith('app_only', {
      location: 'Vancouver',
    });
    expect(updateModelContext).toHaveBeenCalledWith({
      structuredContent: { selection: 'rain' },
      untrusted: true,
      source: { kind: 'mcp-app', namespace: 'weather', tool: 'dashboard' },
    });
  });
});
