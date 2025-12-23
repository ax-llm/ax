# Changelog

## [16.0.0](///compare/15.1.0...15.1.1) (2025-12-23)

### Features

* Add explicit context caching for AI models and refactor structured output example rendering in prompts. afe40c2
## [15.1.1](///compare/15.1.0...15.1.1) (2025-12-21)

### Features

* Enhance GEPA optimizer with new configuration options and structured optimization report f0ef34a

## [15.1.1](///compare/15.0.28...15.1.0) (2025-12-21)

### Features

* Enhance GEPA optimizer with new configuration options and structured optimization report f0ef34a
## [15.1.0](///compare/15.0.28...15.1.0) (2025-12-17)

## [15.1.0](///compare/15.0.27...15.0.28) (2025-12-17)
## [15.0.28](///compare/15.0.27...15.0.28) (2025-12-17)

### Features

* Add Gemini 3 Flash Preview model and update food search example to use it. f08335f

## [15.0.28](///compare/15.0.26...15.0.27) (2025-12-17)

### Features

* Add Gemini 3 Flash Preview model and update food search example to use it. f08335f
## [15.0.27](///compare/15.0.26...15.0.27) (2025-12-16)

### Features

* Add GPT-5 model definitions and update documentation to use strongly typed AI model enums. 3ff2546

### Bug Fixes

