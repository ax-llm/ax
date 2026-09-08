use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex,
};

#[derive(Clone, Default)]
pub struct AxRunControl(Arc<ControlState>);
#[derive(Default)]
struct ControlState {
    parent:Option<AxRunControl>,
    relay:Option<Arc<dyn Fn(Value)+Send+Sync>>,
    aborted: AtomicBool,
    updates: Mutex<Vec<Value>>,
    listeners: Mutex<Vec<Arc<dyn Fn(Value) + Send + Sync>>>,
}
pub(crate) fn worker_control(parent:Option<AxRunControl>,relay:impl Fn(Value)+Send+Sync+'static)->AxRunControl{AxRunControl(Arc::new(ControlState{parent,relay:Some(Arc::new(relay)),..ControlState::default()}))}
pub(crate) fn emit_worker_event(control:&AxRunControl,event:Value){control.emit(event)}
pub fn run_control() -> AxRunControl {
    AxRunControl::default()
}
impl AxRunControl {
    pub fn abort(&self) {
        if !self.0.aborted.swap(true, Ordering::SeqCst) {
            self.emit(json!({"type":"aborted","path":"root"}));
        }
    }
    pub fn is_aborted(&self) -> bool {
        self.0.aborted.load(Ordering::SeqCst) || self.0.parent.as_ref().is_some_and(|parent|parent.is_aborted())
    }
    pub fn on_event(&self, listener: impl Fn(Value) + Send + Sync + 'static) {
        self.0.listeners.lock().unwrap().push(Arc::new(listener));
    }
    pub fn steer(&self, text: impl Into<String>) -> AxResult<()> {
        self.steer_at(text, "root")
    }
    pub fn steer_at(&self, text: impl Into<String>, target: &str) -> AxResult<()> {
        let text = text.into();
        if text.trim().is_empty() {
            return Err(AxError::runtime("Steering text must not be empty"));
        }
        self.enqueue(json!({"type":"steer","text":text,"target":target}))
    }
    pub fn set_thinking_token_budget(&self, level: &str) -> AxResult<()> {
        self.set_thinking_token_budget_at(level, "root")
    }
    pub fn set_thinking_token_budget_at(&self, level: &str, target: &str) -> AxResult<()> {
        if !["none", "minimal", "low", "medium", "high", "highest"].contains(&level) {
            return Err(AxError::runtime("Invalid thinking token budget"));
        }
        self.enqueue(json!({"type":"thinking","level":level,"target":target}))
    }
    fn enqueue(&self, mut update: Value) -> AxResult<()> {
        if self.is_aborted() {
            return Err(AxError::runtime("Run controller is aborted"));
        }
        let mut updates = self.0.updates.lock().unwrap();
        let id = (updates.len() + 1).to_string();
        update["id"] = json!(id);
        updates.push(update.clone());
        drop(updates);
        self.emit(json!({"type":"queued","path":update["target"],"update_id":id}));
        Ok(())
    }
    fn emit(&self, event: Value) {
        if let Some(relay)=&self.0.relay{relay(event);return;}
        let listeners = self.0.listeners.lock().unwrap().clone();
        for listener in listeners {
            listener(event.clone());
        }
    }
    fn pending(&self, path: &str, after: usize) -> AxResult<(Vec<Value>, usize)> {
        if let Some(parent)=&self.0.parent{return parent.pending(path,after);}
        let updates = self.0.updates.lock().unwrap();
        let mut out = Vec::new();
        for update in updates.iter().skip(after) {
            if core_truthy(&chat_session_target_matches(&[
                core_value_from_json(&update["target"]),
                CoreValue::from(path),
            ])?) {
                out.push(update.clone());
            }
        }
        Ok((out, updates.len()))
    }
}

// Scoped client callbacks carry JSON, so transfer session ownership through a
// thread-local slot during their synchronous invocation, never through wire data.
thread_local! {
    static OPENED_SESSION: std::cell::RefCell<Option<Box<dyn AxChatSession>>> = const { std::cell::RefCell::new(None) };
}
pub(crate) fn publish_open_session(value: Option<Box<dyn AxChatSession>>) -> Value {
    let opened=value.is_some();
    OPENED_SESSION.with(|slot| *slot.borrow_mut()=value);
    json!(opened)
}
pub(crate) fn take_open_session() -> Option<Box<dyn AxChatSession>> {
    OPENED_SESSION.with(|slot| slot.borrow_mut().take())
}

/// Existing JSON options remain accepted by forward_with_options. This wrapper
/// carries the optional controller without serializing a native handle.
#[derive(Clone, Default)]
pub struct AxForwardOptions {
    pub options: Value,
    pub control: Option<AxRunControl>,
}
impl From<Value> for AxForwardOptions {
    fn from(options: Value) -> Self {
        Self {
            options,
            control: None,
        }
    }
}
impl AxForwardOptions {
    pub fn with_control(mut self, control: AxRunControl) -> Self {
        self.control = Some(control);
        self
    }
}
thread_local! { static CONTROLS:RefCell<Vec<AxRunControl>>=const {RefCell::new(Vec::new())}; }
pub(crate) fn current_control() -> Option<AxRunControl> {
    CONTROLS.with(|stack| stack.borrow().last().cloned())
}
pub(crate) fn with_control<R>(options: AxForwardOptions, run: impl FnOnce(Value) -> R) -> R {
    struct Guard(bool);
    impl Drop for Guard {
        fn drop(&mut self) {
            if self.0 {
                CONTROLS.with(|stack| {
                    stack.borrow_mut().pop();
                });
            }
        }
    }
    let control = options.control.or_else(current_control);
    let mut value = options.options;
    if let Some(control) = control {
        CONTROLS.with(|stack| stack.borrow_mut().push(control));
        if !value.is_object() {
            value = json!({});
        }
        value["control"] = json!(true);
        let _guard = Guard(true);
        run(value)
    } else {
        run(value)
    }
}

pub trait AxChatSession {
    fn next(&mut self, timeout: Duration) -> AxResult<Option<Value>>;
    fn submit(&mut self, results: Vec<Value>) -> AxResult<()>;
    fn update(&mut self, update: &Value) -> AxResult<&'static str>;
    fn close(&mut self);
}
/// Optional host WebSocket seam. Receives are bounded; disconnection is an error,
/// while a timeout returns None. Implementations permit send/close during recv.
pub trait AxSessionSocket: Send + Sync {
    fn send(&self, event: Value) -> AxResult<()>;
    fn recv(&self, timeout: Duration) -> AxResult<Option<Value>>;
    fn close(&self);
}
pub type AxSessionWebSocketFactory = Arc<dyn Fn(&str, &Value) -> AxResult<Arc<dyn AxSessionSocket>> + Send + Sync>;
#[cfg(feature = "realtime")]
struct NativeSessionSocket {
    socket: Mutex<WsRealtimeTransport>,
    connection: std::net::TcpStream,
    closed: AtomicBool,
}
#[cfg(feature = "realtime")]
impl AxSessionSocket for NativeSessionSocket {
    fn send(&self,event:Value)->AxResult<()> {
        if self.closed.load(Ordering::SeqCst){return Err(AxError::runtime("Session socket closed"));}
        self.socket.lock().map_err(|_|AxError::runtime("Session socket lock poisoned"))?.send(&event)
    }
    fn recv(&self,timeout:Duration)->AxResult<Option<Value>> {
        if self.closed.load(Ordering::SeqCst){return Err(AxError::runtime("Session socket closed"));}
        let mut socket=self.socket.lock().map_err(|_|AxError::runtime("Session socket lock poisoned"))?;
        self.connection.set_read_timeout(Some(timeout.max(Duration::from_millis(1)).min(Duration::from_millis(20))))?;
        match socket.socket.read() {
            Ok(tungstenite::Message::Text(text))=>Ok(Some(serde_json::from_str(text.as_str())?)),
            Ok(tungstenite::Message::Binary(bytes))=>Ok(Some(serde_json::from_slice(&bytes)?)),
            Ok(tungstenite::Message::Close(_))=>Err(AxError::runtime("Responses socket disconnected; work was not replayed")),
            Ok(_)=>Ok(None),
            Err(tungstenite::Error::Io(error)) if matches!(error.kind(),std::io::ErrorKind::WouldBlock|std::io::ErrorKind::TimedOut)=>Ok(None),
            Err(error)=>Err(AxError::runtime(format!("Responses socket failed; work was not replayed: {error}"))),
        }
    }
    fn close(&self) {
        if !self.closed.swap(true,Ordering::SeqCst){let _=self.connection.shutdown(std::net::Shutdown::Both);}
    }
}
#[cfg(feature = "realtime")]
pub(crate) fn native_session_socket(url:&str,headers:&Value)->AxResult<Arc<dyn AxSessionSocket>> {
    let headers=headers.as_object().into_iter().flatten().map(|(key,value)|(key.clone(),value.as_str().unwrap_or_default().to_string())).collect();
    let mut socket=WsRealtimeTransport::connect(url,headers)?;
    let connection=match socket.socket.get_mut() {
        tungstenite::stream::MaybeTlsStream::Plain(stream)=>stream.try_clone()?,
        tungstenite::stream::MaybeTlsStream::Rustls(stream)=>stream.sock.try_clone()?,
        _=>return Err(AxError::runtime("Unsupported session TLS transport")),
    };
    connection.set_read_timeout(Some(Duration::from_millis(20)))?;
    connection.set_write_timeout(Some(Duration::from_secs(30)))?;
    Ok(Arc::new(NativeSessionSocket{socket:Mutex::new(socket),connection,closed:AtomicBool::new(false)}))
}

pub(crate) struct SharedTransport(pub Arc<Mutex<Box<dyn AxTransport>>>);
pub(crate) struct ResponsesSession {
    model: String,
    base: Value,
    call: Value,
    previous: Option<String>,
    updates: Vec<Value>,
    wire: CoreValue,
    pending: std::collections::VecDeque<Value>,
    sender: mpsc::Sender<AxResult<Value>>,
    receiver: mpsc::Receiver<AxResult<Value>>,
    transport: Option<Arc<Mutex<Box<dyn AxTransport>>>>,
    cancelled: Arc<AtomicBool>,
    last_was_update: bool,
    socket: Option<Arc<dyn AxSessionSocket>>,
    transport_cursor: Arc<Mutex<Value>>,
}
// The HTTP worker owns an async reqwest request so dropping it on cancellation
// closes a stalled body read. Public generation and tool handlers stay synchronous.
async fn session_http_wait<T>(
    future: impl std::future::Future<Output = Result<T, reqwest::Error>>,
    cancelled: &AtomicBool,
) -> AxResult<Option<T>> {
    let mut future = std::pin::pin!(future);
    loop {
        if cancelled.load(Ordering::SeqCst) { return Ok(None); }
        match tokio::time::timeout(Duration::from_millis(10), future.as_mut()).await {
            Ok(result) => return result.map(Some).map_err(|error| {
                let timeout=error.is_timeout();let mut error=AxError::from(error);
                if timeout {error.error_type=Some("AxAIServiceTimeoutError".into());error.message=format!("Responses HTTP request timed out; work was not replayed: {}",error.message);}
                error
            }),
            Err(_) => continue,
        }
    }
}
fn session_http_stream(call: Value, cancelled: &AtomicBool, sender: &mpsc::Sender<AxResult<Value>>) -> AxResult<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(60)).build()?;
        let method = call["method"].as_str().unwrap_or("POST").parse::<reqwest::Method>()
            .map_err(|error| AxError::new("validation", format!("invalid HTTP method: {error}")))?;
        let mut request = client.request(method, call["url"].as_str().unwrap_or(""));
        if let Some(headers) = call["headers"].as_object() {
            for (key,value) in headers { request = request.header(key.as_str(),value.as_str().unwrap_or("")); }
        }
        let Some(mut response) = session_http_wait(request.json(&call["json"]).send(),cancelled).await? else { return Ok(()); };
        let status = response.status().as_u16();
        if status >= 400 {
            let Some(bytes) = session_http_wait(response.bytes(),cancelled).await? else { return Ok(()); };
            let body = serde_json::from_slice(&bytes).unwrap_or_else(|_|json!(String::from_utf8_lossy(&bytes)));
            normalize_passthrough_response(json!({"status":status,"json":body}))?;
            return Err(AxError::runtime(format!("Session HTTP request failed: {status}")));
        }
        let mut decoder = SseJsonStream::new(Box::new(std::io::empty()));
        while let Some(chunk) = session_http_wait(response.chunk(),cancelled).await? {
            let Some(chunk) = chunk else { break; };
            for byte in chunk {
                if decoder.skip_lf {decoder.skip_lf=false;if byte==b'\n' {continue;}}
                let event = if byte==b'\r'||byte==b'\n' {
                    decoder.skip_lf=byte==b'\r';decoder.process_line()?
                } else {decoder.line.push(byte);None};
                if let Some(event) = event {
                    let completed = event["type"]=="response.completed" || (event["type"]=="response.incomplete" && event["response"]["incomplete_details"]["reason"]=="steered");
                    if sender.send(Ok(event)).is_err() || completed {return Ok(());}
                }
                if decoder.done {break;}
            }
        }
        if cancelled.load(Ordering::SeqCst) {Ok(())} else {Err(AxError::runtime("Responses stream disconnected before completion; work was not replayed"))}
    })
}

