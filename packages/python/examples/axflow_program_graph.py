from axllm import ax, flow


class ScriptedClient:
    def __init__(self):
        self.calls = 0

    def complete(self, request):
        self.calls += 1
        return {"content": "Answer: Paris"}


qa = ax("question:string -> answer:string")
program = flow({"id": "example.flow"}).execute("qa", qa).returns({"answer": "answer"})
out = program.forward(ScriptedClient(), {"question": "Capital of France?"})
assert out == {"answer": "Paris"}, out
assert program.get_plan()["steps"][0]["name"] == "qa"


# A caching function on the forward call caches the flow's output (and its
# AxGen nodes' outputs). As in TypeScript, a flow hit runs no node and records
# no span or metric.
class Span:
    def __init__(self, name, ended):
        self.name, self.ended = name, ended
    def set_attributes(self, attributes): pass
    def add_event(self, name, attributes=None): pass
    def record_exception(self, error): pass
    def set_status(self, status, description=None): pass
    def end(self): self.ended.append(self.name)


class Tracer:
    def __init__(self):
        self.spans = []
    def start_span(self, name, *, kind="internal", attributes=None, parent=None):
        return Span(name, self.spans)


class Meter:
    def __init__(self):
        self.recorded = []
    def instrument(self, name, **options):
        recorded = self.recorded
        class Instrument:
            def add(self, value, attributes=None): recorded.append(name)
            def record(self, value, attributes=None): recorded.append(name)
        return Instrument()
    create_counter = create_histogram = create_gauge = instrument


store = {}
def cache(key, output=None):
    if output is None:
        return store.get(key)
    store[key] = output


tracer, meter, client = Tracer(), Meter(), ScriptedClient()
program.set_tracer(tracer).set_meter(meter)
france = {"question": "Capital of France?"}
assert program.forward(client, france, {"caching_function": cache}) == {"answer": "Paris"}
assert client.calls == 1 and len(store) == 2, store
assert "ax_gen_flow_forward" in tracer.spans
spans, metrics = len(tracer.spans), len(meter.recorded)
assert program.forward(client, france, {"caching_function": cache}) == {"answer": "Paris"}
assert client.calls == 1, "a flow cache hit ran its nodes"
assert tracer.spans[spans:] == [] and meter.recorded[metrics:] == [], (tracer.spans[spans:], meter.recorded[metrics:])
print("python-axflow-ok")
