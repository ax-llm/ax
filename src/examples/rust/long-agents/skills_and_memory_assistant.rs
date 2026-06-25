// ax-example:start
// title: Rust Skills + Memory Ops Assistant
// group: long-agents
// description: An on-call assistant that recalls past decisions from a memory store and loads the right runbook skill on demand, using the agent skills and memories subsystems.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_search_callbacks, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    // gpt-5.4 (not -mini): the recall/discover loop needs reasoning to proactively
    // pull memories + runbooks instead of stopping to ask for clarification.
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;

    // -----------------------------------------------------------------------
    // Memory + skill stores. In production these are a vector DB / BM25 index;
    // here small in-memory sets. The native onMemoriesSearch / onSkillsSearch
    // callbacks below receive the actor's recall()/discover() queries.
    // -----------------------------------------------------------------------
    let memories = vec![
        json!({"id": "decision/db-failover", "content": "Decision (2026-02): during a primary DB failover, freeze writes via the feature flag `writes.enabled=false` BEFORE promoting the replica. Promoting first caused split-brain in inc-118."}),
        json!({"id": "postmortem/inc-118", "content": "inc-118 root cause: replica promoted while primary still accepted writes. Mitigation: write-freeze flag + 90s replication-lag gate."}),
        json!({"id": "decision/customer-comms", "content": "Decision: for Sev-1s affecting enterprise tenants, post a status-page update within 15 minutes and notify named TAMs directly."}),
    ];
    let skills = vec![
        json!({"id": "runbook-db-failover", "name": "DB failover runbook", "content": "## DB failover\n1. Set `writes.enabled=false`.\n2. Wait for replication lag < 5s.\n3. Promote replica.\n4. Re-point app via service discovery.\n5. Re-enable writes. 6. File postmortem within 48h."}),
        json!({"id": "runbook-status-comms", "name": "Status communications runbook", "content": "## Status comms\n- Sev-1: status-page update within 15m, every 30m thereafter.\n- Enterprise impact: notify named TAMs directly.\n- Keep updates factual; no ETAs you cannot keep."}),
    ];

    // Token-based matching (a stand-in for BM25/vector): an entry matches if any
    // word (len >= 3) of any search query appears in it -- robust to phrase queries.
    let memories_search = move |searches: serde_json::Value, already_loaded: serde_json::Value| -> serde_json::Value {
        let loaded: std::collections::HashSet<String> = already_loaded
            .as_array()
            .map(|a| a.iter().filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(String::from)).collect())
            .unwrap_or_default();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut out: Vec<serde_json::Value> = vec![];
        if let Some(qs) = searches.as_array() {
            for q in qs {
                let qstr = q.as_str().unwrap_or("").to_lowercase();
                for tok in qstr.split(|c: char| !c.is_alphanumeric()).filter(|t| t.len() >= 3) {
                    for m in &memories {
                        let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if loaded.contains(id) || seen.contains(id) {
                            continue;
                        }
                        let hay = format!("{} {}", id, m.get("content").and_then(|v| v.as_str()).unwrap_or("")).to_lowercase();
                        if hay.contains(tok) {
                            out.push(m.clone());
                            seen.insert(id.to_string());
                        }
                    }
                }
            }
        }
        serde_json::Value::Array(out)
    };
    let skills_search = move |searches: serde_json::Value| -> serde_json::Value {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut out: Vec<serde_json::Value> = vec![];
        if let Some(qs) = searches.as_array() {
            for q in qs {
                let qstr = q.as_str().unwrap_or("").to_lowercase();
                for tok in qstr.split(|c: char| !c.is_alphanumeric()).filter(|t| t.len() >= 3) {
                    for sk in &skills {
                        let id = sk.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if seen.contains(id) {
                            continue;
                        }
                        let hay = format!(
                            "{} {} {}",
                            id,
                            sk.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                            sk.get("content").and_then(|v| v.as_str()).unwrap_or("")
                        )
                        .to_lowercase();
                        if hay.contains(tok) {
                            out.push(sk.clone());
                            seen.insert(id.to_string());
                        }
                    }
                }
            }
        }
        serde_json::Value::Array(out)
    };

    let executor_description = [
        "You do NOT know our internal flag names, incident history, or runbook steps from your own training.",
        "The only source of truth is our memory (past decisions/postmortems) and our runbook skills.",
        "1. recall the relevant past decisions and postmortems (e.g. the failover decision, inc-118).",
        "2. discover the matching runbook skill and read its exact steps and flag names.",
        "3. Answer with the precise ordered procedure, citing our exact flag names and runbook steps.",
        "Generic best-practice advice is WRONG here. Do NOT answer from general knowledge and do NOT ask for clarification -- recall and discover first.",
    ]
    .join("\n");

    // Native host search callbacks -- the actor's recall()/discover() reach these,
    // which also auto-enables the memory + skill subsystems. `with_runtime` attaches
    // the embedded JS engine so the agent loop can run.
    let mut assistant = agent_with_search_callbacks(
        "situation:string -> guidance:string \"What to do, grounded in our decisions and runbooks\", steps:string[]",
        json!({
            "contextFields": [],
            // A base skill always loaded, independent of search.
            "skills": [
                {
                    "name": "house-style",
                    "content": "Be concise and operational. Prefer our remembered decisions over generic advice. Never invent flag names or steps -- cite the runbook.",
                }
            ],
            "executorOptions": {"description": executor_description},
            "runtime": {"language": "JavaScript"},
        }),
        memories_search,
        skills_search,
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;

    let result = assistant.forward_with_options(
        &mut client,
        json!({
            "situation": "Our primary database is unhealthy and we're about to fail over -- the same class of incident as inc-118, and enterprise checkout is affected. Per our remembered decisions and runbooks: what is the exact ordered procedure, and which specific feature flag must we set before promoting the replica?",
        }),
        json!({"max_actor_steps": 12}),
    )?;

    println!("\n=== Response ===");
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
