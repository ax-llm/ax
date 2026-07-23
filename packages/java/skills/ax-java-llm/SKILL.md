---
name: "ax-java-llm"
description: "Use when writing Java code with `dev.axllm:ax` for using the generated Ax package, factory functions, package docs, examples, and API reference."
version: "23.0.4"
---
# Ax LLM Quick Reference For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Start a generated-language Ax program from package docs or examples.
- Translate the Ax mental model into the target package without TypeScript-only imports.
- Choose the native package entrypoints for signatures, providers, generators, agents, flows, and optimizers.
- Find ordered or adaptive provider-balancing guidance in the language-specific AI skill.

## Package Facts

- Language: Java.
- Package: `dev.axllm:ax`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```java
import dev.axllm.ax.*;

var llm = Ax.ai("openai", java.util.Map.of("apiKey", System.getenv("OPENAI_API_KEY")));
```

## Relevant API Surface

- Signatures: `Ax.s`, `Ax.f`, `AxSignature`
- AxGen: `Ax.ax`, `AxGen`
- AxAI: `Ax.ai`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `Map<String, Object>`, `AxUsageEvent`, `AxUsageObserver`, `AxGlobals.setUsageObserver`, `AxBalancer`, `AxBalancerAdaptiveStrategy`, `AxBalancerStatsStore`, `AxInMemoryBalancerStatsStore`, `AxBalancerAdaptive.createRouteStats`, `AxBalancerAdaptive.updateRouteStats`, `AxBalancerAdaptive.sampleRouteHealth`, `MultiServiceRouter`, `ProviderRouter`
- Agents And RLM: `Ax.agent`, `AxAgent`
- Flow: `Ax.flow`, `AxFlow`
- Optimizers: `Ax.optimize`, `Ax.playbook`, `AxPlaybook`, `AxBootstrapFewShot`, `AxGEPA`, `OptimizerEngine`, `OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.