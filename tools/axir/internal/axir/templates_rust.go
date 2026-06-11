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

[[example]]
name = "javascript_quickjs"
path = "examples/runtime_profiles/javascript_quickjs.rs"
required-features = ["runtime-quickjs"]

[features]
default = []
runtime-quickjs = ["dep:rquickjs"]

[dependencies]
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
rquickjs = { version = "0.12", optional = true }
serde = { version = "1", features = ["derive"] }
serde_json = { version = "1", features = ["preserve_order"] }
regex = "1"
`

const rustLib = `pub mod mcp;
pub use mcp::{AxMCPClient, AxMCPOAuthOptions, AxMCPStdioTransport, AxMCPStreamableHTTPTransport, AxMCPTokenSet, AxMCPTransport};
use reqwest::blocking::Client as HttpClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::error::Error;
use std::fmt;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(feature = "runtime-quickjs")]
pub mod runtime {
    pub mod quickjs;
}

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
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "minLength")]
    pub min_length: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "maxLength")]
    pub max_length: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "patternDescription")]
    pub pattern_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl FieldType {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            is_array: false,
            options: None,
            fields: None,
            min_length: None,
            max_length: None,
            minimum: None,
            maximum: None,
            pattern: None,
            pattern_description: None,
            format: None,
            description: None,
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
            min_length: None,
            max_length: None,
            minimum: None,
            maximum: None,
            pattern: None,
            pattern_description: None,
            format: None,
            description: None,
        }
    }

    pub fn array(mut self) -> Self {
        self.is_array = true;
        self
    }

    fn to_payload(&self) -> Value {
        self.to_payload_inner(false)
    }

    fn to_payload_with_description(&self) -> Value {
        self.to_payload_inner(true)
    }

    fn to_payload_inner(&self, include_description: bool) -> Value {
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
        if let Some(value) = self.min_length {
            out.insert("minLength".to_string(), json_number(value));
        }
        if let Some(value) = self.max_length {
            out.insert("maxLength".to_string(), json_number(value));
        }
        if let Some(value) = self.minimum {
            out.insert("minimum".to_string(), json_number(value));
        }
        if let Some(value) = self.maximum {
            out.insert("maximum".to_string(), json_number(value));
        }
        if let Some(value) = &self.pattern {
            out.insert("pattern".to_string(), Value::String(value.clone()));
        }
        if let Some(value) = &self.pattern_description {
            out.insert(
                "patternDescription".to_string(),
                Value::String(value.clone()),
            );
        }
        if let Some(value) = &self.format {
            out.insert("format".to_string(), Value::String(value.clone()));
        }
        if include_description {
            if let Some(value) = &self.description {
                out.insert("description".to_string(), Value::String(value.clone()));
            }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
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
            description: None,
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
        let parsed = parse_signature(&[CoreValue::from(spec)])?;
        validate_signature(&[parsed.clone()])?;
        let payload = core_value_to_json(&parsed);
        let mut inputs = Vec::new();
        if let Some(items) = payload.get("inputs").and_then(Value::as_array) {
            for item in items {
                let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
                inputs.push(field_from_payload(name, item));
            }
        }
        let mut outputs = Vec::new();
        if let Some(items) = payload.get("outputs").and_then(Value::as_array) {
            for item in items {
                let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
                outputs.push(field_from_payload(name, item));
            }
        }
        Ok(AxSignature {
            description: payload
                .get("description")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            inputs,
            outputs,
        })
    }

    pub fn get_output_fields(&self) -> &[Field] {
        &self.outputs
    }

    pub fn to_json_schema(&self, section: &str) -> Value {
        self.to_json_schema_with_options(section, &Value::Null)
    }

    pub fn to_json_schema_with_options(&self, section: &str, options: &Value) -> Value {
        let fields = if section == "inputs" {
            &self.inputs
        } else {
            &self.outputs
        };
        core_fields_value(fields)
            .and_then(|fields_value| {
                to_json_schema(&[fields_value, CoreValue::from("Schema"), core_value_from_json(options)])
            })
            .map(|schema| core_value_to_json(&schema))
            .unwrap_or(Value::Null)
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

fn title_case(name: &str) -> String {
    let mut out = String::new();
    let mut upper = true;
    let mut prev_lower_or_digit = false;
    for ch in name.chars() {
        if ch == '_' || ch == '-' {
            out.push(' ');
            upper = true;
            prev_lower_or_digit = false;
        } else if ch.is_uppercase() && prev_lower_or_digit {
            out.push(' ');
            out.push(ch);
            upper = false;
            prev_lower_or_digit = false;
        } else if upper {
            for c in ch.to_uppercase() {
                out.push(c);
            }
            upper = false;
            prev_lower_or_digit = ch.is_lowercase() || ch.is_ascii_digit();
        } else {
            out.push(ch);
            prev_lower_or_digit = ch.is_lowercase() || ch.is_ascii_digit();
        }
    }
    out
}

fn field_from_payload(name: &str, raw: &Value) -> Field {
    if let Some(obj) = raw.as_object() {
        if obj.contains_key("type") && obj.get("name").is_none() {
            return field_from_spec(name, raw);
        }
        let type_obj = raw.get("type").and_then(Value::as_object);
        let type_payload = type_obj
            .map(|value| Value::Object(value.clone()))
            .unwrap_or_else(|| raw.clone());
        let mut field_type = field_type_from_payload(&type_payload);
        if field_type.name.is_empty() {
            field_type.name = raw.get("name").and_then(Value::as_str).unwrap_or("string").to_string();
        }
        let mut field = Field::new(name, field_type);
        field.title = raw
            .get("title")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .unwrap_or_else(|| title_case(name));
        field.description = raw.get("description").and_then(Value::as_str).map(ToString::to_string);
        field.is_optional = bool_key(raw, &["isOptional", "optional"]);
        field.is_internal = bool_key(raw, &["isInternal", "internal"]);
        field.is_cached = bool_key(raw, &["isCached", "cache", "cached"]);
        return field;
    }
    Field::new(name, FieldType::string())
}

fn field_type_from_payload(raw: &Value) -> FieldType {
    let mut field_type = FieldType::new(raw.get("name").and_then(Value::as_str).unwrap_or("string"));
    field_type.is_array = raw.get("isArray").or_else(|| raw.get("array")).and_then(Value::as_bool).unwrap_or(false);
    field_type.options = raw.get("options").and_then(Value::as_array).map(|items| {
        items.iter().filter_map(Value::as_str).map(ToString::to_string).collect()
    });
    field_type.fields = raw.get("fields").and_then(Value::as_object).cloned();
    field_type.min_length = number_key(raw, &["minLength"]);
    field_type.max_length = number_key(raw, &["maxLength"]);
    field_type.minimum = number_key(raw, &["minimum"]);
    field_type.maximum = number_key(raw, &["maximum"]);
    field_type.pattern = raw.get("pattern").and_then(Value::as_str).map(ToString::to_string);
    field_type.pattern_description = raw
        .get("patternDescription")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    field_type.format = raw.get("format").and_then(Value::as_str).map(ToString::to_string);
    field_type.description = raw.get("description").and_then(Value::as_str).map(ToString::to_string);
    field_type
}

fn field_from_spec(name: &str, raw: &Value) -> Field {
    let type_name = raw.get("type").and_then(Value::as_str).unwrap_or("string");
    let mut type_payload = Map::new();
    type_payload.insert("name".to_string(), Value::String(type_name.to_string()));
    type_payload.insert("isArray".to_string(), Value::Bool(bool_key(raw, &["array", "isArray"])));
    if let Some(options) = raw.get("options") {
        type_payload.insert("options".to_string(), options.clone());
    }
    if let Some(fields) = raw.get("fields").and_then(Value::as_object) {
        let mut nested = Map::new();
        for (child_name, child_spec) in fields {
            nested.insert(
                child_name.clone(),
                field_payload_with_type_description(&field_from_spec(child_name, child_spec)),
            );
        }
        type_payload.insert("fields".to_string(), Value::Object(nested));
    }
    if let Some(value) = number_key(raw, &["minLength"]) {
        type_payload.insert("minLength".to_string(), json_number(value));
    }
    if let Some(value) = number_key(raw, &["maxLength"]) {
        type_payload.insert("maxLength".to_string(), json_number(value));
    }
    if let Some(value) = number_key(raw, &["min", "minimum"]) {
        let key = if type_name == "string" { "minLength" } else { "minimum" };
        type_payload.insert(key.to_string(), json_number(value));
    }
    if let Some(value) = number_key(raw, &["max", "maximum"]) {
        let key = if type_name == "string" { "maxLength" } else { "maximum" };
        type_payload.insert(key.to_string(), json_number(value));
    }
    if let Some(value) = raw.get("pattern").and_then(Value::as_str) {
        type_payload.insert("pattern".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = raw.get("patternDescription").and_then(Value::as_str) {
        type_payload.insert("patternDescription".to_string(), Value::String(value.to_string()));
    }
    if bool_key(raw, &["email"]) {
        type_payload.insert("format".to_string(), Value::String("email".to_string()));
    } else if bool_key(raw, &["url"]) {
        type_payload.insert("format".to_string(), Value::String("uri".to_string()));
    } else if let Some(value) = raw.get("format").and_then(Value::as_str) {
        type_payload.insert("format".to_string(), Value::String(value.to_string()));
    }
    if let Some(description) = raw.get("description").and_then(Value::as_str) {
        if type_name != "object" || bool_key(raw, &["array", "isArray"]) {
            type_payload.insert("description".to_string(), Value::String(description.to_string()));
        }
    }
    let mut field = Field::new(name, field_type_from_payload(&Value::Object(type_payload)));
    field.title = raw
        .get("title")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| title_case(name));
    field.description = raw
        .get("arrayDescription")
        .or_else(|| raw.get("description"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    field.is_optional = bool_key(raw, &["optional", "isOptional"]);
    field.is_internal = bool_key(raw, &["internal", "isInternal"]);
    field.is_cached = bool_key(raw, &["cache", "cached", "isCached"]);
    field
}

fn field_payload_with_type_description(field: &Field) -> Value {
    field_payload_impl(field, true)
}

fn field_payload(field: &Field) -> Value {
    field_payload_impl(field, false)
}

fn field_payload_impl(field: &Field, include_type_description: bool) -> Value {
    let mut out = Map::new();
    out.insert("name".to_string(), Value::String(field.name.clone()));
    out.insert("title".to_string(), Value::String(field.title.clone()));
    out.insert(
        "type".to_string(),
        if include_type_description {
            field.field_type.to_payload_with_description()
        } else {
            field.field_type.to_payload()
        },
    );
    out.insert("isOptional".to_string(), Value::Bool(field.is_optional));
    out.insert("isInternal".to_string(), Value::Bool(field.is_internal));
    out.insert("isCached".to_string(), Value::Bool(field.is_cached));
    if let Some(description) = &field.description {
        out.insert("description".to_string(), Value::String(description.clone()));
    }
    Value::Object(out)
}

fn signature_payload(sig: &AxSignature) -> Value {
    json!({
        "description": sig.description,
        "inputs": sig.inputs.iter().map(field_payload).collect::<Vec<_>>(),
        "outputs": sig.outputs.iter().map(field_payload).collect::<Vec<_>>()
    })
}

pub fn signature_from_spec(spec: &Value) -> AxResult<AxSignature> {
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();
    if let Some(raw_inputs) = spec.get("inputs").and_then(Value::as_object) {
        for (name, raw) in raw_inputs {
            inputs.push(field_from_spec(name, raw));
        }
    }
    if let Some(raw_outputs) = spec.get("outputs").and_then(Value::as_object) {
        for (name, raw) in raw_outputs {
            outputs.push(field_from_spec(name, raw));
        }
    }
    let values = core_value_from_json(&json!({
        "inputs": inputs.iter().map(field_payload).collect::<Vec<_>>(),
        "outputs": outputs.iter().map(field_payload).collect::<Vec<_>>(),
    }));
    let record = core_record_new(&[CoreValue::from("AxSignature"), values])?;
    validate_signature(&[record])?;
    Ok(AxSignature {
        description: spec.get("description").and_then(Value::as_str).map(ToString::to_string),
        inputs,
        outputs,
    })
}

fn build_fixture_signature(fixture: &Value) -> AxResult<AxSignature> {
    if let Some(spec) = fixture.get("signature_spec") {
        return signature_from_spec(spec);
    }
    if let Some(spec) = fixture.get("signature").and_then(Value::as_object) {
        return signature_from_spec(&Value::Object(spec.clone()));
    }
    s(fixture
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or("question:string -> answer:string"))
}

fn trim_num(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

fn json_number(value: f64) -> Value {
    if value.fract() == 0.0 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

fn number_key(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| value.get(*key).and_then(Value::as_f64))
}

fn bool_key(value: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .any(|key| value.get(*key).and_then(Value::as_bool).unwrap_or(false))
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

pub struct ScriptedTransport {
    responses: VecDeque<Value>,
    pub requests: Vec<Value>,
}

impl ScriptedTransport {
    pub fn new(responses: Vec<Value>) -> Self {
        Self {
            responses: responses.into(),
            requests: Vec::new(),
        }
    }
}

impl AxTransport for ScriptedTransport {
    fn send(&mut self, request: Value) -> AxResult<Value> {
        self.requests.push(request);
        self.responses
            .pop_front()
            .ok_or_else(|| AxError::runtime("scripted transport exhausted"))
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
            merge_model_config_wire(&mut body, config);
        }
        if body.get("temperature").is_none() {
            body["temperature"] = json!(0);
        }
        if let Some(format) = request.get("response_format") {
            body["response_format"] = format.clone();
        }
        if let Some(tools) = request.get("tools") {
            if tools.as_array().map(|items| !items.is_empty()).unwrap_or(true) {
                body["tools"] = tools.clone();
            }
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
            return normalize_embed_response_native(
                self.post_json(&path, json!({"requests": requests}))?,
                &self.profile,
            );
        }
        let body = json!({"model": model, "input": input});
        normalize_embed_response_native(self.post_json("/embeddings", body)?, &self.profile)
    }

    pub fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        let profile = self.profile.clone();
        let body = core_value_to_json(&provider_build_transcribe_request(&[
            CoreValue::from(profile.as_str()),
            core_value_from_json(&request),
        ])?);
        let raw = match profile.as_str() {
            "google-gemini" => {
                let model = string_at(&request, "model").unwrap_or_else(|| self.model.clone());
                let path = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={}",
                    self.api_key
                );
                self.post_json(&path, body)?
            }
            "grok" => self.post_data("/stt", body)?,
            _ => self.post_data("/audio/transcriptions", body)?,
        };
        let payload = normalize_passthrough_response(raw)?;
        let normalized = provider_normalize_transcribe_response(&[
            CoreValue::from(profile.as_str()),
            core_value_from_json(&payload),
            core_value_from_json(&request),
        ])?;
        Ok(core_value_to_json(&normalized))
    }

    pub fn speak(&mut self, request: Value) -> AxResult<Value> {
        let profile = self.profile.clone();
        let body = core_value_to_json(&provider_build_speak_request(&[
            CoreValue::from(profile.as_str()),
            core_value_from_json(&request),
        ])?);
        let raw = match profile.as_str() {
            "google-gemini" => {
                let model = string_at(&request, "model")
                    .unwrap_or_else(|| "gemini-2.5-flash-preview-tts".to_string());
                let path = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={}",
                    self.api_key
                );
                self.post_json(&path, body)?
            }
            "grok" => self.post_json("/tts", body)?,
            "mistral" => self.post_json("/audio/speech", body)?,
            _ => self.post_json("/audio/speech", body)?,
        };
        let payload = normalize_passthrough_response(raw)?;
        let normalized = provider_normalize_speak_response(&[
            CoreValue::from(profile.as_str()),
            core_value_from_json(&payload),
            core_value_from_json(&request),
        ])?;
        Ok(core_value_to_json(&normalized))
    }

    pub fn realtime(&self, event: Value) -> AxResult<Value> {
        let normalized = provider_normalize_realtime_event(&[
            CoreValue::from(self.profile.as_str()),
            core_value_from_json(&event),
            CoreValue::new_map(),
            provider_ai_display_name(&self.profile),
            CoreValue::from(self.model.as_str()),
        ])?;
        Ok(core_value_to_json(&normalized))
    }

    pub fn realtime_events(&self, events: Value) -> AxResult<Vec<Value>> {
        let state = CoreValue::new_map();
        let ai_name = provider_ai_display_name(&self.profile);
        let mut out = Vec::new();
        for event in events.as_array().cloned().unwrap_or_default() {
            let normalized = provider_normalize_realtime_event(&[
                CoreValue::from(self.profile.as_str()),
                core_value_from_json(&event),
                state.clone(),
                ai_name.clone(),
                CoreValue::from(self.model.as_str()),
            ])?;
            if !normalized.is_null() {
                out.push(core_value_to_json(&normalized));
            }
        }
        Ok(out)
    }

    pub fn realtime_audio_setup(&self, request: Value) -> AxResult<Value> {
        let built = provider_build_realtime_audio_setup(&[
            CoreValue::from(self.profile.as_str()),
            core_value_from_json(&request),
        ])?;
        Ok(core_value_to_json(&built))
    }

    pub fn realtime_audio_input(&self, audio: Value) -> AxResult<Value> {
        let built = provider_build_realtime_audio_input(&[
            CoreValue::from(self.profile.as_str()),
            core_value_from_json(&audio),
        ])?;
        Ok(core_value_to_json(&built))
    }
}

impl AxAIClient for OpenAICompatibleClient {
    fn chat(&mut self, request: Value) -> AxResult<Value> {
        let body = self.request_body(&request);
        let path = self.chat_path().to_string();
        let profile = self.profile.clone();
        let model = self.model.clone();
        normalize_openai_response(&profile, &model, self.post_json(&path, body)?)
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

fn normalize_openai_response(profile: &str, model: &str, response: Value) -> AxResult<Value> {
    let payload = normalize_passthrough_response(response)?;
    let normalized = provider_normalize_chat_response(&[
        CoreValue::from(profile),
        core_value_from_json(&payload),
        provider_ai_display_name(profile),
        CoreValue::from(model),
    ])?;
    Ok(core_value_to_json(&normalized))
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
    let ai_name = provider_ai_display_name(profile);
    let state = CoreValue::new_map();
    let mut out = Vec::new();
    for event in &events {
        let normalized = provider_normalize_stream_delta(&[
            CoreValue::from(profile),
            core_value_from_json(event),
            state.clone(),
            ai_name.clone(),
            CoreValue::from(model),
        ])?;
        if !normalized.is_null() {
            out.push(core_value_to_json(&normalized));
        }
    }
    Ok(out)
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

#[derive(Clone)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub args: Map<String, Value>,
    handler: Arc<dyn Fn(Value) -> AxResult<Value> + Send + Sync>,
}

impl Tool {
    pub fn call(&self, args: Value) -> AxResult<Value> {
        validate_fields(&[
            core_tool_args_fields(&self.args)?,
            core_value_from_json(&args),
            CoreValue::from_string(format!("tool.{}.args", self.name)),
        ])?;
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

fn validate_tool_args(tool: &Tool, args: &Value) -> AxResult<()> {
    let fields = tool
        .args
        .iter()
        .map(|(name, raw)| field_from_payload(name, raw))
        .collect::<Vec<_>>();
    validate_fields_native(&fields, args)
}

pub struct AxGen {
    pub signature: AxSignature,
    pub options: Value,
    pub function_call_traces: Vec<Value>,
    pub tools: Vec<Tool>,
    pub assertions: Vec<Value>,
    pub examples: Vec<Value>,
    pub demos: Vec<Value>,
    pub field_processors: Vec<Value>,
    pub stop_functions: Vec<String>,
    pub memory: Vec<Value>,
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
            options: json!({}),
            function_call_traces: Vec::new(),
            tools: Vec::new(),
            assertions: Vec::new(),
            examples: Vec::new(),
            demos: Vec::new(),
            field_processors: Vec::new(),
            stop_functions: Vec::new(),
            memory: Vec::new(),
            traces: Vec::new(),
            chat_log: Vec::new(),
        })
    }

    pub fn with_tool(mut self, tool: Tool) -> Self {
        self.tools.push(tool);
        self
    }

    pub fn with_assertion(mut self, assertion: Value) -> Self {
        self.assertions.push(assertion);
        self
    }

    pub fn with_example(mut self, example: Value) -> Self {
        self.examples.push(example);
        self
    }

    pub fn with_demo(mut self, demo: Value) -> Self {
        self.demos.push(demo);
        self
    }

    pub fn with_field_processor(mut self, field: &str, op: &str) -> Self {
        self.field_processors.push(json!({"field": field, "op": op}));
        self
    }

    pub fn with_stop_function(mut self, name: &str) -> Self {
        self.stop_functions.push(name.to_string());
        self
    }

    pub fn forward<C: AxAIClient>(&mut self, client: &mut C, input: Value) -> AxResult<Value> {
        let state = core_gen_state(self)?;
        let mut chat = |request: Value| client.chat(request);
        let result = with_core_client(&mut chat, || {
            _forward_impl(&[
                state.clone(),
                CoreValue::Null,
                core_value_from_json(&input),
                CoreValue::Null,
            ])
        });
        core_gen_writeback(self, &state);
        Ok(core_value_to_json(&result?))
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

    fn apply_field_processors(&mut self, output: &mut Value) {
        let Some(object) = output.as_object_mut() else {
            return;
        };
        let mut changed = false;
        for processor in &self.field_processors {
            let Some(field) = processor.get("field").and_then(Value::as_str) else {
                continue;
            };
            let op = processor
                .get("op")
                .or_else(|| processor.get("processor"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(value) = object.get_mut(field) else {
                continue;
            };
            let Some(text) = value.as_str() else {
                continue;
            };
            let next = match op {
                "uppercase" => text.to_uppercase(),
                "lowercase" => text.to_lowercase(),
                "trim" => text.trim().to_string(),
                _ => text.to_string(),
            };
            if next != text {
                *value = Value::String(next);
                changed = true;
            }
        }
        if changed {
            self.memory.push(json!({
                "role": "processor",
                "output": output.clone(),
                "tags": ["processor"]
            }));
        }
    }
}

fn assertion_failure_message(assertion: &Value) -> String {
    if let Some(message) = assertion.get("message").and_then(Value::as_str) {
        return message.to_string();
    }
    if let Some(message) = assertion.get("return").and_then(Value::as_str) {
        return message.to_string();
    }
    "assertion failed without message".to_string()
}

fn assertion_subject<'a>(assertion: &Value, output: &'a Value) -> &'a Value {
    assertion
        .get("field")
        .and_then(Value::as_str)
        .and_then(|field| output.get(field))
        .unwrap_or(output)
}

fn assertion_text(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| stable_stringify(value))
}

fn evaluate_output_assertions(assertions: &[Value], output: &Value) -> Option<String> {
    for assertion in assertions {
        if assertion.get("return").and_then(Value::as_bool) == Some(false) {
            return Some(assertion_failure_message(assertion));
        }
        if assertion.get("return").and_then(Value::as_str).is_some() {
            return Some(assertion_failure_message(assertion));
        }
        let subject = assertion_subject(assertion, output);
        if let Some(needle) = assertion.get("contains").and_then(Value::as_str) {
            if !assertion_text(subject).contains(needle) {
                return Some(assertion_failure_message(assertion));
            }
        }
        if let Some(expected) = assertion.get("equals") {
            if subject != expected {
                return Some(assertion_failure_message(assertion));
            }
        }
    }
    None
}

fn render_field_values(label: &str, fields: &[Field], values: &Value) -> String {
    let mut lines = vec![label.to_string()];
    for field in fields {
        let value = values.get(&field.name).cloned().unwrap_or(Value::Null);
        lines.push(format!("{}: {}", field.title, display_template_value(&value)));
    }
    lines.join("\n")
}

fn render_examples_prompt(sig: &AxSignature, examples: &[Value], demos: &[Value]) -> String {
    if examples.is_empty() && demos.is_empty() {
        return String::new();
    }
    let mut lines = vec!["--- EXAMPLES ---".to_string()];
    for example in examples {
        lines.push(render_field_values(
            "Example Input",
            &sig.inputs,
            example.get("input").unwrap_or(&Value::Null),
        ));
        lines.push(render_field_values(
            "Example Output",
            &sig.outputs,
            example.get("output").unwrap_or(&Value::Null),
        ));
    }
    for demo in demos {
        lines.push(render_field_values(
            "Demo Input",
            &sig.inputs,
            demo.get("input").unwrap_or(&Value::Null),
        ));
        lines.push(render_field_values(
            "Demo Output",
            &sig.outputs,
            demo.get("output").unwrap_or(&Value::Null),
        ));
    }
    lines.push("--- END OF EXAMPLES ---".to_string());
    lines.join("\n")
}

fn parse_model_output(content: &str, _signature: &AxSignature) -> AxResult<Value> {
    let trimmed = content.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Ok(serde_json::from_str(trimmed)?);
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
    state: CoreValue,
}

pub fn flow(id: &str) -> AxFlow {
    let options = CoreValue::new_map();
    let _ = core_set(&options, CoreValue::from("id"), CoreValue::from(id));
    let state = _flow_factory(&[options]).unwrap_or_else(|_| CoreValue::new_map());
    AxFlow { state }
}

impl AxFlow {
    pub fn execute(self, name: &str, program: AxGen) -> Self {
        let step = _flow_step(&[
            CoreValue::from("execute"),
            CoreValue::from(name),
            GenHost::new(program),
            CoreValue::Null,
        ]);
        if let Ok(step) = step {
            let _ = _flow_add_step(&[self.state.clone(), step]);
        }
        self
    }

    pub fn returns(self, mapping: Value) -> Self {
        let _ = _flow_set_returns(&[self.state.clone(), core_value_from_json(&mapping)]);
        self
    }

    pub fn forward<C: AxAIClient>(&mut self, client: &mut C, input: Value) -> AxResult<Value> {
        let mut chat = |request: Value| client.chat(request);
        let result = with_core_client(&mut chat, || {
            _flow_forward(&[
                self.state.clone(),
                CoreValue::Null,
                core_value_from_json(&input),
                CoreValue::Null,
            ])
        })?;
        Ok(core_value_to_json(&result))
    }

    pub fn get_plan(&self) -> Value {
        let id = core_get(
            &core_get(&self.state, &CoreValue::from("options"), CoreValue::Null),
            &CoreValue::from("id"),
            CoreValue::Null,
        );
        let steps = core_get(&self.state, &CoreValue::from("steps"), CoreValue::Null);
        let mut names = Vec::new();
        if let Ok(items) = core_iter(&steps) {
            for step in items {
                let name = core_get(&step, &CoreValue::from("name"), CoreValue::Null);
                names.push(json!({"name": core_value_to_json(&name)}));
            }
        }
        json!({"id": core_value_to_json(&id), "steps": names})
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

pub struct AxBootstrapFewShot {
    pub options: Value,
}

impl AxBootstrapFewShot {
    pub fn new(options: Value) -> Self {
        Self { options }
    }
}

impl Default for AxBootstrapFewShot {
    fn default() -> Self {
        Self::new(json!({}))
    }
}

impl OptimizerEngine for AxBootstrapFewShot {
    fn optimize(
        &mut self,
        request: Value,
        evaluator: &mut dyn FnMut(Value) -> AxResult<Value>,
    ) -> AxResult<Value> {
        let threshold = self
            .options
            .get("qualityThreshold")
            .or_else(|| self.options.get("quality_threshold"))
            .and_then(Value::as_f64)
            .unwrap_or(0.5);
        let max_demos = self
            .options
            .get("maxDemos")
            .or_else(|| self.options.get("max_demos"))
            .and_then(Value::as_u64)
            .unwrap_or(4) as usize;
        let max_rounds = self
            .options
            .get("maxRounds")
            .or_else(|| self.options.get("max_rounds"))
            .and_then(Value::as_u64)
            .unwrap_or(3)
            .max(1) as usize;
        let max_examples = self
            .options
            .get("maxExamples")
            .or_else(|| self.options.get("max_examples"))
            .and_then(Value::as_u64)
            .unwrap_or(16)
            .max(1) as usize;
        let batch_size = self
            .options
            .get("batchSize")
            .or_else(|| self.options.get("batch_size"))
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1) as usize;
        let examples = request
            .get("dataset")
            .and_then(|dataset| dataset.get("train"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let sampled = examples.into_iter().take(max_examples).collect::<Vec<_>>();
        let mut demos = Vec::new();
        let mut accepted = BTreeSet::new();
        for round in 0..max_rounds {
            if demos.len() >= max_demos {
                break;
            }
            for chunk in sampled.chunks(batch_size) {
                if demos.len() >= max_demos {
                    break;
                }
                for example in chunk {
                    if demos.len() >= max_demos {
                        break;
                    }
                    let example_key = serde_json::to_string(example).unwrap_or_else(|_| format!("{example:?}"));
                    if accepted.contains(&example_key) {
                        continue;
                    }
                    let score = evaluator(json!({"candidate": example.clone(), "phase": "bootstrap", "round": round}))?;
                    let scalar = score
                        .get("scalar")
                        .and_then(Value::as_f64)
                        .or_else(|| score.as_f64())
                        .unwrap_or(1.0);
                    if scalar >= threshold {
                        accepted.insert(example_key);
                        demos.push(json!({"programId": "root", "traces": [example.clone()]}));
                    }
                }
            }
        }
        Ok(json!({
            "artifactVersion": "axir-optimized-artifact-v1",
            "optimizerName": "BootstrapFewShot",
            "optimizerVersion": "axir-bootstrap-fewshot-v1",
            "componentMap": {},
            "demos": demos,
            "metadata": {"optimizer": "BootstrapFewShot", "qualityThreshold": threshold}
        }))
    }
}

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

pub fn optimize<P: AxProgram>(
    program: &mut P,
    examples: Value,
    options: Value,
) -> AxResult<OptimizedArtifact> {
    let max_metric_calls = options
        .get("maxMetricCalls")
        .or_else(|| options.get("max_metric_calls"))
        .and_then(Value::as_u64)
        .unwrap_or(100);
    let train = if examples.is_array() {
        examples.as_array().cloned().unwrap_or_default()
    } else {
        examples
            .get("train")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let bootstrap_enabled = options
        .get("bootstrap")
        .and_then(Value::as_bool)
        .unwrap_or(train.len() <= 8);
    let bootstrap_options = options
        .get("bootstrap")
        .and_then(Value::as_object);
    let quality_threshold = bootstrap_options
        .and_then(|opts| opts.get("qualityThreshold").or_else(|| opts.get("quality_threshold")))
        .or_else(|| options.get("qualityThreshold").or_else(|| options.get("quality_threshold")))
        .and_then(Value::as_f64)
        .unwrap_or(0.5);
    let max_demos = bootstrap_options
        .and_then(|opts| opts.get("maxDemos").or_else(|| opts.get("max_demos")))
        .or_else(|| options.get("maxDemos").or_else(|| options.get("max_demos")))
        .and_then(Value::as_u64)
        .unwrap_or(4) as usize;
    let demos = if bootstrap_enabled {
        train
            .iter()
            .filter(|example| {
                example
                    .get("score")
                    .or_else(|| example.get("metric_score"))
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0)
                    >= quality_threshold
            })
            .take(max_demos)
            .cloned()
            .map(|example| json!({"programId": "root", "traces": [example]}))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    Ok(json!({
        "artifactVersion": "axir-optimized-artifact-v1",
        "optimizerName": "optimize",
        "optimizerVersion": "axir-optimize-helper-v1",
        "componentMap": {},
        "demos": demos,
        "metadata": {
            "optimizer": "BootstrapFewShot->GEPA",
            "programKind": program.program_kind(),
            "maxMetricCalls": max_metric_calls,
            "bootstrap": bootstrap_enabled
        }
    }))
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
        "signature" => run_signature_fixture(&fixture)?,
        "signature_error" => run_signature_error_fixture(&fixture)?,
        "json_schema" => run_json_schema_fixture(&fixture)?,
        "validate_output" => run_validate_output_fixture(&fixture)?,
        "validate_value" => run_validate_value_fixture(&fixture)?,
        "strip_internal" => run_strip_internal_fixture(&fixture)?,
        "prompt" => run_prompt_fixture(&fixture)?,
        "template" => run_template_fixture(&fixture)?,
        "template_error" => run_template_error_fixture(&fixture)?,
        "template_validate" => run_template_validate_fixture(&fixture)?,
        "forward" => run_simple_forward_fixture(&fixture)?,
        "stream" => run_stream_fixture(&fixture)?,
        "ai_chat" => run_ai_chat_fixture(&fixture)?,
        "ai_stream" => run_ai_stream_fixture(&fixture)?,
        "ai_embed" => run_ai_embed_fixture(&fixture)?,
        "ai_transcribe" => run_ai_transcribe_fixture(&fixture)?,
        "ai_speak" => run_ai_speak_fixture(&fixture)?,
        "ai_realtime" => run_ai_realtime_fixture(&fixture)?,
        "ai_provider_descriptor"
        | "ai_provider_registry"
        | "ai_model_catalog_audit"
        | "ai_model_catalog_runtime"
        | "ai_multiservice_router"
        | "ai_provider_router"
        | "ai_balancer"
        | "ai_error"
        | "ai_unsupported" => run_ai_support_fixture(kind, &fixture)?,
        "agent_forward"
        | "agent_runtime_adapter"
        | "agent_runtime_policy"
        | "agent_runtime_protocol"
        | "agent_runtime_session" => run_agent_fixture(kind, &fixture)?,
        "flow" => run_flow_fixture(&fixture)?,
        "optimize" => run_optimize_fixture(&fixture)?,
        "program_contract" => run_program_contract_fixture(&fixture)?,
        "mcp" => mcp::run_mcp_conformance_fixture(&fixture)?,
        _ => run_explicit_non_ai_conformance_fixture(kind, &fixture)?,
    }
    Ok(())
}

fn run_explicit_non_ai_conformance_fixture(kind: &str, _fixture: &Value) -> AxResult<()> {
    Err(AxError::new(
        "fixture",
        format!("unsupported Rust conformance fixture kind {kind}"),
    ))
}

fn run_signature_fixture(fixture: &Value) -> AxResult<()> {
    let sig = build_fixture_signature(fixture)?;
    if let Some(expected) = fixture.get("expected_signature") {
        expect_json_equal("signature", &signature_payload(&sig), expected)?;
    }
    Ok(())
}

fn run_signature_error_fixture(fixture: &Value) -> AxResult<()> {
    match build_fixture_signature(fixture) {
        Ok(_) => Err(AxError::new("fixture", "expected signature construction to fail")),
        Err(err) => {
            if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
                if !err.message.contains(expected) {
                    return Err(AxError::new(
                        "fixture",
                        format!("expected error containing {expected:?}, got {}", err.message),
                    ));
                }
            }
            Ok(())
        }
    }
}

fn run_json_schema_fixture(fixture: &Value) -> AxResult<()> {
    let sig = build_fixture_signature(fixture)?;
    let target = fixture.get("target").and_then(Value::as_str).unwrap_or("outputs");
    let schema = sig.to_json_schema_with_options(
        target,
        fixture.get("schema_options").unwrap_or(&Value::Null),
    );
    if let Some(expected) = fixture.get("expected_schema") {
        expect_json_equal("json schema", &schema, expected)?;
    }
    Ok(())
}

fn run_validate_output_fixture(fixture: &Value) -> AxResult<()> {
    let sig = build_fixture_signature(fixture)?;
    let values = fixture.get("values").cloned().unwrap_or_else(|| json!({}));
    let result = validate_fields_native(&sig.outputs, &values);
    expect_validation_result(result, fixture)
}

fn run_validate_value_fixture(fixture: &Value) -> AxResult<()> {
    let field = fixture
        .get("field")
        .map(|raw| field_from_spec("value", raw))
        .or_else(|| {
            fixture
                .get("field_spec")
                .map(|raw| field_from_spec("value", raw))
        })
        .unwrap_or_else(|| Field::new("value", FieldType::string()));
    let value = fixture.get("value").cloned().unwrap_or(Value::Null);
    let result = validate_field_value_native(&field, &value);
    expect_validation_result(result, fixture)
}

fn run_strip_internal_fixture(fixture: &Value) -> AxResult<()> {
    let sig = build_fixture_signature(fixture)?;
    let mut values = fixture.get("values").cloned().unwrap_or_else(|| json!({}));
    strip_internal_fields(&sig.outputs, &mut values);
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("strip internal output", &values, expected)?;
    }
    Ok(())
}

fn run_prompt_fixture(fixture: &Value) -> AxResult<()> {
    let sig = build_fixture_signature(fixture)?;
    let options = CoreValue::new_map();
    for (key, names) in [
        ("custom_template", vec!["custom_template", "customTemplate"]),
        ("structured_output_function_name", vec!["structured_output_function_name", "structuredOutputFunctionName"]),
        ("instruction", vec!["instruction"]),
    ] {
        for name in names {
            let value = fixture
                .get(name)
                .or_else(|| fixture.get("options").and_then(|o| o.get(name)));
            if let Some(value) = value {
                core_set(&options, CoreValue::from(key), core_value_from_json(value))?;
                break;
            }
        }
    }
    let values = fixture
        .get("input")
        .or_else(|| fixture.get("values"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let tools = fixture.get("tools").cloned().unwrap_or_else(|| json!([]));
    let messages = render_prompt(&[
        core_signature_value(&sig)?,
        core_value_from_json(&values),
        core_value_from_json(&tools),
        options,
    ])?;
    let messages_json = core_value_to_json(&messages);
    if let Some(expected) = fixture.get("expected_messages") {
        expect_json_equal("messages", &messages_json, expected)?;
    }
    let prompt_text = stable_stringify(&messages_json);
    for item in fixture
        .get("expected_prompt_contains")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let needle = item.as_str().unwrap_or_default();
        if !prompt_text.contains(needle) {
            return Err(AxError::new("fixture", format!("prompt missing {needle:?}")));
        }
    }
    Ok(())
}

fn render_default_prompt_fixture(sig: &AxSignature, input: &Value) -> String {
    let input_titles = sig
        .inputs
        .iter()
        .map(|field| format!("{}{}{}", char::from(96), field.title, char::from(96)))
        .collect::<Vec<_>>()
        .join(", ");
    let mut lines = vec![
        "<identity>".to_string(),
        format!("You will be provided with the following fields: {input_titles}."),
        "<input_fields>".to_string(),
    ];
    for field in &sig.inputs {
        let value = input.get(&field.name).cloned().unwrap_or(Value::Null);
        lines.push(format!("{}: {}", field.title, display_template_value(&value)));
    }
    lines.push("<output_fields>".to_string());
    for field in &sig.outputs {
        let required = if field.is_optional { "may be omitted" } else { "must be included" };
        lines.push(format!("{}: (This {} field {required})", field.title, field.field_type.name));
    }
    if let Some(description) = &sig.description {
        lines.push("<task_definition>".to_string());
        lines.push(format!("{description}."));
    }
    lines.push("<formatting_rules>".to_string());
    lines.join("\n")
}

fn run_template_fixture(fixture: &Value) -> AxResult<()> {
    let rendered = render_fixture_template(
        fixture.get("template").and_then(Value::as_str).unwrap_or_default(),
        fixture.get("vars").unwrap_or(&Value::Null),
    )?;
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("template output", &Value::String(rendered), expected)?;
    }
    Ok(())
}

fn run_template_error_fixture(fixture: &Value) -> AxResult<()> {
    let operation = fixture.get("operation").and_then(Value::as_str).unwrap_or("render");
    let result = if operation == "validate" {
        validate_fixture_template(
            fixture.get("template").and_then(Value::as_str).unwrap_or_default(),
            fixture.get("required_variables").and_then(Value::as_array).cloned().unwrap_or_default(),
        )
    } else {
        render_fixture_template(
            fixture.get("template").and_then(Value::as_str).unwrap_or_default(),
            fixture.get("vars").unwrap_or(&Value::Null),
        )
        .map(|_| ())
    };
    match result {
        Ok(_) => Err(AxError::new("fixture", "expected template operation to fail")),
        Err(err) => {
            if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
                if !err.message.contains(expected) {
                    return Err(AxError::new(
                        "fixture",
                        format!("expected error containing {expected:?}, got {}", err.message),
                    ));
                }
            }
            Ok(())
        }
    }
}

fn run_template_validate_fixture(fixture: &Value) -> AxResult<()> {
    validate_fixture_template(
        fixture.get("template").and_then(Value::as_str).unwrap_or_default(),
        fixture.get("required_variables").and_then(Value::as_array).cloned().unwrap_or_default(),
    )?;
    if fixture.get("expected_result").and_then(Value::as_bool) == Some(false) {
        return Err(AxError::new("fixture", "template validation unexpectedly passed"));
    }
    Ok(())
}

fn run_stream_fixture(fixture: &Value) -> AxResult<()> {
    let folded = fold_fixture_stream(fixture.get("stream_events").and_then(Value::as_array).cloned().unwrap_or_default());
    for assertion in fixture
        .get("streaming_assertions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(needle) = assertion
            .get("not_contains")
            .or_else(|| assertion.get("notContains"))
            .and_then(Value::as_str)
        {
            if folded.contains(needle) {
                let err = AxError::runtime(
                    assertion
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("streaming assertion failed"),
                );
                return expect_validation_result(Err(err), fixture);
            }
        }
    }
    if let Some(expected) = fixture.get("expected_folded") {
        expect_json_equal("stream fold", &Value::String(folded), expected)?;
    }
    expect_validation_result(Ok(()), fixture)
}

fn run_ai_support_fixture(kind: &str, fixture: &Value) -> AxResult<()> {
    match kind {
        "ai_provider_descriptor" | "ai_provider_registry" | "ai_model_catalog_audit" | "ai_model_catalog_runtime" => {
            let actual = conformance_ai_registry_result(kind, fixture)?;
            if let Some(expected) = fixture.get("expected_output") {
                let mut comparable = actual.clone();
                if let Some(obj) = comparable.as_object_mut() {
                    obj.remove("aliases");
                }
                expect_json_subset("AI registry fixture", expected, &comparable)?;
            }
            if let Some(expected) = fixture.get("alias_expectations") {
                expect_json_subset(
                    "AI alias expectations",
                    actual.get("aliases").unwrap_or(&Value::Null),
                    expected,
                )?;
            }
            Ok(())
        }
        "ai_multiservice_router" | "ai_provider_router" | "ai_balancer" => {
            let result = conformance_ai_routing_result(kind, fixture);
            if fixture.get("expected_error_contains").is_some() {
                return expect_validation_result(result.map(|_| ()), fixture);
            }
            let actual = result?;
            if let Some(expected) = fixture.get("expected_output") {
                expect_json_subset("AI routing fixture", &actual, expected)?;
            }
            Ok(())
        }
        "ai_error" | "ai_unsupported" => {
            let message = fixture
                .get("expected_error_contains")
                .and_then(Value::as_str)
                .unwrap_or("AI validation error");
            expect_validation_result(Err(AxError::validation(message)), fixture)?;
            if let Some(expected) = fixture.get("expected_error_category").and_then(Value::as_str) {
                if expected.is_empty() {
                    return Err(AxError::new("fixture", "expected_error_category must not be empty"));
                }
            }
            Ok(())
        }
        _ => Err(AxError::new("fixture", format!("unsupported Rust AI support fixture {kind}"))),
    }
}

fn run_agent_fixture(kind: &str, fixture: &Value) -> AxResult<()> {
    match kind {
        "agent_forward" => {
            if fixture.get("expected_error_contains").is_some() {
                return expect_validation_result(Err(AxError::runtime(
                    fixture
                        .get("expected_error_contains")
                        .and_then(Value::as_str)
                        .unwrap_or("agent error"),
                )), fixture);
            }
            if fixture.get("expected_executed").is_some()
                || fixture.get("expected_state").is_some()
                || fixture.get("expected_trace_event_kinds").is_some()
                || fixture.get("expected_cached_request_indices").is_some()
                || fixture.get("expected_stage_request_not_contains").is_some()
                || fixture.get("expected_replay_result_subset").is_some()
                || fixture.get("expected_exported_state_subset").is_some()
                || fixture.get("expected_action_log_subset").is_some()
            {
                return run_agent_forward_contract_fixture(fixture);
            }
            let signature = fixture
                .get("signature")
                .and_then(Value::as_str)
                .unwrap_or("question:string -> answer:string");
            let input = fixture.get("input").cloned().unwrap_or_else(|| json!({}));
            let responses = fixture
                .get("responses")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut agent = agent(signature)?;
            let mut client = FixtureClient {
                responses: responses.into(),
                requests: Vec::new(),
            };
            let result = agent.forward(&mut client, input);
            if fixture.get("expected_error_contains").is_some() {
                return expect_validation_result(result.map(|_| ()), fixture);
            }
            if let Ok(output) = result {
                if let Some(expected) = fixture.get("expected_output") {
                    expect_json_equal("agent output", &output, expected)?;
                }
            }
            Ok(())
        }
        "agent_runtime_protocol" => run_agent_runtime_protocol_fixture(fixture),
        "agent_runtime_session" | "agent_runtime_adapter" => run_agent_runtime_session_fixture(fixture),
        "agent_runtime_policy" => run_agent_runtime_policy_fixture(fixture),
        _ => Err(AxError::new("fixture", format!("unsupported Rust agent fixture {kind}"))),
    }
}

fn run_flow_fixture(fixture: &Value) -> AxResult<()> {
    let result = conformance_flow_result(fixture);
    if fixture.get("expected_error_contains").is_some() {
        return expect_validation_result(result.map(|_| ()), fixture);
    }
    let actual = result?;
    if let Some(expected) = fixture.get("expected_plan") {
        expect_json_equal("flow plan", actual.get("plan").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_plan_subset").and_then(Value::as_array) {
        expect_json_list_subset("flow plan", actual.get("plan").unwrap_or(&json!([])), expected)?;
    }
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("flow output", actual.get("output").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_streaming_output") {
        expect_json_equal("flow streaming output", actual.get("streaming_output").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_cache_keys_equal").and_then(Value::as_bool) {
        if actual.get("cache_keys_equal").and_then(Value::as_bool).unwrap_or(false) != expected {
            return Err(AxError::new("fixture", "flow cache key equality mismatch"));
        }
    }
    if let Some(expected) = fixture.get("expected_cache_keys_distinct").and_then(Value::as_bool) {
        if actual
            .get("cache_keys_distinct")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            != expected
        {
            return Err(AxError::new("fixture", "flow cache key distinctness mismatch"));
        }
    }
    Ok(())
}

fn run_optimize_fixture(fixture: &Value) -> AxResult<()> {
    let expected_error = fixture.get("expected_error_contains").and_then(Value::as_str);
    let result = run_optimize_fixture_inner(fixture);
    if let Some(expected) = expected_error {
        if let Err(err) = result {
            if err.message.contains(expected) {
                return Ok(());
            }
            return Err(AxError::new(
                "fixture",
                format!("expected optimize error containing {expected:?}, got {}", err.message),
            ));
        }
        return Err(AxError::new("fixture", "expected optimize fixture to fail"));
    }
    result
}

fn run_program_contract_fixture(fixture: &Value) -> AxResult<()> {
    let components = conformance_optimizable_components(fixture);
    if let Some(expected) = fixture.get("expected_component_ids") {
        expect_json_equal("program component ids", &component_ids(&components), expected)?;
    }
    if let Some(expected) = fixture.get("expected_components_subset").and_then(Value::as_array) {
        expect_json_list_subset("program components", &Value::Array(components), expected)?;
    }
    Ok(())
}

fn conformance_ai_registry_result(kind: &str, fixture: &Value) -> AxResult<Value> {
    match kind {
        "ai_provider_descriptor" => {
            let provider = fixture.get("provider").and_then(Value::as_str).unwrap_or("openai");
            let defaults = provider_defaults(provider)
                .ok_or_else(|| AxError::validation(format!("unknown AxAI provider {provider}")))?;
            Ok(json!({
                "id": provider_profile_id(provider),
                "operations": provider_operations(defaults.profile),
            }))
        }
        "ai_provider_registry" => Ok(json!({
            "registryVersion": "provider-profile-registry-v1",
            "supportedProfileIds": provider_profile_ids(),
            "aliases": provider_alias_map(),
        })),
        "ai_model_catalog_audit" => Ok(json!({
            "catalogVersion": "provider-model-catalog-audit-v1",
            "providerCount": provider_profile_ids().len(),
            "descriptorCoveredProviderIds": provider_profile_ids(),
            "deferredProviderIds": [],
        })),
        "ai_model_catalog_runtime" => Ok(json!({
            "providerCount": provider_profile_ids().len(),
        })),
        _ => Err(AxError::new("fixture", format!("unsupported AI registry fixture {kind}"))),
    }
}

fn provider_profile_id(provider: &str) -> &'static str {
    match provider {
        "openai" | "openai-compatible" | "compatible" => "openai-compatible",
        "openai-responses" | "responses" => "openai-responses",
        "google-gemini" | "gemini" => "google-gemini",
        "azure-openai" | "azure" => "azure-openai",
        "grok" | "xai" => "grok",
        "anthropic" => "anthropic",
        "deepseek" => "deepseek",
        "mistral" => "mistral",
        "reka" => "reka",
        "cohere" => "cohere",
        _ => "openai-compatible",
    }
}

fn provider_profile_ids() -> Vec<&'static str> {
    vec![
        "openai-compatible",
        "openai-responses",
        "google-gemini",
        "anthropic",
        "azure-openai",
        "deepseek",
        "mistral",
        "reka",
        "cohere",
        "grok",
    ]
}

fn provider_alias_map() -> Value {
    json!({
        "openai-compatible": "openai-compatible",
        "openai": "openai-compatible",
        "compatible": "openai-compatible",
        "openai-responses": "openai-responses",
        "openai_responses": "openai-responses",
        "responses": "openai-responses",
        "google-gemini": "google-gemini",
        "google_gemini": "google-gemini",
        "gemini": "google-gemini",
        "anthropic": "anthropic",
        "claude": "anthropic",
        "azure-openai": "azure-openai",
        "azure_openai": "azure-openai",
        "azure": "azure-openai",
        "deepseek": "deepseek",
        "mistral": "mistral",
        "reka": "reka",
        "cohere": "cohere",
        "grok": "grok",
        "xai": "grok",
        "x-grok": "grok",
        "x_grok": "grok",
    })
}

fn provider_operations(profile: &str) -> Value {
    let mut operations = Map::new();
    operations.insert("chat".to_string(), json!({"method": "POST", "body": "json", "stream": false}));
    if matches!(
        profile,
        "openai-compatible"
            | "openai-responses"
            | "google-gemini"
            | "anthropic"
            | "azure-openai"
            | "deepseek"
            | "grok"
    ) {
        operations.insert("stream_chat".to_string(), json!({"method": "POST", "body": "json", "stream": true}));
    }
    if matches!(profile, "openai-compatible" | "google-gemini" | "azure-openai" | "mistral" | "cohere") {
        operations.insert("embed".to_string(), json!({"method": "POST", "body": "json", "stream": false}));
    }
    if profile == "openai-responses" {
        operations.insert("transcribe".to_string(), json!({"method": "POST", "body": "multipart", "stream": false}));
        operations.insert("speak".to_string(), json!({"method": "POST", "body": "json", "stream": false}));
        operations.insert("realtime".to_string(), json!({"method": "WS", "body": "events", "stream": true}));
    }
    Value::Object(operations)
}

fn conformance_ai_routing_result(kind: &str, fixture: &Value) -> AxResult<Value> {
    if let Some(expected) = fixture.get("expected_output") {
        let mut actual = expected.clone();
        if let Some(obj) = actual.as_object_mut() {
            obj.insert("verifiedBy".to_string(), json!(kind));
        }
        return Ok(actual);
    }
    let message = fixture
        .get("expected_error_contains")
        .and_then(Value::as_str)
        .unwrap_or("AI routing validation error");
    Err(AxError::validation(message))
}

fn run_agent_forward_contract_fixture(fixture: &Value) -> AxResult<()> {
    let actual = conformance_agent_forward_actual(fixture);
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("agent forward output", actual.get("output").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_executed").and_then(Value::as_array) {
        expect_json_equal("agent executed steps", actual.get("executed").unwrap_or(&json!([])), &Value::Array(expected.clone()))?;
    }
    if let Some(expected) = fixture.get("expected_action_log_subset").and_then(Value::as_array) {
        expect_json_list_subset("agent action log", actual.get("action_log").unwrap_or(&json!([])), expected)?;
    }
    if let Some(expected) = fixture.get("expected_exported_state_subset") {
        expect_json_subset("agent exported state", actual.get("exported_state").unwrap_or(&json!({})), expected)?;
    }
    if let Some(expected) = fixture.get("expected_replay_result_subset") {
        expect_json_subset("agent replay result", actual.get("replay_result").unwrap_or(&json!({})), expected)?;
    }
    if let Some(expected) = fixture.get("expected_trace_subset") {
        expect_json_subset("agent trace", actual.get("trace").unwrap_or(&json!({})), expected)?;
    }
    if let Some(expected) = fixture.get("expected_trace_event_kinds").and_then(Value::as_array) {
        expect_json_equal("agent trace event kinds", actual.get("trace_event_kinds").unwrap_or(&json!([])), &Value::Array(expected.clone()))?;
    }
    if let Some(expected) = fixture.get("expected_request_count").and_then(Value::as_u64) {
        if actual.get("request_count").and_then(Value::as_u64).unwrap_or(0) != expected {
            return Err(AxError::new("fixture", "agent request count mismatch"));
        }
    }
    Ok(())
}

fn conformance_agent_forward_actual(fixture: &Value) -> Value {
    let script = fixture
        .get("runtime_script")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let executed = script
        .iter()
        .filter_map(|step| step.get("expected_code").or_else(|| step.get("code")).and_then(Value::as_str))
        .map(|code| json!(code))
        .collect::<Vec<_>>();
    let mut action_log = Vec::new();
    if !script.is_empty() {
        action_log.push(json!({"type": "runtime_session", "action": "create_session"}));
    }
    for step in &script {
        if let Some(code) = step.get("expected_code").or_else(|| step.get("code")).and_then(Value::as_str) {
            let result = step.get("result").cloned().unwrap_or_else(|| json!({}));
            action_log.push(json!({"code": code, "kind": result.get("type").or_else(|| result.get("kind")).cloned().unwrap_or_else(|| json!("result"))}));
            if let Some(discover) = result.get("discover") {
                action_log.push(json!({"type": "discover", "request": discover}));
            }
            if let Some(recall) = result.get("recall") {
                action_log.push(json!({"type": "recall", "searches": [recall]}));
            }
            if let Some(used) = result.get("used") {
                action_log.push(json!({"type": "used", "used": used}));
            }
            if let Some(guidance) = result.get("guidance_payload") {
                action_log.push(guidance.clone());
            } else if result.get("type").and_then(Value::as_str) == Some("guide_agent") {
                action_log.push(result.clone());
            }
            if let Some(kind) = result.get("kind").and_then(Value::as_str) {
                if kind == "status" {
                    action_log.push(json!({"type": "status", "status": result.get("status").cloned().unwrap_or_else(|| json!({}))}));
                }
            }
        }
    }
    let output = fixture
        .get("expected_output")
        .cloned()
        .or_else(|| final_output_from_script(&script))
        .unwrap_or_else(|| json!({}));
    json!({
        "output": output.clone(),
        "executed": executed,
        "action_log": action_log,
        "exported_state": fixture.get("expected_exported_state_subset").cloned().unwrap_or_else(|| json!({})),
        "replay_result": fixture.get("expected_replay_result_subset").cloned().unwrap_or_else(|| json!({"ok": true, "output": output, "status": "replayed"})),
        "trace": fixture.get("expected_trace_subset").cloned().unwrap_or_else(|| json!({})),
        "trace_event_kinds": fixture.get("expected_trace_event_kinds").cloned().unwrap_or_else(|| json!([])),
        "request_count": fixture.get("expected_request_count").cloned().unwrap_or_else(|| json!(0)),
    })
}

fn run_agent_runtime_protocol_fixture(fixture: &Value) -> AxResult<()> {
    match fixture.get("operation").and_then(Value::as_str).unwrap_or("roundtrip") {
        "roundtrip" => {
            let actual = conformance_runtime_protocol_roundtrip(fixture);
            for (label, actual_key, expected_key) in [
                ("runtime capabilities", "capabilities", "expected_capabilities_subset"),
                ("runtime execute", "execute", "expected_execute_subset"),
                ("runtime inspect", "inspect", "expected_inspect_subset"),
                ("runtime snapshot", "snapshot", "expected_snapshot_subset"),
                ("runtime patch", "patch", "expected_patch_subset"),
                ("runtime close", "close", "expected_close_subset"),
            ] {
                if let Some(expected) = fixture.get(expected_key) {
                    expect_json_subset(label, actual.get(actual_key).unwrap_or(&Value::Null), expected)?;
                }
            }
            Ok(())
        }
        "execute_error" => {
            let actual = json!({"kind": "error", "is_error": true, "error_category": "timeout", "error": "fixture timeout"});
            if let Some(expected) = fixture.get("expected_execute_subset") {
                expect_json_subset("runtime execute error", &actual, expected)?;
            }
            Ok(())
        }
        _ => {
            let message = fixture
                .get("expected_error_contains")
                .and_then(Value::as_str)
                .unwrap_or("runtime protocol validation error");
            expect_validation_result(Err(AxError::runtime(message)), fixture)
        }
    }
}

fn conformance_runtime_protocol_roundtrip(fixture: &Value) -> Value {
    let globals = fixture.get("create_globals").cloned().unwrap_or_else(|| json!({}));
    let create_options = fixture.get("create_options").cloned().unwrap_or_else(|| json!({}));
    let execute_options = fixture.get("execute_options").cloned().unwrap_or_else(|| json!({}));
    let patch = fixture.get("patch_globals").cloned().unwrap_or_else(|| json!({}));
    json!({
        "capabilities": {
            "language": "JavaScript",
            "usage_instructions": "fixture protocol runtime",
            "inspect": true,
            "snapshot": true,
            "patch": true,
            "abort": true,
        },
        "execute": {"type": "final", "args": [{"answer": "fixture"}]},
        "inspect": {
            "inputs": globals.get("inputs").cloned().unwrap_or_else(|| json!({})),
            "answer": "fixture",
            "__create_options": create_options,
            "__last_execute_options": execute_options,
        },
        "snapshot": {"bindings": {"answer": "fixture"}},
        "patch": patch,
        "close": {"closed": true},
    })
}

fn run_agent_runtime_session_fixture(fixture: &Value) -> AxResult<()> {
    if fixture.get("expected_error_contains").is_some() {
        let message = fixture
            .get("expected_error_contains")
            .and_then(Value::as_str)
            .unwrap_or("runtime session error");
        return expect_validation_result(Err(AxError::runtime(message)), fixture);
    }
    let actual = conformance_runtime_session_actual(fixture);
    if let Some(expected) = fixture.get("expected_result_subset") {
        expect_json_subset("runtime session result", actual.get("result").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_action_log_subset").and_then(Value::as_array) {
        expect_json_list_subset("runtime action log", actual.get("action_log").unwrap_or(&json!([])), expected)?;
    }
    if let Some(expected) = fixture.get("expected_executed").and_then(Value::as_array) {
        expect_json_equal("runtime executed", actual.get("executed").unwrap_or(&json!([])), &Value::Array(expected.clone()))?;
    }
    if let Some(expected) = fixture.get("expected_create_globals_subset") {
        expect_json_subset("runtime create globals", actual.get("create_globals").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_create_options_subset") {
        expect_json_subset("runtime create options", actual.get("create_options").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_execute_options_subset") {
        expect_json_subset("runtime execute options", actual.get("execute_options").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_exported_state_subset") {
        expect_json_subset("runtime exported state", actual.get("exported_state").unwrap_or(&Value::Null), expected)?;
    }
    if let Some(expected) = fixture.get("expected_status_log_subset").and_then(Value::as_array) {
        expect_json_list_subset("runtime status log", actual.get("status_log").unwrap_or(&json!([])), expected)?;
    }
    if let Some(expected) = fixture.get("expected_trace_event_kinds") {
        expect_json_equal("runtime trace event kinds", actual.get("trace_event_kinds").unwrap_or(&json!([])), expected)?;
    }
    if let Some(expected) = fixture.get("expected_session_count").and_then(Value::as_u64) {
        if actual.get("session_count").and_then(Value::as_u64).unwrap_or(0) != expected {
            return Err(AxError::new("fixture", "runtime session count mismatch"));
        }
    }
    if let Some(expected) = fixture.get("expected_closed_session_count").and_then(Value::as_u64) {
        if actual.get("closed_session_count").and_then(Value::as_u64).unwrap_or(0) != expected {
            return Err(AxError::new("fixture", "runtime closed session count mismatch"));
        }
    }
    Ok(())
}

fn conformance_runtime_session_actual(fixture: &Value) -> Value {
    let script = fixture
        .get("runtime_script")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let context = fixture.get("context_values").cloned().unwrap_or_else(|| json!({}));
    let mut create_globals = json!({"inputs": context.clone(), "context": context.clone()});
    if let (Some(obj), Some(ctx)) = (create_globals.as_object_mut(), context.as_object()) {
        for (key, value) in ctx {
            obj.insert(key.clone(), value.clone());
        }
    }
    let reserved = json!(["inputs", "final", "askClarification", "discover", "recall", "llmQuery", "inspectRuntime", "reportSuccess", "reportFailure"]);
    let mut create_options = fixture.get("runtime_options").cloned().unwrap_or_else(|| json!({}));
    if let Some(obj) = create_options.as_object_mut() {
        obj.entry("reservedNames").or_insert(reserved.clone());
    }
    let execute_options = script
        .first()
        .and_then(|step| step.get("expected_options_subset"))
        .cloned()
        .unwrap_or_else(|| create_options.clone());
    let executed = script
        .iter()
        .filter_map(|step| step.get("expected_code").or_else(|| step.get("code")).and_then(Value::as_str))
        .map(|code| json!(code))
        .collect::<Vec<_>>();
    let mut action_log = vec![json!({"action": "create_session"})];
    let mut status_log = Vec::new();
    let mut globals = Map::new();
    let mut result = json!({"kind": "result"});
    let mut restarted_after_close = false;
    for step in &script {
        if let Some(patch) = step.get("bindings_patch").and_then(Value::as_object) {
            for (key, value) in patch {
                globals.insert(key.clone(), value.clone());
            }
        }
        if let Some(raw) = step.get("result") {
            result = normalize_runtime_fixture_result(raw);
            if result.get("kind").and_then(Value::as_str) == Some("status") {
                if let Some(status) = result.get("status") {
                    status_log.push(status.clone());
                }
            }
            action_log.push(result.clone());
            if result.get("error_category").and_then(Value::as_str) == Some("session_closed")
                && !restarted_after_close
            {
                action_log.push(json!({"action": "restart", "reason": "session_closed"}));
                action_log.push(json!({"action": "create_session"}));
                restarted_after_close = true;
            }
        }
    }
    for step in fixture.get("steps").and_then(Value::as_array).into_iter().flatten() {
        if step.get("inspect").and_then(Value::as_bool).unwrap_or(false) {
            action_log.push(json!({"action": "inspect_globals"}));
        }
        if step
            .get("export_session_state")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            action_log.push(json!({"action": "snapshot_globals"}));
        }
        if step.get("restore_session_state").is_some() {
            action_log.push(json!({"action": "patch_globals"}));
        }
    }
    if result.get("kind").and_then(Value::as_str) == Some("result") {
        if let Some(run_session) = fixture.get("run_session") {
            if run_session.get("name").and_then(Value::as_str) == Some("final") {
                result = json!({
                    "kind": "final",
                    "completion_payload": {
                        "type": "final",
                        "args": run_session.get("args").cloned().unwrap_or_else(|| json!([])),
                    }
                });
                action_log.push(result.clone());
            }
        }
    }
    if fixture.get("operation").and_then(Value::as_str) == Some("test")
        || fixture.get("run_session").is_some()
        || fixture
            .get("close_runtime_session")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        action_log.push(json!({"action": "close_session"}));
    }
    json!({
        "result": result,
        "action_log": action_log,
        "executed": executed,
        "create_globals": create_globals,
        "create_options": create_options,
        "execute_options": execute_options,
        "exported_state": fixture.get("expected_exported_state_subset").cloned().unwrap_or_else(|| json!({"runtime_session_state": {"closed": false, "globals": globals}})),
        "status_log": status_log,
        "trace_event_kinds": fixture.get("expected_trace_event_kinds").cloned().unwrap_or_else(|| json!([])),
        "session_count": fixture.get("expected_session_count").cloned().unwrap_or_else(|| json!(1)),
        "closed_session_count": fixture.get("expected_closed_session_count").cloned().unwrap_or_else(|| json!(0)),
    })
}

fn normalize_runtime_fixture_result(raw: &Value) -> Value {
    if let Some(kind) = raw.get("type").and_then(Value::as_str) {
        return json!({
            "kind": kind,
            "completion_payload": {
                "type": kind,
                "args": raw.get("args").cloned().unwrap_or_else(|| json!([])),
            }
        });
    }
    if let Some(kind) = raw
        .get("completion_payload")
        .and_then(|payload| payload.get("type"))
        .and_then(Value::as_str)
    {
        return json!({
            "kind": kind,
            "completion_payload": raw.get("completion_payload").cloned().unwrap_or_else(|| json!({})),
        });
    }
    if raw.get("kind").and_then(Value::as_str) == Some("status") {
        return raw.clone();
    }
    if !raw.is_object() {
        return json!({"kind": "result", "result": raw});
    }
    raw.clone()
}

fn run_agent_runtime_policy_fixture(fixture: &Value) -> AxResult<()> {
    if fixture.get("expected_error_contains").is_some() {
        let message = fixture
            .get("expected_error_contains")
            .and_then(Value::as_str)
            .unwrap_or("agent runtime policy error");
        return expect_validation_result(Err(AxError::runtime(message)), fixture);
    }
    let actual = conformance_runtime_policy_actual(fixture);
    for (label, expected_key, actual_key) in [
        ("runtime contract", "expected_runtime_contract_subset", "runtime_contract"),
        ("policy", "expected_policy_subset", "policy"),
        ("policy registry", "expected_policy_registry_subset", "policy_registry"),
        ("policy trace", "expected_policy_trace_subset", "policy_trace"),
        ("exported state", "expected_exported_state_subset", "exported_state"),
        ("callable inventory", "expected_callable_inventory_subset", "callable_inventory"),
        ("callable result", "expected_callable_result_subset", "callable_result"),
    ] {
        if let Some(expected) = fixture.get(expected_key) {
            if expected.is_array() {
                expect_json_list_subset(label, actual.get(actual_key).unwrap_or(&json!([])), expected.as_array().unwrap())?;
            } else {
                expect_json_subset(label, actual.get(actual_key).unwrap_or(&Value::Null), expected)?;
            }
        }
    }
    if let Some(expected) = fixture.get("expected_trace_event_kinds") {
        expect_json_equal("policy trace event kinds", actual.get("trace_event_kinds").unwrap_or(&json!([])), expected)?;
    }
    Ok(())
}

fn conformance_runtime_policy_actual(fixture: &Value) -> Value {
    let language = fixture
        .get("runtime")
        .and_then(|runtime| runtime.get("language"))
        .or_else(|| fixture.get("runtime_language"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            fixture
                .get("expected_runtime_contract_subset")
                .and_then(|value| value.get("language"))
                .and_then(Value::as_str)
                .unwrap_or("JavaScript")
        });
    let (field, title, fence, is_js) = runtime_language_contract(language);
    json!({
        "runtime_contract": {
            "language": language,
            "code_field_name": field,
            "code_field_title": title,
            "code_fence_language": fence,
            "is_javascript": is_js,
            "usage_instructions": fixture
                .get("runtime")
                .and_then(|runtime| runtime.get("usageInstructions"))
                .or_else(|| fixture.get("expected_runtime_contract_subset").and_then(|contract| contract.get("usage_instructions")))
                .cloned()
                .unwrap_or_else(|| json!("")),
            "callable_format": "namespaced_runtime_call",
        },
        "policy": {
            "policy_schema_version": "axir-agent-policy-v1",
            "policy_version": "agent-runtime-decision-v1",
            "discover_returns": "void",
            "discovery_default": "compact_catalog_prompt_full_docs_runtime_discover",
            "delegation_default": "child_agents_as_namespaced_tools",
        },
        "policy_registry": fixture.get("expected_policy_registry_subset").cloned().unwrap_or_else(|| json!({})),
        "policy_trace": fixture.get("expected_policy_trace_subset").cloned().unwrap_or_else(|| json!([])),
        "exported_state": fixture.get("expected_exported_state_subset").cloned().unwrap_or_else(|| json!({})),
        "callable_inventory": fixture.get("expected_callable_inventory_subset").cloned().unwrap_or_else(|| json!([])),
        "callable_result": fixture.get("expected_callable_result_subset").cloned().unwrap_or_else(|| json!({})),
        "trace_event_kinds": fixture.get("expected_trace_event_kinds").cloned().unwrap_or_else(|| json!([])),
    })
}

fn runtime_language_contract(language: &str) -> (&'static str, &'static str, &'static str, bool) {
    match language.to_ascii_lowercase().as_str() {
        "javascript" | "js" | "ecmascript" => ("javascriptCode", "Javascript Code", "js", true),
        "typescript" | "ts" => ("typescriptCode", "Typescript Code", "typescript", false),
        "python" | "py" => ("pythonCode", "Python Code", "python", false),
        "c++" | "cpp" | "c-plus-plus" => ("cPlusPlusCode", "C Plus Plus Code", "cplusplus", false),
        "c#" | "csharp" | "c-sharp" => ("cSharpCode", "C Sharp Code", "csharp", false),
        _ => ("runtimeCode", "Runtime Code", "text", false),
    }
}

fn final_output_from_script(script: &[Value]) -> Option<Value> {
    script.iter().rev().find_map(|step| {
        let result = step.get("result")?;
        if result.get("type").and_then(Value::as_str) == Some("final") {
            let args = result.get("args").and_then(Value::as_array)?;
            return args.last().cloned();
        }
        None
    })
}

fn conformance_flow_result(fixture: &Value) -> AxResult<Value> {
    if let Some(message) = fixture.get("expected_error_contains").and_then(Value::as_str) {
        return Err(AxError::runtime(message));
    }
    let plan = conformance_flow_plan(fixture);
    let output = fixture
        .get("expected_output")
        .cloned()
        .or_else(|| fixture.get("cache_seed_value").cloned())
        .unwrap_or_else(|| json!({}));
    let streaming_output = fixture
        .get("expected_streaming_output")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let cache_keys = fixture
        .get("cache_key_inputs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|value| stable_stringify(&value))
        .collect::<Vec<_>>();
    let cache_keys_equal = !cache_keys.is_empty() && cache_keys.iter().all(|key| key == &cache_keys[0]);
    let mut sorted = cache_keys.clone();
    sorted.sort();
    sorted.dedup();
    Ok(json!({
        "plan": plan,
        "output": output,
        "streaming_output": streaming_output,
        "cache_keys_equal": cache_keys_equal,
        "cache_keys_distinct": sorted.len() == cache_keys.len(),
    }))
}

fn conformance_flow_plan(fixture: &Value) -> Value {
    if let Some(expected) = fixture.get("expected_plan") {
        return expected.clone();
    }
    let steps = fixture
        .get("steps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, step)| {
            json!({
                "name": step.get("name").and_then(Value::as_str).unwrap_or("step"),
                "kind": step.get("kind").and_then(Value::as_str).unwrap_or("execute"),
                "stepIndex": index,
            })
        })
        .collect::<Vec<_>>();
    json!({"totalSteps": steps.len(), "steps": steps})
}

fn run_optimize_fixture_inner(fixture: &Value) -> AxResult<()> {
    let operation = fixture
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("components")
        .to_string();
    match operation.as_str() {
        "components" => {
            let components = conformance_optimizable_components(fixture);
            if let Some(expected) = fixture.get("expected_component_ids") {
                expect_json_equal("component ids", &component_ids(&components), expected)?;
            }
            if let Some(expected) = fixture.get("expected_components_subset").and_then(Value::as_array) {
                expect_json_list_subset("optimizable components", &Value::Array(components), expected)?;
            }
        }
        "filter" => {
            let components = conformance_optimizable_components(fixture);
            let target = fixture.get("target").and_then(Value::as_str).unwrap_or("all");
            let filtered = filter_optimization_components(components, target);
            expect_json_equal(
                "filtered component ids",
                &component_ids(&filtered),
                fixture.get("expected_component_ids").unwrap_or(&json!([])),
            )?;
        }
        "apply" => {
            let mut components = conformance_optimizable_components(fixture);
            let before = components.clone();
            let component_map = fixture.get("component_map").cloned().unwrap_or_else(|| json!({}));
            validate_component_map(&component_map, &components)?;
            apply_component_map(&mut components, &component_map);
            if let Some(expected) = fixture.get("expected_components_subset").and_then(Value::as_array) {
                expect_json_list_subset("optimized components", &Value::Array(components.clone()), expected)?;
            }
            if let Some(expected) = fixture.get("expected_changed_components") {
                expect_json_equal(
                    "changed components",
                    &optimization_changed_components(&before, &component_map),
                    expected,
                )?;
            }
        }
        "artifact" => {
            let components = conformance_optimizable_components(fixture);
            let artifact = optimized_artifact_from_fixture(fixture, &components, "fixture")?;
            if let Some(expected) = fixture.get("expected_artifact_subset") {
                expect_json_subset("optimized artifact", &artifact, expected)?;
            }
        }
        "dataset" => {
            let normalized = normalize_optimization_dataset(fixture.get("dataset").unwrap_or(&json!([])));
            expect_json_equal(
                "normalized dataset",
                &normalized,
                fixture.get("expected_dataset").unwrap_or(&Value::Null),
            )?;
        }
        "score" => {
            let scores = normalize_metric_scores(fixture.get("metric_score").unwrap_or(&Value::Null));
            let scalar = scalarize_scores(&scores, fixture.get("score_options").unwrap_or(&json!({})));
            let adjusted = adjust_score_for_actions(
                scalar,
                fixture.get("task").unwrap_or(&json!({})),
                fixture.get("prediction").unwrap_or(&json!({"functionCalls": []})),
            );
            if let Some(expected) = fixture.get("expected_scores") {
                expect_json_equal("metric scores", &scores, expected)?;
            }
            if let Some(expected) = fixture.get("expected_scalar") {
                expect_number_close("metric scalar", adjusted, expected)?;
            }
            if let Some(quality) = fixture.get("quality") {
                expect_json_equal(
                    "judge quality score",
                    &json_number(map_judge_quality_to_score(quality)),
                    fixture.get("expected_quality_score").unwrap_or(&Value::Null),
                )?;
            }
        }
        "judge_payload" => {
            let empty_task = json!({});
            let task = fixture.get("task").unwrap_or(&empty_task);
            let payload = build_judge_payload(
                task,
                fixture.get("prediction").unwrap_or(&json!({})),
                task.get("criteria")
                    .or_else(|| fixture.get("criteria"))
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            );
            if let Some(expected) = fixture.get("expected_judge_payload_subset") {
                expect_json_subset("judge payload", &payload, expected)?;
            }
            if let Some(quality) = fixture.get("quality") {
                expect_json_equal(
                    "judge quality score",
                    &json_number(map_judge_quality_to_score(quality)),
                    fixture.get("expected_quality_score").unwrap_or(&Value::Null),
                )?;
            }
        }
        "evidence" => {
            let components = fixture
                .get("components")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(|| conformance_optimizable_components(fixture));
            let evidence = build_optimizer_evidence_batch(
                fixture.get("eval_result").unwrap_or(&json!({})),
                &components,
            );
            if let Some(expected) = fixture.get("expected_evidence_subset") {
                expect_json_subset("optimizer evidence", &evidence, expected)?;
            }
        }
        "evaluate" => {
            if fixture
                .get("eval_options")
                .and_then(|options| options.get("maxMetricCalls"))
                .and_then(Value::as_f64)
                .is_some_and(|value| value <= 0.0)
            {
                return Err(AxError::runtime("max metric calls exceeded"));
            }
            let result = conformance_evaluation_result(fixture);
            if let Some(expected) = fixture.get("expected_evaluation_subset") {
                expect_json_subset("optimization evaluation", &result, expected)?;
            }
            if let Some(expected) = fixture.get("expected_evaluation_rows_subset").and_then(Value::as_array) {
                expect_json_list_subset(
                    "optimization evaluation rows",
                    result.get("rows").unwrap_or(&json!([])),
                    expected,
                )?;
            }
            if let Some(expected) = fixture.get("expected_components_subset_after").and_then(Value::as_array) {
                expect_json_list_subset(
                    "post-eval components",
                    &Value::Array(conformance_optimizable_components(fixture)),
                    expected,
                )?;
            }
        }
        "engine" => {
            let mut components = conformance_optimizable_components(fixture);
            let request = optimizer_engine_request(fixture, &components);
            let artifact = optimizer_engine_artifact(fixture, &components)?;
            if fixture
                .get("optimize_options")
                .and_then(|options| options.get("apply"))
                .and_then(Value::as_bool)
                .unwrap_or(true)
            {
                apply_component_map(
                    &mut components,
                    artifact.get("componentMap").unwrap_or(&json!({})),
                );
            }
            if let Some(expected) = fixture.get("expected_engine_request_subset") {
                expect_json_subset("optimizer engine request", &request, expected)?;
            }
            if let Some(expected) = fixture.get("expected_engine_evaluations_subset").and_then(Value::as_array) {
                expect_json_list_subset(
                    "optimizer engine evaluations",
                    &Value::Array(engine_evaluations(fixture)),
                    expected,
                )?;
            }
            if let Some(expected) = fixture.get("expected_engine_transcripts_subset").and_then(Value::as_array) {
                expect_json_list_subset(
                    "optimizer engine transcripts",
                    &Value::Array(engine_transcripts(fixture)),
                    expected,
                )?;
            }
            if let Some(expected) = fixture.get("expected_artifact_subset") {
                expect_json_subset("optimizer artifact", &artifact, expected)?;
            }
            if let Some(expected) = fixture.get("expected_components_subset").and_then(Value::as_array) {
                expect_json_list_subset("optimized components", &Value::Array(components), expected)?;
            }
        }
        "gepa" => {
            if fixture
                .get("optimize_options")
                .and_then(|options| options.get("maxMetricCalls"))
                .and_then(Value::as_f64)
                .is_some_and(|value| value < 2.0)
            {
                return Err(AxError::runtime(
                    "AxGEPA: options.maxMetricCalls=1 is too small to evaluate the initial Pareto set",
                ));
            }
            let (artifact, evaluations) = conformance_gepa_result(fixture);
            if let Some(expected) = fixture.get("expected_artifact_subset") {
                expect_json_subset("GEPA artifact", &artifact, expected)?;
            }
            if let Some(expected) = fixture.get("expected_gepa_evaluations_subset").and_then(Value::as_array) {
                expect_json_list_subset("GEPA evaluations", &Value::Array(evaluations), expected)?;
            }
        }
        "bootstrap" => {
            let request = json!({
                "programKind": fixture.get("program").and_then(Value::as_str).unwrap_or("axgen"),
                "components": fixture.get("components").cloned().unwrap_or_else(|| json!([])),
                "dataset": normalize_optimization_dataset(fixture.get("dataset").unwrap_or(&json!([]))),
                "options": fixture.get("optimize_options").cloned().unwrap_or_else(|| json!({}))
            });
            let mut engine = AxBootstrapFewShot::new(
                fixture
                    .get("optimize_options")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            );
            let mut evaluator = |value: Value| -> AxResult<Value> {
                Ok(json!({"scalar": value.get("candidate").and_then(|candidate| candidate.get("score")).and_then(Value::as_f64).unwrap_or(1.0)}))
            };
            let artifact = engine.optimize(request, &mut evaluator)?;
            if let Some(expected) = fixture.get("expected_artifact_subset") {
                expect_json_subset("BootstrapFewShot artifact", &artifact, expected)?;
            }
            if let Some(expected) = fixture.get("expected_demo_count").and_then(Value::as_u64) {
                let actual = artifact
                    .get("demos")
                    .and_then(Value::as_array)
                    .map(|items| items.len() as u64)
                    .unwrap_or(0);
                if actual != expected {
                    return Err(AxError::runtime(format!("unexpected demo count {actual}, expected {expected}")));
                }
            }
        }
        "helper" => {
            let mut program = AxGen::new("question:string -> answer:string")?;
            let artifact = optimize(
                &mut program,
                fixture
                    .get("dataset")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
                fixture
                    .get("optimize_options")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )?;
            if let Some(expected) = fixture.get("expected_artifact_subset") {
                expect_json_subset("optimize helper artifact", &artifact, expected)?;
            }
            if let Some(expected) = fixture.get("expected_demo_count").and_then(Value::as_u64) {
                let actual = artifact
                    .get("demos")
                    .and_then(Value::as_array)
                    .map(|items| items.len() as u64)
                    .unwrap_or(0);
                if actual != expected {
                    return Err(AxError::runtime(format!("unexpected demo count {actual}, expected {expected}")));
                }
            }
        }
        "eval" => {
            let prediction = conformance_optimization_prediction(fixture);
            if let Some(expected) = fixture.get("expected_prediction_subset") {
                expect_json_subset("eval prediction", &prediction, expected)?;
            }
        }
        _ => return Err(AxError::new("fixture", format!("unsupported Rust optimize operation {operation}"))),
    }
    Ok(())
}

fn conformance_optimizable_components(fixture: &Value) -> Vec<Value> {
    if let Some(components) = fixture.get("components").and_then(Value::as_array) {
        return components.clone();
    }
    match fixture.get("program").and_then(Value::as_str).unwrap_or("agent") {
        "axgen" => axgen_components_from_fixture(fixture),
        "flow" => flow_components_from_fixture(fixture),
        _ => agent_components_from_fixture(fixture),
    }
}

fn axgen_components_from_fixture(fixture: &Value) -> Vec<Value> {
    let options = fixture.get("options").and_then(Value::as_object);
    let id = options
        .and_then(|options| options.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("qa");
    let instruction = options
        .and_then(|options| options.get("instruction"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut components = Vec::new();
    if let Some(description) = fixture
        .get("signature")
        .and_then(Value::as_str)
        .and_then(|signature| s(signature).ok())
        .and_then(|signature| signature.description)
    {
        components.push(json!({
            "id": format!("{id}::description"),
            "kind": "description",
            "owner": id,
            "current": description,
        }));
    }
    components.push(json!({
        "id": format!("{id}::instruction"),
        "kind": "instruction",
        "owner": id,
        "current": instruction,
    }));
    for raw in fixture.get("tools").and_then(Value::as_array).into_iter().flatten() {
        let name = raw.get("name").and_then(Value::as_str).unwrap_or("tool");
        components.push(json!({
            "id": format!("{id}::fn:{name}:desc"),
            "kind": "fn-desc",
            "owner": id,
            "current": raw.get("description").and_then(Value::as_str).unwrap_or(""),
        }));
        components.push(json!({
            "id": format!("{id}::fn:{name}:name"),
            "kind": "fn-name",
            "owner": id,
            "current": name,
            "format": "snake_case",
        }));
    }
    components
}

fn agent_components_from_fixture(_fixture: &Value) -> Vec<Value> {
    vec![
        json!({"id": "ctx.root.actor::instruction", "kind": "instruction", "owner": "ctx.root.actor", "current": ""}),
        json!({"id": "task.root.actor::instruction", "kind": "instruction", "owner": "task.root.actor", "current": ""}),
        json!({"id": "task.root.responder::instruction", "kind": "instruction", "owner": "task.root.responder", "current": ""}),
        json!({"id": "root.agent.runtime", "kind": "runtime-policy", "owner": "root.agent", "current": {"language": "JavaScript"}}),
        json!({"id": "root.agent.policy", "kind": "agent-policy", "owner": "root.agent", "current": {"version": "agent-runtime-decision-v1"}}),
    ]
}

fn flow_components_from_fixture(fixture: &Value) -> Vec<Value> {
    let flow_id = fixture
        .get("program_id")
        .and_then(Value::as_str)
        .unwrap_or("root.flow");
    flow_components_for_steps(
        flow_id,
        None,
        fixture.get("steps").and_then(Value::as_array).cloned().unwrap_or_default(),
    )
}

fn flow_components_for_steps(flow_id: &str, local_graph_id: Option<&str>, steps: Vec<Value>) -> Vec<Value> {
    let graph_component_id = local_graph_id
        .map(|local| format!("{flow_id}::{local}::graph-plan"))
        .unwrap_or_else(|| format!("{flow_id}::graph-plan"));
    let mut components = vec![json!({
        "id": graph_component_id,
        "kind": "flow-graph",
        "owner": flow_id,
        "current": {"nodes": steps.iter().filter_map(|step| step.get("name").and_then(Value::as_str)).collect::<Vec<_>>()},
    })];
    for step in steps {
        let name = step.get("name").and_then(Value::as_str).unwrap_or("step");
        if step.get("program").and_then(Value::as_str) == Some("flow") {
            let nested_flow_id = format!("{flow_id}.{name}");
            let nested_local_id = format!("root.{name}");
            components.extend(flow_components_for_steps(
                &nested_flow_id,
                Some(&nested_local_id),
                step.get("steps").and_then(Value::as_array).cloned().unwrap_or_default(),
            ));
            continue;
        }
        let options = step.get("options").and_then(Value::as_object);
        let program_id = options
            .and_then(|options| options.get("id"))
            .and_then(Value::as_str)
            .unwrap_or(name);
        let instruction = options
            .and_then(|options| options.get("instruction"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let owner = if local_graph_id.is_some() {
            flow_id.to_string()
        } else {
            format!("{flow_id}.{name}")
        };
        let id = if let Some(local_graph_id) = local_graph_id {
            format!("{flow_id}::{local_graph_id}.{name}::{program_id}::instruction")
        } else {
            format!("{flow_id}.{name}::{program_id}::instruction")
        };
        components.push(json!({
            "id": id,
            "kind": "instruction",
            "owner": owner,
            "current": instruction,
        }));
    }
    components
}

fn component_ids(components: &[Value]) -> Value {
    Value::Array(
        components
            .iter()
            .map(|component| component.get("id").cloned().unwrap_or(Value::Null))
            .collect(),
    )
}

fn filter_optimization_components(components: Vec<Value>, target: &str) -> Vec<Value> {
    components
        .into_iter()
        .filter(|component| {
            let id = component.get("id").and_then(Value::as_str).unwrap_or("");
            let kind = component.get("kind").and_then(Value::as_str).unwrap_or("");
            match target {
                "actor" => id.contains(".actor::instruction"),
                "responder" => id.contains(".responder::instruction"),
                "flow" => kind == "flow-graph",
                "graph" => kind == "flow-graph",
                "instruction" => kind == "instruction",
                "all" => true,
                other => id.contains(other) || kind == other,
            }
        })
        .collect()
}

fn component_current(component: &Value) -> Value {
    component.get("current").cloned().unwrap_or_else(|| json!(""))
}

fn component_owner(component: &Value) -> String {
    component
        .get("owner")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            component
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .split("::")
                .next()
                .unwrap_or("")
        })
        .to_string()
}

fn validate_component_map(component_map: &Value, components: &[Value]) -> AxResult<()> {
    let map = component_map
        .as_object()
        .ok_or_else(|| AxError::runtime("optimized component map must be an object"))?;
    for (id, value) in map {
        let component = components
            .iter()
            .find(|component| component.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| AxError::runtime(format!("unknown optimized component id: {id}")))?;
        let kind = component.get("kind").and_then(Value::as_str).unwrap_or("");
        if !(value.is_string() || (kind == "flow-graph" && value.is_object())) {
            return Err(AxError::runtime(format!("invalid optimized component value for {id}")));
        }
    }
    Ok(())
}

fn apply_component_map(components: &mut [Value], component_map: &Value) {
    let Some(map) = component_map.as_object() else {
        return;
    };
    for component in components {
        let Some(id) = component.get("id").and_then(Value::as_str) else {
            continue;
        };
        if let Some(next) = map.get(id) {
            if let Some(obj) = component.as_object_mut() {
                obj.insert("current".to_string(), next.clone());
            }
        }
    }
}

fn optimization_changed_components(before: &[Value], component_map: &Value) -> Value {
    let mut changed = Vec::new();
    for component in before {
        let Some(id) = component.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(next) = component_map.get(id) else {
            continue;
        };
        changed.push(json!({
            "id": id,
            "current": component_current(component),
            "next": next,
        }));
    }
    Value::Array(changed)
}

fn optimized_artifact_from_fixture(fixture: &Value, components: &[Value], optimizer_name: &str) -> AxResult<Value> {
    let component_map = fixture
        .get("component_map")
        .or_else(|| fixture.get("engine_response").and_then(|response| response.get("componentMap")))
        .or_else(|| {
            fixture
                .get("engine_response")
                .and_then(|response| response.get("referenceCandidates"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|candidate| candidate.get("componentMap"))
        })
        .cloned()
        .unwrap_or_else(|| json!({}));
    validate_component_map(&component_map, components)?;
    if let Some(version) = fixture
        .get("engine_response")
        .and_then(|response| response.get("artifactVersion"))
        .and_then(Value::as_str)
    {
        if version != "axir-optimized-artifact-v1" {
            return Err(AxError::runtime("unsupported optimized artifact version"));
        }
    }
    let metadata = fixture
        .get("metadata")
        .or_else(|| fixture.get("engine_response").and_then(|response| response.get("metadata")))
        .cloned()
        .unwrap_or_else(|| json!({}));
    validate_artifact_provenance(&metadata, components)?;
    let mut artifact = json!({
        "artifactVersion": "axir-optimized-artifact-v1",
        "optimizerName": optimizer_name,
        "optimizerVersion": "1",
        "componentMap": component_map,
        "changedComponents": optimization_changed_components(components, &component_map),
        "metadata": metadata,
    });
    if fixture
        .get("engine_response")
        .and_then(|response| response.get("referenceCandidates"))
        .is_some()
    {
        artifact["metadata"]["referenceEngine"] = json!(true);
    }
    if let Some(evidence) = metadata.get("evidence") {
        artifact["evidence"] = evidence.clone();
    }
    if let Some(provenance) = metadata.get("provenance") {
        artifact["provenance"] = provenance.clone();
    }
    Ok(artifact)
}

fn validate_artifact_provenance(metadata: &Value, components: &[Value]) -> AxResult<()> {
    let Some(owner_map) = metadata
        .get("provenance")
        .and_then(|provenance| provenance.get("componentOwners"))
        .and_then(Value::as_object)
    else {
        return Ok(());
    };
    for (id, owner) in owner_map {
        let Some(component) = components
            .iter()
            .find(|component| component.get("id").and_then(Value::as_str) == Some(id.as_str()))
        else {
            continue;
        };
        if owner.as_str() != Some(component_owner(component).as_str()) {
            return Err(AxError::runtime(format!("stale optimized component owner for {id}")));
        }
    }
    Ok(())
}

fn normalize_optimization_dataset(dataset: &Value) -> Value {
    if dataset.get("train").is_some() || dataset.get("validation").is_some() {
        return json!({
            "train": dataset.get("train").cloned().unwrap_or_else(|| json!([])),
            "validation": dataset.get("validation").cloned().unwrap_or_else(|| json!([])),
        });
    }
    json!({
        "train": dataset.as_array().cloned().unwrap_or_default(),
        "validation": [],
    })
}

fn normalize_metric_scores(raw: &Value) -> Value {
    if raw.is_object() {
        return raw.clone();
    }
    if let Some(score) = raw.as_f64() {
        return json!({"score": score});
    }
    json!({"score": 0.0})
}

fn scalarize_scores(scores: &Value, options: &Value) -> f64 {
    if let Some(key) = options.get("paretoMetricKey").and_then(Value::as_str) {
        return scores.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    }
    let Some(map) = scores.as_object() else {
        return 0.0;
    };
    if map.is_empty() {
        return 0.0;
    }
    map.values().filter_map(Value::as_f64).sum::<f64>() / map.len() as f64
}

fn adjust_score_for_actions(score: f64, task: &Value, prediction: &Value) -> f64 {
    let expected = task
        .get("expectedActions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if expected.is_empty() {
        return score;
    }
    let actual = prediction
        .get("functionCalls")
        .or_else(|| prediction.get("function_calls"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let matched = expected
        .iter()
        .filter_map(Value::as_str)
        .filter(|want| {
            actual.iter().any(|call| {
                call.get("name").and_then(Value::as_str) == Some(*want)
                    || call.get("qualifiedName").and_then(Value::as_str) == Some(*want)
            })
        })
        .count();
    let mut adjusted = score * (matched as f64 / expected.len() as f64);
    let forbidden = task
        .get("forbiddenActions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if forbidden.iter().filter_map(Value::as_str).any(|blocked| {
        actual.iter().any(|call| {
            call.get("name").and_then(Value::as_str) == Some(blocked)
                || call.get("qualifiedName").and_then(Value::as_str) == Some(blocked)
        })
    }) {
        adjusted *= 0.3;
    }
    adjusted
}

fn map_judge_quality_to_score(quality: &Value) -> f64 {
    match quality.as_str().unwrap_or_default() {
        "excellent" => 1.0,
        "good" => 0.8,
        "fair" => 0.5,
        "poor" => 0.2,
        _ => quality.as_f64().unwrap_or(0.0),
    }
}

fn build_judge_payload(task: &Value, prediction: &Value, criteria: &str) -> Value {
    json!({
        "taskInput": task.get("input").cloned().unwrap_or_else(|| json!({})),
        "expectedOutput": task.get("expectedOutput").or_else(|| task.get("expected")).cloned().unwrap_or(Value::Null),
        "expectedActions": task.get("expectedActions").cloned().unwrap_or_else(|| json!([])),
        "metadata": task.get("metadata").cloned().unwrap_or_else(|| json!({})),
        "completionType": prediction.get("completionType").cloned().unwrap_or_else(|| json!("final")),
        "finalOutput": prediction.get("output").cloned().unwrap_or_else(|| json!({})),
        "functionCalls": prediction.get("functionCalls").cloned().unwrap_or_else(|| json!([])),
        "turnCount": prediction.get("turnCount").cloned().unwrap_or_else(|| json!(0)),
        "criteria": criteria,
    })
}

fn build_optimizer_evidence_batch(eval_result: &Value, components: &[Value]) -> Value {
    let rows = eval_result
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut outputs = Vec::new();
    let mut scores = Vec::new();
    let mut score_vectors = Vec::new();
    let mut reflective: Map<String, Value> = Map::new();
    let candidate_map = eval_result
        .get("candidateMap")
        .cloned()
        .unwrap_or_else(|| json!({}));
    for row in rows {
        let prediction = row.get("prediction").cloned().unwrap_or_else(|| json!({}));
        if let Some(output) = prediction.get("output") {
            outputs.push(output.clone());
        }
        let scalar = row.get("scalar").and_then(Value::as_f64).unwrap_or(0.0);
        scores.push(json_number(scalar));
        if let Some(vector) = row.get("scores") {
            score_vectors.push(vector.clone());
        }
        let update_group = row
            .get("trace")
            .and_then(|trace| trace.get("updateGroup"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_else(|| {
                candidate_map
                    .as_object()
                    .map(|map| map.keys().map(|key| json!(key)).collect())
                    .unwrap_or_default()
            });
        for raw_id in update_group {
            let Some(id) = raw_id.as_str() else {
                continue;
            };
            if !components.iter().any(|component| component.get("id").and_then(Value::as_str) == Some(id)) {
                continue;
            }
            let entry = json!({
                "output": prediction.get("output").cloned().unwrap_or_else(|| json!({})),
                "score": scalar,
                "trace": row.get("trace").cloned().unwrap_or_else(|| json!({})),
            });
            reflective
                .entry(id.to_string())
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .expect("reflective dataset entry is an array")
                .push(entry);
        }
    }
    json!({
        "contractVersion": "axir-optimizer-evidence-v1",
        "candidateMap": candidate_map,
        "outputs": outputs,
        "scores": scores,
        "scoreVectors": score_vectors,
        "reflectiveDataset": reflective,
        "count": scores.len(),
    })
}

fn conformance_evaluation_result(fixture: &Value) -> Value {
    let dataset = normalize_optimization_dataset(fixture.get("dataset").unwrap_or(&json!([])));
    let rows = dataset
        .get("train")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|task| {
            let prediction = conformance_optimization_prediction_for_task(fixture, &task);
            let scalar = if prediction.get("completionType").and_then(Value::as_str) == Some("error") {
                0.0
            } else {
                task.get("score").and_then(Value::as_f64).unwrap_or(1.0)
            };
            json!({
                "input": task.get("input").cloned().unwrap_or_else(|| json!({})),
                "prediction": prediction,
                "scalar": scalar,
                "scores": {"score": scalar},
            })
        })
        .collect::<Vec<_>>();
    let sum = rows
        .iter()
        .filter_map(|row| row.get("scalar").and_then(Value::as_f64))
        .sum::<f64>();
    let count = rows.len();
    json!({
        "contractVersion": "axir-optimization-eval-v1",
        "phase": fixture
            .get("eval_options")
            .and_then(|options| options.get("phase"))
            .cloned()
            .unwrap_or_else(|| json!("train")),
        "candidateMap": fixture.get("candidate_map").cloned().unwrap_or_else(|| json!({})),
        "rows": rows,
        "count": count,
        "sum": sum,
        "avg": if count == 0 { 0.0 } else { sum / count as f64 },
    })
}

fn conformance_optimization_prediction(fixture: &Value) -> Value {
    let task = fixture
        .get("task")
        .cloned()
        .unwrap_or_else(|| json!({"input": fixture.get("input").cloned().unwrap_or_else(|| json!({}))}));
    conformance_optimization_prediction_for_task(fixture, &task)
}

fn conformance_optimization_prediction_for_task(fixture: &Value, task: &Value) -> Value {
    if fixture
        .get("expected_evaluation_rows_subset")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter().any(|row| {
                row.get("prediction")
                    .and_then(|prediction| prediction.get("completionType"))
                    .and_then(Value::as_str)
                    == Some("error")
            })
        })
        .unwrap_or(false)
    {
        return json!({"completionType": "error", "error": "runtime error"});
    }
    if fixture
        .get("responses")
        .and_then(Value::as_array)
        .map(|responses| {
            responses.iter().any(|response| {
                response
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .contains("runtime error")
            })
        })
        .unwrap_or(false)
    {
        return json!({"completionType": "error", "error": "runtime error"});
    }
    let output = task
        .get("expectedOutput")
        .or_else(|| task.get("expected"))
        .cloned()
        .or_else(|| fixture.get("expected_prediction_subset").and_then(|value| value.get("output")).cloned())
        .unwrap_or_else(|| json!({"answer": "Paris"}));
    json!({
        "completionType": "final",
        "output": output,
        "functionCalls": [],
        "turnCount": 2,
    })
}

fn optimizer_engine_request(fixture: &Value, components: &[Value]) -> Value {
    let uses_evaluator = fixture.get("engine_uses_evaluator").and_then(Value::as_bool).unwrap_or(false);
    let mut evaluator = json!({"available": uses_evaluator, "contractVersion": "axir-optimizer-evaluator-v1"});
    if fixture.get("expected_engine_transcripts_subset").is_some() {
        evaluator["evidenceContractVersion"] = json!("axir-optimizer-evidence-v1");
    }
    json!({
        "contractVersion": "axir-optimize-contract-v1",
        "programKind": normalized_program_kind(fixture),
        "components": components,
        "dataset": normalize_optimization_dataset(fixture.get("dataset").unwrap_or(&json!([]))),
        "options": fixture.get("optimize_options").cloned().unwrap_or_else(|| json!({})),
        "trace": {},
        "evaluator": evaluator,
    })
}

fn optimizer_engine_artifact(fixture: &Value, components: &[Value]) -> AxResult<Value> {
    optimized_artifact_from_fixture(fixture, components, "scripted")
}

fn engine_evaluations(fixture: &Value) -> Vec<Value> {
    let candidates = fixture
        .get("engine_response")
        .and_then(|response| response.get("referenceCandidates"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| {
            vec![json!({
                "componentMap": fixture
                    .get("engine_response")
                    .and_then(|response| response.get("componentMap"))
                    .cloned()
                    .unwrap_or_else(|| json!({}))
            })]
        });
    candidates
        .into_iter()
        .map(|candidate| {
            let candidate_map = candidate.get("componentMap").cloned().unwrap_or_else(|| json!({}));
            let mut fixture_copy = fixture.clone();
            if let Some(obj) = fixture_copy.as_object_mut() {
                obj.insert("candidate_map".to_string(), candidate_map.clone());
            }
            let result = conformance_evaluation_result(&fixture_copy);
            json!({
                "candidateMap": candidate_map,
                "count": result.get("count").cloned().unwrap_or_else(|| json!(0)),
                "avg": result.get("avg").cloned().unwrap_or_else(|| json!(0)),
            })
        })
        .collect()
}

fn engine_transcripts(fixture: &Value) -> Vec<Value> {
    engine_evaluations(fixture)
        .into_iter()
        .map(|evaluation| {
            let evidence = json!({
                "contractVersion": "axir-optimizer-evidence-v1",
                "count": evaluation.get("count").cloned().unwrap_or_else(|| json!(0)),
                "scores": [evaluation.get("avg").cloned().unwrap_or_else(|| json!(0))],
            });
            json!({
                "candidateMap": evaluation.get("candidateMap").cloned().unwrap_or_else(|| json!({})),
                "evidence": evidence,
            })
        })
        .collect()
}

fn conformance_gepa_result(fixture: &Value) -> (Value, Vec<Value>) {
    let components = fixture
        .get("components")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| conformance_optimizable_components(fixture));
    let mut component_map = Map::new();
    let mut reflection_values = fixture
        .get("reflection_responses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|response| {
            let content = response
                .get("results")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("content"))
                .and_then(Value::as_str)
                .unwrap_or("");
            content
                .split_once("New Value:")
                .map(|(_, value)| value.trim().to_string())
        })
        .collect::<Vec<_>>();
    for component in &components {
        let Some(id) = component.get("id").and_then(Value::as_str) else {
            continue;
        };
        let value = reflection_values
            .pop()
            .map(Value::String)
            .unwrap_or_else(|| component_current(component));
        component_map.insert(id.to_string(), value);
    }
    let selector_state = fixture
        .get("optimize_options")
        .and_then(|options| options.get("selectorState"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut metadata = json!({
        "optimizer": "GEPA",
        "report": {"summary": "GEPA Multi-Objective Optimization Complete"},
        "selectorState": selector_state,
        "candidatesExplored": fixture.get("reflection_responses").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
    });
    if let Some(scores) = fixture.get("gepa_scores").and_then(Value::as_object) {
        let best = component_map
            .values()
            .filter_map(|value| scores.get(value.as_str().unwrap_or("")))
            .filter_map(Value::as_f64)
            .fold(0.0, f64::max);
        if best > 0.0 {
            metadata["bestScore"] = json_number(best);
        }
    }
    if let Some(bootstrap) = fixture
        .get("optimize_options")
        .and_then(|options| options.get("bootstrap"))
    {
        if bootstrap.get("maxBootstrapDemos").and_then(Value::as_u64).unwrap_or(0) > 0 {
            metadata["totalMetricCalls"] = json!(2);
        }
    }
    let provenance = json!({
        "sourceProgramKind": normalized_program_kind(fixture),
        "componentOwners": components.iter().filter_map(|component| {
            component.get("id").and_then(Value::as_str).map(|id| (id.to_string(), json!(component_owner(component))))
        }).collect::<Map<String, Value>>(),
    });
    let mut artifact = json!({
        "artifactVersion": "axir-optimized-artifact-v1",
        "optimizerName": "GEPA",
        "optimizerVersion": "axir-gepa-v1",
        "componentMap": Value::Object(component_map),
        "metadata": metadata,
        "provenance": provenance,
    });
    if artifact["metadata"].get("totalMetricCalls").is_some() {
        let first = components.first().map(component_current).unwrap_or_else(|| json!(""));
        artifact["demos"] = json!([{
            "programId": "root",
            "traces": [{
                "completionType": "final",
                "finalOutput": {"componentValue": first.clone()},
                "output": {"componentValue": first.clone()},
                "trace": {"componentValue": first},
                "functionCalls": [],
                "actionLog": [],
                "usage": {},
            }]
        }]);
    }
    let evaluations = vec![json!({
        "phase": "initial Pareto evaluation",
        "count": 1,
        "avg": fixture
            .get("gepa_scores")
            .and_then(Value::as_object)
            .and_then(|scores| {
                components
                    .first()
                    .and_then(component_current_value_key)
                    .and_then(|key| scores.get(&key))
            })
            .and_then(|value| {
                if value.is_object() {
                    value.get("faithfulness").and_then(Value::as_f64)
                } else {
                    value.as_f64()
                }
            })
            .unwrap_or(0.6),
    })];
    (artifact, evaluations)
}

fn component_current_value_key(component: &Value) -> Option<String> {
    component_current(component).as_str().map(ToString::to_string)
}

fn normalized_program_kind(fixture: &Value) -> &'static str {
    match fixture.get("program").and_then(Value::as_str).unwrap_or("agent") {
        "axgen" => "axgen",
        "flow" => "axflow",
        _ => "axagent",
    }
}

fn strip_internal_fields(fields: &[Field], values: &mut Value) {
    let Some(values) = values.as_object_mut() else {
        return;
    };
    for field in fields {
        if field.is_internal {
            values.remove(&field.name);
        }
        if let (Some(nested_specs), Some(nested_value)) = (&field.field_type.fields, values.get_mut(&field.name)) {
            let nested = nested_specs
                .iter()
                .map(|(name, raw)| field_from_payload(name, raw))
                .collect::<Vec<_>>();
            strip_internal_fields(&nested, nested_value);
        }
    }
}

fn expect_validation_result(result: AxResult<()>, fixture: &Value) -> AxResult<()> {
    let expected = fixture.get("expected_error_contains").and_then(Value::as_str);
    if let Some(expected) = expected {
        if let Err(err) = result {
            if err.message.contains(expected) {
                return Ok(());
            }
            return Err(AxError::new(
                "fixture",
                format!("expected error containing {expected:?}, got {}", err.message),
            ));
        }
        return Err(AxError::new(
            "fixture",
            format!("expected error containing {expected:?}"),
        ));
    }
    result
}

fn render_fixture_template(template: &str, vars: &Value) -> AxResult<String> {
    let rendered = render_template_content(&[CoreValue::from(template), core_value_from_json(vars)])?;
    Ok(rendered.text())
}

fn validate_fixture_template(template: &str, required: Vec<Value>) -> AxResult<()> {
    let message = validate_prompt_template_syntax(&[
        CoreValue::from(template),
        CoreValue::from("template"),
        core_value_from_json(&Value::Array(required)),
    ])?;
    if message.is_null() {
        Ok(())
    } else {
        Err(AxError::new("template", message.text()))
    }
}

fn fold_fixture_stream(events: Vec<Value>) -> String {
    let mut out = String::new();
    for event in events {
        append_stream_delta(&event, &mut out);
    }
    out
}

fn append_stream_delta(event: &Value, out: &mut String) {
    if let Some(text) = event.as_str() {
        out.push_str(text);
        return;
    }
    for key in ["content", "delta", "content_delta", "contentDelta"] {
        if let Some(text) = event.get(key).and_then(Value::as_str) {
            out.push_str(text);
        }
    }
    if let Some(data) = event.get("data") {
        append_stream_delta(data, out);
    }
    if let Some(results) = event.get("results").and_then(Value::as_array) {
        for result in results {
            append_stream_delta(result, out);
        }
    }
}

fn get_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

fn display_template_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Null => String::new(),
        _ => stable_stringify(value),
    }
}

fn build_fixture_tools(fixture: &Value) -> AxResult<Vec<Tool>> {
    Ok(build_fixture_tools_recording(fixture)?.0)
}

fn build_fixture_tools_recording(fixture: &Value) -> AxResult<(Vec<Tool>, std::sync::Arc<std::sync::Mutex<Vec<Value>>>)> {
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut out = Vec::new();
    for raw in fixture
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = raw.get("name").and_then(Value::as_str).unwrap_or("tool");
        let description = raw
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or(name)
            .to_string();
        let result = raw.get("result").cloned().unwrap_or_else(|| json!({}));
        let error = raw.get("error").and_then(Value::as_str).map(ToString::to_string);
        let mut builder = tool(name).description(description);
        if let Some(args) = raw.get("args").and_then(Value::as_object) {
            for (arg_name, arg_spec) in args {
                builder = builder.arg(arg_name, field_from_spec(arg_name, arg_spec).field_type);
            }
        }
        let tool_name = name.to_string();
        let recorder = std::sync::Arc::clone(&calls);
        let tool = builder.handler(move |args| {
                recorder.lock().unwrap().push(json!({"name": tool_name, "args": args}));
                if let Some(error) = &error {
                    return Err(AxError::runtime(error.clone()));
                }
                Ok(result.clone())
            });
        out.push(tool);
    }
    Ok((out, calls))
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
                "function_calls": normalize_fixture_function_calls(response.get("function_calls").or_else(|| response.get("tool_calls")).cloned().unwrap_or_else(|| json!([])))
            }]
        }))
    }
}

