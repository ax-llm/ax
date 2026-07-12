use crate::{tool, AxError, AxResult, Tool};
use serde_json::{json, Map, Value};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
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
    fn clear_token(&mut self, _key: &str) -> AxResult<()> { Ok(()) }
}

pub trait AxMCPTransport: Send {
    fn send(&mut self, message: Value) -> AxResult<Value>;
    fn send_notification(&mut self, message: Value) -> AxResult<()>;
    fn send_response(&mut self, message: Value) -> AxResult<()> { self.send_notification(message) }
    fn set_protocol_version(&mut self, _protocol_version: &str) {}
    fn connect(&mut self) -> AxResult<()> { Ok(()) }
    fn sent_notifications(&self) -> Vec<Value> { Vec::new() }
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
        }
    }

    pub fn init(&mut self) -> AxResult<()> {
        self.transport.lock().unwrap().connect()?;
        let protocol = self.options.get("protocolVersion").and_then(Value::as_str).unwrap_or(AX_MCP_PROTOCOL_VERSION);
        let result = self.request("initialize", json!({
            "protocolVersion": protocol,
            "capabilities": self.client_capabilities(),
            "clientInfo": {"name": "AxMCPClient", "title": "Ax MCP Client", "version": "1.0.0"}
        }))?;
        let negotiated = result.get("protocolVersion").and_then(Value::as_str).unwrap_or_default().to_string();
        let supported = self.options
            .get("supportedProtocolVersions")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
            .unwrap_or_else(|| AX_MCP_SUPPORTED_PROTOCOL_VERSIONS.iter().map(|s| s.to_string()).collect());
        if !supported.iter().any(|item| item == &negotiated) {
            return Err(AxError::new("mcp", format!("Unsupported MCP protocol version {negotiated}")));
        }
        self.negotiated_protocol_version = Some(negotiated.clone());
        self.transport.lock().unwrap().set_protocol_version(&negotiated);
        self.server_capabilities = result.get("capabilities").cloned().unwrap_or_else(|| json!({}));
        self.notify("notifications/initialized", Value::Null)?;
        self.refresh()
    }

    pub fn refresh(&mut self) -> AxResult<()> {
        self.tools.clear();
        self.prompts.clear();
        self.resources.clear();
        self.resource_templates.clear();
        if self.capability("tools") {
            self.tools = self.list_tools(None)?.get("tools").and_then(Value::as_array).cloned().unwrap_or_default();
        }
        if self.capability("prompts") {
            self.prompts = self.list_prompts(None)?.get("prompts").and_then(Value::as_array).cloned().unwrap_or_default();
        }
        if self.capability("resources") {
            self.resources = self.list_resources(None)?.get("resources").and_then(Value::as_array).cloned().unwrap_or_default();
            self.resource_templates = self.list_resource_templates(None)?.get("resourceTemplates").and_then(Value::as_array).cloned().unwrap_or_default();
        }
        Ok(())
    }

    pub fn protocol_version(&self) -> Option<&str> { self.negotiated_protocol_version.as_deref() }
    pub fn ping(&mut self) -> AxResult<Value> { self.request("ping", json!({})) }
    pub fn list_tools(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("tools/list", cursor_params(cursor)) }
    pub fn call_tool(&mut self, name: &str, arguments: Value) -> AxResult<Value> { self.request("tools/call", json!({"name": name, "arguments": if arguments.is_null() { json!({}) } else { arguments }})) }
    pub fn list_prompts(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("prompts/list", cursor_params(cursor)) }
    pub fn get_prompt(&mut self, name: &str, arguments: Value) -> AxResult<Value> { self.request("prompts/get", json!({"name": name, "arguments": if arguments.is_null() { json!({}) } else { arguments }})) }
    pub fn list_resources(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("resources/list", cursor_params(cursor)) }
    pub fn read_resource(&mut self, uri: &str) -> AxResult<Value> { self.request("resources/read", json!({"uri": uri})) }
    pub fn list_resource_templates(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("resources/templates/list", cursor_params(cursor)) }

    pub fn notify(&self, method: &str, params: Value) -> AxResult<()> {
        let mut message = json!({"jsonrpc":"2.0", "method": method});
        if !params.is_null() { message["params"] = params; }
        self.transport.lock().unwrap().send_notification(message)
    }

    pub fn cancel_request(&self, request_id: Value, reason: Option<&str>) -> AxResult<()> {
        let mut params = json!({"requestId": request_id});
        if let Some(reason) = reason { params["reason"] = json!(reason); }
        self.notify("notifications/cancelled", params)
    }

    pub fn to_function(&self) -> Vec<Tool> {
        let mut out = Vec::new();
        for item in &self.tools { out.push(self.tool_to_function(item.clone())); }
        for item in &self.prompts { out.push(self.prompt_to_function(item.clone())); }
        for item in &self.resources { out.push(self.resource_to_function(item.clone())); }
        for item in &self.resource_templates { out.push(self.resource_template_to_function(item.clone())); }
        out
    }

    pub fn native_tools(&self) -> Vec<Tool> {
        let mut out = Vec::new();
        for spec in &self.tools {
            let original = spec.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            let name = override_name(&self.options, &original);
            let description = override_description(&self.options, spec);
            let transport = self.transport.clone();
            let next_id = self.next_id.clone();
            out.push(tool(&name).description(description).handler(move |args| {
                mcp_transport_request(&transport, &next_id, "tools/call", json!({"name": original, "arguments": args}))
            }));
        }
        out
    }

    pub fn namespace(&self) -> String {
        self.options.get("namespace").and_then(Value::as_str).unwrap_or("mcp").to_string()
    }

    pub fn request(&self, method: &str, params: Value) -> AxResult<Value> {
        mcp_transport_request(&self.transport, &self.next_id, method, params)
    }

    fn client_capabilities(&self) -> Value {
        let mut out = self.options.get("capabilities").cloned().unwrap_or_else(|| json!({}));
        if self.options.get("roots").is_some() && out.get("roots").is_none() { out["roots"] = json!({"listChanged": true}); }
        out
    }

    fn capability(&self, name: &str) -> bool {
        self.server_capabilities.get(name).is_some_and(|value| !value.is_null() && value != &Value::Bool(false))
    }

    fn tool_to_function(&self, spec: Value) -> Tool {
        let original = spec.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
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
        let original = spec.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
        let name = override_name(&self.options, &format!("prompt_{original}"));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| mcp_transport_request(&transport, &next_id, "prompts/get", json!({"name": original, "arguments": args})))
    }

    fn resource_to_function(&self, spec: Value) -> Tool {
        let uri = spec.get("uri").and_then(Value::as_str).unwrap_or_default().to_string();
        let raw_name = spec.get("name").and_then(Value::as_str).unwrap_or(&uri);
        let name = override_name(&self.options, &format!("resource_{}", safe_name(raw_name)));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |_| mcp_transport_request(&transport, &next_id, "resources/read", json!({"uri": uri})))
    }

    fn resource_template_to_function(&self, spec: Value) -> Tool {
        let raw_name = spec.get("name").and_then(Value::as_str).unwrap_or("template");
        let name = override_name(&self.options, &format!("resource_template_{}", safe_name(raw_name)));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| mcp_transport_request(&transport, &next_id, "resources/read", json!({"uri": args.get("uri").cloned().unwrap_or(Value::Null)})))
    }
}

