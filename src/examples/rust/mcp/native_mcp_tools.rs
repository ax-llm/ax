// ax-example:start
// title: Rust Native MCP Tools
// group: mcp
// description: Attaches a live MCP client directly to AxGen without a lossy function adapter.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, MCP_URL
// level: beginner
// order: 10
// story: 60
// ax-example:end
use axllm::{
    ax, AxExecutionContext, AxMCPClient, AxMCPStreamableHTTPTransport, AxResult,
    OpenAICompatibleClient,
};
use serde_json::json;
use std::{
    env,
    sync::{Arc, Mutex},
};

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY."))?;
    let endpoint = env::var("MCP_URL").map_err(|_| axllm::AxError::runtime("Set MCP_URL."))?;
    let transport = AxMCPStreamableHTTPTransport::new(endpoint, json!({}))?;
    let mcp = Arc::new(Mutex::new(AxMCPClient::new(
        Box::new(transport),
        json!({"namespace":"inventory"}),
    )));
    let context = AxExecutionContext::new(vec![mcp.clone()], vec![])?;
    let catalog = mcp.lock().unwrap().inspect_catalog(false)?;
    println!(
        "MCP catalog: {} tools, {} resources, {} templates",
        catalog.tools.len(),
        catalog.resources.len(),
        catalog.resource_templates.len()
    );
    let mut program = ax("request:string -> answer:string")?.with_execution_context(context)?;
    let mut llm = OpenAICompatibleClient::new(key, "gpt-5.4-mini");
    println!(
        "{}",
        program.forward(&mut llm, json!({"request":"Reindex inventory."}))?
    );
    mcp.lock().unwrap().close()?;
    Ok(())
}
