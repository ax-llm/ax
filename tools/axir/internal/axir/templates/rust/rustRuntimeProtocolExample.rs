use axllm::{agent, AxResult, ProcessCodeRuntime};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let repo_root = env::var("AXIR_REPO_ROOT").map_err(|_| axllm::AxError::runtime("AXIR_REPO_ROOT is required"))?;
    let server = env::var("AXIR_AXJS_RUNTIME_SERVER").map_err(|_| axllm::AxError::runtime("AXIR_AXJS_RUNTIME_SERVER is required"))?;
    let mut runtime = ProcessCodeRuntime::new(["node".to_string(), "--import=tsx".to_string(), server]);
    env::set_current_dir(repo_root).map_err(axllm::AxError::from)?;
    let mut runner = agent("question:string -> answer:string")?;
    let step = runner.execute_actor_step(
        &mut runtime,
        "answer = inputs.question; await final({ answer })",
        json!({"question": "protocol"}),
        json!({}),
    )?;
    assert_eq!(step.payload["kind"], "final");
    runtime.shutdown()?;
    println!("rust-runtime-protocol-ok");
    Ok(())
}