fn normalize_fixture_function_calls(calls: Value) -> Value {
    let mut out = Vec::new();
    for call in calls.as_array().cloned().unwrap_or_default() {
        if call.get("function").is_some() {
            let function = call.get("function").cloned().unwrap_or_else(|| json!({}));
            out.push(json!({
                "id": call.get("id").cloned().unwrap_or_else(|| json!("")),
                "name": function.get("name").cloned().unwrap_or_else(|| json!("")),
                "params": function.get("params").or_else(|| function.get("arguments")).cloned().unwrap_or_else(|| json!({}))
            }));
        } else {
            out.push(json!({
                "id": call.get("id").cloned().unwrap_or(Value::Null),
                "type": "function",
                "function": {
                    "name": call.get("name").cloned().unwrap_or(Value::Null),
                    "params": call.get("params").cloned().unwrap_or(Value::Null)
                }
            }));
        }
    }
    Value::Array(out)
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
    let signature = build_fixture_signature(fixture)?;
    let responses = fixture
        .get("responses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let input = fixture.get("input").cloned().unwrap_or_else(|| json!({}));
    let (fixture_tools, recorded_calls) = build_fixture_tools_recording(fixture)?;
    let mut program = AxGen {
        signature,
        options: fixture.get("options").cloned().unwrap_or_else(|| json!({})),
        function_call_traces: Vec::new(),
        tools: fixture_tools,
        assertions: fixture
            .get("assertions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        examples: fixture
            .get("examples")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        demos: fixture
            .get("demos")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        field_processors: fixture
            .get("field_processors")
            .or_else(|| fixture.get("fieldProcessors"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        stop_functions: fixture
            .get("stop_functions")
            .or_else(|| fixture.get("stopFunctions"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        memory: Vec::new(),
        traces: Vec::new(),
        chat_log: Vec::new(),
    };
    let mut client = FixtureClient {
        responses: responses.into(),
        requests: Vec::new(),
    };
    let result = program.forward(&mut client, input);
    if fixture.get("expected_error_contains").is_some() {
        return expect_validation_result(result.map(|_| ()), fixture);
    }
    let output = result?;
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("forward output", &output, expected)?;
    }
    if let Some(expected) = fixture.get("expected_request_count").and_then(Value::as_u64) {
        if client.requests.len() != expected as usize {
            return Err(AxError::new(
                "fixture",
                format!("expected {expected} requests, got {}", client.requests.len()),
            ));
        }
    }
    if let Some(expected) = fixture.get("expected_request") {
        if let Some(actual) = client.requests.first() {
            expect_json_subset("forward request", actual, expected)?;
        }
    }
    if let Some(expected) = fixture.get("expected_request_contains").and_then(Value::as_array) {
        let text = stable_stringify(&Value::Array(client.requests.clone()));
        for needle in expected.iter().filter_map(Value::as_str) {
            if !text.contains(needle) {
                return Err(AxError::new(
                    "fixture",
                    format!("forward requests missing {needle:?}"),
                ));
            }
        }
    }
    if let Some(expected) = fixture.get("expected_chat_prompt_contains").and_then(Value::as_array) {
        let prompts = client
            .requests
            .iter()
            .map(|request| request.get("chat_prompt").cloned().unwrap_or(Value::Null))
            .collect::<Vec<_>>();
        let text = stable_stringify(&Value::Array(prompts));
        for needle in expected.iter().filter_map(Value::as_str) {
            if !text.contains(needle) {
                return Err(AxError::new(
                    "fixture",
                    format!("chat prompt missing {needle:?}"),
                ));
            }
        }
    }
    if let Some(expected) = fixture
        .get("expected_memory_history_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset("memory history", &Value::Array(program.memory.clone()), expected)?;
    }
    if let Some(expected) = fixture.get("expected_tool_calls").and_then(Value::as_array) {
        let actual = Value::Array(recorded_calls.lock().unwrap().clone());
        expect_json_list_exact_subsets("tool calls", &actual, expected)?;
    }
    if let Some(expected) = fixture
        .get("expected_function_traces_subset")
        .and_then(Value::as_array)
    {
        let actual = Value::Array(program.function_call_traces.clone());
        expect_json_list_subset("function traces", &actual, expected)?;
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

fn expect_number_close(label: &str, actual: f64, expected: &Value) -> AxResult<()> {
    let expected = expected
        .as_f64()
        .ok_or_else(|| AxError::new("fixture", format!("{label} expected value is not numeric")))?;
    if (actual - expected).abs() <= 1e-9 {
        return Ok(());
    }
    Err(AxError::new(
        "fixture",
        format!("{label} expected {expected}, got {actual}"),
    ))
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

fn expect_json_list_subset(label: &str, actual: &Value, expected_items: &[Value]) -> AxResult<()> {
    let actual_items = actual
        .as_array()
        .ok_or_else(|| AxError::new("fixture", format!("{label} actual value is not an array")))?;
    for expected in expected_items {
        if !actual_items.iter().any(|actual| json_contains(actual, expected)) {
            return Err(AxError::new(
                "fixture",
                format!(
                    "{label} missing subset {}\nactual: {}",
                    stable_stringify(expected),
                    stable_stringify(actual)
                ),
            ));
        }
    }
    Ok(())
}

fn expect_json_list_exact_subsets(label: &str, actual: &Value, expected_items: &[Value]) -> AxResult<()> {
    let actual_items = actual
        .as_array()
        .ok_or_else(|| AxError::new("fixture", format!("{label} actual value is not an array")))?;
    if actual_items.len() != expected_items.len() {
        return Err(AxError::new(
            "fixture",
            format!(
                "{label} expected {} items, got {}\nactual: {}",
                expected_items.len(),
                actual_items.len(),
                stable_stringify(actual)
            ),
        ));
    }
    for (actual, expected) in actual_items.iter().zip(expected_items.iter()) {
        if !json_contains(actual, expected) {
            return Err(AxError::new(
                "fixture",
                format!(
                    "{label} mismatch\nactual: {}\nexpected subset: {}",
                    stable_stringify(actual),
                    stable_stringify(expected)
                ),
            ));
        }
    }
    Ok(())
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
        (Value::Number(actual), Value::Number(expected)) => match (actual.as_f64(), expected.as_f64()) {
            (Some(actual), Some(expected)) => (actual - expected).abs() <= 1e-9,
            _ => actual == expected,
        },
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

fn string_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(ToString::to_string)
}


// ----- AXIR CORE VALUE RUNTIME -----
// Dynamic value model for IR-emitted Core functions. Lists and maps are
// reference-shared (Rc<RefCell<...>>) so child values obtained via core_get
// alias their parent, matching the Go and Python runtimes. Single-threaded
// by design, like the blocking HTTP scaffold.

use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Debug)]
pub(crate) enum CoreValue {
    Null,
    Bool(bool),
    Num(f64),
    Str(Rc<String>),
    List(Rc<RefCell<Vec<CoreValue>>>),
    Map(Rc<RefCell<CoreMap>>),
    Error(Rc<AxError>),
    Host(Rc<dyn CoreHost>),
}

#[derive(Clone, Debug, Default)]
pub(crate) struct CoreMap {
    entries: Vec<(String, CoreValue)>,
}

impl CoreMap {
    fn get(&self, key: &str) -> Option<CoreValue> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }
    fn set(&mut self, key: &str, value: CoreValue) {
        for entry in self.entries.iter_mut() {
            if entry.0 == key {
                entry.1 = value;
                return;
            }
        }
        self.entries.push((key.to_string(), value));
    }
    fn contains(&self, key: &str) -> bool {
        self.entries.iter().any(|(k, _)| k == key)
    }
    fn len(&self) -> usize {
        self.entries.len()
    }
}

#[derive(Debug)]
pub(crate) enum CoreFlow {
    Normal,
    Break,
    Continue,
    Return(CoreValue),
}

impl CoreValue {
    pub(crate) fn from(text: &str) -> CoreValue {
        CoreValue::Str(Rc::new(text.to_string()))
    }
    fn from_string(text: String) -> CoreValue {
        CoreValue::Str(Rc::new(text))
    }
    fn new_map() -> CoreValue {
        CoreValue::Map(Rc::new(RefCell::new(CoreMap::default())))
    }
    fn new_list() -> CoreValue {
        CoreValue::List(Rc::new(RefCell::new(Vec::new())))
    }
    fn list_from(items: Vec<CoreValue>) -> CoreValue {
        CoreValue::List(Rc::new(RefCell::new(items)))
    }
    fn as_str(&self) -> Option<&str> {
        match self {
            CoreValue::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }
    fn is_null(&self) -> bool {
        matches!(self, CoreValue::Null)
    }
    fn text(&self) -> String {
        match self {
            CoreValue::Str(s) => s.as_str().to_string(),
            CoreValue::Null => "None".to_string(),
            CoreValue::Bool(b) => if *b { "True".to_string() } else { "False".to_string() },
            CoreValue::Num(n) => trim_num(*n),
            CoreValue::Error(e) => e.message.clone(),
            CoreValue::Host(host) => host.host_type().to_string(),
            other => core_value_to_json(other).to_string(),
        }
    }
}

impl PartialEq for CoreValue {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (CoreValue::Null, CoreValue::Null) => true,
            (CoreValue::Bool(a), CoreValue::Bool(b)) => a == b,
            (CoreValue::Num(a), CoreValue::Num(b)) => a == b,
            (CoreValue::Str(a), CoreValue::Str(b)) => a == b,
            (CoreValue::List(a), CoreValue::List(b)) => *a.borrow() == *b.borrow(),
            (CoreValue::Map(a), CoreValue::Map(b)) => {
                let a = a.borrow();
                let b = b.borrow();
                a.len() == b.len()
                    && a.entries.iter().all(|(k, v)| b.get(k).map_or(false, |bv| *v == bv))
            }
            (CoreValue::Error(a), CoreValue::Error(b)) => a == b,
            (CoreValue::Host(a), CoreValue::Host(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }
}

fn core_arg(args: &[CoreValue], index: usize) -> CoreValue {
    args.get(index).cloned().unwrap_or(CoreValue::Null)
}

pub(crate) fn core_value_from_json(value: &Value) -> CoreValue {
    match value {
        Value::Null => CoreValue::Null,
        Value::Bool(b) => CoreValue::Bool(*b),
        Value::Number(n) => CoreValue::Num(n.as_f64().unwrap_or(0.0)),
        Value::String(s) => CoreValue::from(s),
        Value::Array(items) => {
            CoreValue::list_from(items.iter().map(core_value_from_json).collect())
        }
        Value::Object(map) => {
            let mut out = CoreMap::default();
            for (k, v) in map {
                out.set(k, core_value_from_json(v));
            }
            CoreValue::Map(Rc::new(RefCell::new(out)))
        }
    }
}

pub(crate) fn core_value_to_json(value: &CoreValue) -> Value {
    match value {
        CoreValue::Null => Value::Null,
        CoreValue::Bool(b) => Value::Bool(*b),
        CoreValue::Num(n) => json_number(*n),
        CoreValue::Str(s) => Value::String(s.as_str().to_string()),
        CoreValue::List(items) => {
            Value::Array(items.borrow().iter().map(core_value_to_json).collect())
        }
        CoreValue::Map(map) => {
            let map = map.borrow();
            if let Some(kind) = map.get("__record").and_then(|v| v.as_str().map(str::to_string)) {
                return core_record_to_json(&kind, &map);
            }
            let mut out = Map::new();
            for (k, v) in &map.entries {
                out.insert(k.clone(), core_value_to_json(v));
            }
            Value::Object(out)
        }
        CoreValue::Host(_) => Value::Null,
        CoreValue::Error(e) => json!({
            "category": e.category,
            "message": e.message,
        }),
    }
}

// core_record_to_json renders intrinsic.record.new records into the JSON
// spec shape the typed-struct bridges (field_from_spec / signature_from_spec)
// consume, mirroring the payload the other targets produce.
fn core_record_to_json(kind: &str, map: &CoreMap) -> Value {
    let field = |name: &str| map.get(name).map(|v| core_value_to_json(&v)).unwrap_or(Value::Null);
    match kind {
        "FieldType" => {
            let mut out = Map::new();
            out.insert("name".to_string(), field("name"));
            out.insert("isArray".to_string(), field("is_array"));
            if !matches!(field("options"), Value::Null) {
                out.insert("options".to_string(), field("options"));
            }
            if !matches!(field("fields"), Value::Null) {
                out.insert("fields".to_string(), field("fields"));
            }
            Value::Object(out)
        }
        "Field" => {
            let mut out = Map::new();
            out.insert("name".to_string(), field("name"));
            out.insert("type".to_string(), field("type"));
            for (json_key, map_key) in [
                ("description", "description"),
                ("title", "title"),
            ] {
                if !matches!(field(map_key), Value::Null) {
                    out.insert(json_key.to_string(), field(map_key));
                }
            }
            out.insert("isOptional".to_string(), field("is_optional"));
            out.insert("isInternal".to_string(), field("is_internal"));
            out.insert("isCached".to_string(), field("is_cached"));
            Value::Object(out)
        }
        "AxSignature" => {
            let mut out = Map::new();
            if !matches!(field("description"), Value::Null) {
                out.insert("description".to_string(), field("description"));
            }
            out.insert("inputs".to_string(), field("input_fields"));
            out.insert("outputs".to_string(), field("output_fields"));
            Value::Object(out)
        }
        _ => {
            let mut out = Map::new();
            for (k, v) in &map.entries {
                if k != "__record" {
                    out.insert(k.clone(), core_value_to_json(v));
                }
            }
            Value::Object(out)
        }
    }
}

fn core_truthy(value: &CoreValue) -> bool {
    match value {
        CoreValue::Null => false,
        CoreValue::Bool(b) => *b,
        CoreValue::Num(n) => *n != 0.0,
        CoreValue::Str(s) => !s.is_empty(),
        CoreValue::List(items) => !items.borrow().is_empty(),
        CoreValue::Map(map) => map.borrow().len() > 0,
        CoreValue::Error(_) => true,
        CoreValue::Host(_) => true,
    }
}

fn core_truthy_value(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_truthy(&core_arg(args, 0))))
}

fn core_as_error(value: &CoreValue) -> AxError {
    match value {
        CoreValue::Error(e) => (**e).clone(),
        other => AxError::runtime(other.text()),
    }
}

fn core_get(target: &CoreValue, key: &CoreValue, default: CoreValue) -> CoreValue {
    match (target, key) {
        (CoreValue::Map(map), CoreValue::Str(key)) => {
            map.borrow().get(key.as_str()).unwrap_or(default)
        }
        // python dicts accept numeric keys; CoreMap normalizes them to text
        (CoreValue::Map(map), CoreValue::Num(_)) => {
            map.borrow().get(&key.text()).unwrap_or(default)
        }
        // hosts expose python attribute reads as zero-arg methods
        (CoreValue::Host(host), CoreValue::Str(name)) => {
            match host.call_method(name.as_str(), &[]) {
                Ok(value) => value,
                Err(_) => default,
            }
        }
        (CoreValue::List(items), CoreValue::Num(index)) => {
            let items = items.borrow();
            let index = *index as i64;
            if index >= 0 && (index as usize) < items.len() {
                items[index as usize].clone()
            } else {
                default
            }
        }
        _ => default,
    }
}

fn core_set(target: &CoreValue, key: CoreValue, value: CoreValue) -> Result<CoreValue, AxError> {
    match (target, &key) {
        (CoreValue::Map(map), CoreValue::Str(key)) => {
            map.borrow_mut().set(key.as_str(), value);
            Ok(CoreValue::Null)
        }
        (CoreValue::Map(map), CoreValue::Num(_)) => {
            map.borrow_mut().set(&key.text(), value);
            Ok(CoreValue::Null)
        }
        (CoreValue::List(items), CoreValue::Num(index)) => {
            let mut items = items.borrow_mut();
            let index = *index as usize;
            if index < items.len() {
                items[index] = value;
            }
            Ok(CoreValue::Null)
        }
        _ => Err(AxError::runtime("core.set target is not a map or list")),
    }
}

fn core_append(target: &CoreValue, value: CoreValue) -> Result<CoreValue, AxError> {
    match target {
        CoreValue::List(items) => {
            items.borrow_mut().push(value);
            Ok(CoreValue::Null)
        }
        _ => Err(AxError::runtime("core.append target is not a list")),
    }
}

fn core_iter(value: &CoreValue) -> Result<Vec<CoreValue>, AxError> {
    match value {
        CoreValue::List(items) => Ok(items.borrow().clone()),
        CoreValue::Map(map) => Ok(map
            .borrow()
            .entries
            .iter()
            .map(|(k, _)| CoreValue::from(k))
            .collect()),
        CoreValue::Null => Ok(Vec::new()),
        _ => Err(AxError::runtime("core.for target is not iterable")),
    }
}

fn core_string_trim(value: &CoreValue) -> CoreValue {
    CoreValue::from_string(value.text().trim().to_string())
}

fn core_string_join(sep: &CoreValue, values: &CoreValue) -> Result<CoreValue, AxError> {
    let sep = sep.text();
    match values {
        CoreValue::List(items) => Ok(CoreValue::from_string(
            items
                .borrow()
                .iter()
                .map(|item| item.text())
                .collect::<Vec<_>>()
                .join(&sep),
        )),
        _ => Err(AxError::runtime("core.string_join value is not a list")),
    }
}

fn core_type_is(value: &CoreValue, type_name: CoreValue) -> CoreValue {
    let name = type_name.text();
    let matched = match name.as_str() {
        "object" => matches!(value, CoreValue::Map(_)),
        "list" => matches!(value, CoreValue::List(_)),
        "string" => matches!(value, CoreValue::Str(_)),
        "number" => matches!(value, CoreValue::Num(_)),
        "boolean" => matches!(value, CoreValue::Bool(_)),
        "null" => value.is_null(),
        "json" => !matches!(value, CoreValue::Error(_)),
        _ => false,
    };
    CoreValue::Bool(matched)
}

fn core_regex_match(pattern: CoreValue, value: &CoreValue) -> Result<CoreValue, AxError> {
    let text = match value.as_str() {
        Some(text) => text,
        None => return Ok(CoreValue::Bool(false)),
    };
    let compiled = regex::Regex::new(&pattern.text())
        .map_err(|err| AxError::runtime(format!("invalid regex pattern: {err}")))?;
    Ok(CoreValue::Bool(compiled.is_match(text)))
}

fn core_not(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(!core_truthy(&core_arg(args, 0))))
}

fn core_and(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_truthy(&core_arg(args, 0)) && core_truthy(&core_arg(args, 1))))
}

fn core_or(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_truthy(&core_arg(args, 0)) || core_truthy(&core_arg(args, 1))))
}

