from axllm import AxAIServiceNetworkError, OpenAICompatibleClient, set_usage_observer


def scripted_transport(request):
    return {
        "status": 200,
        "body": (
            'data: {"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"hel"}}]}' + "\n\n"
            'data: {"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}' + "\n\n"
            'data: {"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}' + "\n\n"
            "data: [DONE]\n\n"
        ),
    }


client = OpenAICompatibleClient(api_key="test-key", model="gpt-5.4-mini", transport=scripted_transport)
usage_events = []
set_usage_observer(usage_events.append)
events = list(client.stream({"chat_prompt": [{"role": "user", "content": "stream"}]}))
set_usage_observer(None)
text = "".join((result.get("content") or "") for event in events for result in event["results"][:1])
assert text == "hello", events
assert len(usage_events) == 1, usage_events

closed = False
def incremental_transport(request):
    body = (
        'data: {"id":"chatcmpl_cancel","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"first 🌍"}}]}\r\n\r\n'
        'data: {"id":"chatcmpl_cancel","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"second"}}]}\r\n\r\n'
    ).encode()
    def chunks():
        global closed
        try:
            for byte in body:
                yield bytes([byte])
        finally:
            closed = True
    return chunks()

cancel_client = OpenAICompatibleClient(api_key="test-key", model="gpt-5.4-mini", transport=incremental_transport)
cancel_stream = cancel_client.stream({"chat_prompt": [{"role": "user", "content": "cancel"}]})
assert next(cancel_stream)["results"][0]["content"] == "first 🌍"
cancel_stream.close()
assert closed, "consumer cancellation did not close the upstream stream"

attempts = 0
def failing_transport(request):
    global attempts
    attempts += 1
    def chunks():
        yield b'data: {"id":"chatcmpl_failure","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"delivered"}}]}\n\n'
        raise AxAIServiceNetworkError("upstream closed", retryable=True)
    return chunks()

failure_client = OpenAICompatibleClient(api_key="test-key", model="gpt-5.4-mini", transport=failing_transport)
failure_stream = failure_client.stream({"chat_prompt": [{"role": "user", "content": "fail"}]})
assert next(failure_stream)["results"][0]["content"] == "delivered"
try:
    next(failure_stream)
    raise AssertionError("mid-stream failure was not surfaced")
except AxAIServiceNetworkError:
    pass
assert attempts == 1, "mid-stream failure replayed the request"
print("python-provider-stream-no-key", text)
