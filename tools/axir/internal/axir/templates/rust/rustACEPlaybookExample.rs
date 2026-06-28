use axllm::{ax, playbook, AxAIClient, AxResult};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

// A scripted client stands in for a real provider so this example runs without a
// key. Swap it for a real client (e.g. OpenAICompatibleClient) to grow a playbook
// against a live model. The canned JSON satisfies the bound program AND the
// playbook's internal reflector/curator sub-programs, so the full ACE loop is
// exercised offline.
struct ScriptedClient;

impl AxAIClient for ScriptedClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        let content = json!({
            "answer": "Ax composes typed LLM programs.",
            "reasoning": "The playbook lacked a brevity rule.",
            "errorIdentification": "Answer was too verbose.",
            "rootCauseAnalysis": "No guidance on conciseness.",
            "correctApproach": "Add a concise-answer guideline.",
            "keyInsight": "Prefer one-sentence answers.",
            "bulletTags": [],
            "operations": [
                {"type": "ADD", "section": "Guidelines", "content": "Answer in one concise sentence."}
            ]
        })
        .to_string();
        Ok(json!({"results": [{"content": content}]}))
    }
}

fn main() -> AxResult<()> {
    let mut program = ax("question:string -> answer:string")?;
    program.set_instruction("Answer the question.");

    let student = Rc::new(RefCell::new(ScriptedClient));
    let mut pb = playbook(
        program,
        student,
        None::<Rc<RefCell<ScriptedClient>>>,
        json!({"maxEpochs": 1}),
    );

    let mut metric = |args: &Value| -> Value {
        let answer = args
            .get("prediction")
            .and_then(|p| p.get("answer"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if answer.is_empty() { json!(0.0) } else { json!(1.0) }
    };

    let examples = vec![
        json!({"question": "What is Ax?"}),
        json!({"question": "Why typed signatures?"}),
    ];
    let result = pb.evolve(&examples, &mut metric, &json!({}))?;
    let rendered = pb.render();
    let state = pb.to_json();
    assert!(result.get("bestScore").is_some(), "missing bestScore: {result}");
    assert!(state.get("playbook").is_some(), "missing playbook: {state}");
    assert!(state.get("artifact").is_some(), "missing artifact: {state}");
    println!("rendered: {rendered}");
    println!("rust-ace-playbook-ok");
    Ok(())
}
