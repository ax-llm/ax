---
name: "ax-cpp-flow"
description: "Use when writing C++ code with `axllm` for flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components."
version: "24.0.17"
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

### Fan-out and join

Independent reads place research and audience analysis in one planner group; the generated runtime currently executes its nodes serially.

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

## Astra Session Work

Select `gpt-6-astra` through the ordinary OpenAI factory. The adapter chooses Responses automatically; existing model defaults are unchanged. Use low reasoning and standard processing. Portable minimal reasoning maps to low; none is rejected. EU residency does not support priority processing.

Keep applications on their generation, agent, and flow entrypoints. Declare only independent tools as background; ordinary and imported MCP tools stay blocking unless the application explicitly changes their declaration. A promise, thread, or MCP hint is not a background declaration. Set `asyncMode` to `off` for the ordinary tool loop; chat-only services retain that loop automatically.

Attach the language-native run controller through forward options for steering, reasoning changes, cancellation, and lifecycle events. Queued and applied are different states. HTTP applies updates at a response boundary; an optional host WebSocket enables native steering. Do not manage response IDs, socket messages, or tool-result submission in application code.

A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session and reports unresolved call IDs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.

Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.

C++ session tools validate required raw-schema properties and argument types before invoking handlers. Invalid arguments enter the correction loop, and step exhaustion fails the run. Full raw JSON Schema constraint coverage remains incomplete.

Generated flow groups currently execute serially in Python, Go, Java, C++, and Rust. Sequential node isolation and background tool/model overlap within a node do not establish concurrent node execution. The TypeScript parallel-flow examples describe TypeScript behavior only.

Use the provider-backed Astra examples under `src/examples/cpp/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.

## Relevant API Surface

- Flow: `axllm::flow`, `axllm::AxFlow`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.