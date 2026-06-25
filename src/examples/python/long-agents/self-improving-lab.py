# ax-example:start
# title: Python Self-Improving Lab Agent
# group: long-agents
# description: A many-tool agent that runs experiments, grades them against a rubric with an independent verifier, and distills verified rules into memory -- iterating until the rubric passes.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 40
# ax-example:end
import json
import os
import re

from axllm import OpenAICompatibleClient, agent, ax
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)

# ---------------------------------------------------------------------------
# The "lab": a deterministic black-box experiment. It scores an ETL config plan
# against a hidden ideal and returns, for any failing check, the exact fix --
# so the agent can converge by following the feedback, not by being told.
# ---------------------------------------------------------------------------
CHECKS = ["no-nulls", "no-duplicates", "numeric-types", "trimmed-strings", "outliers-handled"]
REMEDIES = {
    "no-nulls": "set nullPolicy=impute (or nullPolicy=drop)",
    "no-duplicates": "set dedup=on",
    "numeric-types": "set coerceTypes=on",
    "trimmed-strings": "set trim=on",
    "outliers-handled": "set outlier=clip (or outlier=winsorize)",
}


def run_in_sandbox(plan):
    flags = dict(re.findall(r"([a-z]+)\s*=\s*([a-z0-9]+)", str(plan).lower()))
    ok = {
        "no-nulls": flags.get("nullpolicy") in ("impute", "drop"),
        "no-duplicates": flags.get("dedup") == "on",
        "numeric-types": flags.get("coercetypes") == "on",
        "trimmed-strings": flags.get("trim") == "on",
        "outliers-handled": flags.get("outlier") in ("clip", "winsorize"),
    }
    passed = [c for c in CHECKS if ok[c]]
    failed = [{"check": c, "fix": REMEDIES[c]} for c in CHECKS if not ok[c]]
    return {
        "score": round(len(passed) / len(CHECKS), 2),
        "solved": len(passed) == len(CHECKS),
        "passed": passed,
        "failed": failed,
        "logs": f"{len(passed)}/{len(CHECKS)} checks passed",
    }


# An independent verifier -- a separate ax() program, not the agent grading itself.
verifier = ax("rubric:string, evidence:json -> passed:boolean, feedback:string, missing:string[]")
verifier.set_instruction(
    "You are an independent rubric grader, not a self-critique. Pass only when the evidence clearly satisfies every part of the rubric."
)

# In-memory rule store. Verified, reusable rules go here -- not raw failure notes.
memory_store = {}

runtime = AxQuickJsCodeRuntime()
runtime.register_callable("runExperiment", lambda p: run_in_sandbox(p.get("plan", "")))
runtime.register_callable("listChecks", lambda p: CHECKS)
runtime.register_callable("grade", lambda p: verifier.forward(client, {"rubric": p.get("rubric", ""), "evidence": p.get("evidence", [])}))


def recall_tool(p):
    t = str(p.get("topic", "")).lower()
    return [v for k, v in memory_store.items() if t in k or any(w in k for w in t.split())]


def remember_tool(p):
    rule = str(p.get("rule", ""))
    memory_store[rule.lower()[:48]] = f"{rule} :: {p.get('evidence', '')}"
    return {"stored": True, "total": len(memory_store)}


runtime.register_callable("recall", recall_tool)
runtime.register_callable("remember", remember_tool)


def _spec(name, description, props, required=None):
    return {
        "name": name,
        "description": description,
        "parameters": {"type": "object", "properties": props, **({"required": required} if required else {})},
    }


self_improving = agent(
    'goal:string, rubric:string -> answer:string, experiments:string[] "Plans tried, in order", learnedRules:string[]',
    {
        "contextFields": [],
        "functions": [
            _spec("runExperiment", "Apply an ETL config plan; returns score, solved, passed[], failed[{check,fix}], logs. Pass an empty plan to discover the fixes.", {"plan": {"type": "string"}}, ["plan"]),
            _spec("listChecks", "List the data-quality checks the experiment evaluates.", {}),
            _spec("grade", "Independent rubric grader. Pass only when the evidence meets the rubric.", {"rubric": {"type": "string"}, "evidence": {"type": "array", "items": {"type": "string"}}}, ["rubric", "evidence"]),
            _spec("recall", "Recall verified rules relevant to a topic.", {"topic": {"type": "string"}}, ["topic"]),
            _spec("remember", "Store a verified, reusable rule (the rule, not raw notes).", {"rule": {"type": "string"}, "evidence": {"type": "string"}}, ["rule", "evidence"]),
        ],
        "contextPolicy": {"preset": "adaptive", "budget": "balanced"},
        "executorOptions": {
            "description": "\n".join([
                "Use the tools -- do not answer from your own knowledge.",
                "1. recall('etl data quality') to reuse anything already learned.",
                "2. runExperiment('') once to see every failing check and its fix.",
                "3. Build a plan applying all the fixes, then runExperiment again. Repeat until solved is true.",
                "4. grade the passing evidence against the rubric.",
                "5. For each check you fixed, remember(rule, evidence).",
                "6. Then return the answer, the plans you tried, and the learned rules.",
            ]),
        },
        "runtime": {"language": "JavaScript"},
    },
)

result = self_improving.forward(
    client,
    {
        "goal": "Find an ETL config plan that cleans the dirty dataset so every data-quality check passes.",
        "rubric": "All five checks (no-nulls, no-duplicates, numeric-types, trimmed-strings, outliers-handled) must pass, i.e. score 1.0.",
    },
    {"runtime": runtime, "max_actor_steps": 18},
)

print(json.dumps(result, indent=2, sort_keys=True))
# Persist the agent's verified rules so a future run's recall reuses them.
for rule in result.get("learnedRules", []) or []:
    memory_store[str(rule).lower()[:48]] = str(rule)
print(f"\nMemory now holds {len(memory_store)} rule(s) for next time.")
