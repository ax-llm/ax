---
name: "ax-rust-agent-optimize"
description: "Use when writing Rust code with `axllm` for agent optimization, verified agent-playbook evolution, evaluators, judges, optimizer artifacts, BootstrapFewShot, and GEPA."
version: "25.4.7"
---
# AxAgent Optimize For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Optimize an AxAgent or reusable program component.
- Mine grounded weaknesses from failed agent tasks and keep only playbook proposals that pass the verification gate.
- Create evaluator callbacks and persist optimizer artifacts.
- Keep optimization runs bounded by explicit budgets and dataset rows.

## Package Facts

- Language: Rust.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`.

## Core Pattern

```rust
let mut engine = axllm::AxGEPA::new().with_reflection_client(reflection_client);
let result = engine.optimize(request, evaluator)?;
let baseline = result["baselineScore"].as_f64().unwrap();
let delta = result["metadata"]["bestScore"].as_f64().unwrap() - baseline;
```

## Relevant API Surface

- Agents And RLM: `agent`, `AxAgent`, `AxAgent::with_child_agent`, `AxAgent::streaming_forward`
- Optimizers: `optimize`, `playbook`, `AxPlaybook`, `AxBootstrapFewShot`, `AxGEPA`, `OptimizerEngine`, `OptimizerEvaluator`, `optimize_with_client`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
- GEPA returns baselineScore and baselineScores at the artifact top level and in metadata, measured before bootstrap or component changes. Compare metadata.bestScore with baselineScore; the original candidate need not remain on the Pareto frontier.
- Baseline and seeded validation use the same capped held-out subset and selection scalarization. Both consume maxMetricCalls. Bootstrap generation has separate limits; metadata.bootstrapMetricCalls plus metadata.totalMetricCalls equals metadata.totalCalls. Without new demos, reuse the baseline evaluation.
- Bootstrap demos contain only fresh training inputs and outputs; never recover demos from a retained validation or inactive-child trace tree.
- Use optimize_with_client(&mut program, student.clone(), examples, options) with Rc<RefCell<Client>> for live student evaluation. The client-free optimize helper requires explicitly pre-scored tasks. Use AxGEPA with an evaluator closure for application-specific metrics.