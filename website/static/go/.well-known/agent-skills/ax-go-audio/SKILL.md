---
name: "ax-go-audio"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for audio input/output, OpenAI Responses audio mapping, realtime event folding, and generated package audio examples."
version: "24.0.23"
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

## Speech And Audio Fields

- `speak()` returns TypeScript's speech result keys: `data` (base64 audio), `format`, `mimeType`, `transcript` (the spoken text), and `sampleRate` / `channels` when the mime type gives them. The older keys `audio`, `mime_type`, and `sample_rate` stay beside them until the next major version; read the TypeScript keys in new code. A binary speech body reaches the package without its Content-Type, so `mimeType` then comes from the format.
- The renderer calls the client's `Speak(ctx, request, options)`: `AxAIService` clients have it, and the `AIClient` interface does not require it, so a custom client without `Speak` cannot render audio.
- An AxGen `audio` output field becomes speech with the `renderAudio` / `render_audio` option (see the gen skill): the field then holds the `speak()` result, with the spoken text as its `transcript`.
- An audio input that is a string, or an audio object with a string `transcript` (a rendered audio output), reaches the model as text. Audio without a transcript goes as an audio part with only its `format` (`wav` when it has none) and `data`.

## Relevant API Surface

- AxAI: `axllm.NewAI`, `axllm.Typesafe`, `axllm.AxAITypesafeClient`, `context.Context`, `axllm.AxAIServiceAbortedError`, `axllm.GetSupportedAIModels`, `axllm.AxCredentialRequest`, `axllm.AxCredentialProvider`, `AxOwnedClientFactory.OwnedWorkerFactory`, `axllm.AxChatSession`, `axllm.AxChatStream`, `axllm.OpenAICompatibleClient`, `axllm.OpenAIResponsesClient`, `axllm.GoogleGeminiClient`, `axllm.AnthropicClient`, `axllm.AxUsageContext`, `axllm.AxUsageEvent`, `axllm.AxUsageObserver`, `axllm.SetUsageObserver`, `axllm.AxRuntimeHooks`, `axllm.AxRateLimitInfo`, `axllm.AxRateLimiter`, `axllm.AxTracer`, `axllm.AxMeter`, `axllm.AxGlobals`, `axllm.SetRateLimiter`, `axllm.SetTracer`, `axllm.SetMeter`, `axllm.AxBalancer`, `axllm.AxBalancerAdaptiveStrategy`, `axllm.AxBalancerStatsStore`, `axllm.AxInMemoryBalancerStatsStore`, `axllm.CreateBalancerRouteStats`, `axllm.UpdateBalancerRouteStats`, `axllm.SampleBalancerRouteHealth`, `axllm.MultiServiceRouter`, `axllm.ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
