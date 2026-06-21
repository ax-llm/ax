// ax-example:start
// title: Rust Incident Log Forensics (RLM)
// group: long-agents
// description: Infers service architecture and root-cause findings from a huge CloudWatch export that never enters the prompt -- held in contextFields and worked through the runtime under a lean contextPolicy.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 10
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

// ---------------------------------------------------------------------------
// Synthetic CloudWatch-style export -- generated large on purpose. Dumping these
// raw events into a prompt would blow the context window. The agent keeps them
// in its runtime (contextFields) and only the *evidence it extracts* ever
// reaches the model. Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
fn build_log_dump() -> Vec<Value> {
    // 2026-03-02 13:00:00Z, incremented by 2 seconds per index.
    const START_EPOCH: i64 = 1772456400; // 2026-03-02T13:00:00Z
    let mut events: Vec<Value> = Vec::new();

    let mut push = |i: i64, mut event: Value| {
        let secs = START_EPOCH + i * 2;
        // Format the absolute time as an ISO-8601 UTC stamp (no chrono dependency).
        event["timestamp"] = Value::String(iso_utc(secs));
        event["requestId"] = Value::String(format!("req-{}", 100000 + i));
        events.push(event);
    };

    for i in 0..1600i64 {
        // Routine, healthy traffic across the fleet.
        push(
            i,
            json!({"level": "INFO", "service": "gateway", "statusCode": 200, "latencyMs": 40 + (i % 30), "message": "route ok GET /checkout"}),
        );
        push(
            i,
            json!({"level": "INFO", "service": "search-api", "statusCode": 200, "latencyMs": 70 + (i % 50), "message": "query ok q=shoes"}),
        );

        // Window A: payments-gw upstream timeouts spill into checkout-api 502s for
        // enterprise tenants, with retry storms + pool exhaustion.
        if (300..520).contains(&i) {
            push(
                i,
                json!({"level": "ERROR", "service": "payments-gw", "statusCode": 504, "latencyMs": 10000, "tenantTier": "enterprise", "message": "upstream timeout calling acquirer (10s)"}),
            );
            push(
                i,
                json!({"level": "ERROR", "service": "checkout-api", "statusCode": 502, "tenantTier": "enterprise", "message": "bad gateway from svc-payments-gw"}),
            );
            if i % 3 == 0 {
                push(
                    i,
                    json!({"level": "WARN", "service": "payments-gw", "message": "connection pool exhausted (max=64) waiting=200+"}),
                );
                push(
                    i,
                    json!({"level": "WARN", "service": "checkout-api", "tenantTier": "enterprise", "message": "user-visible: \"Payment could not be processed\""}),
                );
            }
        }

        // Window B: the nightly catalog-cron pins CPU and search-api returns 429s.
        if (1000..1120).contains(&i) {
            push(
                i,
                json!({"level": "WARN", "service": "catalog-cron", "latencyMs": 0, "message": "rebuild step pinning CPU at 95% on shared node"}),
            );
            push(
                i,
                json!({"level": "ERROR", "service": "search-api", "statusCode": 429, "message": "rate limited: downstream catalog unavailable"}),
            );
        }
    }

    events
}

// Minimal UTC epoch-seconds -> "YYYY-MM-DDTHH:MM:SSZ" formatter (proleptic Gregorian).
fn iso_utc(epoch_secs: i64) -> String {
    let days = epoch_secs.div_euclid(86_400);
    let secs_of_day = epoch_secs.rem_euclid(86_400);
    let (hh, mm, ss) = (secs_of_day / 3600, (secs_of_day % 3600) / 60, secs_of_day % 60);
    // Convert days-since-epoch (1970-01-01) to a calendar date.
    let mut z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    z -= era * 146_097;
    let doe = z;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hh, mm, ss
    )
}

fn main() -> AxResult<()> {
    let mut client = gemini_client()?;

    let logs = build_log_dump();
    println!(
        "Generated {} log events (kept out of the prompt).",
        logs.len()
    );

    // `with_runtime` attaches the embedded JS engine so the agent loop can run.
    let mut log_rlm = agent_with_options(
        "task:string, logs:json \"Raw CloudWatch export; keep this out of the prompt\" -> architecture:string[] \"Services and how they call each other\", findings:json[] \"Each: issue, count, window, evidence, impact\", overallHealth:string, nextActions:string[]",
        json!({
            // The export stays in the runtime; only extracted evidence reaches the model.
            "contextFields": ["logs"],
            "contextPolicy": {"preset": "lean", "budget": "balanced"},
            "maxRuntimeChars": 12000,
            "runtime": {"language": "JavaScript"},
        }),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;

    let report = log_rlm.forward_with_options(
        &mut client,
        json!({
            "logs": logs,
            "task": "Infer the service architecture from the logs alone. Then find repeated errors, throttles, retries, and bad user states -- with the affected time window, an occurrence count, and concrete log evidence for each.",
        }),
        json!({"max_actor_steps": 40}),
    )?;

    println!("\n=== Report ===");
    println!("{}", serde_json::to_string_pretty(&report)?);
    println!("\n=== Usage ===");
    println!("{}", serde_json::to_string_pretty(&log_rlm.get_usage())?);
    Ok(())
}
