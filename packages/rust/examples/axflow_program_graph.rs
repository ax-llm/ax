use axllm::{
    ax, flow, AxAIClient, AxCachingFunction, AxCounter, AxGauge, AxHistogram, AxMeter,
    AxMetricInstrumentOptions, AxResult, AxSpan, AxSpanStart, AxTracer,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

struct ScriptedClient {
    calls: usize,
}

impl AxAIClient for ScriptedClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        self.calls += 1;
        Ok(json!({"results": [{"content": "Answer: Paris", "function_calls": []}]}))
    }
}

// Records the name of each span started and each metric recorded.
#[derive(Debug)]
struct Span;

impl AxSpan for Span {}

struct Recorder(Arc<Mutex<Vec<String>>>);

impl Recorder {
    fn instrument(&self, name: &str) -> Arc<Instrument> {
        Arc::new(Instrument(self.0.clone(), name.to_string()))
    }
}

impl AxTracer for Recorder {
    fn start_span(&self, start: AxSpanStart) -> Option<Arc<dyn AxSpan>> {
        self.0.lock().unwrap().push(start.name);
        Some(Arc::new(Span))
    }
}

impl AxMeter for Recorder {
    fn create_counter(
        &self,
        name: &str,
        _options: &AxMetricInstrumentOptions,
    ) -> Option<Arc<dyn AxCounter>> {
        Some(self.instrument(name))
    }
    fn create_histogram(
        &self,
        name: &str,
        _options: &AxMetricInstrumentOptions,
    ) -> Option<Arc<dyn AxHistogram>> {
        Some(self.instrument(name))
    }
    fn create_gauge(
        &self,
        name: &str,
        _options: &AxMetricInstrumentOptions,
    ) -> Option<Arc<dyn AxGauge>> {
        Some(self.instrument(name))
    }
}

struct Instrument(Arc<Mutex<Vec<String>>>, String);

impl AxCounter for Instrument {
    fn add(&self, _value: f64, _attributes: &BTreeMap<String, Value>) {
        self.0.lock().unwrap().push(self.1.clone());
    }
}

impl AxHistogram for Instrument {
    fn record(&self, _value: f64, _attributes: &BTreeMap<String, Value>) {
        self.0.lock().unwrap().push(self.1.clone());
    }
}

impl AxGauge for Instrument {
    fn record(&self, _value: f64, _attributes: &BTreeMap<String, Value>) {
        self.0.lock().unwrap().push(self.1.clone());
    }
}

fn main() -> AxResult<()> {
    let qa = ax("question:string -> answer:string")?;
    let mut program = flow("example.flow")
        .execute("qa", qa)
        .returns(json!({"answer": "answer"}));
    let mut client = ScriptedClient { calls: 0 };
    let output = program.forward(&mut client, json!({"question": "Capital of France?"}))?;
    assert_eq!(output["answer"], "Paris");

    // A caching function on the forward call caches the flow's output (and
    // its AxGen nodes' outputs). As in TypeScript, a flow hit runs no node
    // and records no span or metric.
    let store = Arc::new(Mutex::new(BTreeMap::new()));
    let entries = store.clone();
    let cache: AxCachingFunction = Arc::new(move |key: &str, output: Option<&Value>| {
        let mut entries = entries.lock().unwrap();
        Ok(match output {
            Some(output) => {
                entries.insert(key.to_string(), output.clone());
                None
            }
            None => entries.get(key).cloned(),
        })
    });
    let telemetry = Arc::new(Mutex::new(Vec::new()));
    program
        .set_tracer(Some(Arc::new(Recorder(telemetry.clone()))))
        .set_meter(Some(Arc::new(Recorder(telemetry.clone()))));
    let france = json!({"question": "Capital of France?"});
    let cached = program.forward_with_caching_function(
        &mut client,
        france.clone(),
        json!({}),
        cache.clone(),
    )?;
    assert_eq!(cached, json!({"answer": "Paris"}));
    assert_eq!((client.calls, store.lock().unwrap().len()), (2, 2));
    assert!(telemetry
        .lock()
        .unwrap()
        .iter()
        .any(|name| name == "ax_gen_flow_forward"));
    let recorded = telemetry.lock().unwrap().len();
    assert_eq!(
        program.forward_with_caching_function(&mut client, france, json!({}), cache)?,
        cached
    );
    assert_eq!(client.calls, 2, "a flow cache hit ran its nodes");
    let after_hit = telemetry.lock().unwrap()[recorded..].to_vec();
    assert!(
        after_hit.is_empty(),
        "a flow cache hit recorded {after_hit:?}"
    );
    println!("rust-axflow-ok");
    Ok(())
}