impl ResponsesSession {
    pub(crate) fn open(
        client: &mut OpenAICompatibleClient,
        mut request: Value,
        options: Value,
    ) -> AxResult<Self> {
        let model = request
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(&client.model)
            .to_string();
        let merged = merge_ai_options(&client.options, &options)?;
        let config = merge_model_config(&[
            core_value_from_json(&client.model_config),
            core_value_from_json(&request["model_config"]),
            core_value_from_json(&merged),
        ])?;
        request["model"] = json!(model);
        request["model_config"] = core_value_to_json(&config);
        request["model_config"]["stream"] = json!(true);
        request["session_enabled"] = json!(true);
        let base = core_value_to_json(&provider_build_chat_request(&[
            CoreValue::from(client.profile.as_str()),
            core_value_from_json(&request),
            core_value_from_json(&merged),
        ])?);
        let call = client.provider_transport_request("stream_chat", &base, &model, true)?;
        if let Some(transport) = client.transport.take() {
            client.session_transport = Some(Arc::new(Mutex::new(transport)));
        }
        let socket=if let Some(factory)=&client.session_socket_factory {
            let target=call["url"].as_str().unwrap_or("").replacen("https:","wss:",1).replacen("http:","ws:",1);
            Some(factory(&target,&call["headers"])? )
        } else {None};
        let (sender, receiver) = mpsc::channel();
        let mut session = Self {
            model,
            base: base.clone(),
            call,
            previous: None,
            updates: Vec::new(),
            wire: core_value_from_json(&json!({})),
            pending: std::collections::VecDeque::new(),
            sender,
            receiver,
            transport: client.session_transport.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
            last_was_update: false,
            socket,
            transport_cursor: Arc::new(Mutex::new(json!({}))),
        };
        if let Some(socket)=session.socket.clone() {
            let cancelled=session.cancelled.clone();let sender=session.sender.clone();let cursor=session.transport_cursor.clone();
            std::thread::spawn(move || {
                let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> AxResult<()> {
                    while !cancelled.load(Ordering::SeqCst) {if let Some(event)=socket.recv(Duration::from_millis(10))? {{let mut state=cursor.lock().map_err(|_|AxError::runtime("Session cursor poisoned"))?;*state=core_value_to_json(&openai_responses_transport_cursor(&[core_value_from_json(&state),core_value_from_json(&event)])?);}if sender.send(Ok(event)).is_err(){break;}}}Ok(())
                })).unwrap_or_else(|_|Err(AxError::runtime("Session socket panicked; work was not replayed")));
                if let Err(error)=result {if !cancelled.load(Ordering::SeqCst) {let _=sender.send(Err(error));}}
            });
        }
        session.send(base)?;
        Ok(session)
    }
    fn send(&mut self, payload: Value) -> AxResult<()> {
        openai_responses_validate_session_request(&[core_value_from_json(&payload)])?;
        let items = payload["input"].as_array().cloned().unwrap_or_default();
        if self.last_was_update
            && items.first().and_then(|v| v["type"].as_str()) == Some("configuration_update")
        {
            return Err(AxError::runtime(
                "Adjacent configuration_update items are not supported",
            ));
        }
        self.last_was_update =
            items.last().and_then(|v| v["type"].as_str()) == Some("configuration_update");
        if self.cancelled.load(Ordering::SeqCst) {return Err(AxError::runtime("Session closed"));}

        if let Some(socket)=&self.socket {let mut payload=payload;payload.as_object_mut().unwrap().remove("stream");payload["type"]=json!("response.create");return socket.send(payload);}
        let mut call = self.call.clone();
        call["json"] = payload;
        let sender = self.sender.clone();
        let transport = self.transport.clone();
        let cancelled = self.cancelled.clone();
        std::thread::spawn(move || {
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> AxResult<()> {
                    if transport.is_none() { return session_http_stream(call, &cancelled, &sender); }
                    let iterator = if let Some(transport) = transport {
                        let stream = transport
                            .lock()
                            .map_err(|_| AxError::runtime("Transport lock poisoned"))?
                            .stream(call)?;
                        OpenAICompatibleClient::transport_stream_iter(stream)?
                    } else {
                        unreachable!("Native HTTP handled above")
                    };
                    let mut completed = false;
                    for event in iterator {
                        if cancelled.load(Ordering::SeqCst) {
                            return Ok(());
                        }
                        let event = event?;
                        let kind = event["type"].as_str().unwrap_or("");
                        if kind == "response.completed"
                            || (kind == "response.incomplete"
                                && event["response"]["incomplete_details"]["reason"] == "steered")
                        {
                            completed = true;
                        }
                        if sender.send(Ok(event)).is_err() {
                            return Ok(());
                        }
                        if completed { break; }
                    }
                    if !completed && !cancelled.load(Ordering::SeqCst) {
                        return Err(AxError::runtime(
                        "Responses stream disconnected before completion; work was not replayed",
                    ));
                    }
                    Ok(())
                }))
                .unwrap_or_else(|_| {
                    Err(AxError::runtime(
                        "Session transport panicked; work was not replayed",
                    ))
                });
            if let Err(error) = result {
                if !cancelled.load(Ordering::SeqCst) {
                    let _ = sender.send(Err(error));
                }
            }
        });
        Ok(())
    }
}
impl AxChatSession for ResponsesSession {
    fn next(&mut self, timeout: Duration) -> AxResult<Option<Value>> {
        loop {
            if let Some(event) = self.pending.pop_front() {
                if event["type"] == "response.completed" {

                    self.previous = event["response_id"].as_str().map(str::to_string);
                }
                return Ok(Some(event));
            }
            match self.receiver.recv_timeout(timeout) {
                Ok(event) => {
                    let event=event?;if event["type"]=="response.created" {self.previous=event["response"]["id"].as_str().map(str::to_string);}
                    let events = openai_responses_session_event(&[
                        core_value_from_json(&event),
                        self.wire.clone(),
                        CoreValue::from(self.model.as_str()),
                    ])?;
                    for event in core_value_to_json(&events)
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                    {
                        self.pending.push_back(event);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => return Ok(None),
                Err(_) => return Err(AxError::runtime("Session disconnected")),
            }
        }
    }
    fn submit(&mut self, results: Vec<Value>) -> AxResult<()> {
        let mut input = self.updates.clone();
        for result in results {
            input.push(json!({"type":"function_call_output","call_id":result["function_id"],"output":result["result"]}));
        }
        let mut payload = self.base.clone();
        payload["previous_response_id"] = json!(self.previous);
        payload["input"] = json!(input);
        self.send(payload)?;
        self.updates.clear();
        Ok(())
    }
    fn update(&mut self, update: &Value) -> AxResult<&'static str> {
        {let cursor=self.transport_cursor.lock().map_err(|_|AxError::runtime("Session cursor poisoned"))?;
        if update["type"] == "steer" && !cursor["active_id"].is_null() {
            if let Some(socket)=&self.socket {socket.send(json!({"type":"response.steer","previous_response_id":cursor["active_id"],"input":[{"role":"user","content":[{"type":"input_text","text":update["text"]}]}]}))?;return Ok("native");}
        }
        }
        if update["type"] == "steer" {
            self.updates.push(
                json!({"role":"user","content":[{"type":"input_text","text":update["text"]}]}),
            );
        } else {
            if self.updates.last().and_then(|v| v["type"].as_str()) == Some("configuration_update")
            {
                return Err(AxError::runtime(
                    "Adjacent configuration_update items are not supported",
                ));
            }
            let effort = openai_reasoning_effort(&[
                CoreValue::from(self.model.as_str()),
                core_value_from_json(&update["level"]),
            ])?;
            self.updates.push(json!({"type":"configuration_update","reasoning":{"effort":core_value_to_json(&effort)}}));
        }
        Ok("next-response")
    }
    fn close(&mut self) {
        if !self.cancelled.swap(true, Ordering::SeqCst) {if let Some(socket)=&self.socket {socket.close();}}
    }
}
impl Drop for ResponsesSession {
    fn drop(&mut self) {
        self.close();
    }
}

struct ToolResult {
    call: Value,
    result: AxResult<Value>,
}
pub(crate) fn dispatch_run_route(client:&mut dyn AxAIClient,method:&str,envelope:Value,options:Value)->AxResult<Value> {
    fn resolve<'a>(mut client:&'a mut dyn AxAIClient,routes:&[Value])->AxResult<&'a mut dyn AxAIClient>{
        for route in routes{client=client.pinned_chat_run_client(route.as_str().ok_or_else(||AxError::validation("Invalid run route"))?)?;}Ok(client)
    }
    let routes=envelope["route"].as_array().cloned().unwrap_or_default();
    let client=resolve(client,&routes)?;let request=envelope["request"].clone();
    match method {
        "route_owned_worker"=>Ok(publish_owned_client_factory(client.owned_worker_factory())),
        "route_select"=>Ok(client.pin_chat_run(&request,&options)?.map(Value::String).unwrap_or(Value::Null)),
        "route_features"=>Ok(client.get_features(request.as_str())),
        "route_preprocess"=>client.preprocess_pinned_chat_run(request["selected"].as_str().ok_or_else(||AxError::validation("Invalid run route"))?,request["request"].clone()),
        "route_open_session"=>Ok(publish_open_session(client.open_chat_session(request,options)?)),
        "route_observe_session"=>{client.observe_chat_session_response(&request,&options);Ok(Value::Null)},
        "route_chat"=>client.chat_with_options(request,options),
        "route_transcribe"=>client.transcribe(request),
        _=>Err(AxError::validation("Invalid run route operation")),
    }
}

fn pinned_run_client<'a>(client:&'a mut dyn AxAIClient,request:&mut Value,options:&Value,routes:&mut Vec<String>,depth:usize,selected:bool)->AxResult<&'a mut dyn AxAIClient> {
    if depth>=32{return Err(AxError::runtime("Cyclic run routing"));}
    let route=if selected {routes.get(depth).cloned()} else {let route=client.pin_chat_run(request,options)?;if let Some(route)=&route{routes.push(route.clone());}route};
    if let Some(route)=route {*request=client.preprocess_pinned_chat_run(&route,std::mem::take(request))?;pinned_run_client(client.pinned_chat_run_client(&route)?,request,options,routes,depth+1,selected)} else {Ok(client)}
}

