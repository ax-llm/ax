use axllm::{get_supported_ai_models, get_supported_ai_models_with_options, AxResult};
use serde_json::{json, Value};

fn provider<'a>(catalog: &'a [Value], name: &str) -> &'a Value {
    catalog
        .iter()
        .find(|entry| entry["name"] == name)
        .unwrap_or_else(|| panic!("missing provider {name}"))
}

fn main() -> AxResult<()> {
    let catalog = get_supported_ai_models()?;
    let azure = provider(&catalog, "azure-openai");
    let openrouter = provider(&catalog, "openrouter");

    assert_eq!(azure["isDynamic"], true);
    assert_eq!(azure["models"], json!([]));
    assert!(azure["capabilities"]["thinkingLevels"]
        .as_array()
        .is_some_and(|levels| levels.iter().any(|level| level == "high")));
    assert!(azure["capabilities"]["serviceTiers"]
        .as_array()
        .is_some_and(|tiers| tiers.iter().any(|tier| tier == "priority")));
    assert!(openrouter["capabilities"]["serviceTiers"]
        .as_array()
        .is_some_and(|tiers| tiers.iter().any(|tier| tier == "flex")));

    let text = get_supported_ai_models_with_options(json!({"type": "text"}))?;
    provider(&text, "azure-openai");
    println!("rust-model-catalog-ok");
    Ok(())
}
