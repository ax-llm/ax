---
name: "ax-java-audio"
description: "Use when writing Java code with `dev.axllm:ax` for audio input/output, OpenAI Responses audio mapping, realtime event folding, and generated package audio examples."
version: "24.0.23"
---
# Ax Audio And Realtime For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Map speech, transcription, or realtime events through the generated provider surface.
- Use no-key examples for event folding and provider request mapping.
- Keep live provider calls behind explicit credentials and provider-api examples.

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

## Speech And Audio Fields

- `speak()` returns TypeScript's speech result keys: `data` (base64 audio), `format`, `mimeType`, `transcript` (the spoken text), and `sampleRate` / `channels` when the mime type gives them. The older keys `audio`, `mime_type`, and `sample_rate` stay beside them until the next major version; read the TypeScript keys in new code.
- As in TypeScript, a binary speech body's Content-Type is its `mimeType` (else the format's mime type), and a JSON body (by its Content-Type) is read from `audio_data`, `audioData`, `data`, `audio.data`, `output.audio.data`, or a Gemini part's inline data. A JSON body whose audio is under the older `audio` key still works, with a one-time deprecation warning, until the next major version; a JSON body with no audio raises TypeScript's error.
- Speak requests match TypeScript: OpenAI defaults to `gpt-4o-mini-tts` with the `alloy` voice, sends a `{ id }` voice by its id, sends `speed` when set, and asks for `pcm` when the format is `pcm16`; Mistral defaults to `voxtral-mini-tts-2603` and sends the voice as `voice_id`; Grok sends `speed` when set.
- The renderer calls `AiClient.speak(request, options)`: `AxAIService` clients speak, and a client without speech throws `UnsupportedOperationException`.
- An AxGen `audio` output field becomes speech with the `renderAudio` / `render_audio` option (see the gen skill): the field then holds the `speak()` result, with the spoken text as its `transcript`.
- An agent's `audio` output fields render the same way when `renderAudio` / `render_audio` is set on the agent, its `responderOptions`, or the forward call (the call's wins); as in TypeScript, the responder's `speak()` request takes the forward call's `speech` or `responderOptions.speech`, not a top-level `speech` option.
- An audio input that is a string, or an audio object with a string `transcript` (a rendered audio output), reaches the model as text. Audio without a transcript goes as an audio part with only its `format` (`wav` when it has none) and `data`.

## Relevant API Surface

- AxAI: `Ax.ai`, `Ax.typesafe`, `AxAITypesafeClient`, `AxCancellationToken`, `AxAIServiceAbortedError`, `Ax.getSupportedAIModels`, `OpenAICompatibleClient.CredentialRequest`, `OpenAICompatibleClient.CredentialProvider`, `AiClient.ownedWorkerFactory`, `AxChatSession`, `AxChatStream`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `Map<String, Object>`, `AxUsageEvent`, `AxUsageObserver`, `AxGlobals.setUsageObserver`, `AxRuntimeHooks`, `AxRateLimitInfo`, `AxRateLimiter`, `AxTracer`, `AxMeter`, `AxGlobals`, `AxGlobals.setRateLimiter`, `AxGlobals.setTracer`, `AxGlobals.setMeter`, `AxBalancer`, `AxBalancerAdaptiveStrategy`, `AxBalancerStatsStore`, `AxInMemoryBalancerStatsStore`, `AxBalancerAdaptive.createRouteStats`, `AxBalancerAdaptive.updateRouteStats`, `AxBalancerAdaptive.sampleRouteHealth`, `MultiServiceRouter`, `ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
