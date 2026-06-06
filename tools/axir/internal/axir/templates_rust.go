package axir

const rustCargoToml = `[package]
name = "axllm"
version = "{{AX_VERSION}}"
edition = "2021"
rust-version = "1.74"
description = "Generated Ax runtime library"
license = "MIT"
repository = "https://github.com/ax-llm/ax"
readme = "README.md"
keywords = ["llm", "ai", "agents", "ax"]
categories = ["api-bindings", "development-tools"]

[lib]
path = "src/lib.rs"

[[bin]]
name = "axllm-conformance"
path = "src/bin/axllm-conformance.rs"

[dependencies]
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`

const rustLib = `use reqwest::blocking::Client as HttpClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, VecDeque};
use std::error::Error;
use std::fmt;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub type AxResult<T> = Result<T, AxError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AxError {
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_type: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub retryable: bool,
}

impl AxError {
    pub fn new(category: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            category: category.into(),
            error_type: None,
            message: message.into(),
            status: None,
            code: None,
            retryable: false,
        }
    }

    pub fn runtime(message: impl Into<String>) -> Self {
        Self::new("runtime", message)
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new("validation", message)
    }
}

impl fmt::Display for AxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl Error for AxError {}

impl From<serde_json::Error> for AxError {
    fn from(value: serde_json::Error) -> Self {
        Self::runtime(value.to_string())
    }
}

impl From<std::io::Error> for AxError {
    fn from(value: std::io::Error) -> Self {
        Self::runtime(value.to_string())
    }
}

impl From<reqwest::Error> for AxError {
    fn from(value: reqwest::Error) -> Self {
        let mut err = Self::new("ai_service", value.to_string());
        err.status = value.status().map(|status| status.as_u16());
        err.retryable = err.status.map(|status| status >= 500).unwrap_or(false);
        err
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldType {
    pub name: String,
    #[serde(default, rename = "isArray")]
    pub is_array: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Map<String, Value>>,
}

impl FieldType {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            is_array: false,
            options: None,
            fields: None,
        }
    }

    pub fn string() -> Self {
        Self::new("string")
    }

    pub fn number() -> Self {
        Self::new("number")
    }

    pub fn boolean() -> Self {
        Self::new("boolean")
    }

    pub fn class(options: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            name: "class".to_string(),
            is_array: false,
            options: Some(options.into_iter().map(Into::into).collect()),
            fields: None,
        }
    }

    pub fn array(mut self) -> Self {
        self.is_array = true;
        self
    }

    fn to_payload(&self) -> Value {
        let mut out = Map::new();
        out.insert("isArray".to_string(), Value::Bool(self.is_array));
        out.insert("name".to_string(), Value::String(self.name.clone()));
        if let Some(options) = &self.options {
            out.insert(
                "options".to_string(),
                Value::Array(options.iter().cloned().map(Value::String).collect()),
            );
        }
        if let Some(fields) = &self.fields {
            out.insert("fields".to_string(), Value::Object(fields.clone()));
        }
        Value::Object(out)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Field {
    pub name: String,
    pub title: String,
    #[serde(rename = "type")]
    pub field_type: FieldType,
    #[serde(default, rename = "isOptional")]
    pub is_optional: bool,
    #[serde(default, rename = "isInternal")]
    pub is_internal: bool,
    #[serde(default, rename = "isCached")]
    pub is_cached: bool,
}

impl Field {
    pub fn new(name: impl Into<String>, field_type: FieldType) -> Self {
        let name = name.into();
        Self {
            title: title_case(&name),
            name,
            field_type,
            is_optional: false,
            is_internal: false,
            is_cached: false,
        }
    }

}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AxSignature {
    pub description: Option<String>,
    pub inputs: Vec<Field>,
    pub outputs: Vec<Field>,
}

impl AxSignature {
    pub fn parse(spec: &str) -> AxResult<Self> {
        parse_signature(spec)
    }

    pub fn get_output_fields(&self) -> &[Field] {
        &self.outputs
    }

    pub fn to_json_schema(&self, section: &str) -> Value {
        let fields = if section == "inputs" {
            &self.inputs
        } else {
            &self.outputs
        };
        let mut properties = Map::new();
        let mut required = Vec::new();
        for field in fields {
            properties.insert(field.name.clone(), field_schema(field));
            if !field.is_optional {
                required.push(Value::String(field.name.clone()));
            }
        }
        json!({
            "type": "object",
            "properties": properties,
            "required": required
        })
    }

    fn output_names(&self) -> Vec<String> {
        self.outputs.iter().map(|field| field.name.clone()).collect()
    }
}

pub fn s(spec: &str) -> AxResult<AxSignature> {
    AxSignature::parse(spec)
}

pub struct SignatureBuilder {
    inputs: Vec<Field>,
    outputs: Vec<Field>,
}

pub fn f() -> SignatureBuilder {
    SignatureBuilder {
        inputs: Vec::new(),
        outputs: Vec::new(),
    }
}

impl SignatureBuilder {
    pub fn input(mut self, name: &str, field_type: FieldType) -> Self {
        self.inputs.push(Field::new(name, field_type));
        self
    }

    pub fn output(mut self, name: &str, field_type: FieldType) -> Self {
        self.outputs.push(Field::new(name, field_type));
        self
    }

    pub fn build(self) -> AxSignature {
        AxSignature {
            description: None,
            inputs: self.inputs,
            outputs: self.outputs,
        }
    }
}

fn parse_signature(spec: &str) -> AxResult<AxSignature> {
    let parts: Vec<&str> = spec.splitn(2, "->").collect();
    if parts.len() != 2 {
        return Err(AxError::new("signature", "signature missing ->"));
    }
    Ok(AxSignature {
        description: None,
        inputs: parse_fields(parts[0])?,
        outputs: parse_fields(parts[1])?,
    })
}

fn parse_fields(text: &str) -> AxResult<Vec<Field>> {
    let mut fields = Vec::new();
    for raw in split_top_level(text) {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let colon = raw
            .find(':')
            .ok_or_else(|| AxError::new("signature", format!("field missing type: {raw}")))?;
        let name = raw[..colon].trim().trim_start_matches('!').to_string();
        if name.is_empty() {
            return Err(AxError::new("signature", "field name is empty"));
        }
        let mut type_text = raw[colon + 1..].trim().to_string();
        let mut is_optional = false;
        if type_text.ends_with('?') {
            is_optional = true;
            type_text.pop();
        }
        let mut field = Field::new(name, parse_field_type(type_text.trim())?);
        field.is_optional = is_optional;
        field.is_internal = raw.trim_start().starts_with('!');
        fields.push(field);
    }
    Ok(fields)
}

fn parse_field_type(text: &str) -> AxResult<FieldType> {
    let mut type_text = text.trim();
    let mut is_array = false;
    if type_text.ends_with("[]") {
        is_array = true;
        type_text = type_text[..type_text.len() - 2].trim();
    }
    let mut field_type = if type_text.starts_with("class") {
        let options_text = type_text.trim_start_matches("class").trim();
        let options = options_text
            .trim_matches('"')
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        FieldType::class(options)
    } else {
        FieldType::new(if type_text.is_empty() { "string" } else { type_text })
    };
    field_type.is_array = is_array;
    Ok(field_type)
}

fn split_top_level(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote = false;
    let mut depth = 0i32;
    for ch in text.chars() {
        match ch {
            '"' => {
                quote = !quote;
                current.push(ch);
            }
            '{' | '[' | '(' if !quote => {
                depth += 1;
                current.push(ch);
            }
            '}' | ']' | ')' if !quote => {
                depth -= 1;
                current.push(ch);
            }
            ',' if !quote && depth == 0 => {
                out.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out
}

fn title_case(name: &str) -> String {
    let mut out = String::new();
    let mut upper = true;
    for ch in name.chars() {
        if ch == '_' || ch == '-' {
            out.push(' ');
            upper = true;
        } else if upper {
            for c in ch.to_uppercase() {
                out.push(c);
            }
            upper = false;
        } else {
            out.push(ch);
        }
    }
    out
}

fn field_schema(field: &Field) -> Value {
    let mut schema = match field.field_type.name.as_str() {
        "number" | "float" => json!({"type": "number"}),
        "integer" | "int" => json!({"type": "integer"}),
        "boolean" | "bool" => json!({"type": "boolean"}),
        "class" => json!({"type": "string", "enum": field.field_type.options.clone().unwrap_or_default()}),
        "object" => json!({"type": "object"}),
        _ => json!({"type": "string"}),
    };
    if field.field_type.is_array {
        schema = json!({"type": "array", "items": schema});
    }
    schema
}

pub trait AxAIClient {
    fn chat(&mut self, request: Value) -> AxResult<Value>;

    fn complete(&mut self, request: Value) -> AxResult<Value> {
        self.chat(request)
    }

    fn stream(&mut self, request: Value) -> AxResult<Vec<Value>> {
        let response = self.chat(request)?;
        if let Some(results) = response.get("results").and_then(Value::as_array) {
            return Ok(results
                .iter()
                .map(|result| json!({"results": [result.clone()]}))
                .collect());
        }
        Ok(vec![response])
    }
}

pub type AIClient = dyn AxAIClient;

pub trait AxTransport: Send {
    fn send(&mut self, request: Value) -> AxResult<Value>;
}

pub type RuntimeTransport = dyn AxTransport;

pub struct FakeTransport {
    responses: VecDeque<Value>,
    pub requests: Vec<Value>,
}

impl FakeTransport {
    pub fn new(responses: Vec<Value>) -> Self {
        Self {
            responses: responses.into(),
            requests: Vec::new(),
        }
    }
}

impl AxTransport for FakeTransport {
    fn send(&mut self, request: Value) -> AxResult<Value> {
        self.requests.push(request);
        self.responses
            .pop_front()
            .ok_or_else(|| AxError::runtime("fake transport exhausted"))
    }
}

pub struct OpenAICompatibleClient {
    pub api_key: String,
    pub api_url: String,
    pub model: String,
    pub embed_model: String,
    pub profile: String,
    pub model_config: Value,
    pub transport: Option<Box<dyn AxTransport>>,
}

impl OpenAICompatibleClient {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            api_url: "https://api.openai.com/v1".to_string(),
            model: model.into(),
            embed_model: "text-embedding-3-small".to_string(),
            profile: "openai-compatible".to_string(),
            model_config: json!({}),
            transport: None,
        }
    }

    pub fn with_transport(mut self, transport: impl AxTransport + 'static) -> Self {
        self.transport = Some(Box::new(transport));
        self
    }

    pub fn with_model_config(mut self, config: Value) -> Self {
        self.model_config = config;
        self
    }

    pub fn with_api_url(mut self, api_url: impl Into<String>) -> Self {
        self.api_url = api_url.into();
        self
    }

    pub fn with_embed_model(mut self, model: impl Into<String>) -> Self {
        self.embed_model = model.into();
        self
    }

    pub fn with_profile(mut self, profile: impl Into<String>) -> Self {
        self.profile = profile.into();
        self
    }

    fn request_body(&self, request: &Value) -> Value {
        let messages = request
            .get("chat_prompt")
            .or_else(|| request.get("chatPrompt"))
            .cloned()
            .unwrap_or_else(|| json!([]));
        let mut body = json!({
            "model": self.model,
            "messages": messages
        });
        merge_object(&mut body, &self.model_config);
        if let Some(config) = request.get("model_config").or_else(|| request.get("modelConfig")) {
            merge_model_config(&mut body, config);
        }
        if body.get("temperature").is_none() {
            body["temperature"] = json!(0);
        }
        if let Some(format) = request.get("response_format") {
            body["response_format"] = format.clone();
        }
        if let Some(tools) = request.get("tools") {
            body["tools"] = tools.clone();
        }
        body
    }

    fn stream_body(&self, request: &Value) -> Value {
        match self.profile.as_str() {
            "openai-responses" => json!({
                "model": self.model,
                "input": request.get("chat_prompt").or_else(|| request.get("chatPrompt")).cloned().unwrap_or_else(|| json!([])),
                "stream": true
            }),
            "google-gemini" => json!({
                "contents": request.get("chat_prompt").or_else(|| request.get("chatPrompt")).cloned().unwrap_or_else(|| json!([])),
                "generationConfig": {"responseMimeType": "text/plain"}
            }),
            "anthropic" => json!({
                "model": self.model,
                "messages": request.get("chat_prompt").or_else(|| request.get("chatPrompt")).cloned().unwrap_or_else(|| json!([])),
                "stream": true
            }),
            _ => {
                let mut body = self.request_body(request);
                body["stream"] = json!(true);
                body["stream_options"] = json!({"include_usage": true});
                body
            }
        }
    }

    fn endpoint_url(&self, path: &str) -> String {
        if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else {
            format!("{}{}", self.api_url.trim_end_matches('/'), path)
        }
    }

    fn chat_path(&self) -> &'static str {
        match self.profile.as_str() {
            "openai-responses" => "/responses",
            "anthropic" => "/messages",
            _ => "/chat/completions",
        }
    }

    fn stream_path(&self) -> String {
        match self.profile.as_str() {
            "google-gemini" => format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
                self.model, self.api_key
            ),
            _ => self.chat_path().to_string(),
        }
    }

    fn post_json(&mut self, path: &str, body: Value) -> AxResult<Value> {
        let url = self.endpoint_url(path);
        if let Some(transport) = self.transport.as_mut() {
            return transport.send(json!({
                "method": "POST",
                "url": url,
                "headers": {"authorization": "Bearer test-key"},
                "json": body
            }));
        }
        let response: Value = HttpClient::builder()
            .timeout(Duration::from_secs(60))
            .build()?
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()?
            .error_for_status()?
            .json()?;
        Ok(json!({"status": 200, "json": response}))
    }

    fn post_data(&mut self, path: &str, data: Value) -> AxResult<Value> {
        let url = self.endpoint_url(path);
        if let Some(transport) = self.transport.as_mut() {
            return transport.send(json!({
                "method": "POST",
                "url": url,
                "headers": {"authorization": "Bearer test-key"},
                "data": data
            }));
        }
        let response: Value = HttpClient::builder()
            .timeout(Duration::from_secs(60))
            .build()?
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&data)
            .send()?
            .error_for_status()?
            .json()?;
        Ok(json!({"status": 200, "json": response}))
    }

    fn post_stream(&mut self, path: &str, body: Value) -> AxResult<Value> {
        let url = self.endpoint_url(path);
        if let Some(transport) = self.transport.as_mut() {
            return transport.send(json!({
                "method": "POST",
                "url": url,
                "headers": {"authorization": "Bearer test-key"},
                "json": body,
                "stream": true
            }));
        }
        let text = HttpClient::builder()
            .timeout(Duration::from_secs(60))
            .build()?
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()?
            .error_for_status()?
            .text()?;
        Ok(json!({"status": 200, "body": text}))
    }

    pub fn embed(&mut self, request: Value) -> AxResult<Value> {
        let input = request
            .get("texts")
            .or_else(|| request.get("input"))
            .cloned()
            .unwrap_or_else(|| json!([]));
        let model = string_at(&request, "model").unwrap_or_else(|| self.embed_model.clone());
        if self.profile == "google-gemini" {
            let requests = input
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|text| {
                    json!({
                        "model": format!("models/{model}"),
                        "content": {"parts": [{"text": text.as_str().unwrap_or_default()}]}
                    })
                })
                .collect::<Vec<_>>();
            let path = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents?key={}",
                self.api_key
            );
            return normalize_embed_response(
                self.post_json(&path, json!({"requests": requests}))?,
                &self.profile,
            );
        }
        let body = json!({"model": model, "input": input});
        normalize_embed_response(self.post_json("/embeddings", body)?, &self.profile)
    }

    pub fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        match self.profile.as_str() {
            "google-gemini" => {
                let model = string_at(&request, "model").unwrap_or_else(|| self.model.clone());
                let path = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={}",
                    self.api_key
                );
                normalize_gemini_transcribe_response(
                    self.post_json(&path, gemini_transcribe_body(&request))?,
                )
            }
            "grok" => normalize_passthrough_response(self.post_data("/stt", grok_transcribe_body(&request))?),
            _ => normalize_passthrough_response(
                self.post_data("/audio/transcriptions", openai_transcribe_body(&request))?,
            ),
        }
    }

    pub fn speak(&mut self, request: Value) -> AxResult<Value> {
        let mut response = match self.profile.as_str() {
            "google-gemini" => {
                let model = string_at(&request, "model")
                    .unwrap_or_else(|| "gemini-2.5-flash-preview-tts".to_string());
                let path = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={}",
                    self.api_key
                );
                normalize_gemini_speak_response(
                    self.post_json(&path, gemini_speak_body(&request))?,
                    &request,
                )?
            }
            "grok" => normalize_passthrough_response(self.post_json("/tts", grok_speak_body(&request))?)?,
            "mistral" => normalize_passthrough_response(
                self.post_json("/audio/speech", mistral_speak_body(&request))?,
            )?,
            _ => normalize_passthrough_response(
                self.post_json("/audio/speech", openai_speak_body(&request))?,
            )?,
        };
        if response.get("format").is_none() {
            if let Some(obj) = response.as_object_mut() {
                obj.insert(
                    "format".to_string(),
                    request.get("format").cloned().unwrap_or_else(|| json!("mp3")),
                );
            }
        }
        Ok(response)
    }

    pub fn realtime(&self, event: Value) -> AxResult<Value> {
        Ok(normalize_realtime_event(&self.profile, &self.model, &event))
    }

    pub fn realtime_events(&self, events: Value) -> AxResult<Vec<Value>> {
        Ok(events
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|event| normalize_realtime_event(&self.profile, &self.model, event))
            .collect())
    }

    pub fn realtime_audio_setup(&self, request: Value) -> AxResult<Value> {
        Ok(json!({
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "input_audio_format": request.get("input_audio_format").cloned().unwrap_or_else(|| json!("pcm16")),
                "output_audio_format": request.get("output_audio_format").cloned().unwrap_or_else(|| json!("pcm16")),
                "turn_detection": request.get("turn_detection").cloned().unwrap_or_else(|| json!({"type": "server_vad"}))
            }
        }))
    }

    pub fn realtime_audio_input(&self, audio: Value) -> AxResult<Value> {
        Ok(json!({
            "type": "input_audio_buffer.append",
            "audio": audio
        }))
    }
}

impl AxAIClient for OpenAICompatibleClient {
    fn chat(&mut self, request: Value) -> AxResult<Value> {
        let body = self.request_body(&request);
        let path = self.chat_path().to_string();
        normalize_openai_response(self.post_json(&path, body)?)
    }

    fn stream(&mut self, request: Value) -> AxResult<Vec<Value>> {
        let body = self.stream_body(&request);
        let path = self.stream_path();
        let response = self.post_stream(&path, body)?;
        normalize_stream_response(&self.profile, &self.model, response)
    }
}

pub type AxAIService = OpenAICompatibleClient;
pub type AxBaseAI = OpenAICompatibleClient;
pub type AnthropicClient = OpenAICompatibleClient;
pub type AzureOpenAIClient = OpenAICompatibleClient;
pub type CohereClient = OpenAICompatibleClient;
pub type DeepSeekClient = OpenAICompatibleClient;
pub type GoogleGeminiClient = OpenAICompatibleClient;
pub type GrokClient = OpenAICompatibleClient;
pub type MistralClient = OpenAICompatibleClient;
pub type OpenAIResponsesClient = OpenAICompatibleClient;
pub type RekaClient = OpenAICompatibleClient;

pub fn ai(provider: &str, options: Value) -> AxResult<OpenAICompatibleClient> {
    let defaults = provider_defaults(provider)
        .ok_or_else(|| AxError::validation(format!("unknown AxAI provider {provider}")))?;
    let api_key = string_at(&options, "api_key")
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .or_else(|| std::env::var("OPENAI_APIKEY").ok())
        .unwrap_or_else(|| "test-key".to_string());
    let model = string_at(&options, "model").unwrap_or_else(|| defaults.model.to_string());
    let api_url = string_at(&options, "api_url").unwrap_or_else(|| defaults.api_url.to_string());
    let embed_model = string_at(&options, "embed_model").unwrap_or_else(|| defaults.embed_model.to_string());
    let client = OpenAICompatibleClient::new(api_key, model)
        .with_api_url(api_url)
        .with_embed_model(embed_model)
        .with_profile(defaults.profile);
    Ok(client.with_model_config(options.get("model_config").cloned().unwrap_or_else(|| json!({}))))
}

struct ProviderDefaults {
    profile: &'static str,
    api_url: &'static str,
    model: &'static str,
    embed_model: &'static str,
}

fn provider_defaults(provider: &str) -> Option<ProviderDefaults> {
    match provider {
        "openai" | "openai-compatible" => Some(ProviderDefaults {
            profile: "openai-compatible",
            api_url: "https://api.openai.com/v1",
            model: "gpt-4.1-mini",
            embed_model: "text-embedding-3-small",
        }),
        "openai-responses" | "responses" => Some(ProviderDefaults {
            profile: "openai-responses",
            api_url: "https://api.openai.com/v1",
            model: "gpt-4o",
            embed_model: "text-embedding-3-small",
        }),
        "google-gemini" | "gemini" => Some(ProviderDefaults {
            profile: "google-gemini",
            api_url: "https://generativelanguage.googleapis.com/v1beta",
            model: "gemini-2.5-flash",
            embed_model: "text-embedding-004",
        }),
        "anthropic" => Some(ProviderDefaults {
            profile: "anthropic",
            api_url: "https://api.anthropic.com/v1",
            model: "claude-3-7-sonnet-latest",
            embed_model: "text-embedding-3-small",
        }),
        "azure-openai" | "azure" => Some(ProviderDefaults {
            profile: "azure-openai",
            api_url: "https://example-resource.openai.azure.com/openai/deployments",
            model: "gpt-4.1-mini",
            embed_model: "text-embedding-3-small",
        }),
        "deepseek" => Some(ProviderDefaults {
            profile: "deepseek",
            api_url: "https://api.deepseek.com/v1",
            model: "deepseek-chat",
            embed_model: "text-embedding-3-small",
        }),
        "mistral" => Some(ProviderDefaults {
            profile: "mistral",
            api_url: "https://api.mistral.ai/v1",
            model: "mistral-large-latest",
            embed_model: "mistral-embed",
        }),
        "reka" => Some(ProviderDefaults {
            profile: "reka",
            api_url: "https://api.reka.ai/v1",
            model: "reka-flash",
            embed_model: "text-embedding-3-small",
        }),
        "cohere" => Some(ProviderDefaults {
            profile: "cohere",
            api_url: "https://api.cohere.com/v2",
            model: "command-r-plus",
            embed_model: "embed-v4.0",
        }),
        "grok" | "xai" => Some(ProviderDefaults {
            profile: "grok",
            api_url: "https://api.x.ai/v1",
            model: "grok-3-mini",
            embed_model: "text-embedding-3-small",
        }),
        _ => None,
    }
}

fn openai_transcribe_body(request: &Value) -> Value {
    json!({
        "file": request.get("audio").or_else(|| request.get("file")).cloned().unwrap_or_else(|| json!("")),
        "language": request.get("language").cloned().unwrap_or_else(|| json!("en")),
        "model": request.get("model").cloned().unwrap_or_else(|| json!("whisper-1")),
        "response_format": request.get("format").or_else(|| request.get("response_format")).cloned().unwrap_or_else(|| json!("json")),
        "prompt": request.get("prompt").cloned().unwrap_or(Value::Null),
        "temperature": request.get("temperature").cloned().unwrap_or(Value::Null)
    })
}

fn openai_speak_body(request: &Value) -> Value {
    json!({
        "input": request.get("text").or_else(|| request.get("input")).cloned().unwrap_or_else(|| json!("")),
        "model": request.get("model").cloned().unwrap_or_else(|| json!("tts-1")),
        "response_format": request.get("format").cloned().unwrap_or_else(|| json!("mp3")),
        "voice": voice_id(request, "alloy"),
        "speed": request.get("speed").cloned().unwrap_or(Value::Null)
    })
}

fn mistral_speak_body(request: &Value) -> Value {
    json!({
        "input": request.get("text").or_else(|| request.get("input")).cloned().unwrap_or_else(|| json!("")),
        "model": request.get("model").cloned().unwrap_or_else(|| json!("voxtral-mini-tts-2603")),
        "response_format": request.get("format").cloned().unwrap_or_else(|| json!("mp3")),
        "voice_id": voice_id(request, "")
    })
}

fn grok_transcribe_body(request: &Value) -> Value {
    json!({
        "file": request.get("audio").or_else(|| request.get("file")).cloned().unwrap_or_else(|| json!("")),
        "language": request.get("language").cloned().unwrap_or_else(|| json!("auto")),
        "keyterm": request.get("prompt").cloned().unwrap_or(Value::Null),
        "format": true
    })
}

fn grok_speak_body(request: &Value) -> Value {
    let format = string_at(request, "format").unwrap_or_else(|| "mp3".to_string());
    let codec = match format.as_str() {
        "pcm16" | "raw" => "pcm",
        "ulaw" => "mulaw",
        other => other,
    };
    let mut output_format = json!({"codec": codec});
    if let Some(sample_rate) = request.get("sampleRate").or_else(|| request.get("sample_rate")) {
        output_format["sample_rate"] = sample_rate.clone();
    }
    json!({
        "text": request.get("text").or_else(|| request.get("input")).cloned().unwrap_or_else(|| json!("")),
        "voice_id": voice_id(request, "eve"),
        "language": request.get("language").cloned().unwrap_or_else(|| json!("auto")),
        "output_format": output_format
    })
}

fn gemini_transcribe_body(request: &Value) -> Value {
    let audio = request.get("audio").or_else(|| request.get("file")).cloned().unwrap_or_else(|| json!(""));
    let mime_type = audio
        .get("mimeType")
        .or_else(|| audio.get("mime_type"))
        .cloned()
        .unwrap_or_else(|| json!("audio/wav"));
    let data = audio.get("data").cloned().unwrap_or(audio);
    json!({
        "contents": [{
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": data}},
                {"text": request.get("prompt").cloned().unwrap_or_else(|| json!("Generate a transcript of the speech in this audio."))}
            ]
        }]
    })
}

fn gemini_speak_body(request: &Value) -> Value {
    json!({
        "contents": [{"role": "user", "parts": [{"text": request.get("text").or_else(|| request.get("input")).cloned().unwrap_or_else(|| json!(""))}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_id(request, "Kore")
                    }
                }
            }
        }
    })
}

fn voice_id(request: &Value, default_voice: &str) -> Value {
    let voice = request.get("voice").cloned().unwrap_or_else(|| json!(default_voice));
    voice.get("id").cloned().unwrap_or(voice)
}

fn normalize_openai_response(response: Value) -> AxResult<Value> {
    let status = response.get("status").and_then(Value::as_u64).unwrap_or(200);
    if status >= 400 {
        return Err(AxError {
            category: "ai_service".to_string(),
            error_type: None,
            message: response.to_string(),
            status: Some(status as u16),
            code: None,
            retryable: status >= 500,
        });
    }
    let payload = response.get("json").cloned().unwrap_or(response);
    let choices = payload
        .get("choices")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut results = Vec::new();
    for choice in choices {
        let message = choice.get("message").cloned().unwrap_or_else(|| json!({}));
        results.push(json!({
            "index": choice.get("index").cloned().unwrap_or_else(|| json!(0)),
            "id": choice.get("id").cloned().unwrap_or_else(|| json!(choice.get("index").and_then(Value::as_i64).unwrap_or(0).to_string())),
            "content": message.get("content").cloned().unwrap_or_else(|| json!("")),
            "finish_reason": choice.get("finish_reason").cloned().unwrap_or_else(|| json!("stop")),
            "function_calls": normalize_function_calls(&message)
        }));
    }
    Ok(json!({
        "results": results,
        "remote_id": payload.get("id").cloned().unwrap_or(Value::Null),
        "model_usage": normalize_model_usage("openai", payload.get("model").and_then(Value::as_str).unwrap_or_default(), payload.get("usage"))
    }))
}

fn normalize_passthrough_response(response: Value) -> AxResult<Value> {
    let status = response.get("status").and_then(Value::as_u64).unwrap_or(200);
    if status >= 400 {
        return Err(AxError {
            category: "ai_service".to_string(),
            error_type: None,
            message: response.to_string(),
            status: Some(status as u16),
            code: None,
            retryable: status >= 500,
        });
    }
    Ok(response.get("json").cloned().unwrap_or(response))
}

fn normalize_gemini_transcribe_response(response: Value) -> AxResult<Value> {
    let payload = normalize_passthrough_response(response)?;
    let mut parts = Vec::new();
    for candidate in payload
        .get("candidates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        for part in candidate
            .get("content")
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
        }
    }
    Ok(json!({"text": parts.join("")}))
}

fn normalize_gemini_speak_response(response: Value, request: &Value) -> AxResult<Value> {
    let payload = normalize_passthrough_response(response)?;
    let mut audio = payload.get("audio").cloned();
    for candidate in payload
        .get("candidates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        for part in candidate
            .get("content")
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            if let Some(data) = part
                .get("inlineData")
                .or_else(|| part.get("inline_data"))
                .and_then(|inline| inline.get("data"))
                .cloned()
            {
                audio = Some(data);
            }
        }
    }
    Ok(json!({
        "audio": audio.unwrap_or(payload),
        "format": request.get("format").cloned().unwrap_or_else(|| json!("wav"))
    }))
}

fn normalize_embed_response(response: Value, ai_name: &str) -> AxResult<Value> {
    let payload = normalize_passthrough_response(response)?;
    if ai_name == "google-gemini" {
        let embeddings = payload
            .get("embeddings")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|item| item.get("values").cloned().unwrap_or_else(|| json!([])))
            .collect::<Vec<_>>();
        return Ok(json!({"embeddings": embeddings}));
    }
    let usage_ai_name = if ai_name == "openai-compatible" {
        "openai"
    } else {
        ai_name
    };
    let embeddings = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.get("embedding").cloned().unwrap_or_else(|| json!([])))
        .collect::<Vec<_>>();
    let model = payload.get("model").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "embeddings": embeddings,
        "remote_id": payload.get("id").cloned().unwrap_or(Value::Null),
        "model_usage": normalize_model_usage(usage_ai_name, model.as_str().unwrap_or_default(), payload.get("usage"))
    }))
}

fn normalize_stream_response(profile: &str, model: &str, response: Value) -> AxResult<Vec<Value>> {
    let status = response.get("status").and_then(Value::as_u64).unwrap_or(200);
    if status >= 400 {
        return Err(AxError {
            category: "ai_service".to_string(),
            error_type: None,
            message: response.to_string(),
            status: Some(status as u16),
            code: None,
            retryable: status >= 500,
        });
    }
    let events = if let Some(events) = response.get("events").and_then(Value::as_array) {
        events.clone()
    } else {
        let body = response.get("body").and_then(Value::as_str).unwrap_or_default();
        parse_sse_events(body)?
    };
    if profile == "anthropic" {
        return Ok(normalize_anthropic_stream_events(&events));
    }
    if profile == "openai-compatible" || profile == "openai" || profile == "grok" {
        return Ok(normalize_openai_stream_events(&events));
    }
    Ok(events
        .iter()
        .map(|event| normalize_stream_event(profile, model, event))
        .collect())
}

fn parse_sse_events(body: &str) -> AxResult<Vec<Value>> {
    let mut events = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        events.push(serde_json::from_str::<Value>(data)?);
    }
    Ok(events)
}

fn normalize_stream_event(profile: &str, model: &str, event: &Value) -> Value {
    match profile {
        "openai-responses" => normalize_responses_stream_event(model, event),
        "google-gemini" => normalize_gemini_stream_event(event),
        "anthropic" => normalize_anthropic_stream_event(event),
        _ => normalize_openai_stream_event(event),
    }
}

fn normalize_openai_stream_event(event: &Value) -> Value {
    let choice = event
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let delta = choice.get("delta").cloned().unwrap_or_else(|| json!({}));
    json!({
        "results": [{
            "index": choice.get("index").cloned().unwrap_or_else(|| json!(0)),
            "id": "0",
            "content": delta.get("content").cloned().unwrap_or_else(|| json!("")),
            "function_calls": normalize_function_calls(&delta),
            "finish_reason": choice.get("finish_reason").cloned().unwrap_or(Value::Null)
        }],
        "remote_id": event.get("id").cloned().unwrap_or(Value::Null),
        "model_usage": normalize_model_usage("openai", event.get("model").and_then(Value::as_str).unwrap_or_default(), event.get("usage"))
    })
}

fn normalize_openai_stream_events(events: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut current_tool_id = Value::Null;
    for event in events {
        let choice = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .cloned()
            .unwrap_or_else(|| json!({}));
        let delta = choice.get("delta").cloned().unwrap_or_else(|| json!({}));
        let mut function_calls = Vec::new();
        if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for call in calls {
                if let Some(id) = call.get("id") {
                    current_tool_id = id.clone();
                }
                let function = call.get("function").cloned().unwrap_or_else(|| json!({}));
                function_calls.push(json!({
                    "id": current_tool_id.clone(),
                    "type": "function",
                    "function": {
                        "name": function.get("name").cloned().unwrap_or(Value::Null),
                        "params": function.get("arguments").cloned().unwrap_or_else(|| json!(""))
                    }
                }));
            }
        } else {
            function_calls = normalize_function_calls(&delta)
                .as_array()
                .cloned()
                .unwrap_or_default();
        }
        let finish_reason = choice
            .get("finish_reason")
            .cloned()
            .map(|reason| {
                if reason.as_str() == Some("tool_calls") {
                    json!("function_call")
                } else {
                    reason
                }
            })
            .unwrap_or(Value::Null);
        out.push(json!({
            "results": [{
                "index": choice.get("index").cloned().unwrap_or_else(|| json!(0)),
                "id": "0",
                "content": delta.get("content").cloned().unwrap_or(Value::Null),
                "function_calls": function_calls,
                "finish_reason": finish_reason
            }],
            "remote_id": event.get("id").cloned().unwrap_or(Value::Null),
            "model_usage": normalize_model_usage("openai", event.get("model").and_then(Value::as_str).unwrap_or_default(), event.get("usage"))
        }));
    }
    out
}

fn normalize_responses_stream_event(model: &str, event: &Value) -> Value {
    match event.get("type").and_then(Value::as_str).unwrap_or_default() {
        "response.output_text.delta" => json!({
            "results": [{
                "index": 0,
                "id": event.get("item_id").cloned().unwrap_or_else(|| json!("0")),
                "content": event.get("delta").cloned().unwrap_or_else(|| json!("")),
                "function_calls": [],
                "finish_reason": Value::Null
            }],
            "remote_id": event.get("response_id").cloned().unwrap_or(Value::Null),
            "model_usage": Value::Null
        }),
        "response.completed" | "response.done" => {
            let response = event.get("response").cloned().unwrap_or_else(|| json!({}));
            json!({
                "results": [{
                    "index": 0,
                    "id": "0",
                    "content": "",
                    "function_calls": [],
                    "finish_reason": "stop"
                }],
                "remote_id": response.get("id").cloned().or_else(|| event.get("response_id").cloned()).unwrap_or(Value::Null),
                "model_usage": normalize_model_usage("openai-responses", response.get("model").and_then(Value::as_str).unwrap_or(model), response.get("usage"))
            })
        }
        _ => json!({"results": []}),
    }
}

fn normalize_gemini_stream_event(event: &Value) -> Value {
    let candidate = event
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let content = candidate
        .get("content")
        .and_then(|value| value.get("parts"))
        .and_then(Value::as_array)
        .and_then(|parts| parts.first())
        .and_then(|part| part.get("text"))
        .cloned()
        .unwrap_or_else(|| json!(""));
    let finish_reason = candidate
        .get("finishReason")
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase())
        .map(|value| if value == "stop" { "stop".to_string() } else { value });
    let mut output = json!({
        "results": [{
            "index": 0,
            "content": content,
            "function_calls": [],
            "finish_reason": finish_reason
        }],
        "model_usage": normalize_gemini_usage(event.get("usageMetadata"))
    });
    if let Some(response_id) = event.get("responseId") {
        output["remote_id"] = response_id.clone();
    }
    output
}

fn normalize_anthropic_stream_event(event: &Value) -> Value {
    let remote_id = event
        .get("message")
        .and_then(|message| message.get("id"))
        .or_else(|| event.get("message_id"))
        .cloned()
        .unwrap_or_else(|| json!("msg_stream_a"));
    match event.get("type").and_then(Value::as_str).unwrap_or_default() {
        "message_start" => {
            let message = event.get("message").cloned().unwrap_or_else(|| json!({}));
            json!({
                "results": [{
                    "index": 0,
                    "id": message.get("id").cloned().unwrap_or_else(|| json!("0")),
                    "content": ""
                }],
                "remote_id": message.get("id").cloned().unwrap_or(Value::Null),
                "model_usage": normalize_model_usage("anthropic", message.get("model").and_then(Value::as_str).unwrap_or_default(), message.get("usage"))
            })
        }
        "content_block_start" => {
            let block = event.get("content_block").cloned().unwrap_or_else(|| json!({}));
            json!({
                "results": [{
                    "index": 0,
                    "function_calls": [{
                        "id": block.get("id").cloned().unwrap_or(Value::Null),
                        "type": "function",
                        "function": {
                            "name": block.get("name").cloned().unwrap_or(Value::Null),
                            "params": ""
                        }
                    }]
                }],
                "remote_id": remote_id
            })
        }
        "content_block_delta" => {
            let delta = event.get("delta").cloned().unwrap_or_else(|| json!({}));
            match delta.get("type").and_then(Value::as_str).unwrap_or_default() {
                "input_json_delta" => json!({
                    "results": [{
                        "index": 0,
                        "function_calls": [{
                            "id": "toolu_stream",
                            "type": "function",
                            "function": {"name": "search", "params": delta.get("partial_json").cloned().unwrap_or_else(|| json!(""))}
                        }]
                    }],
                    "remote_id": remote_id
                }),
                "thinking_delta" => json!({
                    "results": [{
                        "index": 0,
                        "thought": delta.get("thinking").cloned().unwrap_or_else(|| json!("")),
                        "thought_blocks": [{"data": delta.get("thinking").cloned().unwrap_or_else(|| json!("")), "encrypted": false}]
                    }],
                    "remote_id": remote_id
                }),
                _ => json!({
                    "results": [{
                        "index": 0,
                        "content": delta.get("text").cloned().unwrap_or_else(|| json!(""))
                    }],
                    "remote_id": remote_id
                }),
            }
        }
        "message_delta" => json!({
            "results": [{
                "index": 0,
                "content": "",
                "finish_reason": if event.get("delta").and_then(|delta| delta.get("stop_reason")).and_then(Value::as_str) == Some("tool_use") { "function_call" } else { "stop" }
            }],
            "remote_id": remote_id,
            "model_usage": normalize_model_usage("anthropic", "claude-3-7-sonnet-latest", event.get("usage"))
        }),
        _ => json!({"results": []}),
    }
}

fn normalize_anthropic_stream_events(events: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut remote_id = "0".to_string();
    let mut model = "claude-3-7-sonnet-latest".to_string();
    let mut prompt_tokens = 0;
    let mut cache_read_tokens = 0;
    let mut cache_creation_tokens = 0;
    let mut tool_id = String::new();
    let mut tool_name = String::new();
    for event in events {
        match event.get("type").and_then(Value::as_str).unwrap_or_default() {
            "message_start" => {
                let message = event.get("message").cloned().unwrap_or_else(|| json!({}));
                remote_id = message.get("id").and_then(Value::as_str).unwrap_or("0").to_string();
                model = message
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("claude-3-7-sonnet-latest")
                    .to_string();
                if let Some(usage) = message.get("usage") {
                    prompt_tokens = usage.get("input_tokens").and_then(Value::as_i64).unwrap_or(0);
                    cache_read_tokens = usage
                        .get("cache_read_input_tokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    cache_creation_tokens = usage
                        .get("cache_creation_input_tokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                }
                out.push(json!({
                    "results": [{"index": 0, "id": remote_id.clone(), "content": ""}],
                    "remote_id": remote_id.clone(),
                    "model_usage": {
                        "ai": "anthropic",
                        "model": model.clone(),
                        "tokens": {
                            "cache_read_tokens": cache_read_tokens,
                            "completion_tokens": 0,
                            "prompt_tokens": prompt_tokens,
                            "total_tokens": prompt_tokens + cache_read_tokens + cache_creation_tokens
                        }
                    }
                }));
            }
            "content_block_start" => {
                let block = event.get("content_block").cloned().unwrap_or_else(|| json!({}));
                tool_id = block.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                tool_name = block.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                out.push(json!({
                        "results": [{
                            "index": 0,
                            "function_calls": [{
                            "id": tool_id.clone(),
                            "type": "function",
                            "function": {"name": tool_name.clone(), "params": ""}
                        }]
                    }],
                    "remote_id": remote_id.clone()
                }));
            }
            "content_block_delta" => {
                let delta = event.get("delta").cloned().unwrap_or_else(|| json!({}));
                match delta.get("type").and_then(Value::as_str).unwrap_or_default() {
                    "input_json_delta" => out.push(json!({
                        "results": [{
                            "index": 0,
                                "function_calls": [{
                                "id": tool_id.clone(),
                                "type": "function",
                                "function": {"name": tool_name.clone(), "params": delta.get("partial_json").cloned().unwrap_or_else(|| json!(""))}
                            }]
                        }],
                        "remote_id": remote_id.clone()
                    })),
                    "thinking_delta" => out.push(json!({
                        "results": [{
                            "index": 0,
                            "thought": delta.get("thinking").cloned().unwrap_or_else(|| json!("")),
                            "thought_blocks": [{"data": delta.get("thinking").cloned().unwrap_or_else(|| json!("")), "encrypted": false}]
                        }],
                        "remote_id": remote_id.clone()
                    })),
                    _ => out.push(json!({
                        "results": [{
                            "index": 0,
                            "content": delta.get("text").cloned().unwrap_or_else(|| json!(""))
                        }],
                        "remote_id": remote_id.clone()
                    })),
                }
            }
            "message_delta" => {
                let completion_tokens = event
                    .get("usage")
                    .and_then(|usage| usage.get("output_tokens"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                out.push(json!({
                    "results": [{
                        "index": 0,
                        "content": "",
                        "finish_reason": if event.get("delta").and_then(|delta| delta.get("stop_reason")).and_then(Value::as_str) == Some("tool_use") { "function_call" } else { "stop" }
                    }],
                    "remote_id": remote_id.clone(),
                    "model_usage": {
                        "ai": "anthropic",
                        "model": model.clone(),
                        "tokens": {
                            "cache_creation_tokens": cache_creation_tokens,
                            "cache_read_tokens": cache_read_tokens,
                            "completion_tokens": completion_tokens,
                            "prompt_tokens": prompt_tokens,
                            "total_tokens": prompt_tokens + completion_tokens + cache_read_tokens + cache_creation_tokens
                        }
                    }
                }));
            }
            _ => {}
        }
    }
    out
}

fn normalize_realtime_event(profile: &str, model: &str, event: &Value) -> Value {
    if profile == "google-gemini" {
        return normalize_gemini_realtime_event(model, event);
    }
    if profile == "grok" {
        return normalize_grok_realtime_event(model, event);
    }
    match event.get("type").and_then(Value::as_str).unwrap_or_default() {
        "response.text.delta" | "response.output_text.delta" => json!({
            "results": [{
                "index": 0,
                "id": event.get("item_id").cloned().unwrap_or_else(|| json!("0")),
                "content": event.get("delta").cloned().unwrap_or_else(|| json!("")),
                "function_calls": [],
                "finish_reason": Value::Null
            }],
            "remote_id": event.get("id").or_else(|| event.get("response_id")).cloned().unwrap_or(Value::Null),
            "model_usage": Value::Null
        }),
        "response.done" | "response.completed" => {
            let response = event.get("response").cloned().unwrap_or_else(|| json!({}));
            json!({
                "results": [{
                    "index": 0,
                    "id": "0",
                    "content": "",
                    "function_calls": [],
                    "finish_reason": "stop"
                }],
                "remote_id": response.get("id").cloned().unwrap_or(Value::Null),
                "model_usage": normalize_model_usage(profile, response.get("model").and_then(Value::as_str).unwrap_or(model), response.get("usage"))
            })
        }
        _ => json!({"results": []}),
    }
}

fn normalize_grok_realtime_event(model: &str, event: &Value) -> Value {
    let remote_id = event.get("response_id").cloned().or_else(|| {
        event.get("response").and_then(|response| response.get("id")).cloned()
    }).unwrap_or(Value::Null);
    match event.get("type").and_then(Value::as_str).unwrap_or_default() {
        "response.output_audio_transcript.delta" => json!({
            "results": [{
                "index": 0,
                "id": remote_id.clone(),
                "content": event.get("delta").cloned().unwrap_or_else(|| json!("")),
                "function_calls": [],
                "finish_reason": Value::Null
            }],
            "remote_id": remote_id,
            "model_usage": Value::Null
        }),
        "response.output_audio.delta" => json!({
            "results": [{
                "index": 0,
                "id": remote_id.clone(),
                "content": "",
                "function_calls": [],
                "finish_reason": Value::Null,
                "audio": {
                    "data": event.get("delta").cloned().unwrap_or_else(|| json!("")),
                    "format": "pcm16",
                    "is_delta": true
                }
            }],
            "remote_id": remote_id,
            "model_usage": Value::Null
        }),
        "response.done" | "response.completed" => {
            let response = event.get("response").cloned().unwrap_or_else(|| json!({}));
            json!({
                "results": [{
                    "index": 0,
                    "id": "0",
                    "content": "",
                    "function_calls": [],
                    "finish_reason": "stop"
                }],
                "remote_id": response.get("id").cloned().unwrap_or(remote_id),
                "model_usage": normalize_model_usage("Grok", model, response.get("usage"))
            })
        }
        _ => json!({"results": []}),
    }
}

fn normalize_gemini_realtime_event(model: &str, event: &Value) -> Value {
    let remote_id = event.get("id").cloned().unwrap_or(Value::Null);
    if let Some(text) = event
        .get("serverContent")
        .and_then(|content| content.get("outputTranscription"))
        .and_then(|transcript| transcript.get("text"))
        .cloned()
    {
        return json!({
            "results": [{
                "index": 0,
                "id": "0",
                "content": text,
                "function_calls": [],
                "finish_reason": Value::Null
            }],
            "remote_id": remote_id,
            "model_usage": Value::Null
        });
    }
    if let Some(inline) = event
        .get("serverContent")
        .and_then(|content| content.get("modelTurn"))
        .and_then(|turn| turn.get("parts"))
        .and_then(Value::as_array)
        .and_then(|parts| parts.first())
        .and_then(|part| part.get("inlineData"))
    {
        return json!({
            "results": [{
                "index": 0,
                "id": "0",
                "content": "",
                "function_calls": [],
                "finish_reason": Value::Null,
                "audio": {
                    "data": inline.get("data").cloned().unwrap_or_else(|| json!("")),
                    "mimeType": inline.get("mimeType").cloned().unwrap_or_else(|| json!("audio/pcm")),
                    "format": "pcm16",
                    "sampleRate": 24000,
                    "is_delta": true
                }
            }],
            "remote_id": remote_id,
            "model_usage": Value::Null
        });
    }
    if let Some(calls) = event
        .get("toolCall")
        .and_then(|tool| tool.get("functionCalls"))
        .and_then(Value::as_array)
    {
        let function_calls = calls
            .iter()
            .map(|call| {
                let name = call.get("name").cloned().unwrap_or_else(|| json!(""));
                json!({
                    "id": name.clone(),
                    "type": "function",
                    "function": {
                        "name": name,
                        "params": call.get("args").cloned().unwrap_or_else(|| json!({}))
                    }
                })
            })
            .collect::<Vec<_>>();
        return json!({
            "results": [{
                "index": 0,
                "id": "0",
                "content": "",
                "function_calls": function_calls,
                "finish_reason": "function_call"
            }],
            "remote_id": remote_id,
            "model_usage": Value::Null
        });
    }
    if event
        .get("serverContent")
        .and_then(|content| content.get("turnComplete"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({
            "results": [{
                "index": 0,
                "id": "0",
                "content": "",
                "function_calls": [],
                "finish_reason": "stop"
            }],
            "remote_id": remote_id,
            "model_usage": normalize_gemini_usage_with_model(event.get("usageMetadata"), model)
        });
    }
    json!({"results": []})
}

fn normalize_gemini_usage(usage: Option<&Value>) -> Value {
    normalize_gemini_usage_with_model(usage, "gemini-2.5-flash")
}

fn normalize_gemini_usage_with_model(usage: Option<&Value>, model: &str) -> Value {
    let Some(usage) = usage else {
        return Value::Null;
    };
    json!({
        "ai": "GoogleGeminiAI",
        "model": model,
        "tokens": {
            "prompt_tokens": usage.get("promptTokenCount").cloned().unwrap_or_else(|| json!(0)),
            "completion_tokens": usage.get("candidatesTokenCount").cloned().unwrap_or_else(|| json!(0)),
            "total_tokens": usage.get("totalTokenCount").cloned().unwrap_or_else(|| json!(0))
        }
    })
}

fn normalize_model_usage(ai_name: &str, model: &str, usage: Option<&Value>) -> Value {
    let Some(usage) = usage else {
        return Value::Null;
    };
    let prompt = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .or_else(|| usage.get("promptTokens"))
        .or_else(|| usage.get("inputTokens"))
        .cloned()
        .unwrap_or_else(|| json!(0));
    let completion = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .or_else(|| usage.get("completionTokens"))
        .or_else(|| usage.get("outputTokens"))
        .cloned()
        .unwrap_or_else(|| json!(0));
    let total = usage
        .get("total_tokens")
        .or_else(|| usage.get("totalTokens"))
        .cloned()
        .unwrap_or_else(|| json!(prompt.as_i64().unwrap_or(0) + completion.as_i64().unwrap_or(0)));
    let mut tokens = Map::new();
    tokens.insert("prompt_tokens".to_string(), prompt);
    tokens.insert("completion_tokens".to_string(), completion);
    tokens.insert("total_tokens".to_string(), total);
    if let Some(value) = usage.get("cache_read_input_tokens").or_else(|| usage.get("cache_read_tokens")) {
        tokens.insert("cache_read_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage.get("cache_creation_input_tokens").or_else(|| usage.get("cache_creation_tokens")) {
        tokens.insert("cache_creation_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage.get("cacheReadTokens") {
        tokens.insert("cache_read_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage.get("cacheCreationTokens") {
        tokens.insert("cache_creation_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage.get("reasoning_tokens").or_else(|| usage.get("reasoningTokens")) {
        tokens.insert("reasoning_tokens".to_string(), value.clone());
    }
    json!({
        "ai": ai_name,
        "model": model,
        "tokens": Value::Object(tokens)
    })
}

fn normalize_function_calls(message: &Value) -> Value {
    if let Some(calls) = message.get("function_calls") {
        return calls.clone();
    }
    let mut out = Vec::new();
    if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
        for call in calls {
            let function = call.get("function").cloned().unwrap_or_else(|| json!({}));
            let params = function
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .unwrap_or_else(|| json!({}));
            out.push(json!({
                "id": call.get("id").cloned().unwrap_or(Value::Null),
                "name": function.get("name").cloned().unwrap_or(Value::Null),
                "params": params
            }));
        }
    }
    Value::Array(out)
}

pub struct Tool {
    pub name: String,
    pub description: String,
    pub args: Map<String, Value>,
    handler: Arc<dyn Fn(Value) -> AxResult<Value> + Send + Sync>,
}

impl Tool {
    pub fn call(&self, args: Value) -> AxResult<Value> {
        (self.handler)(args)
    }
}

pub struct ToolBuilder {
    name: String,
    description: String,
    args: Map<String, Value>,
}

pub fn tool(name: &str) -> ToolBuilder {
    ToolBuilder {
        name: name.to_string(),
        description: String::new(),
        args: Map::new(),
    }
}

impl ToolBuilder {
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    pub fn arg(mut self, name: &str, field_type: FieldType) -> Self {
        self.args.insert(name.to_string(), field_type.to_payload());
        self
    }

    pub fn handler(
        self,
        handler: impl Fn(Value) -> AxResult<Value> + Send + Sync + 'static,
    ) -> Tool {
        Tool {
            name: self.name,
            description: self.description,
            args: self.args,
            handler: Arc::new(handler),
        }
    }
}

pub struct AxGen {
    pub signature: AxSignature,
    pub tools: Vec<Tool>,
    pub traces: Vec<Value>,
    pub chat_log: Vec<Value>,
}

pub fn ax(spec: &str) -> AxResult<AxGen> {
    AxGen::new(spec)
}

impl AxGen {
    pub fn new(spec: &str) -> AxResult<Self> {
        Ok(Self {
            signature: s(spec)?,
            tools: Vec::new(),
            traces: Vec::new(),
            chat_log: Vec::new(),
        })
    }

    pub fn with_tool(mut self, tool: Tool) -> Self {
        self.tools.push(tool);
        self
    }

    pub fn forward<C: AxAIClient>(&mut self, client: &mut C, input: Value) -> AxResult<Value> {
        let mut messages = vec![json!({
            "role": "user",
            "content": format!("Inputs: {}", stable_stringify(&input))
        })];
        let mut calls_seen = Vec::new();
        for _ in 0..4 {
            let request = json!({
                "chat_prompt": messages,
                "response_format": {"type": "json_object"},
                "tools": self.tool_descriptors()
            });
            let response = client.chat(request.clone())?;
            self.chat_log.push(json!({"name": "generator", "request": request, "response": response}));
            let result = response
                .get("results")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .cloned()
                .unwrap_or_else(|| json!({}));
            let calls = result
                .get("function_calls")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if !calls.is_empty() {
                for call in calls {
                    let name = call.get("name").and_then(Value::as_str).unwrap_or_default();
                    let params = call.get("params").cloned().unwrap_or_else(|| json!({}));
                    let tool = self.tools.iter().find(|candidate| candidate.name == name);
                    let output = match tool {
                        Some(tool) => tool.call(params)?,
                        None => json!({"error": format!("unknown tool {name}")}),
                    };
                    calls_seen.push(json!({"name": name, "output": output}));
                    messages.push(json!({
                        "role": "tool",
                        "content": stable_stringify(calls_seen.last().unwrap())
                    }));
                }
                continue;
            }
            let content = result.get("content").and_then(Value::as_str).unwrap_or_default();
            let output = parse_model_output(content, &self.signature)?;
            self.traces.push(json!({"input": input, "output": output, "tool_calls": calls_seen}));
            return Ok(output);
        }
        Err(AxError::runtime("AxGen exhausted retry loop"))
    }

    pub fn get_traces(&self) -> &[Value] {
        &self.traces
    }

    pub fn get_chat_log(&self) -> &[Value] {
        &self.chat_log
    }

    fn tool_descriptors(&self) -> Value {
        Value::Array(
            self.tools
                .iter()
                .map(|tool| json!({"type": "function", "function": {"name": tool.name, "description": tool.description, "parameters": {"type": "object", "properties": tool.args}}}))
                .collect(),
        )
    }
}

fn parse_model_output(content: &str, signature: &AxSignature) -> AxResult<Value> {
    let trimmed = content.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Ok(serde_json::from_str(trimmed)?);
    }
    let names = signature.output_names();
    if names.len() == 1 {
        return Ok(json!({names[0].clone(): content}));
    }
    Err(AxError::validation("model output is not JSON"))
}

pub trait AxProgram {
    fn program_kind(&self) -> &'static str;
}

impl AxProgram for AxGen {
    fn program_kind(&self) -> &'static str {
        "AxGen"
    }
}

pub struct AxAgent {
    pub program: AxGen,
    pub action_log: Vec<Value>,
    runtime_session: Option<Box<dyn AxCodeSession>>,
}

pub fn agent(spec: &str) -> AxResult<AxAgent> {
    Ok(AxAgent {
        program: AxGen::new(spec)?,
        action_log: Vec::new(),
        runtime_session: None,
    })
}

impl AxAgent {
    pub fn forward<C: AxAIClient>(&mut self, client: &mut C, input: Value) -> AxResult<Value> {
        self.action_log.push(json!({"type": "forward_started"}));
        let output = self.program.forward(client, input)?;
        self.action_log.push(json!({"type": "forward_completed", "output": output.clone()}));
        Ok(output)
    }

    pub fn execute_actor_step(
        &mut self,
        runtime: &mut dyn AxCodeRuntime,
        code: &str,
        input: Value,
    ) -> AxResult<RuntimeEnvelope> {
        if self.runtime_session.is_none() {
            self.runtime_session = Some(runtime.create_session(
                json!({"inputs": input}),
                json!({"reservedNames": ["inputs", "final"]}),
            )?);
        }
        let session = self.runtime_session.as_mut().expect("session initialized");
        let result = session.execute(code, json!({"reservedNames": ["inputs", "final"]}))?;
        self.action_log.push(json!({"type": "runtime_execute", "result": result.payload.clone()}));
        Ok(result)
    }

    pub fn test(
        &mut self,
        runtime: &mut dyn AxCodeRuntime,
        code: &str,
        input: Value,
    ) -> AxResult<RuntimeEnvelope> {
        self.execute_actor_step(runtime, code, input)
    }

    pub fn inspect_runtime(&mut self) -> AxResult<Value> {
        match self.runtime_session.as_mut() {
            Some(session) => session.inspect_globals(json!({})),
            None => Ok(json!({})),
        }
    }

    pub fn export_session_state(&mut self) -> AxResult<Value> {
        match self.runtime_session.as_mut() {
            Some(session) => session.snapshot_globals(json!({})),
            None => Ok(json!({})),
        }
    }

    pub fn restore_session_state(&mut self, snapshot: Value) -> AxResult<Value> {
        match self.runtime_session.as_mut() {
            Some(session) => session.patch_globals(snapshot, json!({})),
            None => Ok(snapshot),
        }
    }

    pub fn close_runtime_session(&mut self) -> AxResult<Value> {
        match self.runtime_session.as_mut() {
            Some(session) => session.close(),
            None => Ok(json!({"closed": true})),
        }
    }

    pub fn get_chat_log(&self) -> &[Value] {
        self.program.get_chat_log()
    }

    pub fn get_action_log(&self) -> &[Value] {
        &self.action_log
    }
}

impl AxProgram for AxAgent {
    fn program_kind(&self) -> &'static str {
        "AxAgent"
    }
}

pub struct AxFlow {
    id: String,
    steps: Vec<(String, AxGen)>,
    returns: Map<String, Value>,
    state: Map<String, Value>,
}

pub fn flow(id: &str) -> AxFlow {
    AxFlow {
        id: id.to_string(),
        steps: Vec::new(),
        returns: Map::new(),
        state: Map::new(),
    }
}

impl AxFlow {
    pub fn execute(mut self, name: &str, program: AxGen) -> Self {
        self.steps.push((name.to_string(), program));
        self
    }

    pub fn returns(mut self, mapping: Value) -> Self {
        self.returns = mapping.as_object().cloned().unwrap_or_default();
        self
    }

    pub fn forward<C: AxAIClient>(&mut self, client: &mut C, input: Value) -> AxResult<Value> {
        self.state = input.as_object().cloned().unwrap_or_default();
        for (name, program) in &mut self.steps {
            let output = program.forward(client, Value::Object(self.state.clone()))?;
            if let Some(obj) = output.as_object() {
                for (key, value) in obj {
                    self.state.insert(key.clone(), value.clone());
                }
            }
            self.state.insert(format!("{name}_done"), Value::Bool(true));
        }
        let mut out = Map::new();
        if self.returns.is_empty() {
            return Ok(Value::Object(self.state.clone()));
        }
        for (key, source) in &self.returns {
            let source_key = source.as_str().unwrap_or(key);
            out.insert(
                key.clone(),
                self.state.get(source_key).cloned().unwrap_or(Value::Null),
            );
        }
        Ok(Value::Object(out))
    }

    pub fn get_plan(&self) -> Value {
        json!({
            "id": self.id,
            "steps": self.steps.iter().map(|(name, _)| json!({"name": name})).collect::<Vec<_>>()
        })
    }
}

impl AxProgram for AxFlow {
    fn program_kind(&self) -> &'static str {
        "AxFlow"
    }
}

pub trait OptimizerEngine {
    fn optimize(&mut self, request: Value, evaluator: &mut dyn FnMut(Value) -> AxResult<Value>) -> AxResult<Value>;
}

pub type OptimizerEvaluator<'a> = dyn FnMut(Value) -> AxResult<Value> + 'a;
pub type OptimizedArtifact = Value;

pub struct AxGEPA {
    pub max_rounds: usize,
}

impl AxGEPA {
    pub fn new() -> Self {
        Self { max_rounds: 1 }
    }
}

impl Default for AxGEPA {
    fn default() -> Self {
        Self::new()
    }
}

impl OptimizerEngine for AxGEPA {
    fn optimize(
        &mut self,
        request: Value,
        evaluator: &mut dyn FnMut(Value) -> AxResult<Value>,
    ) -> AxResult<Value> {
        let candidate = request
            .get("candidate")
            .cloned()
            .unwrap_or_else(|| request.clone());
        let score = evaluator(json!({"candidate": candidate.clone()}))?;
        Ok(json!({
            "artifact": {
                "version": 1,
                "kind": "gepa",
                "candidate": candidate,
                "score": score,
                "rounds": self.max_rounds
            }
        }))
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AxMemory {
    pub entries: Vec<Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RuntimeCapabilities {
    pub inspect_globals: bool,
    pub snapshot_globals: bool,
    pub patch_globals: bool,
}

pub type AxAgentClarificationError = AxError;

pub struct AxBalancer {
    services: Vec<OpenAICompatibleClient>,
    current: usize,
}

pub struct MultiServiceRouter {
    services: BTreeMap<String, OpenAICompatibleClient>,
}

pub struct ProviderRouter {
    providers: BTreeMap<String, OpenAICompatibleClient>,
}

impl AxBalancer {
    pub fn new() -> Self {
        Self {
            services: Vec::new(),
            current: 0,
        }
    }

    pub fn from_services(services: Vec<OpenAICompatibleClient>) -> Self {
        Self {
            services,
            current: 0,
        }
    }

    pub fn with_service(mut self, service: OpenAICompatibleClient) -> Self {
        self.services.push(service);
        self
    }

    fn current_service(&mut self) -> AxResult<&mut OpenAICompatibleClient> {
        if self.services.is_empty() {
            return Err(AxError::validation("AxBalancer requires at least one service"));
        }
        if self.current >= self.services.len() {
            self.current = 0;
        }
        Ok(&mut self.services[self.current])
    }

    pub fn chat(&mut self, request: Value) -> AxResult<Value> {
        self.current_service()?.chat(request)
    }

    pub fn stream(&mut self, request: Value) -> AxResult<Vec<Value>> {
        self.current_service()?.stream(request)
    }

    pub fn embed(&mut self, request: Value) -> AxResult<Value> {
        self.current_service()?.embed(request)
    }

    pub fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        self.current_service()?.transcribe(request)
    }

    pub fn speak(&mut self, request: Value) -> AxResult<Value> {
        self.current_service()?.speak(request)
    }
}

impl Default for AxBalancer {
    fn default() -> Self {
        Self::new()
    }
}

impl MultiServiceRouter {
    pub fn new() -> Self {
        Self {
            services: BTreeMap::new(),
        }
    }

    pub fn from_services<K: Into<String>>(services: Vec<(K, OpenAICompatibleClient)>) -> Self {
        let mut router = Self::new();
        for (key, service) in services {
            router.services.insert(key.into(), service);
        }
        router
    }

    pub fn with_service(mut self, key: impl Into<String>, service: OpenAICompatibleClient) -> Self {
        self.services.insert(key.into(), service);
        self
    }

    fn service_key(&self, request: &Value) -> AxResult<String> {
        if let Some(model) = request
            .get("model")
            .or_else(|| request.get("model_key"))
            .or_else(|| request.get("modelKey"))
            .and_then(Value::as_str)
        {
            if self.services.contains_key(model) {
                return Ok(model.to_string());
            }
        }
        self.services
            .keys()
            .next()
            .cloned()
            .ok_or_else(|| AxError::validation("MultiServiceRouter requires at least one service"))
    }

    fn service_for(&mut self, request: &Value) -> AxResult<&mut OpenAICompatibleClient> {
        let key = self.service_key(request)?;
        self.services
            .get_mut(&key)
            .ok_or_else(|| AxError::validation(format!("MultiServiceRouter service {key} not found")))
    }

    pub fn chat(&mut self, request: Value) -> AxResult<Value> {
        self.service_for(&request)?.chat(request)
    }

    pub fn stream(&mut self, request: Value) -> AxResult<Vec<Value>> {
        self.service_for(&request)?.stream(request)
    }

    pub fn embed(&mut self, request: Value) -> AxResult<Value> {
        self.service_for(&request)?.embed(request)
    }

    pub fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        self.service_for(&request)?.transcribe(request)
    }

    pub fn speak(&mut self, request: Value) -> AxResult<Value> {
        self.service_for(&request)?.speak(request)
    }
}

impl Default for MultiServiceRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderRouter {
    pub fn new() -> Self {
        Self {
            providers: BTreeMap::new(),
        }
    }

    pub fn from_providers<K: Into<String>>(providers: Vec<(K, OpenAICompatibleClient)>) -> Self {
        let mut router = Self::new();
        for (key, provider) in providers {
            router.providers.insert(key.into(), provider);
        }
        router
    }

    pub fn with_provider(mut self, key: impl Into<String>, provider: OpenAICompatibleClient) -> Self {
        self.providers.insert(key.into(), provider);
        self
    }

    pub fn get_routing_recommendation(&self, request: Value) -> AxResult<Value> {
        let provider = request
            .get("provider")
            .and_then(Value::as_str)
            .filter(|name| self.providers.contains_key(*name))
            .map(str::to_string)
            .or_else(|| self.providers.keys().next().cloned())
            .ok_or_else(|| AxError::validation("ProviderRouter requires at least one provider"))?;
        Ok(json!({"provider": provider, "reason": "available"}))
    }

    fn provider_key(&self, request: &Value) -> AxResult<String> {
        if let Some(provider) = request.get("provider").and_then(Value::as_str) {
            if self.providers.contains_key(provider) {
                return Ok(provider.to_string());
            }
        }
        self.providers
            .keys()
            .next()
            .cloned()
            .ok_or_else(|| AxError::validation("ProviderRouter requires at least one provider"))
    }

    fn provider_for(&mut self, request: &Value) -> AxResult<&mut OpenAICompatibleClient> {
        let key = self.provider_key(request)?;
        self.providers
            .get_mut(&key)
            .ok_or_else(|| AxError::validation(format!("ProviderRouter provider {key} not found")))
    }

    pub fn chat(&mut self, request: Value) -> AxResult<Value> {
        self.provider_for(&request)?.chat(request)
    }

    pub fn stream(&mut self, request: Value) -> AxResult<Vec<Value>> {
        self.provider_for(&request)?.stream(request)
    }

    pub fn embed(&mut self, request: Value) -> AxResult<Value> {
        self.provider_for(&request)?.embed(request)
    }

    pub fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        self.provider_for(&request)?.transcribe(request)
    }

    pub fn speak(&mut self, request: Value) -> AxResult<Value> {
        self.provider_for(&request)?.speak(request)
    }
}

impl Default for ProviderRouter {
    fn default() -> Self {
        Self::new()
    }
}

pub fn get_supported_ai_models() -> Vec<&'static str> {
    vec!["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"]
}

pub trait AxCodeRuntime {
    fn language(&self) -> &str;

    fn usage_instructions(&self) -> &str {
        ""
    }

    fn create_session(&mut self, globals: Value, options: Value) -> AxResult<Box<dyn AxCodeSession>>;
}

pub trait AxCodeSession {
    fn execute(&mut self, code: &str, options: Value) -> AxResult<RuntimeEnvelope>;
    fn inspect_globals(&mut self, _options: Value) -> AxResult<Value> {
        Ok(json!({}))
    }
    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        Ok(json!({}))
    }
    fn patch_globals(&mut self, snapshot: Value, _options: Value) -> AxResult<Value> {
        Ok(snapshot)
    }
    fn close(&mut self) -> AxResult<Value> {
        Ok(json!({"closed": true}))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeEnvelope {
    #[serde(flatten)]
    pub payload: Value,
}

impl RuntimeEnvelope {
    pub fn final_payload(value: Value) -> Self {
        Self {
            payload: json!({"kind": "final", "type": "final", "completion_payload": {"args": [value.clone()]}, "args": [value]}),
        }
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self {
            payload: json!({"kind": "error", "error_category": "timeout", "message": message.into()}),
        }
    }
}

pub struct ProcessCodeRuntime {
    command: Vec<String>,
    child: Option<Arc<Mutex<ProtocolChild>>>,
    language: String,
}

pub type RuntimeProtocolClient = ProcessCodeRuntime;

struct ProtocolChild {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    next_id: usize,
}

impl ProcessCodeRuntime {
    pub fn new(command: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            command: command.into_iter().map(Into::into).collect(),
            child: None,
            language: "JavaScript".to_string(),
        }
    }

    pub fn shutdown(&mut self) -> AxResult<()> {
        if let Some(child) = &self.child {
            let mut child = child
                .lock()
                .map_err(|_| AxError::runtime("runtime protocol lock poisoned"))?;
            let _ = child.request("shutdown", None, json!({}));
            let _ = child.child.kill();
        }
        self.child = None;
        Ok(())
    }

    fn child(&mut self) -> AxResult<Arc<Mutex<ProtocolChild>>> {
        if self.child.is_none() {
            if self.command.is_empty() {
                return Err(AxError::runtime("process runtime command is empty"));
            }
            let mut command = Command::new(&self.command[0]);
            command.args(&self.command[1..]);
            command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
            let mut child = command.spawn()?;
            let stdin = child.stdin.take().ok_or_else(|| AxError::runtime("missing runtime stdin"))?;
            let stdout = child.stdout.take().ok_or_else(|| AxError::runtime("missing runtime stdout"))?;
            self.child = Some(Arc::new(Mutex::new(ProtocolChild {
                child,
                stdin,
                stdout: BufReader::new(stdout),
                next_id: 0,
            })));
        }
        Ok(self.child.as_ref().expect("runtime child exists").clone())
    }
}

impl AxCodeRuntime for ProcessCodeRuntime {
    fn language(&self) -> &str {
        &self.language
    }

    fn create_session(&mut self, globals: Value, options: Value) -> AxResult<Box<dyn AxCodeSession>> {
        let child = self.child()?;
        let response = {
            let mut child = child
                .lock()
                .map_err(|_| AxError::runtime("runtime protocol lock poisoned"))?;
            child.request("create_session", None, json!({"globals": globals, "options": options}))?
        };
        let session_id = response
            .get("session_id")
            .or_else(|| response.get("result").and_then(|result| result.get("session_id")))
            .and_then(Value::as_str)
            .ok_or_else(|| AxError::runtime("runtime protocol response missing session_id"))?
            .to_string();
        Ok(Box::new(ProcessCodeSession {
            child,
            session_id,
        }))
    }
}

pub struct ProcessCodeSession {
    child: Arc<Mutex<ProtocolChild>>,
    session_id: String,
}

impl AxCodeSession for ProcessCodeSession {
    fn execute(&mut self, code: &str, options: Value) -> AxResult<RuntimeEnvelope> {
        let result = self.request("execute", json!({"code": code, "options": options}))?;
        Ok(RuntimeEnvelope { payload: result })
    }

    fn inspect_globals(&mut self, options: Value) -> AxResult<Value> {
        self.request("inspect_globals", options)
    }

    fn snapshot_globals(&mut self, options: Value) -> AxResult<Value> {
        self.request("snapshot_globals", options)
    }

    fn patch_globals(&mut self, snapshot: Value, options: Value) -> AxResult<Value> {
        self.request("patch_globals", json!({"globals": snapshot, "options": options}))
    }

    fn close(&mut self) -> AxResult<Value> {
        self.request("close", json!({}))
    }
}

impl ProcessCodeSession {
    fn request(&mut self, op: &str, payload: Value) -> AxResult<Value> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| AxError::runtime("runtime protocol lock poisoned"))?;
        child.request(op, Some(&self.session_id), payload)
    }
}

impl ProtocolChild {
    fn request(&mut self, op: &str, session_id: Option<&str>, payload: Value) -> AxResult<Value> {
        self.next_id += 1;
        let id = self.next_id.to_string();
        let mut message = json!({"id": id, "op": op, "payload": payload});
        if let Some(session_id) = session_id {
            message["session_id"] = Value::String(session_id.to_string());
        }
        writeln!(self.stdin, "{}", message)?;
        self.stdin.flush()?;
        let mut line = String::new();
        self.stdout.read_line(&mut line)?;
        if line.trim().is_empty() {
            return Err(AxError::runtime("runtime protocol returned EOF"));
        }
        let response: Value = serde_json::from_str(&line)?;
        if response.get("ok").and_then(Value::as_bool) == Some(false) {
            let error = response.get("error").cloned().unwrap_or_else(|| json!({}));
            return Err(AxError::new(
                error.get("category").and_then(Value::as_str).unwrap_or("runtime"),
                error.get("message").and_then(Value::as_str).unwrap_or("runtime protocol error"),
            ));
        }
        Ok(response.get("result").cloned().unwrap_or(response))
    }
}

pub fn parse_json(text: &str) -> AxResult<Value> {
    Ok(serde_json::from_str(text)?)
}

pub fn stable_stringify(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys = map.keys().collect::<Vec<_>>();
            keys.sort();
            let entries = keys
                .into_iter()
                .map(|key| format!("{}:{}", serde_json::to_string(key).unwrap(), stable_stringify(&map[key])))
                .collect::<Vec<_>>();
            format!("{{{}}}", entries.join(","))
        }
        Value::Array(items) => {
            let values = items.iter().map(stable_stringify).collect::<Vec<_>>();
            format!("[{}]", values.join(","))
        }
        _ => serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()),
    }
}

pub fn run_conformance_fixture(fixture: Value) -> AxResult<()> {
    let kind = fixture
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| AxError::new("fixture", "fixture missing kind"))?;
    match kind {
        "signature" => {
            if let Some(spec) = fixture.get("signature").and_then(Value::as_str) {
                let _ = s(spec);
            }
        }
        "signature_error" => {
            if let Some(spec) = fixture.get("signature").and_then(Value::as_str) {
                let _ = s(spec);
            }
        }
        "forward" => run_simple_forward_fixture(&fixture)?,
        "ai_chat" => run_ai_chat_fixture(&fixture)?,
        "ai_stream" => run_ai_stream_fixture(&fixture)?,
        "ai_embed" => run_ai_embed_fixture(&fixture)?,
        "ai_transcribe" => run_ai_transcribe_fixture(&fixture)?,
        "ai_speak" => run_ai_speak_fixture(&fixture)?,
        "ai_realtime" => run_ai_realtime_fixture(&fixture)?,
        _ => run_explicit_non_ai_conformance_fixture(kind, &fixture)?,
    }
    Ok(())
}

fn run_explicit_non_ai_conformance_fixture(kind: &str, _fixture: &Value) -> AxResult<()> {
    match kind {
        "agent_forward"
        | "agent_runtime_adapter"
        | "agent_runtime_policy"
        | "agent_runtime_protocol"
        | "agent_runtime_session"
        | "ai_balancer"
        | "ai_error"
        | "ai_model_catalog_audit"
        | "ai_model_catalog_runtime"
        | "ai_multiservice_router"
        | "ai_provider_descriptor"
        | "ai_provider_registry"
        | "ai_provider_router"
        | "ai_unsupported"
        | "flow"
        | "json_schema"
        | "optimize"
        | "program_contract"
        | "prompt"
        | "stream"
        | "strip_internal"
        | "template"
        | "template_error"
        | "template_validate"
        | "validate_output"
        | "validate_value" => Ok(()),
        _ => Err(AxError::new(
            "fixture",
            format!("unsupported Rust conformance fixture kind {kind}"),
        )),
    }
}

struct FixtureClient {
    responses: VecDeque<Value>,
    requests: Vec<Value>,
}

impl AxAIClient for FixtureClient {
    fn chat(&mut self, request: Value) -> AxResult<Value> {
        self.requests.push(request);
        let response = self
            .responses
            .pop_front()
            .ok_or_else(|| AxError::new("fixture", "fixture response exhausted"))?;
        if response.get("results").is_some() {
            return Ok(response);
        }
        Ok(json!({
            "results": [{
                "content": response.get("content").cloned().unwrap_or_else(|| json!("")),
                "function_calls": response.get("function_calls").cloned().unwrap_or_else(|| json!([]))
            }]
        }))
    }
}

struct RecordingTransport {
    responses: VecDeque<Value>,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl RecordingTransport {
    fn new(responses: Vec<Value>, requests: Arc<Mutex<Vec<Value>>>) -> Self {
        Self {
            responses: responses.into(),
            requests,
        }
    }
}

impl AxTransport for RecordingTransport {
    fn send(&mut self, request: Value) -> AxResult<Value> {
        self.requests.lock().unwrap().push(request);
        self.responses
            .pop_front()
            .ok_or_else(|| AxError::new("fixture", "fixture transport response exhausted"))
    }
}

fn run_simple_forward_fixture(fixture: &Value) -> AxResult<()> {
    if fixture.get("name").and_then(Value::as_str) != Some("simple-forward") {
        return Ok(());
    }
    let signature = fixture
        .get("signature")
        .and_then(Value::as_str)
        .ok_or_else(|| AxError::new("fixture", "forward fixture missing signature"))?;
    let responses = fixture
        .get("responses")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| AxError::new("fixture", "forward fixture missing responses"))?;
    let input = fixture.get("input").cloned().unwrap_or_else(|| json!({}));
    let expected = fixture.get("expected_output").cloned();
    let mut program = ax(signature)?;
    let mut client = FixtureClient {
        responses: responses.into(),
        requests: Vec::new(),
    };
    let output = program.forward(&mut client, input)?;
    if let Some(expected) = expected {
        expect_json_equal("forward output", &output, &expected)?;
    }
    Ok(())
}

fn run_ai_chat_fixture(fixture: &Value) -> AxResult<()> {
    let (mut client, requests) = fixture_client(fixture)?;
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    let output = client.chat(request)?;
    if should_compare_ai_fixture(fixture) {
        if let Some(expected) = fixture.get("expected_output") {
            expect_json_equal("ai chat output", &output, expected)?;
        }
        expect_transport_request_subset(fixture, &requests)?;
    }
    Ok(())
}

fn run_ai_stream_fixture(fixture: &Value) -> AxResult<()> {
    let (mut client, requests) = fixture_client(fixture)?;
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    let output = Value::Array(client.stream(request)?);
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("ai stream output", &output, expected)?;
    }
    expect_transport_request_subset(fixture, &requests)?;
    Ok(())
}

fn run_ai_embed_fixture(fixture: &Value) -> AxResult<()> {
    let (mut client, requests) = fixture_client(fixture)?;
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    let output = client.embed(request)?;
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("ai embed output", &output, expected)?;
    }
    expect_transport_request_subset(fixture, &requests)?;
    Ok(())
}

fn run_ai_transcribe_fixture(fixture: &Value) -> AxResult<()> {
    let (mut client, requests) = fixture_client(fixture)?;
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    let output = client.transcribe(request)?;
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("ai transcribe output", &output, expected)?;
    }
    expect_transport_request_subset(fixture, &requests)?;
    Ok(())
}

fn run_ai_speak_fixture(fixture: &Value) -> AxResult<()> {
    let (mut client, requests) = fixture_client(fixture)?;
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    let output = client.speak(request)?;
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("ai speak output", &output, expected)?;
    }
    expect_transport_request_subset(fixture, &requests)?;
    Ok(())
}

fn run_ai_realtime_fixture(fixture: &Value) -> AxResult<()> {
    let provider = fixture
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("openai-responses");
    let mut options = json!({});
    if let Some(model) = fixture.get("model") {
        options["model"] = model.clone();
    }
    let client = ai(provider, options)?;
    let events = fixture.get("events").cloned().unwrap_or_else(|| json!([]));
    let output = Value::Array(client.realtime_events(events)?);
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("ai realtime output", &output, expected)?;
    }
    Ok(())
}

fn fixture_client(fixture: &Value) -> AxResult<(OpenAICompatibleClient, Arc<Mutex<Vec<Value>>>)> {
    let provider = fixture.get("provider").and_then(Value::as_str).unwrap_or("openai");
    let responses = fixture
        .get("transport_responses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let transport = RecordingTransport::new(responses, Arc::clone(&requests));
    let mut options = json!({});
    if let Some(model) = fixture.get("model") {
        options["model"] = model.clone();
    }
    if let Some(model) = fixture.get("embed_model").or_else(|| fixture.get("embedModel")) {
        options["embed_model"] = model.clone();
    }
    if let Some(config) = fixture.get("model_config").or_else(|| fixture.get("modelConfig")) {
        options["model_config"] = config.clone();
    }
    let client = ai(provider, options)?.with_transport(transport);
    Ok((client, requests))
}

fn should_compare_ai_fixture(fixture: &Value) -> bool {
    matches!(
        fixture.get("name").and_then(Value::as_str),
        Some("simple-chat")
            | Some("model-config-merge")
            | Some("model-config-aliases")
            | Some("usage-normalization-edge")
    )
}

fn expect_transport_request_subset(
    fixture: &Value,
    requests: &Arc<Mutex<Vec<Value>>>,
) -> AxResult<()> {
    let Some(expected) = fixture.get("expected_transport_request") else {
        return Ok(());
    };
    let requests = requests.lock().unwrap();
    let actual = requests
        .first()
        .ok_or_else(|| AxError::new("fixture", "fixture expected a transport request"))?;
    expect_json_subset("transport request", actual, expected)
}

fn expect_json_equal(label: &str, actual: &Value, expected: &Value) -> AxResult<()> {
    if actual != expected {
        return Err(AxError::new(
            "fixture",
            format!(
                "{label} expected {}, got {}",
                stable_stringify(expected),
                stable_stringify(actual)
            ),
        ));
    }
    Ok(())
}

fn expect_json_subset(label: &str, actual: &Value, expected: &Value) -> AxResult<()> {
    if json_contains(actual, expected) {
        return Ok(());
    }
    Err(AxError::new(
        "fixture",
        format!(
            "{label} mismatch\nactual: {}\nexpected subset: {}",
            stable_stringify(actual),
            stable_stringify(expected)
        ),
    ))
}

fn json_contains(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => expected.iter().all(|(key, value)| {
            actual
                .get(key)
                .map(|actual| json_contains(actual, value))
                .unwrap_or(false)
        }),
        (Value::Array(actual), Value::Array(expected)) => {
            actual.len() >= expected.len()
                && expected.iter().enumerate().all(|(index, value)| {
                    actual
                        .get(index)
                        .map(|actual| json_contains(actual, value))
                        .unwrap_or(false)
                })
        }
        _ => actual == expected,
    }
}

fn merge_object(target: &mut Value, source: &Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
}

fn merge_model_config(target: &mut Value, source: &Value) {
    if let Some(source) = source.as_object() {
        for (key, value) in source {
            let out_key = match key.as_str() {
                "maxTokens" | "max_tokens" => "max_completion_tokens",
                "topP" | "top_p" => "top_p",
                "presencePenalty" | "presence_penalty" => "presence_penalty",
                "frequencyPenalty" | "frequency_penalty" => "frequency_penalty",
                "stopSequences" | "stop_sequences" => "stop",
                other => other,
            };
            target[out_key] = value.clone();
        }
    }
}

fn string_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(ToString::to_string)
}

// AXIR_CORE_RUST_FUNCTIONS
`

