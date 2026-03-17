---
title: "Examples Guide"
description: "Comprehensive examples showcasing Ax framework capabilities"
---

# Ax Examples Guide

This page lists every runnable example in [`src/examples/`](https://github.com/ax-llm/ax/tree/main/src/examples), grouped by theme and linked to GitHub for easy browsing.

## Getting Started

- **[chat.ts](https://github.com/ax-llm/ax/tree/main/src/examples/chat.ts)** - Basic chat example with function calling and conversation flow.
- **[extract.ts](https://github.com/ax-llm/ax/tree/main/src/examples/extract.ts)** - Extract structured fields from free-form text.
- **[extract-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/extract-test.ts)** - Small extraction test case with typed outputs.
- **[summarize.ts](https://github.com/ax-llm/ax/tree/main/src/examples/summarize.ts)** - Summarize a list of updates into multiple output formats.
- **[simple-classify.ts](https://github.com/ax-llm/ax/tree/main/src/examples/simple-classify.ts)** - Lightweight text classification with labeled classes.
- **[marketing.ts](https://github.com/ax-llm/ax/tree/main/src/examples/marketing.ts)** - Generate marketing-style copy from prompts.
- **[embed.ts](https://github.com/ax-llm/ax/tree/main/src/examples/embed.ts)** - Create embeddings and inspect the returned vectors.
- **[prime.ts](https://github.com/ax-llm/ax/tree/main/src/examples/prime.ts)** - Simple reasoning task around prime number generation.
- **[fibonacci.ts](https://github.com/ax-llm/ax/tree/main/src/examples/fibonacci.ts)** - Use an AI call plus runtime execution to compute Fibonacci numbers.

## Signatures, Structured Output, and Examples

- **[structured_output.ts](https://github.com/ax-llm/ax/tree/main/src/examples/structured_output.ts)** - Structured output with validation constraints and nested objects.
- **[fluent-signature-example.ts](https://github.com/ax-llm/ax/tree/main/src/examples/fluent-signature-example.ts)** - Build signatures with the fluent `f()` API.
- **[debug_schema.ts](https://github.com/ax-llm/ax/tree/main/src/examples/debug_schema.ts)** - Inspect generated JSON schema from constrained signatures.
- **[use-examples.ts](https://github.com/ax-llm/ax/tree/main/src/examples/use-examples.ts)** - Attach few-shot examples to a generator.
- **[sample-count.ts](https://github.com/ax-llm/ax/tree/main/src/examples/sample-count.ts)** - Generate multiple samples from a single prompt program.
- **[result-picker.ts](https://github.com/ax-llm/ax/tree/main/src/examples/result-picker.ts)** - Pick the best result from multiple generated samples.

## Functions and Tool Calling

- **[function.ts](https://github.com/ax-llm/ax/tree/main/src/examples/function.ts)** - Basic function-calling setup with Ax.
- **[signature-tool-calling.ts](https://github.com/ax-llm/ax/tree/main/src/examples/signature-tool-calling.ts)** - Combine agent signatures with tool execution.
- **[function-result-formatter.ts](https://github.com/ax-llm/ax/tree/main/src/examples/function-result-formatter.ts)** - Customize how tool results are formatted back to the model.
- **[function-result-picker.ts](https://github.com/ax-llm/ax/tree/main/src/examples/function-result-picker.ts)** - Choose among multiple tool results before returning an answer.
- **[stop-function.ts](https://github.com/ax-llm/ax/tree/main/src/examples/stop-function.ts)** - Stop a tool-driven workflow with a terminating function.
- **[food-search.ts](https://github.com/ax-llm/ax/tree/main/src/examples/food-search.ts)** - Tool-driven restaurant search and selection flow.
- **[react.ts](https://github.com/ax-llm/ax/tree/main/src/examples/react.ts)** - ReAct-style prompting with tools and intermediate reasoning.
- **[smart-home.ts](https://github.com/ax-llm/ax/tree/main/src/examples/smart-home.ts)** - Multi-tool smart home assistant simulation.

## Streaming, Assertions, and Control Flow

- **[streaming.ts](https://github.com/ax-llm/ax/tree/main/src/examples/streaming.ts)** - Stream structured results while validating output fields.
- **[streaming-asserts.ts](https://github.com/ax-llm/ax/tree/main/src/examples/streaming-asserts.ts)** - Enforce line-by-line validation during streaming.
- **[asserts.ts](https://github.com/ax-llm/ax/tree/main/src/examples/asserts.ts)** - Add output assertions and retry behavior.
- **[abort-simple.ts](https://github.com/ax-llm/ax/tree/main/src/examples/abort-simple.ts)** - Cancel a request with `AbortController`.
- **[abort-patterns.ts](https://github.com/ax-llm/ax/tree/main/src/examples/abort-patterns.ts)** - Compare several request cancellation patterns and edge cases.

## Agents and Agent Patterns

- **[agent.ts](https://github.com/ax-llm/ax/tree/main/src/examples/agent.ts)** - Basic multi-agent composition with a shared runtime.
- **[agent-migration-example.ts](https://github.com/ax-llm/ax/tree/main/src/examples/agent-migration-example.ts)** - Migrate to the newer `agent()` factory API.
- **[customer-support.ts](https://github.com/ax-llm/ax/tree/main/src/examples/customer-support.ts)** - Parse support emails into structured support fields.
- **[meetings.ts](https://github.com/ax-llm/ax/tree/main/src/examples/meetings.ts)** - Meeting-oriented assistant workflow example.
- **[show-thoughts.ts](https://github.com/ax-llm/ax/tree/main/src/examples/show-thoughts.ts)** - Surface provider reasoning or thought traces when supported.
- **[self-improving-agent.ts](https://github.com/ax-llm/ax/tree/main/src/examples/self-improving-agent.ts)** - Persist traces and checkpoints for a self-improving workflow.
- **[codingWithMemory.ts](https://github.com/ax-llm/ax/tree/main/src/examples/codingWithMemory.ts)** - Agentic coding flow backed by an MCP memory server.

## RLM and Runtime-State Examples

- **[rlm.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm.ts)** - Core RLM example for long-context analysis with runtime tools.
- **[rlm-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-test.ts)** - Compact RLM test agent with namespaced tools.
- **[rlm-discovery.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-discovery.ts)** - Runtime discovery of tools and permissions in an agent.
- **[rlm-long-task.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-long-task.ts)** - Context-policy example for long-running tasks and checkpoint summaries.
- **[rlm-truncated-context.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-truncated-context.ts)** - Keep only the most relevant tail of a long conversation in prompt context.
- **[rlm-shared-fields.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-shared-fields.ts)** - Propagate shared fields automatically into subagents.
- **[rlm-adaptive-replay.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-adaptive-replay.ts)** - Collapse older turns into checkpoint summaries during replay.
- **[rlm-live-runtime-state.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-live-runtime-state.ts)** - Inspect the structured live runtime-state block in prompts.
- **[rlm-clarification-resume.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-clarification-resume.ts)** - Pause for clarification, save state, and resume later.
- **[rlm-agent-controlled.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-agent-controlled.ts)** - Agent-controlled workflow termination and clarification handling.
- **[rlm-agent-optimize.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rlm-agent-optimize.ts)** - Optimize an RLM agent and persist the resulting artifact.

## Flow Orchestration

- **[ax-flow.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-flow.ts)** - End-to-end AxFlow example with nodes, descriptions, and execution.
- **[ax-flow-enhanced-demo.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-flow-enhanced-demo.ts)** - Explore richer AxFlow composition patterns.
- **[ax-flow-async-map.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-flow-async-map.ts)** - Use async mapping steps inside a flow.
- **[ax-flow-auto-parallel.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-flow-auto-parallel.ts)** - Demonstrate AxFlow automatic parallelization.
- **[ax-flow-map-merge-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-flow-map-merge-test.ts)** - Test mapping and merge behavior in flows.
- **[ax-flow-signature-inference.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-flow-signature-inference.ts)** - Infer flow signatures from connected nodes.
- **[ax-flow-to-function.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-flow-to-function.ts)** - Convert flow logic into function-like execution patterns.
- **[fluent-flow-example.ts](https://github.com/ax-llm/ax/tree/main/src/examples/fluent-flow-example.ts)** - Build flows with the fluent builder API.
- **[flow-type-inference-demo.ts](https://github.com/ax-llm/ax/tree/main/src/examples/flow-type-inference-demo.ts)** - Show state evolution and type inference across flow steps.
- **[flow-type-safe-output.ts](https://github.com/ax-llm/ax/tree/main/src/examples/flow-type-safe-output.ts)** - Produce strongly typed final outputs from a flow.
- **[flow-logging-simple.ts](https://github.com/ax-llm/ax/tree/main/src/examples/flow-logging-simple.ts)** - Attach a simple color logger to a flow.
- **[flow-verbose-logging.ts](https://github.com/ax-llm/ax/tree/main/src/examples/flow-verbose-logging.ts)** - Enable more verbose runtime logging for flow execution.

## Optimization, Training, and Evaluation

- **[teacher-student-optimization.ts](https://github.com/ax-llm/ax/tree/main/src/examples/teacher-student-optimization.ts)** - MiPRO teacher-student optimization with a small model target.
- **[mipro-python-optimizer.ts](https://github.com/ax-llm/ax/tree/main/src/examples/mipro-python-optimizer.ts)** - Run MiPRO with the Python optimizer backend.
- **[simple-optimizer-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/simple-optimizer-test.ts)** - Minimal optimizer setup for a classification task.
- **[optimizer-metrics.ts](https://github.com/ax-llm/ax/tree/main/src/examples/optimizer-metrics.ts)** - Track and inspect optimizer metrics over time.
- **[checkpoint-recovery.ts](https://github.com/ax-llm/ax/tree/main/src/examples/checkpoint-recovery.ts)** - Save and restore optimization checkpoints.
- **[gepa.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gepa.ts)** - Introductory GEPA optimization example.
- **[gepa-flow.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gepa-flow.ts)** - Apply GEPA optimization to a flow-based program.
- **[gepa-train-inference.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gepa-train-inference.ts)** - Train with GEPA and reuse the result for inference.
- **[gepa-quality-vs-speed-optimization.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gepa-quality-vs-speed-optimization.ts)** - Multi-objective GEPA example balancing quality and speed.
- **[ace-train-inference.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ace-train-inference.ts)** - Train and update an ACE playbook from labeled examples.

## RAG, Retrieval, and Memory

- **[vectordb.ts](https://github.com/ax-llm/ax/tree/main/src/examples/vectordb.ts)** - Insert text into an in-memory vector DB and query it.
- **[rag-docs.ts](https://github.com/ax-llm/ax/tree/main/src/examples/rag-docs.ts)** - Build a simple document ingestion and retrieval pipeline.
- **[advanced-rag.ts](https://github.com/ax-llm/ax/tree/main/src/examples/advanced-rag.ts)** - Extend RAG with custom retrieval behavior.

## Multi-Modal, Audio, and Vision

- **[multi-modal.ts](https://github.com/ax-llm/ax/tree/main/src/examples/multi-modal.ts)** - Basic multimodal prompt with image input.
- **[multi-modal-abstraction.ts](https://github.com/ax-llm/ax/tree/main/src/examples/multi-modal-abstraction.ts)** - Higher-level abstractions for multimodal workflows.
- **[image-arrays-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/image-arrays-test.ts)** - Send multiple images in a single request.
- **[image-arrays-multi-provider-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/image-arrays-multi-provider-test.ts)** - Compare multi-image support across providers.
- **[audio-arrays-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/audio-arrays-test.ts)** - Send multiple audio clips and inspect the response.

## Provider-Specific Examples

### Anthropic

- **[anthropic-thinking-function.ts](https://github.com/ax-llm/ax/tree/main/src/examples/anthropic-thinking-function.ts)** - Combine Claude thinking mode with function calls.
- **[anthropic-thinking-separation.ts](https://github.com/ax-llm/ax/tree/main/src/examples/anthropic-thinking-separation.ts)** - Capture reasoning separately from final output.
- **[anthropic-web-search.ts](https://github.com/ax-llm/ax/tree/main/src/examples/anthropic-web-search.ts)** - Use Anthropic web search tooling through Ax.
- **[test-anthropic-cache.ts](https://github.com/ax-llm/ax/tree/main/src/examples/test-anthropic-cache.ts)** - Exercise Anthropic prompt caching behavior.

### Gemini and Vertex

- **[gemini-context-cache.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gemini-context-cache.ts)** - Reuse cached context with Gemini models.
- **[gemini-empty-params-function.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gemini-empty-params-function.ts)** - Call Gemini tools with an empty parameter schema.
- **[gemini-file-support.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gemini-file-support.ts)** - Upload files and reference them in Gemini prompts.
- **[gemini-function-cache.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gemini-function-cache.ts)** - Combine Gemini function calls with caching.
- **[gemini-google-maps.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gemini-google-maps.ts)** - Connect Gemini with Google Maps tool usage.
- **[gemini-parallel-test.ts](https://github.com/ax-llm/ax/tree/main/src/examples/gemini-parallel-test.ts)** - Try parallel Gemini requests and compare outputs.
- **[vertex-auth-example.ts](https://github.com/ax-llm/ax/tree/main/src/examples/vertex-auth-example.ts)** - Authenticate against Vertex AI with dynamic Google auth.

### OpenAI

- **[openai-responses.ts](https://github.com/ax-llm/ax/tree/main/src/examples/openai-responses.ts)** - Use the OpenAI Responses API through Ax.
- **[openai-web-search.ts](https://github.com/ax-llm/ax/tree/main/src/examples/openai-web-search.ts)** - Run a web-search-enabled OpenAI example.
- **[reasoning-o3-example.ts](https://github.com/ax-llm/ax/tree/main/src/examples/reasoning-o3-example.ts)** - Reasoning-focused example using OpenAI `o3`.

### Other Providers

- **[grok-live-search.ts](https://github.com/ax-llm/ax/tree/main/src/examples/grok-live-search.ts)** - Query Grok with live search enabled.
- **[openrouter.ts](https://github.com/ax-llm/ax/tree/main/src/examples/openrouter.ts)** - Route requests through OpenRouter.

## MCP Integrations

- **[mcp-client-memory.ts](https://github.com/ax-llm/ax/tree/main/src/examples/mcp-client-memory.ts)** - Connect to an MCP memory server.
- **[mcp-client-blender.ts](https://github.com/ax-llm/ax/tree/main/src/examples/mcp-client-blender.ts)** - Drive Blender through an MCP client.
- **[mcp-client-pipedream.ts](https://github.com/ax-llm/ax/tree/main/src/examples/mcp-client-pipedream.ts)** - Use Pipedream via MCP transport.
- **[mcp-client-notion-http-oauth.ts](https://github.com/ax-llm/ax/tree/main/src/examples/mcp-client-notion-http-oauth.ts)** - Connect to Notion MCP over HTTP with OAuth.
- **[mcp-client-notion-sse-oauth.ts](https://github.com/ax-llm/ax/tree/main/src/examples/mcp-client-notion-sse-oauth.ts)** - Connect to Notion MCP over SSE with OAuth.

## Routing, Balancing, and Service Selection

- **[balancer.ts](https://github.com/ax-llm/ax/tree/main/src/examples/balancer.ts)** - Balance requests across multiple configured services.
- **[ax-multiservice-router.ts](https://github.com/ax-llm/ax/tree/main/src/examples/ax-multiservice-router.ts)** - Route requests between providers with shared model aliases.

## Observability and Debugging

- **[debug-logging.ts](https://github.com/ax-llm/ax/tree/main/src/examples/debug-logging.ts)** - Enable debug logging for model calls and tool steps.
- **[telemetry.ts](https://github.com/ax-llm/ax/tree/main/src/examples/telemetry.ts)** - Export traces with OpenTelemetry.
- **[metrics-export.ts](https://github.com/ax-llm/ax/tree/main/src/examples/metrics-export.ts)** - Export runtime metrics for external monitoring.

## Browser, Local Runtime, and Deployment

- **[web-chat.html](https://github.com/ax-llm/ax/tree/main/src/examples/web-chat.html)** - Browser chat UI using the Ax bundle.
- **[webllm-chat.html](https://github.com/ax-llm/ax/tree/main/src/examples/webllm-chat.html)** - Browser chat example powered by WebLLM.
- **[cors-proxy.js](https://github.com/ax-llm/ax/tree/main/src/examples/cors-proxy.js)** - Small CORS proxy helper for browser-based development.
- **[docker.ts](https://github.com/ax-llm/ax/tree/main/src/examples/docker.ts)** - Run tool-like tasks inside a Docker session.