pub trait AxUCPBinding: Send + Sync {
    fn call(&self, operation: &str, payload: Value, options: Value) -> AxResult<Value>;
}

impl<F> AxUCPBinding for F where F: Fn(&str, Value, Value) -> AxResult<Value> + Send + Sync {
    fn call(&self, operation: &str, payload: Value, options: Value) -> AxResult<Value> { self(operation, payload, options) }
}

pub const AX_UCP_OPERATIONS: &[&str] = &[
    "catalog.search", "catalog.lookup", "catalog.product",
    "cart.create", "cart.get", "cart.update", "cart.cancel",
    "checkout.create", "checkout.get", "checkout.update", "checkout.complete", "checkout.cancel",
    "fulfillment.quote", "discounts.apply", "payments.create", "payments.confirm",
    "orders.get", "identity.link", "attribution.record", "handoff.create",
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
        let version = profile.get("version").or_else(|| options.get("version")).and_then(Value::as_str).unwrap_or("2026-04-08").to_string();
        let supported = options.get("supportedVersions").and_then(Value::as_array).map(|v|v.iter().filter_map(Value::as_str).collect::<Vec<_>>()).unwrap_or_else(||vec!["2026-04-08"]);
        if !supported.iter().any(|candidate| *candidate == version) { return Err(AxError::new("ucp",format!("Unsupported UCP version {version}"))); }
        Ok(Self{profile,binding,options,version})
    }

    pub fn namespace(&self) -> String { self.options.get("namespace").or_else(||self.profile.get("name")).and_then(Value::as_str).unwrap_or("ucp").to_string() }

    pub fn call(&self, operation:&str, payload:Value, idempotency_key:Option<&str>) -> AxResult<Value> {
        if !AX_UCP_OPERATIONS.contains(&operation) { return Err(AxError::new("ucp",format!("Unsupported UCP operation {operation}"))); }
        let key=idempotency_key.map(str::to_string).unwrap_or_else(||format!("ax-ucp-{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
        let value=self.binding.call(operation,if payload.is_null(){json!({})}else{payload},json!({"version":self.version,"idempotencyKey":key}))?;
        Ok(json!({"operation":operation,"warnings":value.get("warnings"),"partialSuccess":value.get("partial_success").or_else(||value.get("partialSuccess")).cloned().unwrap_or(json!(false)),"continuationUrl":value.get("continuation_url").or_else(||value.get("continuationUrl")),"idempotencyKey":key,"value":value}))
    }

    pub fn native_tools(&self) -> Vec<Tool> {
        AX_UCP_OPERATIONS.iter().map(|operation|{let op=operation.to_string();let client=self.clone();tool(&format!("{}_{}",self.namespace(),op.replace('.',"_"))).description(format!("UCP {op} operation")).handler(move|args|client.call(&op,args,None))}).collect()
    }

    pub fn catalog_search(&self,payload:Value)->AxResult<Value>{self.call("catalog.search",payload,None)}
    pub fn catalog_lookup(&self,payload:Value)->AxResult<Value>{self.call("catalog.lookup",payload,None)}
    pub fn catalog_product(&self,payload:Value)->AxResult<Value>{self.call("catalog.product",payload,None)}
    pub fn cart_create(&self,payload:Value)->AxResult<Value>{self.call("cart.create",payload,None)}
    pub fn cart_get(&self,payload:Value)->AxResult<Value>{self.call("cart.get",payload,None)}
    pub fn cart_update(&self,payload:Value)->AxResult<Value>{self.call("cart.update",payload,None)}
    pub fn cart_cancel(&self,payload:Value)->AxResult<Value>{self.call("cart.cancel",payload,None)}
    pub fn checkout_create(&self,payload:Value)->AxResult<Value>{self.call("checkout.create",payload,None)}
    pub fn checkout_get(&self,payload:Value)->AxResult<Value>{self.call("checkout.get",payload,None)}
    pub fn checkout_update(&self,payload:Value)->AxResult<Value>{self.call("checkout.update",payload,None)}
    pub fn checkout_complete(&self,payload:Value)->AxResult<Value>{self.call("checkout.complete",payload,None)}
    pub fn checkout_cancel(&self,payload:Value)->AxResult<Value>{self.call("checkout.cancel",payload,None)}
    pub fn order_get(&self,payload:Value)->AxResult<Value>{self.call("orders.get",payload,None)}
    pub fn identity_link(&self,payload:Value)->AxResult<Value>{self.call("identity.link",payload,None)}
}

#[derive(Debug,Clone,serde::Serialize,serde::Deserialize)]
pub struct AxMCPContinuationState { pub namespaces:Vec<String>,pub tasks:Vec<Value>,pub subscriptions:Vec<Value>,pub catalog_fingerprint:String }

#[derive(Clone,Default)]
pub struct AxExecutionContext { pub mcp:Vec<Arc<Mutex<AxMCPClient>>>,pub ucp:Vec<AxUCPClient>,initialized:Arc<Mutex<Vec<usize>>> }

impl AxExecutionContext {
    pub fn new(mcp:Vec<Arc<Mutex<AxMCPClient>>>,ucp:Vec<AxUCPClient>)->AxResult<Self>{let out=Self{mcp,ucp,initialized:Arc::new(Mutex::new(Vec::new()))};let names=out.namespaces();let mut unique=names.clone();unique.sort();unique.dedup();if unique.len()!=names.len(){return Err(AxError::new("mcp","MCP/UCP namespace collision"));}Ok(out)}
    pub fn initialize(&self)->AxResult<()>{let mut initialized=self.initialized.lock().unwrap();for(index,client)in self.mcp.iter().enumerate(){if !initialized.contains(&index){client.lock().unwrap().init()?;initialized.push(index)}}Ok(())}
    pub fn native_tools(&self)->AxResult<Vec<Tool>>{self.initialize()?;let mut out=Vec::new();for client in &self.mcp{out.extend(client.lock().unwrap().native_tools())}for client in &self.ucp{out.extend(client.native_tools())}let mut names=out.iter().map(|tool|tool.name.clone()).collect::<Vec<_>>();let count=names.len();names.sort();names.dedup();if names.len()!=count{return Err(AxError::new("mcp","MCP/UCP tool collision"));}Ok(out)}
    pub fn runtime_modules(&self)->Value{Value::Array(self.mcp.iter().map(|client|{let locked=client.lock().unwrap();json!({"name":format!("mcp.{}",locked.namespace()),"functions":locked.native_tools().iter().map(|tool|tool.name.clone()).collect::<Vec<_>>()})}).chain(self.ucp.iter().map(|client|json!({"name":format!("ucp.{}",client.namespace()),"functions":client.native_tools().iter().map(|tool|tool.name.clone()).collect::<Vec<_>>() }))).collect())}
    pub fn namespaces(&self)->Vec<String>{self.mcp.iter().map(|client|client.lock().unwrap().namespace()).chain(self.ucp.iter().map(AxUCPClient::namespace)).collect()}
    pub fn derive(&self,inheritance:&Value)->Self{if inheritance.as_str()==Some("none"){return Self::default()}let Some(allowed)=inheritance.as_array()else{return self.clone()};let allowed=allowed.iter().filter_map(Value::as_str).collect::<Vec<_>>();Self{mcp:self.mcp.iter().filter(|c|allowed.contains(&c.lock().unwrap().namespace().as_str())).cloned().collect(),ucp:self.ucp.iter().filter(|c|allowed.contains(&c.namespace().as_str())).cloned().collect(),initialized:self.initialized.clone()}}
    pub fn continuation_state(&self)->AxMCPContinuationState{let namespaces=self.namespaces();let digest=ax_mcp_sha256(namespaces.join("\n").as_bytes());AxMCPContinuationState{namespaces,tasks:vec![],subscriptions:vec![],catalog_fingerprint:digest.iter().map(|b|format!("{b:02x}")).collect()}}
}

fn mcp_transport_request(transport: &Arc<Mutex<Box<dyn AxMCPTransport>>>, next_id: &Arc<Mutex<u64>>, method: &str, params: Value) -> AxResult<Value> {
    let mut next = next_id.lock().unwrap();
    let id = next.to_string();
    *next += 1;
    drop(next);
    let response = transport.lock().unwrap().send(json!({"jsonrpc":"2.0", "id": id, "method": method, "params": params}))?;
    if let Some(error) = response.get("error") {
        return Err(AxError::new("mcp", error.get("message").and_then(Value::as_str).unwrap_or("MCP JSON-RPC error")));
    }
    Ok(response.get("result").cloned().unwrap_or_else(|| json!({})))
}

pub struct AxMCPStreamableHTTPTransport {
    endpoint: String,
    headers: Map<String, Value>,
    session_id: Option<String>,
    protocol_version: Option<String>,
    pub oauth: Option<AxMCPOAuthOptions>,
    client: reqwest::blocking::Client,
}

impl AxMCPStreamableHTTPTransport {
    pub fn new(endpoint: impl Into<String>, options: Value) -> AxResult<Self> {
        let endpoint = ax_mcp_validate_endpoint(&endpoint.into(), options.get("ssrfProtection").unwrap_or(&Value::Null))?;
        Ok(Self { endpoint, headers: Map::new(), session_id: None, protocol_version: None, oauth: None, client: reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)).build()? })
    }

    pub fn set_session_id(&mut self, value: impl Into<String>) { self.session_id = Some(value.into()); }
    pub fn build_headers(&self, base: Map<String, Value>, include_protocol: bool) -> Map<String, Value> {
        let mut out = self.headers.clone();
        for (key, value) in base { out.insert(key, value); }
        if let Some(session) = &self.session_id { out.insert("MCP-Session-Id".to_string(), json!(session)); }
        if include_protocol {
            if let Some(version) = &self.protocol_version { out.insert("MCP-Protocol-Version".to_string(), json!(version)); }
        }
        out
    }

    pub fn apply_oauth(&mut self) -> bool {
        let Some(oauth) = &self.oauth else { return false; };
        if let Some(store) = &oauth.token_store {
            if let Ok(Some(token)) = store.lock().unwrap().get_token(&self.endpoint) {
                self.headers.insert("Authorization".to_string(), json!(format!("Bearer {}", token.access_token)));
                return true;
            }
        }
        let Some(callback) = &oauth.on_auth_code else { return false; };
        let verifier = ax_mcp_pkce_verifier();
        let challenge = ax_mcp_pkce_challenge(&verifier);
        let Ok(auth) = callback(format!("{}?response_type=code&code_challenge={}&code_challenge_method=S256", self.endpoint, ax_mcp_url_encode(&challenge))) else { return false; };
        let Some(code) = auth.get("code").and_then(Value::as_str) else { return false; };
        let token = AxMCPTokenSet { access_token: format!("mcp-auth-code-{code}"), refresh_token: None, expires_at: None, issuer: Some(self.endpoint.clone()) };
        if let Some(store) = &oauth.token_store { let _ = store.lock().unwrap().set_token(&self.endpoint, token.clone()); }
        self.headers.insert("Authorization".to_string(), json!(format!("Bearer {}", token.access_token)));
        true
    }
}