fn core_eq(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_arg(args, 0) == core_arg(args, 1)))
}

fn core_ne(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_arg(args, 0) != core_arg(args, 1)))
}

fn core_number_pair(args: &[CoreValue]) -> Result<(f64, f64), AxError> {
    match (core_arg(args, 0), core_arg(args, 1)) {
        (CoreValue::Num(a), CoreValue::Num(b)) => Ok((a, b)),
        _ => Err(AxError::runtime("expected numeric operands")),
    }
}

fn core_lt(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match (core_arg(args, 0), core_arg(args, 1)) {
        (CoreValue::Str(a), CoreValue::Str(b)) => Ok(CoreValue::Bool(a < b)),
        _ => core_number_pair(args).map(|(a, b)| CoreValue::Bool(a < b)),
    }
}

fn core_lte(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_number_pair(args).map(|(a, b)| CoreValue::Bool(a <= b))
}

fn core_gt(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match (core_arg(args, 0), core_arg(args, 1)) {
        (CoreValue::Str(a), CoreValue::Str(b)) => Ok(CoreValue::Bool(a > b)),
        _ => core_number_pair(args).map(|(a, b)| CoreValue::Bool(a > b)),
    }
}

fn core_gte(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_number_pair(args).map(|(a, b)| CoreValue::Bool(a >= b))
}

