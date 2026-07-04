# ax-example:start
# title: Python Smart Defaults Agent
# group: long-agents
# description: Shows AxAgent smart defaults: oversized undeclared context stays out of the prompt while relevance hints and runtime tools guide the agent.
# provider: google-gemini
# env: GOOGLE_APIKEY
# level: advanced
# order: 60
# ax-example:end
import json
import os

from axllm import GoogleGeminiClient, agent
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("GOOGLE_APIKEY")
if not api_key:
    raise SystemExit("Set GOOGLE_APIKEY to run this example.")

client = GoogleGeminiClient(api_key=api_key, model="gemini-3.5-flash")

TIMELINE = [
    "09:12 checkout-edge v812 deployed behind 25% of traffic",
    "09:18 payments gateway p95 rose from 420ms to 4.8s",
    "09:22 cart completion dropped 31% for enterprise accounts",
    "09:27 retries saturated the checkout-edge connection pool",
    "09:31 rollback to v811 started",
    "09:36 p95 returned below 700ms after pool reset",
]

incident_log = "\n\n".join(
    f"# log shard {i + 1}\n" + "\n".join(TIMELINE) for i in range(28)
)

INCIDENT_SUMMARY = {
    "service": "checkout",
    "severity": "sev-1",
    "rootCause": "checkout-edge v812 retried payment gateway calls without bounded concurrency, saturating the shared connection pool.",
    "errorRate": "38%",
    "affectedSessions": 1284,
    "candidateRunbook": "payments-timeout-runbook",
    "relevantMemory": "decision-enterprise-comms",
}


def summarize_incident(p):
    out = dict(INCIDENT_SUMMARY)
    out["service"] = p.get("service", "checkout")
    return out


def get_timeline(p):
    service = p.get("service", "checkout")
    return [{"service": service, "event": event} for event in TIMELINE]


def get_runbook(p):
    return {
        "id": p.get("id", "payments-timeout-runbook"),
        "steps": [
            "Freeze checkout deploys and page the payments owner.",
            "Rollback checkout-edge to v811 and reset saturated pools.",
            "Post enterprise status update after error rate stays below 2%.",
        ],
    }


runtime = AxQuickJsCodeRuntime()
runtime.register_callable("summarizeIncident", summarize_incident)
runtime.register_callable("getTimeline", get_timeline)
runtime.register_callable("getRunbook", get_runbook)

analyst = agent(
    'incidentLog:string, question:string -> rootCause:string, actions:string[] "Recommended remediation actions from the runbook", evidence:string[]',
    {
        "name": "SmartDefaultsIncidentAgent",
        "description": "Investigate checkout incidents using runtime tools, relevance hints, and compact evidence.",
        # No contextFields and no autoUpgrade option: oversized incidentLog is promoted by default.
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
            "description": "\n".join(
                [
                    "Call the bare async runtime functions summarizeIncident, getTimeline, and getRunbook before answering.",
                    "Use top-level await, for example: const s = await summarizeIncident({service:'checkout'});",
                    "The large incidentLog input is intentionally not declared as a context field; smart defaults keep it available at runtime without flooding the prompt.",
                    "Return the root cause, the first three remediation actions, and concrete evidence.",
                ]
            )
        },
        "runtime": {"language": "JavaScript"},
    },
)

result = analyst.forward(
    client,
    {
        "incidentLog": incident_log,
        "question": "Find the root cause, first three remediation actions, and concrete evidence for the checkout payment incident.",
    },
    {"runtime": runtime, "max_actor_steps": 30},
)

print(json.dumps(result, indent=2, sort_keys=True))
