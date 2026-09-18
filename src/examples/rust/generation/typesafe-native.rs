// ax-example:start
// title: Rust Jev Native Questions
// group: generation
// description: Uses structured criteria, native scoring, model discovery, and probability-based decisions.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: advanced
// order: 36
// ax-example:end
use axllm::{typesafe, AxResult, TypesafeAnswer, TypesafeQuestion, TypesafeRequest};
use serde_json::json;
use std::{collections::BTreeMap, env};

fn main() -> AxResult<()> {
    let mut client =
        typesafe(json!({"api_key":env::var("TYPESAFE_APIKEY").expect("Set TYPESAFE_APIKEY")}))?;
    assert!(!client.list_models()?.is_empty());
    let request = TypesafeRequest {
        state: json!({
            "ticket": "Checkout is unavailable for all customers after the latest deployment.",
            "account": {"tier": "enterprise", "notes": null}
        }),
        model: None,
        questions: BTreeMap::from([
            (
                "urgent".into(),
                TypesafeQuestion::Noul {
                    instructions: Some(json!({"question": "Does this need immediate attention?"})),
                    criteria: Some(serde_json::Map::from_iter([
                        (
                            "true".into(),
                            json!("Customers cannot complete a core task"),
                        ),
                        ("false".into(), json!("Routine request")),
                    ])),
                },
            ),
            (
                "team".into(),
                TypesafeQuestion::Choice {
                    instructions: Some(json!("Who should handle the ticket?")),
                    criteria: serde_json::Map::from_iter([
                        ("support".into(), json!("Usage guidance")),
                        ("billing".into(), json!({"scope": "Invoices and payments"})),
                        ("engineering".into(), json!("Product failures")),
                    ]),
                },
            ),
            (
                "severity".into(),
                TypesafeQuestion::Score {
                    instructions: Some(json!("Rate customer impact")),
                    criteria: vec![
                        json!("Minor inconvenience"),
                        json!("One task blocked"),
                        json!("Core task unavailable"),
                        json!("Widespread outage"),
                    ],
                },
            ),
        ]),
    };
    let response = client.system_one(request)?;
    let probability = match response.answers["urgent"] {
        TypesafeAnswer::Noul { noul } => noul,
        _ => panic!("Expected Noul"),
    };
    let score = match response.answers["severity"] {
        TypesafeAnswer::Score { score, .. } => score,
        _ => panic!("Expected Score"),
    };
    assert!((0.0..=1.0).contains(&probability) && (0.0..=3.0).contains(&score));
    // Apply thresholds and custom score scales in application code.
    let output = json!({"page_on_call":probability>=0.9,"severity_1_to_5":1.0+4.0*score/3.0,"response":response});
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
