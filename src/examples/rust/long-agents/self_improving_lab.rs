// ax-example:start
// title: Rust Self-Improving Lab Agent
// group: long-agents
// description: A many-tool agent that runs experiments, grades them against a rubric with an independent verifier, and distills verified rules into memory -- iterating until the rubric passes.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 40
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, ax, AxResult, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::sync::{Arc, Mutex};

fn openai_config() -> AxResult<(String, String)> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    Ok((api_key, model))
}

fn openai_client(api_key: &str, model: &str) -> OpenAICompatibleClient {
    OpenAICompatibleClient::new(api_key.to_string(), model.to_string())
        .with_model_config(json!({"temperature": 0}))
}

// ---------------------------------------------------------------------------
// The "lab": a deterministic black-box experiment. It scores an ETL config plan
// against a hidden ideal and returns, for any failing check, the exact fix --
// so the agent can converge by following the feedback, not by being told.
// ---------------------------------------------------------------------------
const CHECKS: [&str; 5] = [
    "no-nulls",
    "no-duplicates",
    "numeric-types",
    "trimmed-strings",
    "outliers-handled",
];

fn remedy(check: &str) -> &'static str {
    match check {
        "no-nulls" => "set nullPolicy=impute (or nullPolicy=drop)",
        "no-duplicates" => "set dedup=on",
        "numeric-types" => "set coerceTypes=on",
        "trimmed-strings" => "set trim=on",
        "outliers-handled" => "set outlier=clip (or outlier=winsorize)",
        _ => "",
    }
}

// Parse `key=value` flags (lowercased) out of a free-form plan string, matching
// the Python reference's regex `([a-z]+)\s*=\s*([a-z0-9]+)`.
fn parse_flags(plan: &str) -> BTreeMap<String, String> {
    let lower = plan.to_lowercase();
    let mut flags = BTreeMap::new();
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_lowercase() {
            let key_start = i;
            while i < bytes.len() && bytes[i].is_ascii_lowercase() {
                i += 1;
            }
            let key = &lower[key_start..i];
            let mut j = i;
            while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'=' {
                j += 1;
                while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                    j += 1;
                }
                let val_start = j;
                while j < bytes.len() && bytes[j].is_ascii_alphanumeric() {
                    j += 1;
                }
                if j > val_start {
                    flags.insert(key.to_string(), lower[val_start..j].to_string());
                    i = j;
                    continue;
                }
            }
        } else {
            i += 1;
        }
    }
    flags
}

fn run_in_sandbox(plan: &str) -> Value {
    let flags = parse_flags(plan);
    let is = |k: &str, opts: &[&str]| flags.get(k).is_some_and(|v| opts.contains(&v.as_str()));
    let ok = |check: &str| match check {
        "no-nulls" => is("nullpolicy", &["impute", "drop"]),
        "no-duplicates" => is("dedup", &["on"]),
        "numeric-types" => is("coercetypes", &["on"]),
        "trimmed-strings" => is("trim", &["on"]),
        "outliers-handled" => is("outlier", &["clip", "winsorize"]),
        _ => false,
    };
    let passed: Vec<&str> = CHECKS.into_iter().filter(|c| ok(c)).collect();
    let failed: Vec<Value> = CHECKS
        .into_iter()
        .filter(|c| !ok(c))
        .map(|c| json!({"check": c, "fix": remedy(c)}))
        .collect();
    let score = ((passed.len() as f64 / CHECKS.len() as f64) * 100.0).round() / 100.0;
    json!({
        "score": score,
        "solved": passed.len() == CHECKS.len(),
        "passed": passed,
        "failed": failed,
        "logs": format!("{}/{} checks passed", passed.len(), CHECKS.len()),
    })
}

