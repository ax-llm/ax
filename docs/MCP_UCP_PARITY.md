# MCP and UCP parity ledger

This ledger maps the standards report supplied for the comparison client to Ax
source and verification. `Implemented` means the behavior has an executable Ax
path and focused test. `Partial` means an API or protocol primitive exists but
one or more normative flows still need conformance coverage. `Pending` means it
is not yet implemented and must not be advertised as supported.

The target is a dual-era MCP client: stateful MCP `2025-11-25` compatibility
and stateless MCP `2026-07-28`, plus the current official extensions and UCP
`2026-04-08`. This is a living acceptance artifact, not a release claim.

Evidence packs apply to every row in their area in addition to the row-specific
source/test cell:

- MCP and Ax integration: `docs/MCP_UCP.md`, `docs/MCP_SUBSCRIPTIONS.md`;
  `ax-ai`, `ax-gen`, `ax-agent`, `ax-flow`, `ax-mcp`, and
  `ax-agent-optimize` skills; native tools, resource-wake, and task-resume
  public examples.
- Event runtime: `docs/EVENT_RUNTIME.md`; `ax-event-runtime` skill; generic
  wake/state/sink examples plus MCP and UCP wake/resume examples.
- UCP: the UCP section of `docs/MCP_UCP.md`; `ax-event-runtime`, `ax-agent`, and
  `ax-flow` skills; signed webhook wake/resume examples.
- Generated languages: `docs/COMPILER.md`, committed package API/capability
  manifests, `axevent`/`axmcp` conformance, and the six-language public MCP
  example group.