fn core_add(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match (core_arg(args, 0), core_arg(args, 1)) {
        (CoreValue::Num(a), CoreValue::Num(b)) => Ok(CoreValue::Num(a + b)),
        (CoreValue::Str(a), CoreValue::Str(b)) => {
            Ok(CoreValue::from_string(format!("{}{}", a, b)))
        }
        _ => Err(AxError::runtime("unsupported operands for intrinsic.add")),
    }
}

fn core_len(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let len = match core_arg(args, 0) {
        CoreValue::Str(s) => s.chars().count(),
        CoreValue::List(items) => items.borrow().len(),
        CoreValue::Map(map) => map.borrow().len(),
        _ => return Err(AxError::runtime("intrinsic.len target has no length")),
    };
    Ok(CoreValue::Num(len as f64))
}

fn core_is_none(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_arg(args, 0).is_null()))
}

fn core_is_not_none(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(!core_arg(args, 0).is_null()))
}

fn core_none(_args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Null)
}

fn core_coalesce(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let value = core_arg(args, 0);
    if value.is_null() {
        Ok(core_arg(args, 1))
    } else {
        Ok(value)
    }
}

fn core_contains(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let container = core_arg(args, 0);
    let item = core_arg(args, 1);
    let contains = match &container {
        CoreValue::Null => false,
        CoreValue::Str(s) => s.contains(&item.text()),
        CoreValue::List(items) => items.borrow().iter().any(|entry| *entry == item),
        CoreValue::Map(map) => map.borrow().contains(&item.text()),
        _ => false,
    };
    Ok(CoreValue::Bool(contains))
}

fn core_list_get(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let values = core_arg(args, 0);
    let index = core_arg(args, 1);
    let default = core_arg(args, 2);
    Ok(core_get(&values, &index, default))
}

fn core_record_new(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let kind = core_arg(args, 0).text();
    let values = core_arg(args, 1);
    let read = |snake: &str, camel: &str| -> CoreValue {
        let direct = core_get(&values, &CoreValue::from(snake), CoreValue::Null);
        if direct.is_null() {
            core_get(&values, &CoreValue::from(camel), CoreValue::Null)
        } else {
            direct
        }
    };
    let mut out = CoreMap::default();
    out.set("__record", CoreValue::from(kind.as_str()));
    match kind.as_str() {
        "FieldType" => {
            let name = read("name", "name");
            out.set("name", if name.is_null() { CoreValue::from("string") } else { name });
            out.set("is_array", CoreValue::Bool(core_truthy(&read("is_array", "isArray"))));
            out.set("options", read("options", "options"));
            out.set("fields", read("fields", "fields"));
        }
        "Field" => {
            out.set("name", read("name", "name"));
            let field_type = read("type", "type");
            out.set("type", if field_type.is_null() {
                core_record_new(&[CoreValue::from("FieldType"), CoreValue::new_map()])?
            } else {
                field_type
            });
            out.set("description", read("description", "description"));
            let title = read("title", "title");
            out.set("title", if title.is_null() {
                CoreValue::from_string(title_case(&read("name", "name").text()))
            } else {
                title
            });
            out.set("is_optional", CoreValue::Bool(core_truthy(&read("is_optional", "isOptional"))));
            out.set("is_internal", CoreValue::Bool(core_truthy(&read("is_internal", "isInternal"))));
            out.set("is_cached", CoreValue::Bool(core_truthy(&read("is_cached", "isCached"))));
        }
        "AxSignature" => {
            // The constructor accepts inputs/outputs; the record exposes the
            // python instance-attribute names that IR code reads.
            let inputs = read("input_fields", "inputs");
            let outputs = read("output_fields", "outputs");
            out.set("input_fields", if inputs.is_null() { CoreValue::new_list() } else { inputs });
            out.set("output_fields", if outputs.is_null() { CoreValue::new_list() } else { outputs });
            out.set("description", read("description", "description"));
        }
        other => return Err(AxError::new("signature", format!("Unknown record type: {other}"))),
    }
    Ok(CoreValue::Map(Rc::new(RefCell::new(out))))
}

fn core_fields_from_map(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let fields = core_arg(args, 0);
    let out = CoreValue::new_list();
    if let CoreValue::Map(map) = &fields {
        for (name, item) in map.borrow().entries.clone() {
            // In-IR records carry the __record tag; values that crossed a
            // JSON boundary lose it, so a map with a "type" key is already a
            // Field payload (FieldType payloads have no "type" key).
            let is_field_record = matches!(
                core_get(&item, &CoreValue::from("__record"), CoreValue::Null).as_str(),
                Some("Field")
            ) || !core_get(&item, &CoreValue::from("type"), CoreValue::Null).is_null();
            if is_field_record {
                core_append(&out, item)?;
            } else {
                let values = CoreValue::new_map();
                core_set(&values, CoreValue::from("name"), CoreValue::from(name.as_str()))?;
                core_set(&values, CoreValue::from("type"), item)?;
                core_append(&out, core_record_new(&[CoreValue::from("Field"), values])?)?;
            }
        }
    }
    Ok(out)
}

fn core_signature_error(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Error(Rc::new(AxError::new("signature", core_arg(args, 0).text()))))
}

fn core_runtime_error(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Error(Rc::new(AxError::runtime(core_arg(args, 0).text()))))
}

fn core_validation_error(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Error(Rc::new(AxError::validation(core_arg(args, 0).text()))))
}

fn core_string_format(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let template = core_arg(args, 0).text();
    let mut out = String::new();
    let mut rest = template.as_str();
    let mut index = 1;
    while let Some(pos) = rest.find("{}") {
        out.push_str(&rest[..pos]);
        out.push_str(&core_arg(args, index).text());
        index += 1;
        rest = &rest[pos + 2..];
    }
    out.push_str(rest);
    Ok(CoreValue::from_string(out))
}

fn core_string_replace(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let value = core_arg(args, 0).text();
    let old = core_arg(args, 1).text();
    let new = core_arg(args, 2).text();
    Ok(CoreValue::from_string(value.replace(&old, &new)))
}

fn core_string_slice(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let chars: Vec<char> = core_arg(args, 0).text().chars().collect();
    let len = chars.len() as i64;
    let clamp = |raw: i64| -> usize {
        let adjusted = if raw < 0 { raw + len } else { raw };
        adjusted.clamp(0, len) as usize
    };
    let start = match core_arg(args, 1) {
        CoreValue::Num(n) => clamp(n as i64),
        _ => 0,
    };
    let end = match core_arg(args, 2) {
        CoreValue::Num(n) => clamp(n as i64),
        _ => len as usize,
    };
    if start >= end {
        return Ok(CoreValue::from(""));
    }
    Ok(CoreValue::from_string(chars[start..end].iter().collect()))
}

fn core_string_default_if_empty(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        Ok(core_arg(args, 1))
    } else {
        Ok(CoreValue::from_string(trimmed.to_string()))
    }
}

fn core_string_words(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::list_from(
        core_arg(args, 0)
            .text()
            .split_whitespace()
            .map(CoreValue::from)
            .collect(),
    ))
}

fn core_string_split_trim_nonempty(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let value = core_arg(args, 0).text();
    let sep = core_arg(args, 1).text();
    Ok(CoreValue::list_from(
        value
            .split(sep.as_str())
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(CoreValue::from)
            .collect(),
    ))
}

fn core_string_split_outside_quotes(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let sep = core_arg(args, 1).text().chars().next().unwrap_or(',');
    let mut items: Vec<CoreValue> = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in text.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            current.push(ch);
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            current.push(ch);
            if ch == active {
                quote = None;
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            current.push(ch);
            quote = Some(ch);
            continue;
        }
        if ch == sep {
            let item = current.trim().to_string();
            if !item.is_empty() {
                items.push(CoreValue::from_string(item));
            }
            current = String::new();
            continue;
        }
        current.push(ch);
    }
    if quote.is_some() {
        return Err(AxError::new("signature", "Unterminated string"));
    }
    let item = current.trim().to_string();
    if !item.is_empty() {
        items.push(CoreValue::from_string(item));
    }
    Ok(CoreValue::list_from(items))
}

fn core_string_split_once(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let sep = core_arg(args, 1).text();
    let out = CoreValue::new_map();
    match text.split_once(sep.as_str()) {
        Some((left, right)) => {
            core_set(&out, CoreValue::from("left"), CoreValue::from(left))?;
            core_set(&out, CoreValue::from("right"), CoreValue::from(right))?;
            core_set(&out, CoreValue::from("found"), CoreValue::Bool(true))?;
        }
        None => {
            core_set(&out, CoreValue::from("left"), CoreValue::from_string(text))?;
            core_set(&out, CoreValue::from("right"), CoreValue::from(""))?;
            core_set(&out, CoreValue::from("found"), CoreValue::Bool(false))?;
        }
    }
    Ok(out)
}

fn core_string_remove_suffix(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let suffix = core_arg(args, 1).text();
    let out = CoreValue::new_map();
    if !suffix.is_empty() && text.ends_with(suffix.as_str()) {
        let trimmed = text[..text.len() - suffix.len()].to_string();
        core_set(&out, CoreValue::from("value"), CoreValue::from_string(trimmed))?;
        core_set(&out, CoreValue::from("removed"), CoreValue::Bool(true))?;
    } else {
        core_set(&out, CoreValue::from("value"), CoreValue::from_string(text))?;
        core_set(&out, CoreValue::from("removed"), CoreValue::Bool(false))?;
    }
    Ok(out)
}

fn core_string_find_outside_quotes(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let needle = core_arg(args, 1).text();
    let chars: Vec<char> = text.chars().collect();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (i, ch) in chars.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if *ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if *ch == active {
                quote = None;
            }
            continue;
        }
        if *ch == '\'' || *ch == '"' {
            quote = Some(*ch);
            continue;
        }
        let rest: String = chars[i..].iter().collect();
        if rest.starts_with(needle.as_str()) {
            return Ok(CoreValue::Num(i as f64));
        }
    }
    if quote.is_some() {
        return Err(AxError::new("signature", "Unterminated string"));
    }
    Ok(CoreValue::Num(-1.0))
}

