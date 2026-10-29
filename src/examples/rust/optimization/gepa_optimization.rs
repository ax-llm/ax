// ax-example:start
// title: Rust GEPA Optimization
// group: optimization
// description: Scores real OpenAI predictions before and after GEPA instruction search.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
use axllm::{ax, AxResult, OpenAICompatibleClient, OptimizerEngine};
use serde_json::{json, Value};
use std::{cell::RefCell, env, rc::Rc};

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.6-luna".to_string());
    axllm::ai("openai", json!({"api_key": api_key, "model": model, "model_config": {"temperature": 0}}))
}
fn task(text: &str, priority: &str) -> Value {
    json!({"input": {"emailText": text}, "expectedOutput": {"priority": priority}})
}
fn main() -> AxResult<()> {
    let client = Rc::new(RefCell::new(openai_client()?));
    let mut program = ax("emailText:string -> priority:class \"high, normal, low\", rationale:string")?;
    let baseline = program.forward(&mut *client.borrow_mut(), json!({"emailText": "Production checkout is failing for enterprise customers."}))?;
    let request = json!({
        "programKind": "axgen", "components": program.get_optimizable_components(),
        "dataset": {"train": [task("URGENT: checkout is down", "high"), task("Weekly product newsletter", "low")],
            "validation": [task("Production payments are failing", "high"), task("Optional community meetup invite", "low")]},
        "options": {"numTrials": 1, "minibatchSize": 2, "maxMetricCalls": 12, "bootstrap": false, "seed": 7},
    });
    let mut engine = axllm::AxGEPA::new().with_reflection_client(client.clone());
    let artifact = engine.optimize(request, &mut |step| {
        let mut result = program.evaluate_optimization(&mut *client.borrow_mut(), &step["dataset"], &step["candidateMap"], &step["options"])?;
        let rows = result["rows"].as_array_mut().unwrap();
        let mut sum = 0.0;
        for row in rows.iter_mut() {
            let score = if row["prediction"]["output"]["priority"] == row["input"]["expectedOutput"]["priority"] { 1.0 } else { 0.0 };
            row["scores"] = json!({"accuracy": score});
            row["scalar"] = json!(score);
            sum += score;
        }
        let avg = sum / rows.len() as f64;
        result["avg"] = json!(avg);
        Ok(result)
    })?;
    let original = artifact["baselineScore"].as_f64().unwrap();
    let best = artifact["metadata"]["bestScore"].as_f64().unwrap();
    println!("{}", serde_json::to_string_pretty(&json!({"baselinePrediction": baseline, "baselineScore": original,
        "baselineScores": artifact["baselineScores"], "optimizedScore": best, "delta": best-original}))?);
    Ok(())
}
