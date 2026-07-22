# ai() LLM Models

Use `ai()` to create provider clients and keep model traffic behind one Ax request shape.

```{{fence}}
{{llmCode}}
```

## What It Does

`ai()` selects a provider implementation from configuration and returns a client that Ax programs can call. The client handles chat, streaming, embeddings, media where supported, usage normalization, provider options, model keys, routing hooks, tracing, and runtime defaults.

```mermaid
flowchart LR
  A["Model key or alias"] --> B["Model catalog"]
  B --> C["Capability filter"]
  C --> D["Provider client"]
  D --> E["Request mapping"]
  E --> F["Provider API"]
  F --> G["Response normalization"]
  G --> H["Usage + trace"]
```

## Core Call Shape

Create the client once near the application boundary, then pass it into `forward()`, `streamingForward()`, agents, flows, or optimizers.

```text
client = ai(provider options)
result = program.forward(client, inputs)
```

## Common Patterns

- Use a provider `name` and environment-backed API key.
- Set a default model in provider config when the app has one obvious model.
- Define model aliases when callers should choose `fast`, `smart`, or `cheap` instead of provider model IDs.
- Use OpenAI-compatible `apiURL` for compatible providers.
- Use model catalog helpers before runtime when the UI needs provider/model selectors.
- Use routers or balancers when provider fallback is part of the product.

### Adaptive balancing

`AxBalancer` keeps its existing ordered failover behavior by default. Set `strategy.type` to `adaptive` to rank equivalent providers per chat request using learned reliability, successful latency, a deadline, and estimated cost. Configure `badOutcomeCost` in the same currency or unit as the route cost estimate.

{{aiBalancerExample}}

Use the native stats-store option for authoritative decision state. The built-in in-memory store can be shared by balancers in one process; multi-process applications can implement `AxBalancerStatsStore` with an atomic Redis or database update. The routing-event hook is best-effort telemetry, not routing state. Stable route keys are required with a shared store, and `namespace` plus `slice` keep unrelated traffic from learning from each other.

Adaptive balancing does not inspect prompt meaning or decide which model is best for a task. The application defines acceptable substitutes through shared logical aliases.

### Provider clients

{{aiProviderExamples}}

### Embeddings and audio

{{aiEmbeddingsExample}}

{{aiAudioExample}}

## Practical Notes

- Prefer provider factories over direct provider classes in new code.
- Use model catalog and provider-scoring helpers when choosing between providers.
- Use a multi-service router to dispatch caller-selected model keys; use a balancer for fallback or adaptive operational routing across equivalent services.
- Keep public provider examples separate from internal conformance fixtures.
- Trace provider requests, token usage, estimated cost, and routing decisions in production.

See [ai() API]({{langRoot}}/api/ai/).
