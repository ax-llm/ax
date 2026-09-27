use crate::{AxCodeRuntime, AxCodeSession, AxError, AxResult, RuntimeEnvelope};
use rquickjs::{Context, Function, Runtime};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

// Alias the shared core type so the agent wrapper can register callables
// (e.g. llmQuery) through the AxCodeRuntime::register_host_callable seam.
pub type HostCallable = crate::AxHostCallable;

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
    // The globals present before the agent's code ran; the snapshot entries
    // leave them out, as TS's AxJSRuntime does.
    baseline: Vec<String>,
}

// TypeScript's AxJSRuntime.getUsageInstructions() in its default stdout mode.
const USAGE_INSTRUCTIONS: &str = "- Don't wrap async code in (async()=>{ ... })() \u{2014} the runtime automatically handles async execution.\n- State is session-scoped: all top-level declarations (`var`, `let`, `const`) persist across calls.\n- Bare assignment (e.g. `x = 1`) also persists via `globalThis`.\n- Use `console.log(...)` output is captured as the execution result so use it to inspect intermediate values between steps instead of `return`.";

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
        USAGE_INSTRUCTIONS
    }

    fn create_session(
        &mut self,
        globals: Value,
        options: Value,
    ) -> AxResult<Box<dyn AxCodeSession>> {
        Ok(Box::new(QuickJsCodeSession::new(
            globals,
            options,
            self.runtime_policy.clone(),
            self.host_callables.clone(),
        )?))
    }

    fn register_host_callable(
        &mut self,
        name: &str,
        callable: crate::AxHostCallable,
    ) -> AxResult<()> {
        if is_reserved_name(name) {
            return Err(AxError::runtime(format!(
                "QuickJS host callable conflicts with reserved runtime name: {name}"
            )));
        }
        self.host_callables.insert(name.to_string(), callable);
        Ok(())
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
            // Only reject names the runtime itself installs (JS built-ins and
            // bootstrap primitives like final). Agent-declared reserved names
            // (e.g. llmQuery) are *meant* to be host-provided, so a host
            // callable claiming one is the provisioning mechanism, not a
            // conflict — mirroring the Python reference runtime.
            if is_reserved_name(name) {
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
            baseline: Vec::new(),
        };
        session.bootstrap()?;
        session.install_initial_globals(globals)?;
        let names = session.eval_json_string(
            "JSON.stringify(Object.getOwnPropertyNames(globalThis))".to_string(),
        )?;
        session.baseline = serde_json::from_str(&names).unwrap_or_default();
        Ok(session)
    }

    // TS's analysis of a turn's code: the top-level variables it writes and
    // reads, and its qualified calls.
    fn code_analysis(&mut self, code: &str) -> Option<Value> {
        let code_literal = serde_json::to_string(code).ok()?;
        let text = self
            .eval_json_string(format!("__ax_analyze_code({code_literal})"))
            .ok()?;
        serde_json::from_str(&text).ok()
    }

    fn execute_turn(&mut self, code: &str, options: Value) -> AxResult<RuntimeEnvelope> {
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
        // function (AsyncFunction constructor) so await is legal. A synchronous `throw` inside an
        // async function becomes a *rejected promise*, so attach a rejection handler that records
        // __ax_error and drain the job queue before reading the completion; otherwise the throw's
        // error_category would be silently swallowed. The synchronous host primitives that set the
        // completion run before the first await suspends, so the completion is captured too.
        // Persistence: top-level const/let/var declared this turn are block-scoped to the
        // async wrapper and would vanish next turn, but the RLM prompt promises a long-running
        // REPL. Hoist the declared names onto globalThis (which persists), mirroring TS. Fail-open.
        let code_literal = serde_json::to_string(code)?;
        let persist_suffix = self
            .eval_json_string(format!("axPersistSuffix({code_literal})"))
            .unwrap_or_default();
        let body_literal = serde_json::to_string(&format!(
            "with (globalThis) {{\n{code}\n{persist_suffix}\n}}"
        ))?;
        let run_source = format!(
            "globalThis.__ax_completion = undefined; globalThis.__ax_error = undefined; globalThis.__ax_error_category = undefined; globalThis.__ax_logs = []; __ax_install_host_callables(); __ax_install_final_evidence(); (async function(){{}}).constructor({body_literal})().then(function(){{}}, function(e){{ globalThis.__ax_error_category = String((e && (e.error_category || e.category)) || 'runtime'); globalThis.__ax_error = String((e && e.message) ? ((e.name ? e.name + ': ' : '') + e.message + (e.stack ? (' ' + e.stack) : '')) : ((e && e.stack) ? e.stack : e)); }});"
        );
        let run_result = self
            .context
            .with(|ctx| ctx.eval::<(), _>(run_source).map_err(qjs_error));
        // A timeout fires the interrupt handler during the synchronous run-eval and surfaces as an
        // Err here (the `while (true) {}` path); report it before draining so it is categorized as
        // a timeout rather than a generic runtime error.
        if let Err(error) = run_result {
            self.runtime.set_interrupt_handler(None);
            if timed_out.load(Ordering::SeqCst) {
                return Ok(RuntimeEnvelope::timeout("QuickJS execution timed out"));
            }
            return Ok(RuntimeEnvelope::error(error.message, "runtime"));
        }
        // Drain awaited continuations and the rejection handler so __ax_error / __ax_completion
        // reflect the final actor state (rquickjs does not run pending jobs automatically).
        while self.runtime.is_job_pending() {
            if self.runtime.execute_pending_job().is_err() {
                break;
            }
        }
        self.runtime.set_interrupt_handler(None);
        let actor_error: Value = serde_json::from_str(&self.eval_json_string(
            "JSON.stringify(globalThis.__ax_error === undefined ? null : globalThis.__ax_error)"
                .to_string(),
        )?)?;
        if let Some(message) = actor_error.as_str() {
            let actor_category: Value = serde_json::from_str(&self.eval_json_string(
                "JSON.stringify(globalThis.__ax_error_category === undefined ? 'runtime' : globalThis.__ax_error_category)"
                    .to_string(),
            )?)?;
            return Ok(RuntimeEnvelope::error(
                message,
                actor_category.as_str().unwrap_or("runtime"),
            ));
        }
        let completion = self.eval_json_string(
            "JSON.stringify(globalThis.__ax_completion === undefined ? {kind: 'result', result: null} : globalThis.__ax_completion)"
                .to_string(),
        )?;
        let mut payload: Value = serde_json::from_str(&completion).map_err(|error| {
            AxError::runtime(format!("malformed QuickJS actor output: {error}"))
        })?;
        let logs: Value = serde_json::from_str(
            &self.eval_json_string("JSON.stringify(globalThis.__ax_logs || [])".to_string())?,
        )?;
        if logs.as_array().is_some_and(|items| !items.is_empty()) {
            if let Some(fields) = payload.as_object_mut() {
                fields.insert("logs".to_string(), logs);
            }
        }
        Ok(RuntimeEnvelope { payload })
    }

    // TS's AxJSRuntime snapshot entries of the user globals.
    fn inspect_entries(&mut self) -> Value {
        let mut skip: Vec<String> = self.baseline.clone();
        skip.extend(self.reserved.iter().cloned());
        let skip_literal = match serde_json::to_string(&skip) {
            Ok(text) => text,
            Err(_) => return json!([]),
        };
        match self.eval_json_string(format!("__ax_inspect_entries({skip_literal})")) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| json!([])),
            Err(_) => json!([]),
        }
    }

    fn bootstrap(&mut self) -> AxResult<()> {
        let callables = self.host_callables.clone();
        self.context.with(|ctx| -> AxResult<()> {
            let host_call = Function::new(
                ctx.clone(),
                move |name: String, params_json: String| -> String {
                    let params = serde_json::from_str::<Value>(&params_json).unwrap_or(Value::Null);
                    let response = match callables.get(&name) {
                        Some(callable) => match callable(params) {
                            Ok(result) => json!({"ok": true, "result": result}),
                            Err(err) => {
                                json!({"ok": false, "category": err.category, "error": err.message})
                            }
                        },
                        None => json!({
                            "ok": false,
                            "category": "runtime",
                            "error": format!("host callable not registered: {name}")
                        }),
                    };
                    serde_json::to_string(&response).unwrap_or_else(|error| {
                        json!({"ok": false, "category": "runtime", "error": error.to_string()})
                            .to_string()
                    })
                },
            )
            .map_err(qjs_error)?;
            ctx.globals()
                .set("__ax_host_call", host_call)
                .map_err(qjs_error)?;
            ctx.eval::<(), _>(QUICKJS_BOOTSTRAP).map_err(qjs_error)?;
            Ok(())
        })?;
        self.set_global_json(
            "__ax_session_reserved",
            &reserved_names_value(&self.reserved),
        )?;
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
        self.context
            .with(|ctx| ctx.eval::<(), _>(source).map_err(qjs_error))
    }

    fn eval_json_string(&mut self, source: String) -> AxResult<String> {
        self.context
            .with(|ctx| ctx.eval::<String, _>(source).map_err(qjs_error))
    }

    fn snapshot_bindings(&mut self, apply_limit: bool) -> AxResult<Value> {
        let text = self.eval_json_string("__ax_snapshot_json()".to_string())?;
        let bindings: Value = serde_json::from_str(&text)?;
        if apply_limit {
            Ok(limit_snapshot(
                bindings,
                int_option(&self.runtime_policy, "maxSnapshotBytes", 262_144),
            ))
        } else {
            Ok(bindings)
        }
    }
}

