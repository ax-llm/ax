use axllm::{ax, flow, AxAIClient, AxResult};
use serde_json::{json, Value};

struct FakeClient;

impl AxAIClient for FakeClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        Ok(json!({"results": [{"content": "{\"answer\":\"Paris\"}", "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let qa = ax("question:string -> answer:string")?;
    let mut program = flow("example.flow")
        .execute("qa", qa)
        .returns(json!({"answer": "answer"}));
    let output = program.forward(&mut FakeClient, json!({"question": "Capital of France?"}))?;
    assert_eq!(output["answer"], "Paris");
    println!("rust-axflow-ok");
    Ok(())
}
