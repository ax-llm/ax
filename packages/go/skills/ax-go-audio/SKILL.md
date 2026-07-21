---
name: "ax-go-audio"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for audio input/output, OpenAI Responses audio mapping, realtime event folding, and generated package audio examples."
version: "23.0.3"
---
# Ax Audio And Realtime For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Map speech, transcription, or realtime events through the generated provider surface.
- Use no-key examples for event folding and provider request mapping.
- Keep live provider calls behind explicit credentials and provider-api examples.

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

- AxAI: `axllm.NewAI`, `axllm.OpenAICompatibleClient`, `axllm.OpenAIResponsesClient`, `axllm.GoogleGeminiClient`, `axllm.AnthropicClient`, `axllm.AxBalancer`, `axllm.MultiServiceRouter`, `axllm.ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.