from axllm import AxRuntimeHooks, ai, agent, ax, flow, set_meter, set_rate_limiter, set_tracer

calls = []
def limiter(next_request, info):
    calls.append((info.operation, info.provider))
    return next_request()

def transport(_request):
    return {"status": 200, "json": {"model": "gpt-5.4-mini", "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]}}

service = ai("openai", model="gpt-5.4-mini", api_key="test", transport=transport)
set_rate_limiter(limiter)
try:
    service.chat({"chat_prompt": [{"role": "user", "content": "hello"}]})
    hooks = AxRuntimeHooks(limiter, None, None)
    ax("input:string -> output:string", hooks=hooks).set_tracer(None).set_meter(None)
    agent("input:string -> output:string", hooks=hooks).set_tracer(None).set_meter(None)
    flow({"id": "runtime-hooks"}, hooks=hooks).set_tracer(None).set_meter(None)
finally:
    set_rate_limiter(None); set_tracer(None); set_meter(None)
assert calls == [("chat", "openai")], calls
print("python-runtime-hooks-no-key-ok")
