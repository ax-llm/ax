// ax-example:start
// title: Rust Agent Background Tools
// group: short-agents
// description: Runs declared background agent tools with steering and verifies final result incorporation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 12
// ax-example:end
use axllm::{ai, agent_with_options, run_control, tool, AxForwardOptions, AxResult};
use serde_json::json;
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use std::{
    env,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .expect("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    let mut client = ai(
        "openai",
        json!({"api_key":key,"model":"gpt-6-astra","model_config":{"thinkingTokenBudget":"low","max_tokens":4096}}),
    )?;
    let pending = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let overlap = Arc::new(AtomicBool::new(false));
    let applied = Arc::new(AtomicUsize::new(0));
    let control = run_control();
    let steering = control.clone();
    let updates = applied.clone();
    control.on_event(move |event| {
        if event["type"] == "applied" {
            updates.fetch_add(1, Ordering::SeqCst);
        }
    });
    let started = pending.clone();
    let done = finished.clone();
    let steered = AtomicBool::new(false);
    let slow = tool("slow_reference")
        .description("Look up a reference; takes a few seconds.")
        .execution("background")
        .handler(move |_| {
            started.store(true, Ordering::SeqCst);
            if !steered.swap(true, Ordering::SeqCst) {
                steering.steer("Include the word VERIFIED in the final answer.")?;
                steering.set_thinking_token_budget("medium")?;
            }
            std::thread::sleep(Duration::from_secs(6));
            done.store(true, Ordering::SeqCst);
            Ok(json!("REF-42"))
        });
    let observed = overlap.clone();
    let label = tool("local_label")
        .description("Read an independent local label immediately.")
        .execution("background")
        .handler(move |_| {
            for _ in 0..300 {
                if pending.load(Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            observed.fetch_or(
                pending.load(Ordering::SeqCst) && !finished.load(Ordering::SeqCst),
                Ordering::SeqCst,
            );
            Ok(json!("LAUNCH"))
        });
    let mut program = agent_with_options("question -> answer", json!({"runtime":{"language":"JavaScript"},"directResponse":"off"}))?.with_tool_module("tools", vec![slow, label])?.with_runtime(Box::new(QuickJsCodeRuntime::new()))?;
    let result=program.forward_with_options(&mut client,json!({"question":"Use the native tools tools_slow_reference and tools_local_label. First call tools_slow_reference. While it is pending, call tools_local_label. Call each tool only once; do not call a tool again while its result is pending. In the executor, call the native tools directly rather than invoking them from actor code; then use final(...) in the code runtime to pass their results to the responder. Return both exact results in one sentence."}),AxForwardOptions::from(json!({"serviceTier":"standard","maxSteps":6,"max_actor_steps":12})).with_control(control))?;
    let answer = result.to_string();
    for word in ["REF-42", "LAUNCH", "VERIFIED"] {
        assert!(answer.contains(word), "Missing final result: {answer}");
    }
    assert!(
        overlap.load(Ordering::SeqCst),
        "No independent work while background tool was pending"
    );
    assert!(applied.load(Ordering::SeqCst) >= 2);
    println!("{answer}\nBackground overlap verified; steering and reasoning applied at the next response.");
    Ok(())
}