impl AxCodeSession for QuickJsCodeSession {
    fn execute(&mut self, code: &str, options: Value) -> AxResult<RuntimeEnvelope> {
        if self.closed {
            return Ok(RuntimeEnvelope::session_closed("session closed"));
        }
        let analysis = self.code_analysis(code);
        let mut envelope = self.execute_turn(code, options)?;
        if let (Some(analysis), Some(fields)) = (analysis, envelope.payload.as_object_mut()) {
            fields.insert("analysis".to_string(), analysis);
        }
        Ok(envelope)
    }

    fn inspect_globals(&mut self, _options: Value) -> AxResult<Value> {
        if self.closed {
            return Ok(RuntimeEnvelope::session_closed("session closed").payload);
        }
        self.snapshot_bindings(false)
    }

    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        if self.closed {
            return Ok(RuntimeEnvelope::session_closed("session closed").payload);
        }
        let bindings = self.snapshot_bindings(true)?;
        let entries = self.inspect_entries();
        Ok(json!({
            "version": 1,
            "entries": entries,
            "bindings": bindings,
            "globals": bindings,
            "closed": false
        }))
    }

    fn patch_globals(&mut self, snapshot: Value, _options: Value) -> AxResult<Value> {
        if self.closed {
            return Ok(RuntimeEnvelope::session_closed("session closed").payload);
        }
        // A merge patch (the agent's own globals for the executor, as TS's
        // patchGlobals) keeps the session's variables and updates its reserved
        // values; any other patch replaces the user globals.
        let merge = snapshot
            .get("merge")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let bindings = snapshot
            .get("bindings")
            .or_else(|| snapshot.get("globals"))
            .cloned()
            .unwrap_or(snapshot);
        if merge {
            // The executor phase: the distiller's final no longer keeps evidence.
            self.context.with(|ctx| {
                ctx.eval::<(), _>("globalThis.__ax_phase = 'executor';")
                    .map_err(qjs_error)
            })?;
        } else {
            self.context.with(|ctx| {
                ctx.eval::<(), _>("__ax_clear_user_globals()")
                    .map_err(qjs_error)
            })?;
        }
        if let Some(obj) = bindings.as_object() {
            for (name, value) in obj {
                if name.starts_with("__ax_")
                    || (self.reserved.contains(name) && !merge)
                    || (is_builtin_reserved_name(name) && !(merge && name == "inputs"))
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

fn qjs_error(error: rquickjs::Error) -> AxError {
    AxError::runtime(error.to_string())
}

fn is_host_callable_marker(value: &Value) -> bool {
    value
        .get("__ax_host_callable")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || value
            .get("native")
            .and_then(Value::as_bool)
            .unwrap_or(false)
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
            | "respond"
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
var __ax_host_namespaces = Object.create(null);
function __ax_bind_host_namespaces() {
  const roots = [];
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (name.indexOf('.') < 0) continue;
    const callable = Object.getOwnPropertyDescriptor(globalThis, name);
    if (!callable || typeof callable.value !== 'function') continue;
    const parts = name.split('.');
    if (parts.some(part => !part)) {
      throw new Error('Invalid host callable namespace: ' + name);
    }
    let target = globalThis;
    let path = '';
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      path += (index ? '.' : '') + part;
      let entry = Object.getOwnPropertyDescriptor(target, part);
      if (!entry) {
        const value = Object.create(null);
        Object.defineProperty(target, part, {value, enumerable: true});
        __ax_host_namespaces[path] = value;
        entry = {value};
      }
      if (entry.value !== __ax_host_namespaces[path]) {
        throw new Error('Host callable namespace conflicts with a global: ' + path);
      }
      target = entry.value;
    }
    const leaf = parts[parts.length - 1];
    const existing = Object.getOwnPropertyDescriptor(target, leaf);
    if (existing && existing.value !== callable.value) {
      throw new Error('Host callable name conflicts with a namespace: ' + name);
    }
    if (!existing) Object.defineProperty(target, leaf, {value: callable.value, enumerable: true});
    if (roots.indexOf(parts[0]) < 0) roots.push(parts[0]);
  }
  if (Array.isArray(globalThis.__ax_session_reserved)) {
    for (const root of roots) {
      if (globalThis.__ax_session_reserved.indexOf(root) < 0) globalThis.__ax_session_reserved.push(root);
    }
  }
  return roots;
}

// Generated by scripts/axir-runtime-support.mjs from
// src/ax/util/jsAnalysis.ts, src/ax/agent/contextManager.ts and
// src/ax/funcs/worker.runtime.ts. Do not edit by hand.
(function () {
function isIdentifierChar(ch) {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}
function isIdentifierStart(ch) {
  return !!ch && /[A-Za-z_$]/.test(ch);
}
function stripJsStringsAndComments(code) {
  var _a, _b;
  let out = "";
  let i = 0;
  let state = "normal";
  let escaped = false;
  while (i < code.length) {
    const ch = (_a = code[i]) != null ? _a : "";
    const next = (_b = code[i + 1]) != null ? _b : "";
    if (state === "lineComment") {
      if (ch === "\n") {
        out += "\n";
        state = "normal";
      } else {
        out += " ";
      }
      i++;
      continue;
    }
    if (state === "blockComment") {
      if (ch === "*" && next === "/") {
        out += "  ";
        i += 2;
        state = "normal";
      } else {
        out += ch === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (escaped) {
        out += ch === "\n" ? "\n" : " ";
        escaped = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        out += " ";
        escaped = true;
        i++;
        continue;
      }
      if (ch === quote) {
        out += " ";
        state = "normal";
        i++;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      out += "  ";
      i += 2;
      state = "lineComment";
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      state = "blockComment";
      continue;
    }
    if (ch === "'") {
      out += " ";
      i++;
      state = "single";
      continue;
    }
    if (ch === '"') {
      out += " ";
      i++;
      state = "double";
      continue;
    }
    if (ch === "`") {
      out += " ";
      i++;
      state = "template";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
function extractTopLevelDeclaredNames(code) {
  const names = [];
  const len = code.length;
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  const skipString = (quote) => {
    i++;
    if (quote === "`") {
      let templateDepth = 0;
      while (i < len) {
        const ch = code[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (templateDepth > 0) {
          if (ch === "{") {
            templateDepth++;
          } else if (ch === "}") {
            templateDepth--;
          }
          i++;
          continue;
        }
        if (ch === "$" && i + 1 < len && code[i + 1] === "{") {
          templateDepth++;
          i += 2;
          continue;
        }
        if (ch === "`") {
          i++;
          return;
        }
        i++;
      }
      return;
    }
    while (i < len) {
      const ch = code[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        return;
      }
      i++;
    }
  };
  const skipLineComment = () => {
    i += 2;
    while (i < len && code[i] !== "\n") {
      i++;
    }
  };
  const skipBlockComment = () => {
    i += 2;
    while (i < len) {
      if (code[i] === "*" && i + 1 < len && code[i + 1] === "/") {
        i += 2;
        return;
      }
      i++;
    }
  };
  const readWord = () => {
    const start = i;
    while (i < len && isIdentifierChar(code[i])) {
      i++;
    }
    return code.slice(start, i);
  };
  const skipWhitespace = () => {
    const start = i;
    while (i < len) {
      const ch = code[i];
      if (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        i++;
        continue;
      }
      if (ch === "/" && i + 1 < len) {
        if (code[i + 1] === "/") {
          skipLineComment();
          continue;
        }
        if (code[i + 1] === "*") {
          skipBlockComment();
          continue;
        }
      }
      break;
    }
    return i > start;
  };
  const extractDestructuredNames = (close) => {
    let depth = 1;
    while (i < len && depth > 0) {
      skipWhitespace();
      if (i >= len) return;
      const ch = code[i];
      if (ch === close) {
        depth--;
        i++;
        continue;
      }
      if (ch === "{" || ch === "[") {
        const nestedClose = ch === "{" ? "}" : "]";
        i++;
        extractDestructuredNames(nestedClose);
        continue;
      }
      if (ch === "." && i + 2 < len && code[i + 1] === "." && code[i + 2] === ".") {
        i += 3;
        skipWhitespace();
        if (i < len && isIdentifierChar(code[i])) {
          const name = readWord();
          if (name) names.push(name);
        }
        continue;
      }
      if (ch === ",") {
        i++;
        continue;
      }
      if (ch === "=") {
        i++;
        let eqDepth = 0;
        while (i < len) {
          const current = code[i];
          if (current === "'" || current === '"' || current === "`") {
            skipString(current);
            continue;
          }
          if (current === "(" || current === "[" || current === "{") {
            eqDepth++;
            i++;
            continue;
          }
          if (current === ")" || current === "]" || current === "}") {
            if (eqDepth > 0) {
              eqDepth--;
              i++;
              continue;
            }
            break;
          }
          if (current === "," && eqDepth === 0) {
            break;
          }
          i++;
        }
        continue;
      }
      if (isIdentifierChar(ch)) {
        const word = readWord();
        skipWhitespace();
        if (i < len && code[i] === ":") {
          i++;
          skipWhitespace();
          if (i < len) {
            const current = code[i];
            if (current === "{" || current === "[") {
              const nestedClose = current === "{" ? "}" : "]";
              i++;
              extractDestructuredNames(nestedClose);
            } else if (isIdentifierChar(current)) {
              const renamed = readWord();
              if (renamed) names.push(renamed);
            }
          }
        } else if (word) {
          names.push(word);
        }
        continue;
      }
      i++;
    }
  };
  const skipToCommaOrEnd = () => {
    let depth = 0;
    while (i < len) {
      const ch = code[i];
      if (ch === "'" || ch === '"' || ch === "`") {
        skipString(ch);
        continue;
      }
      if (ch === "/" && i + 1 < len) {
        if (code[i + 1] === "/") {
          skipLineComment();
          continue;
        }
        if (code[i + 1] === "*") {
          skipBlockComment();
          continue;
        }
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        i++;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        if (depth > 0) {
          depth--;
          i++;
          continue;
        }
        return false;
      }
      if (ch === "," && depth === 0) {
        i++;
        return true;
      }
      if (ch === ";" && depth === 0) {
        i++;
        return false;
      }
      if (ch === "\n" && depth === 0) {
        const savedIndex = i;
        i++;
        skipWhitespace();
        if (i < len && code[i] === ",") {
          i++;
          return true;
        }
        i = savedIndex;
        return false;
      }
      i++;
    }
    return false;
  };
  const extractBindings = () => {
    while (i < len) {
      skipWhitespace();
      if (i >= len) return;
      const ch = code[i];
      if (ch === "{") {
        i++;
        extractDestructuredNames("}");
        if (!skipToCommaOrEnd()) return;
        continue;
      }
      if (ch === "[") {
        i++;
        extractDestructuredNames("]");
        if (!skipToCommaOrEnd()) return;
        continue;
      }
      if (isIdentifierChar(ch)) {
        const name = readWord();
        if (name) names.push(name);
        if (!skipToCommaOrEnd()) return;
        continue;
      }
      return;
    }
  };
  const isStatementBoundary = (pos) => {
    if (pos === 0) return true;
    let j = pos - 1;
    while (j >= 0) {
      const ch = code[j];
      if (ch === " " || ch === "	" || ch === "\r") {
        j--;
        continue;
      }
      return ch === "\n" || ch === ";" || ch === "{" || ch === "}";
    }
    return true;
  };
  while (i < len) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      skipString(ch);
      continue;
    }
    if (ch === "/" && i + 1 < len) {
      if (code[i + 1] === "/") {
        skipLineComment();
        continue;
      }
      if (code[i + 1] === "*") {
        skipBlockComment();
        continue;
      }
    }
    if (ch === "{") {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      i++;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ")") {
      parenDepth--;
      i++;
      continue;
    }
    if (braceDepth === 0 && parenDepth === 0 && isIdentifierChar(ch)) {
      const wordStart = i;
      const word = readWord();
      if ((word === "var" || word === "let" || word === "const") && i < len && (code[i] === " " || code[i] === "	" || code[i] === "\n") && isStatementBoundary(wordStart)) {
        extractBindings();
      }
      continue;
    }
    i++;
  }
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      unique.push(name);
    }
  }
  return unique;
}
function extractTopLevelDurableWriteTargets(code) {
  const names = new Set(extractTopLevelDeclaredNames(code));
  const sanitized = stripJsStringsAndComments(code);
  const len = sanitized.length;
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  const skipWhitespace = (index) => {
    var _a;
    let current = index;
    while (current < len && /\s/.test((_a = sanitized[current]) != null ? _a : "")) {
      current++;
    }
    return current;
  };
  const previousNonWhitespaceIndex = (index) => {
    var _a;
    let current = index;
    while (current >= 0 && /\s/.test((_a = sanitized[current]) != null ? _a : "")) {
      current--;
    }
    return current;
  };
  const isAssignmentOperatorAt = (index) => {
    const threeChars = sanitized.slice(index, index + 3);
    const twoChars = sanitized.slice(index, index + 2);
    if (threeChars === "===" || twoChars === "==" || twoChars === "=>") {
      return false;
    }
    return sanitized[index] === "=" || [
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "&=",
      "|=",
      "^=",
      "&&=",
      "||=",
      "??=",
      "**=",
      "<<=",
      ">>=",
      ">>>="
    ].some((op) => sanitized.startsWith(op, index));
  };
  const readWord = (start) => {
    let nextIndex = start;
    while (nextIndex < len && isIdentifierChar(sanitized[nextIndex])) {
      nextIndex++;
    }
    return { word: sanitized.slice(start, nextIndex), nextIndex };
  };
  const addIfBareAssignment = (word, start, end) => {
    const prevIndex = previousNonWhitespaceIndex(start - 1);
    const prev = prevIndex >= 0 ? sanitized[prevIndex] : void 0;
    const nextIndex = skipWhitespace(end);
    const isMemberAccess = prev === "." || prev === "?";
    if (isMemberAccess) {
      return;
    }
    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === "++" || sanitized.slice(Math.max(0, start - 2), start) === "--";
    const hasSuffixUpdate = sanitized.startsWith("++", nextIndex) || sanitized.startsWith("--", nextIndex);
    if (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(nextIndex)) {
      names.add(word);
    }
  };
  const addIfGlobalAssignment = (start, end) => {
    const dotIndex = skipWhitespace(end);
    if (sanitized[dotIndex] !== ".") {
      return;
    }
    const nameStart = skipWhitespace(dotIndex + 1);
    if (!isIdentifierStart(sanitized[nameStart])) {
      return;
    }
    const { word: propertyName, nextIndex } = readWord(nameStart);
    const operatorIndex = skipWhitespace(nextIndex);
    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === "++" || sanitized.slice(Math.max(0, start - 2), start) === "--";
    const hasSuffixUpdate = sanitized.startsWith("++", operatorIndex) || sanitized.startsWith("--", operatorIndex);
    if (propertyName && (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(operatorIndex))) {
      names.add(propertyName);
    }
  };
  while (i < len) {
    const ch = sanitized[i];
    if (ch === "{") {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      i++;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ")") {
      parenDepth--;
      i++;
      continue;
    }
    if (braceDepth === 0 && parenDepth === 0 && isIdentifierStart(ch)) {
      const start = i;
      const { word, nextIndex } = readWord(i);
      i = nextIndex;
      if (!word) {
        continue;
      }
      if (word === "globalThis") {
        addIfGlobalAssignment(start, nextIndex);
        continue;
      }
      addIfBareAssignment(word, start, nextIndex);
      continue;
    }
    i++;
  }
  return [...names];
}
const JS_KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally',
  'throw', 'new', 'delete', 'typeof', 'void', 'in', 'of', 'instanceof',
  'this', 'class', 'extends', 'super', 'import', 'export', 'default', 'from',
  'as', 'async', 'await', 'yield', 'true', 'false', 'null', 'undefined',
  'console', 'log'
]);
function extractReferencedIdentifiers(code) {
  const sanitized = stripJsStringsAndComments(code);
  const identRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  const ids = new Set();
  let match = identRegex.exec(sanitized);
  while (match !== null) {
    if (match[1] && !JS_KEYWORDS.has(match[1])) {
      ids.add(match[1]);
    }
    match = identRegex.exec(sanitized);
  }
  return ids;
}
function extractReadIdentifiers(code) {
  const reads = extractReferencedIdentifiers(code);
  for (const declared of extractTopLevelDeclaredNames(code)) {
    reads.delete(declared);
  }
  return reads;
}
function extractDirectQualifiedCallableUsages(code) {
  const sanitized = stripJsStringsAndComments(code);
  const usages = new Set();
  const callPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  let match = callPattern.exec(sanitized);
  while (match) {
    const namespace = match[1];
    const name = match[2];
    if (namespace && name) {
      usages.add(namespace + '.' + name);
    }
    match = callPattern.exec(sanitized);
  }
  return [...usages];
}
const truncateInspectText = (text, maxChars) =>
  text.length <= maxChars ? text : text.slice(0, maxChars - 3) + '...';
const previewInspectAtom = (value) => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  const valueType = typeof value;
  if (typeof value === 'string') {
    return JSON.stringify(truncateInspectText(value, 40));
  }
  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
    return String(value);
  }
  if (valueType === 'symbol') {
    return String(value);
  }
  if (valueType === 'function') {
    const fnName = value.name && typeof value.name === 'string' ? value.name : '';
    return '[function ' + (fnName || 'anonymous') + ']';
  }
  if (Array.isArray(value)) {
    return '[array(' + value.length + ')]';
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
  }
  if (value instanceof Error) {
    return (value.name || 'Error') + ': ' + (value.message || '');
  }
  if (typeof Map !== 'undefined' && value instanceof Map) {
    return '[map(' + value.size + ')]';
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    return '[set(' + value.size + ')]';
  }
  const ctorName =
    value && typeof value === 'object' && 'constructor' in value && value.constructor &&
    typeof value.constructor.name === 'string'
      ? value.constructor.name
      : '';
  return ctorName && ctorName !== 'Object' ? '[' + ctorName + ']' : '[object]';
};
const describeInspectType = (value) => {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return { type: 'array', ctor: 'Array' };
  }
  if (typeof Map !== 'undefined' && value instanceof Map) {
    return { type: 'map', ctor: 'Map' };
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    return { type: 'set', ctor: 'Set' };
  }
  if (value instanceof Date) {
    return { type: 'date', ctor: 'Date' };
  }
  if (value instanceof Error) {
    return {
      type: 'error',
      ctor: typeof value.name === 'string' && value.name.trim() ? value.name : 'Error',
    };
  }
  const valueType = typeof value;
  if (valueType !== 'object') {
    return { type: valueType };
  }
  const ctor =
    value && typeof value === 'object' && 'constructor' in value && value.constructor &&
    typeof value.constructor.name === 'string'
      ? value.constructor.name
      : undefined;
  return { type: 'object', ctor };
};
const describeInspectSize = (value, type) => {
  if (type === 'string') {
    return value.length + ' chars';
  }
  if (type === 'array') {
    return value.length + ' items';
  }
  if (type === 'map' || type === 'set') {
    return value.size + ' items';
  }
  if (type === 'object' && value && typeof value === 'object') {
    return Object.keys(value).length + ' keys';
  }
  return undefined;
};
const previewInspectValue = (value, type, ctor) => {
  if (type === 'array') {
    const items = value.slice(0, 3).map((item) => previewInspectAtom(item));
    return '[' + items.join(', ') + (value.length > 3 ? ', ...' : '') + ']';
  }
  if (type === 'map') {
    const items = Array.from(value.entries())
      .slice(0, 3)
      .map((pair) => previewInspectAtom(pair[0]) + ' => ' + previewInspectAtom(pair[1]));
    return 'Map(' + value.size + ') {' + items.join(', ') + (value.size > 3 ? ', ...' : '') + '}';
  }
  if (type === 'set') {
    const items = Array.from(value.values())
      .slice(0, 5)
      .map((item) => previewInspectAtom(item));
    return 'Set(' + value.size + ') {' + items.join(', ') + (value.size > 5 ? ', ...' : '') + '}';
  }
  if (type === 'date' || type === 'error' || type === 'function') {
    return previewInspectAtom(value);
  }
  if (type === 'object' && value && typeof value === 'object') {
    const keys = Object.keys(value);
    const shown = keys.slice(0, 4);
    const prefix = ctor && ctor !== 'Object' ? ctor + ' ' : '';
    return prefix + '{' + shown.join(', ') + (keys.length > shown.length ? ', ...' : '') + '}';
  }
  return previewInspectAtom(value);
};
const canCloneValue = (value, seen) => {
  const valueType = typeof value;
  if (valueType === 'function' || valueType === 'symbol') {
    return false;
  }
  if (value === null || valueType !== 'object') {
    return true;
  }
  if (seen.indexOf(value) >= 0) {
    return true;
  }
  seen.push(value);
  if (value instanceof Date || value instanceof RegExp || value instanceof Error) {
    return true;
  }
  if (typeof Map !== 'undefined' && value instanceof Map) {
    for (const pair of value.entries()) {
      if (!canCloneValue(pair[0], seen) || !canCloneValue(pair[1], seen)) return false;
    }
    return true;
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    for (const item of value.values()) {
      if (!canCloneValue(item, seen)) return false;
    }
    return true;
  }
  for (const key of Object.keys(value)) {
    if (!canCloneValue(value[key], seen)) return false;
  }
  return true;
};
globalThis.__ax_analyze_code = function (code) {
  const text = typeof code === 'string' ? code : '';
  return JSON.stringify({
    producedVars: extractTopLevelDurableWriteTargets(text),
    readVars: [...extractReadIdentifiers(text)],
    callables: extractDirectQualifiedCallableUsages(text),
  });
};
// src/ax/agent/agentInternal/sharedSession.ts buildDistillerFinalWrapperCode:
// in the distiller phase, final(task, evidence) with an evidence object
// keeps it as the distilledContext global, which the executor inherits with
// the session. The runtime calls this after installing its final primitive;
// a merge patch (the executor phase) sets __ax_phase to 'executor'.
globalThis.__ax_install_final_evidence = function () {
  const hostFinal = globalThis.final;
  if (typeof hostFinal !== 'function' || hostFinal.__ax_final_evidence === true) {
    return;
  }
  const wrapped = function () {
    const context = arguments[1];
    if (
      globalThis.__ax_phase !== 'executor' &&
      arguments.length === 2 &&
      context !== null &&
      typeof context === 'object' &&
      !Array.isArray(context)
    ) {
      globalThis.distilledContext = context;
    }
    return hostFinal.apply(this, arguments);
  };
  wrapped.__ax_final_evidence = true;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'final') || {};
  try {
    if (descriptor.configurable === false) {
      globalThis.final = wrapped;
    } else {
      Object.defineProperty(globalThis, 'final', {
        value: wrapped,
        writable: descriptor.writable !== false,
        enumerable: descriptor.enumerable === true,
        configurable: true,
      });
    }
  } catch (_error) {
    // A final the runtime cannot replace keeps its behavior.
  }
};
globalThis.__ax_inspect_entries = function (skipNames) {
  const skip = new Set(Array.isArray(skipNames) ? skipNames : []);
  const scope = globalThis;
  const entries = Object.getOwnPropertyNames(scope)
    .filter((name) => !skip.has(name) && !name.startsWith('_'))
    .sort()
    .map((name) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(scope, name);
        if (!descriptor) {
          return undefined;
        }
        if ('get' in descriptor && typeof descriptor.get === 'function' && !('value' in descriptor)) {
          return { name, type: 'accessor', preview: '[getter omitted]', restorable: false };
        }
        const value = 'value' in descriptor ? descriptor.value : scope[name];
        const meta = describeInspectType(value);
        const size = describeInspectSize(value, meta.type);
        const preview = previewInspectValue(value, meta.type, meta.ctor);
        const entry = { name, type: meta.type };
        if (meta.ctor) entry.ctor = meta.ctor;
        if (size) entry.size = size;
        if (preview) entry.preview = truncateInspectText(preview, 96);
        entry.restorable = canCloneValue(value, []);
        return entry;
      } catch (_error) {
        return { name, type: 'unknown', preview: '[unavailable]', restorable: false };
      }
    })
    .filter((entry) => entry !== undefined);
  return JSON.stringify(entries);
};
})();

