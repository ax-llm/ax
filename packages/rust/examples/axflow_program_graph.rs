use axllm::{ax, flow, AxAIClient, AxResult};
use serde_json::{json, Value};

struct ScriptedClient;

impl AxAIClient for ScriptedClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        Ok(json!({"results": [{"content": "{\"answer\":\"Paris\"}", "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let qa = ax("question:string -> answer:string")?;
    let mut program = flow("example.flow")
        .execute("qa", qa)
        .returns(json!({"answer": "answer"}));
    let output = program.forward(
        &mut ScriptedClient,
        json!({"question": "Capital of France?"}),
    )?;
    assert_eq!(output["answer"], "Paris");
    println!("rust-axflow-ok");
    Ok(())
}
