use axllm::{AxGEPA, AxResult, OptimizerEngine};
use serde_json::{json, Value};

fn main() -> AxResult<()> {
    let request = json!({
        "candidate": {
            "qa::instruction": "Answer clearly and concisely."
        },
        "dataset": {
            "train": [{"question": "What is Ax?"}, {"question": "Why use typed signatures?"}],
            "validation": [{"question": "Summarize Ax."}]
        },
        "options": {"numTrials": 0, "maxMetricCalls": 8, "seed": 7}
    });

    let mut engine = AxGEPA::new();
    let artifact = engine.optimize(request, &mut |candidate: Value| {
        let instruction = candidate["candidate"]["qa::instruction"]
            .as_str()
            .unwrap_or_default();
        let quality = if instruction.to_lowercase().contains("concise") {
            0.9
        } else {
            0.65
        };
        let brevity = 0.8;
        Ok(json!({
            "rows": [{
                "prediction": {"answer": "Ax composes typed LLM programs."},
                "scores": {"quality": quality, "brevity": brevity},
                "scalar": (quality + brevity) / 2.0
            }],
            "avg": (quality + brevity) / 2.0,
            "count": 1
        }))
    })?;
    assert_eq!(artifact["artifact"]["kind"], "gepa");
    println!("{}", serde_json::to_string_pretty(&artifact)?);
    Ok(())
}