function axPersistSuffix(src){try{var n=[],s={},re=/(?:^|[\n;{}])\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,m;while((m=re.exec(src))){if(!s[m[1]]){s[m[1]]=1;n.push(m[1]);}}return n.map(function(x){return 'try{globalThis['+JSON.stringify(x)+']='+x+';}catch(__e){}';}).join('');}catch(__e){return '';}}
const __ax_builtin_reserved = [
  "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
  "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
  "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
  "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
  "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
  "console", "final", "respond", "askClarification", "discover", "recall", "used", "reportSuccess",
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
globalThis.__ax_logs = [];
function __ax_log() {
  var parts = Array.prototype.slice.call(arguments).map(function (x) {
    if (typeof x === "string") return x;
    try { return JSON.stringify(x); } catch (e) { return String(x); }
  });
  globalThis.__ax_logs.push(parts.join(" "));
}
globalThis.console = { log: __ax_log, error: __ax_log, warn: __ax_log, info: __ax_log, debug: __ax_log };
function __ax_complete(value) { globalThis.__ax_completion = value; return value; }
function __ax_clone_json(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
function __ax_host_callable_error(message, category) {
  const error = new Error(String(message || "host callable failed"));
  error.error_category = String(category || "runtime");
  return error;
}
function __ax_make_host_callable(name, spec) {
  return function(params) {
    if (spec && spec.native === true) {
      const response = JSON.parse(globalThis.__ax_host_call(name, JSON.stringify(params === undefined ? null : params)));
      if (response.ok) return response.result;
      throw __ax_host_callable_error(response.error || ("host callable failed: " + name), response.category);
    }
    if (spec && spec.error) {
      throw __ax_host_callable_error(spec.error.message || spec.error.error || ("host callable failed: " + name), spec.error.category);
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
  __ax_bind_host_namespaces();
}
function final() { return __ax_complete({ type: "final", args: Array.from(arguments) }); }
function respond() { return __ax_complete({ type: "respond", args: Array.from(arguments) }); }
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
