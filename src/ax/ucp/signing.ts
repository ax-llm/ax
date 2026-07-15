import { getCrypto } from '../util/crypto.js';

export interface AxUCPHTTPMessageSignatureOptions {
  keyId: string;
  algorithm?: string;
  label?: string;
  components?: readonly (
    | '@method'
    | '@authority'
    | '@path'
    | '@query'
    | 'ucp-agent'
    | 'content-digest'
    | 'content-type'
    | 'request-id'
    | 'idempotency-key'
  )[];
  created?: () => number;
  nonce?: () => string;
  sign(
    signatureBase: Uint8Array,
    context: Readonly<{ signatureInput: string }>
  ): Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;
}

export type AxUCPHTTPMessageSignatureErrorCode =
  | 'signature_missing'
  | 'signature_invalid'
  | 'key_not_found'
  | 'digest_mismatch'
  | 'algorithm_unsupported'
  | 'signature_expired'
  | 'signature_replayed';

export class AxUCPHTTPMessageSignatureError extends Error {
  constructor(
    readonly code: AxUCPHTTPMessageSignatureErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AxUCPHTTPMessageSignatureError';
  }
}

export interface AxUCPHTTPMessageVerificationOptions {
  /** Reject responses without signature headers. */
  required?: boolean;
  /** Require a `created` signature parameter and limit its age. */
  maxAgeSeconds?: number;
  clockToleranceSeconds?: number;
  allowedAlgorithms?: readonly ('ES256' | 'ES384')[];
  now?: () => number;
  /** When enabled, reject re-use of a signature nonce or signature value. */
  replayProtection?: boolean;
}

type UCPJWK = JsonWebKey & { kid?: string; alg?: string; use?: string };

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function contentDigest(body: string): Promise<string> {
  const digest = await getCrypto().subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body)
  );
  return `sha-256=:${base64(new Uint8Array(digest))}:`;
}

export async function axSignUCPRequest(
  request: Readonly<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }>,
  options: Readonly<AxUCPHTTPMessageSignatureOptions>
): Promise<Record<string, string>> {
  const headers = new Headers(request.headers);
  if (request.body !== undefined) {
    if (!headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    headers.set('Content-Digest', await contentDigest(request.body));
  }
  const url = new URL(request.url);
  const components =
    options.components ??
    ([
      '@method',
      '@authority',
      '@path',
      ...(url.search ? (['@query'] as const) : []),
      ...(headers.has('ucp-agent') ? (['ucp-agent'] as const) : []),
      ...(headers.has('idempotency-key') ? (['idempotency-key'] as const) : []),
      ...(request.body !== undefined
        ? (['content-digest', 'content-type'] as const)
        : []),
    ] as const);
  const created = options.created?.() ?? Math.floor(Date.now() / 1000);
  const componentList = components.map((value) => `"${value}"`).join(' ');
  const parameters = [
    `(${componentList})`,
    `created=${created}`,
    `keyid="${options.keyId.replaceAll('"', '\\"')}"`,
    ...(options.algorithm ? [`alg="${options.algorithm}"`] : []),
    ...(options.nonce ? [`nonce="${options.nonce()}"`] : []),
  ].join(';');
  const valueFor = (component: (typeof components)[number]): string => {
    if (component === '@method') return request.method.toUpperCase();
    if (component === '@authority') return url.host;
    if (component === '@path') return url.pathname;
    if (component === '@query') return url.search;
    const value = headers.get(component);
    if (value === null) {
      throw new Error(`UCP signature component is missing: ${component}`);
    }
    return value;
  };
  const signatureBase = [
    ...components.map((component) => `"${component}": ${valueFor(component)}`),
    `"@signature-params": ${parameters}`,
  ].join('\n');
  const signed = await options.sign(new TextEncoder().encode(signatureBase), {
    signatureInput: parameters,
  });
  const label = options.label ?? 'sig1';
  return {
    ...Object.fromEntries(headers.entries()),
    'Signature-Input': `${label}=${parameters}`,
    Signature: `${label}=:${base64(
      signed instanceof Uint8Array ? signed : new Uint8Array(signed)
    )}:`,
  };
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new AxUCPHTTPMessageSignatureError(
      'signature_invalid',
      'UCP signature has invalid base64 encoding'
    );
  }
}