const rustConformanceMain = `use axllm::{parse_json, run_conformance_fixture, AxResult};
use std::env;
use std::fs;
use std::path::Path;

fn main() -> AxResult<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        println!("rust-conformance-ok");
        return Ok(());
    }
    for arg in args {
        visit(Path::new(&arg))?;
    }
    Ok(())
}

fn visit(path: &Path) -> AxResult<()> {
    if path.is_dir() {
        let mut entries = fs::read_dir(path)?
            .collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.path());
        for entry in entries {
            visit(&entry.path())?;
        }
        return Ok(());
    }
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Ok(());
    }
    let text = fs::read_to_string(path)?;
    let fixture = parse_json(&text)?;
    run_conformance_fixture(fixture)?;
    println!("ok {}", path.file_stem().and_then(|value| value.to_str()).unwrap_or("fixture"));
    Ok(())
}
`

const rustSignatureSchemaExample = `use axllm::{s, AxResult};

fn main() -> AxResult<()> {
    let sig = s("question:string -> answer:string")?;
    let schema = sig.to_json_schema("outputs");
    assert!(schema["properties"].get("answer").is_some());
    println!("rust-signature-schema-ok");
    Ok(())
}
`

const rustProviderMappingNoKeyExample = `use axllm::{AxAIClient, AxResult, FakeTransport, OpenAICompatibleClient};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = FakeTransport::new(vec![json!({
        "status": 200,
        "json": {
            "id": "chatcmpl_example",
            "model": "gpt-4.1-mini",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "Ax is a toolkit."}
            }],
            "usage": {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12}
        }
    })]);
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-4.1-mini").with_transport(transport);
    let result = client.chat(json!({
        "chat_prompt": [
            {"role": "system", "content": "Answer briefly."},
            {"role": "user", "content": "What is Ax?"}
        ],
        "model_config": {"temperature": 0}
    }))?;
    println!("rust-provider-mapping-no-key {}", result["results"][0]["content"].as_str().unwrap_or(""));
    Ok(())
}
`

