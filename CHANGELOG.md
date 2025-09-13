# Changelog

## [14.0.24](https://github.com/ax-llm/ax/compare/14.0.22...14.0.23) (2025-09-13)

### Bug Fixes

* enhance error handling in AxGen class ([aa76a28](https://github.com/ax-llm/ax/commit/aa76a28d8a77b933acce9ef1a075ce5b5027d37a))
## [14.0.23](https://github.com/ax-llm/ax/compare/14.0.22...14.0.23) (2025-09-12)

### Features

* update fluent API to remove nested helper functions and enhance type inference ([15250f2](https://github.com/ax-llm/ax/commit/15250f26aa5dc9f6acb6648e0f4a8ba0d9f206ed))

## [14.0.23](https://github.com/ax-llm/ax/compare/14.0.21...14.0.22) (2025-09-12)

### Features

* update fluent API to remove nested helper functions and enhance type inference ([15250f2](https://github.com/ax-llm/ax/commit/15250f26aa5dc9f6acb6648e0f4a8ba0d9f206ed))
## [14.0.22](https://github.com/ax-llm/ax/compare/14.0.21...14.0.22) (2025-09-12)

### Bug Fixes

* refactor MCP transport imports and update documentation ([ee4d976](https://github.com/ax-llm/ax/commit/ee4d976c2ac3a71f197978379e741a8fc5dae585))

## [14.0.22](https://github.com/ax-llm/ax/compare/14.0.20...14.0.21) (2025-09-12)

### Bug Fixes

* refactor MCP transport imports and update documentation ([ee4d976](https://github.com/ax-llm/ax/commit/ee4d976c2ac3a71f197978379e741a8fc5dae585))
## [14.0.21](https://github.com/ax-llm/ax/compare/14.0.20...14.0.21) (2025-09-11)

### ⚠ BREAKING CHANGES

* **gepa:** compile now throws if `options.maxMetricCalls` is absent or non-positive.

* fix(gepa): only skip reflective after an evaluated merge attempt\n\nAlign single-module merge gating with the reference engine so reflective mutation is skipped only when a merge is actually attempted, improving behavioral parity and avoiding lost reflective iterations when no valid merge pair exists.

* docs(optimize): migrate multi-objective docs to GEPA/GEPA-Flow using compile (remove compilePareto)

### Features

* enhance AxExamples utility and improve fluent API type inference ([45897fc](https://github.com/ax-llm/ax/commit/45897fc19404197a01c91ba7b7aaa9c54c1e03cc))
* **gepa:** GEPA/GEPA-Flow Pareto optimizers + docs alignment ([#341](https://github.com/ax-llm/ax/issues/341)) ([f61c18a](https://github.com/ax-llm/ax/commit/f61c18a9b11a6e36f783f6937c0e9104cf168c1f))
* **mcp:** OAuth 2.1 for HTTP/SSE transports + Notion OAuth examples ([#340](https://github.com/ax-llm/ax/issues/340)) ([4f8c922](https://github.com/ax-llm/ax/commit/4f8c922627ad6d973c42615d8eb0d7f9e7a649d1))

### Bug Fixes

* enhance memory tag validation and retry logic in tests ([adecf29](https://github.com/ax-llm/ax/commit/adecf29904f8df5d634f6eedbca1ad7c6927e56f))
* improve code formatting and cleanup in tests and base AI implementation ([eba5f39](https://github.com/ax-llm/ax/commit/eba5f393f1c397dba7848992fefa8157e8cd3531))
* improve token budget handling and update model references ([6868de6](https://github.com/ax-llm/ax/commit/6868de61805bd42d8c04f39a65edd72363a29cad))
* streamline memory tag management and improve test coverage ([870ebe2](https://github.com/ax-llm/ax/commit/870ebe2b4e7ef604fb8976acfe9d5cd41ac6ec62))
* update AxMultiMetricFn type definition and clean up imports ([06c3960](https://github.com/ax-llm/ax/commit/06c3960fc86a3f27d92e65e6ff4bba21242a7102))
* update typedef to support async version ([#294](https://github.com/ax-llm/ax/issues/294)) ([45f07a2](https://github.com/ax-llm/ax/commit/45f07a2ec32255fe1f9adb888358aa11ffad354a))

## [14.0.21](https://github.com/ax-llm/ax/compare/14.0.19...14.0.20) (2025-09-11)

### ⚠ BREAKING CHANGES

* **gepa:** compile now throws if `options.maxMetricCalls` is absent or non-positive.

* fix(gepa): only skip reflective after an evaluated merge attempt\n\nAlign single-module merge gating with the reference engine so reflective mutation is skipped only when a merge is actually attempted, improving behavioral parity and avoiding lost reflective iterations when no valid merge pair exists.

* docs(optimize): migrate multi-objective docs to GEPA/GEPA-Flow using compile (remove compilePareto)

### Features

* enhance AxExamples utility and improve fluent API type inference ([45897fc](https://github.com/ax-llm/ax/commit/45897fc19404197a01c91ba7b7aaa9c54c1e03cc))
* **gepa:** GEPA/GEPA-Flow Pareto optimizers + docs alignment ([#341](https://github.com/ax-llm/ax/issues/341)) ([f61c18a](https://github.com/ax-llm/ax/commit/f61c18a9b11a6e36f783f6937c0e9104cf168c1f))
* **mcp:** OAuth 2.1 for HTTP/SSE transports + Notion OAuth examples ([#340](https://github.com/ax-llm/ax/issues/340)) ([4f8c922](https://github.com/ax-llm/ax/commit/4f8c922627ad6d973c42615d8eb0d7f9e7a649d1))

### Bug Fixes

* enhance memory tag validation and retry logic in tests ([adecf29](https://github.com/ax-llm/ax/commit/adecf29904f8df5d634f6eedbca1ad7c6927e56f))
* improve code formatting and cleanup in tests and base AI implementation ([eba5f39](https://github.com/ax-llm/ax/commit/eba5f393f1c397dba7848992fefa8157e8cd3531))
* improve token budget handling and update model references ([6868de6](https://github.com/ax-llm/ax/commit/6868de61805bd42d8c04f39a65edd72363a29cad))
* streamline memory tag management and improve test coverage ([870ebe2](https://github.com/ax-llm/ax/commit/870ebe2b4e7ef604fb8976acfe9d5cd41ac6ec62))
* update AxMultiMetricFn type definition and clean up imports ([06c3960](https://github.com/ax-llm/ax/commit/06c3960fc86a3f27d92e65e6ff4bba21242a7102))
* update typedef to support async version ([#294](https://github.com/ax-llm/ax/issues/294)) ([45f07a2](https://github.com/ax-llm/ax/commit/45f07a2ec32255fe1f9adb888358aa11ffad354a))
## [14.0.20](https://github.com/ax-llm/ax/compare/14.0.19...14.0.20) (2025-09-02)

## [14.0.20](https://github.com/ax-llm/ax/compare/14.0.18...14.0.19) (2025-09-02)
## [14.0.19](https://github.com/ax-llm/ax/compare/14.0.18...14.0.19) (2025-08-29)

### Bug Fixes

* bind provider implementation methods to preserve context ([86c92e4](https://github.com/ax-llm/ax/commit/86c92e4f536cd85371ef45bd15b5f6209072adaf))

## [14.0.19](https://github.com/ax-llm/ax/compare/14.0.17...14.0.18) (2025-08-29)

### Bug Fixes

* bind provider implementation methods to preserve context ([86c92e4](https://github.com/ax-llm/ax/commit/86c92e4f536cd85371ef45bd15b5f6209072adaf))
## [14.0.18](https://github.com/ax-llm/ax/compare/14.0.17...14.0.18) (2025-08-28)

## [14.0.18](https://github.com/ax-llm/ax/compare/14.0.16...14.0.17) (2025-08-28)
## [14.0.17](https://github.com/ax-llm/ax/compare/14.0.16...14.0.17) (2025-08-28)

### Features

* introduce AxStopFunctionCallException and enhance function call handling ([71e8e63](https://github.com/ax-llm/ax/commit/71e8e633f0f1a009b86552a3046967221ae29038))

### Bug Fixes

* refine field extraction logic and update test cases ([d9d9836](https://github.com/ax-llm/ax/commit/d9d983666a658b9d21b33757a063b5389296d512))

## [14.0.17](https://github.com/ax-llm/ax/compare/14.0.15...14.0.16) (2025-08-28)

### Features

* introduce AxStopFunctionCallException and enhance function call handling ([71e8e63](https://github.com/ax-llm/ax/commit/71e8e633f0f1a009b86552a3046967221ae29038))

### Bug Fixes

* refine field extraction logic and update test cases ([d9d9836](https://github.com/ax-llm/ax/commit/d9d983666a658b9d21b33757a063b5389296d512))
## [14.0.16](https://github.com/ax-llm/ax/compare/14.0.15...14.0.16) (2025-08-13)

### Bug Fixes

* enhance debug parameter handling in response processing ([0d36063](https://github.com/ax-llm/ax/commit/0d36063386241dc5626dc96a8c2179e0f5721f4c))

## [14.0.16](https://github.com/ax-llm/ax/compare/14.0.14...14.0.15) (2025-08-13)

### Bug Fixes

* enhance debug parameter handling in response processing ([0d36063](https://github.com/ax-llm/ax/commit/0d36063386241dc5626dc96a8c2179e0f5721f4c))
## [14.0.15](https://github.com/ax-llm/ax/compare/14.0.14...14.0.15) (2025-08-13)

### Features

* add comprehensive documentation for AI providers, DSPy signatures, and AxFlow ([09c324a](https://github.com/ax-llm/ax/commit/09c324a26d91c87fed66ae5910a4b2e265028e64))
* enhance documentation with new Examples Guide and improved links ([e39300b](https://github.com/ax-llm/ax/commit/e39300be36efa59267a98508cfde51c9ab5022a0))
* enhance logging functionality with ChatResponseCitations support ([ec87e3a](https://github.com/ax-llm/ax/commit/ec87e3a5af7e17293ccd0528c57220d464ca5c73))

## [14.0.15](https://github.com/ax-llm/ax/compare/14.0.13...14.0.14) (2025-08-13)

### Features

* add comprehensive documentation for AI providers, DSPy signatures, and AxFlow ([09c324a](https://github.com/ax-llm/ax/commit/09c324a26d91c87fed66ae5910a4b2e265028e64))
* enhance documentation with new Examples Guide and improved links ([e39300b](https://github.com/ax-llm/ax/commit/e39300be36efa59267a98508cfde51c9ab5022a0))
* enhance logging functionality with ChatResponseCitations support ([ec87e3a](https://github.com/ax-llm/ax/commit/ec87e3a5af7e17293ccd0528c57220d464ca5c73))
## [14.0.14](https://github.com/ax-llm/ax/compare/14.0.13...14.0.14) (2025-08-12)

### Features

* add comprehensive API and Quick Start documentation ([4fbbf45](https://github.com/ax-llm/ax/commit/4fbbf452c5e0736ceb5a598d2d46a97c36eee7f1))
