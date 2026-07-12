# MCP and UCP parity ledger

This ledger maps the standards report supplied for the comparison client to Ax
source and verification. `Implemented` means the behavior has an executable Ax
path and focused test. `Partial` means an API or protocol primitive exists but
one or more normative flows still need conformance coverage. `Pending` means it
is not yet implemented and must not be advertised as supported.

The target is MCP `2025-11-25`, the current official extensions, and UCP
`2026-04-08`. This is a living acceptance artifact, not a release claim.

| Area | Capability from supplied client report | Ax status | Source and verification |
| --- | --- | --- | --- |
| MCP lifecycle | Version negotiation and returned-version validation | Implemented | `src/ax/mcp/client.ts`, `client.test.ts`, AxIR `axmcp/protocol-negotiation-rejects.json` |
| MCP lifecycle | Server info, instructions, and capabilities | Implemented | `AxMCPClient` catalog getters and capability gates |
| MCP lifecycle | Public ping and initialized notification | Implemented | `client.ts`, AxIR initialize/ping fixtures |
| MCP lifecycle | Server requests and notifications | Implemented | roots, sampling, elicitation, progress, logging, catalog changes, task status tests |
| Transport | Streamable HTTP JSON and finite SSE responses | Implemented | `httpStreamTransport.ts` and focused transport tests |
| Transport | Persistent/resumable SSE and `Last-Event-ID` | Implemented | Streamable HTTP listening/reconnect paths |
| Transport | Legacy HTTP/SSE | Implemented | `sseTransport.ts` and legacy fallback |
| Transport | stdio | Implemented | TypeScript and generated-language MCP packages/AxIR fixtures |
| Transport | Custom WebSocket | Implemented | `webSocketTransport.ts` and multiplexing test |
| Transport | Cross-operation session reuse and DELETE termination | Implemented | caller-owned client lifecycle and `close()` transport hooks |
| Transport | Concurrent response dispatch | Implemented | pending response maps in HTTP/WebSocket transports |
| Transport | Version-gated JSON-RPC batching | Implemented | `AxMCPClient.batch()` plus HTTP/WebSocket correlation tests; rejected for `2025-06-18` and later |
| Transport | Timeouts, response limits, redirect bounds | Implemented | HTTP transport adversarial tests |
| Transport | Safe retries, HTTP-date `Retry-After`, 502/504 | Implemented | idempotent method policy and transport tests |
| Transport | Session-expiry recovery | Implemented | safe requests reinitialize/retry; ambiguous side-effecting calls are never replayed |
| Tools | Paginated list and raw call results | Implemented | bounded/repeated-cursor tests and native raw-result AxIR fixture |
| Tools | Title, icons, annotations, output schema, task metadata | Implemented | retained in `AxMCPTool` and native binding protocol identity |
| Tools | Authorization from annotations and arguments | Implemented | `authorizeToolCall` and denial tests |
| Tools | Per-server concurrency limits | Implemented | semaphore and focused concurrency test |
| Tools | Destructive/non-idempotent serialization | Implemented | annotation-driven serialization test |
| Content | Text, image, audio, resource links, embedded resources | Implemented | native content types, prompt/resource mapping, raw protocol memory |
| Content | Provider-specific multimodal tool-result mapping | Implemented | native Anthropic, Gemini, and OpenAI Responses mappings plus adapter-local OpenAI Chat degradation |
| Prompts | list/get, pagination, arguments, change notification | Implemented | client discovery and notification tests |
| Resources | list/read/templates/subscriptions/updates | Implemented | client APIs, runtime modules, and tests |
| Completion | `completion/complete` | Implemented | client and AxAgent runtime module |
| Logging | logging level and server messages | Implemented | client APIs and callbacks |
| Roots | capability negotiation and `roots/list` | Implemented | server-request test and AxIR fixture |
| Sampling | server `sampling/createMessage` | Implemented | handler types, response dispatch, and tests |
| Elicitation | form and URL modes | Implemented | typed handler and server-request tests |
| Progress | progress notifications | Implemented | callbacks and streaming-safe dispatch |
| Tasks | create/list/get/result/cancel/wait/status | Implemented | client task registry and terminal-state tests |
| Tasks | Persist/rebind remote tasks across serialized runs | Implemented | logical task/subscription state in `AxAgentState`; namespace rebind and remote revalidation test |
| Ax integration | AxGen and streaming AxGen | Implemented | shared context, native bindings, raw result memory, catalog refresh tests |
| Ax integration | High-level chat loop | Implemented | `mcp/chat.ts` and native result history test |
| Ax integration | AxAgent runtime modules and stages | Implemented | `mcp.<namespace>` and `ucp.<namespace>` runtime globals |
| Ax integration | Child agents and RLM inheritance | Implemented | child-context derivation and recursion option propagation |
| Ax integration | AxFlow sequential/parallel propagation | Implemented | shared context and inheritance test |
| Ax integration | Flow cancellation of abandoned remote tasks | Implemented | parallel sibling abort plus newly-created remote-task cancellation in Flow executor |
| Ax integration | Optimization/evaluation replay | Implemented | replay/sandbox default gate, explicit live opt-in, and native evaluation-context propagation |
| Memory | Raw MCP/UCP results and protocol provenance | Implemented | `protocolResult` in function messages and memory test |
| Memory | Catalog-version cache fingerprints | Implemented | execution-context revision fingerprints and live refresh |
| Observability | Qualified action logs and raw results | Implemented | component IDs, runtime qualified names, normal function traces |
| Observability | Full OpenTelemetry MCP semantic attributes | Implemented | `AxMCPClient` protocol spans carry JSON-RPC method, namespace, negotiated version, server, request/task IDs, retry count, status, and sanitized errors; focused span test covers the matrix |
| Auth | Bearer, API key header/query, Basic, HMAC, custom strategy | Implemented | `authentication.ts` and composition/signature tests |
| OAuth core | RFC 9728 protected-resource discovery | Implemented | origin/path validation and SSRF tests |
| OAuth core | RFC 8414 plus OIDC discovery variants | Implemented | discovery code and tests |
| OAuth core | PKCE S256, state, redirect, resource, scope step-up | Implemented | OAuth helper and challenge tests |
| OAuth core | CIMD, preregistration, DCR persistence/expiry | Implemented | client resolution priority and registration store hooks |
| OAuth core | `client_secret_basic`, post, secret JWT, private-key JWT | Implemented | token endpoint auth strategy and assertion hook |
| OAuth core | Client credentials grant | Implemented | official extension constant, acquisition/refresh test |
| OAuth core | Rotation and distributed token/registration stores | Implemented | rotated refresh persistence plus external storage hooks |
| OAuth advanced | DPoP | Implemented | RFC 9449 ES256 proofs, token hash binding, and authorization/resource nonce retry tests |
| OAuth advanced | PAR, JAR, RAR | Implemented | pushed requests, signed request-object callback, rich authorization details, and composed flow test |
| OAuth advanced | mTLS | Implemented | host certificate-presenting fetch channel spans discovery, OAuth/JWKS, and MCP requests; RFC 8705 metadata enforcement test |
| OAuth advanced | Revocation and introspection | Implemented | authenticated endpoint APIs and response validation tests |
| OAuth advanced | Multiple resources and JWT issuer/audience/nonce validation | Implemented | repeated resource indicators plus Web Crypto/JWKS signature, lifetime, issuer, audience, azp, and nonce validation |
| Extensions | Capability intersection | Implemented | typed extension negotiation and test |
| Extensions | OAuth Client Credentials | Implemented | grant plus negotiated extension identifier |
| Extensions | MCP Apps | Implemented | native AppBridge protocol/policy core, UI resource validation, CSP/permissions, lifecycle, visibility, and untrusted-context tests |
| Extensions | Enterprise-Managed Authorization | Implemented | RFC 8693 identity assertion to ID-JAG plus RFC 7523 MCP token exchange, including managed-ID-JAG mode |
| UCP | Profile discovery and version/service intersection | Implemented | `ucp/client.ts` and profile tests |
| UCP | MCP and REST bindings | Implemented | native Ax context plus normative REST method/path tests |
| UCP | Catalog search/lookup/product | Implemented | typed operations and MCP/REST tests |
| UCP | Cart create/get/update/cancel | Implemented | typed client methods and normative REST routing |
| UCP | Checkout create/get/update/complete/cancel | Implemented | typed methods, idempotency enforcement, REST routing |
| UCP | Fulfillment, discounts, payment handlers, buyer/context/attribution | Implemented | typed values, profile handlers, checkout composition, business-outcome preservation, and bounded advertised/local JSON Schema validation in `ucp/schema.test.ts` |
| UCP | Orders and lifecycle state | Implemented | order retrieval plus signed, allowlisted, timestamped, replay-protected lifecycle webhook verification |
| UCP | Identity linking | Implemented | negotiated scope/config inspection plus RFC 6750 challenge-driven OAuth/PKCE retries |
| UCP | Business outcomes versus transport errors | Implemented | structured success/error outcomes remain results; transport errors throw separately |
| UCP | RFC 9421 request signatures and content digest | Implemented | `ucp/signing.ts` and deterministic signature test |
| UCP | Response verification, key rotation, replay protection | Implemented | built-in RFC 9421 ES256/ES384 verification, raw digest, profile key refresh, time windows, and replay cache |
| Languages | Python, Java, C++, Go, Rust native raw MCP bindings | Implemented | generator templates, committed packages, and five-target conformance fixture |
| Languages | Full shared execution context and UCP parity | Implemented | AxIR declares `AxExecutionContext`, continuation state, `AxUCPBinding`, profile/outcome semantics, and `AxUCPClient`; generated Python/Java/C++/Go/Rust packages compile and pass `execution-context-ucp.json` |

## Completion gates

- No native TypeScript or generated-language conformance path may call the
  lossy adapter.
- Every `Partial` and `Pending` row must become `Implemented` with a named test.
- `npm run axir:check-packages`, five-target AxIR verification, package tests,
  TypeScript tests, security/adversarial tests, and website/example checks must
  pass before release.