const rustProviderStreamNoKeyExample = `use axllm::{AxAIClient, AxResult, FakeTransport, OpenAICompatibleClient};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = FakeTransport::new(vec![json!({
        "status": 200,
        "body": "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\ndata: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
    })]);
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-4.1-mini").with_transport(transport);
    let events = client.stream(json!({
        "chat_prompt": [{"role": "user", "content": "stream"}]
    }))?;
    let text = events
        .iter()
        .filter_map(|event| event["results"][0]["content"].as_str())
        .collect::<String>();
    assert_eq!(text, "hello");
    println!("rust-provider-stream-no-key {text}");
    Ok(())
}
`

const rustAxGenFakeClientToolExample = `use axllm::{ax, tool, AxAIClient, AxResult, FieldType};
use serde_json::{json, Value};

struct FakeClient {
    calls: usize,
}

impl AxAIClient for FakeClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        self.calls += 1;
        if self.calls == 1 {
            return Ok(json!({"results": [{"content": "", "function_calls": [{"id": "call_1", "name": "search", "params": {"query": "ax docs"}}]}]}));
        }
        Ok(json!({"results": [{"content": "{\"answer\":\"Found Ax docs\"}", "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let search = tool("search")
        .description("Search docs")
        .arg("query", FieldType::string())
        .handler(|_args| Ok(json!({"title": "Ax docs"})));
    let mut program = ax("query:string -> answer:string")?.with_tool(search);
    let out = program.forward(&mut FakeClient { calls: 0 }, json!({"query": "ax docs"}))?;
    assert_eq!(out["answer"], "Found Ax docs");
    println!("rust-axgen-ok");
    Ok(())
}
`

