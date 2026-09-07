// ax-example:start
// title: Rust Native Astra Steering
// group: generation
// description: Steers a running generation through the high-level controller using the optional WebSocket transport.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 14
// ax-example:end
use axllm::{ai, ax, run_control, AxForwardOptions, AxResult};
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
        .expect("Set OPENAI_API_KEY or OPENAI_APIKEY");
    // The example runner enables the optional `realtime` Cargo feature.
    let mut client=ai("openai",json!({"api_key":key,"model":"gpt-6-astra","model_config":{"thinkingTokenBudget":"low","max_tokens":4096}}))?.with_native_session_web_socket();
    let control = Arc::new(run_control());
    let steering = Arc::downgrade(&control);
    let sent = AtomicBool::new(false);
    let native = Arc::new(AtomicBool::new(false));
    let applied = native.clone();
    control.on_event(move |event| {
        if event["type"] == "model.output" && !sent.swap(true, Ordering::SeqCst) {
            steering
                .upgrade()
                .expect("active controller")
                .steer("Change the answer now. Your final answer must contain only VERIFIED.")
                .expect("queue steering");
        }
        if event["type"] == "applied" && event["timing"] == "native" {
            applied.store(true, Ordering::SeqCst);
        }
    });
    let mut program = ax("question -> answer")?;
    let result = program.forward_with_options(
        &mut client,
        json!({"question":"Write a detailed 1000-word explanation of how rain forms."}),
        AxForwardOptions::from(json!({"serviceTier":"standard","maxSteps":6}))
            .with_control(control.as_ref().clone()),
    )?;
    assert_eq!(result["answer"], "VERIFIED");
    assert!(
        native.load(Ordering::SeqCst),
        "Steering was not applied natively"
    );
    println!("{result}\nNative steering applied through the run controller.");
    Ok(())
}
