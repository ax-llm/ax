// ax-example:start
// title: Portable Runtime Hooks
// group: generation
// description: Applies global and forward-scoped rate limiting, tracing, and metrics to AxGen, AxAgent, and AxFlow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 46
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{
    agent_with_options, ax, flow, set_meter, set_rate_limiter, set_tracer, AxCounter,
    AxError, AxGauge, AxHistogram, AxMeter, AxMetricInstrumentOptions, AxRateLimitInfo,
    AxRateLimiter, AxResult, AxRuntimeHooks, AxSpan, AxSpanStart, AxTracer,
    OpenAICompatibleClient,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fmt;
use std::sync::Arc;

struct LogSpan(String);
impl fmt::Debug for LogSpan { fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.debug_tuple("LogSpan").field(&self.0).finish() } }
impl AxSpan for LogSpan {
    fn add_event(&self, name: &str, _: &BTreeMap<String, Value>) { println!("[span:event] {} {}", self.0, name); }
    fn record_exception(&self, error: &AxError) { println!("[span:error] {} {}", self.0, error); }
    fn end(&self) { println!("[span:end] {}", self.0); }
}

struct LogTracer;
impl AxTracer for LogTracer {
    fn start_span(&self, start: AxSpanStart) -> Option<Arc<dyn AxSpan>> {
        println!("[span:start] {}", start.name);
        Some(Arc::new(LogSpan(start.name)))
    }
}

struct LogInstrument(String);
impl AxCounter for LogInstrument { fn add(&self, value: f64, _: &BTreeMap<String, Value>) { println!("[metric] {} += {}", self.0, value); } }
impl AxHistogram for LogInstrument { fn record(&self, value: f64, _: &BTreeMap<String, Value>) { println!("[metric] {} = {}", self.0, value); } }
impl AxGauge for LogInstrument { fn record(&self, value: f64, _: &BTreeMap<String, Value>) { println!("[metric] {} = {}", self.0, value); } }

struct LogMeter;
impl AxMeter for LogMeter {
    fn create_counter(&self, name: &str, _: &AxMetricInstrumentOptions) -> Option<Arc<dyn AxCounter>> { Some(Arc::new(LogInstrument(name.into()))) }
    fn create_histogram(&self, name: &str, _: &AxMetricInstrumentOptions) -> Option<Arc<dyn AxHistogram>> { Some(Arc::new(LogInstrument(name.into()))) }
    fn create_gauge(&self, name: &str, _: &AxMetricInstrumentOptions) -> Option<Arc<dyn AxGauge>> { Some(Arc::new(LogInstrument(name.into()))) }
}

fn limiter(label: &'static str) -> Arc<dyn AxRateLimiter> {
    Arc::new(move |next: &mut dyn FnMut() -> AxResult<Value>, info: &AxRateLimitInfo| {
        println!("[limit:{label}] {} {}/{} stream={}", info.operation, info.provider, info.model, info.streaming);
        next()
    })
}

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".into());
    let mut client = OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0}));
    let tracer: Arc<dyn AxTracer> = Arc::new(LogTracer);
    let meter: Arc<dyn AxMeter> = Arc::new(LogMeter);
    let override_hooks = AxRuntimeHooks { rate_limiter: Some(limiter("forward")), tracer: Some(Arc::clone(&tracer)), meter: Some(Arc::clone(&meter)) };

    set_rate_limiter(Some(limiter("global")));
    set_tracer(Some(Arc::clone(&tracer)));
    set_meter(Some(Arc::clone(&meter)));
    let result = (|| -> AxResult<()> {
        println!("{}", ax("topic:string -> summary:string")?.forward(&mut client, json!({"topic": "portable Ax runtime hooks"}))?);

        let mut helper = agent_with_options("question:string -> answer:string", json!({}))?
            .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;
        println!("{}", helper.forward_with_hooks(&mut client, json!({"question": "What does a rate limiter wrap?"}), json!({"max_actor_steps": 12}), override_hooks.clone())?);

        let mut workflow = flow("examples.runtimeHooks")
            .execute("outline", ax("topic:string -> outline:string")?)
            .execute("polish", ax("outline:string -> answer:string")?)
            .returns(json!({"answer": "polish"}));
        println!("{}", workflow.forward_with_hooks(&mut client, json!({"topic": "Ax runtime hooks"}), Value::Null, override_hooks)?);
        Ok(())
    })();
    set_rate_limiter(None);
    set_tracer(None);
    set_meter(None);
    result
}
