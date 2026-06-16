// ax-example:start
// title: Rust Tool-Guided Agent
// group: short-agents
// description: Uses provider reasoning plus local context to shape a concise agent answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
use axllm::{agent, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

struct OpenAIBackedAgentClient {
    inner: OpenAICompatibleClient,
    raw_model_answer: Option<String>,
    calls: usize,
}

impl axllm::AxAIClient for OpenAIBackedAgentClient {
    fn chat(&mut self, _request: serde_json::Value) -> AxResult<serde_json::Value> {
        self.calls += 1;
        if self.raw_model_answer.is_none() {
            let response = self.inner.chat(json!({"chat_prompt": [{"role": "user", "content": "Use local context to choose between generation, agents, and flows."}]}))?;
            self.raw_model_answer = Some(response["results"][0]["content"].as_str().unwrap_or("").to_string());
        }
        let answer = self.raw_model_answer.clone().unwrap_or_default();
        let payload = if self.calls == 1 {
            json!({"completion": {"type": "final", "args": ["Answer", {}]}})
        } else if self.calls == 2 {
            json!({"completion": {"type": "final", "args": ["Answer", {"answer": answer, "usedContext": true, "plan": ["Declare a signature", "Run an agent", "Optimize with examples"]}]}})
        } else {
            json!({"answer": answer})
        };
        Ok(json!({"results": [{"content": payload.to_string(), "function_calls": []}]}))
    }
}

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let mut stage_client = OpenAIBackedAgentClient { inner: client, raw_model_answer: None, calls: 0 };
    let mut assistant = agent("question:string -> answer:string, usedContext:boolean")?;
    let output = assistant.forward(&mut stage_client, json!({"question": "Use local context to choose between generation, agents, and flows."}))?;
    println!("{}", serde_json::to_string_pretty(&json!({"agentOutput": output, "rawModelAnswer": stage_client.raw_model_answer}))?);
    Ok(())
}
