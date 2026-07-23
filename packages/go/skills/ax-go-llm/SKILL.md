---
name: "ax-go-llm"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for using the generated Ax package, factory functions, package docs, examples, and API reference."
version: "23.0.4"
---
# Ax LLM Quick Reference For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Start a generated-language Ax program from package docs or examples.
- Translate the Ax mental model into the target package without TypeScript-only imports.
- Choose the native package entrypoints for signatures, providers, generators, agents, flows, and optimizers.
- Find ordered or adaptive provider-balancing guidance in the language-specific AI skill.

## Package Facts

- Language: Go.
- Package: `github.com/ax-llm/ax/packages/go`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-goja`.

## Core Pattern

```go
import ax "github.com/ax-llm/ax/packages/go"

llm := ax.NewAI("openai", map[string]ax.Value{"apiKey": os.Getenv("OPENAI_API_KEY")})
```

## Relevant API Surface

- Signatures: `axllm.S`, `axllm.FieldType`, `axllm.AxSignature`
- AxGen: `axllm.NewAx`, `axllm.AxGen`
- AxAI: `axllm.NewAI`, `axllm.OpenAICompatibleClient`, `axllm.OpenAIResponsesClient`, `axllm.GoogleGeminiClient`, `axllm.AnthropicClient`, `axllm.AxUsageContext`, `axllm.AxUsageEvent`, `axllm.AxUsageObserver`, `axllm.SetUsageObserver`, `axllm.AxBalancer`, `axllm.AxBalancerAdaptiveStrategy`, `axllm.AxBalancerStatsStore`, `axllm.AxInMemoryBalancerStatsStore`, `axllm.CreateBalancerRouteStats`, `axllm.UpdateBalancerRouteStats`, `axllm.SampleBalancerRouteHealth`, `axllm.MultiServiceRouter`, `axllm.ProviderRouter`
- Agents And RLM: `axllm.NewAgent`, `axllm.AxAgent`
- Flow: `axllm.NewFlow`, `axllm.AxFlow`
- Optimizers: `axllm.Optimize`, `axllm.Playbook`, `axllm.AxPlaybook`, `axllm.AxBootstrapFewShot`, `axllm.AxGEPA`, `axllm.OptimizerEngine`, `axllm.OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.