function parseSignatureInput(value: string): {
  label: string;
  components: readonly string[];
  parameters: string;
  keyId: string;
  algorithm?: string;
  created?: number;
  expires?: number;
  nonce?: string;
} {
  const match = value.match(
    /(?:^|,)\s*([A-Za-z][A-Za-z0-9_-]*)=\(([^)]*)\)((?:;[^,]*)?)/
  );
  if (!match?.[1] || match[2] === undefined) {
    throw new AxUCPHTTPMessageSignatureError(
      'signature_invalid',
      'UCP Signature-Input is malformed'
    );
  }
  const components = [...match[2].matchAll(/"([^"]+)"/g)].map(
    (item) => item[1]!
  );
  if (components.length === 0) {
    throw new AxUCPHTTPMessageSignatureError(
      'signature_invalid',
      'UCP Signature-Input has no covered components'
    );
  }
  const suffix = match[3] ?? '';
  const parameters = new Map<string, string>();
  for (const item of suffix.matchAll(
    /;([A-Za-z][A-Za-z0-9_-]*)=(?:"((?:\\.|[^"])*)"|(-?\d+)|([^;,\s]+))/g
  )) {
    parameters.set(item[1]!, (item[2] ?? item[3] ?? item[4])!);
  }
  const keyId = parameters.get('keyid');
  if (!keyId) {
    throw new AxUCPHTTPMessageSignatureError(
      'signature_invalid',
      'UCP Signature-Input is missing keyid'
    );
  }
  const number = (name: string): number | undefined => {
    const raw = parameters.get(name);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        `UCP signature parameter ${name} is invalid`
      );
    }
    return parsed;
  };
  return {
    label: match[1],
    components,
    parameters: `(${match[2]})${suffix}`,
    keyId: keyId.replaceAll('\\"', '"'),
    algorithm: parameters.get('alg'),
    created: number('created'),
    expires: number('expires'),
    nonce: parameters.get('nonce'),
  };
}

function parseSignature(value: string, label: string): Uint8Array {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.match(
    new RegExp(`(?:^|,)\\s*${escaped}=:([A-Za-z0-9+/=]+):`)
  );
  if (!match?.[1]) {
    throw new AxUCPHTTPMessageSignatureError(
      'signature_invalid',
      `UCP Signature is missing label ${label}`
    );
  }
  return decodeBase64(match[1]);
}

async function verifyContentDigest(body: string, header: string | null) {
  if (!header) {
    throw new AxUCPHTTPMessageSignatureError(
      'digest_mismatch',
      'UCP signed response is missing Content-Digest'
    );
  }
  const expected = await contentDigest(body);
  if (header !== expected) {
    throw new AxUCPHTTPMessageSignatureError(
      'digest_mismatch',
      'UCP response Content-Digest does not match the raw body'
    );
  }
}

/** Stateful RFC 9421 response verifier with profile-key rotation support. */
export class AxUCPHTTPMessageVerifier {
  private readonly seen = new Set<string>();

  constructor(
    private readonly options: Readonly<AxUCPHTTPMessageVerificationOptions> = {}
  ) {}

