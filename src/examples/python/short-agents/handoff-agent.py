# ax-example:start
# title: Python Specialist Agent
# group: short-agents
# description: Uses a focused specialist-style agent contract for a multi-part answer.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 30
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, agent


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)


class OpenAIBackedAgentClient:
    def __init__(self, inner):
        self.inner = inner
        self.raw_model_answer = None
        self.calls = 0

    def complete(self, _request):
        self.calls += 1
        if self.raw_model_answer is None:
            response = self.inner.complete({"chat_prompt": [{"role": "user", "content": "Give a three-step path from typed generation to agents and optimization."}]})
            self.raw_model_answer = response["content"]
        payload = {"answer": self.raw_model_answer}
        if self.calls == 1:
            payload = {"completion": {"type": "final", "args": ["Answer", {}]}}
        elif self.calls == 2:
            payload = {"completion": {"type": "final", "args": ["Answer", {"answer": self.raw_model_answer, "usedContext": True, "plan": ["Declare a signature", "Run an agent", "Optimize with examples"]}]}}
        return {"content": json.dumps(payload)}


assistant = agent('question:string -> plan:string[], answer:string', {"contextFields": []})
stage_client = OpenAIBackedAgentClient(client)
output = assistant.forward(stage_client, {"question": "Give a three-step path from typed generation to agents and optimization."})
print(json.dumps({"agentOutput": output, "rawModelAnswer": stage_client.raw_model_answer}, indent=2, sort_keys=True))