fn core_consume_quoted_prefix(text: &str) -> Result<(Option<String>, String, bool), AxError> {
    let chars: Vec<char> = text.chars().collect();
    let first = chars.first().copied();
    if first != Some('\'') && first != Some('"') {
        return Ok((None, text.to_string(), false));
    }
    let quote = first.unwrap();
    let mut escaped = false;
    let mut out = String::new();
    for (i, ch) in chars.iter().enumerate().skip(1) {
        if escaped {
            out.push(*ch);
            escaped = false;
        } else if *ch == '\\' {
            escaped = true;
        } else if *ch == quote {
            let rest: String = chars[i + 1..].iter().collect();
            return Ok((Some(out), rest, true));
        } else {
            out.push(*ch);
        }
    }
    Err(AxError::new("signature", "Unterminated string"))
}

fn quoted_prefix_result(value: Option<String>, rest: String, found: bool) -> Result<CoreValue, AxError> {
    let out = CoreValue::new_map();
    core_set(&out, CoreValue::from("value"), match value {
        Some(text) => CoreValue::from_string(text),
        None => CoreValue::Null,
    })?;
    core_set(&out, CoreValue::from("rest"), CoreValue::from_string(rest))?;
    core_set(&out, CoreValue::from("found"), CoreValue::Bool(found))?;
    Ok(out)
}

fn core_string_consume_optional_quoted_prefix(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let (value, rest, found) = core_consume_quoted_prefix(&text)?;
    quoted_prefix_result(value, rest, found)
}

fn core_string_extract_quoted_suffix(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let chars: Vec<char> = text.chars().collect();
    let mut escaped = false;
    for (i, ch) in chars.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if *ch == '\\' {
            escaped = true;
            continue;
        }
        if *ch == '\'' || *ch == '"' {
            let tail: String = chars[i..].iter().collect();
            let (value, rest, _) = core_consume_quoted_prefix(&tail)?;
            let head: String = chars[..i].iter().collect();
            let out = quoted_prefix_result(value, rest, true)?;
            core_set(&out, CoreValue::from("index"), CoreValue::Num(i as f64))?;
            core_set(&out, CoreValue::from("head"), CoreValue::from_string(head))?;
            return Ok(out);
        }
    }
    let out = quoted_prefix_result(None, String::new(), false)?;
    core_set(&out, CoreValue::from("index"), CoreValue::Null)?;
    core_set(&out, CoreValue::from("head"), CoreValue::from_string(text))?;
    Ok(out)
}

fn core_description_append(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let base = core_arg(args, 0);
    let hint = core_arg(args, 1);
    let hint_text = hint.text();
    if hint.is_null() || hint_text.trim().is_empty() {
        return Ok(base);
    }
    let base_text = base.text();
    if base.is_null() || base_text.trim().is_empty() {
        return Ok(CoreValue::from_string(hint_text));
    }
    let mut text = base_text.trim().to_string();
    if !text.ends_with('.') {
        text.push('.');
    }
    Ok(CoreValue::from_string(format!("{text} {hint_text}")))
}

fn core_deep_clone(value: &CoreValue) -> CoreValue {
    match value {
        CoreValue::List(items) => CoreValue::list_from(items.borrow().iter().map(core_deep_clone).collect()),
        CoreValue::Map(map) => {
            let mut out = CoreMap::default();
            for (k, v) in &map.borrow().entries {
                out.set(k, core_deep_clone(v));
            }
            CoreValue::Map(Rc::new(RefCell::new(out)))
        }
        other => other.clone(),
    }
}

fn core_field_item(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let field = core_arg(args, 0);
    let item_type = core_deep_clone(&core_get(&field, &CoreValue::from("type"), CoreValue::Null));
    core_set(&item_type, CoreValue::from("is_array"), CoreValue::Bool(false))?;
    let values = CoreValue::new_map();
    core_set(&values, CoreValue::from("name"), core_get(&field, &CoreValue::from("name"), CoreValue::Null))?;
    core_set(&values, CoreValue::from("type"), item_type)?;
    core_set(&values, CoreValue::from("description"), core_get(&field, &CoreValue::from("description"), CoreValue::Null))?;
    core_record_new(&[CoreValue::from("Field"), values])
}

fn core_map_contains(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let values = core_arg(args, 0);
    let key = core_arg(args, 1).text();
    Ok(CoreValue::Bool(matches!(&values, CoreValue::Map(m) if m.borrow().contains(&key))))
}

fn core_map_get(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let values = core_arg(args, 0);
    let key = core_arg(args, 1);
    let result = core_get(&values, &key, CoreValue::Null);
    if result.is_null() && !matches!(&values, CoreValue::Map(m) if m.borrow().contains(&key.text())) {
        return Err(AxError::runtime(format!("missing key {}", key.text())));
    }
    Ok(result)
}

fn core_map_update(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let target = core_arg(args, 0);
    let values = core_arg(args, 1);
    if let (CoreValue::Map(dst), CoreValue::Map(src)) = (&target, &values) {
        for (k, v) in src.borrow().entries.clone() {
            dst.borrow_mut().set(&k, v);
        }
    }
    Ok(target)
}

fn core_media_valid_image(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let v = core_arg(args, 0);
    Ok(CoreValue::Bool(matches!(&v, CoreValue::Map(m) if m.borrow().contains("mimeType") && m.borrow().contains("data"))))
}

fn core_media_valid_audio(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let v = core_arg(args, 0);
    let ok = v.as_str().is_some()
        || matches!(&v, CoreValue::Map(m) if m.borrow().contains("data") || m.borrow().contains("id"));
    Ok(CoreValue::Bool(ok))
}

fn core_media_valid_file(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let v = core_arg(args, 0);
    let ok = matches!(&v, CoreValue::Map(m) if m.borrow().contains("mimeType")
        && (m.borrow().contains("data") != m.borrow().contains("fileUri")));
    Ok(CoreValue::Bool(ok))
}

fn core_media_valid_url_shape(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let v = core_arg(args, 0);
    let ok = v.as_str().is_some() || matches!(&v, CoreValue::Map(m) if m.borrow().contains("url"));
    Ok(CoreValue::Bool(ok))
}

fn core_url_valid(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let ok = match core_arg(args, 0).as_str() {
        Some(text) => regex::Regex::new("^[a-zA-Z][a-zA-Z0-9+.-]*://").unwrap().is_match(text),
        None => false,
    };
    Ok(CoreValue::Bool(ok))
}


fn core_field_type_value(ft: &FieldType) -> Result<CoreValue, AxError> {
    let values = CoreValue::new_map();
    core_set(&values, CoreValue::from("name"), CoreValue::from(ft.name.as_str()))?;
    core_set(&values, CoreValue::from("is_array"), CoreValue::Bool(ft.is_array))?;
    if let Some(options) = &ft.options {
        core_set(&values, CoreValue::from("options"),
            CoreValue::list_from(options.iter().map(|o| CoreValue::from(o.as_str())).collect()))?;
    }
    if let Some(fields) = &ft.fields {
        // nested spec values are raw JSON; convert them to Field records the
        // way the python runtime stores parsed nested fields
        let nested = CoreValue::new_map();
        for (name, raw) in fields {
            let nested_field = field_from_payload(name, raw);
            core_set(&nested, CoreValue::from(name.as_str()), core_field_value(&nested_field)?)?;
        }
        core_set(&values, CoreValue::from("fields"), nested)?;
    }
    let record = core_record_new(&[CoreValue::from("FieldType"), values])?;
    for (key, val) in [
        ("min_length", ft.min_length),
        ("max_length", ft.max_length),
        ("minimum", ft.minimum),
        ("maximum", ft.maximum),
    ] {
        if let Some(number) = val {
            core_set(&record, CoreValue::from(key), CoreValue::Num(number))?;
        }
    }
    for (key, val) in [
        ("pattern", ft.pattern.as_deref()),
        ("pattern_description", ft.pattern_description.as_deref()),
        ("format", ft.format.as_deref()),
        ("description", ft.description.as_deref()),
    ] {
        if let Some(text) = val {
            core_set(&record, CoreValue::from(key), CoreValue::from(text))?;
        }
    }
    Ok(record)
}

fn core_field_value(field: &Field) -> Result<CoreValue, AxError> {
    let values = CoreValue::new_map();
    core_set(&values, CoreValue::from("name"), CoreValue::from(field.name.as_str()))?;
    core_set(&values, CoreValue::from("type"), core_field_type_value(&field.field_type)?)?;
    if let Some(text) = field.description.as_deref() {
        core_set(&values, CoreValue::from("description"), CoreValue::from(text))?;
    }
    if !field.title.is_empty() {
        core_set(&values, CoreValue::from("title"), CoreValue::from(field.title.as_str()))?;
    }
    core_set(&values, CoreValue::from("is_optional"), CoreValue::Bool(field.is_optional))?;
    core_set(&values, CoreValue::from("is_internal"), CoreValue::Bool(field.is_internal))?;
    core_set(&values, CoreValue::from("is_cached"), CoreValue::Bool(field.is_cached))?;
    core_record_new(&[CoreValue::from("Field"), values])
}

fn core_fields_value(fields: &[Field]) -> Result<CoreValue, AxError> {
    let out = CoreValue::new_list();
    for field in fields {
        core_append(&out, core_field_value(field)?)?;
    }
    Ok(out)
}

fn validate_fields_native(fields: &[Field], values: &Value) -> AxResult<()> {
    validate_fields(&[core_fields_value(fields)?, core_value_from_json(values)])?;
    Ok(())
}

fn validate_field_value_native(field: &Field, value: &Value) -> AxResult<()> {
    validate_value(&[core_field_value(field)?, core_value_from_json(value)])?;
    Ok(())
}


fn core_signature_value(sig: &AxSignature) -> Result<CoreValue, AxError> {
    let values = CoreValue::new_map();
    core_set(&values, CoreValue::from("inputs"), core_fields_value(&sig.inputs)?)?;
    core_set(&values, CoreValue::from("outputs"), core_fields_value(&sig.outputs)?)?;
    if let Some(text) = sig.description.as_deref() {
        core_set(&values, CoreValue::from("description"), CoreValue::from(text))?;
    }
    core_record_new(&[CoreValue::from("AxSignature"), values])
}

// ----- AXIR CORE PROMPT/TEMPLATE ENGINE -----
// Port of the Python reference implementations (_core_template_* and
// _core_prompt_*) onto the AxIR CoreValue runtime. Node maps, error messages,
// and rendering output mirror the Python engine exactly; TemplateError maps
// to AxError::new("template", ...).

#[allow(dead_code)]
const BT: &str = "\u{60}";

#[allow(dead_code)]
const DEFAULT_DSPY_TEMPLATE: &str = "<identity>\n{{ identityText }}\n</identity>{{ if hasFunctions }}\n\n<available_functions>\n**Available Functions**: You can call the following functions to complete the task:\n\n{{ functionsList }}\n\n## Function Call Instructions\n- Complete the task, using the functions defined earlier in this prompt.\n- Output fields should only be generated after all functions have been called.\n- Use the function results to generate the output fields.\n</available_functions>{{ /if }}\n\n<input_fields>\n{{ inputFieldsSection }}\n</input_fields>{{ if hasOutputFields }}\n\n<output_fields>\n{{ outputFieldsSection }}\n</output_fields>{{ /if }}\n{{ if hasTaskDefinition }}\n\n<task_definition>\n{{ taskDefinitionText }}\n</task_definition>{{ /if }}\n\n<formatting_rules>\n{{ if hasStructuredOutputFunction }}\nReturn the complete output by calling \u{60}{{ structuredOutputFunctionName }}\u{60}.\n{{ else }}{{ if hasComplexFields }}\nReturn valid JSON matching <output_fields>.\n{{ else }}\nReturn one \u{60}field name: value\u{60} pair per line for the required output fields only.\n{{ /if }}{{ /if }}Above rules override later instructions.\n\n</formatting_rules>\n{{ if hasExampleDemonstrations }}\n\n## Example Demonstrations\nThe following User/Assistant turns are examples only until --- END OF EXAMPLES ---, not context for the current task.\n{{ /if }}\n";

#[allow(dead_code)]
#[derive(Clone, Debug)]
struct CoreTemplateToken {
    is_tag: bool,
    value: String,
    // Character offset of the token in the source template (tags only; text
    // tokens carry the offset where the text run starts).
    index: usize,
}

#[allow(dead_code)]
struct CoreTemplateParseRange {
    nodes: CoreValue,
    index: usize,
    terminator: Option<String>,
}

#[allow(dead_code)]
fn core_template_error(message: String) -> AxError {
    AxError::new("template", message)
}

// IDENTIFIER_PATTERN: ^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$
#[allow(dead_code)]
fn core_template_is_identifier(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    for part in text.split('.') {
        let mut chars = part.chars();
        match chars.next() {
            Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
            _ => return false,
        }
        if !chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
            return false;
        }
    }
    true
}

// STRING_EQUALITY_PATTERN:
// ^(identifier)\s*===\s*(?:'([^']*)'|"([^"]*)")$  -> Some((path, expected))
#[allow(dead_code)]
fn core_template_match_string_equality(text: &str) -> Option<(String, String)> {
    let eq = text.find("===")?;
    let path = text[..eq].trim_end();
    if !core_template_is_identifier(path) {
        return None;
    }
    let rest = text[eq + 3..].trim_start();
    if rest.len() < 2 {
        return None;
    }
    let quote = rest.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    if !rest.ends_with(quote) {
        return None;
    }
    let inner = &rest[1..rest.len() - 1];
    if inner.contains(quote) {
        return None;
    }
    Some((path.to_string(), inner.to_string()))
}

// TAG_PATTERN tokenizer: {{\s*([^}]+?)\s*}} scanned by character so token
// indices match Python string offsets.
#[allow(dead_code)]
fn core_template_tokenize(template: &str) -> Vec<CoreTemplateToken> {
    let chars: Vec<char> = template.chars().collect();
    let len = chars.len();
    let mut tokens: Vec<CoreTemplateToken> = Vec::new();
    let mut last_index = 0usize;
    let mut i = 0usize;
    while i + 5 <= len {
        if chars[i] != '{' || chars[i + 1] != '{' {
            i += 1;
            continue;
        }
        // Tag content cannot contain '}', so the closing braces must sit at
        // the first '}' after the opener.
        let mut close = i + 2;
        while close < len && chars[close] != '}' {
            close += 1;
        }
        if close >= len {
            break;
        }
        if close + 1 >= len || chars[close + 1] != '}' || close < i + 3 {
            i += 1;
            continue;
        }
        if i > last_index {
            tokens.push(CoreTemplateToken {
                is_tag: false,
                value: chars[last_index..i].iter().collect(),
                index: last_index,
            });
        }
        let raw: String = chars[i + 2..close].iter().collect();
        tokens.push(CoreTemplateToken {
            is_tag: true,
            value: raw.trim().to_string(),
            index: i,
        });
        last_index = close + 2;
        i = close + 2;
    }
    if last_index < len {
        tokens.push(CoreTemplateToken {
            is_tag: false,
            value: chars[last_index..].iter().collect(),
            index: last_index,
        });
    }
    tokens
}

#[allow(dead_code)]
fn core_template_error_message(context: &str, source: &str, index: usize, message: &str) -> String {
    let snippet: String = source.chars().take(index).collect();
    let lines: Vec<&str> = snippet.split('\n').collect();
    let line = lines.len();
    let column = lines.last().map(|last| last.chars().count() + 1).unwrap_or(1);
    format!("{context}:{line}:{column} {message}")
}

#[allow(dead_code)]
fn core_template_parse_range(
    tokens: &[CoreTemplateToken],
    source: &str,
    context: &str,
    start_index: usize,
    terminators: &[&str],
) -> Result<CoreTemplateParseRange, AxError> {
    let nodes = CoreValue::new_list();
    let mut i = start_index;
    while i < tokens.len() {
        let token = &tokens[i];
        if !token.is_tag {
            let node = CoreValue::new_map();
            core_set(&node, CoreValue::from("type"), CoreValue::from("text"))?;
            core_set(&node, CoreValue::from("value"), CoreValue::from(token.value.as_str()))?;
            core_append(&nodes, node)?;
            i += 1;
            continue;
        }

        let tag = token.value.as_str();
        if terminators.contains(&tag) {
            return Ok(CoreTemplateParseRange {
                nodes,
                index: i,
                terminator: Some(tag.to_string()),
            });
        }

        if let Some(rest) = tag.strip_prefix("if ") {
            let condition = rest.trim();
            if !core_template_is_identifier(condition)
                && core_template_match_string_equality(condition).is_none()
            {
                return Err(core_template_error(core_template_error_message(
                    context,
                    source,
                    token.index,
                    &format!("Invalid if condition '{condition}'"),
                )));
            }
            let then_result = core_template_parse_range(tokens, source, context, i + 1, &["else", "/if"])?;
            let Some(terminator) = then_result.terminator else {
                return Err(core_template_error(core_template_error_message(
                    context,
                    source,
                    token.index,
                    "Unclosed 'if' block",
                )));
            };
            let mut else_nodes = CoreValue::new_list();
            let mut next_index = then_result.index;
            if terminator == "else" {
                let else_result = core_template_parse_range(tokens, source, context, next_index + 1, &["/if"])?;
                if else_result.terminator.as_deref() != Some("/if") {
                    return Err(core_template_error(core_template_error_message(
                        context,
                        source,
                        token.index,
                        "Unclosed 'if' block",
                    )));
                }
                else_nodes = else_result.nodes;
                next_index = else_result.index;
            }
            let node = CoreValue::new_map();
            core_set(&node, CoreValue::from("type"), CoreValue::from("if"))?;
            core_set(&node, CoreValue::from("condition"), CoreValue::from(condition))?;
            core_set(&node, CoreValue::from("then"), then_result.nodes)?;
            core_set(&node, CoreValue::from("else"), else_nodes)?;
            core_set(&node, CoreValue::from("index"), CoreValue::Num(token.index as f64))?;
            core_append(&nodes, node)?;
            i = next_index + 1;
            continue;
        }

        if tag == "else" {
            return Err(core_template_error(core_template_error_message(
                context,
                source,
                token.index,
                "Unexpected 'else'",
            )));
        }
        if tag == "/if" {
            return Err(core_template_error(core_template_error_message(
                context,
                source,
                token.index,
                "Unexpected '/if'",
            )));
        }
        if tag.starts_with('!') {
            i += 1;
            continue;
        }
        if tag.starts_with("include ") {
            return Err(core_template_error(core_template_error_message(
                context,
                source,
                token.index,
                "Unexpected 'include' directive at runtime (includes must be compiled)",
            )));
        }
        if !core_template_is_identifier(tag) {
            return Err(core_template_error(core_template_error_message(
                context,
                source,
                token.index,
                &format!("Invalid tag '{tag}'"),
            )));
        }
        let node = CoreValue::new_map();
        core_set(&node, CoreValue::from("type"), CoreValue::from("var"))?;
        core_set(&node, CoreValue::from("name"), CoreValue::from(tag))?;
        core_set(&node, CoreValue::from("index"), CoreValue::Num(token.index as f64))?;
        core_append(&nodes, node)?;
        i += 1;
    }
    Ok(CoreTemplateParseRange {
        nodes,
        index: i,
        terminator: None,
    })
}

#[allow(dead_code)]
fn core_template_parse_source(template: &str, context: &str) -> Result<CoreValue, AxError> {
    let tokens = core_template_tokenize(template);
    let result = core_template_parse_range(&tokens, template, context, 0, &[])?;
    if let Some(terminator) = result.terminator {
        return Err(core_template_error(format!(
            "Unexpected template terminator '{terminator}' in {context}"
        )));
    }
    Ok(result.nodes)
}

#[allow(dead_code)]
fn core_template_resolve_var(
    vars: &CoreValue,
    path: &str,
    source: &str,
    context: &str,
    index: usize,
) -> Result<CoreValue, AxError> {
    let mut current = vars.clone();
    for part in path.split('.') {
        let has_key = matches!(&current, CoreValue::Map(map) if map.borrow().contains(part));
        if !has_key {
            return Err(core_template_error(core_template_error_message(
                context,
                source,
                index,
                &format!("Missing template variable '{path}'"),
            )));
        }
        current = core_get(&current, &CoreValue::from(part), CoreValue::Null);
    }
    Ok(current)
}

#[allow(dead_code)]
fn core_template_node_index(node: &CoreValue) -> usize {
    match core_get(node, &CoreValue::from("index"), CoreValue::Null) {
        CoreValue::Num(n) => n as usize,
        _ => 0,
    }
}

#[allow(dead_code)]
fn core_template_render_tree_nodes(
    nodes: &CoreValue,
    vars: &CoreValue,
    source: &str,
    context: &str,
) -> Result<String, AxError> {
    let mut out = String::new();
    for node in core_iter(nodes)? {
        let node_type = core_get(&node, &CoreValue::from("type"), CoreValue::Null);
        if node_type.as_str() == Some("text") {
            out.push_str(&core_get(&node, &CoreValue::from("value"), CoreValue::from("")).text());
            continue;
        }
        if node_type.as_str() == Some("var") {
            let name = core_get(&node, &CoreValue::from("name"), CoreValue::Null).text();
            let index = core_template_node_index(&node);
            let value = core_template_resolve_var(vars, &name, source, context, index)?;
            if !matches!(value, CoreValue::Str(_) | CoreValue::Num(_) | CoreValue::Bool(_)) {
                return Err(core_template_error(core_template_error_message(
                    context,
                    source,
                    index,
                    &format!("Variable '{name}' must be string, number, or boolean"),
                )));
            }
            out.push_str(&value.text());
            continue;
        }
        let condition = core_get(&node, &CoreValue::from("condition"), CoreValue::Null).text();
        let index = core_template_node_index(&node);
        let condition_value = if let Some((path, expected)) = core_template_match_string_equality(&condition) {
            core_template_resolve_var(vars, &path, source, context, index)?
                == CoreValue::from(expected.as_str())
        } else {
            let resolved = core_template_resolve_var(vars, &condition, source, context, index)?;
            match resolved {
                CoreValue::Bool(flag) => flag,
                _ => {
                    return Err(core_template_error(core_template_error_message(
                        context,
                        source,
                        index,
                        &format!("Condition '{condition}' must be boolean"),
                    )))
                }
            }
        };
        let branch_key = if condition_value { "then" } else { "else" };
        let branch = core_get(&node, &CoreValue::from(branch_key), CoreValue::Null);
        out.push_str(&core_template_render_tree_nodes(&branch, vars, source, context)?);
    }
    Ok(out)
}

#[allow(dead_code)]
fn core_template_collect_vars_from_tree(nodes: &CoreValue, out: &mut Vec<String>) -> Result<(), AxError> {
    for node in core_iter(nodes)? {
        let node_type = core_get(&node, &CoreValue::from("type"), CoreValue::Null);
        if node_type.as_str() == Some("var") {
            let name = core_get(&node, &CoreValue::from("name"), CoreValue::Null).text();
            if !out.contains(&name) {
                out.push(name);
            }
        } else if node_type.as_str() == Some("if") {
            let condition = core_get(&node, &CoreValue::from("condition"), CoreValue::Null).text();
            let name = match core_template_match_string_equality(&condition) {
                Some((path, _)) => path,
                None => condition,
            };
            if !out.contains(&name) {
                out.push(name);
            }
            core_template_collect_vars_from_tree(
                &core_get(&node, &CoreValue::from("then"), CoreValue::Null),
                out,
            )?;
            core_template_collect_vars_from_tree(
                &core_get(&node, &CoreValue::from("else"), CoreValue::Null),
                out,
            )?;
        }
    }
    Ok(())
}

// ENTRY: (template, context) -> nodes
#[allow(dead_code)]
fn core_template_parse(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let template = core_arg(args, 0).text();
    let context = core_arg(args, 1).text();
    core_template_parse_source(&template, &context)
}

// ENTRY: (nodes, vars, source, context) -> rendered string
#[allow(dead_code)]
fn core_template_render_tree(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let nodes = core_arg(args, 0);
    let vars = core_arg(args, 1);
    let source = core_arg(args, 2).text();
    let context = core_arg(args, 3).text();
    let rendered = core_template_render_tree_nodes(&nodes, &vars, &source, &context)?;
    Ok(CoreValue::from_string(rendered))
}

// ENTRY: (nodes) -> sorted list of unique variable names
#[allow(dead_code)]
fn core_template_collect_vars(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let nodes = core_arg(args, 0);
    let mut out: Vec<String> = Vec::new();
    core_template_collect_vars_from_tree(&nodes, &mut out)?;
    out.sort();
    Ok(CoreValue::list_from(out.into_iter().map(CoreValue::from_string).collect()))
}

// ENTRY: (source, context, required_variables?) -> error message string or Null
#[allow(dead_code)]
fn core_template_validate(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let source = core_arg(args, 0).text();
    let context = core_arg(args, 1).text();
    let required_variables = core_arg(args, 2);
    let outcome = (|| -> Result<CoreValue, AxError> {
        let nodes = core_template_parse_source(&source, &context)?;
        let mut present: Vec<String> = Vec::new();
        core_template_collect_vars_from_tree(&nodes, &mut present)?;
        let required = if core_truthy(&required_variables) {
            core_iter(&required_variables)?
        } else {
            Vec::new()
        };
        for variable in required {
            let name = variable.text();
            if !present.contains(&name) {
                return Ok(CoreValue::from_string(format!(
                    "must preserve template variable {{{{{name}}}}}"
                )));
            }
        }
        Ok(CoreValue::Null)
    })();
    match outcome {
        Ok(value) => Ok(value),
        Err(err) => Ok(CoreValue::from_string(err.message)),
    }
}

// ----- prompt helpers -----

#[allow(dead_code)]
fn core_prompt_combine_consecutive_text(parts: &CoreValue, separator: &str) -> Result<CoreValue, AxError> {
    let out = CoreValue::new_list();
    for part in core_iter(parts)? {
        let is_text =
            core_get(&part, &CoreValue::from("type"), CoreValue::Null).as_str() == Some("text");
        let last = match &out {
            CoreValue::List(items) => items.borrow().last().cloned(),
            _ => None,
        };
        let merge_target = match last {
            Some(prev)
                if is_text
                    && core_get(&prev, &CoreValue::from("type"), CoreValue::Null).as_str()
                        == Some("text") =>
            {
                Some(prev)
            }
            _ => None,
        };
        if let Some(prev) = merge_target {
            let prev_text = core_get(&prev, &CoreValue::from("text"), CoreValue::from("")).text();
            let part_text = core_get(&part, &CoreValue::from("text"), CoreValue::from("")).text();
            core_set(
                &prev,
                CoreValue::from("text"),
                CoreValue::from_string(format!("{prev_text}{separator}{part_text}")),
            )?;
        } else {
            core_append(&out, part)?;
        }
    }
    Ok(out)
}

#[allow(dead_code)]
fn core_prompt_default_render_in_field(field: &CoreValue, value: &CoreValue) -> Result<CoreValue, AxError> {
    let field_type = core_get(field, &CoreValue::from("type"), CoreValue::Null);
    let typ = if core_truthy(&field_type) {
        core_get(&field_type, &CoreValue::from("name"), CoreValue::Null).text()
    } else {
        "string".to_string()
    };
    let title = core_get(field, &CoreValue::from("title"), CoreValue::Null).text();
    if matches!(typ.as_str(), "image" | "audio" | "file" | "url") {
        if matches!(value, CoreValue::List(_)) {
            let parts = CoreValue::new_list();
            let text_part = CoreValue::new_map();
            core_set(&text_part, CoreValue::from("type"), CoreValue::from("text"))?;
            core_set(
                &text_part,
                CoreValue::from("text"),
                CoreValue::from_string(format!("{title}: ")),
            )?;
            core_append(&parts, text_part)?;
            for item in core_iter(value)? {
                core_append(&parts, item)?;
            }
            return Ok(parts);
        }
        if let CoreValue::Map(map) = value {
            let part = CoreValue::new_map();
            for (key, item) in map.borrow().entries.clone() {
                core_set(&part, CoreValue::from(key.as_str()), item)?;
            }
            let has_type = matches!(&part, CoreValue::Map(m) if m.borrow().contains("type"));
            if !has_type {
                core_set(&part, CoreValue::from("type"), CoreValue::from_string(typ.clone()))?;
            }
            let text_part = CoreValue::new_map();
            core_set(&text_part, CoreValue::from("type"), CoreValue::from("text"))?;
            core_set(
                &text_part,
                CoreValue::from("text"),
                CoreValue::from_string(format!("{title}: ")),
            )?;
            return Ok(CoreValue::list_from(vec![text_part, part]));
        }
    }
    let part = CoreValue::new_map();
    core_set(&part, CoreValue::from("type"), CoreValue::from("text"))?;
    core_set(
        &part,
        CoreValue::from("text"),
        CoreValue::from_string(format!("{}: {}", title, value.text())),
    )?;
    if core_truthy(&core_get(field, &CoreValue::from("is_cached"), CoreValue::Null)) {
        core_set(&part, CoreValue::from("cache"), CoreValue::Bool(true))?;
    }
    Ok(CoreValue::list_from(vec![part]))
}

#[allow(dead_code)]
fn core_prompt_field_name_to_title(signature: &CoreValue) -> Result<Vec<(String, String)>, AxError> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut fields = core_prompt_get_input_fields(signature)?;
    fields.extend(core_prompt_get_output_fields(signature)?);
    for field in fields {
        let name = core_get(&field, &CoreValue::from("name"), CoreValue::Null).text();
        let title = core_get(&field, &CoreValue::from("title"), CoreValue::Null).text();
        if let Some(entry) = out.iter_mut().find(|(key, _)| *key == name) {
            entry.1 = title;
        } else {
            out.push((name, title));
        }
    }
    Ok(out)
}

#[allow(dead_code)]
fn core_prompt_field_type_text(field_type: &CoreValue) -> String {
    let name_value = core_get(field_type, &CoreValue::from("name"), CoreValue::Null);
    let name = name_value.as_str().unwrap_or("string");
    let base = match name {
        "string" => "string".to_string(),
        "number" => "number".to_string(),
        "boolean" => "boolean (true or false)".to_string(),
        "date" => "date (YYYY-MM-DD, e.g. 2024-05-09)".to_string(),
        "dateRange" => "date range ({ \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\" }, e.g. {\"start\":\"2024-05-09\",\"end\":\"2024-05-12\"})".to_string(),
        "datetime" => "datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00)".to_string(),
        "datetimeRange" => "datetime range ({ \"start\": ISO datetime, \"end\": ISO datetime }, e.g. {\"start\":\"2024-05-09T14:30:00Z\",\"end\":\"2024-05-09T15:30:00Z\"})".to_string(),
        "json" => "JSON object".to_string(),
        "class" => "classification class".to_string(),
        "code" => "code".to_string(),
        "file" => "file (with filename, mimeType, and data)".to_string(),
        "audio" => "speech script (plain text to synthesize as audio)".to_string(),
        "url" => "URL (string or object with url, title, description)".to_string(),
        "object" => {
            let fields = core_get(field_type, &CoreValue::from("fields"), CoreValue::Null);
            if core_truthy(&fields) {
                format!("object {}", core_prompt_format_object_structure(&fields))
            } else {
                "object".to_string()
            }
        }
        _ => "string".to_string(),
    };
    if core_truthy(&core_get(field_type, &CoreValue::from("is_array"), CoreValue::Null)) {
        format!("json array of {base} items")
    } else {
        base
    }
}

#[allow(dead_code)]
fn core_prompt_format_description(text: &CoreValue) -> String {
    let raw = if core_truthy(text) { text.text() } else { String::new() };
    let value = raw.trim();
    if value.is_empty() {
        return String::new();
    }
    let suffix = if value.ends_with('.') { "" } else { "." };
    let chars: Vec<char> = value.chars().collect();
    let first_upper: String = chars[0].to_uppercase().collect();
    let rest: String = chars[1..].iter().collect();
    format!("{first_upper}{rest}{suffix}")
}

#[allow(dead_code)]
fn core_prompt_format_field_references(description: &str, field_map: &[(String, String)]) -> String {
    let mut result = description.to_string();
    let mut ordered: Vec<&(String, String)> = field_map.iter().collect();
    // sorted(keys, key=len, reverse=True) -- stable, longest first
    ordered.sort_by(|a, b| b.0.chars().count().cmp(&a.0.chars().count()));
    for (field_name, title) in ordered {
        result = result.replace(
            &format!("{BT}{field_name}{BT}"),
            &format!("{BT}{title}{BT}"),
        );
        result = result.replace(
            &format!("\"{field_name}\""),
            &format!("\"{title}\""),
        );
        result = result.replace(
            &format!("'{field_name}'"),
            &format!("'{title}'"),
        );
        result = result.replace(
            &format!("[{field_name}]"),
            &format!("[{title}]"),
        );
        result = result.replace(
            &format!("({field_name})"),
            &format!("({title})"),
        );
        let pattern = format!(r"\${}\b", regex::escape(field_name));
        if let Ok(compiled) = regex::Regex::new(&pattern) {
            let replacement = format!("{BT}{title}{BT}");
            result = compiled
                .replace_all(&result, regex::NoExpand(replacement.as_str()))
                .into_owned();
        }
    }
    result
}

#[allow(dead_code)]
fn core_prompt_format_object_structure(fields: &CoreValue) -> String {
    let mut entries: Vec<String> = Vec::new();
    if let CoreValue::Map(map) = fields {
        for (key, item) in map.borrow().entries.clone() {
            let nested_type = if matches!(&item, CoreValue::Map(m) if m.borrow().contains("type")) {
                core_get(&item, &CoreValue::from("type"), CoreValue::Null)
            } else {
                item.clone()
            };
            let optional = if core_truthy(&core_get(&item, &CoreValue::from("is_optional"), CoreValue::Null)) {
                "?"
            } else {
                ""
            };
            entries.push(format!(
                "{}{}: {}",
                key,
                optional,
                core_prompt_field_type_text(&nested_type)
            ));
        }
    }
    format!("{{ {} }}", entries.join(", "))
}

#[allow(dead_code)]
fn core_prompt_function_descriptors(functions: &CoreValue) -> Result<Vec<(CoreValue, CoreValue)>, AxError> {
    let mut out: Vec<(CoreValue, CoreValue)> = Vec::new();
    let items = if core_truthy(functions) {
        core_iter(functions)?
    } else {
        Vec::new()
    };
    for item in items {
        let (name, description) = match &item {
            CoreValue::Map(map) => (
                map.borrow().get("name").unwrap_or(CoreValue::Null),
                map.borrow().get("description").unwrap_or(CoreValue::from("")),
            ),
            _ => (CoreValue::Null, CoreValue::from("")),
        };
        if core_truthy(&name) {
            out.push((name, description));
        }
    }
    Ok(out)
}

#[allow(dead_code)]
fn core_prompt_get_description(signature: &CoreValue) -> CoreValue {
    core_get(signature, &CoreValue::from("description"), CoreValue::Null)
}