  async verify(
    response: Response,
    context: Readonly<{
      body: string;
      signingKeys: readonly Record<string, unknown>[];
      refreshSigningKeys?: () =>
        | readonly Record<string, unknown>[]
        | Promise<readonly Record<string, unknown>[]>;
    }>
  ): Promise<void> {
    const inputHeader = response.headers.get('Signature-Input');
    const signatureHeader = response.headers.get('Signature');
    if (!inputHeader || !signatureHeader) {
      if (!this.options.required) return;
      throw new AxUCPHTTPMessageSignatureError(
        'signature_missing',
        'UCP response signature is required'
      );
    }
    const input = parseSignatureInput(inputHeader);
    const signature = parseSignature(signatureHeader, input.label);
    const now = Math.floor((this.options.now?.() ?? Date.now()) / 1000);
    const tolerance = this.options.clockToleranceSeconds ?? 60;
    if (input.expires !== undefined && now > input.expires + tolerance) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_expired',
        'UCP response signature has expired'
      );
    }
    if (input.created !== undefined && input.created > now + tolerance) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        'UCP response signature creation time is in the future'
      );
    }
    if (this.options.maxAgeSeconds !== undefined) {
      if (
        input.created === undefined ||
        now - input.created > this.options.maxAgeSeconds + tolerance
      ) {
        throw new AxUCPHTTPMessageSignatureError(
          'signature_expired',
          'UCP response signature is too old or missing created'
        );
      }
    }
    if (!input.components.includes('@status')) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        'UCP response signature does not cover @status'
      );
    }
    if (context.body.length > 0) {
      if (
        !input.components.includes('content-digest') ||
        !input.components.includes('content-type')
      ) {
        throw new AxUCPHTTPMessageSignatureError(
          'signature_invalid',
          'UCP response signature does not cover body digest and content type'
        );
      }
      await verifyContentDigest(
        context.body,
        response.headers.get('Content-Digest')
      );
    }

    let keys = context.signingKeys as readonly UCPJWK[];
    let key = keys.find((candidate) => candidate.kid === input.keyId);
    if (!key && context.refreshSigningKeys) {
      keys = (await context.refreshSigningKeys()) as readonly UCPJWK[];
      key = keys.find((candidate) => candidate.kid === input.keyId);
    }
    if (!key) {
      throw new AxUCPHTTPMessageSignatureError(
        'key_not_found',
        `UCP signing key ${input.keyId} was not found`
      );
    }
    const algorithm = this.normalizeAlgorithm(input.algorithm ?? key.alg);
    if (key.alg && key.alg !== algorithm) {
      throw new AxUCPHTTPMessageSignatureError(
        'algorithm_unsupported',
        `UCP signing key algorithm ${key.alg} does not match ${algorithm}`
      );
    }
    const base = [
      ...input.components.map(
        (component) =>
          `"${component}": ${this.componentValue(component, response)}`
      ),
      `"@signature-params": ${input.parameters}`,
    ].join('\n');
    const curve = algorithm === 'ES256' ? 'P-256' : 'P-384';
    const hash = algorithm === 'ES256' ? 'SHA-256' : 'SHA-384';
    let valid = false;
    try {
      const publicKey = await getCrypto().subtle.importKey(
        'jwk',
        key,
        { name: 'ECDSA', namedCurve: curve },
        false,
        ['verify']
      );
      valid = await getCrypto().subtle.verify(
        { name: 'ECDSA', hash },
        publicKey,
        signature,
        new TextEncoder().encode(base)
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        'UCP response signature verification failed'
      );
    }
    if (this.options.replayProtection) {
      const replayKey = input.nonce
        ? `${input.keyId}:nonce:${input.nonce}`
        : `${input.keyId}:signature:${signatureHeader}`;
      if (this.seen.has(replayKey)) {
        throw new AxUCPHTTPMessageSignatureError(
          'signature_replayed',
          'UCP response signature was replayed'
        );
      }
      this.seen.add(replayKey);
    }
  }

  async verifyRequest(
    request: Request,
    context: Readonly<{
      body: string;
      signingKeys: readonly Record<string, unknown>[];
      refreshSigningKeys?: () =>
        | readonly Record<string, unknown>[]
        | Promise<readonly Record<string, unknown>[]>;
    }>
  ): Promise<void> {
    const inputHeader = request.headers.get('Signature-Input');
    const signatureHeader = request.headers.get('Signature');
    if (!inputHeader || !signatureHeader) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_missing',
        'UCP request signature is required'
      );
    }
    const input = parseSignatureInput(inputHeader);
    const signature = parseSignature(signatureHeader, input.label);
    const now = Math.floor((this.options.now?.() ?? Date.now()) / 1000);
    const tolerance = this.options.clockToleranceSeconds ?? 60;
    if (input.expires !== undefined && now > input.expires + tolerance) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_expired',
        'UCP request signature has expired'
      );
    }
    if (input.created !== undefined && input.created > now + tolerance) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        'UCP request signature creation time is in the future'
      );
    }
    if (
      this.options.maxAgeSeconds !== undefined &&
      (input.created === undefined ||
        now - input.created > this.options.maxAgeSeconds + tolerance)
    ) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_expired',
        'UCP request signature is too old or missing created'
      );
    }
    const url = new URL(request.url);
    const required = [
      '@method',
      '@authority',
      '@path',
      ...(url.search ? ['@query'] : []),
      ...(context.body.length > 0 ? ['content-digest', 'content-type'] : []),
    ];
    const missing = required.filter(
      (component) => !input.components.includes(component)
    );
    if (missing.length > 0) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        `UCP request signature does not cover ${missing.join(', ')}`
      );
    }
    if (context.body.length > 0) {
      await verifyContentDigest(
        context.body,
        request.headers.get('Content-Digest')
      );
    }
    let keys = context.signingKeys as readonly UCPJWK[];
    let key = keys.find((candidate) => candidate.kid === input.keyId);
    if (!key && context.refreshSigningKeys) {
      keys = (await context.refreshSigningKeys()) as readonly UCPJWK[];
      key = keys.find((candidate) => candidate.kid === input.keyId);
    }
    if (!key) {
      throw new AxUCPHTTPMessageSignatureError(
        'key_not_found',
        `UCP signing key ${input.keyId} was not found`
      );
    }
    const algorithm = this.normalizeAlgorithm(input.algorithm ?? key.alg);
    if (key.alg && key.alg !== algorithm) {
      throw new AxUCPHTTPMessageSignatureError(
        'algorithm_unsupported',
        `UCP signing key algorithm ${key.alg} does not match ${algorithm}`
      );
    }
    const valueFor = (component: string): string => {
      if (component === '@method') return request.method.toUpperCase();
      if (component === '@authority') return url.host;
      if (component === '@path') return url.pathname;
      if (component === '@query') return url.search;
      const value = request.headers.get(component);
      if (value === null) {
        throw new AxUCPHTTPMessageSignatureError(
          'signature_invalid',
          `UCP signed request component is missing: ${component}`
        );
      }
      return value;
    };
    const base = [
      ...input.components.map(
        (component) => `"${component}": ${valueFor(component)}`
      ),
      `"@signature-params": ${input.parameters}`,
    ].join('\n');
    const curve = algorithm === 'ES256' ? 'P-256' : 'P-384';
    const hash = algorithm === 'ES256' ? 'SHA-256' : 'SHA-384';
    let valid = false;
    try {
      const publicKey = await getCrypto().subtle.importKey(
        'jwk',
        key,
        { name: 'ECDSA', namedCurve: curve },
        false,
        ['verify']
      );
      valid = await getCrypto().subtle.verify(
        { name: 'ECDSA', hash },
        publicKey,
        signature,
        new TextEncoder().encode(base)
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        'UCP request signature verification failed'
      );
    }
    if (this.options.replayProtection) {
      const replayKey = input.nonce
        ? `${input.keyId}:nonce:${input.nonce}`
        : `${input.keyId}:signature:${signatureHeader}`;
      if (this.seen.has(replayKey)) {
        throw new AxUCPHTTPMessageSignatureError(
          'signature_replayed',
          'UCP request signature was replayed'
        );
      }
      this.seen.add(replayKey);
    }
  }

  clearReplayCache(): void {
    this.seen.clear();
  }

  private normalizeAlgorithm(value?: string): 'ES256' | 'ES384' {
    const normalized =
      value === 'ecdsa-p256-sha256'
        ? 'ES256'
        : value === 'ecdsa-p384-sha384'
          ? 'ES384'
          : value;
    if (
      (normalized !== 'ES256' && normalized !== 'ES384') ||
      !(this.options.allowedAlgorithms ?? ['ES256', 'ES384']).includes(
        normalized
      )
    ) {
      throw new AxUCPHTTPMessageSignatureError(
        'algorithm_unsupported',
        `UCP signature algorithm ${String(value)} is unsupported`
      );
    }
    return normalized;
  }

  private componentValue(component: string, response: Response): string {
    if (component === '@status') return String(response.status);
    const value = response.headers.get(component);
    if (value === null) {
      throw new AxUCPHTTPMessageSignatureError(
        'signature_invalid',
        `UCP signed response component is missing: ${component}`
      );
    }
    return value;
  }
}
