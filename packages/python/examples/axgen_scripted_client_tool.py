from axllm import ax, f, fn, run_control, set_caching_function


class ScriptedClient:
    def __init__(self):
        self.calls = 0

    def complete(self, request):
        self.calls += 1
        if self.calls == 1:
            return {
                "content": "",
                "function_calls": [
                    {"id": "call_1", "name": "search", "params": {"query": "ax docs"}}
                ],
            }
        return {"content": "Answer:  Found Ax docs "}


searches = []


def search_docs(args):
    searches.append(args)
    return {"title": "Ax docs"}


search = (
    fn("search")
    .description("Search docs")
    .arg("query", f.string().min(1))
    .handler(search_docs)
    .build()
)

qa = ax("query:string -> answer:string", {"functions": [search]})
qa.add_assert({"field": "answer", "contains": "Ax", "message": "answer should mention Ax"})
qa.add_field_transform("answer", "trim")
out = qa.forward(ScriptedClient(), {"query": "ax docs"})
assert out == {"answer": "Found Ax docs"}, out
# The tool ran once, with the model's arguments.
assert searches == [{"query": "ax docs"}], searches
assert qa.get_traces()[-1]["output"] == out

# A caching function reads with fn(key), which returns a stored output or
# None, and stores with fn(key, output). As in TypeScript, a hit sends no
# request and records no span or metric, and a streamed hit is one delta.
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


class CountingClient:
    def __init__(self):
        self.calls = 0
    def complete(self, request):
        self.calls += 1
        return {"content": "Answer: Paris"}


def memory_cache(store):
    def cache(key, output=None):
        if output is None:
            return store.get(key)
        store[key] = output
    return cache


store, tracer, meter, client = {}, Tracer(), Meter(), CountingClient()
cached = ax("question:string -> answer:string", {"caching_function": memory_cache(store)})
cached.set_tracer(tracer).set_meter(meter)
france = {"question": "Capital of France?"}
assert cached.forward(client, france) == {"answer": "Paris"}
assert client.calls == 1 and len(store) == 1, store
assert "ax_gen_forward" in tracer.spans and "ax_gen_generation_requests_total" in meter.recorded
spans, metrics = len(tracer.spans), len(meter.recorded)
assert cached.forward(client, france) == {"answer": "Paris"}
deltas = list(cached.streaming_forward(client, france, {"deltas": True}))
assert deltas == [{"version": 0, "index": 0, "delta": {"answer": "Paris"}}], deltas
assert client.calls == 1, "a cache hit sent a request"
assert tracer.spans[spans:] == [] and meter.recorded[metrics:] == [], (tracer.spans[spans:], meter.recorded[metrics:])
# The forward call's function comes before the constructor's, and
# set_caching_function covers programs that set none; a control skips it.
call_store = {}
cached.forward(client, france, {"cachingFunction": memory_cache(call_store)})
assert client.calls == 2 and len(call_store) == 1
global_store = {}
set_caching_function(memory_cache(global_store))
try:
    plain = ax("question:string -> answer:string")
    plain.forward(client, france)
    plain.forward(client, france)
    assert client.calls == 3 and len(global_store) == 1
    plain.forward(client, france, {"control": run_control()})
    assert client.calls == 4
finally:
    set_caching_function(None)
print("python-axgen-ok")