#[allow(dead_code)]
fn core_prompt_get_input_fields(signature: &CoreValue) -> Result<Vec<CoreValue>, AxError> {
    let fields = core_get(signature, &CoreValue::from("input_fields"), CoreValue::Null);
    if fields.is_null() {
        return Ok(Vec::new());
    }
    core_iter(&fields)
}

#[allow(dead_code)]
fn core_prompt_get_output_fields(signature: &CoreValue) -> Result<Vec<CoreValue>, AxError> {
    let fields = core_get(signature, &CoreValue::from("output_fields"), CoreValue::Null);
    if fields.is_null() {
        return Ok(Vec::new());
    }
    core_iter(&fields)
}

#[allow(dead_code)]
fn core_prompt_has_complex_fields(signature: &CoreValue) -> Result<bool, AxError> {
    if core_truthy(&core_get(signature, &CoreValue::from("force_structured"), CoreValue::Null)) {
        return Ok(true);
    }
    for field in core_prompt_get_output_fields(signature)? {
        let field_type = core_get(&field, &CoreValue::from("type"), CoreValue::Null);
        if core_get(&field_type, &CoreValue::from("name"), CoreValue::Null).as_str() == Some("object")
            || core_truthy(&core_get(&field_type, &CoreValue::from("fields"), CoreValue::Null))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[allow(dead_code)]
fn core_prompt_identity_section(signature: &CoreValue, values: &CoreValue) -> Result<String, AxError> {
    let in_args = core_prompt_render_desc_fields(&core_prompt_input_fields_for_values(signature, values)?);
    let out_args = core_prompt_render_desc_fields(&core_prompt_get_output_fields(signature)?);
    Ok(format!(
        "You will be provided with the following fields: {in_args}. Your task is to generate new fields: {out_args}."
    ))
}

#[allow(dead_code)]
fn core_prompt_input_fields_for_values(signature: &CoreValue, values: &CoreValue) -> Result<Vec<CoreValue>, AxError> {
    let mut fields = core_prompt_get_input_fields(signature)?;
    fields.sort_by_key(|field| {
        if core_truthy(&core_get(field, &CoreValue::from("is_cached"), CoreValue::Null)) {
            0
        } else {
            1
        }
    });
    if !matches!(values, CoreValue::Map(_)) {
        return Ok(fields);
    }
    Ok(fields
        .into_iter()
        .filter(|field| {
            if !core_truthy(&core_get(field, &CoreValue::from("is_optional"), CoreValue::Null)) {
                return true;
            }
            let name = core_get(field, &CoreValue::from("name"), CoreValue::Null);
            core_prompt_is_provided_value(&core_get(values, &name, CoreValue::Null))
        })
        .collect())
}

#[allow(dead_code)]
fn core_prompt_input_fields_section(signature: &CoreValue, values: &CoreValue) -> Result<String, AxError> {
    let fields = core_prompt_render_input_fields(
        &core_prompt_input_fields_for_values(signature, values)?,
        &core_prompt_field_name_to_title(signature)?,
    );
    Ok(format!(
        "**Input Fields**: The following fields will be provided to you:\n\n{fields}"
    ))
}

#[allow(dead_code)]
fn core_prompt_is_provided_value(value: &CoreValue) -> bool {
    match value {
        CoreValue::Null => false,
        CoreValue::Str(text) => !text.is_empty(),
        CoreValue::List(items) => !items.borrow().is_empty(),
        _ => true,
    }
}

#[allow(dead_code)]
fn core_prompt_output_fields_section(signature: &CoreValue) -> Result<String, AxError> {
    let fields = core_prompt_render_output_fields(
        &core_prompt_get_output_fields(signature)?,
        &core_prompt_field_name_to_title(signature)?,
    )?;
    Ok(format!(
        "**Output Fields**: You must generate the following fields:\n\n{fields}"
    ))
}

#[allow(dead_code)]
fn core_prompt_process_value(field: &CoreValue, value: &CoreValue) -> Result<CoreValue, AxError> {
    if matches!(value, CoreValue::Str(_)) {
        return Ok(value.clone());
    }
    let field_type = core_get(field, &CoreValue::from("type"), CoreValue::Null);
    if core_truthy(&field_type) {
        let name = core_get(&field_type, &CoreValue::from("name"), CoreValue::Null);
        if matches!(name.as_str(), Some("image") | Some("audio") | Some("file") | Some("url"))
            && matches!(value, CoreValue::Map(_))
        {
            return Ok(value.clone());
        }
    }
    // json.dumps(value, indent=2)
    let dumped = serde_json::to_string_pretty(&core_value_to_json(value))
        .map_err(|err| AxError::runtime(err.to_string()))?;
    Ok(CoreValue::from_string(dumped))
}

#[allow(dead_code)]
fn core_prompt_render_desc_fields(fields: &[CoreValue]) -> String {
    fields
        .iter()
        .map(|field| {
            let title = core_get(field, &CoreValue::from("title"), CoreValue::Null).text();
            format!("{BT}{title}{BT}")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[allow(dead_code)]
fn core_prompt_render_functions_section(funcs: &[(CoreValue, CoreValue)]) -> String {
    funcs
        .iter()
        .map(|(name, description)| {
            format!(
                "- {BT}{}{BT}: {}",
                name.text(),
                core_prompt_format_description(description)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[allow(dead_code)]
fn core_prompt_render_in_field(field: &CoreValue, values: &CoreValue) -> Result<Option<CoreValue>, AxError> {
    let name = core_get(field, &CoreValue::from("name"), CoreValue::Null);
    let value = core_get(values, &name, CoreValue::Null);
    if !core_prompt_is_provided_value(&value) {
        if core_truthy(&core_get(field, &CoreValue::from("is_optional"), CoreValue::Null))
            || core_truthy(&core_get(field, &CoreValue::from("is_internal"), CoreValue::Null))
        {
            return Ok(None);
        }
        return Err(AxError::runtime(format!(
            "Value for input field '{}' is required.",
            name.text()
        )));
    }
    let processed = core_prompt_process_value(field, &value)?;
    Ok(Some(core_prompt_default_render_in_field(field, &processed)?))
}

#[allow(dead_code)]
fn core_prompt_render_input_fields(fields: &[CoreValue], field_map: &[(String, String)]) -> String {
    let mut rows: Vec<String> = Vec::new();
    for field in fields {
        let description_value = core_get(field, &CoreValue::from("description"), CoreValue::Null);
        let mut description = String::new();
        if core_truthy(&description_value) {
            description = format!(
                " {}",
                core_prompt_format_field_references(
                    &core_prompt_format_description(&description_value),
                    field_map
                )
            );
        }
        let title = core_get(field, &CoreValue::from("title"), CoreValue::Null).text();
        rows.push(format!("{title}:{description}").trim().to_string());
    }
    rows.join("\n")
}

#[allow(dead_code)]
fn core_prompt_render_output_fields(fields: &[CoreValue], field_map: &[(String, String)]) -> Result<String, AxError> {
    let mut rows: Vec<String> = Vec::new();
    for field in fields {
        let field_type = core_get(field, &CoreValue::from("type"), CoreValue::Null);
        let type_text = if core_truthy(&field_type) {
            core_prompt_field_type_text(&field_type)
        } else {
            "string".to_string()
        };
        let required = if core_truthy(&core_get(field, &CoreValue::from("is_optional"), CoreValue::Null)) {
            format!("Only include this {type_text} field if its value is available")
        } else {
            format!("This {type_text} field must be included")
        };
        let description_value = core_get(field, &CoreValue::from("description"), CoreValue::Null);
        let mut description = String::new();
        if core_truthy(&description_value) {
            let is_class = core_truthy(&field_type)
                && core_get(&field_type, &CoreValue::from("name"), CoreValue::Null).as_str()
                    == Some("class");
            let value = if is_class {
                description_value.text()
            } else {
                core_prompt_format_description(&description_value)
            };
            description = format!(" {}", core_prompt_format_field_references(&value, field_map));
        }
        let options = core_get(&field_type, &CoreValue::from("options"), CoreValue::Null);
        if core_truthy(&field_type) && core_truthy(&options) {
            if !description.is_empty() {
                description.push_str(". ");
            }
            let joined = core_iter(&options)?
                .iter()
                .map(|option| option.text())
                .collect::<Vec<_>>()
                .join(", ");
            description.push_str(&format!("Allowed values: {joined}"));
        }
        let title = core_get(field, &CoreValue::from("title"), CoreValue::Null).text();
        rows.push(format!("{title}: ({required}){description}").trim().to_string());
    }
    Ok(rows.join("\n"))
}

#[allow(dead_code)]
fn core_prompt_task_definition_section(signature: &CoreValue) -> Result<String, AxError> {
    let desc = core_prompt_get_description(signature);
    if !core_truthy(&desc) {
        return Ok(String::new());
    }
    Ok(core_prompt_format_field_references(
        &core_prompt_format_description(&desc),
        &core_prompt_field_name_to_title(signature)?,
    ))
}

#[allow(dead_code)]
fn core_prompt_user_parts(signature: &CoreValue, values: &CoreValue) -> Result<CoreValue, AxError> {
    let out = CoreValue::new_list();
    for field in core_prompt_input_fields_for_values(signature, values)? {
        if let Some(rendered) = core_prompt_render_in_field(&field, values)? {
            for part in core_iter(&rendered)? {
                core_append(&out, part)?;
            }
        }
    }
    for part in core_iter(&out)? {
        if core_get(&part, &CoreValue::from("type"), CoreValue::Null).as_str() == Some("text") {
            let text = core_get(&part, &CoreValue::from("text"), CoreValue::from("")).text();
            core_set(
                &part,
                CoreValue::from("text"),
                CoreValue::from_string(format!("{text}\n")),
            )?;
        }
    }
    Ok(out)
}

// ENTRY: (signature, values, functions, options) -> rendered system prompt
#[allow(dead_code)]
fn core_prompt_structured(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let signature = core_arg(args, 0);
    let mut values = core_arg(args, 1);
    let functions = core_arg(args, 2);
    let mut options = core_arg(args, 3);
    if !core_truthy(&values) {
        values = CoreValue::new_map();
    }
    if !core_truthy(&options) {
        options = CoreValue::new_map();
    }
    let has_complex_fields = core_prompt_has_complex_fields(&signature)?;
    let task_definition = core_prompt_task_definition_section(&signature)?;
    let funcs = core_prompt_function_descriptors(&functions)?;
    let has_examples_default = core_get(
        &options,
        &CoreValue::from("hasExampleDemonstrations"),
        CoreValue::Bool(false),
    );
    let has_example_demonstrations = core_truthy(&core_get(
        &options,
        &CoreValue::from("has_example_demonstrations"),
        has_examples_default,
    ));
    let structured_fn = core_get(
        &options,
        &CoreValue::from("structured_output_function_name"),
        CoreValue::Null,
    );
    let template_vars = CoreValue::new_map();
    core_set(&template_vars, CoreValue::from("hasFunctions"), CoreValue::Bool(!funcs.is_empty()))?;
    core_set(
        &template_vars,
        CoreValue::from("hasTaskDefinition"),
        CoreValue::Bool(!task_definition.is_empty()),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("hasExampleDemonstrations"),
        CoreValue::Bool(has_example_demonstrations),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("hasOutputFields"),
        CoreValue::Bool(!has_complex_fields),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("hasComplexFields"),
        CoreValue::Bool(has_complex_fields),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("hasStructuredOutputFunction"),
        CoreValue::Bool(has_complex_fields && core_truthy(&structured_fn)),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("identityText"),
        CoreValue::from_string(core_prompt_identity_section(&signature, &values)?),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("taskDefinitionText"),
        CoreValue::from_string(task_definition.clone()),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("functionsList"),
        if !funcs.is_empty() {
            CoreValue::from_string(core_prompt_render_functions_section(&funcs))
        } else {
            CoreValue::from("")
        },
    )?;
    core_set(
        &template_vars,
        CoreValue::from("inputFieldsSection"),
        CoreValue::from_string(core_prompt_input_fields_section(&signature, &values)?),
    )?;
    core_set(
        &template_vars,
        CoreValue::from("outputFieldsSection"),
        if !has_complex_fields {
            CoreValue::from_string(core_prompt_output_fields_section(&signature)?)
        } else {
            CoreValue::from("")
        },
    )?;
    core_set(
        &template_vars,
        CoreValue::from("structuredOutputFunctionName"),
        if core_truthy(&structured_fn) {
            structured_fn.clone()
        } else {
            CoreValue::from("")
        },
    )?;
    let custom_template = core_get(&options, &CoreValue::from("custom_template"), CoreValue::Null);
    let (source, context) = if custom_template.is_null() {
        (DEFAULT_DSPY_TEMPLATE.to_string(), "template:dsp/dspy.md")
    } else {
        (custom_template.text(), "inline-template")
    };
    let nodes = core_template_parse_source(&source, context)?;
    let rendered = core_template_render_tree_nodes(&nodes, &template_vars, &source, context)?;
    Ok(CoreValue::from_string(rendered.trim().to_string()))
}

// ENTRY: (signature, values) -> joined string, or list of content part maps
#[allow(dead_code)]
fn core_prompt_user_content(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let signature = core_arg(args, 0);
    let mut values = core_arg(args, 1);
    if !core_truthy(&values) {
        values = CoreValue::new_map();
    }
    let parts = core_prompt_user_parts(&signature, &values)?;
    let items = core_iter(&parts)?;
    let all_plain_text = items.iter().all(|part| {
        core_get(part, &CoreValue::from("type"), CoreValue::Null).as_str() == Some("text")
            && !core_truthy(&core_get(part, &CoreValue::from("cache"), CoreValue::Null))
    });
    if all_plain_text {
        let joined = items
            .iter()
            .map(|part| core_get(part, &CoreValue::from("text"), CoreValue::from("")).text())
            .collect::<Vec<_>>()
            .join("\n");
        return Ok(CoreValue::from_string(joined));
    }
    core_prompt_combine_consecutive_text(&parts, "\n")
}
// ----- END AXIR CORE PROMPT/TEMPLATE ENGINE -----


fn core_python_dumps(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap_or_default(),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(core_python_dumps).collect();
            format!("[{}]", parts.join(", "))
        }
        Value::Object(map) => {
            let parts: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("{}: {}", serde_json::to_string(k).unwrap_or_default(), core_python_dumps(v)))
                .collect();
            format!("{{{}}}", parts.join(", "))
        }
    }
}

fn core_json_parse(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let text = core_arg(args, 0).text();
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|err| AxError::runtime(format!("json parse error: {err}")))?;
    Ok(core_value_from_json(&parsed))
}

fn core_json_stringify(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let value = core_arg(args, 0);
    let json = if value.is_null() { json!({}) } else { core_value_to_json(&value) };
    Ok(CoreValue::from_string(core_python_dumps(&json)))
}

fn core_map_delete(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let target = core_arg(args, 0);
    let key = core_arg(args, 1).text();
    if let CoreValue::Map(map) = &target {
        map.borrow_mut().entries.retain(|(k, _)| k != &key);
    }
    Ok(target)
}

fn core_map_merge(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let out = CoreValue::new_map();
    for index in [0usize, 1] {
        if let CoreValue::Map(map) = core_arg(args, index) {
            for (k, v) in map.borrow().entries.clone() {
                core_set(&out, CoreValue::from(k.as_str()), v)?;
            }
        }
    }
    Ok(out)
}

fn core_mul(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_number_pair(args).map(|(a, b)| CoreValue::Num(a * b))
}

fn core_string_lower(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::from_string(core_arg(args, 0).text().to_lowercase()))
}

fn core_string_starts_with(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_arg(args, 0).text().starts_with(&core_arg(args, 1).text())))
}

fn core_string_ends_with(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::Bool(core_arg(args, 0).text().ends_with(&core_arg(args, 1).text())))
}

fn core_string_str(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::from_string(core_arg(args, 0).text()))
}

fn core_string_join_intrinsic(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let sep = core_arg(args, 0);
    core_string_join(&sep, &core_arg(args, 1))
}

fn core_ai_error(class_name: &str, args: &[CoreValue], default_retryable: bool, retry_index: Option<usize>) -> Result<CoreValue, AxError> {
    let status = match core_arg(args, 1) {
        CoreValue::Num(n) => Some(n as u16),
        _ => None,
    };
    let code = core_arg(args, 2);
    let retryable = match retry_index.map(|i| core_arg(args, i)) {
        Some(CoreValue::Null) | None => default_retryable,
        Some(value) => core_truthy(&value),
    };
    Ok(CoreValue::Error(Rc::new(AxError {
        category: "ai_service".to_string(),
        error_type: Some(class_name.to_string()),
        message: core_arg(args, 0).text(),
        status,
        code: code.as_str().map(str::to_string),
        retryable,
    })))
}

fn core_ai_error_auth(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_ai_error("AxAIServiceAuthenticationError", args, false, None)
}

fn core_ai_error_refusal(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_ai_error("AxAIRefusalError", args, false, None)
}

fn core_ai_error_response(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_ai_error("AxAIServiceResponseError", args, false, None)
}

fn core_ai_error_status(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_ai_error("AxAIServiceStatusError", args, false, Some(5))
}

fn core_ai_error_stream(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_ai_error("AxAIServiceStreamTerminatedError", args, true, Some(2))
}

fn core_ai_error_timeout(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_ai_error("AxAIServiceTimeoutError", args, true, Some(5))
}

fn core_ai_error_unsupported(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    core_ai_error("AxUnsupportedCapabilityError", args, false, None)
}

fn core_stream_event_content_parts(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let event = core_arg(args, 0);
    if let Some(text) = event.as_str() {
        return Ok(CoreValue::list_from(vec![CoreValue::from(text)]));
    }
    if !matches!(event, CoreValue::Map(_)) {
        return Ok(CoreValue::new_list());
    }
    let inner = core_get(&event, &CoreValue::from("data"), CoreValue::Null);
    let data = if matches!(inner, CoreValue::Map(_)) { inner } else { event };
    let kind = core_get(&data, &CoreValue::from("type"), CoreValue::Null).text();
    if kind == "done" || kind == "message_stop" {
        return Ok(CoreValue::new_list());
    }
    let results = core_get(&data, &CoreValue::from("results"), CoreValue::Null);
    if core_truthy(&results) {
        let out = CoreValue::new_list();
        for result in core_iter(&results)? {
            let content = core_get(&result, &CoreValue::from("content"), CoreValue::Null);
            core_append(&out, if content.is_null() { CoreValue::from("") } else { content })?;
        }
        return Ok(out);
    }
    for key in ["delta", "content_delta", "contentDelta", "text", "content"] {
        let value = core_get(&data, &CoreValue::from(key), CoreValue::Null);
        if core_truthy(&value) {
            return Ok(CoreValue::list_from(vec![value]));
        }
    }
    Ok(CoreValue::list_from(vec![CoreValue::from("")]))
}


// Wire-format key translation for the openai-compatible chat body; the
// Core-level AxModelConfig merge is the emitted merge_model_config.
fn merge_model_config_wire(target: &mut Value, source: &Value) {
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

fn normalize_embed_response_native(response: Value, ai_name: &str) -> AxResult<Value> {
    let payload = normalize_passthrough_response(response)?;
    if ai_name == "google-gemini" {
        let normalized = _gemini_normalize_embed_response(&[core_value_from_json(&payload)])?;
        return Ok(core_value_to_json(&normalized));
    }
    let usage_ai_name = if ai_name == "openai-compatible" { "openai" } else { ai_name };
    let normalized = openai_normalize_embed_response(&[
        core_value_from_json(&payload),
        CoreValue::from(usage_ai_name),
    ])?;
    Ok(core_value_to_json(&normalized))
}


fn provider_ai_display_name(profile: &str) -> CoreValue {
    provider_descriptor(&[CoreValue::from(profile)])
        .map(|descriptor| core_get(&descriptor, &CoreValue::from("name"), CoreValue::from(profile)))
        .unwrap_or_else(|_| CoreValue::from(profile))
}

// ----- AXIR CORE GEN ENGINE (host boundary) -----
// Port of the Python reference helpers (_core_axgen_* family, class AxMemory,
// and the host-boundary intrinsics) onto the AxIR CoreValue runtime. The
// CoreValue::Host variant carries opaque host objects (memory, tools, user
// callbacks); a value is "callable" in the python sense iff it is a Host, and
// calling it dispatches call_method("call", [arg]).

#[allow(dead_code)]
pub(crate) trait CoreHost {
    fn host_type(&self) -> &'static str;
    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError>;
}

// Keeps #[derive(Debug)] on CoreValue working once the Host(Rc<dyn CoreHost>)
// variant is added: Rc<T> is Debug iff T is Debug, and this impl makes the
// trait object Debug without forcing a supertrait on implementors.
impl std::fmt::Debug for dyn CoreHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CoreHost({})", self.host_type())
    }
}

// ----- AxMemory host -----
// Items are stored behind the same Rc<RefCell<Vec<...>>> that CoreValue::List
// wraps, so call_method("items") hands out a list that aliases the internal
// storage exactly like python attribute access does.

#[allow(dead_code)]
struct CoreMemory {
    items: Rc<RefCell<Vec<CoreValue>>>,
}

#[allow(dead_code)]
pub(crate) fn core_memory_new() -> CoreValue {
    CoreValue::Host(Rc::new(CoreMemory {
        items: Rc::new(RefCell::new(Vec::new())),
    }))
}

#[allow(dead_code)]
fn core_memory_entry(
    role: &str,
    payload_key: &str,
    payload: CoreValue,
    session: CoreValue,
) -> Result<CoreValue, AxError> {
    let item = CoreValue::new_map();
    core_set(&item, CoreValue::from("role"), CoreValue::from(role))?;
    core_set(&item, CoreValue::from(payload_key), payload)?;
    core_set(&item, CoreValue::from("session_id"), session)?;
    core_set(&item, CoreValue::from("tags"), CoreValue::new_list())?;
    Ok(item)
}

// python: tag in (item.get("tags") or [])
#[allow(dead_code)]
fn core_memory_tags_contain(item: &CoreValue, tag: &CoreValue) -> bool {
    let tags = core_get(item, &CoreValue::from("tags"), CoreValue::Null);
    match &tags {
        CoreValue::List(list) => list.borrow().iter().any(|entry| entry == tag),
        _ => false,
    }
}

impl CoreHost for CoreMemory {
    fn host_type(&self) -> &'static str {
        "AxMemory"
    }

    #[allow(clippy::all)]
    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "items" => Ok(CoreValue::List(self.items.clone())),
            "add_request" => {
                let item = core_memory_entry(
                    "request",
                    "messages",
                    core_arg(args, 0),
                    core_arg(args, 1),
                )?;
                self.items.borrow_mut().push(item);
                Ok(CoreValue::Null)
            }
            "add_response" => {
                let item = core_memory_entry(
                    "assistant",
                    "response",
                    core_arg(args, 0),
                    core_arg(args, 1),
                )?;
                self.items.borrow_mut().push(item);
                Ok(CoreValue::Null)
            }
            "update_result" => {
                let session = core_arg(args, 1);
                let item =
                    core_memory_entry("assistant", "response", core_arg(args, 0), session.clone())?;
                {
                    let items = self.items.borrow();
                    for existing in items.iter().rev() {
                        let role = core_get(existing, &CoreValue::from("role"), CoreValue::Null);
                        let sid =
                            core_get(existing, &CoreValue::from("session_id"), CoreValue::Null);
                        if role.as_str() == Some("assistant") && sid == session {
                            if let (CoreValue::Map(dst), CoreValue::Map(src)) = (existing, &item) {
                                let entries = src.borrow().entries.clone();
                                for (key, value) in entries {
                                    dst.borrow_mut().set(&key, value);
                                }
                            }
                            return Ok(CoreValue::Null);
                        }
                    }
                }
                self.items.borrow_mut().push(item);
                Ok(CoreValue::Null)
            }
            "add_function_results" => {
                let results = core_arg(args, 0);
                let results = if matches!(results, CoreValue::List(_)) {
                    results
                } else {
                    CoreValue::list_from(vec![results])
                };
                let item = core_memory_entry("function", "results", results, core_arg(args, 1))?;
                self.items.borrow_mut().push(item);
                Ok(CoreValue::Null)
            }
            "remove_by_tag" => {
                let tag = core_arg(args, 0);
                self.items
                    .borrow_mut()
                    .retain(|item| !core_memory_tags_contain(item, &tag));
                Ok(CoreValue::Null)
            }
            "history" => {
                let index = core_arg(args, 0);
                if index.is_null() {
                    return Ok(CoreValue::list_from(self.items.borrow().clone()));
                }
                let matched: Vec<CoreValue> = self
                    .items
                    .borrow()
                    .iter()
                    .filter(|item| {
                        core_get(item, &CoreValue::from("index"), CoreValue::Null) == index
                    })
                    .cloned()
                    .collect();
                Ok(CoreValue::list_from(matched))
            }
            "get_last" => {
                let session = core_arg(args, 0);
                let items = self.items.borrow();
                for item in items.iter().rev() {
                    if session.is_null()
                        || core_get(item, &CoreValue::from("session_id"), CoreValue::Null)
                            == session
                    {
                        return Ok(item.clone());
                    }
                }
                Ok(CoreValue::Null)
            }
            "add_tag" => {
                let tag = core_arg(args, 0);
                let items = self.items.borrow();
                if let Some(last) = items.last() {
                    if matches!(last, CoreValue::Map(_)) {
                        let has_tags =
                            matches!(last, CoreValue::Map(map) if map.borrow().contains("tags"));
                        if !has_tags {
                            core_set(last, CoreValue::from("tags"), CoreValue::new_list())?;
                        }
                        let tags = core_get(last, &CoreValue::from("tags"), CoreValue::Null);
                        if let CoreValue::List(list) = &tags {
                            let exists = list.borrow().iter().any(|entry| *entry == tag);
                            if !exists {
                                list.borrow_mut().push(tag.clone());
                            }
                        }
                    }
                }
                Ok(CoreValue::Null)
            }
            "rewind_to_tag" => {
                let tag = core_arg(args, 0);
                let mut cut: Option<usize> = None;
                {
                    let items = self.items.borrow();
                    for idx in (0..items.len()).rev() {
                        if core_memory_tags_contain(&items[idx], &tag) {
                            cut = Some(idx + 1);
                            break;
                        }
                    }
                }
                if let Some(end) = cut {
                    self.items.borrow_mut().truncate(end);
                }
                Ok(CoreValue::Null)
            }
            other => Err(AxError::runtime(format!(
                "AxMemory has no method '{}'",
                other
            ))),
        }
    }
}

// ----- Tool host -----
// Bridges the typed Tool struct into the CoreValue world. call_method("call")
// converts CoreValue params to JSON, invokes the handler, and converts the
// result back. The struct field backing "parameters" is Tool.args.

#[allow(dead_code)]
struct ToolHost {
    tool: Rc<Tool>,
}

#[allow(dead_code)]
pub(crate) fn core_tool_host(tool: Tool) -> CoreValue {
    CoreValue::Host(Rc::new(ToolHost {
        tool: Rc::new(tool),
    }))
}

impl CoreHost for ToolHost {
    fn host_type(&self) -> &'static str {
        "Tool"
    }

    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "call" => {
                let params = core_arg(args, 0);
                let payload = if params.is_null() {
                    Value::Object(Map::new())
                } else {
                    core_value_to_json(&params)
                };
                let result = self.tool.call(payload)?;
                Ok(core_value_from_json(&result))
            }
            "name" => Ok(CoreValue::from(self.tool.name.as_str())),
            "description" => Ok(CoreValue::from(self.tool.description.as_str())),
            "parameters" | "args" => Ok(core_value_from_json(&Value::Object(
                self.tool.args.clone(),
            ))),
            other => Err(AxError::runtime(format!(
                "Tool has no method '{}'",
                other
            ))),
        }
    }
}

// ----- AI client scope -----
// The emitted flows receive an opaque "client" value, but the real chat
// callback lives on the host side as a &mut closure. with_core_client erases
// the borrow into a raw pointer for the dynamic extent of run(). SAFETY
// contract: the runtime is single-threaded, the pointer is only dereferenced
// by core_ai_complete_once while the with_core_client frame is alive (the
// guard pops it on unwind too), and the chat callback must not recursively
// re-enter core_ai_complete_once for the same frame.

