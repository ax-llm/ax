// ax-example:start
// title: Rust Refinement Flow
// group: flows
// description: Drafts, critiques, and revises an answer through three OpenAI-backed steps.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
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
    let draft = ax("topicText:string -> draftText:string")?;
    let critique = ax("draftText:string -> critiqueText:string")?;
    let revise = ax("draftText:string, critiqueText:string -> revisedText:string")?;
    let mut program = flow("examples.refineFlow")
        .execute_with_options(
            "draft",
            draft,
            &json!({"reads": ["topicText"], "writes": ["draftResult", "draftText"]}),
        )
        .execute_with_options(
            "critique",
            critique,
            &json!({"reads": ["draftText"], "writes": ["critiqueResult", "critiqueText"]}),
        )
        .execute_with_options(
            "revise",
            revise,
            &json!({
                "reads": ["draftText", "critiqueText"],
                "writes": ["reviseResult", "revisedText"]
            }),
        )
        .returns(json!({"revisedText": "revisedText"}));
    let output = program.forward(
        &mut client,
        json!({"topicText": "Explain automatic flow parallelism to a backend engineer."}),
    )?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
