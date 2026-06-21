// ax-example:start
// title: Rust Incident Triage Agent
// group: short-agents
// description: Triages a noisy incident report held in contextFields, using a lean contextPolicy to keep the raw log out of the prompt while it reasons.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;

    // A raw, noisy incident report. It lives in `contextFields`, so the agent works
    // it inside the runtime; `contextPolicy: lean` keeps the prompt compact by
    // preferring live runtime state and summaries over replaying the raw text.
    let report = r#"[2026-03-02 14:01:22Z] INFO  gateway       deploy svc-checkout-edge v812 -> prod (channel: canary 10%)
[2026-03-02 14:03:10Z] WARN  checkout-api  p95 latency 1180ms (baseline 240ms) region=eu-west-1
[2026-03-02 14:04:55Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise
[2026-03-02 14:05:01Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise
[2026-03-02 14:05:40Z] WARN  payments-gw   circuit half-open, 3 retries exhausted for order=ord_99214
[2026-03-02 14:06:12Z] INFO  gateway       canary widened 10% -> 50% for svc-checkout-edge v812
[2026-03-02 14:07:33Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise
[2026-03-02 14:08:02Z] ERROR checkout-api  user-visible: "Payment could not be processed" shown to 1,284 sessions
[2026-03-02 14:09:48Z] WARN  payments-gw   connection pool exhausted (max=64) waiting=210
[2026-03-02 14:11:20Z] INFO  on-call       paged: SEV-2 opened (eu-west-1 checkout error rate 38%)
[2026-03-02 14:14:05Z] INFO  gateway       rollback svc-checkout-edge v812 -> v811 (channel: prod 100%)
[2026-03-02 14:17:41Z] INFO  checkout-api  p95 latency 260ms, error rate 0.4% region=eu-west-1
[2026-03-02 14:19:10Z] INFO  on-call       SEV-2 mitigated, monitoring for 30m"#;

    // `with_runtime` attaches the embedded JS engine so the agent loop can run.
    let mut triage = agent_with_options(
        "report:string, question:string -> severity:class \"low, medium, high, critical\", rootCause:string, nextSteps:string[], evidence:string[] \"Quoted log lines that support the assessment\"",
        json!({
            "contextFields": ["report"],
            "contextPolicy": {"preset": "lean", "budget": "balanced"},
            "runtime": {"language": "JavaScript"},
        }),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;

    let output = triage.forward_with_options(
        &mut client,
        json!({
            "report": report,
            "question": "What happened, how bad was it, and what should the on-call do next? Cite the lines you relied on.",
        }),
        json!({"max_actor_steps": 12}),
    )?;

    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
