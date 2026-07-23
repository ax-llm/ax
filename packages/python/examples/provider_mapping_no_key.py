from axllm import ai, set_usage_observer


def scripted_transport(request):
    return {
        "status": 200,
        "json": {
            "id": "chatcmpl_example",
            "model": "gpt-5.4-mini",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"content": "hello from scripted transport"},
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        },
    }


events = []
set_usage_observer(events.append)
service = ai(
    "openai",
    model="gpt-5.4-mini",
    api_key="test-key",
    transport=scripted_transport,
    usage_context={"tenantId": "tenant-1", "feature": "no-key-example"},
)
response = service.chat(
    {"chat_prompt": [{"role": "user", "content": "hello"}]},
    {"usageContext": {"userId": "user-1", "requestId": "request-1"}},
)
set_usage_observer(None)
assert response["results"][0]["content"] == "hello from scripted transport", response
assert len(events) == 1, events
assert events[0]["context"] == {
    "tenantId": "tenant-1",
    "feature": "no-key-example",
    "userId": "user-1",
    "requestId": "request-1",
}, events
print("python-axai-ok")
