---
name: "ax-cpp-flow"
description: "Use when writing C++ code with `axllm` for flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components."
version: "23.0.5"
---
# AxFlow For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Compose generators, agents, and nested flows into a workflow graph.
- Reason about flow state, node inputs, returns, caching, and errors.
- Use generated package examples for flow graphs and provider-backed flows.

## Package Facts

- Language: C++.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```cpp
auto draft = axllm::ax("topicText:string -> draftText:string");
auto wf = axllm::flow(axllm::object({{"id", "docs.coreFlow"}}))
    .execute("draft", draft, axllm::object({
      {"reads", axllm::array({"topicText"})},
      {"writes", axllm::array({"draftResult", "draftText"})}
    }))
    .returns(axllm::object({{"draftText", "draftText"}}));
```

## More Patterns

### Typed programs

Build each flow node from its own input/output contract.

```cpp
auto classifier = axllm::ax("requestText:string -> route:class \"support, sales, engineering\"");
auto responder = axllm::ax("requestText:string, route:string -> responseText:string");
```

### Class decision

Declare reads and writes so the responder waits for the typed route.

```cpp
auto branch_flow = axllm::flow(axllm::object({{"id", "docs.branchFlow"}}))
    .execute("classifier", classifier, axllm::object({{"reads", axllm::array({"requestText"})}, {"writes", axllm::array({"classifierResult", "route"})}}))
    .execute("responder", responder, axllm::object({{"reads", axllm::array({"requestText", "route"})}, {"writes", axllm::array({"responderResult", "responseText"})}}))
    .returns(axllm::object({{"route", "route"}, {"responseText", "responseText"}}));
```

### Parallel fan-out and join

Independent reads let research and audience analysis share one planner group.

```cpp
auto parallel_flow = axllm::flow(axllm::object({{"id", "docs.parallelFlow"}}))
    .execute("research", research, axllm::object({{"reads", axllm::array({"topicText"})}, {"writes", axllm::array({"researchResult", "factList"})}}))
    .execute("audience", audience, axllm::object({{"reads", axllm::array({"topicText"})}, {"writes", axllm::array({"audienceResult", "audienceAngle"})}}))
    .execute("join", join, axllm::object({{"reads", axllm::array({"factList", "audienceAngle"})}, {"writes", axllm::array({"joinResult", "briefText"})}}))
    .returns(axllm::object({{"briefText", "briefText"}}));
```

### Draft, critique, revise

A linear refinement pipeline makes each dependency explicit.

```cpp
auto refine_flow = axllm::flow(axllm::object({{"id", "docs.refineFlow"}}))
    .execute("draft", draft, axllm::object({{"reads", axllm::array({"topicText"})}, {"writes", axllm::array({"draftResult", "draftText"})}}))
    .execute("critique", critique, axllm::object({{"reads", axllm::array({"draftText"})}, {"writes", axllm::array({"critiqueResult", "critiqueText"})}}))
    .execute("revise", revise, axllm::object({{"reads", axllm::array({"draftText", "critiqueText"})}, {"writes", axllm::array({"reviseResult", "revisedText"})}}))
    .returns(axllm::object({{"revisedText", "revisedText"}}));
```

### Run a flow

Forward accepts the provider client and public inputs.

```cpp
auto output = parallel_flow.forward(
    client,
    axllm::object({{"topicText", "Typed LLM workflows"}}));
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/cpp/subsystems/flow/.

## Relevant API Surface

- Flow: `axllm::flow`, `axllm::AxFlow`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.