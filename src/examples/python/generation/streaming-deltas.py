# ax-example:start
# title: Python Streaming Field Deltas
# group: generation
# description: Streams AxGen output as TypeScript-style {version, index, delta} field deltas and merges them as they arrive.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 46
# ax-example:end
import os

from axllm import ai, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
)
story = ax('topic:string -> title:string, story:string "Three short sentences"')

# Each delta holds the new text of one field. Merge a sample's deltas (strings
# and lists append, other values replace) and start over when the version
# changes: a retry or a replaced step starts a new version.
merged, version = {}, 0
for delta in story.streaming_forward(client, {"topic": "a lighthouse keeper's cat"}, {"deltas": True}):
    if delta["version"] != version:
        merged, version = {}, delta["version"]
        print("\n[retry: starting over]")
    for field, value in delta["delta"].items():
        merged[field] = merged.get(field, "") + value if isinstance(value, str) else value
        if field == "story":
            print(value, end="", flush=True)
print()
print(f"Title: {merged.get('title')}")
