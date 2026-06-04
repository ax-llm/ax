import json
import os

from axllm import OpenAICompatibleClient, agent


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this live example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_LIVE_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)


class LiveAgentClient:
    def __init__(self, inner):
        self.inner = inner
        self.raw_model_answer = None
        self.calls = 0

    def complete(self, _request):
        self.calls += 1
        if self.raw_model_answer is None:
            live = self.inner.complete(
                {
                    "chat_prompt": [
                        {
                            "role": "user",
                            "content": "In one sentence, explain what Ax helps developers build.",
                        }
                    ]
                }
            )
            self.raw_model_answer = live["content"]
        if self.calls == 1:
            payload = {"completion": {"type": "final", "args": ["Answer", {}]}}
        elif self.calls == 2:
            payload = {
                "completion": {
                    "type": "final",
                    "args": ["Answer", {"answer": self.raw_model_answer}],
                }
            }
        else:
            payload = {"answer": self.raw_model_answer}
        return {"content": json.dumps(payload)}


assistant = agent("question:string -> answer:string", {"contextFields": []})
stage_client = LiveAgentClient(client)
output = assistant.forward(
    stage_client,
    {"question": "In one sentence, explain what Ax helps developers build."},
)

print(json.dumps({"agentOutput": output, "rawModelAnswer": stage_client.raw_model_answer}, indent=2, sort_keys=True))
