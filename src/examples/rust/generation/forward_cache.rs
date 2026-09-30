// ax-example:start
// title: Rust Forward Cache
// group: generation
// description: Reuses a typed generation result through a caching callback on forward options.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 49
// ax-example:end
use axllm::{ai, ax, AxCachingFunction, AxForwardOptions, AxResult};
use serde_json::{json, Value};
use std::{collections::HashMap, env, sync::{Arc, Mutex}};

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).expect("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-6-luna".into());
    let mut client = ai("openai", json!({"api_key":key,"model":model}))?;
    let values = Arc::new(Mutex::new(HashMap::<String, Value>::new()));
    let cache: AxCachingFunction = Arc::new(move |key, output| {
        let mut values = values.lock().unwrap();
        if let Some(output) = output { values.insert(key.to_owned(), output.clone()); return Ok(None); }
        Ok(values.get(key).cloned())
    });
    let options = AxForwardOptions::from(json!({})).with_caching_function(cache);
    let mut program = ax("question:string -> answer:string")?;
    let input = json!({"question":"What is the capital of France? Answer with just its name."});
    let first = program.forward_with_options(&mut client, input.clone(), options.clone())?;
    let cached = program.forward_with_options(&mut client, input, options)?;
    assert_eq!(first, cached);
    println!("{}", cached["answer"].as_str().unwrap_or_default());
    Ok(())
}
