// docs:start provider-agent
use axllm::{agent, AxAIClient, AxResult, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::env;

struct ProviderAgentClient {
    inner: OpenAICompatibleClient,
    raw_model_answer: Option<String>,
    calls: usize,
}

impl AxAIClient for ProviderAgentClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        self.calls += 1;
        if self.raw_model_answer.is_none() {
            let response = self.inner.chat(json!({
                "chat_prompt": [{
                    "role": "user",
                    "content": "In one sentence, explain what Ax helps developers build."
                }]
            }))?;
            let answer = response["results"][0]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();
            self.raw_model_answer = Some(answer);
        }
        let answer = self.raw_model_answer.clone().unwrap_or_default();
        let payload = if self.calls == 1 {
            json!({"completion": {"type": "final", "args": ["Answer", {}]}})
        } else if self.calls == 2 {
            json!({"completion": {"type": "final", "args": ["Answer", {"answer": answer}]}})
        } else {
            json!({"answer": answer})
        };
        Ok(json!({"results": [{"content": payload.to_string(), "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime(
                "Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.",
            )
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    let client =
        OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0}));
    let mut stage_client = ProviderAgentClient {
        inner: client,
        raw_model_answer: None,
        calls: 0,
    };
    let mut assistant = agent("question:string -> answer:string")?;
    let output = assistant.forward(
        &mut stage_client,
        json!({"question": "In one sentence, explain what Ax helps developers build."}),
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "agentOutput": output,
            "rawModelAnswer": stage_client.raw_model_answer
        }))?
    );
    Ok(())
}
// docs:end provider-agent
