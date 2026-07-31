import { createBackendClient } from '@pipedream/sdk/server';

import { AxMCPClient } from '../src/ax/mcp/client.js';
import { AxMCPStreamableHTTPTransport } from '../src/ax/mcp/transports/httpStreamTransport.js';
import { AxMCPRecordingTransport } from '../src/ax/mcp/transports/recordingTransport.js';

interface Target {
  name: string;
  endpoint: string;
  headers?: Readonly<Record<string, string>>;
  authorization?: string;
}

const targets: Target[] = [
  {
    name: 'DeepWiki',
    endpoint: 'https://mcp.deepwiki.com/mcp',
  },
  {
    name: 'Cloudflare Docs',
    endpoint: 'https://docs.mcp.cloudflare.com/mcp',
  },
];

const pipedream = await pipedreamTarget();
if (pipedream.kind === 'target') targets.unshift(pipedream.target);
else console.log(`SKIP Pipedream: ${pipedream.reason}`);

let failures = 0;
for (const target of targets) {
  const reachable = await endpointReachable(target.endpoint);
  if (!reachable.ok) {
    console.log(`SKIP ${target.name}: unreachable (${reachable.reason})`);
    continue;
  }
  const recording = new AxMCPRecordingTransport(
    new AxMCPStreamableHTTPTransport(target.endpoint, {
      ...(target.headers ? { headers: target.headers } : {}),
      ...(target.authorization ? { authorization: target.authorization } : {}),
    })
  );
  const client = new AxMCPClient(recording, {
    namespace: target.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    era: 'auto',
  });
  try {
    const catalog = await client.inspectCatalog();
    if (catalog.tools.length === 0) {
      throw new Error('reachable server returned an empty tool catalog');
    }
    console.log(
      `PASS ${target.name}: era=${client.getEra()} version=${catalog.protocolVersion ?? 'modern-default'} tools=${catalog.tools.length} prompts=${catalog.prompts.length} resources=${catalog.resources.length}`
    );
  } catch (error) {
    failures++;
    console.error(
      `FAIL ${target.name}: era=${client.getEra() ?? 'unclassified'} version=${client.getProtocolVersion() ?? 'none'} capabilities=${Object.keys(client.getServerCapabilities()).join(',') || 'none'} methods=${recording
        .getRecording()
        .filter((entry) => entry.direction === 'request')
        .map((entry) => entry.message.method)
        .join(',')} ${errorMessage(error)}`
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

if (failures > 0) process.exitCode = 1;

async function pipedreamTarget(): Promise<
  { kind: 'target'; target: Target } | { kind: 'skip'; reason: string }
> {
  const clientId = process.env.PIPEDREAM_CLIENT_ID;
  const clientSecret = process.env.PIPEDREAM_CLIENT_SECRET;
  const projectId = process.env.PIPEDREAM_PROJECT_ID;
  const environment = process.env.PIPEDREAM_ENVIRONMENT ?? 'development';
  if (!clientId || !clientSecret || !projectId) {
    return {
      kind: 'skip',
      reason:
        'set PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET, and PIPEDREAM_PROJECT_ID',
    };
  }
  try {
    const client = createBackendClient({
      environment,
      credentials: { clientId, clientSecret },
      projectId,
    });
    let appSlug = process.env.PIPEDREAM_APP_SLUG;
    if (!appSlug) {
      const apps = await client.getApps({ q: 'notion' });
      appSlug = apps.data[0]?.name_slug;
    }
    if (!appSlug) {
      return { kind: 'skip', reason: 'no Pipedream app slug is available' };
    }
    const token = await client.rawAccessToken();
    return {
      kind: 'target',
      target: {
        name: 'Pipedream',
        endpoint: 'https://remote.mcp.pipedream.net',
        authorization: `Bearer ${token}`,
        headers: {
          'x-pd-project-id': projectId,
          'x-pd-environment': environment,
          'x-pd-external-user-id':
            process.env.PIPEDREAM_EXTERNAL_USER_ID ?? 'ax-mcp-interop',
          'x-pd-app-slug': appSlug,
        },
      },
    };
  } catch (error) {
    return {
      kind: 'skip',
      reason: `credential setup failed (${errorMessage(error)})`,
    };
  }
}

async function endpointReachable(
  endpoint: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await fetch(endpoint, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
