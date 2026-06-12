use axllm::{
    agent_with_options, AxAIClient, AxCodeRuntime, AxCodeSession, AxResult, RuntimeEnvelope,
};
use serde_json::{json, Value};
use std::collections::VecDeque;

struct ScriptedService {
    responses: VecDeque<Value>,
}

impl AxAIClient for ScriptedService {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        let content = self
            .responses
            .pop_front()
            .ok_or_else(|| axllm::AxError::runtime("scripted service exhausted"))?;
        Ok(json!({"results": [{"content": content["content"], "function_calls": []}]}))
    }
}

struct ScriptedSession;

impl AxCodeSession for ScriptedSession {
    fn execute(&mut self, _code: &str, _options: Value) -> AxResult<RuntimeEnvelope> {
        Ok(RuntimeEnvelope {
            payload: json!({"type": "final", "args": [{"answer": "runtime"}]}),
        })
    }
    fn inspect_globals(&mut self, _options: Value) -> AxResult<Value> {
        Ok(json!({}))
    }
    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        Ok(json!({"globals": {}}))
    }
    fn patch_globals(&mut self, snapshot: Value, _options: Value) -> AxResult<Value> {
        Ok(snapshot)
    }
    fn close(&mut self) -> AxResult<Value> {
        Ok(json!({"closed": true}))
    }
}

struct ScriptedRuntime;

impl AxCodeRuntime for ScriptedRuntime {
    fn language(&self) -> &str {
        "javascript"
    }
    fn create_session(
        &mut self,
        _globals: Value,
        _options: Value,
    ) -> AxResult<Box<dyn AxCodeSession>> {
        Ok(Box::new(ScriptedSession))
    }
}

fn main() -> AxResult<()> {
    let mut service = ScriptedService {
        responses: VecDeque::from(vec![
            json!({"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"}),
            json!({"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"}),
            json!({"content": "{\"answer\":\"Paris\"}"}),
        ]),
    };
    let mut qa = agent_with_options(
        "question:string -> answer:string",
        json!({"contextFields": []}),
    )?;
    let output = qa.forward(&mut service, json!({"question": "Capital of France?"}))?;
    assert_eq!(output, json!({"answer": "Paris"}));
    let chat_log = qa.get_chat_log();
    assert_eq!(
        chat_log.last().and_then(|entry| entry.get("name")).cloned(),
        Some(json!("responder"))
    );
    let mut runtime = ScriptedRuntime;
    let runtime_out = qa.test(
        &mut runtime,
        "final({answer: 'runtime'})",
        json!({"question": "runtime?"}),
    )?;
    assert_eq!(runtime_out.payload["kind"], json!("final"));
    println!("rust-axagent-ok");
    Ok(())
}
