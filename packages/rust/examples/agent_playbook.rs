use axllm::{
    agent_with_options, AxAIClient, AxCodeRuntime, AxCodeSession, AxResult, RuntimeEnvelope,
};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

// The actor returns model-authored Python code and a real runtime executes it.
// The same offline response also satisfies the playbook reflector and curator.
struct ScriptedClient;

impl AxAIClient for ScriptedClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        let content = json!({
            "pythonCode": "final('Answer', {'answer': 'Ax composes typed LLM programs.'})",
            "answer": "Ax composes typed LLM programs.",
            "reasoning": "The playbook lacked a brevity rule.",
            "errorIdentification": "Answer was too verbose.",
            "rootCauseAnalysis": "No guidance on conciseness.",
            "correctApproach": "Add a concise-answer guideline.",
            "keyInsight": "Prefer one-sentence answers.",
            "weaknessDescription": "The agent does not verify its final step.",
            "rootCause": "The final step is accepted without a check.",
            "proposedGuidance": "Verify the final step before completing the task.",
            "evidenceQuotes": ["final", "snapshot", "Answer"],
            "configRecommendations": [],
            "bulletTags": [],
            "operations": [
                {"type": "ADD", "section": "Guidelines", "content": "Answer in one concise sentence."}
            ]
        })
        .to_string();
        Ok(json!({"results": [{"content": content}]}))
    }
}

struct RuntimeSession;

impl AxCodeSession for RuntimeSession {
    fn execute(&mut self, code: &str, _options: Value) -> AxResult<RuntimeEnvelope> {
        assert!(
            !code.contains("pythonCode"),
            "runtime received a response wrapper instead of code"
        );
        Ok(RuntimeEnvelope::final_payload(
            json!({"answer": "Ax composes typed LLM programs."}),
        ))
    }

    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        Ok(json!({"version": 1, "bindings": {}, "globals": {}, "closed": false}))
    }

    fn patch_globals(&mut self, snapshot: Value, _options: Value) -> AxResult<Value> {
        Ok(snapshot)
    }
}

struct Runtime;

impl AxCodeRuntime for Runtime {
    fn language(&self) -> &str {
        "Python"
    }

    fn create_session(
        &mut self,
        _globals: Value,
        _options: Value,
    ) -> AxResult<Box<dyn AxCodeSession>> {
        Ok(Box::new(RuntimeSession))
    }
}

fn main() -> AxResult<()> {
    // agent.playbook() binds an evolving context playbook to an agent stage. The
    // "responder" target grows the user-facing answer stage; ACE remains an
    // implementation detail behind playbook(), just as optimize() hides GEPA.
    let mut agent = agent_with_options(
        "question:string -> answer:string",
        json!({"name": "qa", "description": "Answer the question.", "runtime": {"language": "Python"}}),
    )?
    .with_runtime(Box::new(Runtime))?;

    let student = Rc::new(RefCell::new(ScriptedClient));
    let mut pb = agent.playbook(
        student,
        None::<Rc<RefCell<ScriptedClient>>>,
        json!({"target": "responder", "maxEpochs": 1}),
    )?;

    let dataset = json!({"train": [{"input": {"question": "Answer briefly."}, "score": 0}]});
    let mut eval_client = ScriptedClient;

    // A zero minimum gain exercises verified acceptance. A positive minimum gain
    // rejects the same flat score and must restore the exact pre-proposal snapshot.
    let accepted = pb.evolve_agent(
        &mut agent,
        &mut eval_client,
        &dataset,
        &json!({"verify": true, "minHeldInGain": 0, "maxProposals": 1, "maxMetricCalls": 2}),
    )?;
    let before_rejection = serde_json::to_string(&pb.to_json())?;
    let rejected = pb.evolve_agent(
        &mut agent,
        &mut eval_client,
        &dataset,
        &json!({"verify": true, "minHeldInGain": 0.1, "maxProposals": 1, "maxMetricCalls": 2}),
    )?;
    let after_rejection = serde_json::to_string(&pb.to_json())?;

    assert_eq!(
        accepted["metricCallsUsed"].as_u64(),
        Some(2),
        "bad metric budget: {accepted}"
    );
    assert_eq!(
        accepted["outcomes"][0]["accepted"].as_bool(),
        Some(true),
        "verified acceptance failed: {accepted}"
    );
    assert_eq!(
        rejected["metricCallsUsed"].as_u64(),
        Some(2),
        "bad metric budget: {rejected}"
    );
    assert_eq!(
        rejected["outcomes"][0]["accepted"].as_bool(),
        Some(false),
        "verified rejection failed: {rejected}"
    );
    assert_eq!(
        after_rejection, before_rejection,
        "rejected proposal was not rolled back exactly"
    );
    assert!(
        pb.to_json().get("playbook").is_some(),
        "missing playbook: {}",
        pb.to_json()
    );
    println!("accepted: {}", accepted["outcomes"][0]);
    println!("rejected: {}", rejected["outcomes"][0]);
    println!("rust-agent-playbook-ok");
    Ok(())
}
