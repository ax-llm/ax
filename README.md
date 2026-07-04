# Ax — DSPy for TypeScript / Python / Java / C++ / Go / Rust and more

One programming model for building with LLMs across TypeScript, Python, Java,
C++, Go, and Rust.

Ax is TypeScript-first and ships today as `@ax-llm/ax`. The same signatures,
provider mappings, agents, flows, runtime contracts, and optimizers are also
compiled into verified generated Python, Java, C++, Go, and Rust libraries.

[![NPM](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=222&label=npm)](https://www.npmjs.com/package/@ax-llm/ax)
[![PyPI](https://img.shields.io/pypi/v/axllm?style=for-the-badge&color=3775A9&label=pypi)](https://pypi.org/project/axllm/)
[![crates.io](https://img.shields.io/crates/v/axllm?style=for-the-badge&color=E43717&label=crates.io)](https://crates.io/crates/axllm)
[![Maven Central](https://img.shields.io/maven-central/v/dev.axllm/ax?style=for-the-badge&color=C71A36&label=maven)](https://central.sonatype.com/artifact/dev.axllm/ax)
[![Discord](https://img.shields.io/discord/1078454354849304667?style=for-the-badge&color=5865F2&label=discord)](https://discord.gg/DSHg3dU7dW)
[![Follow @dosco on X](https://img.shields.io/badge/Follow_%40dosco-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/intent/follow?screen_name=dosco)

> 💬 **Follow [@dosco](https://x.com/intent/follow?screen_name=dosco) on X** for new releases and to chat about the project.

## What Ax is

- **Signatures** for typed structured generation: string DSL, fluent `f()`
  builder, or any **Standard Schema v1** validator — Zod, Valibot, ArkType.
- **Provider abstraction** across OpenAI-compatible endpoints, OpenAI
  Responses, Anthropic, Gemini, Grok/xAI, Mistral, Cohere, Reka, DeepSeek,
  Azure OpenAI, audio, and realtime event streams.
- **Agents** with runtime execution, context budgets, checkpoints, action-log
  replay, discovery, memory, skills, and delegation.
- **Flows** as typed program graphs with branches, loops, feedback, cache
  behavior, parallel execution, and `.returns(...)` projection.
- **Optimizers** including GEPA, few-shot bootstrapping, portable optimizer
  artifacts, and evaluation/apply flows.
- **One semantic core** compiled into TypeScript, Python, Java, C++, Go, and
  Rust library shapes, so the same Ax program model can move across runtime
  stacks.

## Language Matrix

| Ecosystem | Package / import | Status |
|---|---|---|
| TypeScript / JavaScript | `@ax-llm/ax`<br>`import { ai, ax, agent, flow } from "@ax-llm/ax"` | Published on npm |
| Python | `axllm`<br>`from axllm import ai, ax, agent, flow` | Published on PyPI |
| Java | `dev.axllm:ax`<br>`import dev.axllm.ax.*` | Published on Maven Central |
| C++ | `axllm::axllm`<br>`#include <axllm/axllm.hpp>` | CMake `FetchContent` (source build) |
| Go | `github.com/ax-llm/ax/packages/go`<br>`import ax "github.com/ax-llm/ax/packages/go"` | Installable with `go get`; opt-in `runtime/goja` actor runtime |
| Rust | `axllm`<br>`use axllm::{ai, ax, agent, flow};` | Published on crates.io; protocol-first code runtime |

```mermaid
flowchart LR
  S["Signature (string, f, Standard Schema)"] --> G["AxGen typed generation"]
  G --> P["Provider descriptors / AI clients"]
  G --> A["AxAgent"]
  G --> F["AxFlow"]
  G --> O["GEPA / optimizer artifacts"]
  C["Shared Ax semantics"] --> TS["TypeScript"]
  C --> PY["Python"]
  C --> JV["Java"]
  C --> CP["C++"]
  C --> GO["Go"]
  C --> RS["Rust"]
```

## 30 seconds

The TypeScript package is the source implementation and the current published
package:

```typescript
import { ai, ax } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY });

const classify = ax(
  'review:string -> sentiment:class "positive, negative, neutral"',
);

const { sentiment } = await classify.forward(llm, {
  review: "This product is amazing!",
});
// sentiment: "positive" — typed as the literal union
```

No prompt engineering. Switch `name: "openai"` to `"anthropic"`, `"google-gemini"`, `"mistral"`, `"deepseek"`, `"grok"`, etc. — same signature, same code.

## Same idea in every language

The generated Python, Java, C++, Go, and Rust libraries expose the same top-level Ax
ideas in native package shapes. Their generated source is checked in under
`packages/<language>` so the supported APIs are easy to inspect. The repo
runner uses those committed packages and runs examples without asking you to
remember compiler commands:

```bash
npm run example -- list
npm run example -- python src/examples/python/generation/axgen-openai.py
npm run example -- java src/examples/java/generation/BasicGenerationExample.java
npm run example -- cpp src/examples/cpp/generation/basic_generation.cpp
npm run example -- go src/examples/go/generation/basic_generation.go
npm run example -- rust src/examples/rust/generation/basic_generation.rs
```

See [`src/examples/README.md`](src/examples/README.md) for runnable examples,
[`docs/RELEASE.md`](docs/RELEASE.md) for package/release shape, and
[`docs/COMPILER.md`](docs/COMPILER.md) for how the language-agnostic Ax
compiler works. When AxIR changes, run `npm run axir:generate-packages` to
refresh the checked-in packages.

## Provider-Native Speed

Ax is designed to stay in the same latency class as direct provider calls while adding typed outputs, validation, retries, tools, tracing, and memory. The hot path is intentionally thin: render the signature, call the provider, parse the result, and return a typed value.

Streaming is the default because it lets Ax do useful work before the model finishes: parse fields as they arrive, run streaming assertions, fail early, cancel the in-flight stream, and start correction without spending tokens on an output that is already known to be invalid. When you only want a final object, `forward()` still gives you one; when you want incremental output, `streamingForward()` exposes the stream directly.

The repo includes a streaming benchmark for checking overhead on your own providers and models:

```bash
AX_STREAM_BENCH_PROVIDER=anthropic AX_STREAM_BENCH_MODEL=claude-sonnet-4-5-20250929 AX_STREAM_BENCH_RUNS=2 AX_STREAM_BENCH_WARMUP_RUNS=0 npm run tsx src/examples/streaming-latency.ts
AX_STREAM_BENCH_PROVIDER=google-gemini AX_STREAM_BENCH_MODEL=gemini-3.5-flash AX_STREAM_BENCH_RUNS=2 AX_STREAM_BENCH_WARMUP_RUNS=0 npm run tsx src/examples/streaming-latency.ts
```

Recent runs on Claude Haiku/Sonnet and Gemini Flash/Flash Lite show provider queueing and model generation dominate total latency; AxGen stays close to the raw `ai.chat()` path while providing the structured-output control loop that direct SDK calls leave to application code.

## Examples

### Structured extraction

```typescript
const extract = ax(`
  customerEmail:string, currentDate:datetime ->
  priority:class "high, normal, low",
  sentiment:class "positive, negative, neutral",
  ticketNumber?:number,
  nextSteps:string[],
  estimatedResponseTime:string
`);

const result = await extract.forward(llm, {
  customerEmail: "Order #12345 hasn't arrived. Need this resolved immediately!",
  currentDate: new Date(),
});
```

### Nested objects with `f()`

```typescript
import { ax, f } from "@ax-llm/ax";

const productExtractor = f()
  .input("productPage", f.string())
  .output("product", f.object({
    name: f.string(),
    price: f.number(),
    specs: f.object({
      dimensions: f.object({ width: f.number(), height: f.number() }),
      materials: f.array(f.string()),
    }),
    reviews: f.array(f.object({ rating: f.number(), comment: f.string() })),
  }))
  .build();

const gen = ax(productExtractor);
const { product } = await gen.forward(llm, { productPage: "..." });
// product.specs.dimensions.width is typed end-to-end
```

### Standard Schema v1 (Zod / Valibot / ArkType)

Any Standard Schema v1 validator works wherever `f.*` is accepted — at field level, whole-object level, or on a `fn()` tool. Same retry pipeline, same type inference, no adapter.

```typescript
import { z } from "zod";
import { ax, f, fn } from "@ax-llm/ax";

// (1) Per-field zod — mix freely with f.* fields
const reviewSentiment = ax(
  f()
    .input("productName", z.string().describe("Reviewed product"))
    .input("reviewText", z.string().min(10))
    .output("sentiment", z.enum(["positive", "neutral", "negative"]))
    .output("score", z.number().min(1).max(10))
    .output("keyPoints", z.array(z.string()))
    .build(),
);

// (2) Whole-object zod — declare once, decomposed into ordered fields
const productSummary = ax(
  f()
    .input(z.object({ productName: z.string(), buyerProfile: z.string() }))
    .output(z.object({
      headline: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      recommendation: z.enum(["buy", "wait", "skip"]),
    }))
    .build(),
);

// (3) Whole-object zod on fn() — typed tool definition
const lookupProduct = fn("lookupProduct")
  .description("Look up a product by name")
  .arg(z.object({ productName: z.string().min(1), includeSpecs: z.boolean().optional() }))
  .returns(z.object({ price: z.number(), inStock: z.boolean(), rating: z.number().min(1).max(5) }))
  .handler(async ({ productName }) => ({ price: 79.99, inStock: true, rating: 4.3 }))
  .build();
```

`.min()`, `.max()`, `.email()`, `.url()`, `.regex()` feed the normal retry pipeline; `.refine()`, `.transform()`, and `.superRefine()` execute at parse time on complete field values, in both streaming and non-streaming. Cache breakpoints and internal reasoning fields use companion options: `{ cache: true }`, `{ internal: true }`. Multimodal inputs (`image`, `audio`, `file`) still use `f.*`.

Runnable: [`src/examples/standard-schema.ts`](src/examples/standard-schema.ts).

### Tools (ReAct)

```typescript
const assistant = ax("question:string -> answer:string", {
  functions: [
    { name: "getCurrentWeather", func: weatherAPI },
    { name: "searchNews", func: newsAPI },
  ],
});

const { answer } = await assistant.forward(llm, {
  question: "What's the weather in Tokyo and any news about it?",
});
```

### Multi-modal

```typescript
const analyze = ax(`
  image:image, question:string ->
  description:string,
  mainColors:string[],
  category:class "electronics, clothing, food, other",
  estimatedPrice:string
`);
```

### Audio

Batch speech APIs are exposed by AI services: `ai.transcribe({ audio })` turns audio into text, and `ai.speak({ text })` turns text into an audio artifact. Signature audio outputs are scripted artifacts: the model writes the text for `speech:audio`, then Ax synthesizes it after parsing.

```typescript
const say = ax("question:string -> speech:audio, summary:string");
const res = await say.forward(llm, { question: "Greet the team." }, {
  speech: { speak: { voice: "alloy", format: "mp3" } },
});

console.log(res.speech.data);       // base64 audio
console.log(res.speech.transcript); // generated script
```

Agents transcribe `:audio` inputs before the planner/executor/responder stages, so tools and memory receive stable text rather than base64 payloads. Native conversational audio is still available through `.chat()`.

OpenAI supports both request-based audio chat (`gpt-audio`, `gpt-audio-mini`) and realtime voice/transcription models (`gpt-realtime-2`, `gpt-realtime-whisper`). Gemini native audio uses the Live API under the same `.chat()` shape; Grok Voice uses the realtime voice endpoint.

These same three audio paths ship in all five generated ports (Python, Go, Rust, Java, C++): batch `transcribe()`/`speak()`, `.chat()` with `input_audio` content parts, and realtime voice over WebSocket — realtime-capable models route transparently through `chat()`, or you can call the productized `realtime_chat()` driver directly (Go: `RealtimeChat`). Each port ships an offline `realtime_audio_turn` example and an opt-in dependency for the socket (see the install notes below).

```typescript
import WebSocket from "ws";
import {
  ai,
  axAIOpenAIRealtimeDefaultConfig,
  axAIOpenAIRealtimeTranscriptionDefaultConfig,
} from "@ax-llm/ax";

const voice = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: axAIOpenAIRealtimeDefaultConfig(), // gpt-realtime-2
});

const stream = await voice.chat(
  { chatPrompt: [{ role: "user", content: "Say hello out loud." }] },
  { stream: true, webSocket: WebSocket },
);

for await (const chunk of stream) {
  const audio = chunk.results[0]?.audio;
  if (audio?.isDelta) {
    // base64 pcm16 audio bytes
    process.stdout.write(".");
  }
}

const transcriber = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: axAIOpenAIRealtimeTranscriptionDefaultConfig(), // gpt-realtime-whisper
});
```

Runnable: [`src/examples/audio-chat.ts`](src/examples/audio-chat.ts) streams realtime audio, saves a WAV, and plays it when a local player is available. [`src/examples/audio-batch-and-agent.ts`](src/examples/audio-batch-and-agent.ts) writes generated MP3 artifacts under `src/examples/output/` and plays them immediately.

## AxAgent

`AxAgent` is a three-stage pipeline that turns a signature into a long-running, tool-using actor. Each `forward()` call runs distiller → executor → responder.

```mermaid
flowchart LR
  IN["inputs"] --> D["Distiller"]
  D --> E["Executor (RLM loop)"]
  E --> RT["AxJSRuntime sandbox"]
  E --> FN["functions / child agents"]
  E --> M["recall - memories"]
  E --> SK["consult - skills"]
  E --> RES["Responder"]
  RES --> OUT["typed output"]
```

```typescript
import { agent, AxJSRuntime } from "@ax-llm/ax";

const analyzer = agent(
  "context:string, query:string -> answer:string, evidence:string[]",
  {
    agentIdentity: {
      name: "documentAnalyzer",
      description: "Analyze long documents with iterative code + sub-queries",
    },
    contextFields: ["context"],
    runtime: new AxJSRuntime(),
    maxTurns: 20,
    maxRuntimeChars: 2_000,
    contextPolicy: { preset: "checkpointed", budget: "balanced" },
    executorOptions: { model: "gpt-5.4-mini" },
  },
);

const result = await analyzer.forward(llm, {
  context: veryLongDocument,
  query: "What are the main arguments and supporting evidence?",
});
```

The **recursive runtime** (RLM) keeps long context out of the root prompt: the executor runs JS in a persistent sandboxed session, narrows context with `llmQuery(...)` sub-calls, and uses checkpointed replay so older turns collapse into summaries instead of growing the prompt unbounded.

You don't have to remember the knobs: `autoUpgrade` (ON by default) keeps oversized input values runtime-only with a truncated prompt preview even when they aren't declared in `contextFields`, and turns on `functionDiscovery` automatically when the inline tool docs get large. Explicit settings always win; pass `autoUpgrade: false` to opt out.

Runnable: [`src/examples/rlm-agent-controlled.ts`](src/examples/rlm-agent-controlled.ts), [`src/examples/rlm-discovery.ts`](src/examples/rlm-discovery.ts).

### Context map, memories, skills, sandboxed runtime

Four orthogonal options on `agent(...)`. Opt in to what the task needs.

**Context map** — a small persistent orientation cache for repeated questions over the same long context. When configured, Ax shows it to the distiller and updates it once after each successful completed run. By default the map keeps evolving forever; set `infiniteEvolve: false` with `evolveSteps` on the map object to do a finite warmup and then reuse a frozen map. Use `onUpdate` to save the new snapshot wherever your app stores state.

```typescript
import { agent, AxAgentContextMap } from "@ax-llm/ax";

const map = new AxAgentContextMap(savedSnapshot, {
  maxChars: 4000,
  infiniteEvolve: false,
  evolveSteps: 10,
});

const analyzer = agent("context:string, query:string -> answer:string", {
  contextFields: ["context"],
  contextMap: {
    map,
    onUpdate: ({ map }) => saveSnapshot(map.snapshot()),
  },
});
```

**Memories** — vector / BM25 / KV lookup the actor controls via `await recall([...])`. Results land on `inputs.memories` for the next turn. Lifetime is one `.forward()`; persist externally to carry across calls.

```typescript
const myAgent = agent("task:string -> plan:string", {
  onMemoriesSearch: async (searches, alreadyLoaded) => {
    const skip = new Set(alreadyLoaded.map((m) => m.id));
    return (await myVectorDB.searchBatch(searches, { topK: 3 }))
      .filter((m) => !skip.has(m.id));
  },
  onUsedMemories: (results) => console.log("[memories]", results.map((r) => r.id)),
});
```

**Skills** — guidance / runbook bodies the actor pulls in on demand via `await consult([...])`. Loaded skills render under "Loaded Skills" in the executor system prompt and persist across `.forward()` calls.

```typescript
const myAgent = agent("task:string -> plan:string", {
  onSkillsSearch: async (searches) =>
    mySkillStore.searchBatch(searches, { topK: 2 }),
  // Or preload statically — `consult()` not required:
  skills: [{ name: "release-checklist", content: "1. Bump version\n2. ..." }],
});
```

**Sandboxed JS runtime** — `AxJSRuntime` is the default; it is hardened by default and portable across Node, Bun (`smol: true` workers), Deno, and the browser. Capabilities are opt-in via permissions.

```typescript
import { AxJSRuntime, AxJSRuntimePermission } from "@ax-llm/ax";

const runtime = new AxJSRuntime({
  permissions: [AxJSRuntimePermission.NETWORK], // grant fetch only
});
```

Defaults: `import()` blocked, intrinsics frozen, `ShadowRealm` locked, worker IPC locked, and on Node 20+ the OS Permission Model auto-engages as a second defense layer. Add `FILESYSTEM`, `STORAGE`, `CHILD_PROCESS`, etc. only as the task requires.

Security model: the runtime is defense-in-depth for LLM-authored code, not a container or VM boundary. Host callbacks and the permissions you grant remain the authority boundary; keep durable secrets and privileged effects in host-side functions.

Runnable: [`src/examples/rlm-memories-and-skills.ts`](src/examples/rlm-memories-and-skills.ts).

## AxFlow + optimization

`AxFlow` is a typed, chainable workflow runner — define nodes, wire state through `execute`, and finalize outputs with `returns`. State types evolve as you add nodes, so the final output mapper is fully type-checked. Independent node executes are planned as a safe DAG optimization when their metadata reads and writes do not conflict.

```typescript
import { ai, AxAIOpenAIModel, AxGEPA, flow } from "@ax-llm/ax";

const emailFlow = flow<{ emailText: string }>()
  .description("Email Priority", "Classify priority and write a one-line rationale.")
  .n("classifier", 'emailText:string -> priority:class "high, normal, low"')
  .n("rationale", "emailText:string, priority:string -> rationale:string")
  .e("classifier", (s) => ({ emailText: s.emailText }))
  .e("rationale", (s) => ({ emailText: s.emailText, priority: s.classifierResult.priority }))
  .r((s) => ({
    priority: s.classifierResult.priority,
    rationale: s.rationaleResult.rationale,
  }));
```

Tune the whole flow with **GEPA** (multi-objective Pareto optimizer). Define a metric that returns one or more named scores; GEPA explores the prompt space and returns a Pareto front.

```typescript
const student = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT54Mini } });
const teacher = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT54 } });

const optimizer = new AxGEPA({
  studentAI: student,
  teacherAI: teacher,
  numTrials: 16,
  minibatch: true,
  minibatchSize: 6,
  seed: 42,
});

const result = await optimizer.compile(
  emailFlow,
  trainSet,
  async ({ prediction, example }) => ({
    accuracy: prediction.priority === example.priority ? 1 : 0,
    brevity: (prediction.rationale?.length ?? 0) <= 60 ? 1 : 0.4,
  }),
  { auto: "medium", validationExamples: valSet, maxMetricCalls: 240 },
);
// result.paretoFront, result.hypervolume, result.paretoFrontSize
```

## Capabilities

| Capability | Entrypoint | Notes |
|---|---|---|
| String signature DSL | `ax`, `s` | `'review:string -> sentiment:class "..."'` |
| Fluent signature builder | `f` | typed nesting, constraints, retry on validation error |
| Standard Schema v1 | `f`, `fn` | Zod, Valibot, ArkType — per-field or whole-object |
| Tools / function calling | `fn`, `functions:` option | typed args, typed return, async handler |
| Streaming + validation | `.streamingForward()` | parses at field boundaries |
| Multi-modal | `f.image`, `f.audio`, `.chat({ audio })` | OpenAI, Gemini, Anthropic |
| Batch STT/TTS | `ai.transcribe`, `ai.speak` | OpenAI, xAI, Gemini, Mistral where provider endpoints exist |
| Signature audio artifacts | `speech:audio` outputs + `speech` options | model emits script text, Ax synthesizes audio after parsing |
| Conversational audio | `.chat()` + `result.audio` | OpenAI `gpt-audio*`, `gpt-realtime-2`, `gpt-realtime-whisper`; Gemini Live native audio; Grok Voice; also in Python/Go/Rust/Java/C++ via `realtime_chat()` |
| Workflows | `flow` | typed program graphs, branching, loops, parallelism, `.returns(...)` |
| Optimization | `AxGEPA`, `AxBootstrapFewShot` | Pareto front, few-shot, portable optimizer artifacts |
| Agent loop | `agent`, `AxAgent` | distiller → executor → responder |
| Context map | `contextMap`, `AxAgentContextMap` | persistent orientation cache for recurring long context |
| Memories | `onMemoriesSearch`, `recall(...)` | vector/BM25-backed context loader |
| Skills | `onSkillsSearch`, `consult(...)` | on-demand prompt-section loader |
| Sandboxed JS runtime | `AxJSRuntime`, `AxJSRuntimePermission` | TypeScript runtime for Node, Bun, Deno, browser |
| Recursive runtime (RLM) | `agent({ runtime, contextFields })` | long-context REPL with checkpointed replay |
| Providers | `ai({ name: ... })` | OpenAI, OpenAI Responses, Azure OpenAI, Anthropic, Gemini, Mistral, Cohere, Reka, DeepSeek, Grok/xAI, Bedrock (separate pkg) |
| OpenAI-compatible endpoints | `ai({ name: "openai", apiURL, apiKey, models })` | one path for custom OpenAI-compatible gateways |
| Observability | OpenTelemetry, `actorTurnCallback`, `onFunctionCall` | per-turn telemetry, tool-call tracing |
| MCP | `AxMCPClient`, `AxMCPStreamableHTTPTransport`, `AxMCPStdioTransport` | use any MCP server as a tool source |

## Install

TypeScript / JavaScript:

```bash
npm install @ax-llm/ax
```

The generated Python, Java, C++, Go, and Rust libraries are checked in under `packages/`,
verified in this repo, and installable from each language's package manager (all Apache-2.0):

- **Python**: `pip install axllm` (realtime audio: `pip install axllm[realtime]`)
- **Rust**: `cargo add axllm` (realtime audio: `cargo add axllm --features realtime`)
- **Go**: `go get github.com/ax-llm/ax/packages/go` (realtime audio needs Go 1.23+ and pulls `github.com/coder/websocket` automatically)
- **Java**: `dev.axllm:ax` on Maven Central (Gradle / Maven snippet in [`packages/java`](packages/java/README.md)); realtime audio uses the JDK's built-in WebSocket — no extra dependency
- **C++**: CMake `FetchContent` (`GIT_REPOSITORY https://github.com/ax-llm/ax`,
  `SOURCE_SUBDIR packages/cpp`), then link `axllm::axllm` (realtime audio: build with `-DAXLLM_ENABLE_REALTIME=ON`)

Optional packages:

```bash
npm install @ax-llm/ax-ai-aws-bedrock     # AWS Bedrock provider
npm install @ax-llm/ax-ai-sdk-provider    # Vercel AI SDK v7 integration
npm install @ax-llm/ax-tools              # MCP stdio transport, JS runtime extras
```

## Documentation

**Get started**
- [Quick Start](https://github.com/ax-llm/ax/blob/main/src/ax/README.md)
- [Runnable examples](src/examples/README.md)
- [Multi-language release shape](docs/RELEASE.md)
- [Compiler architecture](docs/COMPILER.md)
- [DSPy concepts](https://axllm.dev/typescript/concepts/dspy/)
- [Signatures](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-signature.md)

**Deep dives**
- [AI providers](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-ai.md)
- [Audio I/O](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-audio.md)
- [AxFlow workflows](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-flow.md)
- [Optimization (GEPA, ACE)](https://axllm.dev/typescript/concepts/optimization/)
- [AxAgent & RLM](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-agent.md)
- [Advanced RAG](https://axllm.dev/typescript/examples/)

## Run examples

```bash
OPENAI_APIKEY=your-key npm run tsx ./src/examples/<name>.ts
npm run example -- list
npm run example -- list --json
npm run example -- ts src/examples/typescript/generation/axgen-openai.ts
npm run example -- python src/examples/python/short-agents/agent-openai.py
npm run example -- java src/examples/java/flows/SequentialFlowExample.java
npm run example -- cpp src/examples/cpp/audio/speech_audio.cpp
npm run example -- go src/examples/go/optimization/axgen_optimization.go
npm run example -- rust src/examples/rust/generation/basic_generation.rs
```

`npm run example -- list` shows public provider-backed examples for TypeScript,
Python, Java, C++, Go, and Rust. Public examples live under
`src/examples/<language>/<group>/`, use `ax-example` metadata headers, call real
providers, and read credentials from `.env`. Internal generated-package fixtures
remain under `packages/<language>/examples` for AxIR verification, but the public
catalog and website are generated only from `src/examples/<language>/`.

Highlights: `extract.ts`, `react.ts`, `agent.ts`, `streaming1.ts`, `multi-modal.ts`, `audio-chat.ts`, `audio-batch-and-agent.ts`, `standard-schema.ts`, `rlm-memories-and-skills.ts`, `rlm-discovery.ts`, `gepa-flow.ts`, `openai-compatible.ts`, `ax-flow-enhanced-demo.ts`. [Browse all examples →](src/examples/)

## Community

- [Discord](https://discord.gg/DSHg3dU7dW) — questions and discussion
- [Twitter](https://twitter.com/dosco) — updates
- [GitHub](https://github.com/ax-llm/ax) — source and issues
- [DeepWiki](https://deepwiki.com/ax-llm/ax) — AI-generated docs

## Contributing

Ax is TypeScript-first. Most contributors and coding agents should focus on the
TypeScript source change they are making and should not try to update every
generated language backend by hand.

When a PR changes portable behavior under `src/ax/ai/`, `src/ax/dsp/`,
`src/ax/agent/`, `src/ax/flow/`, or `src/ax/mcp/`, CI will ask for either
AxIR/conformance updates or an AxIR backlog entry. If you are not already
working in AxIR, use the backlog path:

```bash
npm run axir:backlog -- add --title "..." --surface axai --impact "..." --paths src/ax/ai/...
npm run axir:backlog:validate
```

That keeps normal TypeScript PRs small while giving AxIR maintainers and coding
agents a precise queue for migrating the behavior into Python, Java, C++, Go,
and future generated backends later.

## Questions or feedback?

**Follow [@dosco](https://x.com/intent/follow?screen_name=dosco) on X** to keep up with new releases and chat with
me about the project — or [open an issue](https://github.com/ax-llm/ax/issues) or join the
[Discord](https://discord.gg/DSHg3dU7dW).

## License

Apache 2.0
