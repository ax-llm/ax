import { describe, expect, it } from 'vitest';

import {
  AX_MCP_META_KEYS,
  axMCPBuildRequestMeta,
  axMCPServerInfoFromMeta,
} from './meta.js';

describe('MCP modern request metadata', () => {
  it('injects required protocol metadata and preserves caller metadata', () => {
    expect(
      axMCPBuildRequestMeta({
        protocolVersion: '2026-07-28',
        clientCapabilities: { roots: {} },
        clientInfo: { name: 'test-client', version: '1.0.0' },
        logLevel: 'warning',
        traceparent: '00-abc-def-01',
        existing: { progressToken: 'progress-1' },
      })
    ).toEqual({
      progressToken: 'progress-1',
      [AX_MCP_META_KEYS.PROTOCOL_VERSION]: '2026-07-28',
      [AX_MCP_META_KEYS.CLIENT_CAPABILITIES]: { roots: {} },
      [AX_MCP_META_KEYS.CLIENT_INFO]: {
        name: 'test-client',
        version: '1.0.0',
      },
      [AX_MCP_META_KEYS.LOG_LEVEL]: 'warning',
      traceparent: '00-abc-def-01',
    });
  });

  it('reads only well-formed server identity metadata', () => {
    expect(
      axMCPServerInfoFromMeta({
        [AX_MCP_META_KEYS.SERVER_INFO]: {
          name: 'server',
          version: '2.0.0',
        },
      })
    ).toEqual({ name: 'server', version: '2.0.0' });
    expect(
      axMCPServerInfoFromMeta({
        [AX_MCP_META_KEYS.SERVER_INFO]: { name: 'server' },
      })
    ).toBeUndefined();
  });
});
