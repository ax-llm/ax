from axllm import ai


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


service = ai("openai", model="gpt-5.4-mini", api_key="test-key", transport=scripted_transport)
response = service.chat({"chat_prompt": [{"role": "user", "content": "hello"}]})
assert response["results"][0]["content"] == "hello from scripted transport", response
print("python-axai-ok")
