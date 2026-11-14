# ax-example:start
# title: Python Anthropic Document Citations
# group: generation
# description: Preserve source locations and output passages through ordinary and streaming generation.
# provider: anthropic
# env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
# level: intermediate
# order: 48
# ax-example:end
import json
import os
from axllm import ai, ax

key = os.getenv("ANTHROPIC_API_KEY") or os.environ["ANTHROPIC_APIKEY"]
client = ai("anthropic", api_key=key, model="claude-haiku-5-5")
for stream in (False, True):
    program = ax('doc:file -> answer:string "State the opening year and closed day, citing the supplied document."')
    answer = program.forward(client, {"doc": {
        "source": {"type": "text", "data": 'The museum opened in 1984. It is closed on Mondays.'},
        "title": "Museum notes", "citations": {"enabled": True},
    }}, {"stream": stream})
    log = program.get_chat_log()
    print(json.dumps({"stream": stream, "answer": answer, "text_blocks": log[-1]["text_blocks"]}, indent=2))