pub(crate) struct SessionRun {
    routes: Vec<String>,
    route_selected: bool,
    session: Option<Box<dyn AxChatSession>>,
    state: CoreValue,
    gen: CoreValue,
    tools: Vec<Tool>,
    options: Value,
    control: Option<AxRunControl>,
    path: String,
    after: usize,
    applied: Vec<String>,
    last: Option<Value>,
    results: mpsc::Receiver<ToolResult>,
    sender: mpsc::Sender<ToolResult>,
    cancelled: Arc<AtomicBool>,
    blocking: bool,
    waiting: Vec<Value>,
    level: Value,
    fallback_started: bool,
    finished: bool,
}
impl SessionRun {
    pub(crate) fn new(gen: CoreValue, tools: Vec<Tool>, options: Value) -> Self {
        let (sender, results) = mpsc::channel();
        let path = options
            .get("execution_path")
            .or_else(|| options.get("executionPath"))
            .and_then(Value::as_str)
            .unwrap_or("root")
            .to_string();
        Self {
            routes: Vec::new(),
            route_selected: false,
            session: None,
            state: CoreValue::Null,
            gen,
            tools,
            options,
            control: current_control(),
            path,
            after: 0,
            applied: Vec::new(),
            last: None,
            results,
            sender,
            cancelled: Arc::new(AtomicBool::new(false)),
            blocking: false,
            waiting: Vec::new(),
            level: Value::Null,
            fallback_started: false,
            finished: false,
        }
    }
    fn emit(&self, kind: &str, mut event: Value) {
        if let Some(control) = &self.control {
            event["type"] = json!(kind);
            event["path"] = json!(self.path);
            control.emit(event);
        }
    }
    fn start(&mut self, call: Value) -> AxResult<()> {
        let call=core_value_to_json(&chat_session_normalize_call(&[core_value_from_json(&call)])?);
        let id = call["id"].as_str().unwrap_or("");
        let name = call["function"]["name"].as_str().unwrap_or("");
        if name == "__axOutput" {
            chat_session_defer_final_call(&[self.state.clone(), core_value_from_json(&call)])?;
            return Ok(());
        }
        if core_value_to_json(&self.state)["pending"].get(id).is_some() {
            return Ok(());
        }
        if self.blocking {
            if !self.waiting.iter().any(|v| v["id"] == call["id"]) {
                self.waiting.push(call);
            }
            return Ok(());
        }
        let tool = self.tools.iter().find(|tool| tool.name == name).cloned();
        let arguments = (|| -> AxResult<Value> {
            let args = match &call["function"]["params"] {
                Value::String(text) => serde_json::from_str(text)?,
                value => value.clone(),
            };
            let tool = tool
                .as_ref()
                .ok_or_else(|| AxError::runtime(format!("Function '{name}' not found")))?;
            validate_fields(&[
                core_tool_args_fields(&tool.args)?,
                core_value_from_json(&args),
                CoreValue::from_string(format!("tool.{name}.args")),
            ])?;
            let schema = core_value_from_json(&tool.schema()?);
            chat_session_validate_required_arguments(&[schema, core_value_from_json(&args), CoreValue::from_string(format!("tool.{name}.args"))])?;
            Ok(args)
        })();
        let execution = tool
            .as_ref()
            .map(|tool| tool.execution.as_str())
            .unwrap_or("blocking");
        chat_session_register_call(&[
            self.state.clone(),
            core_value_from_json(&call),
            CoreValue::from(execution),
        ])?;
        let args = match arguments {
            Ok(args) => args,
            Err(error) => {
                let message = _tool_error_message_impl(&[
                    core_value_from_json(&call),
                    CoreValue::Error(Rc::new(error)),
                ])?;
                chat_session_record_result(&[self.gen.clone(),self.state.clone(),core_value_from_json(&call),core_value_from_json(&core_value_to_json(&message)["result"]),CoreValue::Bool(false)])?;
                return Ok(());
            }
        };
        self.blocking = execution != "background";
        self.emit("tool.started", json!({"call_id":id}));
        let tool = tool.unwrap();
        let sender = self.sender.clone();
        let cancelled = self.cancelled.clone();
        let inherited=RUNTIME_HOOK_FRAMES.with(|frames|frames.borrow().clone());
        std::thread::spawn(move || {
            RUNTIME_HOOK_FRAMES.with(|frames|*frames.borrow_mut()=inherited);
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tool.call_with_context(args,AxToolContext{call_id:call["id"].as_str().map(str::to_string),cancelled:cancelled.clone(),..AxToolContext::default()})))
                .unwrap_or_else(|_| Err(AxError::runtime("Tool handler panicked")));
            if !cancelled.load(Ordering::SeqCst) {
                let _ = sender.send(ToolResult { call, result });
            }
        });
        Ok(())
    }
    fn legacy_chat<C: AxAIClient + ?Sized>(
        &mut self,
        client: &mut C,
        request: Value,
        options: Value,
    ) -> AxResult<Value> {
        let Some(control) = self.control.clone() else {
            return client.chat_with_options(request, options);
        };
        if control.is_aborted() {
            return Err(AxError::runtime(
                "Run aborted before the next model request",
            ));
        }
        if !self.fallback_started {
            self.emit("started", json!({}));
            self.fallback_started = true;
        }
        let (updates, after) = control.pending(&self.path, self.after)?;
        self.after = after;
        let request = CORE_REQUEST_STACK
            .with(|stack| stack.borrow().last().cloned())
            .unwrap_or_else(|| core_value_from_json(&request));
        let applied = core_value_to_json(&chat_session_apply_boundary_updates(&[
            request,
            core_value_from_json(&json!(updates)),
            core_value_from_json(&self.level),
        ])?);
        self.level = applied["level"].clone();
        for id in applied["applied"].as_array().cloned().unwrap_or_default() {
            self.emit("applied", json!({"update_id":id,"timing":"next-response"}));
        }
        client.chat_with_options(applied["request"].clone(), options)
    }
    pub(crate) fn chat<C: AxAIClient>(&mut self,client:&mut C,mut request:Value,options:Value)->AxResult<Value> {
        if self.control.as_ref().is_some_and(AxRunControl::is_aborted){return Err(AxError::runtime("Run aborted before selecting a provider"));}
        let enabled=core_truthy(&chat_session_mode_enabled(&[core_value_from_json(&self.options)])?)&&(self.control.is_some()||self.tools.iter().any(|tool|tool.execution=="background"));
        if !enabled {return self.legacy_chat(client,request,options);}
        let client=pinned_run_client(client,&mut request,&options,&mut self.routes,0,self.route_selected)?;
        self.route_selected=true;
        self.chat_selected(client,request,options).map_err(|mut error| {
            if self.session.is_some() && !error.message.contains("unresolved calls:") {
                if let Ok(pending)=chat_session_unresolved(&[self.state.clone()]) {
                    error.message=format!("{}; unresolved calls: {}",error.message,core_value_to_json(&pending));
                }
            }
            error
        })
    }
    fn chat_selected<C: AxAIClient + ?Sized>(
        &mut self,
        client: &mut C,
        request: Value,
        options: Value,
    ) -> AxResult<Value> {
        let enabled = core_truthy(&chat_session_mode_enabled(&[core_value_from_json(&self.options)])?)
            && (self.control.is_some()
                || self.tools.iter().any(|tool| tool.execution == "background"));
        if !enabled {
            return self.legacy_chat(client, request, options);
        }
        if self.session.is_none() {
            if self.control.as_ref().map(AxRunControl::is_aborted).unwrap_or(false) {return Err(AxError::runtime("Run aborted before opening a session"));}
            self.session = client.open_chat_session(request.clone(), options.clone())?;
            if self.session.is_none() {
                return self.legacy_chat(client, request, options);
            }
            self.state = chat_session_create_state(&[
                core_value_from_json(&request["model"]),
                CoreValue::from(self.path.as_str()),
                core_value_from_json(
                    self.options
                        .get("maxSteps")
                        .or_else(|| self.options.get("max_steps"))
                        .unwrap_or(&json!(10)),
                ),
            ])?;
            self.emit("started", json!({}));
        } else {
            if let Some(message) = request["chat_prompt"].as_array().and_then(|v| v.last()) {
                self.session
                    .as_mut()
                    .unwrap()
                    .update(&json!({"type":"steer","text":message["content"]}))?;
            }
            self.submit(Vec::new())?;
        }
        loop {
            if self.control.as_ref().is_some_and(AxRunControl::is_aborted) {
                return Err(AxError::runtime(format!(
                    "Run aborted; unresolved calls: {}",
                    core_value_to_json(&chat_session_unresolved(&[self.state.clone()])?)
                )));
            }
            if let Some(control) = &self.control {
                let (updates, after) = control.pending(&self.path, self.after)?;
                self.after = after;
                for update in updates {
                    chat_session_queue_update(&[
                        self.state.clone(),
                        core_value_from_json(&update),
                    ])?;
                    if self.session.as_mut().unwrap().update(&update)?=="native" {chat_session_native_update(&[self.state.clone(),core_value_from_json(&update["id"])])?;} else {self.applied.push(update["id"].as_str().unwrap_or("").to_string());}
                }
            }
            while let Ok(delivery) = self.results.try_recv() {
                let id = delivery.call["id"].as_str().unwrap_or("");
                let ok = delivery.result.is_ok();
                let result = match delivery.result {
                    Ok(value) => value,
                    Err(error) => core_value_to_json(&_tool_error_message_impl(&[
                        core_value_from_json(&delivery.call),
                        CoreValue::Error(Rc::new(error)),
                    ])?)["result"]
                        .clone(),
                };
                if !core_truthy(&chat_session_record_result(&[self.gen.clone(),self.state.clone(),core_value_from_json(&delivery.call),core_value_from_json(&result),CoreValue::Bool(ok)])?){continue;}
                self.emit("tool.completed", json!({"call_id":id}));
                if core_value_to_json(&self.state)["pending"][id]["execution"] != "background" {
                    self.blocking = false;
                    for call in std::mem::take(&mut self.waiting) {
                        self.start(call)?;
                    }
                }
            }
            if let Some(event) = self
                .session
                .as_mut()
                .unwrap()
                .next(Duration::from_millis(10))?
            {
                if event["type"] == "response" {
                    let output = chat_session_observe_output(&[
                        self.gen.clone(),
                        self.state.clone(),
                        core_value_from_json(&event),
                    ])?;
                    core_axgen_run_streaming_assertions(&[
                        self.gen.clone(),
                        core_value_from_json(&core_value_to_json(&output)["text"]),
                    ])?;
                    self.emit("model.output", core_value_to_json(&output));
                }
                if event["type"]=="steering" {let result=core_value_to_json(&chat_session_native_event(&[self.state.clone(),core_value_from_json(&event)])?);if !result["applied_id"].is_null(){self.emit("applied",json!({"update_id":result["applied_id"],"timing":"native"}));}}
                if event["type"] == "tool.call" {
                    self.start(event["call"].clone())?;
                }
                if event["type"] == "response.completed"
                    && core_truthy(&chat_session_complete_response(&[
                        self.state.clone(),
                        core_value_from_json(&event["response_id"]),
                    ])?)
                {
                    let response = event["response"].clone();
                    client.observe_chat_session_response(&response, &options);
                    let completion =
                        chat_session_completion(&[core_value_from_json(&response),core_value_from_json(&event["response_id"])])?;
                    for call in
                        core_value_to_json(&_response_function_calls_impl(&[completion.clone()])?)
                            .as_array()
                            .cloned()
                            .unwrap_or_default()
                    {
                        self.start(call)?;
                    }
                    if core_truthy(&chat_session_has_continuation_work(&[self.state.clone()])?)
                    {
                        core_axgen_memory_add_response(&[
                            self.gen.clone(),
                            core_value_from_json(&request),
                            completion.clone(),
                        ])?;
                        core_axgen_record_chat_log(&[
                            self.gen.clone(),
                            core_value_from_json(&request),
                            completion,
                        ])?;
                    }
                    self.last = Some(response);
                }
            }
            let action = core_value_to_json(&chat_session_boundary_action(&[self.state.clone()])?);
            match action["type"].as_str().unwrap_or("") {
                "submit" => {
                    self.submit(action["results"].as_array().cloned().unwrap_or_default())?
                }
                "continue" => self.submit(Vec::new())?,
                "validate" => {
                    if let Some(response) = &self.last {
                        return Ok(core_value_to_json(&chat_session_result(&[core_value_from_json(response),core_value_from_json(&core_value_to_json(&self.state)["response_id"])])?));
                    }
                }
                _ => {}
            }
        }
    }
    fn submit(&mut self, results: Vec<Value>) -> AxResult<()> {
        let state = core_value_to_json(&self.state);
        if state["steps"].as_f64().unwrap_or(0.0) >= state["max_steps"].as_f64().unwrap_or(10.0) {
            return Err(AxError::runtime(
                "Maximum model steps exhausted before final completion",
            ));
        }
        self.session.as_mut().unwrap().submit(results.clone())?;
        let ids: Vec<Value> = results
            .iter()
            .map(|result| result["function_id"].clone())
            .collect();
        chat_session_mark_submitted(&[self.state.clone(), core_value_from_json(&json!(ids))])?;
        for id in std::mem::take(&mut self.applied) {
            chat_session_transition(&[
                self.state.clone(),
                core_value_from_json(&json!({"type":"update.applied","id":id})),
            ])?;
            self.emit("applied", json!({"update_id":id,"timing":"next-response"}));
        }
        Ok(())
    }
    pub(crate) fn finish(&mut self, error: Option<&AxError>) {
        if self.finished { return; }
        self.finished = true;
        self.cancelled.store(true, Ordering::SeqCst);
        let pending = if let Some(session) = &mut self.session {
            session.close();
            let _=chat_session_record_unresolved(&[self.gen.clone(),self.state.clone()]);
            chat_session_close_state(&[self.state.clone()]).map(|v| core_value_to_json(&v)).unwrap_or(Value::Null)
        } else { json!([]) };
        if let Some(error) = error {
            self.emit("failed", json!({"error":error.to_string(),"pending_call_ids":pending}));
        } else {
            self.emit("completed", json!({}));
        }
    }

}
impl Drop for SessionRun {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(session) = &mut self.session {
            session.close();
        }
    }
}

