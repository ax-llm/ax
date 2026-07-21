// ax-example:start
// title: Rust Branching Flow
// group: flows
// description: Routes a classification through follow-up flow logic backed by OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
use axllm::{ax, flow, AxResult, OpenAICompatibleClient};
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
    let classifier = ax("request:string -> route:class \"support, sales, engineering\"")?;
    let responder = ax("request:string, route:string -> response:string")?;
    let mut program = flow("examples.branchFlow")
        .execute_with_options(
            "classifier",
            classifier,
            &json!({"reads": ["request"], "writes": ["classifierResult", "route"]}),
        )
        .execute_with_options(
            "responder",
            responder,
            &json!({
                "reads": ["request", "route"],
                "writes": ["responderResult", "response"]
            }),
        )
        .returns(json!({"route": "route", "response": "response"}));
    let output = program.forward(
        &mut client,
        json!({"request": "A customer says checkout is down for their enterprise account."}),
    )?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
