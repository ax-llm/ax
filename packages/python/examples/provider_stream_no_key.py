from axllm import OpenAICompatibleClient


def scripted_transport(request):
    return {
        "status": 200,
        "body": (
            'data: {"id":"chatcmpl_stream","model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hel"}}]}' + "\n\n"
            'data: {"id":"chatcmpl_stream","model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}' + "\n\n"
            "data: [DONE]\n\n"
        ),
    }


client = OpenAICompatibleClient(api_key="test-key", model="gpt-4.1-mini", transport=scripted_transport)
events = list(client.stream({"chat_prompt": [{"role": "user", "content": "stream"}]}))
text = "".join((event["results"][0].get("content") or "") for event in events)
assert text == "hello", events
print("python-provider-stream-no-key", text)
