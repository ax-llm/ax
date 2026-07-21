// ax-example:start
// title: Rust Parallel Flow
// group: flows
// description: Runs two independent OpenAI-backed steps in parallel before joining their results.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
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
    let research = ax("topicText:string -> factList:string[]")?;
    let audience = ax("topicText:string -> audienceAngle:string")?;
    let join = ax("factList:string[], audienceAngle:string -> briefText:string")?;
    let mut program = flow("examples.parallelFlow")
        .execute_with_options(
            "research",
            research,
            &json!({"reads": ["topicText"], "writes": ["researchResult", "factList"]}),
        )
        .execute_with_options(
            "audience",
            audience,
            &json!({"reads": ["topicText"], "writes": ["audienceResult", "audienceAngle"]}),
        )
        .execute_with_options(
            "join",
            join,
            &json!({
                "reads": ["factList", "audienceAngle"],
                "writes": ["joinResult", "briefText"]
            }),
        )
        .returns(json!({"briefText": "briefText"}));
    let output = program.forward(
        &mut client,
        json!({"topicText": "Why typed contracts make multi-step LLM systems easier to maintain"}),
    )?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