#[cfg(test)]
mod tests {
    struct OwnedTestProgram { gen: AxGen, owner_state: Rc<RefCell<usize>> }
    impl AxProgram for OwnedTestProgram {fn program_kind(&self)->&'static str {"OwnedTestProgram"}}
    impl AxExecutableProgram for OwnedTestProgram {
        fn forward(&mut self,client:&mut dyn AxAIClient,input:Value,options:AxForwardOptions)->AxResult<Value>{
            *self.owner_state.borrow_mut()+=1;
            AxExecutableProgram::forward(&mut self.gen,client,input,options)
        }
        fn owned_worker_factory(&self)->Option<AxOwnedProgramFactory>{
            let create=self.gen.owned_worker_factory()?;let count=*self.owner_state.borrow();
            Some(Box::new(move ||Box::new(Self{gen:create(),owner_state:Rc::new(RefCell::new(count))})))
        }
        fn get_chat_log(&self)->Vec<Value>{self.gen.chat_log.clone()}
        fn get_traces(&self)->Vec<Value>{self.gen.traces.clone()}
    }
    #[test]
    fn owned_flow_workers_overlap_http()->AxResult<()> {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0")?;listener.set_nonblocking(true)?;
        let endpoint=format!("http://{}",listener.local_addr()?);
        let (arrived_tx,arrived_rx)=mpsc::channel();let gate=Arc::new((Mutex::new(false),std::sync::Condvar::new()));let server_gate=gate.clone();
        let server=std::thread::spawn(move || {
            let deadline=Instant::now()+Duration::from_secs(5);let mut workers=Vec::new();
            while workers.len()<2&&Instant::now()<deadline {
                match listener.accept(){Ok((mut socket,_))=>{
                    socket.set_nonblocking(false).unwrap();let sender=arrived_tx.clone();let gate=server_gate.clone();workers.push(std::thread::spawn(move ||->Result<(),String>{
                        socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();let mut request=Vec::new();let mut byte=[0u8;1];
                        while !request.ends_with(b"\r\n\r\n"){socket.read_exact(&mut byte).map_err(|e|e.to_string())?;request.push(byte[0]);}
                        let headers=String::from_utf8(request).unwrap();assert!(headers.to_ascii_lowercase().contains("authorization: bearer worker-test"));
                        let length=headers.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").map(|v|v.trim().parse::<usize>().unwrap())).unwrap();let mut body=vec![0;length];socket.read_exact(&mut body).unwrap();sender.send(serde_json::from_slice::<Value>(&body).unwrap()).unwrap();
                        let released=gate.0.lock().unwrap();let (released,timeout)=gate.1.wait_timeout_while(released,Duration::from_secs(3),|released|!*released).unwrap();if timeout.timed_out()&&!*released{return Err("Independent requests did not overlap".into());}drop(released);
                        let body=json!({"id":"reply","choices":[{"index":0,"message":{"role":"assistant","content":"{\"answer\":\"DONE\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}).to_string();
                        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).map_err(|e|e.to_string())?;Ok(())
                    }));
                },Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(1)),Err(error)=>panic!("{error}")}
            }
            assert_eq!(workers.len(),2,"Both nodes must start");for worker in workers{worker.join().unwrap().unwrap();}
        });
        let release=std::thread::spawn(move || {let first=arrived_rx.recv_timeout(Duration::from_secs(3));let second=arrived_rx.recv_timeout(Duration::from_secs(3));*gate.0.lock().unwrap()=true;gate.1.notify_all();assert!(first.is_ok()&&second.is_ok(),"Parallel barrier not reached");});
        let mut client=ai("openai",json!({"api_key":"worker-test","model":"gpt-5.6","api_url":endpoint}))?;
        let client=MultiServiceRouter::new().with_service("smart",client);
        let mut client=AxBalancer::from_clients(vec![Box::new(client)],AxBalancerOptions::default())?;
        let nested=flow("nested").execute("inner",ax("question -> answer")?).returns(json!({"answer":"innerResult.answer"}));
        let custom=OwnedTestProgram{gen:ax("question -> answer")?,owner_state:Rc::new(RefCell::new(0))};
        let mut workflow=flow("overlap")
            .execute_program("first",nested,&json!({"reads":["question"],"writes":["firstResult"],"isBarrier":false}))
            .execute_program("second",custom,&json!({"reads":["question"],"writes":["secondResult"],"isBarrier":false}))
            .returns(json!({"first":"firstResult","second":"secondResult"}));
        let result=workflow.forward_with_options(&mut client,json!({"question":"Ready"}),json!({"stream":false,"model":"smart"}));
        release.join().unwrap();server.join().unwrap();assert_eq!(result?,json!({"first":{"answer":"DONE"},"second":{"answer":"DONE"}}));
        assert_eq!(core_iter(&core_get(&workflow.state,&CoreValue::from("chat_log"),CoreValue::new_list()))?.len(),2);Ok(())
    }

    use super::*;
    use std::sync::atomic::AtomicUsize;
    struct FailureGate {started:AtomicUsize,all:std::sync::Condvar,lock:Mutex<()>,release:AtomicBool,fast:AtomicBool,late:AtomicBool}
    struct FailureTransport(Arc<FailureGate>);
    impl AxTransport for FailureTransport {
        fn owned_worker_factory(&self)->Option<AxOwnedTransportFactory>{let gate=self.0.clone();Some(Box::new(move ||Box::new(FailureTransport(gate))))}
        fn send(&mut self,request:Value)->AxResult<Value>{
            let body=request["json"].to_string();let gate=&self.0;gate.started.fetch_add(1,Ordering::SeqCst);gate.all.notify_all();
            let lock=gate.lock.lock().unwrap();let (guard,timeout)=gate.all.wait_timeout_while(lock,Duration::from_secs(3),|_|gate.started.load(Ordering::SeqCst)<3).unwrap();drop(guard);if timeout.timed_out(){return Err(AxError::runtime("Independent nodes did not overlap"));}
            let content=if body.contains("lateAnswer") {let start=Instant::now();while !gate.release.load(Ordering::SeqCst)&&start.elapsed()<Duration::from_secs(3){std::thread::sleep(Duration::from_millis(1));}assert!(gate.release.load(Ordering::SeqCst));gate.late.store(true,Ordering::SeqCst);json!({"lateAnswer":"LATE"})}
            else if body.contains("failAnswer"){let start=Instant::now();while !gate.fast.load(Ordering::SeqCst)&&start.elapsed()<Duration::from_secs(3){std::thread::sleep(Duration::from_millis(1));}assert!(gate.fast.load(Ordering::SeqCst));json!({"wrong":"invalid"})}else{json!({"fastAnswer":"DONE"})};
            Ok(json!({"status":200,"json":{"id":"reply","choices":[{"index":0,"message":{"role":"assistant","content":content.to_string()},"finish_reason":"stop"}]}}))
        }
    }
    #[test]
    fn owned_flow_failure_discards_late_work()->AxResult<()> {
        let gate=Arc::new(FailureGate{started:AtomicUsize::new(0),all:std::sync::Condvar::new(),lock:Mutex::new(()),release:AtomicBool::new(false),fast:AtomicBool::new(false),late:AtomicBool::new(false)});
        struct Release(Arc<FailureGate>);impl Drop for Release{fn drop(&mut self){self.0.release.store(true,Ordering::SeqCst);}}
        let _release=Release(gate.clone());let observed=gate.clone();let control=run_control();control.on_event(move |event|{if event["type"]=="completed"&&event["path"]=="root/fast"{observed.fast.store(true,Ordering::SeqCst);}});
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-5.6"}))?.with_transport(FailureTransport(gate.clone()));
        let mut workflow=flow("failure").execute("fast",ax("question -> fastAnswer")?).execute("fail",ax("question -> failAnswer")?).execute("late",ax("question -> lateAnswer")?);
        let started=Instant::now();let error=workflow.forward_with_options(&mut client,json!({"question":"Ready"}),AxForwardOptions::from(json!({"stream":false,"maxSteps":1,"validationRetries":0,"infraRetries":0})).with_control(control)).unwrap_err();
        assert!(error.to_string().contains("late"),"{error}");assert!(started.elapsed()<Duration::from_secs(2));assert!(!gate.late.load(Ordering::SeqCst));
        let state=core_value_to_json(&core_get(&workflow.state,&CoreValue::from("completed_state"),CoreValue::Null));assert_eq!(state["fastResult"],json!({"fastAnswer":"DONE"}));
        gate.release.store(true,Ordering::SeqCst);let started=Instant::now();while !gate.late.load(Ordering::SeqCst)&&started.elapsed()<Duration::from_secs(3){std::thread::sleep(Duration::from_millis(1));}assert!(gate.late.load(Ordering::SeqCst));
        assert_eq!(core_value_to_json(&core_get(&workflow.state,&CoreValue::from("completed_state"),CoreValue::Null)),state);assert_eq!(gate.started.load(Ordering::SeqCst),3);Ok(())
    }

    struct ChannelReader {
        source: mpsc::Receiver<Vec<u8>>,
        current: std::io::Cursor<Vec<u8>>,
    }
    impl Read for ChannelReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            loop {
                let n = self.current.read(buffer)?;
                if n > 0 {
                    return Ok(n);
                }
                match self.source.recv() {
                    Ok(bytes) => self.current = std::io::Cursor::new(bytes),
                    Err(_) => return Ok(0),
                }
            }
        }
    }
    fn sse(event: Value) -> Vec<u8> {
        format!("data: {event}\n\n").into_bytes()
    }
    fn completed(id: &str, answer: &str) -> Value {
        json!({"type":"response.completed","response":{"id":id,"model":"gpt-6-astra","output":[{"type":"message","id":format!("msg-{id}"),"content":[{"type":"output_text","text":answer}]}]}})
    }
    struct GatedTransport {
        requests: Arc<AtomicUsize>,
        started: Option<mpsc::Receiver<()>>,
        release: mpsc::Sender<()>,
    }
    impl AxTransport for GatedTransport {
        fn send(&mut self, _: Value) -> AxResult<Value> {
            Err(AxError::runtime("Expected incremental streaming"))
        }
        fn stream(&mut self, request: Value) -> AxResult<AxTransportStream> {
            let n = self.requests.fetch_add(1, Ordering::SeqCst) + 1;
            let payload = &request["json"];
            if n == 1 {
                assert_eq!(payload["tools"][0]["async"], true);
                let started = self.started.take().unwrap();
                let release = self.release.clone();
                let (sender, source) = mpsc::channel();
                std::thread::spawn(move || {
                    sender
                        .send(sse(
                            json!({"type":"response.created","response":{"id":"r1"}}),
                        ))
                        .unwrap();
                    sender.send(sse(json!({"type":"response.function_call_arguments.delta","item_id":"i1","delta":"{"}))).unwrap();
                    let call = json!({"type":"response.output_item.done","item":{"type":"function_call","id":"i1","call_id":"c1","name":"lookup","arguments":"{}"}});
                    sender.send(sse(call.clone())).unwrap();
                    sender.send(sse(call)).unwrap();
                    started
                        .recv_timeout(Duration::from_secs(5))
                        .expect("tool should start while model stream is open");
                    release.send(()).unwrap();
                    sender
                        .send(sse(completed("r1", "{\"answer\":\"provisional\"}")))
                        .unwrap();
                });
                return Ok(AxTransportStream::Reader {
                    status: 200,
                    body: Box::new(ChannelReader {
                        source,
                        current: std::io::Cursor::new(Vec::new()),
                    }),
                });
            }
            assert_eq!(n, 2, "work must not replay");
            assert_eq!(payload["previous_response_id"], "r1");
            assert_eq!(
                payload["input"],
                json!([{"type":"function_call_output","call_id":"c1","output":"REF-42"}])
            );
            Ok(AxTransportStream::Buffered(
                json!({"status":200,"body":String::from_utf8(sse(completed("r2","{\"answer\":\"REF-42\"}"))).unwrap()}),
            ))
        }
    }
    #[test]
    fn background_overlap_duplicate_events_and_final_incorporation() -> AxResult<()> {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release = Arc::new(Mutex::new(release_rx));
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let requests = Arc::new(AtomicUsize::new(0));
        let transport = GatedTransport {
            requests: requests.clone(),
            started: Some(started_rx),
            release: release_tx,
        };
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra","model_config":{"thinkingTokenBudget":"low"}}))?.with_transport(transport);
        let mut client=ProviderRouter::from_providers(vec![("primary",client)]);
        let tool = tool("lookup")
            .description("Look up a reference")
            .execution("background")
            .handler(move |_| {
                observed.fetch_add(1, Ordering::SeqCst);
                started_tx.send(()).unwrap();
                release
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(5))
                    .expect("model work must overlap the tool");
                Ok(json!("REF-42"))
            });
        let mut program = ax("question -> answer")?.with_tool(tool);
        let result = program.forward(&mut client, json!({"question":"Find reference"}))?;
        assert_eq!(result, json!({"answer":"REF-42"}));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        Ok(())
    }

