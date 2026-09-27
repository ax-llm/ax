// ax-example:start
// title: Rust MCP Resource Wake
// group: mcp
// description: Subscribes over real Streamable HTTP and lets AxEventRuntime wake an authenticated Agent automatically.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: intermediate
// order: 20
// story: 61
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{
    agent_with_options, AxEventRoute, AxEventRuntime, AxEventTarget, AxMCPClient, AxMCPEventSource,
    AxMCPResourceSubscriptionPolicy, AxMCPStreamableHTTPTransport, AxResult,
};
use serde_json::{json, Value};
use std::{
    env,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY."))?;
    let endpoint = env::var("AX_MCP_ENDPOINT").map_err(|_| {
        axllm::AxError::runtime("Set AX_MCP_ENDPOINT to a Streamable HTTP MCP server.")
    })?;
    let local = endpoint.starts_with("http://127.0.0.1");
    let transport = AxMCPStreamableHTTPTransport::new(
        endpoint.clone(),
        json!({"ssrfProtection":{"requireHttps":!local,"allowLocalhost":local,"allowPrivateNetworks":local}}),
    )?;
    let client = Arc::new(Mutex::new(AxMCPClient::new(
        Box::new(transport),
        json!({"namespace":"inventory"}),
    )));
    let mut llm = axllm::ai("openai", json!({"api_key": key, "model": "gpt-5.4-mini"}))?;
    let mut agent = agent_with_options(
        "uri:string -> summary:string",
        json!({"runtime":{"language":"JavaScript"}}),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;
    let completed = Arc::new((Mutex::new(false), Condvar::new()));
    let completed_target = completed.clone();
    let mut target = AxEventTarget::new("inventory-agent", move |input, _| {
        let output = agent.forward(&mut llm, input)?;
        println!("{output}");
        let (lock, changed) = &*completed_target;
        *lock.lock().unwrap() = true;
        changed.notify_all();
        Ok(output)
    });
    target.retry_safety = "idempotent".into();
    target.map_input = Some(Arc::new(|event, _| Ok(json!({"uri":event.data["uri"]}))));
    let mut runtime = AxEventRuntime::new(
        vec![AxEventRoute {
            id: "resource-wake".into(),
            action: "wake".into(),
            r#match: json!({"types":["mcp.resource.updated"]}),
            target_id: Some("inventory-agent".into()),
            require_authenticated: true,
            ordering: "strict".into(),
            debounce_ms: 0,
            instance_key: None,
        }],
        json!({}),
    )?;
    runtime.register_target(target);
    runtime.start()?;
    let runtime = Arc::new(Mutex::new(runtime));
    let mut source = AxMCPEventSource::with_policy(
        client.clone(),
        runtime.clone(),
        "inventory",
        "tenant:demo",
        "authenticated",
        AxMCPResourceSubscriptionPolicy::All,
    );
    source.start()?;
    if env::var("AX_MCP_DEMO_AUTO").as_deref() == Ok("1") {
        update_demo_resource(&endpoint)?;
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        source.poll();
        if *completed.0.lock().unwrap() {
            break;
        }
        if Instant::now() >= deadline {
            return Err(axllm::AxError::runtime(
                "Timed out waiting for an MCP resource notification",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    source.close()?;
    client.lock().unwrap().close()?;
    runtime.lock().unwrap().close()?;
    Ok(())
}

// AX_MCP_DEMO_AUTO=1: the repo's demo server (plain HTTP on 127.0.0.1)
// updates the resource on request.
fn update_demo_resource(endpoint: &str) -> AxResult<()> {
    use std::io::{Read, Write};
    let authority = endpoint
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or_default();
    let failed = |error: std::io::Error| axllm::AxError::runtime(error.to_string());
    let mut stream = std::net::TcpStream::connect(authority).map_err(failed)?;
    write!(
        stream,
        "POST /control/resource HTTP/1.1\r\nHost: {authority}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .map_err(failed)?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(failed)?;
    Ok(())
}
