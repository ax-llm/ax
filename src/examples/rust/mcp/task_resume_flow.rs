// ax-example:start
// title: Rust MCP Task Continuation
// group: mcp
// description: Creates an owned continuation and resumes an AxFlow from real MCP progress and terminal task notifications.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: advanced
// order: 30
// story: 62
// ax-example:end
use axllm::{
    ax, AxEventEnvelope, AxEventRoute, AxEventRuntime, AxEventTarget, AxMCPClient,
    AxMCPEventSource, AxMCPStreamableHTTPTransport, AxResult, OpenAICompatibleClient,
};
use serde_json::{json, Map};
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
        endpoint,
        json!({"ssrfProtection":{"requireHttps":!local,"allowLocalhost":local,"allowPrivateNetworks":local}}),
    )?;
    let client = Arc::new(Mutex::new(AxMCPClient::new(
        Box::new(transport),
        json!({"namespace":"inventory"}),
    )));
    client.lock().unwrap().init()?;
    let task = client
        .lock()
        .unwrap()
        .call_tool("start_reindex", json!({"scope":"all"}))?;
    let task_id = task["task"]["taskId"].as_str().unwrap().to_string();
    let mut llm = OpenAICompatibleClient::new(key, "gpt-5.4-mini");
    let mut flow = axllm::flow("reindex-flow")
        .execute("status", ax("taskId:string -> status:string")?)
        .returns(json!({"status":"status"}));
    let completed = Arc::new((Mutex::new(0usize), Condvar::new()));
    let completed_target = completed.clone();
    let mut target = AxEventTarget::new("reindex-flow", move |input, _| {
        let output = flow.forward(&mut llm, input)?;
        println!("{output}");
        let (lock, changed) = &*completed_target;
        *lock.lock().unwrap() += 1;
        changed.notify_all();
        Ok(output)
    });
    target.retry_safety = "idempotent".into();
    target.wait_for =
        vec![json!({"kind":"mcp.task","value":"taskKey","metadata":{"taskId":task_id}})];
    target.map_input = Some(Arc::new(|event, continuation| {
        Ok(
            json!({"taskId":continuation.map(|value|value.metadata["taskId"].clone()).unwrap_or_else(||event.data["taskId"].clone())}),
        )
    }));
    let routes = vec![
        AxEventRoute {
            id: "task-start".into(),
            action: "wake".into(),
            r#match: json!({"types":["app.task.started"]}),
            target_id: Some("reindex-flow".into()),
            require_authenticated: false,
            ordering: "strict".into(),
            debounce_ms: 0,
            instance_key: None,
        },
        AxEventRoute {
            id: "task-progress".into(),
            action: "observe".into(),
            r#match: json!({"types":["mcp.progress"]}),
            target_id: None,
            require_authenticated: false,
            ordering: "strict".into(),
            debounce_ms: 0,
            instance_key: None,
        },
        AxEventRoute {
            id: "task-resume".into(),
            action: "resume".into(),
            r#match: json!({"types":["mcp.task.status"]}),
            target_id: Some("reindex-flow".into()),
            require_authenticated: false,
            ordering: "strict".into(),
            debounce_ms: 0,
            instance_key: None,
        },
    ];
    let mut runtime_value = AxEventRuntime::new(routes, json!({}))?;
    runtime_value.register_target(target);
    runtime_value.start()?;
    runtime_value.publish(
        AxEventEnvelope {
            specversion: "1.0".into(),
            id: "task-start".into(),
            source: "app://tasks".into(),
            r#type: "app.task.started".into(),
            subject: Some(task_id.clone()),
            data: json!({"taskId":task_id,"taskKey":format!("inventory:{task_id}")}),
            extensions: Map::new(),
            correlation: vec![],
        },
        "tenant:demo",
        "authenticated",
    )?;
    let runtime = Arc::new(Mutex::new(runtime_value));
    let mut source = AxMCPEventSource::new(
        client.clone(),
        runtime.clone(),
        "inventory",
        "tenant:demo",
        "authenticated",
        vec![],
    );
    source.start()?;
    println!("Waiting for terminal MCP task notification {task_id}");
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        source.poll();
        if *completed.0.lock().unwrap() >= 2 {
            break;
        }
        if Instant::now() >= deadline {
            return Err(axllm::AxError::runtime(
                "Timed out waiting for the MCP task continuation",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    source.close()?;
    client.lock().unwrap().close()?;
    runtime.lock().unwrap().close()?;
    Ok(())
}
