export type AxMCPSSRFProtectionContext =
  | 'mcp-endpoint'
  | 'oauth-resource-metadata'
  | 'oauth-authorization-server-metadata'
  | 'oauth-authorization'
  | 'oauth-registration'
  | 'oauth-token'
  | 'redirect';

export interface AxMCPSSRFProtectionOptions {
  /**
   * Disable URL validation. Intended only for controlled development and test
   * environments.
   */
  disabled?: boolean;
  /** Allow plain HTTP. HTTPS is required by default. */
  allowHTTP?: boolean;
  /** Allow loopback hosts such as localhost, 127.0.0.1, and ::1. */
  allowLoopback?: boolean;
  /** Allow private, link-local, and otherwise reserved IP literal hosts. */
  allowPrivateNetwork?: boolean;
  /** Exact hostnames that should bypass host classification checks. */
  allowedHosts?: readonly string[];
  /**
   * Optional application-specific validator. Throw to reject the URL.
   * Use this for DNS pinning or deployment-specific egress policy.
   */
  validateURL?: (
    url: URL,
    context: AxMCPSSRFProtectionContext
  ) => void | Promise<void>;
}

export type AxMCPFetchOptions = RequestInit & {
  /** Host fetch implementation, including an mTLS-capable TLS stack if needed. */
  fetch?: typeof globalThis.fetch;
  ssrfProtection?: AxMCPSSRFProtectionOptions;
  ssrfContext?: AxMCPSSRFProtectionContext;
  maxRedirects?: number;
};

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function assertSSRFProtectedURL(
  input: string | URL,
  options: Readonly<{
    context: AxMCPSSRFProtectionContext;
    ssrfProtection?: AxMCPSSRFProtectionOptions;
  }>
): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input);
  const guard = options.ssrfProtection;
  if (guard?.disabled) return url;

  if (url.protocol !== 'https:') {
    if (!(guard?.allowHTTP && url.protocol === 'http:')) {
      throw new Error(
        `Blocked unsafe MCP URL for ${options.context}: expected https URL, got ${url.protocol}`
      );
    }
  }

  const host = normalizeHost(url.hostname);
  const allowedHosts = new Set(
    guard?.allowedHosts?.map((allowed) => normalizeHost(allowed)) ?? []
  );
  const hostAllowed = allowedHosts.has(host);

  if (!hostAllowed) {
    const classification = classifyHost(host);
    if (classification === 'loopback' && !guard?.allowLoopback) {
      throw new Error(
        `Blocked loopback MCP URL for ${options.context}: ${url.toString()}`
      );
    }
    if (
      classification !== 'public' &&
      classification !== 'loopback' &&
      !guard?.allowPrivateNetwork
    ) {
      throw new Error(
        `Blocked private or reserved MCP URL for ${options.context}: ${url.toString()}`
      );
    }
  }

  await guard?.validateURL?.(url, options.context);
  return url;
}

export async function fetchWithSSRFProtection(
  input: string | URL,
  options: AxMCPFetchOptions = {}
): Promise<Response> {
  const {
    ssrfProtection,
    ssrfContext = 'mcp-endpoint',
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    fetch: fetcher = globalThis.fetch,
    ...fetchOptions
  } = options;
  let current = await assertSSRFProtectedURL(input, {
    context: ssrfContext,
    ssrfProtection,
  });

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const response = await fetcher(current, {
      ...fetchOptions,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('Location');
    if (!location) {
      throw new Error(
        `Blocked MCP redirect for ${ssrfContext}: missing Location header`
      );
    }

    const method = (fetchOptions.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      throw new Error(
        `Blocked MCP redirect for ${ssrfContext}: redirects are not followed for ${method} requests`
      );
    }

    if (redirectCount === maxRedirects) {
      throw new Error(`Blocked MCP redirect for ${ssrfContext}: too many hops`);
    }

    current = await assertSSRFProtectedURL(new URL(location, current), {
      context: 'redirect',
      ssrfProtection,
    });
  }

  throw new Error(`Blocked MCP redirect for ${ssrfContext}: too many hops`);
}

function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  const withoutBrackets =
    lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
  return withoutBrackets.endsWith('.')
    ? withoutBrackets.slice(0, -1)
    : withoutBrackets;
}

type HostClassification =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'reserved';

function classifyHost(host: string): HostClassification {
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return 'loopback';
  }

  const ipv4 = parseIPv4(host);
  if (ipv4) return classifyIPv4(ipv4);

  const ipv6 = parseIPv6(host);
  if (ipv6 !== undefined) return classifyIPv6(ipv6);

  return 'public';
}

function parseIPv4(host: string): [number, number, number, number] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return;
  const nums = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    const n = Number.parseInt(part, 10);
    return n >= 0 && n <= 255 ? n : Number.NaN;
  });
  if (nums.some(Number.isNaN)) return;
  return nums as [number, number, number, number];
}

function classifyIPv4(
  ip: [number, number, number, number]
): HostClassification {
  const [a, b] = ip;
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 0) return 'reserved';
  if (a >= 224) return 'reserved';
  if (a === 100 && b >= 64 && b <= 127) return 'reserved';
  if (a === 192 && b === 0) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  return 'public';
}

function parseIPv6(host: string): bigint | undefined {
  if (!host.includes(':')) return;
  try {
    const segments = expandIPv6(host);
    if (!segments) return;
    return segments.reduce(
      (acc, segment) => (acc << 16n) + BigInt(segment),
      0n
    );
  } catch {
    return;
  }
}

function expandIPv6(host: string): number[] | undefined {
  const ipv4Match = host.match(/(.+):(\d+\.\d+\.\d+\.\d+)$/);
  let working = host;
  let ipv4Segments: number[] = [];
  if (ipv4Match) {
    const ipv4 = parseIPv4(ipv4Match[2]!);
    if (!ipv4) return;
    working = ipv4Match[1]!;
    ipv4Segments = [(ipv4[0] << 8) + ipv4[1], (ipv4[2] << 8) + ipv4[3]];
  }

  const halves = working.split('::');
  if (halves.length > 2) return;

  const parsePart = (part: string): number[] => {
    if (!part) return [];
    return part.split(':').map((segment) => {
      if (!/^[0-9a-f]{1,4}$/i.test(segment)) throw new Error('invalid ipv6');
      return Number.parseInt(segment, 16);
    });
  };

  const left = parsePart(halves[0]!);
  const right = halves.length === 2 ? parsePart(halves[1]!) : [];
  const total = left.length + right.length + ipv4Segments.length;
  if (halves.length === 1 && total !== 8) return;
  if (halves.length === 2 && total >= 8) return;
  const zeros = new Array(8 - total).fill(0);
  const expanded = [...left, ...zeros, ...right, ...ipv4Segments];
  return expanded.length === 8 ? expanded : undefined;
}

function classifyIPv6(value: bigint): HostClassification {
  if (value === 0n) return 'reserved';
  if (value === 1n) return 'loopback';
  if (value >> 120n === 0xffn) return 'reserved';
  if (value >> 121n === 0x7en) return 'private'; // fc00::/7
  if (value >> 118n === 0x3fan) return 'link-local'; // fe80::/10
  if (value >> 32n === 0xffffn) {
    const a = Number((value >> 24n) & 0xffn);
    const b = Number((value >> 16n) & 0xffn);
    const c = Number((value >> 8n) & 0xffn);
    const d = Number(value & 0xffn);
    return classifyIPv4([a, b, c, d]);
  }
  return 'public';
}