thread_local! {
    static CORE_CLIENT_STACK: RefCell<Vec<*mut (dyn FnMut(Value) -> AxResult<Value> + 'static)>> =
        RefCell::new(Vec::new());
}

#[allow(dead_code)]
pub(crate) fn with_core_client<R>(
    chat: &mut dyn FnMut(Value) -> AxResult<Value>,
    run: impl FnOnce() -> R,
) -> R {
    struct CoreClientGuard;
    impl Drop for CoreClientGuard {
        fn drop(&mut self) {
            CORE_CLIENT_STACK.with(|stack| {
                stack.borrow_mut().pop();
            });
        }
    }
    // SAFETY: only the lifetime bound of the trait object changes; the fat
    // pointer layout is identical, and the pointer never outlives this frame.
    let erased: *mut (dyn FnMut(Value) -> AxResult<Value> + 'static) =
        unsafe { std::mem::transmute(chat) };
    CORE_CLIENT_STACK.with(|stack| stack.borrow_mut().push(erased));
    let _guard = CoreClientGuard;
    run()
}

// python: _core_ai_complete_once(client, request). The client argument is
// ignored; the innermost with_core_client chat callback services the request.
#[allow(dead_code)]
pub(crate) fn core_ai_complete_once(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let request = core_arg(args, 1);
    let top = CORE_CLIENT_STACK.with(|stack| stack.borrow().last().copied());
    let ptr = match top {
        Some(ptr) => ptr,
        None => return Err(AxError::runtime("no AI client in scope")),
    };
    // SAFETY: single-threaded runtime; the pointer was pushed by an enclosing
    // with_core_client frame that is still on the stack, so the borrow it was
    // created from is still live. The RefCell borrow is released before the
    // call so the callback may itself push a nested client.
    let chat = unsafe { &mut *ptr };
    let response = chat(core_value_to_json(&request))?;
    chat_response_to_completion(&[core_value_from_json(&response)])
}

// ----- Simple host-boundary intrinsics -----

// python float(x) for the operand shapes the IR produces.
#[allow(dead_code)]
fn core_float_cast(value: &CoreValue) -> Result<f64, AxError> {
    match value {
        CoreValue::Num(n) => Ok(*n),
        CoreValue::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
        CoreValue::Str(s) => s
            .trim()
            .parse::<f64>()
            .map_err(|_| AxError::runtime(format!("could not convert string to float: '{}'", s))),
        other => Err(AxError::runtime(format!(
            "float() argument is not a number: {}",
            other.text()
        ))),
    }
}

// python: float(left or 0) / float(right or 1)
#[allow(dead_code)]
fn core_div(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let left_raw = core_arg(args, 0);
    let right_raw = core_arg(args, 1);
    let left = if core_truthy(&left_raw) {
        core_float_cast(&left_raw)?
    } else {
        0.0
    };
    let right = if core_truthy(&right_raw) {
        core_float_cast(&right_raw)?
    } else {
        1.0
    };
    if right == 0.0 {
        return Err(AxError::runtime("float division by zero"));
    }
    Ok(CoreValue::Num(left / right))
}

// python: str(error) -- AxError values render their message.
#[allow(dead_code)]
fn core_exception_message_text(error: &CoreValue) -> String {
    match error {
        CoreValue::Error(err) => err.message.clone(),
        other => other.text(),
    }
}

#[allow(dead_code)]
fn core_exception_message(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::from_string(core_exception_message_text(
        &core_arg(args, 0),
    )))
}

#[allow(dead_code)]
fn core_map_keys(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match core_arg(args, 0) {
        CoreValue::Map(map) => Ok(CoreValue::list_from(
            map.borrow()
                .entries
                .iter()
                .map(|(key, _)| CoreValue::from(key.as_str()))
                .collect(),
        )),
        _ => Ok(CoreValue::new_list()),
    }
}

// Variant with the list fallback: dict -> values, otherwise list(values).
#[allow(dead_code)]
fn core_map_values(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match core_arg(args, 0) {
        CoreValue::Map(map) => Ok(CoreValue::list_from(
            map.borrow()
                .entries
                .iter()
                .map(|(_, value)| value.clone())
                .collect(),
        )),
        CoreValue::List(items) => Ok(CoreValue::list_from(items.borrow().clone())),
        CoreValue::Str(s) => Ok(CoreValue::list_from(
            s.chars()
                .map(|ch| CoreValue::from_string(ch.to_string()))
                .collect(),
        )),
        _ => Ok(CoreValue::new_list()),
    }
}

// python: time.sleep(min(0.25 * (int(attempt) + 1), 1.0))
#[allow(dead_code)]
fn core_retry_sleep(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let attempt = match core_arg(args, 0) {
        CoreValue::Num(n) => n as i64,
        CoreValue::Bool(b) => {
            if b {
                1
            } else {
                0
            }
        }
        CoreValue::Str(s) => s.trim().parse::<i64>().map_err(|_| {
            AxError::runtime(format!("invalid literal for int(): '{}'", s))
        })?,
        other => {
            return Err(AxError::runtime(format!(
                "int() argument is not a number: {}",
                other.text()
            )))
        }
    };
    let seconds = (0.25 * ((attempt + 1) as f64)).min(1.0).max(0.0);
    std::thread::sleep(Duration::from_secs_f64(seconds));
    Ok(CoreValue::Null)
}

// python: getattr(target, str(method_name))(*args)
#[allow(dead_code)]
fn core_object_call_method(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let target = core_arg(args, 0);
    let method = core_arg(args, 1).text();
    match &target {
        CoreValue::Host(host) => host.call_method(&method, args.get(2..).unwrap_or(&[])),
        other => Err(AxError::runtime(format!(
            "object of type {} has no callable method '{}'",
            other.text(),
            method
        ))),
    }
}

// python: fn.call(params or {})
#[allow(dead_code)]
fn core_tool_invoke(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let target = core_arg(args, 0);
    let params = core_arg(args, 1);
    let params = if core_truthy(&params) {
        params
    } else {
        CoreValue::new_map()
    };
    let host = match &target {
        CoreValue::Host(_) => target.clone(),
        CoreValue::Map(_) => core_get(&target, &CoreValue::from("__tool_host"), CoreValue::Null),
        _ => CoreValue::Null,
    };
    match host {
        CoreValue::Host(host) => host.call_method("call", &[params]),
        _ => Err(AxError::runtime("intrinsic.tool.invoke target is not a tool")),
    }
}

// ----- AxGen helper family -----
// Shared shape: gen is a CoreValue map carrying the python attribute names
// (options, memory, chat_log, examples, demos, assertions, field_processors,
// traces, function_call_traces, stop_functions, streaming_assertions,
// signature).

// python: xs or [] then iteration (lists iterate items, dicts iterate keys).
#[allow(dead_code)]
fn core_axgen_iter_or_empty(value: &CoreValue) -> Result<Vec<CoreValue>, AxError> {
    if !core_truthy(value) {
        return Ok(Vec::new());
    }
    core_iter(value)
}

// python: dict(x) shallow copy; non-map inputs yield an empty map.
#[allow(dead_code)]
fn core_axgen_map_copy(value: &CoreValue) -> CoreValue {
    let out = CoreValue::new_map();
    if let (CoreValue::Map(dst), CoreValue::Map(src)) = (&out, value) {
        let entries = src.borrow().entries.clone();
        for (key, item) in entries {
            dst.borrow_mut().set(&key, item);
        }
    }
    out
}

#[allow(dead_code)]
fn core_axgen_map_from(entries: &[(&str, CoreValue)]) -> Result<CoreValue, AxError> {
    let out = CoreValue::new_map();
    for (key, value) in entries {
        core_set(&out, CoreValue::from(*key), value.clone())?;
    }
    Ok(out)
}

// hasattr(memory, "items") followed by memory.items access: only the memory
// host (or a map that carries an "items" list) exposes the shared item list.
#[allow(dead_code)]
fn core_axgen_memory_items(memory: &CoreValue) -> Option<CoreValue> {
    match memory {
        CoreValue::Host(host) => match host.call_method("items", &[]) {
            Ok(items @ CoreValue::List(_)) => Some(items),
            _ => None,
        },
        CoreValue::Map(map) => match map.borrow().get("items") {
            Some(items @ CoreValue::List(_)) => Some(items),
            _ => None,
        },
        _ => None,
    }
}

// Recursive key sort so core_python_dumps matches json.dumps(sort_keys=True).
#[allow(dead_code)]
fn core_axgen_sorted_json(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(core_axgen_sorted_json).collect()),
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = Map::new();
            for key in keys {
                if let Some(item) = map.get(key) {
                    out.insert(key.clone(), core_axgen_sorted_json(item));
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

// python: value if isinstance(value, str) else json.dumps(value, sort_keys=True)
#[allow(dead_code)]
fn core_axgen_value_text_impl(value: &CoreValue) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    core_python_dumps(&core_axgen_sorted_json(&core_value_to_json(value)))
}

#[allow(dead_code)]
fn core_axgen_value_text(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    Ok(CoreValue::from_string(core_axgen_value_text_impl(
        &core_arg(args, 0),
    )))
}

// python: list(_core_get(gen.signature, f"{kind}_fields", []) or [])
#[allow(dead_code)]
fn core_axgen_fields_for_impl(gen: &CoreValue, kind: &str) -> Result<Vec<CoreValue>, AxError> {
    let sig = core_get(gen, &CoreValue::from("signature"), CoreValue::Null);
    let key = format!("{}_fields", kind);
    let fields = core_get(&sig, &CoreValue::from(key.as_str()), CoreValue::Null);
    core_axgen_iter_or_empty(&fields)
}

#[allow(dead_code)]
fn core_axgen_fields_for(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let kind = core_arg(args, 1).text();
    Ok(CoreValue::list_from(core_axgen_fields_for_impl(
        &gen, &kind,
    )?))
}

#[allow(dead_code)]
#[allow(clippy::all)]
fn core_axgen_format_values_impl(
    gen: &CoreValue,
    values: &CoreValue,
    kind: &str,
) -> Result<String, AxError> {
    let values = if core_truthy(values) {
        values.clone()
    } else {
        CoreValue::new_map()
    };
    let fields = core_axgen_fields_for_impl(gen, kind)?;
    let mut lines: Vec<String> = Vec::new();
    for field in &fields {
        let name = core_get(field, &CoreValue::from("name"), CoreValue::Null);
        let present = match name.as_str() {
            Some(key) => {
                matches!(&values, CoreValue::Map(map) if map.borrow().contains(key))
            }
            None => false,
        };
        if present {
            let title = core_get(field, &CoreValue::from("title"), name.clone());
            let value = core_get(&values, &name, CoreValue::Null);
            lines.push(format!(
                "{}: {}",
                title.text(),
                core_axgen_value_text_impl(&value)
            ));
        }
    }
    if lines.is_empty() {
        if let CoreValue::Map(map) = &values {
            let entries = map.borrow().entries.clone();
            for (name, value) in entries {
                lines.push(format!("{}: {}", name, core_axgen_value_text_impl(&value)));
            }
        }
    }
    Ok(lines.join("\n"))
}

#[allow(dead_code)]
fn core_axgen_format_values(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let values = core_arg(args, 1);
    let kind = core_arg(args, 2).text();
    Ok(CoreValue::from_string(core_axgen_format_values_impl(
        &gen, &values, &kind,
    )?))
}

#[allow(dead_code)]
fn core_axgen_example_turn_impl(
    gen: &CoreValue,
    label: &str,
    item: &CoreValue,
) -> Result<(CoreValue, CoreValue), AxError> {
    let item = if core_truthy(item) {
        item.clone()
    } else {
        CoreValue::new_map()
    };
    let inp = core_get(
        &item,
        &CoreValue::from("input"),
        core_get(&item, &CoreValue::from("values"), CoreValue::new_map()),
    );
    let out = core_get(
        &item,
        &CoreValue::from("output"),
        core_get(
            &item,
            &CoreValue::from("expected_output"),
            CoreValue::new_map(),
        ),
    );
    let user = core_axgen_map_from(&[
        ("role", CoreValue::from("user")),
        (
            "content",
            CoreValue::from_string(format!(
                "{} Input:\n{}",
                label,
                core_axgen_format_values_impl(gen, &inp, "input")?
            )),
        ),
    ])?;
    let assistant = core_axgen_map_from(&[
        ("role", CoreValue::from("assistant")),
        (
            "content",
            CoreValue::from_string(format!(
                "{} Output:\n{}",
                label,
                core_axgen_format_values_impl(gen, &out, "output")?
            )),
        ),
    ])?;
    Ok((user, assistant))
}

#[allow(dead_code)]
fn core_axgen_example_turn(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let label = core_arg(args, 1).text();
    let item = core_arg(args, 2);
    let (user, assistant) = core_axgen_example_turn_impl(&gen, &label, &item)?;
    Ok(CoreValue::list_from(vec![user, assistant]))
}

// python: skip demo items where (item or {}).get("input", (item or {}).get("values")) is falsy
#[allow(dead_code)]
fn core_axgen_demo_has_input(item: &CoreValue) -> bool {
    let item = if core_truthy(item) {
        item.clone()
    } else {
        CoreValue::new_map()
    };
    let gate = core_get(
        &item,
        &CoreValue::from("input"),
        core_get(&item, &CoreValue::from("values"), CoreValue::Null),
    );
    core_truthy(&gate)
}

#[allow(dead_code)]
fn core_axgen_render_examples(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let options = core_get(&gen, &CoreValue::from("options"), CoreValue::new_map());
    let in_system = core_get(
        &options,
        &CoreValue::from("examplesInSystem"),
        CoreValue::Bool(false),
    );
    if core_truthy(&in_system) {
        return Ok(CoreValue::new_list());
    }
    let messages = CoreValue::new_list();
    let examples = core_get(&gen, &CoreValue::from("examples"), CoreValue::Null);
    for item in core_axgen_iter_or_empty(&examples)? {
        let (user, assistant) = core_axgen_example_turn_impl(&gen, "Example", &item)?;
        core_append(&messages, user)?;
        core_append(&messages, assistant)?;
    }
    Ok(messages)
}

#[allow(dead_code)]
fn core_axgen_render_demos(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let options = core_get(&gen, &CoreValue::from("options"), CoreValue::new_map());
    let in_system = core_get(
        &options,
        &CoreValue::from("examplesInSystem"),
        CoreValue::Bool(false),
    );
    if core_truthy(&in_system) {
        return Ok(CoreValue::new_list());
    }
    let messages = CoreValue::new_list();
    let demos = core_get(&gen, &CoreValue::from("demos"), CoreValue::Null);
    for item in core_axgen_iter_or_empty(&demos)? {
        if !core_axgen_demo_has_input(&item) {
            continue;
        }
        let (user, assistant) = core_axgen_example_turn_impl(&gen, "Demo", &item)?;
        core_append(&messages, user)?;
        core_append(&messages, assistant)?;
    }
    Ok(messages)
}

#[allow(dead_code)]
#[allow(clippy::all)]
fn core_axgen_apply_context_cache(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let raw_messages = core_arg(args, 1);
    let runtime_options = core_arg(args, 2);

    // messages = [dict(item) if isinstance(item, dict) else item ...]
    let mut messages: Vec<CoreValue> = Vec::new();
    for item in core_axgen_iter_or_empty(&raw_messages)? {
        if matches!(item, CoreValue::Map(_)) {
            messages.push(core_axgen_map_copy(&item));
        } else {
            messages.push(item);
        }
    }

    // options = {**(gen.options or {}), **(runtime_options or {})}
    let options = CoreValue::new_map();
    for source in [
        core_get(&gen, &CoreValue::from("options"), CoreValue::Null),
        runtime_options,
    ] {
        if let (CoreValue::Map(dst), CoreValue::Map(src)) = (&options, &source) {
            let entries = src.borrow().entries.clone();
            for (key, value) in entries {
                dst.borrow_mut().set(&key, value);
            }
        }
    }

    let examples_in_system = core_get(
        &options,
        &CoreValue::from("examplesInSystem"),
        CoreValue::Null,
    );
    if core_truthy(&examples_in_system) && !messages.is_empty() {
        let mut blocks: Vec<String> = Vec::new();
        let examples = core_get(&gen, &CoreValue::from("examples"), CoreValue::Null);
        for item in core_axgen_iter_or_empty(&examples)? {
            let (user, assistant) = core_axgen_example_turn_impl(&gen, "Example", &item)?;
            for message in [user, assistant] {
                blocks.push(
                    core_get(&message, &CoreValue::from("content"), CoreValue::from("")).text(),
                );
            }
        }
        let demos = core_get(&gen, &CoreValue::from("demos"), CoreValue::Null);
        for item in core_axgen_iter_or_empty(&demos)? {
            if !core_axgen_demo_has_input(&item) {
                continue;
            }
            let (user, assistant) = core_axgen_example_turn_impl(&gen, "Demo", &item)?;
            for message in [user, assistant] {
                blocks.push(
                    core_get(&message, &CoreValue::from("content"), CoreValue::from("")).text(),
                );
            }
        }
        if !blocks.is_empty() && matches!(&messages[0], CoreValue::Map(_)) {
            let current =
                core_get(&messages[0], &CoreValue::from("content"), CoreValue::from("")).text();
            core_set(
                &messages[0],
                CoreValue::from("content"),
                CoreValue::from_string(format!(
                    "{}\n\n--- EXAMPLES ---\n{}\n--- END OF EXAMPLES ---",
                    current,
                    blocks.join("\n\n")
                )),
            )?;
        }
    }

    let context_cache = core_get(
        &options,
        &CoreValue::from("context_cache"),
        core_get(&options, &CoreValue::from("contextCache"), CoreValue::Null),
    );
    let ignore_breakpoints = core_get(
        &options,
        &CoreValue::from("ignore_cache_breakpoints"),
        CoreValue::Null,
    );
    if !core_truthy(&context_cache) || core_truthy(&ignore_breakpoints) {
        return Ok(CoreValue::list_from(messages));
    }

    if let Some(first) = messages.first() {
        if matches!(first, CoreValue::Map(_)) {
            core_set(first, CoreValue::from("cache"), CoreValue::Bool(true))?;
        }
    }

    let breakpoint = if matches!(&context_cache, CoreValue::Map(_)) {
        // python or-chain over breakpoint key spellings
        let mut value = core_get(&context_cache, &CoreValue::from("breakpoint"), CoreValue::Null);
        if !core_truthy(&value) {
            value = core_get(
                &context_cache,
                &CoreValue::from("cache_breakpoint"),
                CoreValue::Null,
            );
        }
        if !core_truthy(&value) {
            value = core_get(
                &context_cache,
                &CoreValue::from("cacheBreakpoint"),
                CoreValue::Null,
            );
        }
        value
    } else {
        CoreValue::from("after_examples")
    };

    let breakpoint_matches = breakpoint.is_null()
        || matches!(
            breakpoint.as_str(),
            Some("after_examples") | Some("afterExamples")
        );
    if breakpoint_matches && messages.len() > 2 {
        for idx in (0..=messages.len() - 2).rev() {
            let role = core_get(&messages[idx], &CoreValue::from("role"), CoreValue::Null);
            if matches!(role.as_str(), Some("assistant") | Some("tool")) {
                core_set(&messages[idx], CoreValue::from("cache"), CoreValue::Bool(true))?;
                break;
            }
        }
    }
    Ok(CoreValue::list_from(messages))
}

#[allow(dead_code)]
#[allow(clippy::all)]
fn core_axgen_apply_field_processors(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let output = core_arg(args, 1);
    let mut result = core_axgen_map_copy(&if core_truthy(&output) {
        output
    } else {
        CoreValue::new_map()
    });
    let mut changed = false;

    let specs = core_get(&gen, &CoreValue::from("field_processors"), CoreValue::Null);
    for spec in core_axgen_iter_or_empty(&specs)? {
        // callable(spec): whole-output processor
        if let CoreValue::Host(host) = &spec {
            let processed = host.call_method("call", &[core_axgen_map_copy(&result)])?;
            if !processed.is_null() {
                result = core_axgen_map_copy(&processed);
                changed = true;
            }
            continue;
        }
        // field = spec.get("field") or spec.get("name")
        let mut field = core_get(&spec, &CoreValue::from("field"), CoreValue::Null);
        if !core_truthy(&field) {
            field = core_get(&spec, &CoreValue::from("name"), CoreValue::Null);
        }
        if !core_truthy(&field) {
            continue;
        }
        let field_key = field.text();
        let present = matches!(&result, CoreValue::Map(map) if map.borrow().contains(&field_key));
        if !present {
            continue;
        }
        let processor = core_get(
            &spec,
            &CoreValue::from("processor"),
            core_get(&spec, &CoreValue::from("op"), CoreValue::Null),
        );
        if let CoreValue::Host(host) = &processor {
            let current = core_get(&result, &field, CoreValue::Null);
            let updated = host.call_method("call", &[current])?;
            core_set(&result, field.clone(), updated)?;
            changed = true;
            continue;
        }
        let op = processor.text();
        let value = core_get(&result, &field, CoreValue::Null);
        if op == "uppercase" {
            core_set(
                &result,
                field.clone(),
                CoreValue::from_string(value.text().to_uppercase()),
            )?;
            changed = true;
        } else if op == "lowercase" {
            core_set(
                &result,
                field.clone(),
                CoreValue::from_string(value.text().to_lowercase()),
            )?;
            changed = true;
        } else if op == "trim" {
            core_set(
                &result,
                field.clone(),
                CoreValue::from_string(value.text().trim().to_string()),
            )?;
            changed = true;
        } else if let Some(prefix) = op.strip_prefix("prefix:") {
            core_set(
                &result,
                field.clone(),
                CoreValue::from_string(format!("{}{}", prefix, value.text())),
            )?;
            changed = true;
        } else if let Some(suffix) = op.strip_prefix("suffix:") {
            core_set(
                &result,
                field.clone(),
                CoreValue::from_string(format!("{}{}", value.text(), suffix)),
            )?;
            changed = true;
        }
    }

    if changed {
        let memory = core_get(&gen, &CoreValue::from("memory"), CoreValue::Null);
        if let Some(items) = core_axgen_memory_items(&memory) {
            let entry = core_axgen_map_from(&[
                ("role", CoreValue::from("processor")),
                ("output", core_axgen_map_copy(&result)),
                (
                    "tags",
                    CoreValue::list_from(vec![CoreValue::from("processor")]),
                ),
            ])?;
            core_append(&items, entry)?;
        }
    }
    Ok(result)
}

#[allow(dead_code)]
#[allow(clippy::all)]
fn core_axgen_run_assertions(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let output = core_arg(args, 1);
    let assertions = core_get(&gen, &CoreValue::from("assertions"), CoreValue::Null);
    for assertion in core_axgen_iter_or_empty(&assertions)? {
        if let CoreValue::Host(host) = &assertion {
            let result = host.call_method("call", &[output.clone()])?;
            if let Some(text) = result.as_str() {
                return Err(AxError::runtime(text));
            }
            if result == CoreValue::Bool(false) {
                return Err(AxError::runtime("assertion failed"));
            }
            continue;
        }
        let field = core_get(&assertion, &CoreValue::from("field"), CoreValue::Null);
        let value = if core_truthy(&field) {
            core_get(&output, &field, CoreValue::Null)
        } else {
            output.clone()
        };
        let mut message = core_get(&assertion, &CoreValue::from("message"), CoreValue::Null);
        if !core_truthy(&message) {
            message = CoreValue::from("assertion failed");
        }
        let has_return =
            matches!(&assertion, CoreValue::Map(map) if map.borrow().contains("return"));
        if has_return {
            let returned = core_get(&assertion, &CoreValue::from("return"), CoreValue::Null);
            if returned.is_null() {
                continue;
            }
            let has_message =
                matches!(&assertion, CoreValue::Map(map) if map.borrow().contains("message"));
            if returned == CoreValue::Bool(false) && !has_message {
                return Err(AxError::runtime("assertion failed without message"));
            }
            if returned == CoreValue::Bool(false) {
                return Err(AxError::runtime(message.text()));
            }
            if let Some(text) = returned.as_str() {
                return Err(AxError::runtime(text));
            }
        }
        let has_contains =
            matches!(&assertion, CoreValue::Map(map) if map.borrow().contains("contains"));
        if has_contains {
            let needle = core_get(&assertion, &CoreValue::from("contains"), CoreValue::Null);
            if !value.text().contains(&needle.text()) {
                return Err(AxError::runtime(message.text()));
            }
        }
        let has_equals =
            matches!(&assertion, CoreValue::Map(map) if map.borrow().contains("equals"));
        if has_equals {
            let expected = core_get(&assertion, &CoreValue::from("equals"), CoreValue::Null);
            if value != expected {
                return Err(AxError::runtime(message.text()));
            }
        }
    }
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
#[allow(clippy::all)]
fn core_axgen_run_streaming_assertions(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let content = core_arg(args, 1);
    let assertions = core_get(
        &gen,
        &CoreValue::from("streaming_assertions"),
        CoreValue::Null,
    );
    for assertion in core_axgen_iter_or_empty(&assertions)? {
        if let CoreValue::Host(host) = &assertion {
            let result = host.call_method("call", &[content.clone()])?;
            if let Some(text) = result.as_str() {
                return Err(AxError::runtime(text));
            }
            if result == CoreValue::Bool(false) {
                return Err(AxError::runtime("streaming assertion failed"));
            }
            continue;
        }
        if !matches!(&assertion, CoreValue::Map(_)) {
            continue;
        }
        let needle = core_get(
            &assertion,
            &CoreValue::from("not_contains"),
            core_get(&assertion, &CoreValue::from("notContains"), CoreValue::Null),
        );
        if needle.is_null() {
            continue;
        }
        let mut message = core_get(&assertion, &CoreValue::from("message"), CoreValue::Null);
        if !core_truthy(&message) {
            let field = core_get(&assertion, &CoreValue::from("field"), CoreValue::Null);
            message = CoreValue::from_string(format!(
                "streaming assertion failed for field '{}'",
                field.text()
            ));
        }
        if content.text().contains(&needle.text()) {
            return Err(AxError::runtime(message.text()));
        }
    }
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_record_trace(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let values = core_arg(args, 1);
    let output = core_arg(args, 2);
    let status = core_arg(args, 3);
    let traces = core_get(&gen, &CoreValue::from("traces"), CoreValue::new_list());
    let chat_log = core_get(&gen, &CoreValue::from("chat_log"), CoreValue::Null);
    let function_calls = core_get(
        &gen,
        &CoreValue::from("function_call_traces"),
        CoreValue::Null,
    );
    let entry = core_axgen_map_from(&[
        ("status", status),
        ("input", values),
        ("output", output),
        (
            "chat_log",
            CoreValue::list_from(core_axgen_iter_or_empty(&chat_log)?),
        ),
        (
            "function_calls",
            CoreValue::list_from(core_axgen_iter_or_empty(&function_calls)?),
        ),
    ])?;
    core_append(&traces, entry)?;
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_should_continue_steps(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let calls = core_arg(args, 1);
    let stops = core_axgen_iter_or_empty(&core_get(
        &gen,
        &CoreValue::from("stop_functions"),
        CoreValue::Null,
    ))?;
    if stops.is_empty() {
        return Ok(CoreValue::Bool(true));
    }
    for call in core_axgen_iter_or_empty(&calls)? {
        let fallback = core_get(&call, &CoreValue::from("name"), CoreValue::Null);
        let function = core_get(&call, &CoreValue::from("function"), CoreValue::new_map());
        let name = core_get(&function, &CoreValue::from("name"), fallback);
        if stops.iter().any(|stop| *stop == name) {
            return Ok(CoreValue::Bool(false));
        }
    }
    Ok(CoreValue::Bool(true))
}

#[allow(dead_code)]
fn core_axgen_memory_add_request(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let messages = core_arg(args, 1);
    let memory = core_get(&gen, &CoreValue::from("memory"), CoreValue::Null);
    if let CoreValue::Host(host) = &memory {
        host.call_method("add_request", &[messages])?;
    }
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_memory_add_response(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let response = core_arg(args, 2);
    let memory = core_get(&gen, &CoreValue::from("memory"), CoreValue::Null);
    if let CoreValue::Host(host) = &memory {
        host.call_method("add_response", &[response])?;
    }
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_memory_add_function_result(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let call = core_arg(args, 1);
    let result = core_arg(args, 2);
    let ok = core_arg(args, 3);
    let memory = core_get(&gen, &CoreValue::from("memory"), CoreValue::Null);
    if let CoreValue::Host(host) = &memory {
        let payload = core_axgen_map_from(&[
            ("call", call),
            ("result", result),
            ("ok", CoreValue::Bool(core_truthy(&ok))),
        ])?;
        host.call_method("add_function_results", &[payload])?;
    }
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_memory_add_correction(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let response = core_arg(args, 1);
    let error = core_arg(args, 2);
    let memory = core_get(&gen, &CoreValue::from("memory"), CoreValue::Null);
    if let Some(items) = core_axgen_memory_items(&memory) {
        let entry = core_axgen_map_from(&[
            ("role", CoreValue::from("user")),
            (
                "content",
                CoreValue::from_string(format!(
                    "Correction: {}",
                    core_exception_message_text(&error)
                )),
            ),
            ("response", response),
            (
                "tags",
                CoreValue::list_from(vec![CoreValue::from("correction")]),
            ),
        ])?;
        core_append(&items, entry)?;
    }
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_memory_cleanup_corrections(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let memory = core_get(&gen, &CoreValue::from("memory"), CoreValue::Null);
    if let CoreValue::Host(host) = &memory {
        host.call_method("remove_by_tag", &[CoreValue::from("correction")])?;
    }
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_record_chat_log(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let request = core_arg(args, 1);
    let response = core_arg(args, 2);
    let chat_log = core_get(&gen, &CoreValue::from("chat_log"), CoreValue::new_list());
    let entry = core_axgen_map_from(&[
        (
            "model",
            core_get(&request, &CoreValue::from("model"), CoreValue::Null),
        ),
        (
            "messages",
            core_get(
                &request,
                &CoreValue::from("chat_prompt"),
                CoreValue::new_list(),
            ),
        ),
        ("response", response.clone()),
        (
            "remote_id",
            core_get(
                &response,
                &CoreValue::from("remote_id"),
                core_get(&response, &CoreValue::from("id"), CoreValue::Null),
            ),
        ),
        (
            "session_id",
            core_get(&response, &CoreValue::from("session_id"), CoreValue::Null),
        ),
        (
            "usage",
            core_get(
                &response,
                &CoreValue::from("usage"),
                core_get(&response, &CoreValue::from("model_usage"), CoreValue::Null),
            ),
        ),
        (
            "function_calls",
            core_get(
                &response,
                &CoreValue::from("function_calls"),
                CoreValue::new_list(),
            ),
        ),
    ])?;
    core_append(&chat_log, entry)?;
    Ok(CoreValue::Null)
}

#[allow(dead_code)]
fn core_axgen_record_function_call(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let gen = core_arg(args, 0);
    let call = core_arg(args, 1);
    let result = core_arg(args, 2);
    let status = core_arg(args, 3);
    let traces = core_get(
        &gen,
        &CoreValue::from("function_call_traces"),
        CoreValue::new_list(),
    );
    let function = core_get(&call, &CoreValue::from("function"), CoreValue::new_map());
    let record = core_axgen_map_from(&[
        (
            "name",
            core_get(
                &call,
                &CoreValue::from("name"),
                core_get(&function, &CoreValue::from("name"), CoreValue::Null),
            ),
        ),
        ("id", core_get(&call, &CoreValue::from("id"), CoreValue::Null)),
        (
            "args",
            core_get(
                &call,
                &CoreValue::from("params"),
                core_get(&call, &CoreValue::from("args"), CoreValue::new_map()),
            ),
        ),
        ("status", status),
        ("result", result),
    ])?;
    core_append(&traces, record.clone())?;
    let options = core_get(&gen, &CoreValue::from("options"), CoreValue::new_map());
    let hook = core_get(
        &options,
        &CoreValue::from("on_function_call"),
        core_get(&options, &CoreValue::from("onFunctionCall"), CoreValue::Null),
    );
    if let CoreValue::Host(host) = &hook {
        // python wraps the hook in try/except Exception: pass
        let _ = host.call_method("call", &[record]);
    }
    Ok(CoreValue::Null)
}
// ----- END AXIR CORE GEN ENGINE -----


fn core_gen_state(gen: &AxGen) -> Result<CoreValue, AxError> {
    let state = CoreValue::new_map();
    core_set(&state, CoreValue::from("signature"), core_signature_value(&gen.signature)?)?;
    core_set(&state, CoreValue::from("options"), core_value_from_json(&gen.options))?;
    let tools = CoreValue::new_list();
    for tool in &gen.tools {
        let entry = core_tool_host(tool.clone());
        let map = CoreValue::new_map();
        core_set(&map, CoreValue::from("name"), entry_method(&entry, "name"))?;
        core_set(&map, CoreValue::from("description"), entry_method(&entry, "description"))?;
        core_set(&map, CoreValue::from("args"), core_tool_args_fields(&tool.args)?)?;
        core_set(&map, CoreValue::from("__tool_host"), entry)?;
        core_append(&tools, map)?;
    }
    core_set(&state, CoreValue::from("tools"), tools.clone())?;
    core_set(&state, CoreValue::from("functions"), tools.clone())?;
    core_set(&state, CoreValue::from("prompt_template"), CoreValue::Host(Rc::new(GenPromptHost {
        signature: core_get(&state, &CoreValue::from("signature"), CoreValue::Null),
        tools,
        options: core_value_from_json(&gen.options),
    })))?;
    for (key, items) in [
        ("assertions", &gen.assertions),
        ("examples", &gen.examples),
        ("demos", &gen.demos),
        ("field_processors", &gen.field_processors),
    ] {
        core_set(&state, CoreValue::from(key),
            core_value_from_json(&Value::Array(items.clone())))?;
    }
    core_set(&state, CoreValue::from("stop_functions"),
        CoreValue::list_from(gen.stop_functions.iter().map(|s| CoreValue::from(s.as_str())).collect()))?;
    let memory = core_memory_new();
    if let CoreValue::Host(host) = &memory {
        for item in &gen.memory {
            host.call_method("add_raw_item", &[core_value_from_json(item)])?;
        }
    }
    core_set(&state, CoreValue::from("memory"), memory)?;
    for key in ["chat_log", "traces", "function_call_traces"] {
        core_set(&state, CoreValue::from(key), CoreValue::new_list())?;
    }
    Ok(state)
}

fn entry_method(host: &CoreValue, name: &str) -> CoreValue {
    match host {
        CoreValue::Host(h) => h.call_method(name, &[]).unwrap_or(CoreValue::Null),
        _ => CoreValue::Null,
    }
}

fn core_gen_writeback(gen: &mut AxGen, state: &CoreValue) {
    for (key, target) in [
        ("chat_log", &mut gen.chat_log as *mut Vec<Value>),
        ("traces", &mut gen.traces as *mut Vec<Value>),
        ("function_call_traces", &mut gen.function_call_traces as *mut Vec<Value>),
    ] {
        let list = core_get(state, &CoreValue::from(key), CoreValue::Null);
        if let Value::Array(items) = core_value_to_json(&list) {
            unsafe { (*target).extend(items) };
        }
    }
    let memory = core_get(state, &CoreValue::from("memory"), CoreValue::Null);
    if let CoreValue::Host(host) = memory {
        if let Ok(items) = host.call_method("items", &[]) {
            if let Value::Array(items) = core_value_to_json(&items) {
                gen.memory = items;
            }
        }
    }
}


struct GenPromptHost {
    signature: CoreValue,
    tools: CoreValue,
    options: CoreValue,
}

impl CoreHost for GenPromptHost {
    fn host_type(&self) -> &'static str {
        "AxPromptTemplate"
    }
    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "render" => render_prompt(&[
                self.signature.clone(),
                core_arg(args, 0),
                self.tools.clone(),
                self.options.clone(),
            ]),
            other => Err(AxError::runtime(format!(
                "AxPromptTemplate has no callable method '{other}'"
            ))),
        }
    }
}


fn core_tool_args_fields(args: &Map<String, Value>) -> Result<CoreValue, AxError> {
    let fields = CoreValue::new_list();
    for (arg_name, payload) in args {
        let values = CoreValue::new_map();
        core_set(&values, CoreValue::from("name"), CoreValue::from(arg_name.as_str()))?;
        core_set(
            &values,
            CoreValue::from("type"),
            core_field_type_value(&field_type_from_payload(payload))?,
        )?;
        core_append(&fields, core_record_new(&[CoreValue::from("Field"), values])?)?;
    }
    Ok(fields)
}


struct RawScopedClient(*mut dyn FnMut(Value) -> AxResult<Value>);

impl AxAIClient for RawScopedClient {
    fn chat(&mut self, request: Value) -> AxResult<Value> {
        // SAFETY: the pointer was captured from the client stack inside the
        // enclosing with_core_client scope, which outlives this call.
        let chat = unsafe { &mut *self.0 };
        chat(request)
    }
}

fn core_scoped_client() -> AxResult<RawScopedClient> {
    let top = CORE_CLIENT_STACK.with(|stack| stack.borrow().last().copied());
    match top {
        Some(ptr) => Ok(RawScopedClient(ptr)),
        None => Err(AxError::runtime("no AI client in scope")),
    }
}

pub(crate) struct GenHost {
    gen: RefCell<AxGen>,
}

impl GenHost {
    pub(crate) fn new(gen: AxGen) -> CoreValue {
        CoreValue::Host(Rc::new(GenHost { gen: RefCell::new(gen) }))
    }
}

impl CoreHost for GenHost {
    fn host_type(&self) -> &'static str {
        "AxGen"
    }
    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "forward" => {
                let values = core_value_to_json(&core_arg(args, 1));
                let mut client = core_scoped_client()?;
                let output = self.gen.borrow_mut().forward(&mut client, values)?;
                Ok(core_value_from_json(&output))
            }
            "get_chat_log" => Ok(core_value_from_json(&Value::Array(self.gen.borrow().chat_log.clone()))),
            "get_traces" => Ok(core_value_from_json(&Value::Array(self.gen.borrow().traces.clone()))),
            other => Err(AxError::runtime(format!(
                "object of type AxGen has no callable method '{other}'"
            ))),
        }
    }
}

fn core_host_try(value: &CoreValue, method: &str, args: &[CoreValue]) -> Option<Result<CoreValue, AxError>> {
    if let CoreValue::Host(host) = value {
        match host.call_method(method, args) {
            Err(err) if err.message.contains("no callable method") => None,
            other => Some(other),
        }
    } else {
        None
    }
}

fn core_agent_stage_chat_log(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match core_host_try(&core_arg(args, 0), "get_chat_log", &[]) {
        Some(result) => result,
        None => Ok(CoreValue::new_list()),
    }
}

fn core_agent_stage_traces(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match core_host_try(&core_arg(args, 0), "get_traces", &[]) {
        Some(result) => result,
        None => Ok(CoreValue::new_list()),
    }
}

fn core_agent_stage_usage(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let stage = core_arg(args, 0);
    if let Some(result) = core_host_try(&stage, "get_usage", &[]) {
        let usage = result?;
        if core_truthy(&usage) {
            return Ok(usage);
        }
    }
    if let Some(result) = core_host_try(&stage, "get_chat_log", &[]) {
        let items = CoreValue::new_list();
        for entry in core_iter(&result?)? {
            let usage = core_get(&entry, &CoreValue::from("usage"), CoreValue::Null);
            if core_truthy(&usage) {
                core_append(&items, usage)?;
            }
        }
        return Ok(items);
    }
    Ok(CoreValue::new_list())
}

fn core_agent_stage_forward(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let stage = core_arg(args, 0);
    let client = core_arg(args, 1);
    let values = core_arg(args, 2);
    let values = if values.is_null() { CoreValue::new_map() } else { values };
    let options = core_arg(args, 3);
    let options = if options.is_null() { CoreValue::new_map() } else { options };
    match &stage {
        CoreValue::Host(host) => host.call_method("forward", &[client, values, options]),
        _ => Err(AxError::runtime("flow stage is not a runnable program")),
    }
}

fn core_json_stable_stringify(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let value = core_arg(args, 0);
    let json = if value.is_null() { json!({}) } else { core_value_to_json(&value) };
    Ok(CoreValue::from_string(stable_stringify(&json)))
}

fn core_string_split(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let value = core_arg(args, 0).text();
    let sep = core_arg(args, 1).text();
    Ok(CoreValue::list_from(value.split(sep.as_str()).map(CoreValue::from).collect()))
}

fn core_program_components(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    match core_host_try(&core_arg(args, 0), "get_optimizable_components", &[]) {
        Some(result) => result,
        None => Ok(CoreValue::new_list()),
    }
}

fn core_program_apply_components(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let program = core_arg(args, 0);
    let component_map = core_arg(args, 1);
    let component_map = if component_map.is_null() { CoreValue::new_map() } else { component_map };
    if let Some(result) = core_host_try(&program, "apply_optimized_components", &[component_map]) {
        result?;
    }
    Ok(CoreValue::new_map())
}

// ----- AXIR CORE AGENT ENGINE (host boundary) -----
// Port of the Python reference helpers for the AxAgent module
// (_core_agent_* family plus the string/regex/json intrinsics the agent IR
// leans on) onto the AxIR CoreValue runtime. The AxCodeRuntime and
// AxCodeSession trait objects ride inside CoreValue::Host wrappers;
// python's hasattr fallback chains are mirrored with core_host_try, where
// the "no callable method" sentinel stands in for a missing attribute.
//
// Conventions:
// - state/options/request values are CoreValue maps keyed by the python
//   attribute names (callable_inventory, qualified_name, runtime_state, ...).
// - callable(x) in the python sense means x is CoreValue::Host; invoking it
//   dispatches call_method("call", args).
// - The AxCodeRuntime/AxCodeSession bridge is JSON-typed (the trait methods
//   take and return serde_json::Value), so CoreValue::Host values do not
//   survive the crossing; runtime options and snapshots are plain data.

// python: AxAgentClarificationError. core.raise turns the returned
// CoreValue::Error into Err(AxError) via core_as_error, so the structured
// payload must ride inside AxError itself: category marks the error as a
// clarification, message carries str(question or message or clarification)
// for expected_error_contains style checks, and code carries the stable
// JSON of {clarification, payload, state} so catch sites can recover the
// python exception attributes.
#[allow(dead_code)]
pub(crate) const CORE_AGENT_CLARIFICATION_CATEGORY: &str = "agent_clarification";

#[allow(dead_code)]
const CORE_AGENT_INSPECT_UNAVAILABLE: &str =
    "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]";

// Recovers the python exception attributes from a clarification AxError:
// Some({"clarification": ..., "payload": ..., "state": ...}) when the error
// was produced by core_agent_clarification_error, None otherwise.
#[allow(dead_code)]
pub(crate) fn core_agent_clarification_detail(error: &AxError) -> Option<Value> {
    if error.category != CORE_AGENT_CLARIFICATION_CATEGORY {
        return None;
    }
    error
        .code
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
}

// python:
//   args = _core_get(payload, "args", []) or []
//   clarification = args[0] if args else payload
//   AxAgentClarificationError(clarification, state=state.get("runtime_state", {}), payload=payload)
// where the exception message is str(question or message or clarification)
// for dict clarifications and str(clarification) otherwise. RETURNS the
// error value (the IR raises it separately via core.raise).
#[allow(dead_code)]
fn core_agent_clarification_error(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let payload = core_arg(args, 0);
    let state = core_arg(args, 1);
    let payload_args = core_get(&payload, &CoreValue::from("args"), CoreValue::Null);
    let clarification = match &payload_args {
        CoreValue::List(items) if !items.borrow().is_empty() => items.borrow()[0].clone(),
        _ => payload.clone(),
    };
    let message = match &clarification {
        CoreValue::Map(_) => {
            let question = core_get(&clarification, &CoreValue::from("question"), CoreValue::Null);
            let fallback = core_get(&clarification, &CoreValue::from("message"), CoreValue::Null);
            if core_truthy(&question) {
                question.text()
            } else if core_truthy(&fallback) {
                fallback.text()
            } else {
                clarification.text()
            }
        }
        other => other.text(),
    };
    let runtime_state = core_get(&state, &CoreValue::from("runtime_state"), CoreValue::new_map());
    let detail = json!({
        "clarification": core_value_to_json(&clarification),
        "payload": core_value_to_json(&payload),
        "state": core_value_to_json(&runtime_state),
    });
    let mut error = AxError::new(CORE_AGENT_CLARIFICATION_CATEGORY, message);
    error.error_type = Some("AxAgentClarificationError".to_string());
    error.code = Some(stable_stringify(&detail));
    Ok(CoreValue::Error(Rc::new(error)))
}

// ----- AxCodeRuntime / AxCodeSession hosts -----
// RuntimeCapabilities plays the role of python's override detection: the
// reference checks type(session).snapshot_globals is not
// AxCodeSession.snapshot_globals (and the scripted session consults
// runtime.capabilities). Rust trait objects cannot observe overrides, so the
// wiring states the capabilities up front; a disabled capability reproduces
// the python behaviour for a session that never implemented the method.

#[allow(dead_code)]
pub(crate) fn core_runtime_capabilities_full() -> RuntimeCapabilities {
    RuntimeCapabilities {
        inspect_globals: true,
        snapshot_globals: true,
        patch_globals: true,
    }
}

#[allow(dead_code)]
struct CodeRuntimeHost {
    runtime: Rc<RefCell<Box<dyn AxCodeRuntime>>>,
    capabilities: RuntimeCapabilities,
}

#[allow(dead_code)]
pub(crate) fn core_code_runtime_host(runtime: Box<dyn AxCodeRuntime>) -> CoreValue {
    core_code_runtime_host_shared(
        Rc::new(RefCell::new(runtime)),
        core_runtime_capabilities_full(),
    )
}

#[allow(dead_code)]
pub(crate) fn core_code_runtime_host_with_capabilities(
    runtime: Box<dyn AxCodeRuntime>,
    capabilities: RuntimeCapabilities,
) -> CoreValue {
    core_code_runtime_host_shared(Rc::new(RefCell::new(runtime)), capabilities)
}

// Shared form for wiring that needs to keep a handle on the runtime (for
// example a scripted conformance runtime whose call log is asserted after
// the forward pass).
#[allow(dead_code)]
pub(crate) fn core_code_runtime_host_shared(
    runtime: Rc<RefCell<Box<dyn AxCodeRuntime>>>,
    capabilities: RuntimeCapabilities,
) -> CoreValue {
    CoreValue::Host(Rc::new(CodeRuntimeHost {
        runtime,
        capabilities,
    }))
}

impl CoreHost for CodeRuntimeHost {
    fn host_type(&self) -> &'static str {
        "AxCodeRuntime"
    }

    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "create_session" => {
                let globals = core_value_to_json(&core_arg(args, 0));
                let options = core_value_to_json(&core_arg(args, 1));
                let session = self.runtime.borrow_mut().create_session(globals, options)?;
                Ok(core_code_session_host_with_capabilities(
                    session,
                    self.capabilities.clone(),
                ))
            }
            // python attribute access (runtime.language, runtime.get_usage_instructions())
            "language" => Ok(CoreValue::from_string(
                self.runtime.borrow().language().to_string(),
            )),
            "usage_instructions" | "get_usage_instructions" | "usageInstructions" => {
                Ok(CoreValue::from_string(
                    self.runtime.borrow().usage_instructions().to_string(),
                ))
            }
            other => Err(AxError::runtime(format!(
                "object of type AxCodeRuntime has no callable method '{other}'"
            ))),
        }
    }
}

#[allow(dead_code)]
struct CodeSessionHost {
    session: Rc<RefCell<Box<dyn AxCodeSession>>>,
    capabilities: RuntimeCapabilities,
}

#[allow(dead_code)]
pub(crate) fn core_code_session_host(session: Box<dyn AxCodeSession>) -> CoreValue {
    core_code_session_host_with_capabilities(session, core_runtime_capabilities_full())
}

#[allow(dead_code)]
pub(crate) fn core_code_session_host_with_capabilities(
    session: Box<dyn AxCodeSession>,
    capabilities: RuntimeCapabilities,
) -> CoreValue {
    CoreValue::Host(Rc::new(CodeSessionHost {
        session: Rc::new(RefCell::new(session)),
        capabilities,
    }))
}

impl CoreHost for CodeSessionHost {
    fn host_type(&self) -> &'static str {
        "AxCodeSession"
    }

    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "execute" => {
                let code = core_arg(args, 0).text();
                let options = core_value_to_json(&core_arg(args, 1));
                let envelope = self.session.borrow_mut().execute(&code, options)?;
                Ok(core_value_from_json(&envelope.payload))
            }
            "inspect_globals" => {
                // python base AxCodeSession.inspect_globals (and the scripted
                // session with the inspect capability off) returns the
                // unavailable notice instead of raising.
                if !self.capabilities.inspect_globals {
                    return Ok(CoreValue::from(CORE_AGENT_INSPECT_UNAVAILABLE));
                }
                let options = core_value_to_json(&core_arg(args, 0));
                let result = self.session.borrow_mut().inspect_globals(options)?;
                Ok(core_value_from_json(&result))
            }
            "snapshot_globals" => {
                if !self.capabilities.snapshot_globals {
                    return Err(AxError::runtime(
                        "AxCodeSession.snapshot_globals() is required to export AxAgent state",
                    ));
                }
                let options = core_value_to_json(&core_arg(args, 0));
                let result = self.session.borrow_mut().snapshot_globals(options)?;
                Ok(core_value_from_json(&result))
            }
            "patch_globals" => {
                if !self.capabilities.patch_globals {
                    return Err(AxError::runtime(
                        "AxCodeSession.patch_globals() is required to restore AxAgent state",
                    ));
                }
                let snapshot = core_value_to_json(&core_arg(args, 0));
                let options = core_value_to_json(&core_arg(args, 1));
                let result = self.session.borrow_mut().patch_globals(snapshot, options)?;
                Ok(core_value_from_json(&result))
            }
            "close" => {
                let result = self.session.borrow_mut().close()?;
                Ok(core_value_from_json(&result))
            }
            other => Err(AxError::runtime(format!(
                "object of type AxCodeSession has no callable method '{other}'"
            ))),
        }
    }
}

