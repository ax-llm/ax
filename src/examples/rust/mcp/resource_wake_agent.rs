// ax-example:start
// title: Rust MCP Resource Wake
// group: mcp
// description: Normalizes a subscribed resource notification and dispatches an authenticated wake command to an Agent.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// story: 61
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, AxEventEnvelope, AxEventRoute, AxEventRuntime, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY."))?;
    let runtime = AxEventRuntime::new(vec![AxEventRoute { id:"resource-wake".into(), action:"wake".into(), r#match:json!({"types":["mcp.resource.updated"]}), target_id:Some("inventory-agent".into()), require_authenticated:true, ordering:"strict".into(), debounce_ms:0 }], json!({}))?;
    let normalized = AxEventRuntime::normalize_mcp("inventory", "notifications/resources/updated", json!({"uri":"demo://inventory"}))?;
    let commands = runtime.publish(AxEventEnvelope { specversion:"1.0".into(), id:"resource-1".into(), source:normalized["source"].as_str().unwrap().into(), r#type:normalized["type"].as_str().unwrap().into(), subject:Some("tenant:demo".into()), data:normalized["data"].clone() }, "tenant:demo", "authenticated")?;
    if commands.iter().any(|command| command.action == "wake") {
        let mut llm = OpenAICompatibleClient::new(key, "gpt-5.4-mini");
        let mut agent = agent_with_options("uri:string -> summary:string", json!({"runtime":{"language":"JavaScript"}}))?.with_runtime(Box::new(QuickJsCodeRuntime::new()))?;
        println!("{}", agent.forward(&mut llm, json!({"uri":"demo://inventory"}))?);
    }
    Ok(())
}
