import { fetchJSON, stripTrailingSlash } from '../util/http.js';

/**
 * Extracts the resource_metadata URL from a WWW-Authenticate header value.
 * Supports both quoted and unquoted parameter formats.
 * @param www - The WWW-Authenticate header value to parse
 * @returns The extracted resource_metadata URL, or null if not found
 */
export function parseWWWAuthenticateForResourceMetadata(
  www: string | null
): string | null {
  if (!www) return null;
  const match =
    www.match(/resource_metadata\s*=\s*"([^"]+)"/i) ||
    www.match(/resource_metadata\s*=\s*([^,\s]+)/i);
  return match ? match[1] : null;
}

/**
 * Discovers the protected resource identifier and its authorization servers.
 * First attempts to use the resource_metadata URL from the WWW-Authenticate header.
 * If not available, falls back to trying well-known endpoints with and without path components.
 * Validates that the discovered resource matches the requested URL and that authorization servers are advertised.
 * @param requestedUrl - The URL of the protected resource being accessed
 * @param wwwAuthenticate - The WWW-Authenticate header value from the response
 * @returns An object containing the resource identifier and array of issuer URLs
 * @throws {Error} If resource metadata cannot be discovered or validation fails
 */
export async function discoverResourceAndAS(
  requestedUrl: string,
  wwwAuthenticate: string | null
): Promise<{ resource: string; issuers: string[] }> {
  const headerUrl = parseWWWAuthenticateForResourceMetadata(wwwAuthenticate);

  if (headerUrl) {
    const rsMeta = await fetchJSON<any>(headerUrl);
    const expectedResource = stripTrailingSlash(
      new URL(requestedUrl).toString().split('?')[0]!
    );
    const rsResource = stripTrailingSlash(rsMeta.resource ?? '');
    if (!rsResource || rsResource !== expectedResource) {
      throw new Error(
        `Protected resource metadata 'resource' mismatch. Expected ${expectedResource} but got ${rsResource}`
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
    return { resource: expectedResource, issuers };
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
      const meta = await fetchJSON<any>(c.url);
      const rsResource = stripTrailingSlash(meta.resource ?? '');
      const exp = stripTrailingSlash(c.expected);
      if (!rsResource || rsResource !== exp) {
        throw new Error(
          `Protected resource metadata 'resource' mismatch. Expected ${exp} but got ${rsResource}`
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
      return { resource: exp, issuers };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to resolve protected resource metadata via well-known endpoints. Last error: ${String(lastErr)}`
  );
}

/**
 * Discovers authorization server metadata by attempting multiple well-known endpoint patterns.
 * Tries OAuth authorization server and OpenID configuration endpoints with various path combinations.
 * Validates that the metadata includes required endpoints and PKCE S256 support.
 * @param issuer - The authorization server issuer URL
 * @returns The authorization server metadata object
 * @throws {Error} If metadata cannot be discovered or validation fails
 */
export async function discoverASMetadata(issuer: string): Promise<any> {
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
      const meta = await fetchJSON<any>(e);
      if (!meta.authorization_endpoint || !meta.token_endpoint) {
        throw new Error('AS metadata missing endpoints');
      }
      const methods: string[] | undefined =
        meta.code_challenge_methods_supported;
      if (!methods || !methods.includes('S256')) {
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
