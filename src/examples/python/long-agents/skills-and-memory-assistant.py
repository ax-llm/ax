# ax-example:start
# title: Python Skills + Memory Ops Assistant
# group: long-agents
# description: An on-call assistant that recalls past decisions from a memory store and loads the right runbook skill on demand, using the agent skills and memories subsystems.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 50
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, agent
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    # gpt-5.4 (not -mini): the recall/discover loop needs reasoning to proactively
    # pull memories + runbooks instead of stopping to ask for clarification.
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4"),
    model_config={"temperature": 0},
)

# ---------------------------------------------------------------------------
# Memory store -- remembered decisions and postmortems. In production this is a
# vector DB / BM25 index; here a tiny KV with substring matching. The actor
# pulls relevant entries into scope via `await recall([...])`.
# ---------------------------------------------------------------------------
memory_store = {
    "decision/db-failover": "Decision (2026-02): during a primary DB failover, freeze writes via the feature flag `writes.enabled=false` BEFORE promoting the replica. Promoting first caused split-brain in inc-118.",
    "postmortem/inc-118": "inc-118 root cause: replica promoted while primary still accepted writes. Mitigation: write-freeze flag + 90s replication-lag gate.",
    "decision/customer-comms": "Decision: for Sev-1s affecting enterprise tenants, post a status-page update within 15 minutes and notify named TAMs directly.",
}


def on_memories_search(searches, already_loaded):
    skip = {m.get("id") for m in (already_loaded or [])}
    matches = []
    for query in searches or []:
        q = str(query).lower()
        for mid, content in memory_store.items():
            if mid in skip:
                continue
            if q in mid.lower() or q in content.lower():
                matches.append({"id": mid, "content": content})
    return matches


# ---------------------------------------------------------------------------
# Skill store -- runbooks loaded into the executor prompt on demand via
# `await discover({ skills: [...] })`. Loaded skills persist across calls.
# ---------------------------------------------------------------------------
skill_store = [
    {
        "id": "runbook-db-failover",
        "name": "DB failover runbook",
        "content": "## DB failover\n1. Set `writes.enabled=false`.\n2. Wait for replication lag < 5s.\n3. Promote replica.\n4. Re-point app via service discovery.\n5. Re-enable writes. 6. File postmortem within 48h.",
    },
    {
        "id": "runbook-status-comms",
        "name": "Status communications runbook",
        "content": "## Status comms\n- Sev-1: status-page update within 15m, every 30m thereafter.\n- Enterprise impact: notify named TAMs directly.\n- Keep updates factual; no ETAs you cannot keep.",
    },
]


def on_skills_search(searches):
    out = []
    for query in searches or []:
        q = str(query).lower()
        out.extend(
            s for s in skill_store
            if q in s["id"].lower() or q in s["name"].lower() or q in s["content"].lower()
        )
    return out


assistant = agent(
    'situation:string -> guidance:string "What to do, grounded in our decisions and runbooks", steps:string[]',
    {
        "contextFields": [],
        # A base skill always loaded, independent of search.
        "skills": [
            {
                "name": "house-style",
                "content": "Be concise and operational. Prefer our remembered decisions over generic advice. Never invent flag names or steps -- cite the runbook.",
            }
        ],
        "onMemoriesSearch": on_memories_search,
        "onSkillsSearch": on_skills_search,
        "onLoadedMemories": lambda results: print("[memories loaded]", ", ".join(r.get("id", "") for r in results)),
        "onLoadedSkills": lambda results: print("[skills loaded]", ", ".join(r.get("id") or r.get("name") for r in results)),
        "onUsedMemories": lambda results: print("[memories used]", ", ".join(r.get("id", "") for r in results)),
        "onUsedSkills": lambda results: print("[skills used]", ", ".join(r.get("id", "") for r in results)),
        "executorOptions": {
            "description": "\n".join([
                "You do NOT know our internal flag names, incident history, or runbook steps from your own training.",
                "The only source of truth is our memory (past decisions/postmortems) and our runbook skills.",
                "1. recall the relevant past decisions and postmortems (e.g. the failover decision, inc-118).",
                "2. discover the matching runbook skill and read its exact steps and flag names.",
                "3. Answer with the precise ordered procedure, citing our exact flag names and runbook steps.",
                "Generic best-practice advice is WRONG here. Do NOT answer from general knowledge and do NOT ask for clarification -- recall and discover first.",
            ]),
        },
        "runtime": {"language": "JavaScript"},
    },
)

result = assistant.forward(
    client,
    {
        "situation": (
            "Our primary database is unhealthy and we're about to fail over -- the same class of "
            "incident as inc-118, and enterprise checkout is affected. Per our remembered decisions "
            "and runbooks: what is the exact ordered procedure, and which specific feature flag must "
            "we set before promoting the replica?"
        ),
    },
    {"runtime": AxQuickJsCodeRuntime(), "max_actor_steps": 12},
)

print("\n=== Response ===")
print(json.dumps(result, indent=2, sort_keys=True))
