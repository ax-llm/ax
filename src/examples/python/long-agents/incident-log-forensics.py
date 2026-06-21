# ax-example:start
# title: Python Incident Log Forensics (RLM)
# group: long-agents
# description: Infers service architecture and root-cause findings from a huge CloudWatch export that never enters the prompt -- held in contextFields and worked through the runtime under a lean contextPolicy.
# provider: google-gemini
# env: GOOGLE_APIKEY
# level: advanced
# order: 10
# ax-example:end
import json
import os
from datetime import datetime, timedelta, timezone

from axllm import GoogleGeminiClient, agent
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("GOOGLE_APIKEY")
if not api_key:
    raise SystemExit("Set GOOGLE_APIKEY to run this example.")

client = GoogleGeminiClient(api_key=api_key, model="gemini-3.5-flash")


# ---------------------------------------------------------------------------
# Synthetic CloudWatch-style export -- generated large on purpose. Dumping these
# raw events into a prompt would blow the context window. The agent keeps them
# in its runtime (contextFields) and only the *evidence it extracts* ever
# reaches the model. Deterministic so the example is reproducible.
# ---------------------------------------------------------------------------
def build_log_dump():
    start = datetime(2026, 3, 2, 13, 0, 0, tzinfo=timezone.utc)
    events = []

    def push(i, event):
        event = dict(event)
        event["timestamp"] = (start + timedelta(seconds=i * 2)).isoformat().replace("+00:00", "Z")
        event["requestId"] = f"req-{100000 + i}"
        events.append(event)

    for i in range(1600):
        # Routine, healthy traffic across the fleet.
        push(i, {"level": "INFO", "service": "gateway", "statusCode": 200, "latencyMs": 40 + (i % 30), "message": "route ok GET /checkout"})
        push(i, {"level": "INFO", "service": "search-api", "statusCode": 200, "latencyMs": 70 + (i % 50), "message": "query ok q=shoes"})

        # Window A: payments-gw upstream timeouts spill into checkout-api 502s for
        # enterprise tenants, with retry storms + pool exhaustion.
        if 300 <= i < 520:
            push(i, {"level": "ERROR", "service": "payments-gw", "statusCode": 504, "latencyMs": 10000, "tenantTier": "enterprise", "message": "upstream timeout calling acquirer (10s)"})
            push(i, {"level": "ERROR", "service": "checkout-api", "statusCode": 502, "tenantTier": "enterprise", "message": "bad gateway from svc-payments-gw"})
            if i % 3 == 0:
                push(i, {"level": "WARN", "service": "payments-gw", "message": "connection pool exhausted (max=64) waiting=200+"})
                push(i, {"level": "WARN", "service": "checkout-api", "tenantTier": "enterprise", "message": 'user-visible: "Payment could not be processed"'})

        # Window B: the nightly catalog-cron pins CPU and search-api returns 429s.
        if 1000 <= i < 1120:
            push(i, {"level": "WARN", "service": "catalog-cron", "latencyMs": 0, "message": "rebuild step pinning CPU at 95% on shared node"})
            push(i, {"level": "ERROR", "service": "search-api", "statusCode": 429, "message": "rate limited: downstream catalog unavailable"})

    return events


logs = build_log_dump()
print(f"Generated {len(logs)} log events (kept out of the prompt).")

log_rlm = agent(
    'task:string, logs:json "Raw CloudWatch export; keep this out of the prompt" -> architecture:string[] "Services and how they call each other", findings:json[] "Each: issue, count, window, evidence, impact", overallHealth:string, nextActions:string[]',
    {
        # The export stays in the runtime; only extracted evidence reaches the model.
        "contextFields": ["logs"],
        "contextPolicy": {"preset": "lean", "budget": "balanced"},
        "maxRuntimeChars": 12000,
        "runtime": {"language": "JavaScript"},
    },
)

report = log_rlm.forward(
    client,
    {
        "logs": logs,
        "task": "Infer the service architecture from the logs alone. Then find repeated errors, throttles, retries, and bad user states -- with the affected time window, an occurrence count, and concrete log evidence for each.",
    },
    {"runtime": AxQuickJsCodeRuntime(), "max_actor_steps": 40},
)

print("\n=== Report ===")
print(json.dumps(report, indent=2, sort_keys=True))
print("\n=== Usage ===")
print(json.dumps(log_rlm.get_usage(), indent=2, sort_keys=True))
