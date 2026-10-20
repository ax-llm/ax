---
name: "ax-java-typesafe"
description: "Use when writing Java code with `dev.axllm:ax` for Typesafe Jev image inputs, boolean/class/rubric score/box signatures, decision evidence and provenance, native Noul/Choice/Score/Box, structured criteria and hybrid generation."
version: "25.4.4"
---
# Typesafe / Jev For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Use Jev for typed decisions with ordinary Ax signatures.
- Retain probabilities and scores through evidence-bearing AxGen signatures; use native questions for advanced criteria or structured state.
- Compose a separate generative program for prose or tools.

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
var model = Ax.ai("typesafe", Map.of("apiKey", apiKey, "trueThreshold", 0.9));
var triage = Ax.ax("ticket:string -> urgent:boolean(true \"Core task blocked\", false \"Routine request\"), team:class \"support, billing, engineering\"");
var decision = triage.forward(model, Map.of("ticket", ticket));
```

## Decision evidence

Add (evidence) to boolean/class/score/box signature outputs to retain probabilities, values, provenance, and native class/score confidence through AxGen. Boolean threshold 0.7 is local to that field; scalar fields still use provider trueThreshold. A plain score returns a continuous zero-based rubric index.

Native selected classes and continuous scores are preserved, even when they differ from argmax or a weighted mean. Generative providers elicit probabilities, derive values locally, omit confidence, and use provenance.source=elicited. Ax attaches actual provider/model provenance. The result shape does not make confidence or calibration comparable across models.

By default a decision refusal raises a terminal AxDecisionRefusalError without correction retries. Use (evidence, refusal return) for an answered/refused union. Generated-language error envelopes retain the decision error type. Arrays, optional fields and nested evidence work with generative models; native providers require flat required scalar fields. Streaming emits only complete evidence. Label-only examples never manufacture distributions.

For reranking, evaluate query/document pairs with the same score rubric, retain candidate IDs outside the model, and sort by relevance.value. Runnable decision-evidence examples are under src/examples/java/generation/.

## Typesafe / Jev

The typesafe provider supports required boolean, class, ordered rubric score, and box outputs. Use score "Low, Medium, High" to declare a rubric. Numeric bounds never define a Score rubric; ordinary numbers, freeform strings, optional outputs, output arrays, nested outputs, audio, tools, and sampling controls are rejected before transport.

Set provider trueThreshold (or true_threshold) to a finite value in [0,1], default 0.5. Boolean conversion uses noul >= threshold; this policy is local and never sent. Choice returns the selected label without a confidence cutoff.

Use boolean(true "Core task blocked", false "Routine request") and class label descriptions for criteria. Fluent describe_values / describeValues / DescribeValues keeps the same field value type. C++ uses valueDescriptions on its existing field descriptors. Other providers receive readable prompt and schema descriptions.

The separate native client exposes system_one / systemOne / SystemOne and list_models / listModels / ListModels. Native probabilities remain unchanged. Score returns a fractional zero-based rubric position: convert scales explicitly in application code. Entries may be text, structured JSON objects/arrays, or null. Choice allows 1–255 labels; Score requires 2–10 rubric levels. The service context limit covers state, questions, and criteria; Ax never truncates or pretends to count native tokens exactly.

Choice and Score probabilities must be finite values in [0,1], match the criteria keys, and sum to one within an inclusive 0.01 tolerance. Totals of 0.99 and 1.01 are accepted with an allowance for floating-point summation error. Ax preserves the returned probabilities without renormalizing them.

Image localization uses photo:image -> visible:boolean, target:box(evidence). Inputs accept PNG/JPEG base64 in {mimeType, data}; native requests use assets keyed by unique references appearing in string values of state, instructions, or criteria. Ax preserves image order and sends TypeSafe-Danger-Zone-Images: true. Use jev-1.14.0 or jev-preview for experimental Box support. A Box always exists even when the target is absent; check a presence boolean before consuming it.

Box edges are normalized top, bottom, left, right in [0,1], with top < bottom and left < right. Plain box fields return coordinates; evidence adds value, provenance, and native confidence when supplied. Generative vision providers use the same validated schema with elicited provenance and no invented confidence. OpenAI Decisions accepts images for boolean/class/score questions and rejects native Box outputs before transport.

Native Box questions require instructions and an image asset and omit criteria. Rust keeps existing TypesafeRequest literals and adds assets with request.with_assets(...). Image assets use format png/jpg/jpeg and data_base64; multipart uploads are unsupported. Every reference must occur in a string value, never only an object key. Ax enforces 16 MiB per decoded image, 32 MiB per request and reference byte limits. Jev enforces 256–1568 pixels per side and at least 78,400 pixels; Ax does not resize images. Runnable localization examples are under src/examples/java/generation/.

The default model is jev-latest. Use API keys or renewable credential callbacks, the shared HTTP transport, retry settings, timeout, and cancellation. Native model discovery is separate from configured Ax model aliases. Typed native answers retain question names; only TypeScript can infer literal question keys and Choice-label unions at compile time. Other languages use their native typed maps/records/enums.

Typesafe-only balancers propagate the output-schema requirement. Mixed pools retain ordinary prompts and select Typesafe only when the actual request already has a supported schema. Unsupported requests remain excluded during fallback and degradation. Typesafe has no token streaming; the provider returns one completed result through its stream interface.

Runnable signature, native criteria/scoring, and two-program hybrid examples are under src/examples/java/generation/. See https://axllm.dev/java/examples/generation/.

## Relevant API Surface

- Signatures: `Ax.s`, `Ax.f`, `AxSignature`
- AxGen: `Ax.ax`, `AxGen`, `Ax.runControl`, `AxRunControl`, `AxCachingFunction`, `AxGlobals.setCachingFunction`
- AxAI: `Ax.ai`, `Ax.openaiDecisions`, `AxAIOpenAIDecisionsClient`, `Ax.typesafe`, `AxAITypesafeClient`, `AxCancellationToken`, `AxAIServiceAbortedError`, `Ax.getSupportedAIModels`, `OpenAICompatibleClient.CredentialRequest`, `OpenAICompatibleClient.CredentialProvider`, `AiClient.ownedWorkerFactory`, `AxChatSession`, `AxChatStream`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `Map<String, Object>`, `AxUsageEvent`, `AxUsageObserver`, `AxGlobals.setUsageObserver`, `AxRuntimeHooks`, `AxRateLimitInfo`, `AxRateLimiter`, `AxTracer`, `AxMeter`, `AxGlobals`, `AxGlobals.setRateLimiter`, `AxGlobals.setTracer`, `AxGlobals.setMeter`, `AxBalancer`, `AxBalancerAdaptiveStrategy`, `AxBalancerStatsStore`, `AxInMemoryBalancerStatsStore`, `AxBalancerAdaptive.createRouteStats`, `AxBalancerAdaptive.updateRouteStats`, `AxBalancerAdaptive.sampleRouteHealth`, `MultiServiceRouter`, `ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
