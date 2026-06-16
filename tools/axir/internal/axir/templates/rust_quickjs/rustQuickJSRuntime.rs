use crate::{AxCodeRuntime, AxCodeSession, AxError, AxResult, RuntimeEnvelope};
use rquickjs::{Context, Function, Runtime};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

pub type HostCallable = Arc<dyn Fn(Value) -> AxResult<Value> + Send + Sync + 'static>;

#[derive(Clone)]
pub struct QuickJsCodeRuntime {
    runtime_policy: Value,
    host_callables: BTreeMap<String, HostCallable>,
}

pub struct QuickJsCodeSession {
    runtime: Runtime,
    context: Context,
    runtime_policy: Value,
    reserved: BTreeSet<String>,
    host_callables: BTreeMap<String, HostCallable>,
    closed: bool,
}

impl Default for QuickJsCodeRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl QuickJsCodeRuntime {
    pub fn new() -> Self {
        Self {
            runtime_policy: default_runtime_policy(),
            host_callables: BTreeMap::new(),
        }
    }

    pub fn with_runtime_policy(mut self, policy: Value) -> Self {
        merge_object(&mut self.runtime_policy, policy);
        self
    }

    pub fn runtime_policy(&self) -> &Value {
        &self.runtime_policy
    }

    pub fn register_callable<F>(&mut self, name: impl Into<String>, callable: F) -> AxResult<()>
    where
        F: Fn(Value) -> AxResult<Value> + Send + Sync + 'static,
    {
        let name = name.into();
        if is_reserved_name(&name) {
            return Err(AxError::runtime(format!(
                "QuickJS host callable conflicts with reserved runtime name: {name}"
            )));
        }
        self.host_callables.insert(name, Arc::new(callable));
        Ok(())
    }

    pub fn with_callable<F>(mut self, name: impl Into<String>, callable: F) -> AxResult<Self>
    where
        F: Fn(Value) -> AxResult<Value> + Send + Sync + 'static,
    {
        self.register_callable(name, callable)?;
        Ok(self)
    }
}

impl AxCodeRuntime for QuickJsCodeRuntime {
    fn language(&self) -> &str {
        "JavaScript"
    }

    fn usage_instructions(&self) -> &str {
        "JavaScript QuickJS runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), reportFailure(...), and guideAgent(...). Filesystem, network, process, module loading, and native host objects are not exposed by default."
    }

    fn create_session(&mut self, globals: Value, options: Value) -> AxResult<Box<dyn AxCodeSession>> {
        Ok(Box::new(QuickJsCodeSession::new(
            globals,
            options,
            self.runtime_policy.clone(),
            self.host_callables.clone(),
        )?))
    }
}

impl QuickJsCodeSession {
    fn new(
        globals: Value,
        options: Value,
        runtime_policy: Value,
        host_callables: BTreeMap<String, HostCallable>,
    ) -> AxResult<Self> {
        let runtime = Runtime::new().map_err(qjs_error)?;
        if let Some(limit) = runtime_policy
            .get("memoryLimitBytes")
            .and_then(Value::as_u64)
            .filter(|limit| *limit > 0)
        {
            runtime.set_memory_limit(limit as usize);
        }
        let context = Context::full(&runtime).map_err(qjs_error)?;
        let mut reserved = reserved_names_from_options(&options);
        for name in host_callables.keys() {
            if reserved.contains(name) || is_reserved_name(name) {
                return Err(AxError::runtime(format!(
                    "QuickJS host callable conflicts with reserved runtime name: {name}"
                )));
            }
            reserved.insert(name.clone());
        }
        let mut session = Self {
            runtime,
            context,
            runtime_policy,
            reserved,
            host_callables,
            closed: false,
        };
        session.bootstrap()?;
        session.install_initial_globals(globals)?;
        Ok(session)
    }

    fn bootstrap(&mut self) -> AxResult<()> {
        let callables = self.host_callables.clone();
        self.context.with(|ctx| -> AxResult<()> {
            let host_call = Function::new(ctx.clone(), move |name: String, params_json: String| -> String {
                let params = serde_json::from_str::<Value>(&params_json).unwrap_or(Value::Null);
                let response = match callables.get(&name) {
                    Some(callable) => match callable(params) {
                        Ok(result) => json!({"ok": true, "result": result}),
                        Err(err) => json!({"ok": false, "category": err.category, "error": err.message}),
                    },
                    None => json!({
                        "ok": false,
                        "category": "runtime",
                        "error": format!("host callable not registered: {name}")
                    }),
                };
                serde_json::to_string(&response).unwrap_or_else(|error| {
                    json!({"ok": false, "category": "runtime", "error": error.to_string()}).to_string()
                })
            })
            .map_err(qjs_error)?;
            ctx.globals()
                .set("__ax_host_call", host_call)
                .map_err(qjs_error)?;
            ctx.eval::<(), _>(QUICKJS_BOOTSTRAP).map_err(qjs_error)?;
            Ok(())
        })?;
        self.set_global_json("__ax_session_reserved", &reserved_names_value(&self.reserved))?;
        Ok(())
    }

