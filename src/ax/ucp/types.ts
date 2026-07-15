import type { AxMCPOAuthOptions, AxMCPTokenSet } from '../mcp/oauth/types.js';
import type { AxMCPStreamableHTTPTransportOptions } from '../mcp/transports/options.js';
import type { AxUCPSchemaValidationOptions } from './schema.js';
import type {
  AxUCPHTTPMessageSignatureOptions,
  AxUCPHTTPMessageVerificationOptions,
} from './signing.js';

export const AX_UCP_VERSION = '2026-04-08';
export const AX_UCP_SHOPPING_SERVICE = 'dev.ucp.shopping';
export const AX_UCP_OPERATIONS = [
  'search_catalog',
  'lookup_catalog',
  'get_product',
  'create_cart',
  'get_cart',
  'update_cart',
  'cancel_cart',
  'create_checkout',
  'get_checkout',
  'update_checkout',
  'complete_checkout',
  'cancel_checkout',
  'get_order',
] as const;
export type AxUCPOperation = (typeof AX_UCP_OPERATIONS)[number] | (string & {});
export const AX_UCP_OPERATION_CAPABILITY: Readonly<Record<string, string>> = {
  search_catalog: 'dev.ucp.shopping.catalog.search',
  lookup_catalog: 'dev.ucp.shopping.catalog.lookup',
  get_product: 'dev.ucp.shopping.catalog.lookup',
  create_cart: 'dev.ucp.shopping.cart',
  get_cart: 'dev.ucp.shopping.cart',
  update_cart: 'dev.ucp.shopping.cart',
  cancel_cart: 'dev.ucp.shopping.cart',
  create_checkout: 'dev.ucp.shopping.checkout',
  get_checkout: 'dev.ucp.shopping.checkout',
  update_checkout: 'dev.ucp.shopping.checkout',
  complete_checkout: 'dev.ucp.shopping.checkout',
  cancel_checkout: 'dev.ucp.shopping.checkout',
  get_order: 'dev.ucp.shopping.order',
};

export type AxUCPTransportKind = 'mcp' | 'rest';
export type AxUCPValue = Record<string, unknown>;

export interface AxUCPVersionedDeclaration {
  version: string;
  spec?: string;
  schema?: string;
  extends?: string | readonly string[];
  [key: string]: unknown;
}

export interface AxUCPService extends AxUCPVersionedDeclaration {
  transport: AxUCPTransportKind;
  endpoint: string;
}

export interface AxUCPPaymentHandler extends AxUCPVersionedDeclaration {
  id: string;
  available_instruments?: readonly AxUCPValue[];
  config?: AxUCPValue;
}

export interface AxUCPProfileBody {
  version: string;
  supported_versions?: Record<string, string>;
  services: Record<string, readonly AxUCPService[]>;
  capabilities: Record<string, readonly AxUCPVersionedDeclaration[]>;
  payment_handlers?: Record<string, readonly AxUCPPaymentHandler[]>;
}

export interface AxUCPProfile {
  ucp: AxUCPProfileBody;
  signing_keys?: readonly AxUCPValue[];
}

export interface AxUCPNegotiatedProfile {
  version: string;
  service: AxUCPService;
  capabilities: Record<string, readonly AxUCPVersionedDeclaration[]>;
  paymentHandlers: Record<string, readonly AxUCPPaymentHandler[]>;
  signingKeys: readonly AxUCPValue[];
  businessProfile: AxUCPProfile;
}

export interface AxUCPMessage {
  type: 'error' | 'warning' | 'info';
  code?: string;
  content: string;
  severity?: 'recoverable' | 'unrecoverable';
  [key: string]: unknown;
}

export interface AxUCPResponseMetadata {
  version: string;
  status?: 'success' | 'error';
  capabilities?: Record<string, readonly AxUCPVersionedDeclaration[]>;
  payment_handlers?: Record<string, readonly AxUCPPaymentHandler[]>;
  [key: string]: unknown;
}

export interface AxUCPOutcome extends AxUCPValue {
  ucp: AxUCPResponseMetadata;
  messages?: readonly AxUCPMessage[];
  continue_url?: string;
}

