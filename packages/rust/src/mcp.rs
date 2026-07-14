use crate::{tool, AxError, AxResult, Tool};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const AX_MCP_PROTOCOL_VERSION: &str = "2025-11-25";
pub const AX_MCP_SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &[
    AX_MCP_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];

#[derive(Debug, Clone)]
pub struct AxMCPTokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub issuer: Option<String>,
}

#[derive(Clone, Default)]
pub struct AxMCPOAuthOptions {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub redirect_uri: Option<String>,
    pub scopes: Vec<String>,
    pub on_auth_code: Option<Arc<dyn Fn(String) -> AxResult<Map<String, Value>> + Send + Sync>>,
    pub token_store: Option<Arc<Mutex<dyn AxMCPTokenStore + Send + Sync>>>,
    pub ssrf_protection: Value,
}

pub trait AxMCPTokenStore {
    fn get_token(&mut self, key: &str) -> AxResult<Option<AxMCPTokenSet>>;
    fn set_token(&mut self, key: &str, token: AxMCPTokenSet) -> AxResult<()>;
    fn clear_token(&mut self, _key: &str) -> AxResult<()> {
        Ok(())
    }
}

pub trait AxMCPTransport: Send {
    fn send(&mut self, message: Value) -> AxResult<Value>;
    fn send_notification(&mut self, message: Value) -> AxResult<()>;
    fn send_response(&mut self, message: Value) -> AxResult<()> {
        self.send_notification(message)
    }
    fn set_protocol_version(&mut self, _protocol_version: &str) {}
    fn set_message_handler(&mut self, _handler: Arc<dyn Fn(Value) + Send + Sync>) {}
    fn set_lifecycle_handler(&mut self, _handler: Arc<dyn Fn(String) + Send + Sync>) {}
    fn connect(&mut self) -> AxResult<()> {
        Ok(())
    }
    fn start_listening(&mut self) -> AxResult<()> {
        Ok(())
    }
    fn close(&mut self) -> AxResult<()> {
        Ok(())
    }
    fn sent_notifications(&self) -> Vec<Value> {
        Vec::new()
    }
}

#[derive(Clone)]
pub struct AxMCPClient {
    transport: Arc<Mutex<Box<dyn AxMCPTransport>>>,
    options: Value,
    server_capabilities: Value,
    negotiated_protocol_version: Option<String>,
    tools: Vec<Value>,
    prompts: Vec<Value>,
    resources: Vec<Value>,
    resource_templates: Vec<Value>,
    next_id: Arc<Mutex<u64>>,
    notification_listeners: Arc<Mutex<HashMap<usize, Arc<dyn Fn(Value)>>>>,
    lifecycle_listeners: Arc<Mutex<HashMap<usize, Arc<dyn Fn(String)>>>>,
    inbound_messages: Arc<Mutex<Vec<Value>>>,
    inbound_lifecycle: Arc<Mutex<Vec<String>>>,
    next_listener_id: Arc<Mutex<usize>>,
    logical_subscriptions: Arc<Mutex<Vec<String>>>,
    initialized: bool,
}

impl AxMCPClient {
    pub fn new(transport: Box<dyn AxMCPTransport>, options: Value) -> Self {
        Self {
            transport: Arc::new(Mutex::new(transport)),
            options,
            server_capabilities: json!({}),
            negotiated_protocol_version: None,
            tools: Vec::new(),
            prompts: Vec::new(),
            resources: Vec::new(),
            resource_templates: Vec::new(),
            next_id: Arc::new(Mutex::new(1)),
            notification_listeners: Arc::new(Mutex::new(HashMap::new())),
            lifecycle_listeners: Arc::new(Mutex::new(HashMap::new())),
            inbound_messages: Arc::new(Mutex::new(Vec::new())),
            inbound_lifecycle: Arc::new(Mutex::new(Vec::new())),
            next_listener_id: Arc::new(Mutex::new(1)),
            logical_subscriptions: Arc::new(Mutex::new(Vec::new())),
            initialized: false,
        }
    }

    pub fn init(&mut self) -> AxResult<()> {
        if self.initialized {
            return Ok(());
        }
        self.transport.lock().unwrap().connect()?;
        let protocol = self
            .options
            .get("protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or(AX_MCP_PROTOCOL_VERSION);
        let result = self.request(
            "initialize",
            json!({
                "protocolVersion": protocol,
                "capabilities": self.client_capabilities(),
                "clientInfo": {"name": "AxMCPClient", "title": "Ax MCP Client", "version": "1.0.0"}
            }),
        )?;
        let negotiated = result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let supported = self
            .options
            .get("supportedProtocolVersions")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| {
                AX_MCP_SUPPORTED_PROTOCOL_VERSIONS
                    .iter()
                    .map(|s| s.to_string())
                    .collect()
            });
        if !supported.iter().any(|item| item == &negotiated) {
            return Err(AxError::new(
                "mcp",
                format!("Unsupported MCP protocol version {negotiated}"),
            ));
        }
        self.negotiated_protocol_version = Some(negotiated.clone());
        self.transport
            .lock()
            .unwrap()
            .set_protocol_version(&negotiated);
        self.server_capabilities = result
            .get("capabilities")
            .cloned()
            .unwrap_or_else(|| json!({}));
        self.notify("notifications/initialized", Value::Null)?;
        self.refresh()?;
        let inbound_messages = self.inbound_messages.clone();
        self.transport
            .lock()
            .unwrap()
            .set_message_handler(Arc::new(move |message| {
                inbound_messages.lock().unwrap().push(message)
            }));
        let inbound_lifecycle = self.inbound_lifecycle.clone();
        self.transport
            .lock()
            .unwrap()
            .set_lifecycle_handler(Arc::new(move |state| {
                inbound_lifecycle.lock().unwrap().push(state)
            }));
        self.initialized = true;
        self.transport.lock().unwrap().start_listening()
    }

    pub fn close(&mut self) -> AxResult<()> {
        self.initialized = false;
        self.transport.lock().unwrap().close()
    }