    fn install_initial_globals(&mut self, globals: Value) -> AxResult<()> {
        if let Some(obj) = globals.as_object() {
            for (name, value) in obj {
                if name.starts_with("__ax_") || is_builtin_reserved_name(name) {
                    continue;
                }
                self.set_global_json(name, value)?;
            }
        }
        for name in self.host_callables.keys().cloned().collect::<Vec<_>>() {
            self.set_global_json(&name, &json!({"__ax_host_callable": true, "native": true}))?;
        }
        self.install_host_callables()
    }

    fn install_host_callables(&mut self) -> AxResult<()> {
        self.context.with(|ctx| {
            ctx.eval::<(), _>("__ax_install_host_callables()")
                .map_err(qjs_error)
        })
    }

    fn set_global_json(&mut self, name: &str, value: &Value) -> AxResult<()> {
        let name_json = serde_json::to_string(name)?;
        let value_json = serde_json::to_string(value)?;
        let value_json_literal = serde_json::to_string(&value_json)?;
        let source = format!("globalThis[{name_json}] = JSON.parse({value_json_literal});");
        self.context.with(|ctx| ctx.eval::<(), _>(source).map_err(qjs_error))
    }

    fn eval_json_string(&mut self, source: String) -> AxResult<String> {
        self.context
            .with(|ctx| ctx.eval::<String, _>(source).map_err(qjs_error))
    }

    fn snapshot_bindings(&mut self, apply_limit: bool) -> AxResult<Value> {
        let text = self.eval_json_string("__ax_snapshot_json()".to_string())?;
        let bindings: Value = serde_json::from_str(&text)?;
        if apply_limit {
            Ok(limit_snapshot(bindings, int_option(&self.runtime_policy, "maxSnapshotBytes", 262_144)))
        } else {
            Ok(bindings)
        }
    }
}

impl AxCodeSession for QuickJsCodeSession {
    fn execute(&mut self, code: &str, options: Value) -> AxResult<RuntimeEnvelope> {
        if self.closed {
            return Ok(error_envelope("session closed", "session_closed"));
        }
        let timeout_ms = int_option(
            &options,
            "timeoutMs",
            int_option(&self.runtime_policy, "timeoutMs", 5_000),
        );
        let timed_out = Arc::new(AtomicBool::new(false));
        if timeout_ms > 0 {
            let flag = timed_out.clone();
            let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
            self.runtime.set_interrupt_handler(Some(Box::new(move || {
                if Instant::now() >= deadline {
                    flag.store(true, Ordering::SeqCst);
                    return true;
                }
                false
            })));
        }
        // The RLM prompt has the model write `await final(...)` / `await llmQuery(...)`, so actor
        // code uses top-level await — illegal in a plain script eval. Compile it as an async
        // function (AsyncFunction constructor) so await is legal; the synchronous host primitives
        // that set the completion run before the first await suspends, so it is captured here.
        let body_literal = serde_json::to_string(&format!("with (globalThis) {{\n{code}\n}}"))?;
        let source = format!(
            "globalThis.__ax_completion = undefined; __ax_install_host_callables(); (async function(){{}}).constructor({body_literal})(); JSON.stringify(globalThis.__ax_completion === undefined ? {{kind: 'result', result: null}} : globalThis.__ax_completion);"
        );
        let result = self.eval_json_string(source);
        self.runtime.set_interrupt_handler(None);
        match result {
            Ok(text) => {
                let payload: Value = serde_json::from_str(&text).map_err(|error| {
                    AxError::runtime(format!("malformed QuickJS actor output: {error}"))
                })?;
                Ok(RuntimeEnvelope { payload })
            }
            Err(error) if timed_out.load(Ordering::SeqCst) => {
                Ok(error_envelope("QuickJS execution timed out", "timeout"))
            }
            Err(error) => Ok(error_envelope(error.message, "runtime")),
        }
    }