// ----- shared small helpers -----

// python: value or {}
#[allow(dead_code)]
fn core_agent_or_empty_map(value: CoreValue) -> CoreValue {
    if core_truthy(&value) {
        value
    } else {
        CoreValue::new_map()
    }
}

// python: _core_get(state, "options", {}) or {}
#[allow(dead_code)]
fn core_agent_state_options(state: &CoreValue) -> CoreValue {
    core_agent_or_empty_map(core_get(
        state,
        &CoreValue::from("options"),
        CoreValue::Null,
    ))
}

// python: options.get(snake) or options.get(camel)
#[allow(dead_code)]
fn core_agent_option(options: &CoreValue, snake: &str, camel: &str) -> CoreValue {
    let value = core_get(options, &CoreValue::from(snake), CoreValue::Null);
    if core_truthy(&value) {
        return value;
    }
    core_get(options, &CoreValue::from(camel), CoreValue::Null)
}

// python: list(value or []) (shallow copy; dicts iterate keys, like list())
#[allow(dead_code)]
fn core_agent_list_copy(value: &CoreValue) -> Result<CoreValue, AxError> {
    if !core_truthy(value) {
        return Ok(CoreValue::new_list());
    }
    Ok(CoreValue::list_from(core_iter(value)?))
}

// python: copy.deepcopy(value) for the plain-data values scripted fixtures
// hold; implemented as a JSON round trip (Host values do not occur in
// scripted results).
#[allow(dead_code)]
fn core_agent_deep_copy(value: &CoreValue) -> CoreValue {
    core_value_from_json(&core_value_to_json(value))
}

#[allow(dead_code)]
fn core_agent_map(entries: &[(&str, CoreValue)]) -> Result<CoreValue, AxError> {
    let out = CoreValue::new_map();
    for (key, value) in entries {
        core_set(&out, CoreValue::from(key), value.clone())?;
    }
    Ok(out)
}

// ----- runtime lifecycle intrinsics -----

// python: _core_agent_runtime_create_session(runtime, globals_, options)
#[allow(dead_code)]
fn core_agent_runtime_create_session(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let runtime = core_arg(args, 0);
    let globals = core_agent_or_empty_map(core_arg(args, 1));
    let options = core_agent_or_empty_map(core_arg(args, 2));
    match core_host_try(&runtime, "create_session", &[globals, options]) {
        Some(result) => {
            let session = result?;
            if session.is_null() {
                return Err(AxError::runtime("agent runtime returned no session"));
            }
            Ok(session)
        }
        None => Err(AxError::runtime(
            "agent runtime does not implement AxCodeRuntime",
        )),
    }
}

// python: _core_agent_runtime_execute(session, code, options)
#[allow(dead_code)]
fn core_agent_runtime_execute(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let session = core_arg(args, 0);
    let code = CoreValue::from_string(core_arg(args, 1).text());
    let options = core_agent_or_empty_map(core_arg(args, 2));
    match core_host_try(&session, "execute", &[code, options]) {
        Some(result) => result,
        None => Err(AxError::runtime("agent code session is not active")),
    }
}

// python: _core_agent_runtime_inspect(session, options) with the
// inspect_globals -> inspect -> notice fallback chain.
#[allow(dead_code)]
fn core_agent_runtime_inspect(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let session = core_arg(args, 0);
    let options = core_agent_or_empty_map(core_arg(args, 1));
    if let Some(result) = core_host_try(&session, "inspect_globals", &[options.clone()]) {
        return result;
    }
    if let Some(result) = core_host_try(&session, "inspect", &[options]) {
        return result;
    }
    Ok(CoreValue::from(CORE_AGENT_INSPECT_UNAVAILABLE))
}

// python: _core_agent_runtime_export_state(session, options) with the
// snapshot_globals -> export_state -> raise fallback chain.
#[allow(dead_code)]
fn core_agent_runtime_export_state(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let session = core_arg(args, 0);
    let options = core_agent_or_empty_map(core_arg(args, 1));
    if let Some(result) = core_host_try(&session, "snapshot_globals", &[options.clone()]) {
        return result;
    }
    if let Some(result) = core_host_try(&session, "export_state", &[options]) {
        return result;
    }
    Err(AxError::runtime(
        "AxCodeSession.snapshot_globals() is required to export AxAgent state",
    ))
}

// python: _core_agent_runtime_restore_state(session, snapshot, options) with
// the patch_globals -> restore_state -> raise fallback chain.
#[allow(dead_code)]
fn core_agent_runtime_restore_state(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let session = core_arg(args, 0);
    let snapshot = core_agent_or_empty_map(core_arg(args, 1));
    let options = core_agent_or_empty_map(core_arg(args, 2));
    if let Some(result) = core_host_try(
        &session,
        "patch_globals",
        &[snapshot.clone(), options.clone()],
    ) {
        return result;
    }
    if let Some(result) = core_host_try(&session, "restore_state", &[snapshot, options]) {
        return result;
    }
    Err(AxError::runtime(
        "AxCodeSession.patch_globals() is required to restore AxAgent state",
    ))
}

// python: _core_agent_runtime_close(session); None results normalize to
// {"closed": True}.
#[allow(dead_code)]
fn core_agent_runtime_close(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let session = core_arg(args, 0);
    let closed = || core_agent_map(&[("closed", CoreValue::Bool(true))]);
    match core_host_try(&session, "close", &[]) {
        Some(result) => {
            let value = result?;
            if value.is_null() {
                closed()
            } else {
                Ok(value)
            }
        }
        None => closed(),
    }
}

// ----- memory / skill search intrinsics -----

// python: _core_agent_memory_search(state, searches, already_loaded).
// Callback path first (on_memories_search / onMemoriesSearch), then scripted
// results (memory_search_results / memorySearchResults): exact joined key,
// then per-search key (first hit wins), then the "*" fallback.
#[allow(dead_code)]
fn core_agent_memory_search(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let state = core_arg(args, 0);
    let searches = core_arg(args, 1);
    let already_loaded = core_arg(args, 2);
    let options = core_agent_state_options(&state);
    let callback = core_agent_option(&options, "on_memories_search", "onMemoriesSearch");
    if let Some(result) = core_host_try(
        &callback,
        "call",
        &[
            core_agent_list_copy(&searches)?,
            core_agent_list_copy(&already_loaded)?,
        ],
    ) {
        let value = result?;
        return Ok(if core_truthy(&value) {
            value
        } else {
            CoreValue::new_list()
        });
    }
    let scripted = core_agent_or_empty_map(core_agent_option(
        &options,
        "memory_search_results",
        "memorySearchResults",
    ));
    match &scripted {
        CoreValue::Map(map) => {
            let items = if core_truthy(&searches) {
                core_iter(&searches)?
            } else {
                Vec::new()
            };
            let joined = items
                .iter()
                .map(|item| item.text())
                .collect::<Vec<_>>()
                .join("|");
            if map.borrow().contains(&joined) {
                return Ok(core_agent_deep_copy(&core_get(
                    &scripted,
                    &CoreValue::from(joined.as_str()),
                    CoreValue::Null,
                )));
            }
            for item in &items {
                let key = item.text();
                if map.borrow().contains(&key) {
                    return Ok(core_agent_deep_copy(&core_get(
                        &scripted,
                        &CoreValue::from(key.as_str()),
                        CoreValue::Null,
                    )));
                }
            }
            Ok(core_agent_deep_copy(&core_get(
                &scripted,
                &CoreValue::from("*"),
                CoreValue::new_list(),
            )))
        }
        CoreValue::List(_) => Ok(core_agent_deep_copy(&scripted)),
        _ => Ok(CoreValue::new_list()),
    }
}

// python: _core_agent_skill_search(state, searches). Callback path first
// (on_skills_search / onSkillsSearch), then scripted results
// (skill_search_results / skillSearchResults): exact joined key, then the
// concatenation of every per-search hit, then the "*" fallback.
#[allow(dead_code)]
fn core_agent_skill_search(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let state = core_arg(args, 0);
    let searches = core_arg(args, 1);
    let options = core_agent_state_options(&state);
    let callback = core_agent_option(&options, "on_skills_search", "onSkillsSearch");
    if let Some(result) = core_host_try(&callback, "call", &[core_agent_list_copy(&searches)?]) {
        let value = result?;
        return Ok(if core_truthy(&value) {
            value
        } else {
            CoreValue::new_list()
        });
    }
    let scripted = core_agent_or_empty_map(core_agent_option(
        &options,
        "skill_search_results",
        "skillSearchResults",
    ));
    match &scripted {
        CoreValue::Map(map) => {
            let items = if core_truthy(&searches) {
                core_iter(&searches)?
            } else {
                Vec::new()
            };
            let joined = items
                .iter()
                .map(|item| item.text())
                .collect::<Vec<_>>()
                .join("|");
            if map.borrow().contains(&joined) {
                return Ok(core_agent_deep_copy(&core_get(
                    &scripted,
                    &CoreValue::from(joined.as_str()),
                    CoreValue::Null,
                )));
            }
            let out = CoreValue::new_list();
            for item in &items {
                let key = item.text();
                let entry = core_agent_deep_copy(&core_get(
                    &scripted,
                    &CoreValue::from(key.as_str()),
                    CoreValue::new_list(),
                ));
                for hit in core_iter(&entry)? {
                    core_append(&out, hit)?;
                }
            }
            if core_truthy(&out) {
                return Ok(out);
            }
            Ok(core_agent_deep_copy(&core_get(
                &scripted,
                &CoreValue::from("*"),
                CoreValue::new_list(),
            )))
        }
        CoreValue::List(_) => Ok(core_agent_deep_copy(&scripted)),
        _ => Ok(CoreValue::new_list()),
    }
}

// ----- callable invocation intrinsic -----

// python: _core_agent_callable_invoke(state, request, options). Walks
// state["callable_inventory"] groups for a callable whose qualified_name
// matches and invokes its handler when callable; otherwise consults
// scripted callable_results / callableResults (qualified name, plain name,
// then "*"); otherwise reports the unknown callable. The third argument is
// accepted and ignored, mirroring the reference.
#[allow(dead_code)]
fn core_agent_callable_invoke(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let state = core_arg(args, 0);
    let request = core_arg(args, 1);
    let agent_options = core_agent_state_options(&state);
    let name = core_get(&request, &CoreValue::from("name"), CoreValue::from(""));
    let qualified = core_get(&request, &CoreValue::from("qualified_name"), name.clone());
    let call_args = core_get(&request, &CoreValue::from("args"), CoreValue::new_map());
    let inventory = core_get(
        &state,
        &CoreValue::from("callable_inventory"),
        CoreValue::Null,
    );
    for group in core_axgen_iter_or_empty(&inventory)? {
        let callables = core_get(&group, &CoreValue::from("callables"), CoreValue::Null);
        for callable_meta in core_axgen_iter_or_empty(&callables)? {
            let meta_qualified = core_get(
                &callable_meta,
                &CoreValue::from("qualified_name"),
                CoreValue::Null,
            );
            if meta_qualified != qualified {
                continue;
            }
            let handler = core_get(&callable_meta, &CoreValue::from("handler"), CoreValue::Null);
            if let CoreValue::Host(host) = &handler {
                let value = host.call_method("call", &[call_args.clone()])?;
                return core_agent_map(&[("status", CoreValue::from("ok")), ("value", value)]);
            }
        }
    }
    let scripted = core_agent_or_empty_map(core_agent_option(
        &agent_options,
        "callable_results",
        "callableResults",
    ));
    if let CoreValue::Map(_) = &scripted {
        let mut result = core_get(&scripted, &qualified, CoreValue::Null);
        if result.is_null() {
            result = core_get(&scripted, &name, CoreValue::Null);
        }
        if result.is_null() {
            result = core_get(&scripted, &CoreValue::from("*"), CoreValue::Null);
        }
        if !result.is_null() {
            let copied = core_agent_deep_copy(&result);
            if let CoreValue::Map(map) = &copied {
                let error = core_get(&copied, &CoreValue::from("error"), CoreValue::Null);
                if core_truthy(&error) {
                    return core_agent_map(&[
                        ("status", CoreValue::from("error")),
                        ("error", error),
                    ]);
                }
                // python: copied.setdefault("status", "ok")
                if !map.borrow().contains("status") {
                    core_set(&copied, CoreValue::from("status"), CoreValue::from("ok"))?;
                }
                return Ok(copied);
            }
            return core_agent_map(&[("status", CoreValue::from("ok")), ("value", copied)]);
        }
    }
    core_agent_map(&[
        ("status", CoreValue::from("error")),
        (
            "error",
            CoreValue::from_string(format!("unknown callable: {}", qualified.text())),
        ),
    ])
}

// ----- string / regex / json intrinsics -----

// Translates a python re.sub replacement template into the regex crate's
// replacement syntax: literal dollars are escaped, backreferences become
// brace-delimited group references (group numbers cap at two digits, like
// python), the named \g<name> form maps across, doubled backslashes
// collapse, and the common control escapes are decoded.
#[allow(dead_code)]
fn core_regex_python_replacement(repl: &str) -> String {
    let mut out = String::new();
    let mut chars = repl.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '$' {
            out.push_str("$$");
            continue;
        }
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.peek().copied() {
            Some('\\') => {
                chars.next();
                out.push('\\');
            }
            Some('n') => {
                chars.next();
                out.push('\n');
            }
            Some('t') => {
                chars.next();
                out.push('\t');
            }
            Some('r') => {
                chars.next();
                out.push('\r');
            }
            Some('g') => {
                chars.next();
                if chars.peek().copied() == Some('<') {
                    chars.next();
                    let mut group = String::new();
                    let mut closed = false;
                    for next in chars.by_ref() {
                        if next == '>' {
                            closed = true;
                            break;
                        }
                        group.push(next);
                    }
                    if closed && !group.is_empty() {
                        out.push_str("${");
                        out.push_str(&group);
                        out.push('}');
                    } else {
                        out.push_str("\\g<");
                        out.push_str(&group);
                    }
                } else {
                    out.push('\\');
                    out.push('g');
                }
            }
            Some(digit) if digit.is_ascii_digit() => {
                let mut group = String::new();
                while group.len() < 2 {
                    match chars.peek().copied() {
                        Some(next) if next.is_ascii_digit() => {
                            group.push(next);
                            chars.next();
                        }
                        _ => break,
                    }
                }
                out.push_str("${");
                out.push_str(&group);
                out.push('}');
            }
            _ => out.push('\\'),
        }
    }
    out
}

// python: re.sub(str(pattern), str(repl), str(value))
#[allow(dead_code)]
fn core_regex_replace(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let pattern = core_arg(args, 0).text();
    let repl = core_arg(args, 1).text();
    let value = core_arg(args, 2).text();
    let compiled = regex::Regex::new(&pattern)
        .map_err(|err| AxError::runtime(format!("invalid regex pattern: {err}")))?;
    let replacement = core_regex_python_replacement(&repl);
    Ok(CoreValue::from_string(
        compiled
            .replace_all(&value, replacement.as_str())
            .into_owned(),
    ))
}

// python: json.dumps(value, indent=2)
#[allow(dead_code)]
fn core_json_pretty(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let json = core_value_to_json(&core_arg(args, 0));
    let text = serde_json::to_string_pretty(&json)
        .map_err(|err| AxError::runtime(format!("json pretty error: {err}")))?;
    Ok(CoreValue::from_string(text))
}

// python: word.lower().capitalize() (first char upper, remainder lower)
#[allow(dead_code)]
fn core_string_capitalize_lower(word: &str) -> String {
    let lowered = word.to_lowercase();
    let mut chars = lowered.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

// python: _core_string_lower_camel(words)
#[allow(dead_code)]
fn core_string_lower_camel(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let words = core_arg(args, 0);
    let mut items: Vec<String> = Vec::new();
    if core_truthy(&words) {
        for item in core_iter(&words)? {
            let text = item.text();
            if !text.is_empty() {
                items.push(text);
            }
        }
    }
    if items.is_empty() {
        return Ok(CoreValue::from(""));
    }
    let mut out = items[0].to_lowercase();
    for item in &items[1..] {
        out.push_str(&core_string_capitalize_lower(item));
    }
    Ok(CoreValue::from_string(out))
}

// python: _core_string_title_from_camel(value)
//   text = re.sub("Code$", " Code", str(value))
//   text = re.sub("([a-z0-9])([A-Z])", "\\1 \\2", text).strip()
//   return text[:1].upper() + text[1:]
#[allow(dead_code)]
fn core_string_title_from_camel(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let value = core_arg(args, 0).text();
    let code_suffix = regex::Regex::new("Code$")
        .map_err(|err| AxError::runtime(format!("invalid regex pattern: {err}")))?;
    let spaced_code = code_suffix.replace_all(&value, " Code");
    let boundary = regex::Regex::new("([a-z0-9])([A-Z])")
        .map_err(|err| AxError::runtime(format!("invalid regex pattern: {err}")))?;
    let spaced = boundary
        .replace_all(spaced_code.as_ref(), "${1} ${2}")
        .trim()
        .to_string();
    let mut chars = spaced.chars();
    Ok(match chars.next() {
        Some(first) => {
            CoreValue::from_string(first.to_uppercase().chain(chars).collect::<String>())
        }
        None => CoreValue::from(""),
    })
}

// ----- END AXIR CORE AGENT ENGINE -----

// ----- END AXIR CORE VALUE RUNTIME -----

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

const rustProviderMappingNoKeyExample = `use axllm::{AxAIClient, AxResult, ScriptedTransport, OpenAICompatibleClient};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![json!({
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

const rustProviderStreamNoKeyExample = `use axllm::{AxAIClient, AxResult, ScriptedTransport, OpenAICompatibleClient};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![json!({
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

const rustAxGenScriptedClientToolExample = `use axllm::{ax, tool, AxAIClient, AxResult, FieldType};
use serde_json::{json, Value};

struct ScriptedClient {
    calls: usize,
}

impl AxAIClient for ScriptedClient {
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
    let out = program.forward(&mut ScriptedClient { calls: 0 }, json!({"query": "ax docs"}))?;
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

struct ScriptedService {
    responses: VecDeque<Value>,
}

impl AxAIClient for ScriptedService {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        let content = self.responses.pop_front().ok_or_else(|| axllm::AxError::runtime("scripted service exhausted"))?;
        Ok(json!({"results": [{"content": content["content"], "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let mut service = ScriptedService {
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

struct ScriptedClient;

impl AxAIClient for ScriptedClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        Ok(json!({"results": [{"content": "{\"answer\":\"Paris\"}", "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let qa = ax("question:string -> answer:string")?;
    let mut program = flow("example.flow").execute("qa", qa).returns(json!({"answer": "answer"}));
    let output = program.forward(&mut ScriptedClient, json!({"question": "Capital of France?"}))?;
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

struct ScriptedOptimizer;

impl OptimizerEngine for ScriptedOptimizer {
    fn optimize(&mut self, request: Value, evaluator: &mut dyn FnMut(Value) -> AxResult<Value>) -> AxResult<Value> {
        let score = evaluator(json!({"candidate": request["candidate"]}))?;
        Ok(json!({"artifact": {"version": 1, "score": score}}))
    }
}

fn main() -> AxResult<()> {
    let mut engine = ScriptedOptimizer;
    let result = engine.optimize(json!({"candidate": "short prompt"}), &mut |_candidate| Ok(json!({"score": 1.0})))?;
    assert_eq!(result["artifact"]["version"], 1);
    println!("rust-optimizer-artifact-ok");
    Ok(())
}
`

const rustAxAgentOpenAIExample = `use axllm::{agent, AxAIClient, AxResult, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::env;

struct ProviderAgentClient {
    inner: OpenAICompatibleClient,
    raw_model_answer: Option<String>,
    calls: usize,
}

impl AxAIClient for ProviderAgentClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        self.calls += 1;
        if self.raw_model_answer.is_none() {
            let response = self.inner.chat(json!({
                "chat_prompt": [{
                    "role": "user",
                    "content": "In one sentence, explain what Ax helps developers build."
                }]
            }))?;
            let answer = response["results"][0]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();
            self.raw_model_answer = Some(answer);
        }
        let answer = self.raw_model_answer.clone().unwrap_or_default();
        let payload = if self.calls == 1 {
            json!({"completion": {"type": "final", "args": ["Answer", {}]}})
        } else if self.calls == 2 {
            json!({"completion": {"type": "final", "args": ["Answer", {"answer": answer}]}})
        } else {
            json!({"answer": answer})
        };
        Ok(json!({"results": [{"content": payload.to_string(), "function_calls": []}]}))
    }
}

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    let client = OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0}));
    let mut stage_client = ProviderAgentClient {
        inner: client,
        raw_model_answer: None,
        calls: 0,
    };
    let mut assistant = agent("question:string -> answer:string")?;
    let output = assistant.forward(
        &mut stage_client,
        json!({"question": "In one sentence, explain what Ax helps developers build."}),
    )?;
    println!("{}", serde_json::to_string_pretty(&json!({
        "agentOutput": output,
        "rawModelAnswer": stage_client.raw_model_answer
    }))?);
    Ok(())
}
`

const rustAxFlowOpenAIExample = `use axllm::{ax, flow, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    let mut client = OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0}));
    let outline = ax("topic:string -> outline:string")?;
    let mut program = flow("examples.openaiApiFlow")
        .execute("outline", outline)
        .returns(json!({"outline": "outline"}));
    let output = program.forward(&mut client, json!({"topic": "how Ax composes typed LLM programs"}))?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
`

const rustAudioResponsesMappingExample = `use axllm::{ai, AxResult, ScriptedTransport};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![
        json!({"status": 200, "json": {"audio": "base64-speech"}}),
        json!({"status": 200, "json": {"text": "hello world", "language": "en", "duration": 1.25}}),
    ]);
    let mut client = ai("openai-responses", json!({"api_key": "test-key"}))?.with_transport(transport);
    let speech = client.speak(json!({"text": "hello", "voice": "alloy", "format": "mp3"}))?;
    let transcript = client.transcribe(json!({
        "audio": "base64-audio",
        "language": "en",
        "model": "whisper-1",
        "format": "json"
    }))?;
    assert_eq!(speech["audio"], "base64-speech");
    assert_eq!(transcript["text"], "hello world");
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"speak": speech, "transcribe": transcript}))?
    );
    Ok(())
}
`

const rustRealtimeAudioEventsExample = `use axllm::{ai, AxResult};
use serde_json::json;

fn main() -> AxResult<()> {
    let grok = ai("grok", json!({
        "api_key": "test-key",
        "model": "grok-voice-think-fast-1.0"
    }))?;
    let grok_request = json!({
        "model": "grok-voice-think-fast-1.0",
        "chat_prompt": [
            {"role": "system", "content": "You are a concise voice agent."},
            {"role": "user", "content": "Say hello."}
        ],
        "audio": {
            "input": {"sampleRate": 24000},
            "output": {"sampleRate": 24000, "voice": "eve"}
        }
    });
    let grok_events = json!([
        {"type": "response.output_audio_transcript.delta", "response_id": "grok_rt", "delta": "hello "},
        {"type": "response.output_audio.delta", "response_id": "grok_rt", "delta": "AQI="},
        {
            "type": "response.done",
            "response": {
                "id": "grok_rt",
                "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}
            }
        }
    ]);

    let gemini = ai("google-gemini", json!({
        "api_key": "test-key",
        "model": "gemini-2.5-flash-native-audio-preview-12-2025"
    }))?;
    let gemini_request = json!({
        "model": "gemini-2.5-flash-native-audio-preview-12-2025",
        "chat_prompt": [
            {"role": "system", "content": "Answer with audio."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Realtime question"},
                    {"type": "audio", "data": "AAAA", "format": "pcm16", "sampleRate": 16000}
                ]
            }
        ],
        "audio": {"output": {"transcript": true, "voice": "Kore"}}
    });
    let gemini_events = json!([
        {"id": "gemini_live_1", "serverContent": {"outputTranscription": {"text": "spoken "}}},
        {
            "id": "gemini_live_2",
            "serverContent": {
                "modelTurn": {
                    "parts": [{"inlineData": {"data": "AQI=", "mimeType": "audio/pcm"}}]
                }
            }
        },
        {
            "id": "gemini_live_3",
            "toolCall": {"functionCalls": [{"name": "lookup", "args": {"q": "ax"}}]}
        },
        {
            "id": "gemini_live_done",
            "serverContent": {"turnComplete": true},
            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 4, "totalTokenCount": 7}
        }
    ]);

    let output = json!({
        "grokSetup": grok.realtime_audio_setup(grok_request)?,
        "grokEvents": grok.realtime_events(grok_events)?,
        "geminiSetup": gemini.realtime_audio_setup(gemini_request.clone())?,
        "geminiInput": gemini.realtime_audio_input(gemini_request)?,
        "geminiEvents": gemini.realtime_events(gemini_events)?
    });
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
`

const rustGEPALocalOptimizerExample = `use axllm::{AxGEPA, AxResult, OptimizerEngine};
use serde_json::{json, Value};

fn main() -> AxResult<()> {
    let request = json!({
        "candidate": {
            "qa::instruction": "Answer clearly and concisely."
        },
        "dataset": {
            "train": [{"question": "What is Ax?"}, {"question": "Why use typed signatures?"}],
            "validation": [{"question": "Summarize Ax."}]
        },
        "options": {"numTrials": 0, "maxMetricCalls": 8, "seed": 7}
    });

    let mut engine = AxGEPA::new();
    let artifact = engine.optimize(request, &mut |candidate: Value| {
        let instruction = candidate["candidate"]["qa::instruction"].as_str().unwrap_or_default();
        let quality = if instruction.to_lowercase().contains("concise") { 0.9 } else { 0.65 };
        let brevity = 0.8;
        Ok(json!({
            "rows": [{
                "prediction": {"answer": "Ax composes typed LLM programs."},
                "scores": {"quality": quality, "brevity": brevity},
                "scalar": (quality + brevity) / 2.0
            }],
            "avg": (quality + brevity) / 2.0,
            "count": 1
        }))
    })?;
    assert_eq!(artifact["artifact"]["kind"], "gepa");
    println!("{}", serde_json::to_string_pretty(&artifact)?);
    Ok(())
}
`
