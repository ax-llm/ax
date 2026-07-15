use axllm::{
    AxEventEnvelope, AxEventRoute, AxEventRuntime, AxEventTarget, AxMCPClient, AxMCPEventSource,
    AxMCPResourceSubscriptionPolicy, AxMCPStreamableHTTPTransport, AxResult,
};
use serde_json::{json, Map, Value};
use std::env;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
struct State {
    resource: usize,
    task: usize,
    progress: usize,
}

fn main() -> AxResult<()> {
    let endpoint = env::var("AX_MCP_ENDPOINT").expect("AX_MCP_ENDPOINT is required");
    let transport = AxMCPStreamableHTTPTransport::new(
        endpoint,
        json!({
            "ssrfProtection": {"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true},
            "reconnectDelayMs": 50,
            "listenTimeoutMs": 1000
        }),
    )?;
    let client = Arc::new(Mutex::new(AxMCPClient::new(
        Box::new(transport),
        json!({"namespace": "inventory"}),
    )));
    let state = Arc::new((Mutex::new(State::default()), Condvar::new()));
    let progress_state = state.clone();
    client
        .lock()
        .unwrap()
        .add_notification_listener(move |message| {
            if message.get("method").and_then(Value::as_str) == Some("notifications/progress") {
                let (lock, changed) = &*progress_state;
                lock.lock().unwrap().progress += 1;
                changed.notify_all();
            }
        });
    client.lock().unwrap().init()?;
    let catalog = client.lock().unwrap().inspect_catalog(false)?;
    if catalog.resources.len() != 2 || catalog.resource_templates.len() != 1 {
        panic!("MCP catalog discovery failed");
    }
    let task = client
        .lock()
        .unwrap()
        .call_tool("start_reindex", json!({"scope": "all"}))?;
    let task_id = task["task"]["taskId"].as_str().unwrap().to_string();

    let resource_state = state.clone();
    let resource_target = AxEventTarget::new("resource-target", move |input, _| {
        let (lock, changed) = &*resource_state;
        lock.lock().unwrap().resource += 1;
        changed.notify_all();
        Ok(input)
    })
    .retry_safety("idempotent");
    let task_state = state.clone();
    let mut task_target = AxEventTarget::new("task-target", move |input, _| {
        let (lock, changed) = &*task_state;
        lock.lock().unwrap().task += 1;
        changed.notify_all();
        Ok(input)
    })
    .map_input(|event, continuation| {
        Ok(json!({"taskId": continuation
            .map(|value| value.metadata["taskId"].clone())
            .unwrap_or_else(|| event.data["taskId"].clone())}))
    })
    .retry_safety("idempotent");
    task_target.wait_for = vec![json!({
        "kind": "mcp.task",
        "value": "taskKey",
        "metadata": {"taskId": task_id}
    })];
    let routes = vec![
        AxEventRoute {
            id: "resource-wake".into(),
            action: "wake".into(),
            r#match: json!({"types":["mcp.resource.updated"]}),
            target_id: Some("resource-target".into()),
            require_authenticated: true,
            ordering: "strict".into(),
            debounce_ms: 0,
            instance_key: None,
        },
        AxEventRoute {
            id: "task-start".into(),
            action: "wake".into(),
            r#match: json!({"types":["app.task.started"]}),
            target_id: Some("task-target".into()),
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
            target_id: Some("task-target".into()),
            require_authenticated: false,
            ordering: "strict".into(),
            debounce_ms: 0,
            instance_key: None,
        },
    ];
    let mut runtime_value = AxEventRuntime::new(routes, json!({}))?;
    runtime_value.register_target(resource_target);
    runtime_value.register_target(task_target);
    runtime_value.start()?;
    let runtime = Arc::new(Mutex::new(runtime_value));
    let mut source = AxMCPEventSource::with_policy(
        client.clone(),
        runtime.clone(),
        "inventory",
        "tenant:smoke",
        "authenticated",
        AxMCPResourceSubscriptionPolicy::All,
    );
    source.start()?;
    runtime.lock().unwrap().publish(
        AxEventEnvelope {
            specversion: "1.0".into(),
            id: "task-start".into(),
            source: "app://smoke".into(),
            r#type: "app.task.started".into(),
            subject: None,
            data: json!({"taskId": task_id, "taskKey": format!("inventory:{task_id}")}),
            extensions: Map::new(),
            correlation: vec![],
        },
        "tenant:smoke",
        "authenticated",
    )?;
    println!("AX_MCP_SMOKE_READY");

    let deadline = Instant::now() + Duration::from_secs(20);
    let result = loop {
        source.poll();
        let current = state.0.lock().unwrap();
        if current.resource >= 1 && current.task >= 2 && current.progress >= 1 {
            break format!(
                "AX_MCP_SMOKE_OK resource={} task={} progress={}",
                current.resource, current.task, current.progress
            );
        }
        drop(current);
        if Instant::now() >= deadline {
            panic!("MCP event smoke timed out");
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    source.close()?;
    client.lock().unwrap().close()?;
    runtime.lock().unwrap().close()?;
    println!("{result}");
    Ok(())
}
