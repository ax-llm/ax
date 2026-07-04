# Performance

Claims about agent frameworks are cheap. This page sticks to what we measured, how, and what we explicitly do not claim — anchored by a checked-in example you can run yourself.

## The Reproducible Anchor

{{agentGroundedAuditExample}}

The [grounded-audit example](https://github.com/ax-llm/ax/blob/main/src/examples/agent-grounded-audit.ts) gives an agent a 250-row ledger as a runtime-only context field — the model never sees the rows in its prompt — and asks it to audit one project: total spend, transaction count, and exactly which transactions exceed each vendor's risk-tier approval threshold (a three-way join across the ledger and two tools). The example computes the same answer in plain code and **asserts** the agent matched it, exiting non-zero on any mismatch.

Run on `gemini-3.5-flash` — a small, cheap model — it reproduced the exact ground truth in 3 of 3 verification runs: total to the cent, count, and the full sorted id list. That is the pitch in one artifact: *the pipeline, not model size, keeps the agent grounded.*

```bash
GOOGLE_APIKEY=... npm run tsx src/examples/agent-grounded-audit.ts
```

## Why It Stays Grounded

Two structural properties, not prompt tricks:

- **The model computes on data instead of reading it.** Bulky inputs live in the runtime session; the actor writes code against them; only compact evidence summaries enter the prompt. Prompt size — and therefore grounding — is independent of data size.
- **Shape hints kill silent guessing.** Evidence summaries list the real field names of runtime values, so the actor writes `t.amountCents` rather than hallucinating `t.amount` and producing zeros that look like answers.

## Against The Prior Pipeline

When we replaced the materialized-evidence handoff with the shared-session design, we benchmarked both on the same audit-style task, same models, same usage-measurement APIs, 3 runs per configuration (June 2026):

| Pipeline | Accuracy (of 3) | Effective tokens |
| --- | --- | --- |
| Released v22.0.9 (evidence materialized into the executor prompt) | 0.50 | ~5.7k |
| Current (shared session, evidence by reference) | 2.33 | ~5.8k |

Roughly a 4.7× accuracy improvement at token parity — with the caveat stated plainly: one task family, n=3 per cell. The prior pipeline's dominant failure was structural, which is why we trust the direction: its distiller pre-computed (often wrong) scalar answers and the sealed executor could neither reach the raw data nor its tools to check them.

## Model Guidance

Same audit-style task, 3 runs per model, current pipeline:

| Model | Accuracy (of 3) | Notes |
| --- | --- | --- |
| `gemini-3.5-flash` | 3.00 | Perfect on every run, including the doc-gated tool chain — the reliability pick |
| `gpt-5.4` | 2.33 | Strong; occasionally shortcut the hardest join |
| `gemini-3.1-flash-lite` | 2.00 | Same score every run, 3–6 s end to end — the cost/latency pick |
| `gpt-5.4-mini` | ~0.5 | Frequently skipped tools and answered from priors — not recommended for this regime |

Treat this as guidance, not a leaderboard: it is one task family, and models move fast. The durable takeaway is that small, cheap models are genuinely viable in this harness — pick one and verify with your own assertions, the way the example does.

## Practical Reliability Notes

- **Keep small tool sets flat and inline.** Grouped discovery earns its keep at catalog scale; below that, inline schemas are the most reliable shape, especially on smaller models.
- **Assert ground truth where you can.** The grounded-audit pattern — compute the expected answer in code, assert the agent matched — is cheap insurance for any agent with a deterministic sub-result.
- **Prefer typed outputs over prose parsing.** The signature validates and retries with feedback; that loop is where a lot of practical reliability comes from.

## What We Don't Claim

We do not claim token-cost savings from the evidence-by-reference design — we tested for them and they did not materialize. A code-first agent processes bulky data in code and does not re-read it in its context window across turns, so the cost the design avoids is largely a one-time (and cacheable) prompt cost, not a compounding one. The measured wins are **correctness, bounded context occupancy at any data size, and isolation of raw context from the tool-using stage** — not a smaller bill.