fn main() -> AxResult<()> {
    let (api_key, model) = openai_config()?;
    let mut client = openai_client(&api_key, &model);

    // In-memory rule store. Verified, reusable rules go here -- not raw failure notes.
    let memory_store: Arc<Mutex<BTreeMap<String, String>>> = Arc::new(Mutex::new(BTreeMap::new()));

    let mut runtime = QuickJsCodeRuntime::new();

    runtime.register_callable("runExperiment", |p: Value| {
        let plan = p.get("plan").and_then(|v| v.as_str()).unwrap_or("");
        Ok(run_in_sandbox(plan))
    })?;

    runtime.register_callable("listChecks", |_p: Value| Ok(json!(CHECKS.to_vec())))?;

    // An independent verifier -- a separate ax() program, not the agent grading
    // itself. It runs on its own client built from the same credentials so the
    // grade callable stays Send + Sync.
    let grade_key = api_key.clone();
    let grade_model = model.clone();
    runtime.register_callable("grade", move |p: Value| {
        let mut verifier = ax(
            "rubric:string, evidence:json -> passed:boolean, feedback:string, missing:string[]",
        )?;
        verifier.set_instruction(
            "You are an independent rubric grader, not a self-critique. Pass only when the evidence clearly satisfies every part of the rubric.",
        );
        let mut grader = openai_client(&grade_key, &grade_model);
        verifier.forward(
            &mut grader,
            json!({
                "rubric": p.get("rubric").cloned().unwrap_or_else(|| json!("")),
                "evidence": p.get("evidence").cloned().unwrap_or_else(|| json!([])),
            }),
        )
    })?;

    // NOTE: `recall` is a reserved runtime builtin in the QuickJS engine, so the
    // host tool is named `recallRules` (the model is told to use that name).
    let recall_store = memory_store.clone();
    runtime.register_callable("recallRules", move |p: Value| {
        let topic = p
            .get("topic")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let words: Vec<&str> = topic.split_whitespace().collect();
        let store = recall_store.lock().unwrap();
        let hits: Vec<Value> = store
            .iter()
            .filter(|(k, _)| k.contains(&topic) || words.iter().any(|w| k.contains(w)))
            .map(|(_, v)| json!(v))
            .collect();
        Ok(Value::Array(hits))
    })?;

    let remember_store = memory_store.clone();
    runtime.register_callable("remember", move |p: Value| {
        let rule = p.get("rule").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let evidence = p
            .get("evidence")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let key: String = rule.to_lowercase().chars().take(48).collect();
        let mut store = remember_store.lock().unwrap();
        store.insert(key, format!("{rule} :: {evidence}"));
        Ok(json!({"stored": true, "total": store.len()}))
    })?;

    let executor_description = [
        "Use the tools -- do not answer from your own knowledge.",
        "1. recallRules('etl data quality') to reuse anything already learned.",
        "2. runExperiment('') once to see every failing check and its fix.",
        "3. Build a plan applying all the fixes, then runExperiment again. Repeat until solved is true.",
        "4. grade the passing evidence against the rubric.",
        "5. For each check you fixed, remember(rule, evidence).",
        "6. Then return the answer, the plans you tried, and the learned rules.",
    ]
    .join("\n");

    let mut self_improving = agent_with_options(
        "goal:string, rubric:string -> answer:string, experiments:string[] \"Plans tried, in order\", learnedRules:string[]",
        json!({
            "contextFields": [],
            "functions": [
                {
                    "name": "runExperiment",
                    "description": "Apply an ETL config plan; returns score, solved, passed[], failed[{check,fix}], logs. Pass an empty plan to discover the fixes.",
                    "parameters": {"type": "object", "properties": {"plan": {"type": "string"}}, "required": ["plan"]},
                },
                {
                    "name": "listChecks",
                    "description": "List the data-quality checks the experiment evaluates.",
                    "parameters": {"type": "object", "properties": {}},
                },
                {
                    "name": "grade",
                    "description": "Independent rubric grader. Pass only when the evidence meets the rubric.",
                    "parameters": {"type": "object", "properties": {"rubric": {"type": "string"}, "evidence": {"type": "array", "items": {"type": "string"}}}, "required": ["rubric", "evidence"]},
                },
                {
                    "name": "recallRules",
                    "description": "Recall verified rules relevant to a topic.",
                    "parameters": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]},
                },
                {
                    "name": "remember",
                    "description": "Store a verified, reusable rule (the rule, not raw notes).",
                    "parameters": {"type": "object", "properties": {"rule": {"type": "string"}, "evidence": {"type": "string"}}, "required": ["rule", "evidence"]},
                },
            ],
            "contextPolicy": {"preset": "adaptive", "budget": "balanced"},
            "executorOptions": {"description": executor_description},
            "runtime": {"language": "JavaScript"},
        }),
    )?
    .with_runtime(Box::new(runtime))?;

    let result = self_improving.forward_with_options(
        &mut client,
        json!({
            "goal": "Find an ETL config plan that cleans the dirty dataset so every data-quality check passes.",
            "rubric": "All five checks (no-nulls, no-duplicates, numeric-types, trimmed-strings, outliers-handled) must pass, i.e. score 1.0.",
        }),
        json!({"max_actor_steps": 18}),
    )?;

    println!("{}", serde_json::to_string_pretty(&result)?);

    // Persist the agent's verified rules so a future run's recall reuses them.
    if let Some(rules) = result.get("learnedRules").and_then(|v| v.as_array()) {
        let mut store = memory_store.lock().unwrap();
        for rule in rules {
            let rule_str = rule.as_str().map(String::from).unwrap_or_else(|| rule.to_string());
            let key: String = rule_str.to_lowercase().chars().take(48).collect();
            store.insert(key, rule_str);
        }
    }
    let total = memory_store.lock().unwrap().len();
    println!("\nMemory now holds {total} rule(s) for next time.");
    Ok(())
}
