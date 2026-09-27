// ax-example:start
// title: Rust Streaming Agent
// group: short-agents
// description: Streams an agent's answer as field deltas while its evidence citations are checked against what the agent read from a handbook kept out of the prompt.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 15
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::cell::Cell;
use std::env;
use std::io::Write;

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
    let handbook = r#"
# Acme Cloud -- Support Handbook

## Billing
- Plan downgrades take effect at the END of the current billing cycle, not immediately.
- Refunds are issued to the original payment method within 5 business days.

## Data
- Deleted workspaces are recoverable for 30 days, then permanently purged.
"#;

    // The handbook stays in the agent's runtime, out of the prompt. With
    // citations on, the answer cites the evidence it used, and ids the run
    // never gathered are sent back to the model for a correction.
    let mut assistant = agent_with_options(
        "question:string, handbook:string -> answer:string",
        json!({"contextFields": ["handbook"], "runtime": {"language": "JavaScript"}, "citations": {}}),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;
    assistant.set_citations_observer(|ids| println!("\ncited: {ids}"));

    // The distiller and the executor run first; then the responder's answer
    // streams. Merge each delta and start over when the version changes (a retry).
    let seen = Cell::new(0);
    assistant.streaming_forward(
        &mut client,
        json!({
            "question": "I downgraded today. When does it take effect, and is my data safe if I delete the workspace?",
            "handbook": handbook,
        }),
        json!({"max_actor_steps": 12}),
        move |delta| {
            if delta.version != seen.get() {
                seen.set(delta.version);
                println!("\n[retry: starting over]");
            }
            if let Some(text) = delta.delta["answer"].as_str() {
                print!("{text}");
                std::io::stdout().flush().ok();
            }
            Ok(())
        },
    )?;
    println!();
    Ok(())
}