    fn inspect_globals(&mut self, _options: Value) -> AxResult<Value> {
        if self.closed {
            return Ok(error_envelope("session closed", "session_closed").payload);
        }
        self.snapshot_bindings(false)
    }

    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        if self.closed {
            return Ok(error_envelope("session closed", "session_closed").payload);
        }
        let bindings = self.snapshot_bindings(true)?;
        Ok(json!({
            "version": 1,
            "bindings": bindings,
            "globals": bindings,
            "closed": false
        }))
    }

    fn patch_globals(&mut self, snapshot: Value, _options: Value) -> AxResult<Value> {
        if self.closed {
            return Ok(error_envelope("session closed", "session_closed").payload);
        }
        let bindings = snapshot
            .get("bindings")
            .or_else(|| snapshot.get("globals"))
            .cloned()
            .unwrap_or(snapshot);
        self.context.with(|ctx| {
            ctx.eval::<(), _>("__ax_clear_user_globals()")
                .map_err(qjs_error)
        })?;
        if let Some(obj) = bindings.as_object() {
            for (name, value) in obj {
                if name.starts_with("__ax_")
                    || self.reserved.contains(name)
                    || is_builtin_reserved_name(name)
                    || is_host_callable_marker(value)
                {
                    continue;
                }
                self.set_global_json(name, value)?;
            }
        }
        self.install_host_callables()?;
        self.snapshot_globals(json!({}))
    }

    fn close(&mut self) -> AxResult<Value> {
        self.closed = true;
        Ok(json!({"closed": true}))
    }
}

fn default_runtime_policy() -> Value {
    json!({
        "timeoutMs": 5000,
        "memoryLimitBytes": 0,
        "maxSnapshotBytes": 262144,
        "allowFilesystem": false,
        "allowNetwork": false,
        "allowProcess": false,
        "allowNativeHostAccess": false
    })
}

fn merge_object(base: &mut Value, patch: Value) {
    if let (Some(base), Some(patch)) = (base.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            base.insert(key.clone(), value.clone());
        }
    }
}

fn reserved_names_from_options(options: &Value) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    if let Some(items) = options.get("reservedNames").and_then(Value::as_array) {
        for item in items {
            if let Some(name) = item.as_str() {
                names.insert(name.to_string());
            }
        }
    }
    names
}

fn reserved_names_value(names: &BTreeSet<String>) -> Value {
    Value::Array(names.iter().cloned().map(Value::String).collect())
}

fn int_option(value: &Value, key: &str, fallback: i64) -> i64 {
    value
        .get(key)
        .and_then(Value::as_i64)
        .or_else(|| value.get(snake_case(key)).and_then(Value::as_i64))
        .unwrap_or(fallback)
}