    struct InvalidArgumentsTransport {requests:Arc<AtomicUsize>,exhausted:bool,arguments:String}
    impl AxTransport for InvalidArgumentsTransport {
      fn send(&mut self,_:Value)->AxResult<Value>{Err(AxError::runtime("Expected streaming"))}
      fn stream(&mut self,request:Value)->AxResult<AxTransportStream>{
        let n=self.requests.fetch_add(1,Ordering::SeqCst)+1;
        let event=if n==1 {json!({"type":"response.completed","response":{"id":"invalid","model":"gpt-6-astra","output":[{"type":"function_call","id":"invalid-item","call_id":"invalid-call","name":"validated_lookup","arguments":self.arguments}]}})}else{
          assert!(!self.exhausted && n==2,"Work replayed after exhaustion");let body=&request["json"];let outputs=body["input"].as_array().unwrap();assert_eq!(body["previous_response_id"],"invalid");assert_eq!(outputs.len(),1);assert_eq!(outputs[0]["call_id"],"invalid-call");assert!(outputs[0]["output"].as_str().unwrap().to_lowercase().contains("query"));completed("corrected","{\"answer\":\"CORRECTED\"}")
        };
        Ok(AxTransportStream::Buffered(json!({"status":200,"body":String::from_utf8(sse(event)).unwrap()})))
      }
    }
    #[test]
    fn invalid_arguments_correction_and_step_exhaustion()->AxResult<()> {
      for exhausted in [false,true] { for arguments in ["{}",r#"{"query":"ab"}"#] {
        let requests=Arc::new(AtomicUsize::new(0));let calls=Arc::new(AtomicUsize::new(0));let called=calls.clone();
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_transport(InvalidArgumentsTransport{requests:requests.clone(),exhausted,arguments:arguments.to_string()});
        let lookup=tool("validated_lookup").description("Requires a query").parameters(json!({"type":"object","$defs":{"query":{"type":"string","minLength":3,"pattern":"^[A-Z]+$"}},"properties":{"query":{"$ref":"#/$defs/query"}},"required":["query"],"additionalProperties":false})).arg("query",FieldType::string()).execution("background").handler(move |_|{called.fetch_add(1,Ordering::SeqCst);Ok(json!("unexpected"))});
        let mut program=ax("question -> answer")?.with_tool(lookup);
        let result=program.forward_with_options(&mut client,json!({"question":"Find reference"}),json!({"maxSteps":if exhausted{1}else{3}}));
        if exhausted{assert!(result.unwrap_err().message.contains("steps"));}else{assert_eq!(result?,json!({"answer":"CORRECTED"}));}
        assert_eq!(calls.load(Ordering::SeqCst),0);assert_eq!(requests.load(Ordering::SeqCst),if exhausted{1}else{2});
      }}
      Ok(())
    }
    struct FlowTransport(Arc<AtomicUsize>);
    impl AxTransport for FlowTransport {
        fn send(&mut self, _: Value) -> AxResult<Value> {Err(AxError::runtime("Expected streaming"))}
        fn stream(&mut self, request: Value) -> AxResult<AxTransportStream> {
            let n=self.0.fetch_add(1,Ordering::SeqCst)+1;
            let body=&request["json"];
            assert_eq!(body["model"],"gpt-6-astra","alias was not resolved");
            let event=if n%2==1 {
                assert!(body.get("previous_response_id").is_none(),"node inherited another conversation");
                json!({"type":"response.completed","response":{"id":"node-start","model":"gpt-6-astra","output":[{"type":"function_call","id":"item","call_id":"same-call","name":"lookup","arguments":"{\"query\":\"REF-42\"}"}]}})
            }else{
                assert_eq!(body["previous_response_id"],"node-start");
                assert_eq!(body["input"][0]["role"],"user","root update must reach future nodes");
                assert_eq!(body["input"][1],json!({"type":"function_call_output","call_id":"same-call","output":"REF-42"}));
                assert_eq!(body["input"].as_array().unwrap().len(),2);
                completed("node-final","{\"answer\":\"REF-42\"}")
            };
            Ok(AxTransportStream::Buffered(json!({"status":200,"body":String::from_utf8(sse(event)).unwrap()})))
        }
    }
    #[test]
    fn flow_conversation_isolation_and_future_root_updates() -> AxResult<()> {
        let requests=Arc::new(AtomicUsize::new(0));let calls=Arc::new(AtomicUsize::new(0));
        let control=run_control();let applied=Arc::new(Mutex::new(Vec::<Value>::new()));let observed=applied.clone();
        control.on_event(move |event|{if event["type"]=="applied"{observed.lock().unwrap().push(event["path"].clone());}});
        control.steer("Keep the reference exact.")?;
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_transport(FlowTransport(requests.clone()));
        let mut client=MultiServiceRouter::new().with_service("smart",client);
        assert_eq!(client.get_features(Some("smart"))["asyncTools"],true);
        let called=calls.clone();let lookup=tool("lookup").description("Look up reference").arg("query",FieldType::string()).execution("background").handler(move |args|{called.fetch_add(1,Ordering::SeqCst);Ok(args["query"].clone())});
        let mut workflow=flow("session-flow").execute("first",ax("question -> answer")?.with_tool(lookup.clone())).execute("second",ax("question -> answer")?.with_tool(lookup)).returns(json!({"first":"firstResult","second":"secondResult"}));
        for _ in 0..2 {
            let result=workflow.forward_with_options(&mut client,json!({"question":"Find reference"}),AxForwardOptions::from(json!({"model":"smart"})).with_control(control.clone()))?;
            assert_eq!(result,json!({"first":{"answer":"REF-42"},"second":{"answer":"REF-42"}}));
        }
        assert_eq!(requests.load(Ordering::SeqCst),8);assert_eq!(calls.load(Ordering::SeqCst),4);
        assert_eq!(*applied.lock().unwrap(),vec![json!("root/first"),json!("root/second"),json!("root/first"),json!("root/second")]);
        let weak=Arc::downgrade(&control.0);
        control.on_event(move |event|{if event["type"]=="completed" && event["path"]=="root/first" {if let Some(state)=weak.upgrade(){AxRunControl(state).abort();}}});
        let error=workflow.forward_with_options(&mut client,json!({"question":"Find reference"}),AxForwardOptions::from(json!({"model":"smart"})).with_control(control.clone())).unwrap_err();
        assert!(error.to_string().contains("Flow aborted"),"{error}");
        assert_eq!(requests.load(Ordering::SeqCst),10);assert_eq!(calls.load(Ordering::SeqCst),5);
        Ok(())
    }

    #[derive(Default)]
    struct SteeringSocket {
        pending: bool,
        incoming: Mutex<std::collections::VecDeque<Value>>,
        ready: std::sync::Condvar,
        sent: Mutex<Vec<Value>>,
        closed: AtomicBool,
    }
    impl AxSessionSocket for SteeringSocket {
        fn send(&self,event:Value)->AxResult<()> {
            self.sent.lock().unwrap().push(event.clone());let mut queue=self.incoming.lock().unwrap();
            if self.pending {
                queue.push_back(json!({"type":"response.created","response":{"id":"pending"}}));
                queue.push_back(json!({"type":"response.output_item.done","item":{"type":"function_call","id":"item","call_id":"pending-call","name":"lookup","arguments":"{}"}}));self.ready.notify_all();return Ok(());
            }
            if event["type"]=="response.create" {
                assert!(event.get("stream").is_none());
                queue.push_back(json!({"type":"response.created","response":{"id":"parent"}}));
                queue.push_back(json!({"type":"response.output_text.delta","delta":"provisional"}));
            } else {
                assert_eq!(event["type"],"response.steer");assert_eq!(event["previous_response_id"],"parent");
                let ack=json!({"type":"response.steer.accepted","steer":{"id":"s1","previous_response_id":"parent"}});
                queue.push_back(ack.clone());queue.push_back(ack);
                queue.push_back(json!({"type":"response.incomplete","response":{"id":"parent","model":"gpt-6-astra","output":[],"incomplete_details":{"reason":"steered"},"usage":{"input_tokens":3,"output_tokens":2}}}));
                queue.push_back(json!({"type":"response.created","response":{"id":"successor"}}));
                queue.push_back(completed("successor","{\"answer\":\"CORRECTED\"}"));
            }
            self.ready.notify_all();Ok(())
        }
        fn recv(&self,timeout:Duration)->AxResult<Option<Value>> {
            let queue=self.incoming.lock().unwrap();let (mut queue,_)=self.ready.wait_timeout_while(queue,timeout,|q|q.is_empty()&&!self.closed.load(Ordering::SeqCst)).unwrap();
            if self.closed.load(Ordering::SeqCst) {return Err(AxError::runtime("Socket closed"));}Ok(queue.pop_front())
        }
        fn close(&self){self.closed.store(true,Ordering::SeqCst);self.ready.notify_all();}
    }
    #[cfg(feature = "realtime")]
    #[test]
    fn native_websocket_transport_steering_and_close()->AxResult<()> {
        let listener=std::net::TcpListener::bind("127.0.0.1:0")?;
        let endpoint=format!("http://{}",listener.local_addr()?);
        let (closed_tx,closed_rx)=mpsc::channel();
        let server=std::thread::spawn(move || {
            let (stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(4))).unwrap();
            let mut socket=tungstenite::accept(stream).unwrap();
            let request:Value=serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(request["type"],"response.create");assert_eq!(request["model"],"gpt-6-astra");assert!(request.get("stream").is_none());
            for event in [json!({"type":"response.created","response":{"id":"parent"}}),json!({"type":"response.output_text.delta","delta":"provisional"})] {socket.send(tungstenite::Message::Text(event.to_string().into())).unwrap();}
            let steer:Value=serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();assert_eq!(steer["type"],"response.steer");assert_eq!(steer["previous_response_id"],"parent");
            for event in [json!({"type":"response.steer.accepted","steer":{"id":"s1","previous_response_id":"parent"}}),json!({"type":"response.incomplete","response":{"id":"parent","model":"gpt-6-astra","output":[],"incomplete_details":{"reason":"steered"}}}),json!({"type":"response.created","response":{"id":"successor"}}),completed("successor","{\"answer\":\"CORRECTED\"}")] {socket.send(tungstenite::Message::Text(event.to_string().into())).unwrap();}
            let closed=match socket.read(){Ok(tungstenite::Message::Close(_))=>true,Err(tungstenite::Error::Io(error))=>!matches!(error.kind(),std::io::ErrorKind::TimedOut|std::io::ErrorKind::WouldBlock),Err(_)=>true,_=>false};closed_tx.send(closed).unwrap();
        });
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra","base_url":endpoint}))?.with_native_session_web_socket();
        assert_eq!(client.get_features(None)["nativeSteering"],true);
        let control=run_control();let weak=Arc::downgrade(&control.0);let steered=AtomicBool::new(false);
        control.on_event(move|event|{if event["type"]=="model.output"&&!steered.swap(true,Ordering::SeqCst){AxRunControl(weak.upgrade().unwrap()).steer("Use CORRECTED.").unwrap();}});
        let mut program=ax("question -> answer")?;
        assert_eq!(program.forward_with_options(&mut client,json!({"question":"Find answer"}),AxForwardOptions::from(json!({})).with_control(control))?,json!({"answer":"CORRECTED"}));
        assert_eq!(program.get_chat_log().iter().map(|v|v["remote_id"].clone()).collect::<Vec<_>>(),vec![json!("parent"),json!("successor")]);
        assert!(closed_rx.recv_timeout(Duration::from_secs(4)).expect("native socket was not closed"));server.join().unwrap();Ok(())
    }