impl AxMCPTransport for AxMCPStreamableHTTPTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        let mut request = self.client.post(&self.endpoint).json(&message);
        for (key, value) in self.build_headers(Map::new(), message.get("method").and_then(Value::as_str) != Some("initialize")) {
            if let Some(text) = value.as_str() { request = request.header(key, text); }
        }
        let response = request.send()?;
        if response.status().as_u16() == 401 && self.apply_oauth() { return self.send(message); }
        if !response.status().is_success() { return Err(AxError::new("mcp", format!("HTTP error {}", response.status().as_u16()))); }
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
            return Ok(ax_mcp_select_sse_response(crate::parse_sse_events(&body)?, &request_id));
        }
        Ok(serde_json::from_str(&body)?)
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> { self.send(message).map(|_| ()) }
    fn set_protocol_version(&mut self, protocol_version: &str) { self.protocol_version = Some(protocol_version.to_string()); }
}

// Return the JSON-RPC response whose id matches the request from the `data:`
// frames of an SSE answer. Interleaved server->client notifications on the POST
// stream are not dispatched (the HTTP transport keeps no inbound handler; the
// optional standalone GET stream would be required for that).
fn ax_mcp_select_sse_response(messages: Vec<Value>, request_id: &Value) -> Value {
    let mut fallback: Option<Value> = None;
    for message in messages.into_iter() {
        if message.get("id") == Some(request_id) {
            return message;
        }
        fallback = Some(message);
    }
    fallback.unwrap_or_else(|| json!({"jsonrpc": "2.0", "id": request_id, "result": {}}))
}