* correct Claude 4.5 Haiku model name in Vertex enum ([#474](undefined/undefined/undefined/issues/474)) 24f8e40

## [15.0.27](///compare/15.0.25...15.0.26) (2025-12-16)

### Features

* Add GPT-5 model definitions and update documentation to use strongly typed AI model enums. 3ff2546

### Bug Fixes

* correct Claude 4.5 Haiku model name in Vertex enum ([#474](undefined/undefined/undefined/issues/474)) 24f8e40
## [15.0.26](///compare/15.0.25...15.0.26) (2025-12-16)

### Features

* replace `AxLearnAgent` and `AxTuner` with `AxLearn` and update GEPA optimizer to include instruction in Pareto results. dc2742b

## [15.0.26](///compare/15.0.24...15.0.25) (2025-12-16)

### Features

* replace `AxLearnAgent` and `AxTuner` with `AxLearn` and update GEPA optimizer to include instruction in Pareto results. dc2742b
## [15.0.25](///compare/15.0.24...15.0.25) (2025-12-16)

### Features

* use strongly typed model enums in documentation examples 5201e9c

## [15.0.25](///compare/15.0.23...15.0.24) (2025-12-16)

### Features

* use strongly typed model enums in documentation examples 5201e9c
## [15.0.24](///compare/15.0.23...15.0.24) (2025-12-16)

### Features

* Introduce new DSP modules (agent, tuner, synth, judge), enhance API call retry logic with `Retry-After` header support, and update documentation and examples. 8c58902

## [15.0.24](///compare/15.0.22...15.0.23) (2025-12-16)

### Features

* Introduce new DSP modules (agent, tuner, synth, judge), enhance API call retry logic with `Retry-After` header support, and update documentation and examples. 8c58902
## [15.0.23](///compare/15.0.22...15.0.23) (2025-12-15)

## [15.0.23](///compare/15.0.21...15.0.22) (2025-12-15)
## [15.0.22](///compare/15.0.21...15.0.22) (2025-12-14)

### Features

* **azure-openai:** add structured outputs support ([#473](undefined/undefined/undefined/issues/473)) a246518

## [15.0.22](///compare/15.0.20...15.0.21) (2025-12-14)

### Features

* **azure-openai:** add structured outputs support ([#473](undefined/undefined/undefined/issues/473)) a246518
## [15.0.21](///compare/15.0.20...15.0.21) (2025-12-13)

### Features

* Introduce `AxTokenLimitError` for specific token limit detection in AI API calls and add configuration for retrying on such errors. 69539df

## [15.0.21](///compare/15.0.19...15.0.20) (2025-12-13)

### Features

* Introduce `AxTokenLimitError` for specific token limit detection in AI API calls and add configuration for retrying on such errors. 69539df
## [15.0.20](///compare/15.0.19...15.0.20) (2025-12-13)

## [15.0.20](///compare/15.0.18...15.0.19) (2025-12-13)

### Features

* Implement infrastructure-level retry for service network, status, and timeout errors, adjusting default retry and step limits. 807ad4f

## [15.0.19](///compare/15.0.17...15.0.18) (2025-12-13)

### Features

* Implement infrastructure-level retry for service network, status, and timeout errors, adjusting default retry and step limits. 807ad4f
## [15.0.18](///compare/15.0.17...15.0.18) (2025-12-12)

### Features

* Improve streaming error handling by distinguishing validation from parsing errors, optimize signature complex field detection, and add API request debug logging. 117e7d2
* Improve streaming retry logic by resetting state and committed values, and clarify complex field detection for output signatures. 0bf9d87

## [15.0.18](///compare/15.0.16...15.0.17) (2025-12-12)

### Features

* Improve streaming error handling by distinguishing validation from parsing errors, optimize signature complex field detection, and add API request debug logging. 117e7d2
* Improve streaming retry logic by resetting state and committed values, and clarify complex field detection for output signatures. 0bf9d87
## [15.0.17](///compare/15.0.16...15.0.17) (2025-12-11)

### Features

* Prevent stream duplication on retry by tracking committed values and yielding only effective deltas. 98a8480

## [15.0.17](///compare/15.0.15...15.0.16) (2025-12-11)

### Features

* Prevent stream duplication on retry by tracking committed values and yielding only effective deltas. 98a8480
## [15.0.16](///compare/15.0.15...15.0.16) (2025-12-11)

### Bug Fixes

* Prevent streaming structured output duplication by refining delta calculation and resetting retry states. 946349f

## [15.0.16](///compare/15.0.14...15.0.15) (2025-12-11)

### Bug Fixes

* Prevent streaming structured output duplication by refining delta calculation and resetting retry states. 946349f
## [15.0.15](///compare/15.0.14...15.0.15) (2025-12-11)

### Features

* Enhance AI balancer with capability-based service selection and aggregated features/metrics across services. d4acef2

### Bug Fixes

* **ace:** Refine reflector to use only input fields ([#464](undefined/undefined/undefined/issues/464)) 695dbf0

## [15.0.15](///compare/15.0.13...15.0.14) (2025-12-11)

### Features

* Enhance AI balancer with capability-based service selection and aggregated features/metrics across services. d4acef2

### Bug Fixes

* **ace:** Refine reflector to use only input fields ([#464](undefined/undefined/undefined/issues/464)) 695dbf0
## [15.0.14](///compare/15.0.13...15.0.14) (2025-12-10)

### Bug Fixes

* ensure streaming partial memory blocks only merge with other partial blocks, otherwise append as new. 5679412

## [15.0.14](///compare/15.0.12...15.0.13) (2025-12-10)

### Bug Fixes

* ensure streaming partial memory blocks only merge with other partial blocks, otherwise append as new. 5679412
## [15.0.13](///compare/15.0.12...15.0.13) (2025-12-10)

### Features

* add support for Claude 4.5 Opus model ([#467](undefined/undefined/undefined/issues/467)) 88c573b

### Bug Fixes

* **dsp:** correctly extract instruction from signature in GEPA optimizer ([#466](undefined/undefined/undefined/issues/466)) 76e7a6c, closes #463

## [15.0.13](///compare/15.0.11...15.0.12) (2025-12-10)

### Features

* add support for Claude 4.5 Opus model ([#467](undefined/undefined/undefined/issues/467)) 88c573b

### Bug Fixes

* **dsp:** correctly extract instruction from signature in GEPA optimizer ([#466](undefined/undefined/undefined/issues/466)) 76e7a6c, closes #463
## [15.0.12](///compare/15.0.11...15.0.12) (2025-12-10)

### Features

* introduce AxThoughtBlockItem type and refactor thought block handling across AI models ad92200

## [15.0.12](///compare/15.0.10...15.0.11) (2025-12-10)

### Features

* introduce AxThoughtBlockItem type and refactor thought block handling across AI models ad92200
## [15.0.11](///compare/15.0.10...15.0.11) (2025-12-09)

## [15.0.11](///compare/15.0.9...15.0.10) (2025-12-09)
## [15.0.10](///compare/15.0.9...15.0.10) (2025-12-09)

### Features

* add support for structured outputs across various AI models and enhance error handling for complex fields 816484c

## [15.0.10](///compare/15.0.8...15.0.9) (2025-12-09)

### Features

* add support for structured outputs across various AI models and enhance error handling for complex fields 816484c
## [15.0.9](///compare/15.0.8...15.0.9) (2025-12-08)

### Bug Fixes

* **anthropic:** remove unsupported structured-outputs beta header for Vertex AI ([#462](undefined/undefined/undefined/issues/462)) 8420adb
* improved ax generate error bebf924

## [15.0.9](///compare/15.0.7...15.0.8) (2025-12-08)

### Bug Fixes

* **anthropic:** remove unsupported structured-outputs beta header for Vertex AI ([#462](undefined/undefined/undefined/issues/462)) 8420adb
* improved ax generate error bebf924
## [15.0.8](///compare/15.0.7...15.0.8) (2025-12-02)

### Features

* **dsp:** Separate structured output example input fields with newlines and allow missing required fields during structured output validation in response processing. 6150f36

## [15.0.8](///compare/15.0.6...15.0.7) (2025-12-02)

### Features

* **dsp:** Separate structured output example input fields with newlines and allow missing required fields during structured output validation in response processing. 6150f36
## [15.0.7](///compare/15.0.6...15.0.7) (2025-12-01)

### Features

* enhance structured output handling with distinct extraction modes and improved prompt rendering for complex fields 7ad07fe

## [15.0.7](///compare/15.0.5...15.0.6) (2025-12-01)

### Features

* enhance structured output handling with distinct extraction modes and improved prompt rendering for complex fields 7ad07fe
## [15.0.6](///compare/15.0.5...15.0.6) (2025-12-01)

### Features

* Enhance complex object and JSON extraction, add validation tests, and improve error messages with LLM output. 100ed60

## [15.0.6](///compare/15.0.4...15.0.5) (2025-12-01)

### Features

* Enhance complex object and JSON extraction, add validation tests, and improve error messages with LLM output. 100ed60
## [15.0.5](///compare/15.0.4...15.0.5) (2025-11-29)

### Features

* add documentation for AWS Bedrock, Vercel AI SDK, and Ax Tools packages. 95962ae
* **anthropic:** add validation for arbitrary json objects in structured outputs ([#459](undefined/undefined/undefined/issues/459)) 7db81c5

## [15.0.5](///compare/15.0.3...15.0.4) (2025-11-29)

### Features

* add documentation for AWS Bedrock, Vercel AI SDK, and Ax Tools packages. 95962ae
* **anthropic:** add validation for arbitrary json objects in structured outputs ([#459](undefined/undefined/undefined/issues/459)) 7db81c5
## [15.0.4](///compare/15.0.3...15.0.4) (2025-11-28)

### Features

* **mipro:** Expand MIPROv2 optimizer to tune instructions and examples ([#453](undefined/undefined/undefined/issues/453)) 2f3e6ac

### Bug Fixes

* **ace:** Ensure only input fields are passed to curator ([#456](undefined/undefined/undefined/issues/456)) 8c0c13f
* allow f.object().array() as input field ([#452](undefined/undefined/undefined/issues/452)) d36ddd6
* **anthropic:** add anthropic-beta header for web-search on Vertex AI ([#457](undefined/undefined/undefined/issues/457)) df13f8c
* build issue 71b5ae8

## [15.0.4](///compare/15.0.2...15.0.3) (2025-11-28)

### Features

* **mipro:** Expand MIPROv2 optimizer to tune instructions and examples ([#453](undefined/undefined/undefined/issues/453)) 2f3e6ac

### Bug Fixes

* **ace:** Ensure only input fields are passed to curator ([#456](undefined/undefined/undefined/issues/456)) 8c0c13f
* allow f.object().array() as input field ([#452](undefined/undefined/undefined/issues/452)) d36ddd6
* **anthropic:** add anthropic-beta header for web-search on Vertex AI ([#457](undefined/undefined/undefined/issues/457)) df13f8c
* build issue 71b5ae8
## [15.0.3](///compare/15.0.2...15.0.3) (2025-11-24)

### Features

* Update Anthropic schema cleaning to preserve `default`, `oneOf`, `anyOf`, `allOf` and conditionally remove `additionalProperties`. dbc419c

## [15.0.3](///compare/15.0.1...15.0.2) (2025-11-24)

### Features

* Update Anthropic schema cleaning to preserve `default`, `oneOf`, `anyOf`, `allOf` and conditionally remove `additionalProperties`. dbc419c
## [15.0.2](///compare/15.0.1...15.0.2) (2025-11-23)

### Features

* Implement and document parallel function calling for Google Gemini. cb1a310

## [15.0.2](///compare/15.0.0...15.0.1) (2025-11-23)

### Features

* Implement and document parallel function calling for Google Gemini. cb1a310
## [15.0.1](///compare/15.0.0...15.0.1) (2025-11-22)

### Features

* Introduce `AxSignature.hasComplexFields()` for consistent complex type detection and update example documentation. b1dc107

## [15.0.1](///compare/14.0.44...15.0.0) (2025-11-22)

### Features

* Introduce `AxSignature.hasComplexFields()` for consistent complex type detection and update example documentation. b1dc107
* Introduce structured (XML) prompt generation with format protection and tests, and remove individual streaming result logging. f04c787

## [15.0.0](///compare/14.0.43...14.0.44) (2025-11-22)

### Features

* Introduce structured (XML) prompt generation with format protection and tests, and remove individual streaming result logging. f04c787
## [14.0.44](///compare/14.0.43...14.0.44) (2025-11-22)

### Features

* **anthropic:** update and align Vertex AI model maxTokens values ([#426](undefined/undefined/undefined/issues/426)) f042d7b

## [14.0.44](///compare/14.0.42...14.0.43) (2025-11-22)

### Features

* **anthropic:** update and align Vertex AI model maxTokens values ([#426](undefined/undefined/undefined/issues/426)) f042d7b
## [14.0.43](///compare/14.0.42...14.0.43) (2025-11-22)

### Features

* Enable Anthropic web search by updating beta headers and removing tool filtering, and reorder validator imports. 60a5663

### Bug Fixes

* **vertex:** use correct Vertex AI endpoint for global region ([#428](undefined/undefined/undefined/issues/428)) 1466bc7

## [14.0.43](///compare/14.0.41...14.0.42) (2025-11-22)

### Features

* Enable Anthropic web search by updating beta headers and removing tool filtering, and reorder validator imports. 60a5663

### Bug Fixes

* **vertex:** use correct Vertex AI endpoint for global region ([#428](undefined/undefined/undefined/issues/428)) 1466bc7
## [14.0.42](///compare/14.0.41...14.0.42) (2025-11-22)

## [14.0.42](///compare/14.0.40...14.0.41) (2025-11-22)
## [14.0.41](///compare/14.0.40...14.0.41) (2025-11-21)

### Features

* Add date and datetime field types and clarify dual syntax for format validators across documentation. f1abcab
* Introduce date and datetime format validators, add dedicated email type factory, and clarify format validation syntax in documentation. c9b16a6

## [14.0.41](///compare/14.0.39...14.0.40) (2025-11-21)

### Features

* Add date and datetime field types and clarify dual syntax for format validators across documentation. f1abcab
* Introduce date and datetime format validators, add dedicated email type factory, and clarify format validation syntax in documentation. c9b16a6
## [14.0.40](///compare/14.0.39...14.0.40) (2025-11-21)

### Features

* **anthropic:** implement extended thinking signature handling in streaming mode c73646f
* **gemini:** add Gemini 3 support with thought signatures and function calling 7b6a499
* **validation:** introduce Zod-like validation constraints for structured outputs a15e5b6

### Bug Fixes

* **anthropic:** correct prompt caching property to cache_control 20606c7
* **anthropic:** support streaming cache usage and remove beta header 8fe2bfc
* buid issues 571b775
* build issues 3fa583c

## [14.0.40](///compare/14.0.38...14.0.39) (2025-11-21)

### Features

* **anthropic:** implement extended thinking signature handling in streaming mode c73646f
* **gemini:** add Gemini 3 support with thought signatures and function calling 7b6a499
* **validation:** introduce Zod-like validation constraints for structured outputs a15e5b6

### Bug Fixes

* **anthropic:** correct prompt caching property to cache_control 20606c7
* **anthropic:** support streaming cache usage and remove beta header 8fe2bfc
* buid issues 571b775
* build issues 3fa583c
## [14.0.39](///compare/14.0.38...14.0.39) (2025-11-05)

### Bug Fixes

* **api:** improve handling of empty function parameters in Anthropic, Cohere, and Google Gemini APIs e901fdc

## [14.0.39](https://github.com/ax-llm/ax/compare/14.0.37...14.0.38) (2025-11-05)

### Bug Fixes

* **api:** improve handling of empty function parameters in Anthropic, Cohere, and Google Gemini APIs ([e901fdc](https://github.com/ax-llm/ax/commit/e901fdc675951b67aca7c923885f757d8a152c7a))
## [14.0.38](https://github.com/ax-llm/ax/compare/14.0.37...14.0.38) (2025-11-05)

### Features

* **api:** enhance function parameter handling and schema validation across multiple AI integrations ([e593e75](https://github.com/ax-llm/ax/commit/e593e7521ec231f2e9841babe8cb4dfb13bd2512))
* **caching:** implement caching functionality in AxGen and AxFlow for improved performance ([18158d9](https://github.com/ax-llm/ax/commit/18158d9ba17f749e98a7814072743911131b84a1))
* **flow:** add description and toFunction methods for enhanced flow metadata ([54dfaca](https://github.com/ax-llm/ax/commit/54dfacac6f609016f2306a02f76d28cfd726028a))

### Bug Fixes

* Hardcode error class names to prevent minification issues ([#421](https://github.com/ax-llm/ax/issues/421)) ([5267340](https://github.com/ax-llm/ax/commit/5267340459564a576b6f1c9fddff785588e78af5))

## [14.0.38](https://github.com/ax-llm/ax/compare/14.0.36...14.0.37) (2025-11-05)

### Features

* **api:** enhance function parameter handling and schema validation across multiple AI integrations ([e593e75](https://github.com/ax-llm/ax/commit/e593e7521ec231f2e9841babe8cb4dfb13bd2512))
* **caching:** implement caching functionality in AxGen and AxFlow for improved performance ([18158d9](https://github.com/ax-llm/ax/commit/18158d9ba17f749e98a7814072743911131b84a1))
* **flow:** add description and toFunction methods for enhanced flow metadata ([54dfaca](https://github.com/ax-llm/ax/commit/54dfacac6f609016f2306a02f76d28cfd726028a))

### Bug Fixes

* Hardcode error class names to prevent minification issues ([#421](https://github.com/ax-llm/ax/issues/421)) ([5267340](https://github.com/ax-llm/ax/commit/5267340459564a576b6f1c9fddff785588e78af5))
## [14.0.37](https://github.com/ax-llm/ax/compare/14.0.36...14.0.37) (2025-10-22)

## [14.0.37](https://github.com/ax-llm/ax/compare/14.0.35...14.0.36) (2025-10-22)
## [14.0.36](https://github.com/ax-llm/ax/compare/14.0.35...14.0.36) (2025-10-22)

### Features

* **anthropic:** add Claude 4.5 Haiku model and update logging for thought display ([2d84bc2](https://github.com/ax-llm/ax/commit/2d84bc266d26b3338d68fc24a86e6faaf78288b0))
* **anthropic:** add Claude 4.5 Sonnet model with pricing and token limits ([af101b4](https://github.com/ax-llm/ax/commit/af101b42593abc668877099fed474421d81de6a5))

## [14.0.36](https://github.com/ax-llm/ax/compare/14.0.34...14.0.35) (2025-10-22)

### Features

* **anthropic:** add Claude 4.5 Haiku model and update logging for thought display ([2d84bc2](https://github.com/ax-llm/ax/commit/2d84bc266d26b3338d68fc24a86e6faaf78288b0))
* **anthropic:** add Claude 4.5 Sonnet model with pricing and token limits ([af101b4](https://github.com/ax-llm/ax/commit/af101b42593abc668877099fed474421d81de6a5))
## [14.0.35](https://github.com/ax-llm/ax/compare/14.0.34...14.0.35) (2025-10-19)

### Features

* add AWS Bedrock provider integration ([#395](https://github.com/ax-llm/ax/issues/395)) ([6ce7eb3](https://github.com/ax-llm/ax/commit/6ce7eb3219c9936bec0916ca0572be9fe17c670c))

### Bug Fixes

* **google-gemini:** align Google Maps grounding types/options and retrievalConfig with Gemini api ([#393](https://github.com/ax-llm/ax/issues/393)) ([b44f534](https://github.com/ax-llm/ax/commit/b44f5340a603475728179e75baa7415767eec1e9))

## [14.0.35](https://github.com/ax-llm/ax/compare/14.0.33...14.0.34) (2025-10-19)

### Features

* add AWS Bedrock provider integration ([#395](https://github.com/ax-llm/ax/issues/395)) ([6ce7eb3](https://github.com/ax-llm/ax/commit/6ce7eb3219c9936bec0916ca0572be9fe17c670c))

### Bug Fixes

* **google-gemini:** align Google Maps grounding types/options and retrievalConfig with Gemini api ([#393](https://github.com/ax-llm/ax/issues/393)) ([b44f534](https://github.com/ax-llm/ax/commit/b44f5340a603475728179e75baa7415767eec1e9))
## [14.0.34](https://github.com/ax-llm/ax/compare/14.0.33...14.0.34) (2025-10-18)

## [14.0.34](https://github.com/ax-llm/ax/compare/14.0.32...14.0.33) (2025-10-18)
## [14.0.33](https://github.com/ax-llm/ax/compare/14.0.32...14.0.33) (2025-10-17)

### Features

* add GPT-4.1 nano model support ([#387](https://github.com/ax-llm/ax/issues/387)) ([0aa4aa2](https://github.com/ax-llm/ax/commit/0aa4aa2ceed1ba61106711baed6ce962cf2eb604))

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
