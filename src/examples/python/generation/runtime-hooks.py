# ax-example:start
# title: Portable Runtime Hooks
# group: generation
# description: Applies global and forward-scoped rate limiting, tracing, and metrics to AxGen, AxAgent, and AxFlow.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 46
# ax-example:end
import os

from axllm import (
    AxRuntimeHooks,
    OpenAICompatibleClient,
    agent,
    ax,
    flow,
    set_meter,
    set_rate_limiter,
    set_tracer,
)
from axllm.runtime_quickjs import AxQuickJsCodeRuntime


class Span:
    def __init__(self, name):
        self.name = name
        print(f"[span:start] {name}")

    def set_attributes(self, attributes): pass
    def add_event(self, name, attributes=None): print(f"[span:event] {self.name} {name}")
    def record_exception(self, error): print(f"[span:error] {self.name} {error}")
    def set_status(self, status, description=None): pass
    def end(self): print(f"[span:end] {self.name}")


class Tracer:
    def start_span(self, start):
        return Span(start.name)


class Instrument:
    def __init__(self, name): self.name = name
    def add(self, value, attributes=None): print(f"[metric] {self.name} += {value}")
    def record(self, value, attributes=None): print(f"[metric] {self.name} = {value}")


class Meter:
    def create_counter(self, name, options=None): return Instrument(name)
    def create_histogram(self, name, options=None): return Instrument(name)
    def create_gauge(self, name, options=None): return Instrument(name)


def limiter(label):
    def run(next_request, info):
        print(f"[limit:{label}] {info.operation} {info.provider}/{info.model} stream={info.streaming}")
        return next_request()
    return run


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)
tracer = Tracer()
meter = Meter()
override_hooks = AxRuntimeHooks(limiter("forward"), tracer, meter)

set_rate_limiter(limiter("global"))
set_tracer(tracer)
set_meter(meter)
try:
    print(ax("topic:string -> summary:string").forward(client, {"topic": "portable Ax runtime hooks"}))
    print(agent("question:string -> answer:string").forward(
        client,
        {"question": "What does a rate limiter wrap?"},
        {"runtime": AxQuickJsCodeRuntime(), "max_actor_steps": 12},
        override_hooks,
    ))
    workflow = flow({"id": "examples.runtimeHooks"}).execute(
        "outline", ax("topic:string -> outline:string")
    ).execute("polish", ax("outline:string -> answer:string")).returns({"answer": "polish"})
    print(workflow.forward(client, {"topic": "Ax runtime hooks"}, hooks=override_hooks))
finally:
    set_rate_limiter(None)
    set_tracer(None)
    set_meter(None)
