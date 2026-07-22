---
name: "ax-java-flow"
description: "Use when writing Java code with `dev.axllm:ax` for flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components."
version: "23.0.3"
---
# AxFlow For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Compose generators, agents, and nested flows into a workflow graph.
- Reason about flow state, node inputs, returns, caching, and errors.
- Use generated package examples for flow graphs and provider-backed flows.

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
AxGen draft = Ax.ax("topicText:string -> draftText:string");
AxFlow wf = Ax.flow(java.util.Map.of("id", "docs.coreFlow"))
    .execute("draft", draft, java.util.Map.of(
        "reads", java.util.List.of("topicText"),
        "writes", java.util.List.of("draftResult", "draftText")))
    .returns(java.util.Map.of("draftText", "draftText"));
```

## More Patterns

### Typed programs

Build each flow node from its own input/output contract.

```java
AxGen classifier = Ax.ax("requestText:string -> route:class \"support, sales, engineering\"");
AxGen responder = Ax.ax("requestText:string, route:string -> responseText:string");
```

### Class decision

Declare reads and writes so the responder waits for the typed route.

```java
AxFlow branchFlow = Ax.flow(Map.of("id", "docs.branchFlow"))
    .execute("classifier", classifier, Map.of("reads", List.of("requestText"), "writes", List.of("classifierResult", "route")))
    .execute("responder", responder, Map.of("reads", List.of("requestText", "route"), "writes", List.of("responderResult", "responseText")))
    .returns(Map.of("route", "route", "responseText", "responseText"));
```

### Parallel fan-out and join

Independent reads let research and audience analysis share one planner group.

```java
AxFlow parallelFlow = Ax.flow(Map.of("id", "docs.parallelFlow"))
    .execute("research", research, Map.of("reads", List.of("topicText"), "writes", List.of("researchResult", "factList")))
    .execute("audience", audience, Map.of("reads", List.of("topicText"), "writes", List.of("audienceResult", "audienceAngle")))
    .execute("join", join, Map.of("reads", List.of("factList", "audienceAngle"), "writes", List.of("joinResult", "briefText")))
    .returns(Map.of("briefText", "briefText"));
```

### Draft, critique, revise

A linear refinement pipeline makes each dependency explicit.

```java
AxFlow refineFlow = Ax.flow(Map.of("id", "docs.refineFlow"))
    .execute("draft", draft, Map.of("reads", List.of("topicText"), "writes", List.of("draftResult", "draftText")))
    .execute("critique", critique, Map.of("reads", List.of("draftText"), "writes", List.of("critiqueResult", "critiqueText")))
    .execute("revise", revise, Map.of("reads", List.of("draftText", "critiqueText"), "writes", List.of("reviseResult", "revisedText")))
    .returns(Map.of("revisedText", "revisedText"));
```

### Run a flow

Forward accepts the provider client and the public flow inputs.

```java
var output = parallelFlow.forward(client, Map.of("topicText", "Typed LLM workflows"));
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/java/subsystems/flow/.

## Relevant API Surface

- Flow: `Ax.flow`, `AxFlow`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
