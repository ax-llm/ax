// ax-example:start
// title: Rust Multi-Model Panel
// group: short-agents
// description: Fans one question across three providers (OpenAI, Gemini, Anthropic), then judges the candidates and synthesizes a single grounded answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, GOOGLE_APIKEY, ANTHROPIC_APIKEY
// level: advanced
// order: 40
// ax-example:end
use axllm::{ax, AnthropicClient, AxResult, GoogleGeminiClient, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::env;

fn main() -> AxResult<()> {
    let openai_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .ok();
    let google_key = env::var("GOOGLE_APIKEY")
        .or_else(|_| env::var("GOOGLE_API_KEY"))
        .ok();
    let anthropic_key = env::var("ANTHROPIC_APIKEY")
        .or_else(|_| env::var("ANTHROPIC_API_KEY"))
        .ok();
    let (Some(openai_key), Some(google_key), Some(anthropic_key)) =
        (openai_key, google_key, anthropic_key)
    else {
        return Err(axllm::AxError::runtime(
            "Set OPENAI_APIKEY, GOOGLE_APIKEY, and ANTHROPIC_APIKEY to run this multi-provider panel.",
        ));
    };

    // A panel of three different providers, each answering the same question
    // independently. Plain ax() composition (no agent runtime): fan out to the
    // panel, judge the candidates, then synthesize one grounded answer.
    let mut openai = OpenAICompatibleClient::new(openai_key, "gpt-4o-mini")
        .with_model_config(json!({"temperature": 0}));
    let mut gemini =
        GoogleGeminiClient::new(google_key, "gemini-3-flash-preview").with_profile("google-gemini");
    let mut anthropic =
        AnthropicClient::new(anthropic_key, "claude-haiku-4-5").with_profile("anthropic");

    let mut researcher = ax(
        "question:string -> answer:string, keyFindings:string[], citations:string[], confidence:number",
    )?;
    researcher.set_instruction(
        "Answer independently. Use evidence. Call out uncertainty. Do not optimize for consensus.",
    );

    let mut judge = ax(
        "question:string, candidates:json -> consensus:string[], contradictions:string[], uniqueInsights:string[], blindSpots:string[]",
    )?;
    judge.set_instruction(
        "Compare the candidates. Find agreement, conflicts, missing coverage, and unique useful points.",
    );

    let mut synthesizer = ax(
        "question:string, candidates:json, review:json -> answer:string, citations:string[], caveats:string[]",
    )?;
    synthesizer.set_instruction(
        "Write one final answer grounded in the candidates and review. Resolve conflicts explicitly.",
    );

    let question = "What are the strongest arguments for and against a national carbon tax?";

    // Fan the same question across every provider, tagging each candidate with
    // the model that produced it.
    let mut candidates: Vec<Value> = Vec::new();
    let panel: [(&str, &mut OpenAICompatibleClient); 3] = [
        ("openai/gpt-4o-mini", &mut openai),
        ("google/gemini-3-flash", &mut gemini),
        ("anthropic/claude-haiku-4.5", &mut anthropic),
    ];
    for (model, client) in panel {
        let mut response = researcher.forward(client, json!({"question": question}))?;
        if let Value::Object(map) = &mut response {
            map.insert("model".to_string(), json!(model));
        }
        candidates.push(response);
    }

    // The judge + synthesizer run on one of the panel clients (OpenAI here).
    let candidates = Value::Array(candidates);
    let review = judge.forward(
        &mut openai,
        json!({"question": question, "candidates": candidates}),
    )?;
    let final_answer = synthesizer.forward(
        &mut openai,
        json!({"question": question, "candidates": candidates, "review": review}),
    )?;

    println!("{}", serde_json::to_string_pretty(&final_answer)?);
    Ok(())
}