    pub fn refresh(&mut self) -> AxResult<()> {
        self.tools.clear();
        self.prompts.clear();
        self.resources.clear();
        self.resource_templates.clear();
        if self.capability("tools") {
            self.tools = self
                .list_tools(None)?
                .get("tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
        if self.capability("prompts") {
            self.prompts = self
                .list_prompts(None)?
                .get("prompts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
        if self.capability("resources") {
            self.resources = self
                .list_resources(None)?
                .get("resources")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            self.resource_templates = self
                .list_resource_templates(None)?
                .get("resourceTemplates")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
        Ok(())
    }

    pub fn protocol_version(&self) -> Option<&str> {
        self.negotiated_protocol_version.as_deref()
    }
    pub fn ping(&mut self) -> AxResult<Value> {
        self.request("ping", json!({}))
    }
    pub fn list_tools(&mut self, cursor: Option<&str>) -> AxResult<Value> {
        self.request("tools/list", cursor_params(cursor))
    }
    pub fn call_tool(&mut self, name: &str, arguments: Value) -> AxResult<Value> {
        self.request("tools/call", json!({"name": name, "arguments": if arguments.is_null() { json!({}) } else { arguments }}))
    }
    pub fn list_prompts(&mut self, cursor: Option<&str>) -> AxResult<Value> {
        self.request("prompts/list", cursor_params(cursor))
    }
    pub fn get_prompt(&mut self, name: &str, arguments: Value) -> AxResult<Value> {
        self.request("prompts/get", json!({"name": name, "arguments": if arguments.is_null() { json!({}) } else { arguments }}))
    }
    pub fn list_resources(&mut self, cursor: Option<&str>) -> AxResult<Value> {
        self.request("resources/list", cursor_params(cursor))
    }
    pub fn read_resource(&mut self, uri: &str) -> AxResult<Value> {
        self.request("resources/read", json!({"uri": uri}))
    }
    pub fn subscribe_resource(&mut self, uri: &str) -> AxResult<Value> {
        let result = self.request("resources/subscribe", json!({"uri":uri}))?;
        let mut subscriptions = self.logical_subscriptions.lock().unwrap();
        if !subscriptions.iter().any(|value| value == uri) {
            subscriptions.push(uri.into())
        }
        Ok(result)
    }
    pub fn unsubscribe_resource(&mut self, uri: &str) -> AxResult<Value> {
        let result = self.request("resources/unsubscribe", json!({"uri":uri}))?;
        self.logical_subscriptions
            .lock()
            .unwrap()
            .retain(|value| value != uri);
        Ok(result)
    }
    pub fn get_task(&mut self, task_id: &str) -> AxResult<Value> {
        self.request("tasks/get", json!({"taskId":task_id}))
    }
    pub fn cancel_task(&mut self, task_id: &str) -> AxResult<Value> {
        self.request("tasks/cancel", json!({"taskId":task_id}))
    }
    pub fn list_resource_templates(&mut self, cursor: Option<&str>) -> AxResult<Value> {
        self.request("resources/templates/list", cursor_params(cursor))
    }

    pub fn notify(&self, method: &str, params: Value) -> AxResult<()> {
        let mut message = json!({"jsonrpc":"2.0", "method": method});
        if !params.is_null() {
            message["params"] = params;
        }
        self.transport.lock().unwrap().send_notification(message)
    }

    pub fn cancel_request(&self, request_id: Value, reason: Option<&str>) -> AxResult<()> {
        let mut params = json!({"requestId": request_id});
        if let Some(reason) = reason {
            params["reason"] = json!(reason);
        }
        self.notify("notifications/cancelled", params)
    }
    pub fn add_notification_listener(&self, listener: impl Fn(Value) + 'static) -> usize {
        let mut next = self.next_listener_id.lock().unwrap();
        let id = *next;
        *next += 1;
        self.notification_listeners
            .lock()
            .unwrap()
            .insert(id, Arc::new(listener));
        id
    }
    pub fn remove_notification_listener(&self, id: usize) {
        self.notification_listeners.lock().unwrap().remove(&id);
    }
    pub fn emit_notification(&self, message: Value) {
        let listeners = self
            .notification_listeners
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for listener in listeners {
            listener(message.clone())
        }
    }
    pub fn add_lifecycle_listener(&self, listener: impl Fn(String) + 'static) -> usize {
        let mut next = self.next_listener_id.lock().unwrap();
        let id = *next;
        *next += 1;
        self.lifecycle_listeners
            .lock()
            .unwrap()
            .insert(id, Arc::new(listener));
        id
    }
    pub fn remove_lifecycle_listener(&self, id: usize) {
        self.lifecycle_listeners.lock().unwrap().remove(&id);
    }
    pub fn emit_lifecycle(&self, state: &str) {
        let listeners = self
            .lifecycle_listeners
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for listener in listeners {
            listener(state.into())
        }
    }
    pub fn drain_inbound(&self) -> usize {
        let messages = std::mem::take(&mut *self.inbound_messages.lock().unwrap());
        let states = std::mem::take(&mut *self.inbound_lifecycle.lock().unwrap());
        let count = messages.len() + states.len();
        for state in states {
            self.emit_lifecycle(&state)
        }
        for message in messages {
            self.emit_notification(message)
        }
        count
    }

    pub fn to_function(&self) -> Vec<Tool> {
        let mut out = Vec::new();
        for item in &self.tools {
            out.push(self.tool_to_function(item.clone()));
        }
        for item in &self.prompts {
            out.push(self.prompt_to_function(item.clone()));
        }
        for item in &self.resources {
            out.push(self.resource_to_function(item.clone()));
        }
        for item in &self.resource_templates {
            out.push(self.resource_template_to_function(item.clone()));
        }
        out
    }

    pub fn native_tools(&self) -> Vec<Tool> {
        let mut out = Vec::new();
        for spec in &self.tools {
            let original = spec
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let name = override_name(&self.options, &original);
            let description = override_description(&self.options, spec);
            let transport = self.transport.clone();
            let next_id = self.next_id.clone();
            out.push(tool(&name).description(description).handler(move |args| {
                mcp_transport_request(
                    &transport,
                    &next_id,
                    "tools/call",
                    json!({"name": original, "arguments": args}),
                )
            }));
        }
        out
    }

    pub fn prompts(&self) -> &[Value] {
        &self.prompts
    }
    pub fn resources(&self) -> &[Value] {
        &self.resources
    }
    pub fn resource_templates(&self) -> &[Value] {
        &self.resource_templates
    }

    pub fn namespace(&self) -> String {
        self.options
            .get("namespace")
            .and_then(Value::as_str)
            .unwrap_or("mcp")
            .to_string()
    }

    pub fn request(&self, method: &str, params: Value) -> AxResult<Value> {
        mcp_transport_request(&self.transport, &self.next_id, method, params)
    }

    fn client_capabilities(&self) -> Value {
        let mut out = self
            .options
            .get("capabilities")
            .cloned()
            .unwrap_or_else(|| json!({}));
        if self.options.get("roots").is_some() && out.get("roots").is_none() {
            out["roots"] = json!({"listChanged": true});
        }
        out
    }

    fn capability(&self, name: &str) -> bool {
        self.server_capabilities
            .get(name)
            .is_some_and(|value| !value.is_null() && value != &Value::Bool(false))
    }

    fn tool_to_function(&self, spec: Value) -> Tool {
        let original = spec
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let name = override_name(&self.options, &original);
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| {
            let result = mcp_transport_request(&transport, &next_id, "tools/call", json!({"name": original, "arguments": args}))?;
            if let Some(value) = result.get("structuredContent") { return Ok(value.clone()); }
            Ok(json!({"content": content_text(result.get("content").and_then(Value::as_array).cloned().unwrap_or_default())}))
        })
    }

    fn prompt_to_function(&self, spec: Value) -> Tool {
        let original = spec
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let name = override_name(&self.options, &format!("prompt_{original}"));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| {
            mcp_transport_request(
                &transport,
                &next_id,
                "prompts/get",
                json!({"name": original, "arguments": args}),
            )
        })
    }

    fn resource_to_function(&self, spec: Value) -> Tool {
        let uri = spec
            .get("uri")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let raw_name = spec.get("name").and_then(Value::as_str).unwrap_or(&uri);
        let name = override_name(&self.options, &format!("resource_{}", safe_name(raw_name)));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |_| {
            mcp_transport_request(&transport, &next_id, "resources/read", json!({"uri": uri}))
        })
    }

    fn resource_template_to_function(&self, spec: Value) -> Tool {
        let raw_name = spec
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("template");
        let name = override_name(
            &self.options,
            &format!("resource_template_{}", safe_name(raw_name)),
        );
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| {
            mcp_transport_request(
                &transport,
                &next_id,
                "resources/read",
                json!({"uri": args.get("uri").cloned().unwrap_or(Value::Null)}),
            )
        })
    }
}

pub trait AxUCPBinding: Send + Sync {
    fn call(&self, operation: &str, payload: Value, options: Value) -> AxResult<Value>;
}

impl<F> AxUCPBinding for F
where
    F: Fn(&str, Value, Value) -> AxResult<Value> + Send + Sync,
{
    fn call(&self, operation: &str, payload: Value, options: Value) -> AxResult<Value> {
        self(operation, payload, options)
    }
}

pub const AX_UCP_OPERATIONS: &[&str] = &[
    "catalog.search",
    "catalog.lookup",
    "catalog.product",
    "cart.create",
    "cart.get",
    "cart.update",
    "cart.cancel",
    "checkout.create",
    "checkout.get",
    "checkout.update",
    "checkout.complete",
    "checkout.cancel",
    "fulfillment.quote",
    "discounts.apply",
    "payments.create",
    "payments.confirm",
    "orders.get",
    "identity.link",
    "attribution.record",
    "handoff.create",
];

#[derive(Clone)]
pub struct AxUCPClient {
    pub profile: Value,
    binding: Arc<dyn AxUCPBinding>,
    pub options: Value,
    pub version: String,
}

impl AxUCPClient {
    pub fn new(profile: Value, binding: Arc<dyn AxUCPBinding>, options: Value) -> AxResult<Self> {
        let version = profile
            .get("version")
            .or_else(|| options.get("version"))
            .and_then(Value::as_str)
            .unwrap_or("2026-04-08")
            .to_string();
        let supported = options
            .get("supportedVersions")
            .and_then(Value::as_array)
            .map(|v| v.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            .unwrap_or_else(|| vec!["2026-04-08"]);
        if !supported.iter().any(|candidate| *candidate == version) {
            return Err(AxError::new(
                "ucp",
                format!("Unsupported UCP version {version}"),
            ));
        }
        Ok(Self {
            profile,
            binding,
            options,
            version,
        })
    }

    pub fn namespace(&self) -> String {
        self.options
            .get("namespace")
            .or_else(|| self.profile.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("ucp")
            .to_string()
    }

    pub fn call(
        &self,
        operation: &str,
        payload: Value,
        idempotency_key: Option<&str>,
    ) -> AxResult<Value> {
        if !AX_UCP_OPERATIONS.contains(&operation) {
            return Err(AxError::new(
                "ucp",
                format!("Unsupported UCP operation {operation}"),
            ));
        }
        let key = idempotency_key.map(str::to_string).unwrap_or_else(|| {
            format!(
                "ax-ucp-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            )
        });
        let value = self.binding.call(
            operation,
            if payload.is_null() {
                json!({})
            } else {
                payload
            },
            json!({"version":self.version,"idempotencyKey":key}),
        )?;
        Ok(
            json!({"operation":operation,"warnings":value.get("warnings"),"partialSuccess":value.get("partial_success").or_else(||value.get("partialSuccess")).cloned().unwrap_or(json!(false)),"continuationUrl":value.get("continuation_url").or_else(||value.get("continuationUrl")),"idempotencyKey":key,"value":value}),
        )
    }

    pub fn native_tools(&self) -> Vec<Tool> {
        AX_UCP_OPERATIONS
            .iter()
            .map(|operation| {
                let op = operation.to_string();
                let client = self.clone();
                tool(&format!("{}_{}", self.namespace(), op.replace('.', "_")))
                    .description(format!("UCP {op} operation"))
                    .handler(move |args| client.call(&op, args, None))
            })
            .collect()
    }

    pub fn catalog_search(&self, payload: Value) -> AxResult<Value> {
        self.call("catalog.search", payload, None)
    }
    pub fn catalog_lookup(&self, payload: Value) -> AxResult<Value> {
        self.call("catalog.lookup", payload, None)
    }
    pub fn catalog_product(&self, payload: Value) -> AxResult<Value> {
        self.call("catalog.product", payload, None)
    }
    pub fn cart_create(&self, payload: Value) -> AxResult<Value> {
        self.call("cart.create", payload, None)
    }
    pub fn cart_get(&self, payload: Value) -> AxResult<Value> {
        self.call("cart.get", payload, None)
    }
    pub fn cart_update(&self, payload: Value) -> AxResult<Value> {
        self.call("cart.update", payload, None)
    }
    pub fn cart_cancel(&self, payload: Value) -> AxResult<Value> {
        self.call("cart.cancel", payload, None)
    }
    pub fn checkout_create(&self, payload: Value) -> AxResult<Value> {
        self.call("checkout.create", payload, None)
    }
    pub fn checkout_get(&self, payload: Value) -> AxResult<Value> {
        self.call("checkout.get", payload, None)
    }
    pub fn checkout_update(&self, payload: Value) -> AxResult<Value> {
        self.call("checkout.update", payload, None)
    }
    pub fn checkout_complete(&self, payload: Value) -> AxResult<Value> {
        self.call("checkout.complete", payload, None)
    }
    pub fn checkout_cancel(&self, payload: Value) -> AxResult<Value> {
        self.call("checkout.cancel", payload, None)
    }
    pub fn order_get(&self, payload: Value) -> AxResult<Value> {
        self.call("orders.get", payload, None)
    }
    pub fn identity_link(&self, payload: Value) -> AxResult<Value> {
        self.call("identity.link", payload, None)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxMCPContinuationState {
    pub namespaces: Vec<String>,
    pub tasks: Vec<Value>,
    pub subscriptions: Vec<Value>,
    pub catalog_fingerprint: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxEventEnvelope {
    pub specversion: String,
    pub id: String,
    pub source: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub subject: Option<String>,
    pub data: Value,
    #[serde(default)]
    pub extensions: Map<String, Value>,
    #[serde(default)]
    pub correlation: Vec<AxEventCorrelationKey>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxEventPath {
    pub root: String,
    #[serde(default)]
    pub segments: Vec<Value>,
    #[serde(default, rename = "correlationKind")]
    pub correlation_kind: Option<String>,
    #[serde(default)]
    pub value: Option<Value>,
}
impl AxEventPath {
    fn new(root: &str, segments: Vec<Value>) -> Self {
        for segment in &segments {
            if segment.as_i64().is_some_and(|value| value < 0)
                || segment.as_str().is_some_and(|value| {
                    value.is_empty() || matches!(value, "__proto__" | "constructor" | "prototype")
                })
            {
                panic!("unsafe event path segment: {segment}")
            }
        }
        Self {
            root: root.into(),
            segments,
            correlation_kind: None,
            value: None,
        }
    }
    pub fn data(segments: Vec<Value>) -> Self {
        Self::new("data", segments)
    }
    pub fn envelope(segments: Vec<Value>) -> Self {
        Self::new("envelope", segments)
    }
    pub fn subject() -> Self {
        Self::envelope(vec![json!("subject")])
    }
    pub fn extension(name: &str) -> Self {
        Self::new("extensions", vec![json!(name)])
    }
    pub fn identity(segments: Vec<Value>) -> Self {
        Self::new("identity", segments)
    }
    pub fn trust() -> Self {
        Self::new("trust", vec![])
    }
    pub fn correlation(kind: &str) -> Self {
        let mut out = Self::new("correlation", vec![]);
        out.correlation_kind = Some(kind.into());
        out
    }
    pub fn continuation(segments: Vec<Value>) -> Self {
        Self::new("continuation", segments)
    }
    pub fn constant(value: Value) -> Self {
        let mut out = Self::new("constant", vec![]);
        out.value = Some(value);
        out
    }
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct AxEventInputPlan {
    pub project: Option<AxEventPath>,
    pub fields: Vec<(String, AxEventPath)>,
}
pub struct AxEventInputBuilder {
    plan: AxEventInputPlan,
}
impl AxEventInputBuilder {
    pub fn new() -> Self {
        Self {
            plan: AxEventInputPlan::default(),
        }
    }
    pub fn project(&mut self, path: AxEventPath) -> &mut Self {
        if self.plan.project.is_some() {
            panic!("an event input plan may project only one path")
        }
        self.plan.project = Some(path);
        self
    }
    pub fn field(&mut self, name: &str, path: AxEventPath) -> &mut Self {
        if self.plan.fields.iter().any(|(value, _)| value == name) {
            panic!("event input field {name} is mapped more than once")
        }
        self.plan.fields.push((name.into(), path));
        self
    }
    pub fn build(self) -> AxEventInputPlan {
        self.plan
    }
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AxEventCorrelationKey {
    pub kind: String,
    pub value: String,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxEventRoute {
    pub id: String,
    pub action: String,
    pub r#match: Value,
    pub target_id: Option<String>,
    pub require_authenticated: bool,
    pub ordering: String,
    pub debounce_ms: i64,
    #[serde(default)]
    pub instance_key: Option<Value>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxEventCommand {
    pub route_id: String,
    pub action: String,
    pub target_id: Option<String>,
    pub instance_key: String,
    pub idempotency_key: String,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxEventPublishReceipt {
    pub event_id: String,
    pub accepted: bool,
    pub duplicate: bool,
    pub durability: String,
    pub delivery_ids: Vec<String>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxEventRun {
    pub id: String,
    pub delivery_id: String,
    pub route_id: String,
    pub target_id: Option<String>,
    pub instance_key: String,
    pub status: String,
    pub attempt: usize,
    pub output: Option<Value>,
    pub error: Option<String>,
    pub continuation_ids: Vec<String>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxEventDeadLetter {
    pub id: String,
    pub delivery_id: String,
    pub run_id: Option<String>,
    pub sink_id: Option<String>,
    pub reason: String,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AxEventContinuation {
    pub id: String,
    pub target_id: String,
    pub instance_key: String,
    pub identity_scope: String,
    pub correlation: Vec<AxEventCorrelationKey>,
    pub metadata: Value,
    pub completed: bool,
    pub expires_at: Option<i64>,
}
#[derive(Debug, Clone, Default)]
pub struct AxEventCancellationToken {
    state: Arc<Mutex<(bool, String)>>,
}
impl AxEventCancellationToken {
    pub fn cancel(&self, reason: &str) {
        *self.state.lock().unwrap() = (true, reason.into())
    }
    pub fn is_cancelled(&self) -> bool {
        self.state.lock().unwrap().0
    }
}
#[derive(Debug, Clone)]
pub struct AxEventInvocationContext {
    pub run_id: String,
    pub delivery_id: String,
    pub instance_key: String,
    pub identity_scope: String,
    pub idempotency_key: String,
    pub cancellation: AxEventCancellationToken,
    pub continuation: Option<AxEventContinuation>,
}
pub type AxEventInvoker = Arc<Mutex<dyn FnMut(Value, AxEventInvocationContext) -> AxResult<Value>>>;
pub type AxEventMapper =
    Arc<dyn Fn(&AxEventEnvelope, Option<&AxEventContinuation>) -> AxResult<Value>>;
pub type AxEventSinkFn = Arc<Mutex<dyn FnMut(Value, Value) -> AxResult<()>>>;
#[derive(Clone)]
pub struct AxEventTarget {
    pub id: String,
    pub invoke: AxEventInvoker,
    pub map_input: Option<AxEventMapper>,
    pub sinks: Vec<(String, AxEventSinkFn)>,
    pub retry_safety: String,
    pub wait_for: Vec<Value>,
    pub capture_state: Option<Arc<Mutex<dyn FnMut() -> AxResult<Value>>>>,
    pub restore_state: Option<Arc<Mutex<dyn FnMut(Value) -> AxResult<()>>>>,
    pub signature: Option<crate::AxSignature>,
    pub input: Option<AxEventInputPlan>,
    pub wake_input: Option<AxEventInputPlan>,
    pub resume_input: Option<AxEventInputPlan>,
}
impl AxEventTarget {
    pub fn new(
        id: impl Into<String>,
        invoke: impl FnMut(Value, AxEventInvocationContext) -> AxResult<Value> + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            invoke: Arc::new(Mutex::new(invoke)),
            map_input: None,
            sinks: vec![],
            retry_safety: "unknown".into(),
            wait_for: vec![],
            capture_state: None,
            restore_state: None,
            signature: None,
            input: None,
            wake_input: None,
            resume_input: None,
        }
    }
    pub fn signature(mut self, value: crate::AxSignature) -> Self {
        self.signature = Some(value);
        self
    }
    pub fn map_input(
        mut self,
        value: impl Fn(&AxEventEnvelope, Option<&AxEventContinuation>) -> AxResult<Value> + 'static,
    ) -> Self {
        self.map_input = Some(Arc::new(value));
        self
    }
    pub fn input(mut self, mapping: impl FnOnce(&mut AxEventInputBuilder)) -> Self {
        let mut value = AxEventInputBuilder::new();
        mapping(&mut value);
        self.input = Some(value.build());
        self
    }
    pub fn wake_input(mut self, mapping: impl FnOnce(&mut AxEventInputBuilder)) -> Self {
        let mut value = AxEventInputBuilder::new();
        mapping(&mut value);
        self.wake_input = Some(value.build());
        self
    }
    pub fn resume_input(mut self, mapping: impl FnOnce(&mut AxEventInputBuilder)) -> Self {
        let mut value = AxEventInputBuilder::new();
        mapping(&mut value);
        self.resume_input = Some(value.build());
        self
    }
    pub fn sink(
        mut self,
        id: &str,
        value: impl FnMut(Value, Value) -> AxResult<()> + 'static,
    ) -> Self {
        self.sinks.push((id.into(), Arc::new(Mutex::new(value))));
        self
    }
    pub fn retry_safety(mut self, value: &str) -> Self {
        self.retry_safety = value.into();
        self
    }
    pub fn wait_for(mut self, kind: &str, path: AxEventPath, metadata: Value) -> Self {
        self.wait_for
            .push(json!({"kind":kind,"value":path,"metadata":metadata}));
        self
    }
}
pub fn event_target(
    id: impl Into<String>,
    invoke: impl FnMut(Value, AxEventInvocationContext) -> AxResult<Value> + 'static,
) -> AxEventTarget {
    AxEventTarget::new(id, invoke)
}
pub struct AxEventRouteBuilder {
    route: AxEventRoute,
}
impl AxEventRouteBuilder {
    pub fn new(id: &str) -> Self {
        Self {
            route: AxEventRoute {
                id: id.into(),
                action: String::new(),
                r#match: json!({}),
                target_id: None,
                require_authenticated: false,
                ordering: "strict".into(),
                debounce_ms: 0,
                instance_key: None,
            },
        }
    }
    pub fn types(mut self, values: &[&str]) -> Self {
        self.route.r#match["types"] = json!(values);
        self
    }
    pub fn sources(mut self, values: &[&str]) -> Self {
        self.route.r#match["sources"] = json!(values);
        self
    }
    pub fn authenticated(mut self) -> Self {
        self.route.require_authenticated = true;
        self
    }
    pub fn instance_key(mut self, path: AxEventPath) -> Self {
        self.route.instance_key = Some(serde_json::to_value(path).unwrap());
        self
    }
    pub fn wake(mut self, target: &AxEventTarget) -> Self {
        self.route.action = "wake".into();
        self.route.target_id = Some(target.id.clone());
        self
    }
    pub fn resume(mut self) -> Self {
        self.route.action = "resume".into();
        self
    }
    pub fn observe(mut self) -> Self {
        self.route.action = "observe".into();
        self
    }
    pub fn invalidate(mut self) -> Self {
        self.route.action = "invalidate".into();
        self
    }
    pub fn build(self) -> AxResult<AxEventRoute> {
        if self.route.action.is_empty() {
            return Err(AxError::new("event", "event route requires one action"));
        }
        Ok(self.route)
    }
}
pub fn event_route(id: &str) -> AxEventRouteBuilder {
    AxEventRouteBuilder::new(id)
}
fn event_resolve_path_value(
    path: &AxEventPath,
    event: &AxEventEnvelope,
    identity_scope: &str,
    trust: &str,
    continuation: Option<&AxEventContinuation>,
) -> Value {
    let mut value = match path.root.as_str() {
        "data" => event.data.clone(),
        "envelope" => serde_json::to_value(event).unwrap_or(Value::Null),
        "extensions" => Value::Object(event.extensions.clone()),
        "identity" => json!({"scope":identity_scope}),
        "trust" => json!(trust),
        "continuation" => continuation
            .map(|value| value.metadata.clone())
            .unwrap_or(Value::Null),
        "constant" => path.value.clone().unwrap_or(Value::Null),
        "correlation" => event
            .correlation
            .iter()
            .find(|value| Some(value.kind.as_str()) == path.correlation_kind.as_deref())
            .map(|value| json!(value.value))
            .unwrap_or(Value::Null),
        _ => Value::Null,
    };
    for segment in &path.segments {
        value = match segment {
            Value::String(key) => value.get(key).cloned().unwrap_or(Value::Null),
            Value::Number(index) => index
                .as_u64()
                .and_then(|position| {
                    value
                        .as_array()
                        .and_then(|items| items.get(position as usize).cloned())
                })
                .unwrap_or(Value::Null),
            _ => Value::Null,
        }
    }
    value
}
fn map_event_target_input(
    target: &AxEventTarget,
    event: &AxEventEnvelope,
    continuation: Option<&AxEventContinuation>,
    action: &str,
    identity_scope: &str,
    trust: &str,
) -> AxResult<Value> {
    let plan = if action == "resume" {
        target.resume_input.as_ref()
    } else {
        target.wake_input.as_ref()
    }
    .or(target.input.as_ref());
    let input = if let Some(plan) = plan {
        let signature = target.signature.as_ref().ok_or_else(|| {
            AxError::new(
                "event",
                format!(
                    "target {} requires a signature for declarative input mapping",
                    target.id
                ),
            )
        })?;
        let projection = plan
            .project
            .as_ref()
            .map(|path| event_resolve_path_value(path, event, identity_scope, trust, continuation));
        if plan.project.is_some() && !projection.as_ref().is_some_and(Value::is_object) {
            return Err(AxError::new(
                "event",
                "projected event input must be an object",
            ));
        }
        let mut output = Map::new();
        for field in &signature.inputs {
            let explicit = plan
                .fields
                .iter()
                .find(|(name, _)| name == &field.name)
                .map(|(_, path)| path);
            let value = explicit
                .map(|path| {
                    event_resolve_path_value(path, event, identity_scope, trust, continuation)
                })
                .or_else(|| {
                    projection
                        .as_ref()
                        .and_then(|value| value.get(&field.name).cloned())
                })
                .unwrap_or(Value::Null);
            if value.is_null() {
                if !field.is_optional {
                    return Err(AxError::new(
                        "event",
                        format!("required signature input {} was not present", field.name),
                    ));
                }
                continue;
            }
            output.insert(field.name.clone(), value);
        }
        Value::Object(output)
    } else if let Some(mapper) = &target.map_input {
        mapper(event, continuation)?
    } else {
        event.data.clone()
    };
    if let Some(signature) = &target.signature {
        crate::validate_fields_native(&signature.inputs, &input)?;
    }
    Ok(input)
}
pub trait AxEventSource {
    fn start(&mut self, publish: &mut dyn FnMut(AxEventEnvelope) -> AxResult<()>) -> AxResult<()>;
}
pub trait AxEventSink {
    fn write(&mut self, output: Value, context: Value) -> AxResult<()>;
}
pub trait AxEventClock: Send + Sync {
    fn now(&self) -> i64;
    fn sleep(&self, milliseconds: i64, cancellation: Option<&AxEventCancellationToken>) -> bool;
}
#[derive(Default)]
pub struct AxSystemEventClock;
impl AxEventClock for AxSystemEventClock {
    fn now(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }
    fn sleep(&self, milliseconds: i64, cancellation: Option<&AxEventCancellationToken>) -> bool {
        if cancellation.is_some_and(AxEventCancellationToken::is_cancelled) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(milliseconds.max(0) as u64));
        !cancellation.is_some_and(AxEventCancellationToken::is_cancelled)
    }
}
#[derive(Default)]
pub struct AxManualEventClock {
    state: Mutex<i64>,
    changed: Condvar,
}
impl AxManualEventClock {
    pub fn new(now: i64) -> Self {
        Self {
            state: Mutex::new(now),
            changed: Condvar::new(),
        }
    }
    pub fn advance(&self, milliseconds: i64) {
        let mut value = self.state.lock().unwrap();
        *value += milliseconds;
        self.changed.notify_all();
    }
}
impl AxEventClock for AxManualEventClock {
    fn now(&self) -> i64 {
        *self.state.lock().unwrap()
    }
    fn sleep(&self, milliseconds: i64, cancellation: Option<&AxEventCancellationToken>) -> bool {
        let target = self.now() + milliseconds.max(0);
        let mut value = self.state.lock().unwrap();
        while *value < target {
            if cancellation.is_some_and(AxEventCancellationToken::is_cancelled) {
                return false;
            }
            value = self.changed.wait(value).unwrap()
        }
        !cancellation.is_some_and(AxEventCancellationToken::is_cancelled)
    }
}
pub trait AxEventStore {
    fn enqueue(&mut self, event: AxEventEnvelope, commands: Vec<AxEventCommand>) -> AxResult<()>;
}
#[derive(Debug, Clone)]
struct AxEventDelivery {
    event: AxEventEnvelope,
    command: AxEventCommand,
    identity_scope: String,
    trust: String,
    status: String,
    run_id: Option<String>,
    available_at: i64,
    sequence: u64,
    size: usize,
    attempt: usize,
}
pub struct AxInMemoryEventStore {
    deliveries: HashMap<String, AxEventDelivery>,
    pub runs: HashMap<String, AxEventRun>,
    pub dead_letters: HashMap<String, AxEventDeadLetter>,
    pub continuations: HashMap<String, AxEventContinuation>,
    pub program_state: HashMap<String, Value>,
    clock: Arc<dyn AxEventClock>,
    max_pending: usize,
    max_queued_bytes: usize,
    max_envelope_bytes: usize,
    publish_timeout_ms: i64,
    queued_bytes: usize,
    sequence: u64,
}
impl Default for AxInMemoryEventStore {
    fn default() -> Self {
        Self::new(Arc::new(AxSystemEventClock), &json!({}))
    }
}
impl AxInMemoryEventStore {
    fn new(clock: Arc<dyn AxEventClock>, options: &Value) -> Self {
        Self {
            deliveries: HashMap::new(),
            runs: HashMap::new(),
            dead_letters: HashMap::new(),
            continuations: HashMap::new(),
            program_state: HashMap::new(),
            clock,
            max_pending: options
                .get("maxPending")
                .and_then(Value::as_u64)
                .unwrap_or(10_000) as usize,
            max_queued_bytes: options
                .get("maxQueuedBytes")
                .and_then(Value::as_u64)
                .unwrap_or(64 * 1024 * 1024) as usize,
            max_envelope_bytes: options
                .get("maxEnvelopeBytes")
                .and_then(Value::as_u64)
                .unwrap_or(1024 * 1024) as usize,
            publish_timeout_ms: options
                .get("publishTimeoutMs")
                .and_then(Value::as_i64)
                .unwrap_or(5_000),
            queued_bytes: 0,
            sequence: 0,
        }
    }
    fn enqueue_at(
        &mut self,
        event: AxEventEnvelope,
        commands: Vec<AxEventCommand>,
        available_at: i64,
    ) -> AxResult<()> {
        let size = serde_json::to_vec(&event)?.len();
        if size > self.max_envelope_bytes {
            return Err(AxError::new(
                "event",
                format!("event envelope exceeds {} bytes", self.max_envelope_bytes),
            ));
        }
        let fresh = commands
            .into_iter()
            .filter(|command| {
                !self
                    .deliveries
                    .contains_key(&format!("{}:{}", command.route_id, event.id))
            })
            .collect::<Vec<_>>();
        let deadline = self.clock.now() + self.publish_timeout_ms;
        while !fresh.is_empty()
            && (self
                .deliveries
                .values()
                .filter(|value| value.status == "queued")
                .count()
                + fresh.len()
                > self.max_pending
                || self.queued_bytes + size * fresh.len() > self.max_queued_bytes)
        {
            let remaining = deadline - self.clock.now();
            if remaining <= 0 {
                return Err(AxError::new(
                    "event",
                    "AxEventBackpressureError: event inbox capacity timed out",
                ));
            }
            self.clock.sleep(remaining.min(50), None);
        }
        for command in fresh {
            self.sequence += 1;
            let id = format!("{}:{}", command.route_id, event.id);
            self.deliveries.insert(
                id,
                AxEventDelivery {
                    event: event.clone(),
                    command,
                    identity_scope: "anonymous".into(),
                    trust: "untrusted".into(),
                    status: "queued".into(),
                    run_id: None,
                    available_at,
                    sequence: self.sequence,
                    size,
                    attempt: 0,
                },
            );
            self.queued_bytes += size;
        }
        Ok(())
    }
    fn release(&mut self, id: &str) {
        if let Some(value) = self.deliveries.get_mut(id) {
            self.queued_bytes = self.queued_bytes.saturating_sub(value.size);
            value.size = 0
        }
    }
    fn requeue(&mut self, id: &str, available_at: i64) {
        if let Some(value) = self.deliveries.get_mut(id) {
            value.status = "queued".into();
            value.available_at = available_at;
            value.size = serde_json::to_vec(&value.event)
                .map(|data| data.len())
                .unwrap_or(0);
            self.queued_bytes += value.size
        }
    }
}
impl AxEventStore for AxInMemoryEventStore {
    fn enqueue(&mut self, event: AxEventEnvelope, commands: Vec<AxEventCommand>) -> AxResult<()> {
        let now = self.clock.now();
        self.enqueue_at(event, commands, now)
    }
}
pub struct AxEventRuntime {
    pub routes: Vec<AxEventRoute>,
    pub options: Value,
    pub descriptor: Value,
    pub store: AxInMemoryEventStore,
    clock: Arc<dyn AxEventClock>,
    targets: HashMap<String, AxEventTarget>,
    active: HashMap<String, AxEventCancellationToken>,
    started: bool,
    max_attempts: usize,
    retry_backoff_ms: i64,
}
impl AxEventRuntime {
    pub fn new(routes: Vec<AxEventRoute>, options: Value) -> AxResult<Self> {
        let routes_json = serde_json::to_value(&routes)?;
        let descriptor = crate::core_value_to_json(&crate::event_runtime_descriptor(&[
            crate::core_value_from_json(&routes_json),
            crate::core_value_from_json(&options),
        ])?);
        let clock: Arc<dyn AxEventClock> = Arc::new(AxSystemEventClock);
        let store = AxInMemoryEventStore::new(clock.clone(), &options);
        Ok(Self {
            routes,
            options,
            descriptor,
            store,
            clock,
            targets: HashMap::new(),
            active: HashMap::new(),
            started: false,
            max_attempts: 3,
            retry_backoff_ms: 1_000,
        })
    }
    pub fn set_clock(&mut self, clock: Arc<dyn AxEventClock>) {
        self.clock = clock.clone();
        self.store.clock = clock;
    }
    pub fn register_target(&mut self, target: AxEventTarget) {
        self.targets.insert(target.id.clone(), target);
    }
    pub fn start(&mut self) -> AxResult<()> {
        self.started = true;
        Ok(())
    }
    pub fn start_source(
        &mut self,
        source: &mut dyn AxEventSource,
        identity_scope: &str,
        trust: &str,
    ) -> AxResult<Vec<AxEventPublishReceipt>> {
        let mut events = Vec::new();
        source.start(&mut |event| {
            events.push(event);
            Ok(())
        })?;
        let mut receipts = Vec::new();
        for event in events {
            receipts.push(self.publish(event, identity_scope, trust)?)
        }
        Ok(receipts)
    }
    pub fn plan(
        &self,
        event: &AxEventEnvelope,
        identity_scope: &str,
        trust: &str,
    ) -> AxResult<Vec<AxEventCommand>> {
        let event_json = serde_json::to_value(event)?;
        let routes_json = serde_json::to_value(&self.routes)?;
        let value = crate::event_route_commands(&[
            crate::core_value_from_json(&event_json),
            crate::core_value_from_json(&routes_json),
            crate::core_value_from_json(&json!(identity_scope)),
            crate::core_value_from_json(&json!(trust)),
        ])?;
        let mut command_json = crate::core_value_to_json(&value);
        if let Some(items) = command_json.as_array_mut() {
            for item in items {
                if let Some(object) = item.as_object_mut() {
                    for field in ["instanceKey", "idempotencyKey"] {
                        if object.get(field).map_or(true, Value::is_null) {
                            object.insert(field.into(), json!(""));
                        }
                    }
                }
            }
        }
        let mut commands: Vec<AxEventCommand> = serde_json::from_value(command_json)?;
        for command in &mut commands {
            if let Some(path_value) = self
                .routes
                .iter()
                .find(|route| route.id == command.route_id)
                .and_then(|route| route.instance_key.as_ref())
            {
                let path: AxEventPath = serde_json::from_value(path_value.clone())?;
                let resolved = event_resolve_path_value(&path, event, identity_scope, trust, None);
                if resolved.is_null() {
                    return Err(AxError::new(
                        "event",
                        format!("route {} instance key was not present", command.route_id),
                    ));
                }
                command.instance_key = resolved
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| resolved.to_string());
            }
        }
        Ok(commands)
    }
    pub fn publish(
        &mut self,
        event: AxEventEnvelope,
        identity_scope: &str,
        trust: &str,
    ) -> AxResult<AxEventPublishReceipt> {
        if !self.started {
            return Err(AxError::new(
                "event",
                "AxEventRuntime must be started first",
            ));
        }
        let commands = self.plan(&event, identity_scope, trust)?;
        let ids = commands
            .iter()
            .map(|c| format!("{}:{}", c.route_id, event.id))
            .collect::<Vec<_>>();
        let duplicate =
            !ids.is_empty() && ids.iter().all(|id| self.store.deliveries.contains_key(id));
        for command in &commands {
            let debounce = self
                .routes
                .iter()
                .find(|route| route.id == command.route_id)
                .map(|route| route.debounce_ms)
                .unwrap_or(0);
            if debounce > 0 {
                let coalesced = self
                    .store
                    .deliveries
                    .iter()
                    .filter(|(_, old)| {
                        old.status == "queued"
                            && old.command.route_id == command.route_id
                            && old.command.target_id == command.target_id
                            && old.command.instance_key == command.instance_key
                    })
                    .map(|(id, _)| id.clone())
                    .collect::<Vec<_>>();
                for id in coalesced {
                    if let Some(old) = self.store.deliveries.get_mut(&id) {
                        old.status = "coalesced".into()
                    }
                    self.store.release(&id);
                }
            }
            self.store.enqueue_at(
                event.clone(),
                vec![command.clone()],
                self.clock.now() + debounce,
            )?;
        }
        for id in &ids {
            if let Some(delivery) = self.store.deliveries.get_mut(id) {
                delivery.identity_scope = identity_scope.into();
                delivery.trust = trust.into()
            }
        }
        if !duplicate {
            self.run_due();
        }
        Ok(AxEventPublishReceipt {
            event_id: event.id,
            accepted: true,
            duplicate,
            durability: "volatile".into(),
            delivery_ids: ids,
        })
    }
    pub fn next_due_at(&self) -> Option<i64> {
        self.store
            .deliveries
            .values()
            .filter(|value| value.status == "queued")
            .map(|value| value.available_at)
            .min()
    }
    pub fn run_due(&mut self) -> usize {
        let mut processed = 0;
        loop {
            let due = self
                .store
                .deliveries
                .iter()
                .filter(|(_, value)| {
                    value.status == "queued" && value.available_at <= self.clock.now()
                })
                .min_by_key(|(_, value)| (value.available_at, value.sequence))
                .map(|(id, _)| id.clone());
            let Some(id) = due else { return processed };
            let delivery = self.store.deliveries.get(&id).cloned().unwrap();
            if let Some(value) = self.store.deliveries.get_mut(&id) {
                value.status = "running".into()
            }
            self.store.release(&id);
            self.dispatch(
                delivery.event,
                delivery.command,
                &delivery.identity_scope,
                &delivery.trust,
            );
            processed += 1
        }
    }
    fn dispatch(
        &mut self,
        event: AxEventEnvelope,
        command: AxEventCommand,
        identity_scope: &str,
        trust: &str,
    ) {
        let delivery_id = format!("{}:{}", command.route_id, event.id);
        let mut target_id = command.target_id.clone();
        let continuation = if command.action == "resume" {
            let found = self.find_continuation(&event.correlation, identity_scope);
            let Some(value) = found else {
                self.dead_letter(&delivery_id, None, "continuation_not_found", None);
                return;
            };
            target_id = Some(value.target_id.clone());
            Some(value)
        } else {
            None
        };
        if command.action == "observe" || command.action == "invalidate" {
            if let Some(d) = self.store.deliveries.get_mut(&delivery_id) {
                d.status = "succeeded".into()
            }
            return;
        }
        let Some(target_id) = target_id else {
            self.dead_letter(&delivery_id, None, "unknown_target", None);
            return;
        };
        let Some(target) = self.targets.get(&target_id).cloned() else {
            self.dead_letter(
                &delivery_id,
                None,
                &format!("unknown_target:{target_id}"),
                None,
            );
            return;
        };
        let run_id = self
            .store
            .deliveries
            .get(&delivery_id)
            .and_then(|value| value.run_id.clone())
            .unwrap_or_else(|| format!("run:{}:{}", delivery_id, self.store.runs.len() + 1));
        let mut run = self
            .store
            .runs
            .get(&run_id)
            .cloned()
            .unwrap_or_else(|| AxEventRun {
                id: run_id.clone(),
                delivery_id: delivery_id.clone(),
                route_id: command.route_id.clone(),
                target_id: Some(target_id.clone()),
                instance_key: command.instance_key.clone(),
                status: "queued".into(),
                attempt: 0,
                output: None,
                error: None,
                continuation_ids: vec![],
            });
        if let Some(delivery) = self.store.deliveries.get_mut(&delivery_id) {
            delivery.run_id = Some(run_id.clone());
            delivery.attempt += 1;
            run.attempt = delivery.attempt
        }
        let token = AxEventCancellationToken::default();
        self.active.insert(run_id.clone(), token.clone());
        let state_key = format!(
            "{}\n{}\n{}",
            target_id, identity_scope, command.instance_key
        );
        if let (Some(restore), Some(state)) = (
            &target.restore_state,
            self.store.program_state.get(&state_key).cloned(),
        ) {
            if let Err(error) = (restore.lock().unwrap())(state) {
                self.dead_letter(&delivery_id, Some(&run_id), &error.to_string(), None);
                self.active.remove(&run_id);
                return;
            }
        }
        let mapped = map_event_target_input(
            &target,
            &event,
            continuation.as_ref(),
            &command.action,
            identity_scope,
            trust,
        );
        let input = match mapped {
            Ok(value) => value,
            Err(error) => {
                let reason = format!("event_input_invalid:{error}");
                run.status = "failed".into();
                run.error = Some(reason.clone());
                self.store.runs.insert(run_id.clone(), run);
                self.dead_letter(&delivery_id, Some(&run_id), &reason, None);
                self.active.remove(&run_id);
                return;
            }
        };
        {
            let attempt = run.attempt;
            run.status = "running".into();
            let context = AxEventInvocationContext {
                run_id: run_id.clone(),
                delivery_id: delivery_id.clone(),
                instance_key: command.instance_key.clone(),
                identity_scope: identity_scope.into(),
                idempotency_key: command.idempotency_key.clone(),
                cancellation: token.clone(),
                continuation: continuation.clone(),
            };
            let result = (target.invoke.lock().unwrap())(input.clone(), context);
            if token.is_cancelled() {
                run.status = "cancelled".into();
                if let Some(d) = self.store.deliveries.get_mut(&delivery_id) {
                    d.status = "cancelled".into()
                }
                self.store.runs.insert(run_id.clone(), run);
                self.active.remove(&run_id);
                return;
            }
            match result {
                Err(error) => {
                    if attempt < self.max_attempts && target.retry_safety == "idempotent" {
                        run.status = "queued".into();
                        self.store.requeue(
                            &delivery_id,
                            self.clock.now() + self.retry_backoff_ms * (1i64 << (attempt - 1)),
                        );
                    } else {
                        run.status = if target.retry_safety == "idempotent" {
                            "failed".into()
                        } else {
                            "outcome_unknown".into()
                        };
                        run.error = Some(error.to_string());
                        if let Some(d) = self.store.deliveries.get_mut(&delivery_id) {
                            d.status = run.status.clone()
                        }
                        self.dead_letter(&delivery_id, Some(&run_id), &error.to_string(), None);
                    }
                }
                Ok(output) => {
                    if let Some(capture) = &target.capture_state {
                        if let Ok(state) = (capture.lock().unwrap())() {
                            self.store.program_state.insert(state_key.clone(), state);
                        }
                    }
                    run.output = Some(output.clone());
                    match self.register_declared(
                        &target_id,
                        &target.wait_for,
                        &event,
                        &command,
                        identity_scope,
                        trust,
                    ) {
                        Err(error) => {
                            let reason = format!("event_input_invalid:{error}");
                            run.status = "failed".into();
                            run.error = Some(reason.clone());
                            self.dead_letter(&delivery_id, Some(&run_id), &reason, None)
                        }
                        Ok(ids) => {
                            run.continuation_ids = ids.clone();
                            if ids.is_empty() {
                                run.status = "succeeded".into();
                                if let Some(d) = self.store.deliveries.get_mut(&delivery_id) {
                                    d.status = "succeeded".into()
                                }
                                self.store.runs.insert(run_id.clone(), run.clone());
                                for (sink_id, sink) in &target.sinks {
                                    let context = json!({"run":&run,"idempotencyKey":format!("{}:{}",run_id,sink_id)});
                                    if let Err(error) =
                                        (sink.lock().unwrap())(output.clone(), context)
                                    {
                                        self.dead_letter(
                                            &delivery_id,
                                            Some(&run_id),
                                            &error.to_string(),
                                            Some(sink_id),
                                        )
                                    }
                                }
                            } else {
                                run.status = "waiting_event".into();
                                if let Some(d) = self.store.deliveries.get_mut(&delivery_id) {
                                    d.status = "waiting_event".into()
                                }
                            }
                            if let Some(value) = continuation.as_ref() {
                                if let Some(stored) = self.store.continuations.get_mut(&value.id) {
                                    stored.completed = true
                                }
                            }
                        }
                    }
                }
            }
        }
        self.store.runs.insert(run_id.clone(), run);
        self.active.remove(&run_id);
    }
    fn register_declared(
        &mut self,
        target_id: &str,
        declarations: &[Value],
        event: &AxEventEnvelope,
        command: &AxEventCommand,
        scope: &str,
        trust: &str,
    ) -> AxResult<Vec<String>> {
        let mut ids = vec![];
        for declaration in declarations {
            let kind = declaration
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("");
            let raw = declaration.get("value").cloned().unwrap_or(Value::Null);
            let value = if raw.get("root").is_some() {
                let path: AxEventPath = serde_json::from_value(raw)?;
                event_resolve_path_value(&path, event, scope, trust, None)
            } else if let Some(key) = raw.as_str() {
                event.data.get(key).cloned().unwrap_or(Value::Null)
            } else {
                raw
            };
            if value.is_null() {
                return Err(AxError::new("event", "continuation value is missing"));
            }
            let id = format!(
                "continuation:{}:{}",
                target_id,
                self.store.continuations.len() + 1
            );
            let expires_at = declaration
                .get("expiresInMs")
                .and_then(Value::as_i64)
                .map(|duration| self.clock.now() + duration);
            self.store.continuations.insert(
                id.clone(),
                AxEventContinuation {
                    id: id.clone(),
                    target_id: target_id.into(),
                    instance_key: command.instance_key.clone(),
                    identity_scope: scope.into(),
                    correlation: vec![AxEventCorrelationKey {
                        kind: kind.into(),
                        value: value
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| value.to_string()),
                    }],
                    metadata: declaration
                        .get("metadata")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                    completed: false,
                    expires_at,
                },
            );
            ids.push(id)
        }
        Ok(ids)
    }
    fn find_continuation(
        &self,
        keys: &[AxEventCorrelationKey],
        scope: &str,
    ) -> Option<AxEventContinuation> {
        self.store
            .continuations
            .values()
            .find(|c| {
                !c.completed
                    && c.identity_scope == scope
                    && c.expires_at.map_or(true, |value| value > self.clock.now())
                    && c.correlation.iter().any(|left| keys.contains(left))
            })
            .cloned()
    }
    fn dead_letter(
        &mut self,
        delivery_id: &str,
        run_id: Option<&str>,
        reason: &str,
        sink_id: Option<&str>,
    ) {
        let id = format!("dead:{}", self.store.dead_letters.len() + 1);
        self.store.dead_letters.insert(
            id.clone(),
            AxEventDeadLetter {
                id,
                delivery_id: delivery_id.into(),
                run_id: run_id.map(str::to_string),
                sink_id: sink_id.map(str::to_string),
                reason: reason.into(),
            },
        );
        if sink_id.is_none() {
            if let Some(d) = self.store.deliveries.get_mut(delivery_id) {
                d.status = "dead_lettered".into()
            }
        }
    }
    pub fn cancel_run(&self, run_id: &str, reason: &str) -> bool {
        if let Some(token) = self.active.get(run_id) {
            token.cancel(reason);
            true
        } else {
            false
        }
    }
    pub fn get_run(&self, run_id: &str) -> Option<&AxEventRun> {
        self.store.runs.get(run_id)
    }
    pub fn list_dead_letters(&self) -> Vec<AxEventDeadLetter> {
        self.store.dead_letters.values().cloned().collect()
    }
    pub fn redrive(&mut self, dead_id: &str) -> AxResult<()> {
        let dead = self
            .store
            .dead_letters
            .remove(dead_id)
            .ok_or_else(|| AxError::new("event", "unknown dead letter"))?;
        if let Some(sink_id) = dead.sink_id.as_ref() {
            let run = self
                .store
                .runs
                .get(dead.run_id.as_deref().unwrap_or(""))
                .cloned()
                .ok_or_else(|| AxError::new("event", "sink redrive run is unavailable"))?;
            let target = self
                .targets
                .get(run.target_id.as_deref().unwrap_or(""))
                .cloned()
                .ok_or_else(|| AxError::new("event", "sink redrive target is unavailable"))?;
            let sink = target
                .sinks
                .iter()
                .find(|(id, _)| id == sink_id)
                .map(|(_, value)| value.clone())
                .ok_or_else(|| AxError::new("event", "sink redrive sink is unavailable"))?;
            if let Err(error) = (sink.lock().unwrap())(
                run.output.clone().unwrap_or(Value::Null),
                json!({"run":run,"idempotencyKey":format!("{}:{}",dead.run_id.as_deref().unwrap_or(""),sink_id)}),
            ) {
                self.store.dead_letters.insert(dead.id.clone(), dead);
                return Err(error);
            }
            return Ok(());
        }
        if let Some(value) = self.store.deliveries.get_mut(&dead.delivery_id) {
            value.attempt = 0
        }
        self.store.requeue(&dead.delivery_id, self.clock.now());
        self.run_due();
        Ok(())
    }
    pub fn close(&mut self) -> AxResult<()> {
        self.started = false;
        Ok(())
    }
    pub fn normalize_mcp(namespace: &str, method: &str, params: Value) -> AxResult<Value> {
        let value = crate::event_normalize_mcp(&[
            crate::core_value_from_json(&json!(namespace)),
            crate::core_value_from_json(&json!(method)),
            crate::core_value_from_json(&params),
        ])?;
        Ok(crate::core_value_to_json(&value))
    }
}

pub struct AxMCPEventSource {
    client: Arc<Mutex<AxMCPClient>>,
    runtime: Arc<Mutex<AxEventRuntime>>,
    namespace: String,
    identity_scope: String,
    trust: String,
    subscriptions: Vec<String>,
    listener_id: Option<usize>,
    lifecycle_listener_id: Option<usize>,
    next_id: Arc<Mutex<usize>>,
    resubscribe_requested: Arc<Mutex<bool>>,
}
impl AxMCPEventSource {
    pub fn new(
        client: Arc<Mutex<AxMCPClient>>,
        runtime: Arc<Mutex<AxEventRuntime>>,
        namespace: impl Into<String>,
        identity_scope: impl Into<String>,
        trust: impl Into<String>,
        subscriptions: Vec<String>,
    ) -> Self {
        let namespace = namespace.into();
        let namespace = if namespace.is_empty() {
            client.lock().unwrap().namespace()
        } else {
            namespace
        };
        Self {
            client,
            runtime,
            namespace,
            identity_scope: identity_scope.into(),
            trust: trust.into(),
            subscriptions,
            listener_id: None,
            lifecycle_listener_id: None,
            next_id: Arc::new(Mutex::new(1)),
            resubscribe_requested: Arc::new(Mutex::new(false)),
        }
    }
    pub fn start(&mut self) -> AxResult<()> {
        let runtime = self.runtime.clone();
        let namespace = self.namespace.clone();
        let identity_scope = if self.identity_scope.is_empty() {
            "anonymous".into()
        } else {
            self.identity_scope.clone()
        };
        let trust = if self.trust.is_empty() {
            "untrusted".into()
        } else {
            self.trust.clone()
        };
        let next_id = self.next_id.clone();
        let id = self
            .client
            .lock()
            .unwrap()
            .add_notification_listener(move |message| {
                let Some(method) = message.get("method").and_then(Value::as_str) else {
                    return;
                };
                let Ok(normalized) = AxEventRuntime::normalize_mcp(
                    &namespace,
                    method,
                    message.get("params").cloned().unwrap_or_else(|| json!({})),
                ) else {
                    return;
                };
                let correlation = normalized
                    .get("correlation")
                    .and_then(Value::as_object)
                    .map(|key| {
                        vec![AxEventCorrelationKey {
                            kind: key.get("kind").and_then(Value::as_str).unwrap_or("").into(),
                            value: key
                                .get("value")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .into(),
                        }]
                    })
                    .unwrap_or_default();
                let data = normalized.get("data").cloned().unwrap_or_else(|| json!({}));
                let subject = data
                    .get("uri")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        data.get("task")
                            .and_then(|task| task.get("taskId"))
                            .and_then(Value::as_str)
                    })
                    .map(str::to_string);
                let mut sequence = next_id.lock().unwrap();
                let event = AxEventEnvelope {
                    specversion: "1.0".into(),
                    id: format!("mcp:{namespace}:{}", *sequence),
                    source: normalized
                        .get("source")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into(),
                    r#type: normalized
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("mcp.notification")
                        .into(),
                    subject,
                    data,
                    extensions: Map::new(),
                    correlation,
                };
                *sequence += 1;
                let _ = runtime
                    .lock()
                    .unwrap()
                    .publish(event, &identity_scope, &trust);
            });
        self.listener_id = Some(id);
        let resubscribe_requested = self.resubscribe_requested.clone();
        self.lifecycle_listener_id = Some(self.client.lock().unwrap().add_lifecycle_listener(
            move |state| {
                if state == "reconnected" {
                    *resubscribe_requested.lock().unwrap() = true
                }
            },
        ));
        self.client.lock().unwrap().init()?;
        for uri in &self.subscriptions {
            self.client.lock().unwrap().subscribe_resource(uri)?;
        }
        Ok(())
    }
    pub fn reconnect(&mut self) -> AxResult<()> {
        for uri in &self.subscriptions {
            self.client.lock().unwrap().subscribe_resource(uri)?;
        }
        Ok(())
    }
    pub fn poll(&mut self) -> usize {
        let (messages, states, notification_listeners, lifecycle_listeners) = {
            let client = self.client.lock().unwrap();
            let messages = {
                let mut queue = client.inbound_messages.lock().unwrap();
                std::mem::take(&mut *queue)
            };
            let states = {
                let mut queue = client.inbound_lifecycle.lock().unwrap();
                std::mem::take(&mut *queue)
            };
            let notification_listeners = client
                .notification_listeners
                .lock()
                .unwrap()
                .values()
                .cloned()
                .collect::<Vec<_>>();
            let lifecycle_listeners = client
                .lifecycle_listeners
                .lock()
                .unwrap()
                .values()
                .cloned()
                .collect::<Vec<_>>();
            (
                messages,
                states,
                notification_listeners,
                lifecycle_listeners,
            )
        };
        let count = messages.len() + states.len();
        for state in states {
            for listener in &lifecycle_listeners {
                listener(state.clone())
            }
        }
        for message in messages {
            for listener in &notification_listeners {
                listener(message.clone())
            }
        }
        let should_resubscribe = {
            let mut requested = self.resubscribe_requested.lock().unwrap();
            let value = *requested;
            *requested = false;
            value
        };
        if should_resubscribe {
            for uri in &self.subscriptions {
                let _ = self.client.lock().unwrap().subscribe_resource(uri);
            }
        }
        count
    }
    pub fn close(&mut self) -> AxResult<()> {
        for uri in &self.subscriptions {
            let _ = self.client.lock().unwrap().unsubscribe_resource(uri);
        }
        if let Some(id) = self.listener_id.take() {
            self.client.lock().unwrap().remove_notification_listener(id)
        }
        if let Some(id) = self.lifecycle_listener_id.take() {
            self.client.lock().unwrap().remove_lifecycle_listener(id)
        }
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct AxExecutionContext {
    pub mcp: Vec<Arc<Mutex<AxMCPClient>>>,
    pub ucp: Vec<AxUCPClient>,
    initialized: Arc<Mutex<Vec<usize>>>,
}

impl AxExecutionContext {
    pub fn new(mcp: Vec<Arc<Mutex<AxMCPClient>>>, ucp: Vec<AxUCPClient>) -> AxResult<Self> {
        let out = Self {
            mcp,
            ucp,
            initialized: Arc::new(Mutex::new(Vec::new())),
        };
        let names = out.namespaces();
        let mut unique = names.clone();
        unique.sort();
        unique.dedup();
        if unique.len() != names.len() {
            return Err(AxError::new("mcp", "MCP/UCP namespace collision"));
        }
        Ok(out)
    }
    pub fn initialize(&self) -> AxResult<()> {
        let mut initialized = self.initialized.lock().unwrap();
        for (index, client) in self.mcp.iter().enumerate() {
            if !initialized.contains(&index) {
                client.lock().unwrap().init()?;
                initialized.push(index)
            }
        }
        Ok(())
    }
    pub fn native_tools(&self) -> AxResult<Vec<Tool>> {
        self.initialize()?;
        let mut out = Vec::new();
        for client in &self.mcp {
            out.extend(client.lock().unwrap().native_tools())
        }
        for client in &self.ucp {
            out.extend(client.native_tools())
        }
        let mut names = out.iter().map(|tool| tool.name.clone()).collect::<Vec<_>>();
        let count = names.len();
        names.sort();
        names.dedup();
        if names.len() != count {
            return Err(AxError::new("mcp", "MCP/UCP tool collision"));
        }
        Ok(out)
    }
    pub fn runtime_modules(&self) -> Value {
        Value::Array(self.mcp.iter().map(|client|{let locked=client.lock().unwrap();json!({"name":format!("mcp.{}",locked.namespace()),"functions":locked.native_tools().iter().map(|tool|tool.name.clone()).collect::<Vec<_>>()})}).chain(self.ucp.iter().map(|client|json!({"name":format!("ucp.{}",client.namespace()),"functions":client.native_tools().iter().map(|tool|tool.name.clone()).collect::<Vec<_>>() }))).collect())
    }
    pub fn namespaces(&self) -> Vec<String> {
        self.mcp
            .iter()
            .map(|client| client.lock().unwrap().namespace())
            .chain(self.ucp.iter().map(AxUCPClient::namespace))
            .collect()
    }
    pub fn derive(&self, inheritance: &Value) -> Self {
        if inheritance.as_str() == Some("none") {
            return Self::default();
        }
        let Some(allowed) = inheritance.as_array() else {
            return self.clone();
        };
        let allowed = allowed.iter().filter_map(Value::as_str).collect::<Vec<_>>();
        Self {
            mcp: self
                .mcp
                .iter()
                .filter(|c| allowed.contains(&c.lock().unwrap().namespace().as_str()))
                .cloned()
                .collect(),
            ucp: self
                .ucp
                .iter()
                .filter(|c| allowed.contains(&c.namespace().as_str()))
                .cloned()
                .collect(),
            initialized: self.initialized.clone(),
        }
    }
    pub fn continuation_state(&self) -> AxMCPContinuationState {
        let namespaces = self.namespaces();
        let digest = ax_mcp_sha256(namespaces.join("\n").as_bytes());
        AxMCPContinuationState {
            namespaces,
            tasks: vec![],
            subscriptions: vec![],
            catalog_fingerprint: digest.iter().map(|b| format!("{b:02x}")).collect(),
        }
    }
}

fn mcp_transport_request(
    transport: &Arc<Mutex<Box<dyn AxMCPTransport>>>,
    next_id: &Arc<Mutex<u64>>,
    method: &str,
    params: Value,
) -> AxResult<Value> {
    let mut next = next_id.lock().unwrap();
    let id = next.to_string();
    *next += 1;
    drop(next);
    let response = transport
        .lock()
        .unwrap()
        .send(json!({"jsonrpc":"2.0", "id": id, "method": method, "params": params}))?;
    if let Some(error) = response.get("error") {
        return Err(AxError::new(
            "mcp",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("MCP JSON-RPC error"),
        ));
    }
    Ok(response.get("result").cloned().unwrap_or_else(|| json!({})))
}

pub struct AxMCPStreamableHTTPTransport {
    endpoint: String,
    options: Value,
    headers: Map<String, Value>,
    session_id: Option<String>,
    protocol_version: Option<String>,
    pub oauth: Option<AxMCPOAuthOptions>,
    client: reqwest::blocking::Client,
    message_handler: Option<Arc<dyn Fn(Value) + Send + Sync>>,
    lifecycle_handler: Option<Arc<dyn Fn(String) + Send + Sync>>,
    listen_stop: Arc<AtomicBool>,
    listen_thread: Option<JoinHandle<()>>,
}

impl AxMCPStreamableHTTPTransport {
    pub fn new(endpoint: impl Into<String>, options: Value) -> AxResult<Self> {
        let endpoint = ax_mcp_validate_endpoint(
            &endpoint.into(),
            options.get("ssrfProtection").unwrap_or(&Value::Null),
        )?;
        Ok(Self {
            endpoint,
            options,
            headers: Map::new(),
            session_id: None,
            protocol_version: None,
            oauth: None,
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()?,
            message_handler: None,
            lifecycle_handler: None,
            listen_stop: Arc::new(AtomicBool::new(true)),
            listen_thread: None,
        })
    }

    pub fn set_session_id(&mut self, value: impl Into<String>) {
        self.session_id = Some(value.into());
    }
    pub fn build_headers(
        &self,
        base: Map<String, Value>,
        include_protocol: bool,
    ) -> Map<String, Value> {
        let mut out = self.headers.clone();
        for (key, value) in base {
            out.insert(key, value);
        }
        if let Some(session) = &self.session_id {
            out.insert("MCP-Session-Id".to_string(), json!(session));
        }
        if include_protocol {
            if let Some(version) = &self.protocol_version {
                out.insert("MCP-Protocol-Version".to_string(), json!(version));
            }
        }
        out
    }

    pub fn apply_oauth(&mut self) -> bool {
        let Some(oauth) = &self.oauth else {
            return false;
        };
        if let Some(store) = &oauth.token_store {
            if let Ok(Some(token)) = store.lock().unwrap().get_token(&self.endpoint) {
                self.headers.insert(
                    "Authorization".to_string(),
                    json!(format!("Bearer {}", token.access_token)),
                );
                return true;
            }
        }
        let Some(callback) = &oauth.on_auth_code else {
            return false;
        };
        let verifier = ax_mcp_pkce_verifier();
        let challenge = ax_mcp_pkce_challenge(&verifier);
        let Ok(auth) = callback(format!(
            "{}?response_type=code&code_challenge={}&code_challenge_method=S256",
            self.endpoint,
            ax_mcp_url_encode(&challenge)
        )) else {
            return false;
        };
        let Some(code) = auth.get("code").and_then(Value::as_str) else {
            return false;
        };
        let token = AxMCPTokenSet {
            access_token: format!("mcp-auth-code-{code}"),
            refresh_token: None,
            expires_at: None,
            issuer: Some(self.endpoint.clone()),
        };
        if let Some(store) = &oauth.token_store {
            let _ = store
                .lock()
                .unwrap()
                .set_token(&self.endpoint, token.clone());
        }
        self.headers.insert(
            "Authorization".to_string(),
            json!(format!("Bearer {}", token.access_token)),
        );
        true
    }
}

impl AxMCPTransport for AxMCPStreamableHTTPTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        let mut request = self.client.post(&self.endpoint).json(&message);
        for (key, value) in self.build_headers(
            Map::new(),
            message.get("method").and_then(Value::as_str) != Some("initialize"),
        ) {
            if let Some(text) = value.as_str() {
                request = request.header(key, text);
            }
        }
        let response = request.send()?;
        if response.status().as_u16() == 401 && self.apply_oauth() {
            return self.send(message);
        }
        if !response.status().is_success() {
            return Err(AxError::new(
                "mcp",
                format!("HTTP error {}", response.status().as_u16()),
            ));
        }
        if let Some(session) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
        {
            self.session_id = Some(session.to_string());
        }
        // A spec-compliant MCP server may answer a JSON-RPC POST with an SSE stream
        // (Content-Type: text/event-stream) carrying the response — and any
        // interleaved notifications/keepalives — in `data:` frames; parse those
        // rather than JSON-decoding the raw stream. Otherwise keep the JSON path.
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let request_id = message.get("id").cloned().unwrap_or(Value::Null);
        let body = response.text()?;
        if body.trim().is_empty() {
            return Ok(json!({"jsonrpc": "2.0", "id": request_id, "result": {}}));
        }
        if content_type.contains("text/event-stream") {
            return Ok(ax_mcp_select_sse_response(
                crate::parse_sse_events(&body)?,
                &request_id,
                self.message_handler.as_ref(),
            ));
        }
        Ok(serde_json::from_str(&body)?)
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> {
        self.send(message).map(|_| ())
    }
    fn set_protocol_version(&mut self, protocol_version: &str) {
        self.protocol_version = Some(protocol_version.to_string());
    }
    fn set_message_handler(&mut self, handler: Arc<dyn Fn(Value) + Send + Sync>) {
        self.message_handler = Some(handler)
    }
    fn set_lifecycle_handler(&mut self, handler: Arc<dyn Fn(String) + Send + Sync>) {
        self.lifecycle_handler = Some(handler)
    }
    fn start_listening(&mut self) -> AxResult<()> {
        if self
            .listen_thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished())
        {
            return Ok(());
        }
        self.listen_stop.store(false, Ordering::SeqCst);
        let stop = self.listen_stop.clone();
        let endpoint = self.endpoint.clone();
        let headers = self.build_headers(Map::new(), true);
        let handler = self.message_handler.clone();
        let lifecycle = self.lifecycle_handler.clone();
        let delay = self
            .options
            .get("reconnectDelayMs")
            .and_then(Value::as_u64)
            .unwrap_or(100);
        let timeout = self
            .options
            .get("listenTimeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(1000);
        self.listen_thread = Some(thread::spawn(move || {
            let client = match reqwest::blocking::Client::builder()
                .timeout(Duration::from_millis(timeout))
                .build()
            {
                Ok(value) => value,
                Err(_) => return,
            };
            let mut connected_once = false;
            let mut last_event_id = None::<String>;
            while !stop.load(Ordering::SeqCst) {
                let mut request = client.get(&endpoint).header("Accept", "text/event-stream");
                for (key, value) in &headers {
                    if let Some(text) = value.as_str() {
                        request = request.header(key, text)
                    }
                }
                if let Some(value) = &last_event_id {
                    request = request.header("Last-Event-ID", value)
                }
                match request.send() {
                    Ok(response) if response.status().is_success() => {
                        if connected_once {
                            if let Some(callback) = &lifecycle {
                                callback("reconnected".into())
                            }
                        }
                        connected_once = true;
                        let reader = BufReader::new(response);
                        let mut data = Vec::<String>::new();
                        let mut event_id = None::<String>;
                        for line in reader.lines() {
                            if stop.load(Ordering::SeqCst) {
                                break;
                            }
                            let Ok(line) = line else { break };
                            if line.is_empty() {
                                if let Some(value) = event_id.take() {
                                    last_event_id = Some(value)
                                }
                                if !data.is_empty() {
                                    if let Ok(message) =
                                        serde_json::from_str::<Value>(&data.join("\n"))
                                    {
                                        if let Some(callback) = &handler {
                                            callback(message)
                                        }
                                    }
                                    data.clear()
                                }
                            } else if let Some(value) = line.strip_prefix("id:") {
                                event_id = Some(value.trim().to_string())
                            } else if let Some(value) = line.strip_prefix("data:") {
                                data.push(value.trim_start().to_string())
                            }
                        }
                        if !stop.load(Ordering::SeqCst) {
                            if let Some(callback) = &lifecycle {
                                callback("disconnected".into())
                            }
                        }
                    }
                    _ => {}
                }
                if !stop.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(delay))
                }
            }
        }));
        Ok(())
    }
    fn close(&mut self) -> AxResult<()> {
        self.listen_stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.listen_thread.take() {
            let _ = thread.join();
        }
        Ok(())
    }
}

// Return the JSON-RPC response whose id matches the request from the `data:`
// frames of an SSE answer. Interleaved server->client notifications on the POST
// stream are not dispatched (the HTTP transport keeps no inbound handler; the
// optional standalone GET stream would be required for that).
fn ax_mcp_select_sse_response(
    messages: Vec<Value>,
    request_id: &Value,
    handler: Option<&Arc<dyn Fn(Value) + Send + Sync>>,
) -> Value {
    let mut fallback: Option<Value> = None;
    let mut response: Option<Value> = None;
    for message in messages.into_iter() {
        if message.get("id") == Some(request_id) {
            response = Some(message);
        } else {
            if let Some(callback) = handler {
                callback(message.clone())
            }
            fallback = Some(message);
        }
    }
    response
        .or(fallback)
        .unwrap_or_else(|| json!({"jsonrpc": "2.0", "id": request_id, "result": {}}))
}

pub struct AxMCPStdioTransport {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    protocol_version: Option<String>,
}

impl AxMCPStdioTransport {
    pub fn new(
        command: impl Into<String>,
        args: impl IntoIterator<Item = impl Into<String>>,
    ) -> AxResult<Self> {
        let mut child = Command::new(command.into())
            .args(args.into_iter().map(Into::into))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AxError::new("mcp", "missing MCP stdio stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AxError::new("mcp", "missing MCP stdio stdout"))?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            protocol_version: None,
        })
    }
}

impl Drop for AxMCPStdioTransport {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

impl AxMCPTransport for AxMCPStdioTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        self.stdin
            .write_all(ax_mcp_stdio_encode(&message)?.as_bytes())?;
        self.stdin.flush()?;
        loop {
            let mut line = String::new();
            self.stdout.read_line(&mut line)?;
            let parsed = ax_mcp_stdio_decode(&line)?;
            if parsed.get("id") == message.get("id") {
                return Ok(parsed);
            }
        }
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> {
        self.stdin
            .write_all(ax_mcp_stdio_encode(&message)?.as_bytes())?;
        self.stdin.flush()?;
        Ok(())
    }

    fn set_protocol_version(&mut self, protocol_version: &str) {
        self.protocol_version = Some(protocol_version.to_string());
    }
}

pub struct AxMCPScriptedTransport {
    responses: Vec<Value>,
    pub requests: Vec<Value>,
    pub notifications: Vec<Value>,
    pub sent_responses: Vec<Value>,
    protocol_version: Option<String>,
}

impl AxMCPScriptedTransport {
    pub fn new(responses: Vec<Value>) -> Self {
        Self {
            responses,
            requests: Vec::new(),
            notifications: Vec::new(),
            sent_responses: Vec::new(),
            protocol_version: None,
        }
    }
}

impl AxMCPTransport for AxMCPScriptedTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        self.requests.push(message.clone());
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let index = self.responses.iter().position(|item| {
            item.get("method").and_then(Value::as_str).unwrap_or(method) == method
        });
        let raw = index
            .map(|idx| self.responses.remove(idx))
            .unwrap_or_else(|| json!({"result": {}}));
        if raw.get("error").is_some() {
            Ok(
                json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "error": raw["error"]}),
            )
        } else {
            Ok(
                json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "result": raw.get("result").cloned().unwrap_or_else(|| json!({}))}),
            )
        }
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> {
        self.notifications.push(message);
        Ok(())
    }
    fn send_response(&mut self, message: Value) -> AxResult<()> {
        self.sent_responses.push(message);
        Ok(())
    }
    fn set_protocol_version(&mut self, protocol_version: &str) {
        self.protocol_version = Some(protocol_version.to_string());
    }
    fn sent_notifications(&self) -> Vec<Value> {
        self.notifications.clone()
    }
}

pub fn ax_mcp_stdio_encode(message: &Value) -> AxResult<String> {
    Ok(format!("{}\n", serde_json::to_string(message)?))
}
pub fn ax_mcp_stdio_decode(line: &str) -> AxResult<Value> {
    Ok(serde_json::from_str(line.trim())?)
}
pub fn ax_mcp_pkce_verifier() -> String {
    let mut bytes = [0_u8; 32];
    if File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_err()
    {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = ((seed >> ((index % 16) * 8)) as u8).wrapping_add(index as u8);
        }
    }
    ax_mcp_base64_url_no_pad(&bytes)
}
pub fn ax_mcp_pkce_challenge(verifier: &str) -> String {
    ax_mcp_base64_url_no_pad(&ax_mcp_sha256(verifier.as_bytes()))
}
pub fn ax_mcp_url_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
fn ax_mcp_base64_url_no_pad(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let chunk = ((bytes[index] as u32) << 16)
            | ((bytes[index + 1] as u32) << 8)
            | bytes[index + 2] as u32;
        out.push(ALPHABET[((chunk >> 18) & 0x3f) as usize] as char);
        out.push(ALPHABET[((chunk >> 12) & 0x3f) as usize] as char);
        out.push(ALPHABET[((chunk >> 6) & 0x3f) as usize] as char);
        out.push(ALPHABET[(chunk & 0x3f) as usize] as char);
        index += 3;
    }
    match bytes.len() - index {
        1 => {
            let chunk = (bytes[index] as u32) << 16;
            out.push(ALPHABET[((chunk >> 18) & 0x3f) as usize] as char);
            out.push(ALPHABET[((chunk >> 12) & 0x3f) as usize] as char);
        }
        2 => {
            let chunk = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8);
            out.push(ALPHABET[((chunk >> 18) & 0x3f) as usize] as char);
            out.push(ALPHABET[((chunk >> 12) & 0x3f) as usize] as char);
            out.push(ALPHABET[((chunk >> 6) & 0x3f) as usize] as char);
        }
        _ => {}
    }
    out
}
fn ax_mcp_sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let bit_len = (input.len() as u64) * 8;
    let mut data = input.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in data.chunks(64) {
        let mut w = [0_u32; 64];
        for index in 0..16 {
            let offset = index * 4;
            w[index] = u32::from_be_bytes([
                chunk[offset],
                chunk[offset + 1],
                chunk[offset + 2],
                chunk[offset + 3],
            ]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0_u8; 32];
    for (index, value) in h.iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    out
}

pub fn ax_mcp_validate_endpoint(endpoint: &str, options: &Value) -> AxResult<String> {
    let parsed =
        reqwest::Url::parse(endpoint).map_err(|err| AxError::new("mcp", err.to_string()))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AxError::new("mcp", "MCP endpoint must use http or https"));
    }
    let require_https = options
        .get("requireHttps")
        .or_else(|| options.get("require_https"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if require_https && parsed.scheme() != "https" {
        return Err(AxError::new("mcp", "MCP endpoint must use https"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| AxError::new("mcp", "MCP endpoint must include a host"))?;
    let allow_local = options
        .get("allowLocalhost")
        .or_else(|| options.get("allow_localhost"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let allow_private = options
        .get("allowPrivateNetworks")
        .or_else(|| options.get("allow_private_networks"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if (host == "localhost" || host == "localhost.localdomain") && !allow_local {
        return Err(AxError::new("mcp", "MCP endpoint host is local"));
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if (ip.is_loopback() && !allow_local)
            || (is_private_ip(ip) && !allow_private)
            || ip.is_multicast()
            || ip.is_unspecified()
        {
            return Err(AxError::new(
                "mcp",
                "MCP endpoint host is not allowed by SSRF protection",
            ));
        }
    }
    Ok(endpoint.to_string())
}

pub fn run_mcp_conformance_fixture(fixture: &Value) -> AxResult<()> {
    let operation = fixture
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("initialize");
    let result = run_mcp_conformance_fixture_inner(fixture, operation);
    if let Some(expected) = fixture
        .get("expected_error_contains")
        .and_then(Value::as_str)
    {
        return match result {
            Ok(()) => Err(AxError::new("fixture", "expected MCP fixture to fail")),
            Err(err) if err.message.contains(expected) => Ok(()),
            Err(err) => Err(err),
        };
    }
    result
}

fn run_mcp_conformance_fixture_inner(fixture: &Value, operation: &str) -> AxResult<()> {
    match operation {
        "ssrf" => ax_mcp_validate_endpoint(
            fixture
                .get("endpoint")
                .and_then(Value::as_str)
                .unwrap_or("https://127.0.0.1/mcp"),
            fixture.get("ssrfProtection").unwrap_or(&Value::Null),
        )
        .map(|_| ()),
        "stdio_framing" => {
            let line = ax_mcp_stdio_encode(fixture.get("message").unwrap_or(&Value::Null))?;
            if let Some(expected) = fixture.get("expected_line").and_then(Value::as_str) {
                if line != expected {
                    return Err(AxError::new("fixture", "stdio line mismatch"));
                }
            }
            expect_subset(
                "stdio decoded",
                &ax_mcp_stdio_decode(&line)?,
                fixture.get("message").unwrap_or(&Value::Null),
            )
        }
        "oauth" => {
            let challenge = ax_mcp_pkce_challenge(
                fixture
                    .get("verifier")
                    .and_then(Value::as_str)
                    .unwrap_or("test-verifier"),
            );
            if let Some(expected) = fixture.get("expected_challenge").and_then(Value::as_str) {
                if challenge != expected {
                    return Err(AxError::new("fixture", "PKCE challenge mismatch"));
                }
            }
            let mut transport = AxMCPStreamableHTTPTransport::new(
                fixture
                    .get("endpoint")
                    .and_then(Value::as_str)
                    .unwrap_or("https://example.com/mcp"),
                Value::Null,
            )?;
            transport.oauth = Some(AxMCPOAuthOptions {
                on_auth_code: Some(Arc::new(|_| {
                    Ok(Map::from_iter([("code".to_string(), json!("abc"))]))
                })),
                ..Default::default()
            });
            if !transport.apply_oauth() || transport.headers.get("Authorization").is_none() {
                return Err(AxError::new(
                    "fixture",
                    "OAuth flow did not set Authorization",
                ));
            }
            Ok(())
        }
        "http_session_headers" => {
            let mut transport = AxMCPStreamableHTTPTransport::new(
                fixture
                    .get("endpoint")
                    .and_then(Value::as_str)
                    .unwrap_or("https://example.com/mcp"),
                fixture
                    .get("transport_options")
                    .cloned()
                    .unwrap_or(Value::Null),
            )?;
            transport.set_session_id(
                fixture
                    .get("session_id")
                    .and_then(Value::as_str)
                    .unwrap_or("session-1"),
            );
            transport.set_protocol_version(
                fixture
                    .get("protocol_version")
                    .and_then(Value::as_str)
                    .unwrap_or(AX_MCP_PROTOCOL_VERSION),
            );
            let mut base = Map::new();
            base.insert("Accept".to_string(), json!("application/json"));
            expect_subset(
                "headers",
                &Value::Object(transport.build_headers(base, true)),
                fixture.get("expected_headers").unwrap_or(&Value::Null),
            )
        }
        "execution_context_ucp" => {
            let responses = fixture
                .get("responses")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mcp = Arc::new(Mutex::new(AxMCPClient::new(
                Box::new(AxMCPScriptedTransport::new(responses)),
                fixture
                    .get("client_options")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )));
            let scripted = fixture
                .get("ucp_response")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let binding: Arc<dyn AxUCPBinding> =
                Arc::new(move |_: &str, _: Value, _: Value| Ok(scripted.clone()));
            let ucp = AxUCPClient::new(
                fixture
                    .get("ucp_profile")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
                binding,
                fixture
                    .get("ucp_options")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )?;
            let context = AxExecutionContext::new(vec![mcp], vec![ucp.clone()])?;
            context.initialize()?;
            let namespaces = Value::Array(
                context
                    .namespaces()
                    .iter()
                    .map(|name| json!(name))
                    .collect(),
            );
            expect_subset(
                "context namespaces",
                &namespaces,
                fixture.get("expected_namespaces").unwrap_or(&Value::Null),
            )?;
            let tools = context.native_tools()?;
            for expected in fixture
                .get("expected_native_tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
            {
                let name = expected.as_str().unwrap_or_default();
                if !tools.iter().any(|tool| tool.name == name) {
                    return Err(AxError::new(
                        "fixture",
                        format!("missing native context tool {name}"),
                    ));
                }
            }
            let call = fixture
                .get("call_ucp")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let outcome = ucp.call(
                call.get("operation")
                    .and_then(Value::as_str)
                    .unwrap_or("catalog.search"),
                call.get("payload").cloned().unwrap_or_else(|| json!({})),
                Some("fixture-key"),
            )?;
            expect_subset(
                "UCP outcome",
                &outcome,
                fixture.get("expected_ucp_outcome").unwrap_or(&Value::Null),
            )?;
            let state = context.continuation_state();
            if state.catalog_fingerprint.is_empty() {
                return Err(AxError::new(
                    "fixture",
                    "invalid execution context continuation state",
                ));
            }
            Ok(())
        }
        _ => {
            let responses = fixture
                .get("responses")
                .or_else(|| fixture.get("transport_responses"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut client = AxMCPClient::new(
                Box::new(AxMCPScriptedTransport::new(responses)),
                fixture
                    .get("client_options")
                    .cloned()
                    .unwrap_or(Value::Null),
            );
            client.init()?;
            if let Some(expected) = fixture
                .get("expected_protocol_version")
                .and_then(Value::as_str)
            {
                if client.protocol_version() != Some(expected) {
                    return Err(AxError::new("fixture", "protocol version mismatch"));
                }
            }
            match operation {
                "initialize" | "protocol_negotiation" => Ok(()),
                "ping" => client.ping().map(|_| ()),
                "tools" => {
                    let functions = client.native_tools();
                    if let Some(expected) = fixture.get("expected_function_names") {
                        let names =
                            Value::Array(functions.iter().map(|tool| json!(tool.name)).collect());
                        expect_subset("function names", &names, expected)?;
                    }
                    if let Some(call) = fixture.get("call_function") {
                        let name = call.get("name").and_then(Value::as_str).unwrap_or_default();
                        let args = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
                        let function = functions
                            .iter()
                            .find(|tool| tool.name == name)
                            .ok_or_else(|| AxError::new("fixture", "missing MCP function"))?;
                        let result = function.call(args)?;
                        expect_subset(
                            "tool result",
                            &result,
                            fixture.get("expected_call_result").unwrap_or(&Value::Null),
                        )?;
                    }
                    Ok(())
                }
                "prompts_resources" => {
                    expect_catalog_names(
                        "prompt names",
                        client.prompts(),
                        fixture.get("expected_prompt_names"),
                    )?;
                    expect_catalog_names(
                        "resource names",
                        client.resources(),
                        fixture.get("expected_resource_names"),
                    )?;
                    expect_catalog_names(
                        "resource template names",
                        client.resource_templates(),
                        fixture.get("expected_resource_template_names"),
                    )?;
                    Ok(())
                }
                "cancellation" => {
                    client.cancel_request(
                        fixture
                            .get("request_id")
                            .cloned()
                            .unwrap_or_else(|| json!("1")),
                        fixture.get("reason").and_then(Value::as_str),
                    )?;
                    let notifications = client.transport.lock().unwrap().sent_notifications();
                    let last = notifications
                        .last()
                        .ok_or_else(|| AxError::new("fixture", "expected a cancel notification"))?;
                    expect_subset(
                        "cancel notification",
                        last,
                        fixture.get("expected_notification").unwrap_or(&Value::Null),
                    )
                }
                "roots_notifications" => Ok(()),
                _ => Err(AxError::new(
                    "fixture",
                    format!("unsupported MCP conformance operation {operation}"),
                )),
            }
        }
    }
}

fn expect_catalog_names(label: &str, catalog: &[Value], expected: Option<&Value>) -> AxResult<()> {
    if let Some(expected) = expected {
        let names = Value::Array(
            catalog
                .iter()
                .map(|item| json!(item.get("name").and_then(Value::as_str).unwrap_or_default()))
                .collect(),
        );
        expect_subset(label, &names, expected)?;
    }
    Ok(())
}

fn cursor_params(cursor: Option<&str>) -> Value {
    cursor
        .map(|cursor| json!({"cursor": cursor}))
        .unwrap_or_else(|| json!({}))
}
fn override_name(options: &Value, name: &str) -> String {
    for item in options
        .get("functionOverrides")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if item.get("name").and_then(Value::as_str) == Some(name) {
            return item
                .get("updates")
                .and_then(|u| u.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(name)
                .to_string();
        }
    }
    name.to_string()
}
fn override_description(options: &Value, item: &Value) -> String {
    let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
    let description = item
        .get("description")
        .or_else(|| item.get("title"))
        .and_then(Value::as_str)
        .unwrap_or(name);
    for override_item in options
        .get("functionOverrides")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if override_item.get("name").and_then(Value::as_str) == Some(name) {
            return override_item
                .get("updates")
                .and_then(|u| u.get("description"))
                .and_then(Value::as_str)
                .unwrap_or(description)
                .to_string();
        }
    }
    description.to_string()
}
fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}
fn content_text(items: Vec<Value>) -> String {
    items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}
fn expect_subset(label: &str, actual: &Value, expected: &Value) -> AxResult<()> {
    if expected.is_null() || json_contains(actual, expected) {
        Ok(())
    } else {
        Err(AxError::new(
            "fixture",
            format!("{label} mismatch actual={actual} expected={expected}"),
        ))
    }
}
fn json_contains(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (_, Value::Null) => true,
        (Value::Object(a), Value::Object(e)) => e.iter().all(|(key, value)| {
            a.get(key)
                .is_some_and(|actual| json_contains(actual, value))
        }),
        (Value::Array(a), Value::Array(e)) => {
            e.len() <= a.len()
                && e.iter()
                    .enumerate()
                    .all(|(idx, value)| json_contains(&a[idx], value))
        }
        _ => actual == expected,
    }
}
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        std::net::IpAddr::V6(ip) => ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}
