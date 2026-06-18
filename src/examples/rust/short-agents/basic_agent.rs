// ax-example:start
// title: Rust Grounded Support Agent
// group: short-agents
// description: Answers a support question grounded in a handbook that is kept out of the model prompt via contextFields.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 20
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

    // The handbook can be arbitrarily large. Listing it in `contextFields` keeps
    // it in the agent's runtime so it never inflates the model prompt -- the agent
    // reads it through code, not through tokens.
    let handbook = r#"
# Acme Cloud -- Support Handbook

## Billing
- Invoices are issued on the 1st of each month and are due net-15.
- Plan downgrades take effect at the END of the current billing cycle, not immediately.
- Refunds are issued to the original payment method within 5 business days.

## Access
- Seats can be added by any workspace Owner under Settings -> Members.
- SSO (SAML) is available on Enterprise; SCIM provisioning is Owner-only.

## Incidents
- Status and uptime are published at status.acme.example.
- Sev-1 incidents page the on-call within 5 minutes; updates post every 30 minutes.

## Data
- Exports are available in CSV and JSON from Settings -> Data.
- Deleted workspaces are recoverable for 30 days, then permanently purged.
"#;

    // `with_runtime` attaches the embedded JS engine so the agent loop can run.
    let mut assistant = agent_with_options(
        "question:string, handbook:string -> answer:string, citations:string[] \"Handbook sections the answer relies on\"",
        json!({"contextFields": ["handbook"], "runtime": {"language": "JavaScript"}}),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;

    let output = assistant.forward_with_options(
        &mut client,
        json!({
            "question": "A customer downgraded their plan today. When does it take effect, and can they get a refund for the current cycle?",
            "handbook": handbook,
        }),
        json!({"max_actor_steps": 12}),
    )?;

    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
