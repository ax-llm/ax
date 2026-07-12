// ax-example:start
// title: Rust MCP Task Continuation
// group: mcp
// description: Correlates a terminal MCP task event and dispatches a resume command to the owning AxFlow host.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// story: 62
// ax-example:end
use axllm::{ax, AxEventEnvelope, AxEventRoute, AxEventRuntime, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY."))?;
    let runtime = AxEventRuntime::new(vec![AxEventRoute { id:"task-resume".into(), action:"resume".into(), r#match:json!({"types":["mcp.task.status"]}), target_id:Some("reindex-flow".into()), require_authenticated:false, ordering:"strict".into(), debounce_ms:0 }], json!({}))?;
    let normalized = AxEventRuntime::normalize_mcp("inventory", "notifications/tasks/status", json!({"task":{"taskId":"42","status":"completed"}}))?;
    let commands = runtime.publish(AxEventEnvelope { specversion:"1.0".into(), id:"task-42-complete".into(), source:normalized["source"].as_str().unwrap().into(), r#type:normalized["type"].as_str().unwrap().into(), subject:Some("inventory:42".into()), data:normalized["data"].clone() }, "tenant:demo", "authenticated")?;
    if commands.iter().any(|command| command.action == "resume") {
        let mut llm = OpenAICompatibleClient::new(key, "gpt-5.4-mini");
        let mut flow = axllm::flow("reindex-flow").execute("status", ax("taskId:string -> status:string")?).returns(json!({"status":"status"}));
        println!("{}", flow.forward(&mut llm, json!({"taskId":"42"}))?);
    }
    Ok(())
}
