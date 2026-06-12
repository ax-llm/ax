use axllm::{agent, AxCodeRuntime, AxCodeSession, AxResult, RuntimeEnvelope};
use serde_json::{json, Value};

struct DemoSession {
    globals: Value,
    closed: bool,
}

impl AxCodeSession for DemoSession {
    fn execute(&mut self, code: &str, _options: Value) -> AxResult<RuntimeEnvelope> {
        if code == "timeout()" {
            return Ok(RuntimeEnvelope::timeout("demo timeout"));
        }
        self.globals["answer"] = json!("runtime final");
        Ok(RuntimeEnvelope::final_payload(json!({"answer": self.globals["answer"]})))
    }

    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        Ok(json!({"version": 1, "bindings": self.globals, "closed": self.closed}))
    }

    fn patch_globals(&mut self, snapshot: Value, _options: Value) -> AxResult<Value> {
        self.globals = snapshot.get("bindings").cloned().unwrap_or_else(|| json!({}));
        self.snapshot_globals(json!({}))
    }

    fn close(&mut self) -> AxResult<Value> {
        self.closed = true;
        Ok(json!({"closed": true}))
    }
}

struct DemoRuntime;

impl AxCodeRuntime for DemoRuntime {
    fn language(&self) -> &str {
        "Rust"
    }

    fn create_session(&mut self, globals: Value, _options: Value) -> AxResult<Box<dyn AxCodeSession>> {
        Ok(Box::new(DemoSession { globals, closed: false }))
    }
}

fn main() -> AxResult<()> {
    let mut runtime = DemoRuntime;
    let mut runner = agent("question:string -> answer:string")?;
    let step = runner.execute_actor_step(&mut runtime, "final()", json!({"question": "adapter"}), json!({}))?;
    let snapshot = runner.export_session_state()?;
    let timeout = runner.execute_actor_step(&mut runtime, "timeout()", json!({"question": "adapter"}), json!({}))?;
    let closed = runner.close_runtime_session()?;
    println!("{}", serde_json::to_string_pretty(&json!({
        "stepKind": step.payload["kind"],
        "snapshotAnswer": snapshot["bindings"]["answer"],
        "timeoutCategory": timeout.payload["error_category"],
        "closed": closed
    }))?);
    Ok(())
}