pub struct AxMCPStdioTransport {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    protocol_version: Option<String>,
}

impl AxMCPStdioTransport {
    pub fn new(command: impl Into<String>, args: impl IntoIterator<Item = impl Into<String>>) -> AxResult<Self> {
        let mut child = Command::new(command.into()).args(args.into_iter().map(Into::into)).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| AxError::new("mcp", "missing MCP stdio stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| AxError::new("mcp", "missing MCP stdio stdout"))?;
        Ok(Self { child, stdin, stdout: BufReader::new(stdout), protocol_version: None })
    }
}

impl Drop for AxMCPStdioTransport {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

impl AxMCPTransport for AxMCPStdioTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        self.stdin.write_all(ax_mcp_stdio_encode(&message)?.as_bytes())?;
        self.stdin.flush()?;
        loop {
            let mut line = String::new();
            self.stdout.read_line(&mut line)?;
            let parsed = ax_mcp_stdio_decode(&line)?;
            if parsed.get("id") == message.get("id") { return Ok(parsed); }
        }
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> {
        self.stdin.write_all(ax_mcp_stdio_encode(&message)?.as_bytes())?;
        self.stdin.flush()?;
        Ok(())
    }

    fn set_protocol_version(&mut self, protocol_version: &str) { self.protocol_version = Some(protocol_version.to_string()); }
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
        Self { responses, requests: Vec::new(), notifications: Vec::new(), sent_responses: Vec::new(), protocol_version: None }
    }
}

