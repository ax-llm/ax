// ax-example:start
// title: Rust Automatic Background Tools
// group: generation
// description: Uses ordinary generation with background tools, steering, and a reasoning update.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 12
// ax-example:end
use axllm::{ai, ax, run_control, tool, AxForwardOptions, AxResult};
use serde_json::json;
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
    let mut program = ax("question -> answer")?.with_tool(slow).with_tool(label);
    let result=program.forward_with_options(&mut client,json!({"question":"First call slow_reference. While it is pending, call local_label. Call each tool only once; do not call a tool again while its result is pending. If a required tool result is still pending, end this response with a brief progress message. The application will continue with the result when it arrives; do not spend reasoning tokens waiting for it. Once both results arrive, return them in one sentence."}),AxForwardOptions::from(json!({"serviceTier":"standard","maxSteps":6})).with_control(control))?;
    let answer = result.to_string();
    for word in ["REF-42", "LAUNCH", "VERIFIED"] {
        assert!(answer.contains(word), "Missing final result: {answer}");
    }
    assert!(
        overlap.load(Ordering::SeqCst),
        "No independent work while background tool was pending"
    );
    assert_eq!(applied.load(Ordering::SeqCst), 2);
    println!("{answer}\nBackground overlap verified; steering and reasoning applied at the next response.");
    Ok(())
}