| Area | Capability from supplied client report | Ax status | Source and verification |
| --- | --- | --- | --- |
| MCP lifecycle | Automatic era classification, legacy initialize negotiation, and modern version validation | Implemented | `client.ts` era probe/cache and negotiation tests; AxIR `axmcp/protocol-negotiation-rejects.json` covers the legacy generated-language boundary |
| MCP lifecycle | Stateless `server/discover`, cache metadata, server instructions, and server info from `_meta` | Implemented | `client.ts`, `types.ts`, and modern client/discovery tests |
| MCP lifecycle | Server info, instructions, and capabilities | Implemented | `AxMCPClient` catalog getters and capability gates |
| MCP lifecycle | Public ping and era-scoped readiness | Implemented | Shared ping; legacy initialized notification; modern stateless requests suppress it; `client.ts` and AxIR legacy initialize/ping fixtures |
| MCP lifecycle | Server input requests and notifications | Implemented | Legacy roots/sampling/elicitation server requests plus modern MRTR input rounds; progress, logging, catalog-change, and task-status tests |
| Transport | Streamable HTTP JSON and finite SSE responses | Implemented | `httpStreamTransport.ts` and focused transport tests |
| Transport | Era-scoped event listening and reconnect | Implemented | Legacy GET/SSE resumes with `Last-Event-ID`; modern `subscriptions/listen` reissues a fresh POST stream without `Last-Event-ID` or session state |
| Transport | Legacy HTTP/SSE | Implemented | `sseTransport.ts` and legacy fallback |
| Transport | stdio | Implemented | TypeScript and generated-language MCP packages/AxIR fixtures |
| Transport | Custom WebSocket | Implemented | `webSocketTransport.ts` and multiplexing test |
| Transport | Era-scoped lifecycle state | Implemented | Legacy reuses session headers and DELETE termination; modern requests are stateless and never capture or terminate sessions |
| Transport | Concurrent response dispatch | Implemented | pending response maps in HTTP/WebSocket transports |
| Transport | Compatibility-only JSON-RPC batching | Implemented | Deprecated `AxMCPClient.batch()` remains functional for `2025-03-26`; both target eras reject batching |
| Transport | Modern protocol, method, name, and schema-derived parameter headers | Implemented | `httpStreamTransport.ts`, `headerValue.ts`, `paramHeaders.ts`, wire tests, catalog filtering, and one-shot `-32020` resync |
| Transport | Timeouts, response limits, redirect bounds | Implemented | HTTP transport adversarial tests |
| Transport | Safe retries, HTTP-date `Retry-After`, 502/504 | Implemented | idempotent method policy and transport tests |
| Transport | Legacy session-expiry recovery | Implemented | Safe legacy requests reinitialize/retry; ambiguous side-effecting calls are never replayed; modern requests have no session to recover |
| Tools | Paginated list and raw call results | Implemented | bounded/repeated-cursor tests and native raw-result AxIR fixture |
| Tools | Title, icons, annotations, output schema, task metadata | Implemented | retained in `AxMCPTool` and native binding protocol identity |
| Tools | Authorization from annotations and arguments | Implemented | `authorizeToolCall` and denial tests |
| Tools | Per-server concurrency limits | Implemented | semaphore and focused concurrency test |
| Tools | Destructive/non-idempotent serialization | Implemented | annotation-driven serialization test |
| Content | Text, image, audio, resource links, embedded resources | Implemented | native content types, prompt/resource mapping, raw protocol memory |
| Content | Provider-specific multimodal tool-result mapping | Implemented | native Anthropic, Gemini, and OpenAI Responses mappings plus adapter-local OpenAI Chat degradation |
| Prompts | list/get, pagination, arguments, change notification | Implemented | client discovery and notification tests |
| Resources | list/read/templates/subscriptions/updates | Implemented | client APIs, runtime modules, and tests |
| Resources | Catalog snapshot discovery and refresh | Implemented | `AxMCPClient.inspectCatalog()`, bounded list pagination, deep-clone isolation tests, and all six native MCP examples |
| Resources | Managed explicit/all/selector subscriptions | Implemented | `AxMCPEventSource.resourceSubscriptions`, template exclusion, dynamic catalog-diff tests, and `docs/MCP_SUBSCRIPTIONS.md` |
| Resources | Shared-client logical subscription ownership | Implemented | Legacy first-owner/last-owner subscribe RPCs; modern desired-URI updates restart `subscriptions/listen`; manual/event-source/continuation owner tests and close ordering |
| Events | Composable notifications without replacing application callbacks | Implemented | `AxMCPClient.subscribeEvents` and `event/mcpSource.test.ts` |
| Events | Explicit resource notification to Agent wake | Implemented | `AxMCPEventSource`, authenticated route test, and `mcp-resource-wake-agent.ts` |
| Events | Task progress observe and terminal continuation resume | Implemented | automatic task correlation, default MCP routes, and `mcp-task-resume-flow.ts` |
| Events | Listening reconnect and logical resubscription | Implemented | Nonblocking handles; legacy exact-once RPC restoration; modern fresh-id listen reissue with desired filters; real localhost HTTP/SSE six-language legacy smoke |
| Event durability | Volatile single-worker inbox | Implemented | `AxInMemoryEventStore` capability contract and deterministic tests |
| Event durability | Persistent cooperating-process store | Implemented | Node-only `AxSQLiteEventStore`, WAL transactions, leases, fencing, retention, and conformance test |
| Event durability | Multi-worker capability negotiation | Implemented | runtime startup rejects stores without the `axevent-store-v1` conformance marker |
| Completion | `completion/complete` | Implemented | client and AxAgent runtime module |
| Logging | Era-scoped logging level and server messages | Implemented | Legacy `logging/setLevel`; modern request `_meta` from client/per-request `logLevel`; shared callbacks |
| Roots | Legacy `roots/list` and modern MRTR roots input | Implemented | Shared handler, server-request tests, MRTR tests, and AxIR legacy fixture |
| Sampling | Legacy server request and modern MRTR sampling input | Implemented | Shared handler types, response dispatch, and multi-round tests |
| Elicitation | Legacy server request and modern MRTR form/URL input | Implemented | Shared typed handler and server-request/MRTR tests |
| Progress | progress notifications | Implemented | callbacks and streaming-safe dispatch |
| Tasks | Modern Tasks v2 create/get/update/cancel/wait/status | Implemented | Unsolicited task results, default auto-await or explicit expose, embedded result/error, input fulfillment, task-ID listen filters, and terminal-state tests |
| Tasks | Legacy task create/list/get/result/cancel/wait/status | Implemented | Deprecated era-gated draft APIs remain functional for legacy servers with client task registry tests |
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
| UCP events | Verified lifecycle webhook to wake/resume | Implemented | `AxUCPWebhookEventSource`, identity-isolation tests, and UCP wake/resume examples |
| UCP | Identity linking | Implemented | negotiated scope/config inspection plus RFC 6750 challenge-driven OAuth/PKCE retries |
| UCP | Business outcomes versus transport errors | Implemented | structured success/error outcomes remain results; transport errors throw separately |
| UCP | RFC 9421 request signatures and content digest | Implemented | `ucp/signing.ts` and deterministic signature test |
| UCP | Response verification, key rotation, replay protection | Implemented | built-in RFC 9421 ES256/ES384 verification, raw digest, profile key refresh, time windows, and replay cache |
| Languages | Python, Java, C++, Go, Rust native raw MCP bindings | Implemented | generator templates, committed packages, and five-target conformance fixture |
| Languages | Foreign-server era, catalog, headers, and tool-call interoperability | Implemented | `scripts/test-mcp-interop.ts` runs TypeScript over stdio and HTTP plus Python, Java, C++, Go, and Rust over HTTP against exact-pinned `@modelcontextprotocol/server-everything@2026.7.4`; the shipped foreign server is legacy-era, so the harness asserts auto fallback, `2025-11-25` session/protocol headers, cache-metadata absence handling, catalog discovery, and `echo`; `scripts/mcp-interop-production.ts` manually checks Pipedream, DeepWiki, and Cloudflare Docs without invoking mutating tools |
| Languages | Dual-era MCP bindings | Implemented | `axmcp/initialize.json` and `axmcp/discover-modern.json`; the Python, Java, C++, Go, and Rust localhost harness in `scripts/test-generated-mcp-events.ts` runs both legacy and modern eras against the same server |
| Languages | Modern `2026-07-28` discovery, metadata, and stateless request lifecycle | Implemented | `axmcp/era-classification.json`, `axmcp/discover-modern.json`, `axmcp/request-meta.json`, and `axmcp/modern-transport-headers.json`; the five-language modern localhost smoke proves `auto` selects modern, sends no initialize notification, refreshes per-request `serverInfo`, and retains no session state |
| Languages | Modern Tasks v2 | Implemented | `axmcp/tasks-v2-modern.json` and `axmcp/tasks-v2-violations.json`; the five-language modern localhost smoke completes `tools/call` through `tasks/get` and consumes the flattened terminal result |
| Languages | Modern MRTR roots tranche | Implemented | `axmcp/mrtr-roots.json` and `axmcp/mrtr-violations.json`; the five-language modern localhost smoke fulfills a roots input round and resumes the original tool call with the echoed request state |
| Languages | Era-scoped subscriptions and listen reconnect | Implemented | `axmcp/subscriptions-listen.json`; the five-language legacy/modern localhost harness proves legacy subscribe plus resumable GET/SSE and modern `subscriptions/listen` POST restart, dropped-stream reconnect, resource updates, and close cleanup |
| Languages | Modern cacheable catalog and resource results | Implemented | `axmcp/cache-fold.json` and `axmcp/read-cache.json`; the five-language modern localhost smoke proves catalog `ttlMs`/`cacheScope` reuse and refresh behavior without a redundant list request |
| Languages | Modern method, name, and schema-derived parameter headers | Implemented | `axmcp/modern-headers.json`, `axmcp/modern-transport-headers.json`, and `axmcp/param-headers.json`; the five-language modern localhost smoke proves `Mcp-Param-Scope: all` reaches the server on `start_reindex` |
| Languages | Full shared execution context and UCP parity | Implemented | AxIR declares `AxExecutionContext`, continuation state, `AxUCPBinding`, profile/outcome semantics, and `AxUCPClient`; generated Python/Java/C++/Go/Rust packages compile and pass `execution-context-ucp.json` |
| Languages | Signature-aware event input mapping | Implemented | `event_map_input` and path descriptors in `ir/axcore/event.axir`, `axevent/mapping.json`, TypeScript fluent mapping tests, generated idiomatic path/input/target/route builders, and five generated lifecycle runners proving pre-invocation type rejection |
| Languages | Event runtime lifecycle baseline | Implemented | All five generated lifecycle runners prove automatic dispatch, strict delayed-retry ordering, signature-normalized input, continuations, cancellation, backpressure, output-before-sink ordering, and redrive; `npm run test:axir` passes release verification. |
| Languages | MCP event source wake/resume and subscription discovery | Implemented | Five generated lifecycle runners prove explicit/all/selector planning and ownership; the real localhost HTTP/SSE matrix for Python, Java, C++, Go, and Rust proves dual-era discovery, dynamic list changes, reconnect/resubscribe, Agent wake, task progress, Flow resume, and close cleanup. |

## Completion gates

- No native TypeScript or generated-language conformance path may call the
  lossy adapter.
- Every `Partial` and `Pending` row must become `Implemented` with a named test.
- `npm run axir:check-packages`, five-target AxIR verification, package tests,
  TypeScript tests, security/adversarial tests, and website/example checks must
  pass before release.
