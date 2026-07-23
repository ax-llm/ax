// ax-example:start
// title: Centralized Usage Observer
// group: generation
// description: Attributes every completed model call to a tenant, user, and request from one global observer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
use axllm::{
    set_usage_observer, AxAIClient, AxError, AxResult, AxUsageEvent, OpenAICompatibleClient,
};
use serde_json::json;
use std::env;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    let events = Arc::new(Mutex::new(Vec::<AxUsageEvent>::new()));
    let captured = Arc::clone(&events);
    set_usage_observer(Some(Arc::new(move |event| {
        captured.lock().unwrap().push(event);
    })));

    let mut client = OpenAICompatibleClient::new(api_key, model).with_options(json!({
        "usageContext": {
            "tenantId": "tenant-42",
            "feature": "support-chat",
            "attributes": {"environment": "example"}
        }
    }));
    let request_id = format!(
        "request-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| AxError::runtime(error.to_string()))?
            .as_nanos()
    );
    client.chat_with_options(
        json!({
            "chat_prompt": [
                {"role": "user", "content": "Reply with one short greeting."}
            ]
        }),
        json!({
            "usageContext": {"userId": "user-7", "requestId": request_id}
        }),
    )?;
    set_usage_observer(None);
    println!("{}", serde_json::to_string_pretty(&*events.lock().unwrap())?);
    Ok(())
}
