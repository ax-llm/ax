use std::sync::Arc;

use axllm::{
    AxBalancerAdaptiveStrategy, AxBalancerStatsKey, AxBalancerStatsObservation,
    AxBalancerStatsStore, AxInMemoryBalancerStatsStore,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let store = Arc::new(AxInMemoryBalancerStatsStore::new());
    let key = AxBalancerStatsKey {
        namespace: "checkout".into(),
        slice: "interactive".into(),
        logical_model: "fast-chat".into(),
        route_key: "openai-us".into(),
    };
    store.observe(
        &key,
        &AxBalancerStatsObservation {
            outcome: "success".into(),
            latency_ms: Some(180.0),
        },
    )?;

    let strategy = AxBalancerAdaptiveStrategy::new(800.0, 0.05)
        .with_namespace("checkout")
        .with_store(store.clone())
        .with_route_key(Arc::new(|service, _index| service.get_id()));
    println!(
        "{} {}",
        strategy.namespace,
        store.get(&key)?.unwrap().successes
    );
    Ok(())
}
