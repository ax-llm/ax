import { fetchJSON, stripTrailingSlash } from '../util/http.js';
import type { AxMCPSSRFProtectionOptions } from '../util/ssrf.js';

export function parseWWWAuthenticateForResourceMetadata(
  www: string | null
): string | null {
  if (!www) return null;
  const match =
    www.match(/resource_metadata\s*=\s*"([^"]+)"/i) ||
    www.match(/resource_metadata\s*=\s*([^,\s]+)/i);
  return match ? match[1] : null;
}

export function parseWWWAuthenticateScope(www: string | null): string[] {
  if (!www) return [];
  const match =
    www.match(/(?:^|,)\s*scope\s*=\s*"([^"]*)"/i) ??
    www.match(/(?:^|,)\s*scope\s*=\s*([^,\s]+)/i);
  return match?.[1]?.split(/\s+/).filter(Boolean) ?? [];
}

export async function discoverResourceAndAS(
  requestedUrl: string,
  wwwAuthenticate: string | null,
  ssrfProtection?: AxMCPSSRFProtectionOptions,
  fetcher?: typeof globalThis.fetch
): Promise<{ resource: string; issuers: string[] }> {
  const headerUrl = parseWWWAuthenticateForResourceMetadata(wwwAuthenticate);

  if (headerUrl) {
    const rsMeta = await fetchJSON<any>(headerUrl, undefined, {
      protection: ssrfProtection,
      context: 'oauth-resource-metadata',
      fetch: fetcher,
    });
    const rsResource = stripTrailingSlash(rsMeta.resource ?? '');
    if (
      !rsResource ||
      !isProtectedResourceForRequest(requestedUrl, rsResource)
    ) {
      throw new Error(
        `Protected resource metadata 'resource' ${rsResource || '<missing>'} does not cover requested URL ${requestedUrl}`
      );
    }
    const issuers: string[] = Array.isArray(rsMeta.authorization_servers)
      ? rsMeta.authorization_servers
      : [];
    if (issuers.length === 0) {
      throw new Error(
        'No authorization_servers advertised by protected resource'
      );
    }
    return { resource: rsResource, issuers };
  }

  // No header param; attempt well-known derivations with and without path component
  const u = new URL(requestedUrl);
  const trimmedPath = u.pathname.replace(/\/+$/, '');
  const candidates: Array<{ url: string; expected: string }> = [];
  if (trimmedPath && trimmedPath !== '/') {
    candidates.push({
      url: `${u.origin}/.well-known/oauth-protected-resource${trimmedPath}`,
      expected: `${u.origin}${trimmedPath}`,
    });
  }
  candidates.push({
    url: `${u.origin}/.well-known/oauth-protected-resource`,
    expected: `${u.origin}`,
  });

  let lastErr: unknown;
  for (const c of candidates) {
    try {
      const meta = await fetchJSON<any>(c.url, undefined, {
        protection: ssrfProtection,
        context: 'oauth-resource-metadata',
        fetch: fetcher,
      });
      const rsResource = stripTrailingSlash(meta.resource ?? '');
      const exp = stripTrailingSlash(c.expected);
      if (
        !rsResource ||
        !isProtectedResourceForRequest(c.expected, rsResource)
      ) {
        throw new Error(
          `Protected resource metadata 'resource' ${rsResource || '<missing>'} does not cover expected URL ${exp}`
        );
      }
      const issuers: string[] = Array.isArray(meta.authorization_servers)
        ? meta.authorization_servers
        : [];
      if (issuers.length === 0) {
        throw new Error(
          'No authorization_servers advertised by protected resource'
        );
      }
      return { resource: rsResource, issuers };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to resolve protected resource metadata via well-known endpoints. Last error: ${String(lastErr)}`
  );
}

function isProtectedResourceForRequest(
  requestedUrl: string,
  resource: string
): boolean {
  try {
    const requested = new URL(requestedUrl);
    const protectedResource = new URL(resource);
    if (requested.origin !== protectedResource.origin) return false;
    const resourcePath = protectedResource.pathname.replace(/\/+$/, '');
    const requestedPath = requested.pathname.replace(/\/+$/, '');
    if (!resourcePath || resourcePath === '/') return true;
    return (
      requestedPath === resourcePath ||
      requestedPath.startsWith(`${resourcePath}/`)
    );
  } catch {
    return false;
  }
}

export async function discoverASMetadata(
  issuer: string,
  ssrfProtection?: AxMCPSSRFProtectionOptions,
  options: Readonly<{ requireAuthorizationEndpoint?: boolean }> = {},
  fetcher?: typeof globalThis.fetch
): Promise<any> {
  const u = new URL(issuer);
  const path = u.pathname.replace(/^\/+/, '');
  const endpoints: string[] = [];
  if (path) {
    endpoints.push(
      `${u.origin}/.well-known/oauth-authorization-server/${path}`
    );
    endpoints.push(`${u.origin}/.well-known/openid-configuration/${path}`);
    endpoints.push(
      `${u.origin}/${path.replace(/\/+$/, '')}/.well-known/openid-configuration`
    );
  } else {
    endpoints.push(`${u.origin}/.well-known/oauth-authorization-server`);
    endpoints.push(`${u.origin}/.well-known/openid-configuration`);
  }

  let lastErr: unknown;
  for (const e of endpoints) {
    try {
      const meta = await fetchJSON<any>(e, undefined, {
        protection: ssrfProtection,
        context: 'oauth-authorization-server-metadata',
        fetch: fetcher,
      });
      if (
        !meta.token_endpoint ||
        (options.requireAuthorizationEndpoint !== false &&
          !meta.authorization_endpoint)
      ) {
        throw new Error('AS metadata missing endpoints');
      }
      const methods: string[] | undefined =
        meta.code_challenge_methods_supported;
      if (
        options.requireAuthorizationEndpoint !== false &&
        (!methods || !methods.includes('S256'))
      ) {
        throw new Error(
          'Authorization server does not advertise PKCE S256 support'
        );
      }
      return meta;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to discover AS metadata for ${issuer}: ${String(lastErr)}`
  );
}