export interface AxUCPCallOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface AxUCPClientOptions {
  /** Business origin or explicit /.well-known/ucp profile URL. */
  profileUrl: string;
  /** Public platform profile URL injected into every request. */
  agentProfile: string;
  namespace?: string;
  version?: string;
  transport?: 'auto' | AxUCPTransportKind;
  platformCapabilities?: Record<string, readonly AxUCPVersionedDeclaration[]>;
  headers?: Record<string, string>;
  mcp?: AxMCPStreamableHTTPTransportOptions;
  /** Built-in RFC 9421 header construction with caller-provided key signing. */
  httpMessageSignature?: AxUCPHTTPMessageSignatureOptions;
  /** Built-in RFC 9421 response verification using business profile keys. */
  httpMessageVerification?: AxUCPHTTPMessageVerificationOptions;
  /** Compatibility mode for UCP MCP endpoints that reject initialize. */
  skipMCPInitialization?: boolean;
  /** Optional request signer. Return additional or replacement headers. */
  signRequest?: (
    request: Readonly<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    }>
  ) => Record<string, string> | Promise<Record<string, string>>;
  /** Optional response verifier for RFC 9421 or deployment-specific policy. */
  verifyResponse?: (
    response: Response,
    context: Readonly<{ profile: AxUCPNegotiatedProfile }>
  ) => void | Promise<void>;
  /** OAuth/PKCE account linking used after UCP identity challenges. */
  identityLinkingOAuth?: AxMCPOAuthOptions;
  /** Host-managed user identity token for pre-authorized commerce calls. */
  getIdentityToken?: () => AxMCPTokenSet | null | Promise<AxMCPTokenSet | null>;
  /** Additional business profile URLs trusted to sign lifecycle webhooks. */
  trustedBusinessProfileUrls?: readonly string[];
  webhookMaxAgeSeconds?: number;
  /** Marks a configured endpoint as an evaluation sandbox or replay source. */
  evaluationMode?: 'live' | 'replay' | 'sandbox';
  /** Validate outcomes against negotiated capability schema documents. */
  schemaValidation?: false | AxUCPSchemaValidationOptions;
}

export interface AxUCPBuyerContext extends AxUCPValue {
  country?: string;
  region?: string;
  postal_code?: string;
}

export interface AxUCPAttribution extends AxUCPValue {
  source?: string;
  medium?: string;
  campaign?: string;
  click_id?: string;
}

export interface AxUCPDiscounts extends AxUCPValue {
  codes?: readonly string[];
  applied?: readonly AxUCPValue[];
}

export interface AxUCPFulfillment extends AxUCPValue {
  methods?: readonly AxUCPValue[];
  groups?: readonly AxUCPValue[];
  destinations?: readonly AxUCPValue[];
}

export interface AxUCPPayment extends AxUCPValue {
  instruments?: readonly AxUCPValue[];
  handlers?: readonly AxUCPPaymentHandler[];
}

export interface AxUCPCartInput extends AxUCPValue {
  line_items?: readonly AxUCPValue[];
  context?: AxUCPBuyerContext;
  attribution?: AxUCPAttribution;
  discounts?: AxUCPDiscounts;
}

export interface AxUCPCheckoutInput extends AxUCPValue {
  line_items?: readonly AxUCPValue[];
  buyer?: AxUCPValue;
  context?: AxUCPBuyerContext;
  attribution?: AxUCPAttribution;
  discounts?: AxUCPDiscounts;
  fulfillment?: AxUCPFulfillment;
  payment?: AxUCPPayment;
}

export interface AxUCPCheckoutCompletion extends AxUCPValue {
  payment?: AxUCPPayment;
  signals?: AxUCPValue;
}

export interface AxUCPIdentityLinkingConfig extends AxUCPValue {
  scopes?: Record<string, AxUCPValue>;
  providers?: readonly AxUCPValue[];
}

export interface AxUCPOrderEvent extends AxUCPOutcome {
  id: string;
  checkout_id: string;
  event_id?: string;
  created_time?: string;
}

export interface AxUCPCatalogSearchRequest extends AxUCPValue {
  query?: string;
  context?: AxUCPValue;
  signals?: AxUCPValue;
  attribution?: AxUCPValue;
  filters?: AxUCPValue;
  pagination?: AxUCPValue;
}

export interface AxUCPCatalogLookupRequest extends AxUCPValue {
  ids: readonly string[];
  context?: AxUCPValue;
  filters?: AxUCPValue;
}

export interface AxUCPProductRequest extends AxUCPValue {
  id: string;
  selected?: readonly AxUCPValue[];
  preferences?: readonly string[];
  context?: AxUCPValue;
}