    #[test]
    fn buffered_terminal_queues_steering()->AxResult<()> {
        struct BoundarySocket {queue:Mutex<std::collections::VecDeque<Value>>, ready:std::sync::Condvar, reads:AtomicUsize, received:mpsc::Sender<()>, sent:AtomicUsize, closed:AtomicBool}
        impl AxSessionSocket for BoundarySocket {
            fn send(&self,event:Value)->AxResult<()> {assert_eq!(event["type"],"response.create");self.sent.fetch_add(1,Ordering::SeqCst);let mut queue=self.queue.lock().unwrap();queue.extend([json!({"type":"response.created","response":{"id":"parent"}}),json!({"type":"response.output_text.delta","delta":"provisional"}),completed("parent","")]);self.ready.notify_all();Ok(())}
            fn recv(&self,timeout:Duration)->AxResult<Option<Value>> {if self.reads.load(Ordering::SeqCst)==3 {let _=self.received.send(());}let queue=self.queue.lock().unwrap();let (mut queue,_)=self.ready.wait_timeout_while(queue,timeout,|q|q.is_empty()&&!self.closed.load(Ordering::SeqCst)).unwrap();let event=queue.pop_front();if event.is_some(){self.reads.fetch_add(1,Ordering::SeqCst);}Ok(event)}
            fn close(&self){self.closed.store(true,Ordering::SeqCst);self.ready.notify_all();}
        }
        let (sender,receiver)=mpsc::channel();let socket=Arc::new(BoundarySocket{queue:Mutex::new(Default::default()),ready:Default::default(),reads:AtomicUsize::new(0),received:sender,sent:AtomicUsize::new(0),closed:AtomicBool::new(false)});let configured=socket.clone();
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_session_web_socket_factory(move|_,_|Ok(configured.clone()));
        let mut session=client.open_chat_session(json!({"chat_prompt":[{"role":"user","content":"probe"}]}),json!({}))?.unwrap();
        receiver.recv_timeout(Duration::from_secs(2)).expect("Terminal frame was not received");assert_eq!(session.next(Duration::from_secs(2))?.unwrap()["type"],"response");assert_eq!(session.update(&json!({"type":"steer","text":"Correct answer"}))?,"next-response");assert_eq!(socket.sent.load(Ordering::SeqCst),1);session.close();Ok(())
    }

