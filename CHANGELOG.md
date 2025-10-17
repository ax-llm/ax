# Changelog

## [14.0.33](https://github.com/ax-llm/ax/compare/14.0.32...14.0.33) (2025-10-17)

### Features

* Add support for caching the system prompt in Anthropic models ([#391](https://github.com/ax-llm/ax/pull/391)) ([92afffc](https://github.com/ax-llm/ax/commit/92afffcf1a60edecd0c0804eae2c0d6deda8d508))
* docs: Created docs/ARCHITECTURE.md ([#390](https://github.com/ax-llm/ax/pull/390)) ([61ac71b](https://github.com/ax-llm/ax/commit/61ac71b6a61fda7e91c18460f8482fd2267a2e29))
* feat: add GPT-4.1 nano model support ([#387](https://github.com/ax-llm/ax/pull/387)) ([0aa4aa2](https://github.com/ax-llm/ax/commit/0aa4aa2ceed1ba61106711baed6ce962cf2eb604))

## [14.0.32](https://github.com/ax-llm/ax/compare/14.0.30...14.0.31) (2025-10-15)

### Features

* **ace:** implement agentic context engineering ([#386](https://github.com/ax-llm/ax/issues/386)) ([a54eb50](https://github.com/ax-llm/ax/commit/a54eb50b9069eae5e00d02c683cdce459e7d596c))

### Bug Fixes

* **flow/planner:** update regex for block splitting to handle whitespace correctly ([7e8ad09](https://github.com/ax-llm/ax/commit/7e8ad09ff599c8660f0754c4b71c28bee2026774))
* handle numeric zero values in prompt field rendering ([#382](https://github.com/ax-llm/ax/issues/382)) ([d06849c](https://github.com/ax-llm/ax/commit/d06849c70c1cc2d61f5ab82c435fbbc3b027e190))
* log originating error in balancer ([#385](https://github.com/ax-llm/ax/issues/385)) ([70ca5e5](https://github.com/ax-llm/ax/commit/70ca5e563f706a00d9a858dbdae5f4b047b94c8f))
* **rag): guard undefined retrievalResults and guarantee non-empty finalContext; fix(flow/planner:** avoid executing map transforms during analysis to prevent mock side effects; build: green across workspaces; closes [#323](https://github.com/ax-llm/ax/issues/323) ([d1bce5b](https://github.com/ax-llm/ax/commit/d1bce5b5f2bb32100a8fb2c90041ff0979d30a8b))
## [14.0.31](https://github.com/ax-llm/ax/compare/14.0.30...14.0.31) (2025-10-08)

### Features

* add thoughtBlock to AxChatResponseResult and enhance validation ([7b49f65](https://github.com/ax-llm/ax/commit/7b49f65bf5474fb1c9e337e76e231c74ad21da98))

## [14.0.31](https://github.com/ax-llm/ax/compare/14.0.29...14.0.30) (2025-10-08)

### Features

* add thoughtBlock to AxChatResponseResult and enhance validation ([7b49f65](https://github.com/ax-llm/ax/commit/7b49f65bf5474fb1c9e337e76e231c74ad21da98))
## [14.0.30](https://github.com/ax-llm/ax/compare/14.0.29...14.0.30) (2025-10-07)

### Features

* enhance README with new examples and Fluent Signature API ([5cd30db](https://github.com/ax-llm/ax/commit/5cd30db98271646f3119d2fd96a734063928cc80))

## [14.0.30](https://github.com/ax-llm/ax/compare/14.0.28...14.0.29) (2025-10-07)

### Features

* enhance README with new examples and Fluent Signature API ([5cd30db](https://github.com/ax-llm/ax/commit/5cd30db98271646f3119d2fd96a734063928cc80))
## [14.0.29](https://github.com/ax-llm/ax/compare/14.0.28...14.0.29) (2025-10-04)

### Bug Fixes

* add GEPA feedback type hooks to AxCompileOptions ([#376](https://github.com/ax-llm/ax/issues/376)) ([4700c7e](https://github.com/ax-llm/ax/commit/4700c7e8e92ea3c52d9dd34020d466501dbef6bc))

## [14.0.29](https://github.com/ax-llm/ax/compare/14.0.27...14.0.28) (2025-10-04)

### Bug Fixes

* add GEPA feedback type hooks to AxCompileOptions ([#376](https://github.com/ax-llm/ax/issues/376)) ([4700c7e](https://github.com/ax-llm/ax/commit/4700c7e8e92ea3c52d9dd34020d466501dbef6bc))
## [14.0.28](https://github.com/ax-llm/ax/compare/14.0.27...14.0.28) (2025-09-28)

### Features

* add support flags for Google Gemini models ([5e785f0](https://github.com/ax-llm/ax/commit/5e785f0691c3d9e85adb63ef5e974acca6201d3a))

## [14.0.28](https://github.com/ax-llm/ax/compare/14.0.26...14.0.27) (2025-09-28)

### Features

* add support flags for Google Gemini models ([5e785f0](https://github.com/ax-llm/ax/commit/5e785f0691c3d9e85adb63ef5e974acca6201d3a))
## [14.0.27](https://github.com/ax-llm/ax/compare/14.0.26...14.0.27) (2025-09-28)

### Features

* add GEPA multi-objective optimization example and enhance documentation ([f64189c](https://github.com/ax-llm/ax/commit/f64189c45844ae7149f0d35a4aa7f7b792ba0a5d))
* integrate Vercel AI SDK v5 support and update dependencies ([3acb408](https://github.com/ax-llm/ax/commit/3acb4085e14b8845f075c84bdd55c5e9277b6b71))

### Bug Fixes

* clean up code formatting and improve consistency in examples ([f4af653](https://github.com/ax-llm/ax/commit/f4af653a737b7c0532c0e7d06066c6c5bfcb045e))

## [14.0.27](https://github.com/ax-llm/ax/compare/14.0.25...14.0.26) (2025-09-28)

### Features

* add GEPA multi-objective optimization example and enhance documentation ([f64189c](https://github.com/ax-llm/ax/commit/f64189c45844ae7149f0d35a4aa7f7b792ba0a5d))
* integrate Vercel AI SDK v5 support and update dependencies ([3acb408](https://github.com/ax-llm/ax/commit/3acb4085e14b8845f075c84bdd55c5e9277b6b71))

### Bug Fixes

* clean up code formatting and improve consistency in examples ([f4af653](https://github.com/ax-llm/ax/commit/f4af653a737b7c0532c0e7d06066c6c5bfcb045e))
## [14.0.26](https://github.com/ax-llm/ax/compare/14.0.25...14.0.26) (2025-09-15)

### Features

* enhance debug handling in AxBaseAI and global settings ([355640b](https://github.com/ax-llm/ax/commit/355640bd6a47730f8a05bb535d8f03b43d2f8f7f))

## [14.0.26](https://github.com/ax-llm/ax/compare/14.0.24...14.0.25) (2025-09-15)

### Features

* enhance debug handling in AxBaseAI and global settings ([355640b](https://github.com/ax-llm/ax/commit/355640bd6a47730f8a05bb535d8f03b43d2f8f7f))
## [14.0.25](https://github.com/ax-llm/ax/compare/14.0.24...14.0.25) (2025-09-14)

### Features

* enhance assertion capabilities in AxGen and documentation updates ([2770a07](https://github.com/ax-llm/ax/commit/2770a074adc883b55dfc655d3d46143dbf00c017))
* GEPA: enable optimizedProgram interface to mirror MiPRO ([#350](https://github.com/ax-llm/ax/issues/350)) ([9b1ae9a](https://github.com/ax-llm/ax/commit/9b1ae9a21c62ec913bad5dc38481a271e3facac2))
* unify GEPA and MiPRO interfaces for consistent optimization workflows ([7cf8e28](https://github.com/ax-llm/ax/commit/7cf8e289dbc38af57cb08e6e92b0ebbbcb2516bb))

## [14.0.25](https://github.com/ax-llm/ax/compare/14.0.23...14.0.24) (2025-09-14)

### Features

* enhance assertion capabilities in AxGen and documentation updates ([2770a07](https://github.com/ax-llm/ax/commit/2770a074adc883b55dfc655d3d46143dbf00c017))
* GEPA: enable optimizedProgram interface to mirror MiPRO ([#350](https://github.com/ax-llm/ax/issues/350)) ([9b1ae9a](https://github.com/ax-llm/ax/commit/9b1ae9a21c62ec913bad5dc38481a271e3facac2))
* unify GEPA and MiPRO interfaces for consistent optimization workflows ([7cf8e28](https://github.com/ax-llm/ax/commit/7cf8e289dbc38af57cb08e6e92b0ebbbcb2516bb))
## [14.0.24](https://github.com/ax-llm/ax/compare/14.0.23...14.0.24) (2025-09-13)

### Bug Fixes

* enhance error handling in AxGen class ([aa76a28](https://github.com/ax-llm/ax/commit/aa76a28d8a77b933acce9ef1a075ce5b5027d37a))

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
