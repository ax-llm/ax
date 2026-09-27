use axllm::{ax, tool, AxAIClient, AxResult, FieldType};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

struct ScriptedClient {
    calls: usize,
}

impl AxAIClient for ScriptedClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        self.calls += 1;
        if self.calls == 1 {
            return Ok(
                json!({"results": [{"content": "", "function_calls": [{"id": "call_1", "name": "search", "params": {"query": "ax docs"}}]}]}),
            );
        }
        Ok(json!({"results": [{"content": "Answer: Found Ax docs", "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let searches = Arc::new(Mutex::new(Vec::new()));
    let seen = searches.clone();
    let search = tool("search")
        .description("Search docs")
        .arg("query", FieldType::string())
        .handler(move |args| {
            seen.lock().unwrap().push(args);
            Ok(json!({"title": "Ax docs"}))
        });
    let mut program = ax("query:string -> answer:string")?.with_tool(search);
    let out = program.forward(
        &mut ScriptedClient { calls: 0 },
        json!({"query": "ax docs"}),
    )?;
    assert_eq!(out["answer"], "Found Ax docs");
    // The tool ran once, with the model's arguments.
    assert_eq!(*searches.lock().unwrap(), vec![json!({"query": "ax docs"})]);
    println!("rust-axgen-ok");
    Ok(())
}