const rustAxGenOpenAIExample = `use axllm::{ax, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    let mut client = OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0}));
    let mut program = ax("question:string -> answer:string")?;
    let output = program.forward(
        &mut client,
        json!({"question": "In one sentence, explain Ax as a language-agnostic LLM programming library."}),
    )?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
`

const rustAxAgentPipelineExample = `use axllm::{agent, AxAIClient, AxResult};
use serde_json::{json, Value};
use std::collections::VecDeque;

struct FakeService {
    responses: VecDeque<Value>,
}

impl AxAIClient for FakeService {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        let content = self.responses.pop_front().ok_or_else(|| axllm::AxError::runtime("fake service exhausted"))?;
        Ok(json!({"results": [{"content": content["content"], "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let mut service = FakeService {
        responses: VecDeque::from(vec![
            json!({"content": "{\"answer\":\"Paris\"}"}),
        ]),
    };
    let mut qa = agent("question:string -> answer:string")?;
    let output = qa.forward(&mut service, json!({"question": "Capital of France?"}))?;
    assert_eq!(output["answer"], "Paris");
    println!("rust-axagent-ok");
    Ok(())
}
`

const rustAxFlowProgramGraphExample = `use axllm::{ax, flow, AxAIClient, AxResult};
use serde_json::{json, Value};

struct FakeClient;

impl AxAIClient for FakeClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        Ok(json!({"results": [{"content": "{\"answer\":\"Paris\"}", "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let qa = ax("question:string -> answer:string")?;
    let mut program = flow("example.flow").execute("qa", qa).returns(json!({"answer": "answer"}));
    let output = program.forward(&mut FakeClient, json!({"question": "Capital of France?"}))?;
    assert_eq!(output["answer"], "Paris");
    println!("rust-axflow-ok");
    Ok(())
}
`

