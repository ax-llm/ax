// ax-example:start
// title: Rust Smart Defaults Agent
// group: long-agents
// description: Shows AxAgent smart defaults: oversized undeclared context stays out of the prompt while relevance hints and runtime tools guide the agent.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 60
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, AxResult, GoogleGeminiClient};
use serde_json::{json, Value};
use std::env;

fn gemini_client() -> AxResult<GoogleGeminiClient> {
    let api_key = env::var("GOOGLE_APIKEY")
        .map_err(|_| axllm::AxError::runtime("Set GOOGLE_APIKEY to run this example."))?;
    let model = env::var("AX_GEMINI_MODEL").unwrap_or_else(|_| "gemini-3.5-flash".to_string());
    Ok(GoogleGeminiClient::new(api_key, model).with_profile("google-gemini"))
}

const TIMELINE: [&str; 6] = [
    "09:12 checkout-edge v812 deployed behind 25% of traffic",
    "09:18 payments gateway p95 rose from 420ms to 4.8s",
    "09:22 cart completion dropped 31% for enterprise accounts",
    "09:27 retries saturated the checkout-edge connection pool",
    "09:31 rollback to v811 started",
    "09:36 p95 returned below 700ms after pool reset",
];

fn build_incident_log() -> String {
    let mut out = String::new();
    for i in 0..28 {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&format!("# log shard {}\n", i + 1));
        out.push_str(&TIMELINE.join("\n"));
    }
    out
}

fn opt_str(p: &Value, key: &str) -> String {
    p.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string()
}

fn main() -> AxResult<()> {
    let mut client = gemini_client()?;
    let mut runtime = QuickJsCodeRuntime::new();

    runtime.register_callable("summarizeIncident", move |p: Value| {
        let mut service = opt_str(&p, "service");
        if service.is_empty() {
            service = "checkout".to_string();
        }
        Ok(json!({
            "service": service,
            "severity": "sev-1",
            "rootCause": "checkout-edge v812 retried payment gateway calls without bounded concurrency, saturating the shared connection pool.",
            "errorRate": "38%",
            "affectedSessions": 1284,
            "candidateRunbook": "payments-timeout-runbook",
            "relevantMemory": "decision-enterprise-comms",
        }))
    })?;

    runtime.register_callable("getTimeline", move |p: Value| {
        let mut service = opt_str(&p, "service");
        if service.is_empty() {
            service = "checkout".to_string();
        }
        let out: Vec<Value> = TIMELINE
            .iter()
            .map(|event| json!({"service": service.clone(), "event": event}))
            .collect();
        Ok(Value::Array(out))
    })?;

    runtime.register_callable("getRunbook", move |p: Value| {
        let mut id = opt_str(&p, "id");
        if id.is_empty() {
            id = "payments-timeout-runbook".to_string();
        }
        Ok(json!({
            "id": id,
            "steps": [
                "Freeze checkout deploys and page the payments owner.",
                "Rollback checkout-edge to v811 and reset saturated pools.",
                "Post enterprise status update after error rate stays below 2%.",
            ],
        }))
    })?;

    let executor_description = [
        "Call the bare async runtime functions summarizeIncident, getTimeline, and getRunbook before answering.",
        "Use top-level await, for example: const s = await summarizeIncident({service:'checkout'});",
        "The large incidentLog input is intentionally not declared as a context field; smart defaults keep it available at runtime without flooding the prompt.",
        "Return the root cause, the first three remediation actions, and concrete evidence.",
    ]
    .join("\n");

    let mut analyst = agent_with_options(
        "incidentLog:string, question:string -> rootCause:string, actions:string[] \"Recommended remediation actions from the runbook\", evidence:string[]",
        json!({
            "name": "SmartDefaultsIncidentAgent",
            "description": "Investigate checkout incidents using runtime tools, relevance hints, and compact evidence.",
            // No contextFields and no autoUpgrade option: oversized incidentLog is promoted by default.
            "functions": [
                {
                    "name": "summarizeIncident",
                    "description": "Summarize the current checkout incident and name the strongest runbook and memory matches.",
                    "parameters": {
                        "type": "object",
                        "properties": {"service": {"type": "string"}},
                        "required": ["service"],
                    },
                },
                {
                    "name": "getTimeline",
                    "description": "Return concrete timestamped evidence for the checkout incident.",
                    "parameters": {
                        "type": "object",
                        "properties": {"service": {"type": "string"}},
                        "required": ["service"],
                    },
                },
                {
                    "name": "getRunbook",
                    "description": "Fetch the operational runbook steps for a relevant incident pattern.",
                    "parameters": {
                        "type": "object",
                        "properties": {"id": {"type": "string"}},
                        "required": ["id"],
                    },
                },
            ],
            "skillsCatalog": [
                {
                    "id": "payments-timeout-runbook",
                    "name": "Payments timeout runbook",
                    "content": "Use when checkout latency follows payment gateway retry amplification.",
                },
                {
                    "id": "status-comms-runbook",
                    "name": "Status communications",
                    "content": "Use when customer-facing enterprise account updates are required.",
                },
            ],
            "memoriesCatalog": [
                {
                    "id": "decision-enterprise-comms",
                    "content": "For sev-1 checkout incidents, send an enterprise status update only after rollback is complete and error rate is below 2%.",
                },
                {
                    "id": "checkout-v812-rollback",
                    "content": "checkout-edge v812 rollback completed cleanly once saturated payment pools were reset.",
                },
            ],
            "executorOptions": {
                "description": executor_description,
            },
            "runtime": {"language": "JavaScript"},
        }),
    )?
    .with_runtime(Box::new(runtime))?;

    let result = analyst.forward_with_options(
        &mut client,
        json!({
            "incidentLog": build_incident_log(),
            "question": "Find the root cause, first three remediation actions, and concrete evidence for the checkout payment incident.",
        }),
        json!({"max_actor_steps": 30}),
    )?;

    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
