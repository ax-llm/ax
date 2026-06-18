// ax-example:start
// title: Rust Specialist Planner Agent
// group: short-agents
// description: A specialist that plans a migration from a long brief held in contextFields, using a checkpointed contextPolicy and a runtime-output cap to stay compact.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
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
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;

    // A long, messy brief -- exactly the kind of input you do not want replayed into
    // the prompt on every turn. `contextFields` holds it in the runtime, the
    // `checkpointed` policy compacts older turns once the prompt grows, and
    // `maxRuntimeChars` caps how much runtime output is echoed back.
    let brief = r#"# Migration brief: monolith -> services (draft, unordered notes)

Current: single Rails monolith, Postgres primary + 1 replica, Sidekiq for jobs.
Pain: deploys take 40m, one bad migration locks the orders table, on-call burnout.
Constraints: no downtime windows > 5m, PCI scope must shrink, team of 6, 2 quarters.
Hot paths: checkout (writes orders, payments), search (read-heavy), notifications (async).
Known landmines: payments code has no tests; search shares the orders DB; a nightly
cron rebuilds the catalog and pins CPU for ~20m; the replica lags up to 90s under load.
Org wants: independent deploys for checkout, smaller blast radius, an audit trail.
Nice to have: event log for orders, read-model for search, feature flags.
Hard no: a big-bang rewrite; introducing Kubernetes this year."#;

    // `with_runtime` attaches the embedded JS engine so the agent loop can run.
    let mut specialist = agent_with_options(
        "brief:string, goal:string -> plan:string[] \"Ordered, concrete steps\", answer:string, risks:string[]",
        json!({
            "contextFields": ["brief"],
            "contextPolicy": {"preset": "checkpointed", "budget": "balanced"},
            "maxRuntimeChars": 3000,
            "runtime": {"language": "JavaScript"},
        }),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;

    let output = specialist.forward_with_options(
        &mut client,
        json!({
            "brief": brief,
            "goal": "Propose a safe, incremental 2-quarter plan to split checkout out first, respecting the hard constraints.",
        }),
        json!({"max_actor_steps": 12}),
    )?;

    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