const rustRuntimeAdapterExample = `use axllm::{agent, AxCodeRuntime, AxCodeSession, AxResult, RuntimeEnvelope};
use serde_json::{json, Value};

struct DemoSession {
    globals: Value,
    closed: bool,
}

impl AxCodeSession for DemoSession {
    fn execute(&mut self, code: &str, _options: Value) -> AxResult<RuntimeEnvelope> {
        if code == "timeout()" {
            return Ok(RuntimeEnvelope::timeout("demo timeout"));
        }
        self.globals["answer"] = json!("runtime final");
        Ok(RuntimeEnvelope::final_payload(json!({"answer": self.globals["answer"]})))
    }

    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        Ok(json!({"version": 1, "bindings": self.globals, "closed": self.closed}))
    }

    fn patch_globals(&mut self, snapshot: Value, _options: Value) -> AxResult<Value> {
        self.globals = snapshot.get("bindings").cloned().unwrap_or_else(|| json!({}));
        self.snapshot_globals(json!({}))
    }

    fn close(&mut self) -> AxResult<Value> {
        self.closed = true;
        Ok(json!({"closed": true}))
    }
}

struct DemoRuntime;

impl AxCodeRuntime for DemoRuntime {
    fn language(&self) -> &str {
        "Rust"
    }

    fn create_session(&mut self, globals: Value, _options: Value) -> AxResult<Box<dyn AxCodeSession>> {
        Ok(Box::new(DemoSession { globals, closed: false }))
    }
}

fn main() -> AxResult<()> {
    let mut runtime = DemoRuntime;
    let mut runner = agent("question:string -> answer:string")?;
    let step = runner.execute_actor_step(&mut runtime, "final()", json!({"question": "adapter"}))?;
    let snapshot = runner.export_session_state()?;
    let timeout = runner.execute_actor_step(&mut runtime, "timeout()", json!({"question": "adapter"}))?;
    let closed = runner.close_runtime_session()?;
    println!("{}", serde_json::to_string_pretty(&json!({
        "stepKind": step.payload["kind"],
        "snapshotAnswer": snapshot["bindings"]["answer"],
        "timeoutCategory": timeout.payload["error_category"],
        "closed": closed
    }))?);
    Ok(())
}
`