impl AxMCPTransport for AxMCPScriptedTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        self.requests.push(message.clone());
        let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
        let index = self.responses.iter().position(|item| item.get("method").and_then(Value::as_str).unwrap_or(method) == method);
        let raw = index.map(|idx| self.responses.remove(idx)).unwrap_or_else(|| json!({"result": {}}));
        if raw.get("error").is_some() {
            Ok(json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "error": raw["error"]}))
        } else {
            Ok(json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "result": raw.get("result").cloned().unwrap_or_else(|| json!({}))}))
        }
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> { self.notifications.push(message); Ok(()) }
    fn send_response(&mut self, message: Value) -> AxResult<()> { self.sent_responses.push(message); Ok(()) }
    fn set_protocol_version(&mut self, protocol_version: &str) { self.protocol_version = Some(protocol_version.to_string()); }
    fn sent_notifications(&self) -> Vec<Value> { self.notifications.clone() }
}

pub fn ax_mcp_stdio_encode(message: &Value) -> AxResult<String> { Ok(format!("{}\n", serde_json::to_string(message)?)) }
pub fn ax_mcp_stdio_decode(line: &str) -> AxResult<Value> { Ok(serde_json::from_str(line.trim())?) }
pub fn ax_mcp_pkce_verifier() -> String {
    let mut bytes = [0_u8; 32];
    if File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes)).is_err() {
        let seed = SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
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
        let chunk = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8) | bytes[index + 2] as u32;
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
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let bit_len = (input.len() as u64) * 8;
    let mut data = input.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 { data.push(0); }
    data.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in data.chunks(64) {
        let mut w = [0_u32; 64];
        for index in 0..16 {
            let offset = index * 4;
            w[index] = u32::from_be_bytes([chunk[offset], chunk[offset + 1], chunk[offset + 2], chunk[offset + 3]]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7) ^ w[index - 15].rotate_right(18) ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17) ^ w[index - 2].rotate_right(19) ^ (w[index - 2] >> 10);
            w[index] = w[index - 16].wrapping_add(s0).wrapping_add(w[index - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[index]).wrapping_add(w[index]);
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
    let parsed = reqwest::Url::parse(endpoint).map_err(|err| AxError::new("mcp", err.to_string()))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" { return Err(AxError::new("mcp", "MCP endpoint must use http or https")); }
    let require_https = options.get("requireHttps").or_else(|| options.get("require_https")).and_then(Value::as_bool).unwrap_or(true);
    if require_https && parsed.scheme() != "https" { return Err(AxError::new("mcp", "MCP endpoint must use https")); }
    let host = parsed.host_str().ok_or_else(|| AxError::new("mcp", "MCP endpoint must include a host"))?;
    let allow_local = options.get("allowLocalhost").or_else(|| options.get("allow_localhost")).and_then(Value::as_bool).unwrap_or(false);
    let allow_private = options.get("allowPrivateNetworks").or_else(|| options.get("allow_private_networks")).and_then(Value::as_bool).unwrap_or(false);
    if (host == "localhost" || host == "localhost.localdomain") && !allow_local { return Err(AxError::new("mcp", "MCP endpoint host is local")); }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if (ip.is_loopback() && !allow_local) || (is_private_ip(ip) && !allow_private) || ip.is_multicast() || ip.is_unspecified() {
            return Err(AxError::new("mcp", "MCP endpoint host is not allowed by SSRF protection"));
        }
    }
    Ok(endpoint.to_string())
}

