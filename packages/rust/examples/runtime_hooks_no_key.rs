use axllm::{
    agent_with_runtime_hooks, ax_with_runtime_hooks, flow_with_runtime_hooks, set_meter,
    set_rate_limiter, set_tracer, AxAIClient, AxRateLimiter, AxResult, AxRuntimeHooks,
    OpenAICompatibleClient, ScriptedTransport,
};
use serde_json::json;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn main() -> AxResult<()> {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&calls);
    let limiter: Arc<dyn AxRateLimiter> = Arc::new(
        move |next: &mut dyn FnMut() -> AxResult<serde_json::Value>,
              info: &axllm::AxRateLimitInfo| {
            assert_eq!(info.operation, "chat");
            assert!(!info.provider.is_empty());
            seen.fetch_add(1, Ordering::SeqCst);
            next()
        },
    );
    let transport = ScriptedTransport::new(vec![json!({"status": 200, "json": {
        "model": "gpt-5.4-mini", "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]
    }})]);
    let mut service = OpenAICompatibleClient::new("test", "gpt-5.4-mini").with_transport(transport);
    set_rate_limiter(Some(Arc::clone(&limiter)));
    service.chat(json!({"chat_prompt": [{"role": "user", "content": "hello"}]}))?;
    let hooks = AxRuntimeHooks {
        rate_limiter: Some(limiter),
        tracer: None,
        meter: None,
    };
    ax_with_runtime_hooks("input:string -> output:string", hooks.clone())?
        .set_tracer(None)
        .set_meter(None);
    agent_with_runtime_hooks("input:string -> output:string", json!({}), hooks.clone())?
        .set_tracer(None)
        .set_meter(None);
    flow_with_runtime_hooks("runtime-hooks", hooks)
        .set_tracer(None)
        .set_meter(None);
    set_rate_limiter(None);
    set_tracer(None);
    set_meter(None);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    println!("rust-runtime-hooks-no-key-ok");
    Ok(())
}
