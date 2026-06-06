use axllm::{agent, AxAIClient, AxResult};
use serde_json::{json, Value};
use std::collections::VecDeque;

struct FakeService {
    responses: VecDeque<Value>,
}

impl AxAIClient for FakeService {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        let content = self
            .responses
            .pop_front()
            .ok_or_else(|| axllm::AxError::runtime("fake service exhausted"))?;
        Ok(json!({"results": [{"content": content["content"], "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let mut service = FakeService {
        responses: VecDeque::from(vec![json!({"content": "{\"answer\":\"Paris\"}"})]),
    };
    let mut qa = agent("question:string -> answer:string")?;
    let output = qa.forward(&mut service, json!({"question": "Capital of France?"}))?;
    assert_eq!(output["answer"], "Paris");
    println!("rust-axagent-ok");
    Ok(())
}
