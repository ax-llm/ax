// ax-example:start
// title: Rust Decision Evidence Reranking
// group: generation
// description: Ranks documents through Ax signatures while retaining decision evidence and candidate IDs.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
use axllm::{ai, ax, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let mut model = ai("openai-decisions", json!({"api_key":env::var("OPENAI_API_KEY").or_else(|_|env::var("OPENAI_APIKEY")).expect("Set OPENAI_API_KEY or OPENAI_APIKEY")}))?;
    let mut judge = ax("query:string, document:string -> relevant:boolean(evidence, threshold 0.7), relevance:score \"Irrelevant, Related, Partial answer, Direct answer\"(evidence)")?;
    let mut ranked=Vec::new();
    for (id,text) in [("refund","Request a refund within 30 days through your account billing page."),("password","Reset your password using the sign-in page.")] {
        let mut result=judge.forward(&mut model,json!({"query":"How do I request a refund?","document":text}))?;
        result["id"]=json!(id); ranked.push(result);
    }
    ranked.sort_by(|a,b| b["relevance"]["value"].as_f64().unwrap().total_cmp(&a["relevance"]["value"].as_f64().unwrap()));
    println!("{}",serde_json::to_string_pretty(&ranked)?);
    Ok(())
}
