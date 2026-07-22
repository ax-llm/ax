// ax-example:start
// title: Rust Adaptive Provider Balancing
// group: generation
// description: Routes equivalent chat traffic using shared reliability, latency, and cost statistics.
// provider: openai-compatible
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// story: 45
// ax-example:end
use std::{env, sync::{Arc, Mutex}};

use axllm::{
    AxAIClient, AxBalancer, AxBalancerAdaptiveStrategy, AxBalancerOptions,
    AxInMemoryBalancerStatsStore, AxResult, OpenAICompatibleClient,
};
use serde_json::json;

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".into());
    let clients: Vec<Box<dyn AxAIClient>> = vec![
        Box::new(OpenAICompatibleClient::new(&key, &model)),
        Box::new(OpenAICompatibleClient::new(&key, &model)),
    ];

    let store = Arc::new(AxInMemoryBalancerStatsStore::new());
    let route_keys = ["openai-primary".to_string(), "openai-backup".to_string()];
    let events = Arc::new(Mutex::new(Vec::new()));
    let event_sink = events.clone();
    let strategy = AxBalancerAdaptiveStrategy::new(6_000.0, 0.02)
        .with_expected_tokens(1_200, 300)
        .with_namespace("support-summary-v1")
        .with_store(store)
        .with_route_key(Arc::new(move |_service, index| route_keys[index].clone()))
        .with_slice(Arc::new(|context| if context["options"]["stream"] == true { "streaming".into() } else { "interactive".into() }))
        .on_routing_event(Arc::new(move |event| event_sink.lock().unwrap().push(event["type"].clone())));
    let mut balancer = AxBalancer::from_clients(clients, AxBalancerOptions { strategy: Some(strategy), ..AxBalancerOptions::default() })?;
    let response = balancer.chat(json!({"model": model, "chat_prompt": [{"role": "user", "content": "Summarize why shared routing state matters."}]}))?;
    println!("{}", serde_json::to_string_pretty(&response)?);
    println!("{:?}", events.lock().unwrap());
    Ok(())
}
