use axllm::{AxResult, OptimizerEngine};
use serde_json::{json, Value};

struct ScriptedOptimizer;

impl OptimizerEngine for ScriptedOptimizer {
    fn optimize(&mut self, request: Value, evaluator: &mut dyn FnMut(Value) -> AxResult<Value>) -> AxResult<Value> {
        let score = evaluator(json!({"candidate": request["candidate"]}))?;
        Ok(json!({"artifact": {"version": 1, "score": score}}))
    }
}

fn main() -> AxResult<()> {
    let mut engine = ScriptedOptimizer;
    let result = engine.optimize(json!({"candidate": "short prompt"}), &mut |_candidate| Ok(json!({"score": 1.0})))?;
    assert_eq!(result["artifact"]["version"], 1);
    println!("rust-optimizer-artifact-ok");
    Ok(())
}