    #[test]
    fn native_steering_successor_and_accounting()->AxResult<()> {
        let socket=Arc::new(SteeringSocket::default());let configured=socket.clone();
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra","base_url":"https://example.test/v1"}))?.with_session_web_socket_factory(move |url,headers| {
            assert_eq!(url,"wss://example.test/v1/responses");assert_eq!(headers["Authorization"],"Bearer test");Ok(configured.clone())
        });
        let control=run_control();let weak=Arc::downgrade(&control.0);let steered=AtomicBool::new(false);let applied=Arc::new(Mutex::new(Vec::new()));let observed=applied.clone();
        control.on_event(move |event| {if event["type"]=="model.output"&&!steered.swap(true,Ordering::SeqCst){AxRunControl(weak.upgrade().unwrap()).steer("Use CORRECTED.").unwrap();}if event["type"]=="applied"{observed.lock().unwrap().push(event["timing"].clone());}});
        let mut program=ax("question -> answer")?;
        let result=program.forward_with_options(&mut client,json!({"question":"Find answer"}),AxForwardOptions::from(json!({})).with_control(control))?;
        assert_eq!(result,json!({"answer":"CORRECTED"}));assert_eq!(*applied.lock().unwrap(),vec![json!("native")]);
        assert_eq!(socket.sent.lock().unwrap().len(),2);assert!(socket.closed.load(Ordering::SeqCst));
        assert_eq!(program.get_chat_log().iter().map(|v|v["remote_id"].clone()).collect::<Vec<_>>(),vec![json!("parent"),json!("successor")]);
        Ok(())
    }

    #[test]
    fn cancellation_context_and_late_delivery()->AxResult<()> {
        let socket=Arc::new(SteeringSocket{pending:true,..SteeringSocket::default()});let configured=socket.clone();
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_session_web_socket_factory(move |_,_|Ok(configured.clone()));
        let control=run_control();let abort=control.clone();let settled=Arc::new(AtomicBool::new(false));let finished=settled.clone();
        let lookup=tool("lookup").description("Lookup").execution("background").context_handler(move |_,context|{
            assert_eq!(context.call_id.as_deref(),Some("pending-call"));abort.abort();let start=Instant::now();while !context.is_cancelled()&&start.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}assert!(context.is_cancelled());finished.store(true,Ordering::SeqCst);Ok(json!("LATE"))
        });
        let mut program=ax("question -> answer")?.with_tool(lookup);let start=Instant::now();
        let error=program.forward_with_options(&mut client,json!({"question":"Find answer"}),AxForwardOptions::from(json!({})).with_control(control)).unwrap_err();
        assert!(error.to_string().contains("pending-call"),"{error}");assert!(start.elapsed()<Duration::from_secs(2));
        let start=Instant::now();while !settled.load(Ordering::SeqCst)&&start.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}
        assert!(settled.load(Ordering::SeqCst));assert!(socket.closed.load(Ordering::SeqCst));assert_eq!(socket.sent.lock().unwrap().len(),1);Ok(())
    }

    #[test]
    fn disconnect_preserves_pending_call_ids()->AxResult<()> {
        let socket=Arc::new(SteeringSocket{pending:true,..SteeringSocket::default()});let configured=socket.clone();
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_session_web_socket_factory(move |_,_|Ok(configured.clone()));
        let control=run_control();let disconnect=socket.clone();let settled=Arc::new(AtomicBool::new(false));let finished=settled.clone();
        let lookup=tool("lookup").description("Lookup").execution("background").context_handler(move |_,context|{
            assert_eq!(context.call_id.as_deref(),Some("pending-call"));disconnect.close();let start=Instant::now();while !context.is_cancelled()&&start.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}assert!(context.is_cancelled());finished.store(true,Ordering::SeqCst);Ok(json!("LATE"))
        });
        let mut program=ax("question -> answer")?.with_tool(lookup);let start=Instant::now();
        let error=program.forward_with_options(&mut client,json!({"question":"Find answer"}),AxForwardOptions::from(json!({})).with_control(control)).unwrap_err();
        assert!(error.to_string().contains("pending-call"),"{error}");assert!(start.elapsed()<Duration::from_secs(2));
        let start=Instant::now();while !settled.load(Ordering::SeqCst)&&start.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}
        assert!(settled.load(Ordering::SeqCst));assert!(socket.closed.load(Ordering::SeqCst));assert_eq!(socket.sent.lock().unwrap().len(),1);Ok(())
    }

    #[test]
    fn noncooperative_cancellation_keeps_late_work_owned()->AxResult<()> {
        let socket=Arc::new(SteeringSocket{pending:true,..SteeringSocket::default()});let configured=socket.clone();
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_session_web_socket_factory(move |_,_|Ok(configured.clone()));
        let control=run_control();let abort=control.clone();let settled=Arc::new(AtomicBool::new(false));let finished=settled.clone();
        let (release,wait)=mpsc::channel();let wait=Mutex::new(wait);
        let lookup=tool("lookup").description("Lookup").execution("background").context_handler(move |_,context|{
            assert_eq!(context.call_id.as_deref(),Some("pending-call"));abort.abort();wait.lock().unwrap().recv_timeout(Duration::from_secs(3)).expect("caller waited for noncooperative work");finished.store(true,Ordering::SeqCst);Ok(json!("LATE"))
        });
        let mut program=ax("question -> answer")?.with_tool(lookup);let start=Instant::now();
        let error=program.forward_with_options(&mut client,json!({"question":"Find answer"}),AxForwardOptions::from(json!({})).with_control(control)).unwrap_err();
        assert!(error.to_string().contains("pending-call"),"{error}");assert!(start.elapsed()<Duration::from_secs(2));
        assert!(!settled.load(Ordering::SeqCst));assert!(socket.closed.load(Ordering::SeqCst));let traces=program.function_call_traces.clone();assert_eq!(traces.len(),1);assert_eq!(traces[0]["id"],"pending-call");assert_eq!(traces[0]["status"],"unresolved");release.send(()).unwrap();
        let start=Instant::now();while !settled.load(Ordering::SeqCst)&&start.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}
        assert_eq!(program.function_call_traces,traces);assert!(settled.load(Ordering::SeqCst));assert!(socket.closed.load(Ordering::SeqCst));assert_eq!(socket.sent.lock().unwrap().len(),1);Ok(())
    }

    struct ConcurrentMCPTransport(Arc<Mutex<Vec<Value>>>);
    impl AxMCPTransport for ConcurrentMCPTransport {
        fn send_notification(&mut self,message:Value)->AxResult<()>{assert_eq!(message["method"],"notifications/initialized");Ok(())}
        fn send(&mut self,message:Value)->AxResult<Value>{
            let result=match message["method"].as_str().unwrap(){
                "server/discover"=>json!({"resultType":"complete","supportedVersions":["2026-07-28"],"ttlMs":60000,"cacheScope":"private","capabilities":{"tools":{}}}),
                "initialize"=>json!({"protocolVersion":"2025-11-25","serverInfo":{"name":"orders","version":"1"},"capabilities":{"tools":{}}}),
                "tools/list"=>json!({"tools":[{"name":"lookup","inputSchema":{"type":"object","properties":{"index":{"type":"integer"}}}}]}),
                "tools/call"=>{assert_eq!(message["params"]["name"],"lookup");self.0.lock().unwrap().push(message.clone());json!({"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"orders","version":message["id"]}},"structuredContent":message["params"]["arguments"]})},
                other=>panic!("Unexpected MCP method {other}"),
            };
            Ok(json!({"jsonrpc":"2.0","id":message["id"],"result":result}))
        }
    }
    #[test]
    fn concurrent_native_mcp_request_ids()->AxResult<()> {
        let requests=Arc::new(Mutex::new(Vec::new()));
        let mut client=AxMCPClient::new(Box::new(ConcurrentMCPTransport(requests.clone())),json!({"era":"modern","namespace":"orders"}));client.init()?;
        let native=client.native_tools().remove(0);let barrier=Arc::new(std::sync::Barrier::new(32));let mut workers=Vec::new();
        for index in 0..32{let native=native.clone();let barrier=barrier.clone();workers.push(std::thread::spawn(move ||{barrier.wait();native.call(json!({"index":index}))}));}
        for (index,worker) in workers.into_iter().enumerate(){let result=worker.join().expect("native MCP worker panicked")?;assert_eq!(result["structuredContent"]["index"],index);}
        let requests=requests.lock().unwrap();let ids:std::collections::BTreeSet<String>=requests.iter().map(|request|request["id"].as_str().unwrap().to_string()).collect();assert_eq!(requests.len(),32);assert_eq!(ids.len(),32);Ok(())
    }

    #[test]
    fn owned_balancer_shares_failure_accounting()->AxResult<()> {
        struct FailingTransport(Arc<AtomicUsize>);
        impl AxTransport for FailingTransport {
            fn owned_worker_factory(&self)->Option<AxOwnedTransportFactory>{let calls=self.0.clone();Some(Box::new(move ||Box::new(FailingTransport(calls))))}
            fn send(&mut self,_:Value)->AxResult<Value>{self.0.fetch_add(1,Ordering::SeqCst);let mut error=AxError::new("ai","fixture rate limit");error.error_type=Some("AxAIServiceStatusError".into());error.status=Some(429);error.retryable=true;Err(error)}
        }
        let calls=Arc::new(AtomicUsize::new(0));let client=ai("openai",json!({"api_key":"test","model":"gpt-5.6"}))?.with_transport(FailingTransport(calls.clone()));
        let mut owner=AxBalancer::from_clients(vec![Box::new(client)],AxBalancerOptions{max_retries:1,..AxBalancerOptions::default()})?;
        let mut worker=owner.owned_worker_factory().expect("built-in owned client")();let request=json!({"chat_prompt":[{"role":"user","content":"Hello"}],"model_config":{"stream":false}});
        assert!(worker.chat(request.clone()).is_err());let first=calls.load(Ordering::SeqCst);assert!(first>0);
        assert!(owner.chat(request).is_err());assert_eq!(calls.load(Ordering::SeqCst),first,"Parent forgot worker failure and replayed route");Ok(())
    }

    struct MCPAgentGate { started:AtomicBool,release:Mutex<bool>,ready:Condvar,calls:AtomicUsize,schema:Value }
    struct MCPAgentTransport(Arc<MCPAgentGate>);
    impl AxMCPTransport for MCPAgentTransport {
        fn send_notification(&mut self,_:Value)->AxResult<()>{panic!("Modern discovery initialized")}
        fn send(&mut self,message:Value)->AxResult<Value>{
            let result=match message["method"].as_str().unwrap_or("") {
                "server/discover"=>json!({"resultType":"complete","supportedVersions":["2026-07-28"],"ttlMs":60000,"cacheScope":"private","capabilities":{"tools":{}}}),
                "tools/list"=>json!({"tools":[{"name":"lookup","description":"Find reference","inputSchema":self.0.schema}]}),
                "tools/call"=>{
                    assert_eq!(message["params"]["name"],"lookup");assert_eq!(message["params"]["arguments"],json!({"query":"REF-42"}));assert!(message["params"]["_meta"].is_object());
                    self.0.calls.fetch_add(1,Ordering::SeqCst);self.0.started.store(true,Ordering::SeqCst);self.0.ready.notify_all();let release=self.0.release.lock().unwrap();let(release,timeout)=self.0.ready.wait_timeout_while(release,Duration::from_secs(3),|value|!*value).unwrap();assert!(!timeout.timed_out()||*release,"MCP tool did not overlap model");
                    json!({"resultType":"complete","structuredContent":{"reference":"REF-42"},"content":[{"type":"text","text":"REF-42"}]})
                },method=>panic!("Unexpected MCP method {method}"),
            };Ok(json!({"jsonrpc":"2.0","id":message["id"],"result":result}))
        }
    }
    struct MCPAgentModel {gate:Arc<MCPAgentGate>,hidden:Arc<AtomicBool>,requests:Arc<AtomicUsize>}
    impl MCPAgentModel {
        fn event(&self,request:&Value,number:usize)->Value{
            let body=&request["json"];let actor:Vec<_>=body["tools"].as_array().into_iter().flatten().filter(|tool|tool["async"]==true).collect();
            if self.hidden.load(Ordering::SeqCst){assert!(actor.is_empty(),"Undiscovered MCP tool exposed");return completed(&format!("hidden-{number}"),if number<3{"{\"completion\":{\"type\":\"final\",\"args\":[\"No discovered tools\",{}]}}"}else{"{\"answer\":\"not discovered\"}"});}
            if number==1||number==5 {assert!(actor.is_empty(),"Native authority escaped executor");if number==5{assert!(body.to_string().contains("REF-42"),"Responder preceded result incorporation");}return completed(&format!("stage-{number}"),if number==1{"{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}"}else{"{\"answer\":\"REF-42\"}"});}
            if number==2 {assert_eq!(actor.len(),1);assert_eq!(actor[0]["name"],"orders_lookup");assert_eq!(actor[0]["parameters"],self.gate.schema);return json!({"type":"response.completed","response":{"id":"invalid-response","model":"gpt-6-astra","output":[{"type":"function_call","id":"invalid","call_id":"invalid-call","name":"orders_lookup","arguments":"{\"query\":\"X\"}"}]}});}
            assert_eq!(number,4);assert_eq!(body["previous_response_id"],"tool-response");let result=body["input"].as_array().unwrap().last().unwrap();assert_eq!(result["call_id"],"mcp-call");let output:Value=serde_json::from_str(result["output"].as_str().unwrap()).unwrap();assert_eq!(output["structuredContent"]["reference"],"REF-42");completed("final-response","{\"completion\":{\"type\":\"final\",\"args\":[\"Report\",{\"answer\":\"REF-42\"}]}}")
        }
    }
    impl AxTransport for MCPAgentModel {
        fn send(&mut self,request:Value)->AxResult<Value>{let number=self.requests.fetch_add(1,Ordering::SeqCst)+1;Ok(self.event(&request,number)["response"].clone())}
        fn stream(&mut self,request:Value)->AxResult<AxTransportStream>{
            let number=self.requests.fetch_add(1,Ordering::SeqCst)+1;
            if !self.hidden.load(Ordering::SeqCst)&&number==3 {
                assert_eq!(self.gate.calls.load(Ordering::SeqCst),0,"Invalid arguments invoked MCP");assert_eq!(request["json"]["previous_response_id"],"invalid-response");
                let(sender,receiver)=mpsc::channel();let gate=self.gate.clone();std::thread::spawn(move ||{
                    sender.send(sse(json!({"type":"response.output_item.done","item":{"type":"function_call","id":"valid","call_id":"mcp-call","name":"orders_lookup","arguments":"{\"query\":\"REF-42\"}"}}))).unwrap();
                    let release=gate.release.lock().unwrap();let(mut release,timeout)=gate.ready.wait_timeout_while(release,Duration::from_secs(3),|_|!gate.started.load(Ordering::SeqCst)).unwrap();assert!(!timeout.timed_out()||gate.started.load(Ordering::SeqCst),"MCP tool did not start");*release=true;gate.ready.notify_all();drop(release);
                    sender.send(sse(completed("tool-response","{\"completion\":{\"type\":\"final\",\"args\":[\"Report\",{\"answer\":\"provisional\"}]}}"))).unwrap();
                });return Ok(AxTransportStream::Reader{status:200,body:Box::new(ChannelReader{source:receiver,current:std::io::Cursor::new(Vec::new())})});
            }
            Ok(AxTransportStream::Buffered(json!({"status":200,"body":String::from_utf8(sse(self.event(&request,number))).unwrap()})))
        }
    }
    #[test]
    fn discovered_mcp_native_agent_invocation()->AxResult<()> {
        let schema=json!({"type":"object","$defs":{"reference":{"type":"string","minLength":3}},"properties":{"query":{"$ref":"#/$defs/reference"}},"required":["query"],"additionalProperties":false});
        let gate=Arc::new(MCPAgentGate{started:AtomicBool::new(false),release:Mutex::new(false),ready:Condvar::new(),calls:AtomicUsize::new(0),schema});
        let mut mcp=AxMCPClient::new(Box::new(MCPAgentTransport(gate.clone())),json!({"era":"modern","namespace":"orders"}));mcp.init()?;let allowed=Arc::new(AtomicBool::new(false));let authorizations=Arc::new(AtomicUsize::new(0));let permission=allowed.clone();let counted=authorizations.clone();let schema=gate.schema.clone();mcp.set_tool_authorizer(move|client,call|{assert_eq!(client.namespace(),"orders");assert_eq!(call["namespace"],"orders");assert_eq!(call["tool"]["inputSchema"],schema);assert_eq!(call["arguments"],json!({"query":"REF-42"}));counted.fetch_add(1,Ordering::SeqCst);Ok(Some(permission.load(Ordering::SeqCst)))});let mut native=mcp.native_tools().remove(0);assert_eq!(native.execution,"blocking");native.execution="background".into();
        let denied=native.call(json!({"query":"REF-42"})).unwrap_err();assert!(denied.to_string().contains("MCP tool call denied by host policy: lookup"));assert_eq!(gate.calls.load(Ordering::SeqCst),0);allowed.store(true,Ordering::SeqCst);
        let mut program=agent_with_options("question -> answer",json!({"functionDiscovery":true,"directResponse":"off"}))?.with_tool_module("orders",vec![native])?;
        let hidden=Arc::new(AtomicBool::new(true));let requests=Arc::new(AtomicUsize::new(0));let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_transport(MCPAgentModel{gate:gate.clone(),hidden:hidden.clone(),requests:requests.clone()});
        assert_eq!(program.forward(&mut client,json!({"question":"Find reference"}))?,json!({"answer":"not discovered"}));assert_eq!(gate.calls.load(Ordering::SeqCst),0);assert_eq!(requests.load(Ordering::SeqCst),3);
        program.discover(json!({"tools":["orders"]}))?;hidden.store(false,Ordering::SeqCst);requests.store(0,Ordering::SeqCst);
        assert_eq!(program.forward(&mut client,json!({"question":"Find reference"}))?,json!({"answer":"REF-42"}));assert_eq!(gate.calls.load(Ordering::SeqCst),1);assert_eq!(requests.load(Ordering::SeqCst),5);
        assert!(program.get_action_log().iter().any(|entry|entry["qualified_name"]=="orders.lookup"&&entry["call_id"]=="mcp-call"&&entry["status"]=="ok"));assert_eq!(program.invoke_callable("orders.lookup",json!({"query":"REF-42"}),json!({}))?["status"],"error");assert_eq!(gate.calls.load(Ordering::SeqCst),1);assert_eq!(authorizations.load(Ordering::SeqCst),2);Ok(())
    }

    struct AgentSessionTransport {requests:Arc<AtomicUsize>,started:Option<mpsc::Receiver<()>>,release:mpsc::Sender<()>}
    impl AxTransport for AgentSessionTransport {
        fn send(&mut self,request:Value)->AxResult<Value>{
            let n=self.requests.fetch_add(1,Ordering::SeqCst)+1;let body=&request["json"];
            for tool in body["tools"].as_array().into_iter().flatten(){assert_ne!(tool["async"],true,"actor authority leaked");}
            if n==1{return Ok(completed("distiller","{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}")["response"].clone());}
            assert_eq!(n,4);assert!(body.to_string().contains("REF-42"),"responder ran before final incorporation");Ok(completed("responder","{\"answer\":\"REF-42\"}")["response"].clone())
        }
        fn stream(&mut self,request:Value)->AxResult<AxTransportStream>{
            let n=self.requests.fetch_add(1,Ordering::SeqCst)+1;let body=&request["json"];
            if matches!(n,1|2|5|6){
                for t in body["tools"].as_array().into_iter().flatten(){assert_ne!(t["async"],true,"Actor authority leaked");}
                let stage=if n<3{"distiller"}else{"responder"};let suffix=if n==1||n==5{"-start"}else{"-final"};
                if n==2||n==6{assert_eq!(body["previous_response_id"],format!("{stage}-start"));let input=body["input"].to_string();assert!(input.contains("ROOT-GUIDANCE"));assert_eq!(input.contains("RESPONDER-ONLY"),n==6);}
                if n==5{assert!(body.to_string().contains("REF-42"),"Responder started before incorporation");}
                return Ok(AxTransportStream::Buffered(json!({"status":200,"body":String::from_utf8(sse(completed(&format!("{stage}{suffix}"),if n<3{"{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}"}else{"{\"answer\":\"REF-42\"}"}))).unwrap()})));
            }
            if n==3 {
                assert_eq!(body["tools"][0]["name"],"tools_lookup");assert_eq!(body["tools"][0]["async"],true);
                let started=self.started.take().unwrap();let release=self.release.clone();let (sender,source)=mpsc::channel();
                std::thread::spawn(move ||{sender.send(sse(json!({"type":"response.output_item.done","item":{"type":"function_call","id":"item","call_id":"agent-call","name":"tools_lookup","arguments":"{\"query\":\"REF-42\"}"}}))).unwrap();started.recv_timeout(Duration::from_secs(2)).expect("agent tool should overlap model work");release.send(()).unwrap();sender.send(sse(completed("executor1","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"provisional\"}]}}"))).unwrap();});
                return Ok(AxTransportStream::Reader{status:200,body:Box::new(ChannelReader{source,current:std::io::Cursor::new(Vec::new())})});
            }
            assert_eq!(n,4);assert_eq!(body["previous_response_id"],"executor1");assert_eq!(body["input"].as_array().unwrap().last().unwrap(),&json!({"type":"function_call_output","call_id":"agent-call","output":"REF-42"}));let input=body["input"].to_string();assert!(input.contains("ROOT-GUIDANCE")&&!input.contains("RESPONDER-ONLY")&&input.contains("configuration_update")&&input.contains("medium"));
            Ok(AxTransportStream::Buffered(json!({"status":200,"body":String::from_utf8(sse(completed("executor2","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"REF-42\"}]}}"))).unwrap()})))
        }
    }
    struct ChildControlRuntime {delegated:Arc<AtomicBool>,closed:Arc<AtomicUsize>,callbacks:Arc<Mutex<std::collections::BTreeMap<String,AxHostCallable>>>}
    struct ChildControlSession {delegated:Arc<AtomicBool>,closed:Arc<AtomicUsize>}
    impl AxCodeRuntime for ChildControlRuntime {
        fn register_host_callable(&mut self,name:&str,callable:AxHostCallable)->AxResult<()>{self.callbacks.lock().unwrap().insert(name.to_string(),callable);Ok(())}
        fn language(&self)->&str{"JavaScript"}
        fn create_session(&mut self,_:Value,_:Value)->AxResult<Box<dyn AxCodeSession>>{Ok(Box::new(ChildControlSession{delegated:self.delegated.clone(),closed:self.closed.clone()}))}
    }
    impl AxCodeSession for ChildControlSession {
        fn execute(&mut self,code:&str,_:Value)->AxResult<RuntimeEnvelope>{
            if code=="delegate"{self.delegated.store(true,Ordering::SeqCst);return Ok(RuntimeEnvelope{payload:json!({"callable":{"qualified_name":"team.researcher","args":{"question":"Find reference"},"call_id":"child-call"}})});}
            Ok(RuntimeEnvelope{payload:json!({"type":"final","args":["Find reference",{}]})})
        }
        fn snapshot_globals(&mut self,_:Value)->AxResult<Value>{Ok(json!({"globals":{}}))}
        fn close(&mut self)->AxResult<Value>{self.closed.fetch_add(1,Ordering::SeqCst);Ok(json!({"closed":true}))}
    }
    struct ChildControlTransport {requests:Arc<Mutex<Vec<Value>>>,delegated:Arc<AtomicBool>}
    impl AxTransport for ChildControlTransport {
        fn send(&mut self,_:Value)->AxResult<Value>{Err(AxError::runtime("Expected session streaming"))}
        fn stream(&mut self,request:Value)->AxResult<AxTransportStream>{
            let stages=["root/distiller","root/executor","root/team.researcher/distiller","root/team.researcher/executor","root/team.researcher/responder","root/executor","root/responder"];
            let body=request["json"].clone();let mut requests=self.requests.lock().unwrap();let number=requests.len();let stage=stages[number/2];requests.push(body.clone());
            if number%2==1{
                assert_eq!(body["previous_response_id"],format!("child-r{number}"));let input=body["input"].to_string();assert!(input.contains("ROOT-UPDATE"));assert_eq!(input.contains("CHILD-ONLY"),stage.starts_with("root/team.researcher"));
                let updates:Vec<&Value>=body["input"].as_array().unwrap().iter().filter(|item|item["type"]=="configuration_update").collect();assert_eq!(!updates.is_empty(),stage=="root/team.researcher/executor");if !updates.is_empty(){assert_eq!(updates[0]["reasoning"]["effort"],"medium");}
                assert_eq!(body["reasoning"],requests[number-1]["reasoning"],"cache prefix changed");
            }else{assert!(body["previous_response_id"].is_null(),"child inherited conversation at request {number}: {body}");}
            if number==10{assert!(body.to_string().contains("REF-42"),"parent continued without child result");}
            let output=if stage.starts_with("root/team.researcher"){if stage.ends_with("/responder"){json!({"answer":"REF-42"})}else{json!({"completion":{"type":"final","args":["Find reference",{}]}})}}else if stage=="root/responder"{json!({"answer":"REF-42"})}else{json!({"javascriptCode":if stage=="root/executor"&&!self.delegated.load(Ordering::SeqCst){"delegate"}else{"parent-final"}})};
            let mut event=completed(&format!("child-r{}",number+1),&output.to_string());event["response"]["usage"]=json!({"input_tokens":2,"output_tokens":1,"total_tokens":3});
            Ok(AxTransportStream::Buffered(json!({"status":200,"body":String::from_utf8(sse(event)).unwrap()})))
        }
    }
    #[test]
    fn owned_child_controls_and_cancellation()->AxResult<()> {
        for cancel in [false,true]{
            let control=run_control();let observed=Arc::new(Mutex::new(Vec::new()));let seen=observed.clone();let stop=control.clone();
            control.on_event(move |event|{seen.lock().unwrap().push(event.clone());if cancel&&event["type"]=="started"&&event["path"]=="root/team.researcher/executor"{stop.abort();}});
            control.steer("ROOT-UPDATE")?;control.steer_at("CHILD-ONLY","root/team.researcher")?;control.set_thinking_token_budget_at("medium","root/team.researcher/executor")?;
            let delegated=Arc::new(AtomicBool::new(false));let closed=Arc::new(AtomicUsize::new(0));let requests=Arc::new(Mutex::new(Vec::new()));
            let child=agent_with_options("question -> answer",json!({"directResponse":"off"}))?;
            let callbacks=Arc::new(Mutex::new(std::collections::BTreeMap::new()));
            let mut parent=agent_with_options("question -> answer",json!({"directResponse":"off"}))?.with_child_agent("team","researcher",child)?.with_runtime(Box::new(ChildControlRuntime{delegated:delegated.clone(),closed:closed.clone(),callbacks:callbacks.clone()}))?;
            let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_transport(ChildControlTransport{requests:requests.clone(),delegated});
            let result=parent.forward_with_options(&mut client,json!({"question":"Find reference"}),AxForwardOptions::default().with_control(control));
            if cancel{let error=result.expect_err("cancelled child returned success");assert!(error.to_string().to_lowercase().contains("abort"),"{error}");assert!((6..=7).contains(&requests.lock().unwrap().len()));assert_eq!(closed.load(Ordering::SeqCst),1);}else{
                assert_eq!(result?,json!({"answer":"REF-42"}));assert_eq!(requests.lock().unwrap().len(),14);assert_eq!(observed.lock().unwrap().iter().filter(|event|event["type"]=="applied").count(),11);
                let usage=parent.get_usage();let child=&usage["children"]["team.researcher"];assert_eq!(child["chat_log_entries"],6);assert_eq!(child["actor"].as_array().unwrap().len(),4);assert_eq!(child["responder"].as_array().unwrap().len(),2);
            }
            let calls:Vec<Value>=parent.get_action_log().into_iter().filter(|item|item["call_id"]=="child-call").collect();assert_eq!(calls.len(),1);assert_eq!(calls[0]["status"],if cancel{"error"}else{"ok"});
            assert!(parent.get_usage()["children"]["team.researcher"]["chat_log_entries"].as_u64().unwrap_or(0)>0,"Child failure usage lost");
            for name in ["team.researcher","llmQuery"]{let callback=callbacks.lock().unwrap().get(name).unwrap().clone();let error=callback(json!({"question":"Late request"})).expect_err("late callback executed");assert!(error.to_string().contains("closed"),"{error}");}
            let error=parent.invoke_callable("team.researcher",json!({"question":"Find reference"}),json!({})).expect_err("parent retained active client");assert!(error.to_string().contains("active parent forward"),"{error}");
        }
        Ok(())
    }
    #[test]
    fn native_agent_tools_and_action_log()->AxResult<()> {
        let control=run_control();control.steer("ROOT-GUIDANCE")?;control.steer_at("RESPONDER-ONLY","root/responder")?;control.set_thinking_token_budget_at("medium","root/executor")?;
        let requests=Arc::new(AtomicUsize::new(0));let calls=Arc::new(AtomicUsize::new(0));let called=calls.clone();let (started_tx,started_rx)=mpsc::channel();let (release_tx,release_rx)=mpsc::channel();let release=Mutex::new(release_rx);
        let lookup=tool("lookup").description("Lookup").arg("query",FieldType::string()).execution("background").handler(move |args|{called.fetch_add(1,Ordering::SeqCst);started_tx.send(()).unwrap();release.lock().unwrap().recv_timeout(Duration::from_secs(2)).expect("model should overlap agent tool");Ok(args["query"].clone())});
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra"}))?.with_transport(AgentSessionTransport{requests:requests.clone(),started:Some(started_rx),release:release_tx});
        let mut client=AxBalancer::from_clients(vec![Box::new(client)],AxBalancerOptions::default())?;
        let mut program=agent_with_options("question -> answer",json!({"directResponse":"off"}))?.with_tool_module("tools",vec![lookup])?;
        assert_eq!(program.forward_with_options(&mut client,json!({"question":"Find reference"}),AxForwardOptions::from(json!({})).with_control(control))?,json!({"answer":"REF-42"}));assert_eq!(calls.load(Ordering::SeqCst),1);assert_eq!(requests.load(Ordering::SeqCst),6);
        let activity:Vec<Value>=program.get_action_log().into_iter().filter(|v|v["type"]=="function_call").collect();assert_eq!(activity.len(),1);assert_eq!(activity[0]["qualified_name"],"tools.lookup");assert_eq!(activity[0]["call_id"],"agent-call");
        assert_eq!(program.invoke_callable("tools.lookup",json!({"query":"REF-42"}),json!({}))?["status"],"error");assert_eq!(calls.load(Ordering::SeqCst),1);Ok(())
    }

    #[test]
    fn cancellation_closes_stalled_native_http_body() -> AxResult<()> {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0")?;
        let endpoint=format!("http://{}",listener.local_addr()?);
        let (closed_tx,closed_rx)=mpsc::channel();
        let server=std::thread::spawn(move || {
            let (mut socket,_)=listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut request=Vec::new();let mut byte=[0u8;1];
            while !request.ends_with(b"\r\n\r\n") {socket.read_exact(&mut byte).unwrap();request.push(byte[0]);}
            let headers=String::from_utf8(request).unwrap();
            let length=headers.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").map(|v|v.trim().parse::<usize>().unwrap())).unwrap();
            socket.read_exact(&mut vec![0;length]).unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
            let body=sse(json!({"type":"response.output_item.done","item":{"type":"function_call","id":"item","call_id":"http-pending","name":"lookup","arguments":"{}"}}));
            write!(socket,"{:x}\r\n",body.len()).unwrap();socket.write_all(&body).unwrap();socket.write_all(b"\r\n").unwrap();socket.flush().unwrap();
            let closed=match socket.read(&mut byte) {Ok(0)=>true,Err(error)=>matches!(error.kind(),std::io::ErrorKind::ConnectionReset|std::io::ErrorKind::ConnectionAborted),_=>false};
            closed_tx.send(closed).unwrap();
        });
        let control=run_control();let abort=control.clone();
        let lookup=tool("lookup").description("Lookup").execution("background").context_handler(move |_,context| {
            abort.abort();let start=Instant::now();while !context.is_cancelled()&&start.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}assert!(context.is_cancelled());Ok(json!("LATE"))
        });
        let mut client=ai("openai",json!({"api_key":"test","model":"gpt-6-astra","api_url":endpoint}))?;
        let mut program=ax("question -> answer")?.with_tool(lookup);
        let error=program.forward_with_options(&mut client,json!({"question":"Lookup"}),AxForwardOptions::from(json!({})).with_control(control)).unwrap_err();
        assert!(error.to_string().contains("http-pending"),"{error}");
        assert!(closed_rx.recv_timeout(Duration::from_secs(3)).expect("HTTP worker retained its connection"));server.join().unwrap();Ok(())
    }

    struct BalancedChatOnly {calls:Arc<AtomicUsize>,tools:Arc<AtomicUsize>,unused:bool}
    impl AxAIClient for BalancedChatOnly {
        fn get_features(&self,_:Option<&str>)->Value{json!({"functions":true,"streaming":false,"asyncTools":self.unused})}
        fn chat(&mut self,request:Value)->AxResult<Value>{
            assert!(!self.unused,"Pinned run changed providers");let count=self.calls.fetch_add(1,Ordering::SeqCst)+1;
            if count==1{return Ok(json!({"results":[{"function_calls":[{"id":"balanced-call","function":{"name":"lookup","params":{}}}]}]}));}
            assert_eq!(count,2);assert_eq!(self.tools.load(Ordering::SeqCst),1,"request: {request}");assert!(request.to_string().contains("FALLBACK"));assert!(request.to_string().contains("balanced-call"));Ok(json!({"results":[{"content":"{\"answer\":\"FALLBACK\"}"}]}))
        }
        fn open_chat_session(&mut self,_:Value,_:Value)->AxResult<Option<Box<dyn AxChatSession>>>{assert!(!self.unused,"Pinned run changed providers");Ok(None)}
    }
    #[test]
    fn mixed_balancer_pins_chat_only_fallback()->AxResult<()> {
        let calls=Arc::new(AtomicUsize::new(0));let unused=Arc::new(AtomicUsize::new(0));let tools=Arc::new(AtomicUsize::new(0));let called=tools.clone();
        let mut client=AxBalancer::from_clients(vec![Box::new(BalancedChatOnly{calls:calls.clone(),tools:tools.clone(),unused:false}),Box::new(BalancedChatOnly{calls:unused.clone(),tools:tools.clone(),unused:true})],AxBalancerOptions{input_order:true,..AxBalancerOptions::default()})?;
        let mut program=ax("question -> answer")?.with_tool(tool("lookup").description("Lookup").execution("background").handler(move |_|{called.fetch_add(1,Ordering::SeqCst);Ok(json!("FALLBACK"))}));
        assert_eq!(program.forward(&mut client,json!({"question":"Lookup"}))?,json!({"answer":"FALLBACK"}));assert_eq!(calls.load(Ordering::SeqCst),2);assert_eq!(unused.load(Ordering::SeqCst),0);assert_eq!(tools.load(Ordering::SeqCst),1);
        calls.store(0,Ordering::SeqCst);tools.store(0,Ordering::SeqCst);
        let node=ax("question -> answer")?.with_tool(program.tools[0].clone());
        let mut workflow=flow("balanced-fallback").execute("lookup",node).returns(json!({"result":"lookupResult"}));
        assert_eq!(workflow.forward(&mut client,json!({"question":"Lookup"}))?,json!({"result":{"answer":"FALLBACK"}}));
        assert_eq!(calls.load(Ordering::SeqCst),2);assert_eq!(unused.load(Ordering::SeqCst),0);assert_eq!(tools.load(Ordering::SeqCst),1);Ok(())
    }

}