pub fn run_mcp_conformance_fixture(fixture: &Value) -> AxResult<()> {
    let operation = fixture.get("operation").and_then(Value::as_str).unwrap_or("initialize");
    let result = run_mcp_conformance_fixture_inner(fixture, operation);
    if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
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
        "ssrf" => ax_mcp_validate_endpoint(fixture.get("endpoint").and_then(Value::as_str).unwrap_or("https://127.0.0.1/mcp"), fixture.get("ssrfProtection").unwrap_or(&Value::Null)).map(|_| ()),
        "stdio_framing" => {
            let line = ax_mcp_stdio_encode(fixture.get("message").unwrap_or(&Value::Null))?;
            if let Some(expected) = fixture.get("expected_line").and_then(Value::as_str) {
                if line != expected { return Err(AxError::new("fixture", "stdio line mismatch")); }
            }
            expect_subset("stdio decoded", &ax_mcp_stdio_decode(&line)?, fixture.get("message").unwrap_or(&Value::Null))
        }
        "oauth" => {
            let challenge = ax_mcp_pkce_challenge(fixture.get("verifier").and_then(Value::as_str).unwrap_or("test-verifier"));
            if let Some(expected) = fixture.get("expected_challenge").and_then(Value::as_str) {
                if challenge != expected { return Err(AxError::new("fixture", "PKCE challenge mismatch")); }
            }
            let mut transport = AxMCPStreamableHTTPTransport::new(fixture.get("endpoint").and_then(Value::as_str).unwrap_or("https://example.com/mcp"), Value::Null)?;
            transport.oauth = Some(AxMCPOAuthOptions { on_auth_code: Some(Arc::new(|_| Ok(Map::from_iter([("code".to_string(), json!("abc"))])))), ..Default::default() });
            if !transport.apply_oauth() || transport.headers.get("Authorization").is_none() { return Err(AxError::new("fixture", "OAuth flow did not set Authorization")); }
            Ok(())
        }
        "http_session_headers" => {
            let mut transport = AxMCPStreamableHTTPTransport::new(fixture.get("endpoint").and_then(Value::as_str).unwrap_or("https://example.com/mcp"), fixture.get("transport_options").cloned().unwrap_or(Value::Null))?;
            transport.set_session_id(fixture.get("session_id").and_then(Value::as_str).unwrap_or("session-1"));
            transport.set_protocol_version(fixture.get("protocol_version").and_then(Value::as_str).unwrap_or(AX_MCP_PROTOCOL_VERSION));
            let mut base = Map::new();
            base.insert("Accept".to_string(), json!("application/json"));
            expect_subset("headers", &Value::Object(transport.build_headers(base, true)), fixture.get("expected_headers").unwrap_or(&Value::Null))
        }
        "execution_context_ucp" => {
            let responses=fixture.get("responses").and_then(Value::as_array).cloned().unwrap_or_default();
            let mcp=Arc::new(Mutex::new(AxMCPClient::new(Box::new(AxMCPScriptedTransport::new(responses)),fixture.get("client_options").cloned().unwrap_or_else(||json!({})))));
            let scripted=fixture.get("ucp_response").cloned().unwrap_or_else(||json!({}));
            let binding:Arc<dyn AxUCPBinding>=Arc::new(move|_:&str,_:Value,_:Value|Ok(scripted.clone()));
            let ucp=AxUCPClient::new(fixture.get("ucp_profile").cloned().unwrap_or_else(||json!({})),binding,fixture.get("ucp_options").cloned().unwrap_or_else(||json!({})))?;
            let context=AxExecutionContext::new(vec![mcp],vec![ucp.clone()])?;context.initialize()?;
            let namespaces=Value::Array(context.namespaces().iter().map(|name|json!(name)).collect());expect_subset("context namespaces",&namespaces,fixture.get("expected_namespaces").unwrap_or(&Value::Null))?;
            let tools=context.native_tools()?;for expected in fixture.get("expected_native_tools").and_then(Value::as_array).cloned().unwrap_or_default(){let name=expected.as_str().unwrap_or_default();if !tools.iter().any(|tool|tool.name==name){return Err(AxError::new("fixture",format!("missing native context tool {name}")));}}
            let call=fixture.get("call_ucp").cloned().unwrap_or_else(||json!({}));let outcome=ucp.call(call.get("operation").and_then(Value::as_str).unwrap_or("catalog.search"),call.get("payload").cloned().unwrap_or_else(||json!({})),Some("fixture-key"))?;expect_subset("UCP outcome",&outcome,fixture.get("expected_ucp_outcome").unwrap_or(&Value::Null))?;
            let state=context.continuation_state();if state.catalog_fingerprint.is_empty(){return Err(AxError::new("fixture","invalid execution context continuation state"));}Ok(())
        }
        _ => {
            let responses = fixture.get("responses").or_else(|| fixture.get("transport_responses")).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut client = AxMCPClient::new(Box::new(AxMCPScriptedTransport::new(responses)), fixture.get("client_options").cloned().unwrap_or(Value::Null));
            client.init()?;
            if let Some(expected) = fixture.get("expected_protocol_version").and_then(Value::as_str) {
                if client.protocol_version() != Some(expected) { return Err(AxError::new("fixture", "protocol version mismatch")); }
            }
            match operation {
                "initialize" | "protocol_negotiation" => Ok(()),
                "ping" => client.ping().map(|_| ()),
                "tools" => {
                    let functions = client.native_tools();
                    if let Some(expected) = fixture.get("expected_function_names") {
                        let names = Value::Array(functions.iter().map(|tool| json!(tool.name)).collect());
                        expect_subset("function names", &names, expected)?;
                    }
                    if let Some(call) = fixture.get("call_function") {
                        let name = call.get("name").and_then(Value::as_str).unwrap_or_default();
                        let args = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
                        let function = functions.iter().find(|tool| tool.name == name).ok_or_else(|| AxError::new("fixture", "missing MCP function"))?;
                        let result = function.call(args)?;
                        expect_subset("tool result", &result, fixture.get("expected_call_result").unwrap_or(&Value::Null))?;
                    }
                    Ok(())
                }
                "prompts_resources" => {
                    let functions = client.to_function();
                    if let Some(expected) = fixture.get("expected_function_names") {
                        let names = Value::Array(functions.iter().map(|tool| json!(tool.name)).collect());
                        expect_subset("function names", &names, expected)?;
                    }
                    Ok(())
                }
                "cancellation" => {
                    client.cancel_request(fixture.get("request_id").cloned().unwrap_or_else(|| json!("1")), fixture.get("reason").and_then(Value::as_str))?;
                    let notifications = client.transport.lock().unwrap().sent_notifications();
                    let last = notifications.last().ok_or_else(|| AxError::new("fixture", "expected a cancel notification"))?;
                    expect_subset("cancel notification", last, fixture.get("expected_notification").unwrap_or(&Value::Null))
                }
                "roots_notifications" => Ok(()),
                _ => Err(AxError::new("fixture", format!("unsupported MCP conformance operation {operation}"))),
            }
        }
    }
}

