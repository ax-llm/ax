# ax-example:start
# title: Python Child Agent Controls
# group: short-agents
# description: Delegates through a real actor runtime and applies controls to the child scope.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 13
# ax-example:end
import json
import os
from axllm import ai, agent, run_control
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY.")
client = ai("openai", api_key=key, model="gpt-6-astra",
            model_config={"thinkingTokenBudget": "low", "max_tokens": 4096})
control = run_control()
events = []
control.on_event(events.append)
control.steer("Include VERIFIED in the final answer.")
control.steer("Include CHILD-CHECK in the final answer.", target="root/team.researcher")
control.set_thinking_token_budget("medium", target="root/team.researcher/executor")
child = agent("question -> answer", {"directResponse": "off", "runtime": AxQuickJsCodeRuntime()})
parent = agent("question -> answer", {"directResponse": "off", "runtime": AxQuickJsCodeRuntime()})
parent.add_child_agent("team", "researcher", child)
result = parent.forward(client, {"question": "Delegate to team.researcher exactly once by calling await team.researcher({question: \"Compute 37 + 5 and return the exact sum.\"}) in actor code. Pass the complete child answer as evidence to final(...), then report it in your final answer."},
                        {"control": control, "serviceTier": "standard", "max_actor_steps": 8})
assert all(word in result["answer"] for word in ("42", "VERIFIED", "CHILD-CHECK")), result
assert "team.researcher" in parent.get_usage()["children"]
assert any(event["type"] == "applied" and event["path"] == "root/team.researcher/executor" for event in events)
print(json.dumps({"result": result, "child_usage": parent.get_usage()["children"]}, indent=2))