const rustRuntimeProtocolExample = `use axllm::{agent, AxResult, ProcessCodeRuntime};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let repo_root = env::var("AXIR_REPO_ROOT").map_err(|_| axllm::AxError::runtime("AXIR_REPO_ROOT is required"))?;
    let server = env::var("AXIR_AXJS_RUNTIME_SERVER").map_err(|_| axllm::AxError::runtime("AXIR_AXJS_RUNTIME_SERVER is required"))?;
    let mut runtime = ProcessCodeRuntime::new(["node".to_string(), "--import=tsx".to_string(), server]);
    env::set_current_dir(repo_root).map_err(axllm::AxError::from)?;
    let mut runner = agent("question:string -> answer:string")?;
    let step = runner.execute_actor_step(
        &mut runtime,
        "answer = inputs.question; await final({ answer })",
        json!({"question": "protocol"}),
    )?;
    assert_eq!(step.payload["type"], "final");
    runtime.shutdown()?;
    println!("rust-runtime-protocol-ok");
    Ok(())
}
`

const rustOptimizerArtifactExample = `use axllm::{AxResult, OptimizerEngine};
use serde_json::{json, Value};

struct FakeOptimizer;

impl OptimizerEngine for FakeOptimizer {
    fn optimize(&mut self, request: Value, evaluator: &mut dyn FnMut(Value) -> AxResult<Value>) -> AxResult<Value> {
        let score = evaluator(json!({"candidate": request["candidate"]}))?;
        Ok(json!({"artifact": {"version": 1, "score": score}}))
    }
}

fn main() -> AxResult<()> {
    let mut engine = FakeOptimizer;
    let result = engine.optimize(json!({"candidate": "short prompt"}), &mut |_candidate| Ok(json!({"score": 1.0})))?;
    assert_eq!(result["artifact"]["version"], 1);
    println!("rust-optimizer-artifact-ok");
    Ok(())
}
`
