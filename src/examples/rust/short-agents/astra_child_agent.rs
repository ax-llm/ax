// ax-example:start
// title: Rust Child Agent Controls
// group: short-agents
// description: Delegates through a real actor runtime and applies controls to the child scope.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, ai, run_control, AxForwardOptions, AxResult};
use serde_json::json;
use std::{
    env,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .expect("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    let mut client = ai(
        "openai",
        json!({"api_key":key,"model":"gpt-6-astra","model_config":{"thinkingTokenBudget":"low","max_tokens":4096}}),
    )?;
    let control = run_control();
    let applied = Arc::new(AtomicBool::new(false));
    let observed = applied.clone();
    control.on_event(move |event| {
        if event["type"] == "applied" && event["path"] == "root/team.researcher/executor" {
            observed.store(true, Ordering::SeqCst);
        }
    });
    control.steer("Include VERIFIED in the final answer.")?;
    control.steer_at(
        "Include CHILD-CHECK in the final answer.",
        "root/team.researcher",
    )?;
    control.set_thinking_token_budget_at("medium", "root/team.researcher/executor")?;
    let runtime =
        || Box::new(QuickJsCodeRuntime::new().with_runtime_policy(json!({"timeoutMs":180000})));
    let child = agent_with_options("question -> answer", json!({"directResponse":"off"}))?
        .with_runtime(runtime())?;
    let mut parent = agent_with_options("question -> answer", json!({"directResponse":"off"}))?
        .with_runtime(runtime())?
        .with_child_agent("team", "researcher", child)?;
    let result=parent.forward_with_options(&mut client,json!({"question":"Delegate to team.researcher exactly once by calling await team.researcher({question: \"Compute 37 + 5 and return the exact sum.\"}) in actor code. Pass the complete child answer as evidence to final(...), then report it in your final answer."}),AxForwardOptions::from(json!({"serviceTier":"standard","max_actor_steps":8})).with_control(control))?;
    for word in ["42", "VERIFIED", "CHILD-CHECK"] {
        assert!(result.to_string().contains(word), "{result}");
    }
    assert!(
        applied.load(Ordering::SeqCst),
        "Child control did not apply"
    );
    println!("{}", json!({"result":result,"usage":parent.get_usage()}));
    Ok(())
}