fn snake_case(key: &str) -> String {
    let mut out = String::new();
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn limit_snapshot(bindings: Value, max_bytes: i64) -> Value {
    if max_bytes <= 0 {
        return bindings;
    }
    let encoded = serde_json::to_vec(&bindings).unwrap_or_default();
    if encoded.len() <= max_bytes as usize {
        return bindings;
    }
    let Some(obj) = bindings.as_object() else {
        return bindings;
    };
    let mut keys = obj.keys().cloned().collect::<Vec<_>>();
    keys.sort();
    let mut trimmed = Map::new();
    for key in keys {
        if let Some(value) = obj.get(&key) {
            trimmed.insert(key.clone(), value.clone());
            let data = serde_json::to_vec(&Value::Object(trimmed.clone())).unwrap_or_default();
            if data.len() > max_bytes as usize {
                trimmed.remove(&key);
                trimmed.insert("__ax_snapshot_truncated".to_string(), Value::Bool(true));
                break;
            }
        }
    }
    Value::Object(trimmed)
}

fn error_envelope(message: impl Into<String>, category: impl Into<String>) -> RuntimeEnvelope {
    RuntimeEnvelope {
        payload: json!({
            "kind": "error",
            "is_error": true,
            "error_category": category.into(),
            "error": message.into()
        }),
    }
}

fn qjs_error(error: rquickjs::Error) -> AxError {
    AxError::runtime(error.to_string())
}

fn is_host_callable_marker(value: &Value) -> bool {
    value
        .get("__ax_host_callable")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || value.get("native").and_then(Value::as_bool).unwrap_or(false)
}

fn is_reserved_name(name: &str) -> bool {
    name.starts_with("__ax_") || is_builtin_reserved_name(name)
}

fn is_builtin_reserved_name(name: &str) -> bool {
    matches!(
        name,
        "Object"
            | "Function"
            | "Array"
            | "Number"
            | "parseFloat"
            | "parseInt"
            | "Infinity"
            | "NaN"
            | "undefined"
            | "Boolean"
            | "String"
            | "Symbol"
            | "Date"
            | "Promise"
            | "RegExp"
            | "Error"
            | "AggregateError"
            | "EvalError"
            | "RangeError"
            | "ReferenceError"
            | "SyntaxError"
            | "TypeError"
            | "URIError"
            | "globalThis"
            | "JSON"
            | "Math"
            | "Reflect"
            | "Proxy"
            | "eval"
            | "isFinite"
            | "isNaN"
            | "decodeURI"
            | "decodeURIComponent"
            | "encodeURI"
            | "encodeURIComponent"
            | "console"
            | "final"
            | "askClarification"
            | "discover"
            | "recall"
            | "used"
            | "reportSuccess"
            | "reportFailure"
            | "guideAgent"
            | "fetch"
            | "require"
            | "process"
            | "module"
            | "exports"
            | "prototype"
            | "__proto__"
            | "constructor"
    )
}

const QUICKJS_BOOTSTRAP: &str = r#"
const __ax_builtin_reserved = [
  "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
  "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
  "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
  "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
  "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
  "console", "final", "askClarification", "discover", "recall", "used", "reportSuccess",
  "reportFailure", "guideAgent", "fetch", "require", "process", "module", "exports",
  "prototype", "__proto__", "constructor"
];
function __ax_has_name(values, name) {
  if (!Array.isArray(values)) return false;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === name) return true;
  }
  return false;
}
function __ax_complete(value) { globalThis.__ax_completion = value; return value; }
function __ax_clone_json(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
function __ax_make_host_callable(name, spec) {
  return function(params) {
    if (spec && spec.native === true) {
      const response = JSON.parse(globalThis.__ax_host_call(name, JSON.stringify(params === undefined ? null : params)));
      if (response.ok) return response.result;
      return {
        kind: "error",
        is_error: true,
        error_category: String(response.category || "runtime"),
        error: String(response.error || ("host callable failed: " + name))
      };
    }
    if (spec && spec.error) {
      return {
        kind: "error",
        is_error: true,
        error_category: String(spec.error.category || "runtime"),
        error: String(spec.error.message || spec.error.error || ("host callable failed: " + name))
      };
    }
    if (spec && Object.prototype.hasOwnProperty.call(spec, "result")) return __ax_clone_json(spec.result);
    return { kind: "result", result: null };
  };
}
function __ax_install_host_callables() {
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    const value = globalThis[key];
    if (value && typeof value === "object" && value.__ax_host_callable === true) {
      globalThis[key] = __ax_make_host_callable(key, value);
    }
  }
}
function final() { return __ax_complete({ type: "final", kind: "final", completion_payload: { args: Array.from(arguments) }, args: Array.from(arguments) }); }
function askClarification() { return __ax_complete({ type: "askClarification", args: Array.from(arguments) }); }
function discover(request) { return __ax_complete({ kind: "discover", discover: request }); }
function recall(request) { return __ax_complete({ kind: "recall", recall: request }); }
function used(idOrRequest, reason) {
  const payload = (idOrRequest && typeof idOrRequest === "object") ? idOrRequest : { id: idOrRequest };
  if (reason !== undefined && reason !== null) payload.reason = String(reason);
  return __ax_complete({ kind: "used", used: payload });
}
function reportSuccess(message) { return __ax_complete({ kind: "status", status: { type: "success", message: String(message || "") } }); }
function reportFailure(message) { return __ax_complete({ kind: "status", status: { type: "failed", message: String(message || "") } }); }
function guideAgent(guidance) { return __ax_complete({ type: "guide_agent", guidance: String(guidance || "") }); }
function __ax_snapshot_json() {
  const out = {};
  const sessionReserved = Array.isArray(globalThis.__ax_session_reserved) ? globalThis.__ax_session_reserved : [];
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    if (__ax_has_name(__ax_builtin_reserved, key) || __ax_has_name(sessionReserved, key)) continue;
    const value = globalThis[key];
    if (typeof value === "function" || typeof value === "undefined") continue;
    try { JSON.stringify(value); out[key] = value; } catch (_) {}
  }
  return JSON.stringify(out);
}
function __ax_clear_user_globals() {
  const sessionReserved = Array.isArray(globalThis.__ax_session_reserved) ? globalThis.__ax_session_reserved : [];
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    if (__ax_has_name(__ax_builtin_reserved, key) || __ax_has_name(sessionReserved, key)) continue;
    try { delete globalThis[key]; } catch (_) {}
  }
}
"#;