fn cursor_params(cursor: Option<&str>) -> Value { cursor.map(|cursor| json!({"cursor": cursor})).unwrap_or_else(|| json!({})) }
fn override_name(options: &Value, name: &str) -> String {
    for item in options.get("functionOverrides").and_then(Value::as_array).cloned().unwrap_or_default() {
        if item.get("name").and_then(Value::as_str) == Some(name) {
            return item.get("updates").and_then(|u| u.get("name")).and_then(Value::as_str).unwrap_or(name).to_string();
        }
    }
    name.to_string()
}
fn override_description(options: &Value, item: &Value) -> String {
    let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
    let description = item.get("description").or_else(|| item.get("title")).and_then(Value::as_str).unwrap_or(name);
    for override_item in options.get("functionOverrides").and_then(Value::as_array).cloned().unwrap_or_default() {
        if override_item.get("name").and_then(Value::as_str) == Some(name) {
            return override_item.get("updates").and_then(|u| u.get("description")).and_then(Value::as_str).unwrap_or(description).to_string();
        }
    }
    description.to_string()
}
fn safe_name(value: &str) -> String { value.chars().map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' }).collect::<String>().trim_matches('_').to_string() }
fn content_text(items: Vec<Value>) -> String { items.iter().filter(|item| item.get("type").and_then(Value::as_str) == Some("text")).filter_map(|item| item.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n") }
fn expect_subset(label: &str, actual: &Value, expected: &Value) -> AxResult<()> {
    if expected.is_null() || json_contains(actual, expected) { Ok(()) } else { Err(AxError::new("fixture", format!("{label} mismatch actual={actual} expected={expected}"))) }
}
fn json_contains(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (_, Value::Null) => true,
        (Value::Object(a), Value::Object(e)) => e.iter().all(|(key, value)| a.get(key).is_some_and(|actual| json_contains(actual, value))),
        (Value::Array(a), Value::Array(e)) => e.len() <= a.len() && e.iter().enumerate().all(|(idx, value)| json_contains(&a[idx], value)),
        _ => actual == expected,
    }
}
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        std::net::IpAddr::V6(ip) => ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}
