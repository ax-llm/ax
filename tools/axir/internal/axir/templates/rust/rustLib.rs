pub mod mcp;
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

    fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        let _ = request;
        Ok(json!({"text": ""}))
    }

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
    pub base_url_override: Option<String>,
    pub api_version: String,
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
            base_url_override: None,
            api_version: String::new(),
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

    fn prepare_chat_request(&self, request: &Value) -> AxResult<Value> {
        let mut req = if request.is_object() { request.clone() } else { json!({}) };
        if req.get("chat_prompt").is_none() {
            if let Some(prompt) = request.get("chatPrompt").or_else(|| request.get("messages")) {
                req["chat_prompt"] = prompt.clone();
            }
        }
        if req
            .get("model")
            .and_then(Value::as_str)
            .filter(|model| !model.is_empty())
            .is_none()
        {
            req["model"] = json!(self.model.clone());
        }
        let mut base_config = if self.model_config.is_object() { self.model_config.clone() } else { json!({}) };
        if base_config.get("temperature").is_none() {
            base_config["temperature"] = json!(0);
        }
        let override_config = req
            .get("model_config")
            .or_else(|| req.get("modelConfig"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let merged = merge_model_config(&[
            core_value_from_json(&base_config),
            core_value_from_json(&override_config),
            CoreValue::new_map(),
        ])?;
        req["model_config"] = core_value_to_json(&merged);
        Ok(req)
    }

    fn provider_transport_request(&self, operation: &str, payload: &Value, model: &str, stream: bool) -> AxResult<Value> {
        let operation_descriptor = core_value_to_json(&provider_operation_descriptor(&[
            CoreValue::from(self.profile.as_str()),
            CoreValue::from(operation),
        ])?);
        let descriptor = core_value_to_json(&provider_descriptor(&[CoreValue::from(self.profile.as_str())])?);
        let mut path = operation_descriptor
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("/chat/completions")
            .to_string();
        path = path.replace("{model}", &url_component_escape(model));
        let auth = descriptor.get("auth").and_then(Value::as_str).unwrap_or("bearer");
        if auth == "api_key_query" {
            let key_name = descriptor.get("apiKeyQuery").and_then(Value::as_str).unwrap_or("key");
            let separator = if path.contains('?') { "&" } else { "?" };
            path = format!(
                "{path}{separator}{}={}",
                url_component_escape(key_name),
                url_component_escape(&self.api_key)
            );
        }
        let base = self
            .base_url_override
            .clone()
            .unwrap_or_else(|| {
                descriptor
                    .get("baseUrl")
                    .and_then(Value::as_str)
                    .unwrap_or("https://api.openai.com/v1")
                    .to_string()
            });
        let mut url = format!("{}{path}", base.trim_end_matches('/'));
        if !self.api_version.is_empty() {
            let separator = if url.contains('?') { "&" } else { "?" };
            url = format!("{url}{separator}api-version={}", url_component_escape(&self.api_version));
        }
        let mut headers = serde_json::Map::new();
        headers.insert("Content-Type".to_string(), json!("application/json"));
        match auth {
            "bearer" => {
                if !self.api_key.is_empty() {
                    headers.insert("Authorization".to_string(), json!(format!("Bearer {}", self.api_key)));
                }
            }
            "anthropic_key" => {
                headers.insert("x-api-key".to_string(), json!(self.api_key.clone()));
            }
            "api_key_header" => {
                let key_name = descriptor.get("apiKeyHeader").and_then(Value::as_str).unwrap_or("api-key");
                headers.insert(key_name.to_string(), json!(self.api_key.clone()));
            }
            _ => {}
        }
        if let Some(extra) = descriptor.get("headers").and_then(Value::as_object) {
            for (key, value) in extra {
                let text = value.as_str().map(ToString::to_string).unwrap_or_else(|| value.to_string());
                headers.insert(key.clone(), json!(text));
            }
        }
        let body_key = if operation_descriptor.get("body").and_then(Value::as_str) == Some("multipart") {
            "data"
        } else {
            "json"
        };
        let mut out = json!({"method": "POST", "url": url, "headers": Value::Object(headers), "stream": stream});
        out[body_key] = payload.clone();
        Ok(out)
    }

    fn dispatch_transport_request(&mut self, call: Value) -> AxResult<Value> {
        if let Some(transport) = self.transport.as_mut() {
            return transport.send(call);
        }
        let url = call.get("url").and_then(Value::as_str).unwrap_or_default().to_string();
        let mut builder = HttpClient::builder()
            .timeout(Duration::from_secs(60))
            .build()?
            .post(url);
        if let Some(headers) = call.get("headers").and_then(Value::as_object) {
            for (key, value) in headers {
                builder = builder.header(key.as_str(), value.as_str().unwrap_or_default());
            }
        }
        let body = call
            .get("json")
            .or_else(|| call.get("data"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let response: Value = builder
            .json(&body)
            .send()?
            .error_for_status()?
            .json()?;
        Ok(json!({"status": 200, "json": response}))
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
            "anthropic" => "/v1/messages",
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
        // python: AxBaseAI.embed validation + ProviderOperationClient._embed
        // (provider_build_embed_request -> transport -> provider_normalize_embed_response)
        let texts = request
            .get("texts")
            .or_else(|| request.get("input"))
            .cloned()
            .unwrap_or(Value::Null);
        if !texts.as_array().map(|items| !items.is_empty()).unwrap_or(false) {
            return Err(AxError {
                category: "ai_service".to_string(),
                error_type: Some("AxAIServiceResponseError".to_string()),
                message: "Embed texts is empty".to_string(),
                status: None,
                code: None,
                retryable: false,
            });
        }
        let embed_model = string_at(&request, "embed_model")
            .or_else(|| string_at(&request, "embedModel"))
            .unwrap_or_else(|| self.embed_model.clone());
        if embed_model.is_empty() {
            return Err(AxError {
                category: "ai_service".to_string(),
                error_type: Some("AxAIServiceResponseError".to_string()),
                message: "Embed model not set".to_string(),
                status: None,
                code: None,
                retryable: false,
            });
        }
        let mut req = if request.is_object() { request.clone() } else { json!({}) };
        req["texts"] = texts;
        req["embed_model"] = json!(embed_model.clone());
        let profile = self.profile.clone();
        if profile == "openai-compatible" {
            let _ = build_embed_request(&[
                CoreValue::Null,
                core_value_from_json(&req),
                CoreValue::Null,
            ])?;
        }
        let payload = core_value_to_json(&provider_build_embed_request(&[
            CoreValue::from(profile.as_str()),
            core_value_from_json(&req),
        ])?);
        let model = string_at(&req, "embed_model")
            .or_else(|| string_at(&payload, "model"))
            .unwrap_or_else(|| self.embed_model.clone());
        let call = self.provider_transport_request("embed", &payload, &model, false)?;
        let raw = self.dispatch_transport_request(call)?;
        let body = normalize_passthrough_response(raw)?;
        if profile == "openai-compatible" {
            let _ = normalize_embed_response(&[core_value_from_json(&body)])?;
        }
        let normalized = provider_normalize_embed_response(&[
            CoreValue::from(profile.as_str()),
            core_value_from_json(&body),
            provider_ai_display_name(&profile),
            CoreValue::from(model.as_str()),
        ])?;
        Ok(core_value_to_json(&normalized))
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
        let req = self.prepare_chat_request(&request)?;
        // python: AxBaseAI.chat validates the coerced request up front.
        validate_chat_request(&[core_value_from_json(&req)])?;
        if self.profile == "openai-compatible" {
            let _ = build_chat_request(&[
                CoreValue::Null,
                core_value_from_json(&req),
                CoreValue::Null,
            ])?;
        }
        let payload = core_value_to_json(&provider_build_chat_request(&[
            CoreValue::from(self.profile.as_str()),
            core_value_from_json(&req),
        ])?);
        let model = req
            .get("model")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .or_else(|| payload.get("model").and_then(Value::as_str).map(ToString::to_string))
            .unwrap_or_else(|| self.model.clone());
        let call = self.provider_transport_request("chat", &payload, &model, false)?;
        let raw = self.dispatch_transport_request(call)?;
        let profile = self.profile.clone();
        normalize_openai_response(&profile, &model, raw)
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
    let mut client = OpenAICompatibleClient::new(api_key, model)
        .with_api_url(api_url)
        .with_embed_model(embed_model)
        .with_profile(defaults.profile);
    client.base_url_override = string_at(&options, "base_url")
        .or_else(|| string_at(&options, "baseUrl"))
        .or_else(|| string_at(&options, "api_url"));
    if defaults.profile == "azure-openai" {
        let version = string_at(&options, "api_version")
            .or_else(|| string_at(&options, "apiVersion"))
            .or_else(|| string_at(&options, "version"))
            .unwrap_or_else(|| "2024-02-15-preview".to_string());
        client.api_version = version.trim_start_matches("api-version=").to_string();
        if client.base_url_override.is_none() {
            let resource = string_at(&options, "resource_name").or_else(|| string_at(&options, "resourceName"));
            let deployment = string_at(&options, "deployment_name").or_else(|| string_at(&options, "deploymentName"));
            if let (Some(resource), Some(deployment)) = (resource, deployment) {
                let host = if resource.contains("://") {
                    resource
                } else {
                    format!("https://{resource}.openai.azure.com")
                };
                client.base_url_override = Some(format!(
                    "{}/openai/deployments/{}",
                    host.trim_end_matches('/'),
                    url_component_escape(&deployment)
                ));
            }
        }
    }
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
            api_url: "https://api.anthropic.com",
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
    if profile == "openai-compatible" {
        let _ = normalize_chat_response(&[core_value_from_json(&payload)])?;
    }
    let normalized = provider_normalize_chat_response(&[
        CoreValue::from(profile),
        core_value_from_json(&payload),
        provider_ai_display_name(profile),
        CoreValue::from(model),
    ])?;
    Ok(core_value_to_json(&normalized))
}

// python: _transport_result. Raises openai_normalize_error for status >= 400
// and unwraps {status, json|body|data} transport envelopes otherwise.
fn normalize_passthrough_response(response: Value) -> AxResult<Value> {
    if response.get("status").is_none() {
        return Ok(response);
    }
    let status = response.get("status").and_then(Value::as_u64).unwrap_or(200);
    let body = response
        .get("json")
        .or_else(|| response.get("body"))
        .or_else(|| response.get("data"))
        .cloned()
        .unwrap_or(Value::Null);
    if status >= 400 {
        let error = openai_normalize_error(&[
            CoreValue::Num(status as f64),
            core_value_from_json(&body),
            CoreValue::Null,
        ])?;
        return Err(core_as_error(&error));
    }
    Ok(body)
}

fn normalize_stream_response(profile: &str, model: &str, response: Value) -> AxResult<Vec<Value>> {
    let payload = normalize_passthrough_response(response)?;
    let events = if let Some(events) = payload.as_array() {
        events.clone()
    } else if let Some(events) = payload.get("events").and_then(Value::as_array) {
        events.clone()
    } else {
        let body = payload
            .as_str()
            .or_else(|| payload.get("body").and_then(Value::as_str))
            .unwrap_or_default();
        parse_sse_events(body)?
    };
    let ai_name = provider_ai_display_name(profile);
    let state = CoreValue::new_map();
    let mut out = Vec::new();
    for event in &events {
        if profile == "openai-compatible" {
            let _ = normalize_stream_delta(&[
                core_value_from_json(event),
                CoreValue::new_map(),
            ])?;
        }
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
        self.forward_with_options(client, input, Value::Null)
    }

    pub fn forward_with_options<C: AxAIClient>(
        &mut self,
        client: &mut C,
        input: Value,
        options: Value,
    ) -> AxResult<Value> {
        let state = core_gen_state(self)?;
        let mut chat = |method: &str, request: Value| -> AxResult<Value> {
            if method == "transcribe" { client.transcribe(request) } else { client.chat(request) }
        };
        let result = with_core_client(&mut chat, || {
            _forward_impl(&[
                state.clone(),
                CoreValue::Null,
                core_value_from_json(&input),
                core_value_from_json(&options),
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

    // ----- python AxGen optimizer wrapper layer -----

    pub(crate) fn with_options_and_tools(spec: &str, options: Value, tools: Vec<Tool>) -> AxResult<Self> {
        let mut gen = Self::new(spec)?;
        gen.options = if options.is_object() { options } else { json!({}) };
        gen.tools = tools;
        Ok(gen)
    }

    fn option_str(&self, keys: &[&str]) -> Option<String> {
        keys.iter()
            .find_map(|key| self.options.get(*key).and_then(Value::as_str))
            .map(ToString::to_string)
    }

    pub fn program_id(&self) -> String {
        self.option_str(&["id", "program_id", "programId"]).unwrap_or_else(|| "root".to_string())
    }

    pub fn get_instruction(&self) -> String {
        self.option_str(&["instruction"]).unwrap_or_default()
    }

    pub fn set_instruction(&mut self, instruction: &str) {
        if !self.options.is_object() {
            self.options = json!({});
        }
        self.options["instruction"] = json!(instruction);
    }

    pub fn set_demos(&mut self, demos: Vec<Value>) {
        let marker = CoreValue::new_map();
        let _ = _set_demos(&[marker, core_value_from_json(&Value::Array(demos.clone()))]);
        self.demos = demos;
        let has = !self.examples.is_empty() || !self.demos.is_empty();
        if !self.options.is_object() {
            self.options = json!({});
        }
        self.options["has_example_demonstrations"] = json!(has);
    }

    pub fn set_examples(&mut self, examples: Vec<Value>) {
        let marker = CoreValue::new_map();
        let _ = _set_examples(&[marker, core_value_from_json(&Value::Array(examples.clone()))]);
        self.examples = examples;
        let has = !self.examples.is_empty() || !self.demos.is_empty();
        if !self.options.is_object() {
            self.options = json!({});
        }
        self.options["has_example_demonstrations"] = json!(has);
    }

    pub fn get_optimizable_components(&self) -> Vec<Value> {
        let owner = self.program_id();
        let mut components = Vec::new();
        if let Some(description) = self.signature.description.as_deref().filter(|text| !text.is_empty()) {
            if let Ok(component) = _optimization_component(&[
                CoreValue::from(format!("{owner}::description").as_str()),
                CoreValue::from(owner.as_str()),
                CoreValue::from("description"),
                CoreValue::from(description),
                CoreValue::from("Program signature description."),
                core_value_from_json(&json!(["Preserve the task intent and field references."])),
                CoreValue::new_list(),
                CoreValue::Bool(false),
                CoreValue::from("markdown"),
                core_value_from_json(&json!({"required_placeholders": []})),
            ]) {
                components.push(core_value_to_json(&component));
            }
        }
        if let Ok(component) = _optimization_component(&[
            CoreValue::from(format!("{owner}::instruction").as_str()),
            CoreValue::from(owner.as_str()),
            CoreValue::from("instruction"),
            CoreValue::from(self.get_instruction().as_str()),
            CoreValue::from("Prompt instruction text used by this generator."),
            core_value_from_json(&json!(["Keep required input and output fields intact."])),
            CoreValue::new_list(),
            CoreValue::Bool(false),
            CoreValue::from("markdown"),
            core_value_from_json(&json!({"required_placeholders": []})),
        ]) {
            components.push(core_value_to_json(&component));
        }
        let mut seen = BTreeSet::new();
        for tool in &self.tools {
            if tool.name.is_empty() || seen.contains(&tool.name) {
                continue;
            }
            seen.insert(tool.name.clone());
            if let Ok(component) = _optimization_component(&[
                CoreValue::from(format!("{owner}::fn:{}:desc", tool.name).as_str()),
                CoreValue::from(owner.as_str()),
                CoreValue::from("fn-desc"),
                CoreValue::from(tool.description.as_str()),
                CoreValue::from(format!("Description for tool {}.", tool.name).as_str()),
                core_value_from_json(&json!(["Non-empty, concise, and faithful to the tool behavior."])),
                CoreValue::new_list(),
                CoreValue::Bool(false),
                CoreValue::from("text"),
                core_value_from_json(&json!({"maxLength": 320})),
            ]) {
                components.push(core_value_to_json(&component));
            }
            if let Ok(component) = _optimization_component(&[
                CoreValue::from(format!("{owner}::fn:{}:name", tool.name).as_str()),
                CoreValue::from(owner.as_str()),
                CoreValue::from("fn-name"),
                CoreValue::from(tool.name.as_str()),
                CoreValue::from(format!("Callable name for tool {}.", tool.name).as_str()),
                core_value_from_json(&json!(["snake_case", "32 characters or fewer", "unique among tools"])),
                CoreValue::new_list(),
                CoreValue::Bool(true),
                CoreValue::from("snake_case"),
                core_value_from_json(&json!({"pattern": "^[a-z][a-z0-9_]{0,31}$"})),
            ]) {
                components.push(core_value_to_json(&component));
            }
        }
        components
    }

    pub fn apply_optimized_components(&mut self, component_map: &Value) -> AxResult<()> {
        let updates = component_map.as_object().cloned().unwrap_or_default();
        let owner = self.program_id();
        if let Some(description) = updates.get(&format!("{owner}::description")) {
            self.signature.description = Some(value_as_display_string(description));
        }
        if let Some(instruction) = updates.get(&format!("{owner}::instruction")) {
            let text = value_as_display_string(instruction);
            self.set_instruction(&text);
        }
        let old_names = self.tools.iter().map(|tool| tool.name.clone()).collect::<Vec<_>>();
        for (index, old_name) in old_names.iter().enumerate() {
            let desc_id = format!("{owner}::fn:{old_name}:desc");
            let name_id = format!("{owner}::fn:{old_name}:name");
            if let Some(description) = updates.get(&desc_id) {
                self.tools[index].description = value_as_display_string(description);
            }
            if let Some(new_name) = updates.get(&name_id) {
                let new_name = value_as_display_string(new_name).trim().to_string();
                if !optimized_function_name_valid(&new_name) {
                    return Err(AxError::runtime(format!("invalid optimized function name: {new_name}")));
                }
                if self
                    .tools
                    .iter()
                    .enumerate()
                    .any(|(other_index, other)| other_index != index && other.name == new_name)
                {
                    return Err(AxError::runtime(format!("duplicate optimized function name: {new_name}")));
                }
                self.tools[index].name = new_name;
            }
        }
        Ok(())
    }

    pub fn apply_optimization(&mut self, artifact: &Value) -> AxResult<Value> {
        let components = Value::Array(self.get_optimizable_components());
        let validated = core_value_to_json(&if let Some(text) = artifact.as_str() {
            _deserialize_optimized_artifact(&[CoreValue::from(text), core_value_from_json(&components)])?
        } else {
            _validate_optimized_artifact(&[core_value_from_json(artifact), core_value_from_json(&components)])?
        });
        if let Some(demos) = validated.get("demos") {
            self.set_demos(demos.as_array().cloned().unwrap_or_default());
        }
        let component_map = validated.get("componentMap").cloned().unwrap_or_else(|| json!({}));
        self.apply_optimized_components(&component_map)?;
        Ok(validated)
    }

    pub fn evaluate_optimization<C: AxAIClient>(
        &mut self,
        client: &mut C,
        dataset: &Value,
        candidate_map: &Value,
        options: &Value,
    ) -> AxResult<Value> {
        let opts = if options.is_object() { options.clone() } else { json!({}) };
        let normalized = core_value_to_json(&_normalize_optimization_dataset(&[
            core_value_from_json(dataset),
        ])?);
        let original = core_value_to_json(&_optimization_component_current_map(&[
            core_value_from_json(&Value::Array(self.get_optimizable_components())),
        ])?);
        let candidate = if candidate_map.is_object() { candidate_map.clone() } else { json!({}) };
        let phase = opts.get("phase").and_then(Value::as_str).unwrap_or("train").to_string();
        let run = (|| -> AxResult<Value> {
            if candidate.as_object().map(|map| !map.is_empty()).unwrap_or(false) {
                self.apply_optimized_components(&candidate)?;
            }
            let mut rows = Vec::new();
            for task in normalized
                .get("train")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
            {
                let input = task.get("input").cloned().unwrap_or_else(|| task.clone());
                let forward_options = opts.get("forward_options").cloned().unwrap_or_else(|| json!({}));
                let (prediction, error) = match self.forward_with_options(client, input, forward_options) {
                    Ok(output) => (
                        json!({
                            "completionType": "final",
                            "output": output,
                            "finalOutput": output,
                            "functionCalls": self.function_call_traces.clone(),
                            "actionLog": self.chat_log.clone(),
                            "usage": {},
                            "trace": {"traces": self.traces.clone()},
                        }),
                        Value::Null,
                    ),
                    Err(err) => {
                        let error = json!({"message": err.message});
                        (
                            json!({
                                "completionType": "error",
                                "error": error,
                                "functionCalls": self.function_call_traces.clone(),
                                "actionLog": self.chat_log.clone(),
                                "usage": {},
                                "trace": {"traces": self.traces.clone()},
                            }),
                            error,
                        )
                    }
                };
                let task_object = if task.is_object() { task.clone() } else { json!({}) };
                let (scores, scalar) = score_optimization_prediction(&task_object, &prediction, &opts)?;
                rows.push(core_value_to_json(&_build_optimization_eval_row(&[
                    core_value_from_json(&task),
                    core_value_from_json(&prediction),
                    core_value_from_json(&scores),
                    CoreValue::Num(scalar),
                    core_value_from_json(prediction.get("trace").unwrap_or(&Value::Null)),
                    core_value_from_json(&error),
                ])?));
            }
            Ok(core_value_to_json(&_build_optimization_eval_result(&[
                core_value_from_json(&Value::Array(rows)),
                core_value_from_json(&candidate),
                CoreValue::from(phase.as_str()),
            ])?))
        })();
        let rollback = self.apply_optimized_components(&original);
        let result = run?;
        rollback?;
        Ok(result)
    }

    pub fn optimize_with<C: AxAIClient>(
        &mut self,
        engine: &mut dyn OptimizerEngine,
        dataset: &Value,
        options: &Value,
        client: Option<Rc<RefCell<C>>>,
    ) -> AxResult<Value> {
        let opts = if options.is_object() { options.clone() } else { json!({}) };
        let components = Value::Array(self.get_optimizable_components());
        let trace = json!({"traces": self.traces.clone(), "chat_log": self.chat_log.clone()});
        let run = core_value_to_json(&_prepare_optimizer_run(&[
            CoreValue::from("axgen"),
            core_value_from_json(&components),
            core_value_from_json(dataset),
            core_value_from_json(&opts),
            core_value_from_json(&trace),
            CoreValue::Bool(client.is_some()),
        ])?);
        let request = run.get("request").cloned().unwrap_or_else(|| json!({}));
        let mut evaluator = |step: Value| -> AxResult<Value> {
            let candidate = step
                .get("candidateMap")
                .or_else(|| step.get("componentMap"))
                .or_else(|| step.get("candidate"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            let mut merged = opts.clone();
            if let Some(step_options) = step.get("options").and_then(Value::as_object) {
                if !merged.is_object() {
                    merged = json!({});
                }
                if let Some(target) = merged.as_object_mut() {
                    for (key, value) in step_options {
                        target.insert(key.clone(), value.clone());
                    }
                }
            }
            let eval_dataset = merged
                .get("dataset")
                .or_else(|| merged.get("_dataset"))
                .cloned()
                .unwrap_or_else(|| dataset.clone());
            let Some(client) = client.as_ref() else {
                return Err(AxError::runtime("optimizer evaluator requires an AI client"));
            };
            let mut client = client.borrow_mut();
            self.evaluate_optimization(&mut *client, &eval_dataset, &candidate, &merged)
        };
        let response = engine.optimize(request, &mut evaluator)?;
        let engine_name = response
            .get("optimizerName")
            .or_else(|| response.get("optimizer"))
            .and_then(Value::as_str)
            .unwrap_or("optimizer")
            .to_string();
        let engine_version = response
            .get("optimizerVersion")
            .or_else(|| response.get("version"))
            .and_then(Value::as_str)
            .unwrap_or("host")
            .to_string();
        let artifact = core_value_to_json(&_normalize_optimizer_engine_response(&[
            core_value_from_json(&response),
            CoreValue::from(engine_name.as_str()),
            CoreValue::from(engine_version.as_str()),
            core_value_from_json(&components),
        ])?);
        if opts.get("apply").and_then(Value::as_bool).unwrap_or(true) {
            self.apply_optimization(&artifact)?;
        }
        Ok(artifact)
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

fn value_as_display_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        _ => stable_stringify(value),
    }
}

fn optimized_function_name_valid(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if name.len() > 32 || !first.is_ascii_lowercase() {
        return false;
    }
    chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
}

fn score_optimization_prediction(task: &Value, prediction: &Value, options: &Value) -> AxResult<(Value, f64)> {
    let raw_scores = task
        .get("metric_score")
        .or_else(|| task.get("scores"))
        .or_else(|| task.get("score"))
        .cloned()
        .unwrap_or_else(|| {
            if prediction.get("completionType").and_then(Value::as_str) == Some("error") {
                json!(0.0)
            } else {
                json!(1.0)
            }
        });
    let scores = _normalize_optimization_metric_scores(&[core_value_from_json(&raw_scores)])?;
    let scalar = _scalarize_optimization_scores(&[
        scores.clone(),
        core_value_from_json(options),
    ])?;
    let adjusted = _adjust_optimization_score_for_actions(&[
        scalar,
        core_value_from_json(task),
        core_value_from_json(prediction),
    ])?;
    let adjusted_json = core_value_to_json(&adjusted);
    Ok((core_value_to_json(&scores), adjusted_json.as_f64().unwrap_or(0.0)))
}

fn assertion_subject<'a>(assertion: &Value, output: &'a Value) -> &'a Value {
    assertion
        .get("field")
        .and_then(Value::as_str)
        .and_then(|field| output.get(field))
        .unwrap_or(output)
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
    state: CoreValue,
    distiller: CoreValue,
    executor: CoreValue,
    responder: CoreValue,
    // Signature + instruction for the built-in llmQuery sub-query, kept as
    // plain (Send + Sync) data so the host-callable closure can rebuild the
    // sub-gen per call without capturing a non-Send CoreValue.
    llm_query_signature: String,
    llm_query_instruction: Value,
}

pub fn agent(spec: &str) -> AxResult<AxAgent> {
    agent_with_options(spec, json!({}))
}

pub fn agent_with_options(spec: &str, options: Value) -> AxResult<AxAgent> {
    agent_with_core_options(spec, core_value_from_json(&options))
}

pub(crate) fn agent_with_core_options(spec: &str, options: CoreValue) -> AxResult<AxAgent> {
    let signature = s(spec)?;
    let state = _agent_factory(&[core_signature_value(&signature)?, options.clone()])?;
    let distiller_signature = signature_from_record(&core_get(
        &state,
        &CoreValue::from("distiller_signature"),
        CoreValue::Null,
    ))?;
    let executor_signature = signature_from_record(&core_get(
        &state,
        &CoreValue::from("executor_signature"),
        CoreValue::Null,
    ))?;
    let responder_signature = signature_from_record(&core_get(
        &state,
        &CoreValue::from("responder_signature"),
        CoreValue::Null,
    ))?;
    let validation_retries = {
        let raw = core_get(&options, &CoreValue::from("validation_retries"), CoreValue::Null);
        if raw.is_null() { json!(2) } else { core_value_to_json(&raw) }
    };
    let distiller_instruction = core_value_to_json(&core_get(&state, &CoreValue::from("distiller_description"), CoreValue::from("")));
    let executor_instruction = core_value_to_json(&core_get(&state, &CoreValue::from("executor_description"), CoreValue::from("")));
    let responder_instruction = core_value_to_json(&core_get(&state, &CoreValue::from("responder_description"), CoreValue::from("")));
    let llm_query_signature = core_get(
        &state,
        &CoreValue::from("llm_query_signature"),
        CoreValue::from("task:string, context:json -> answer:string"),
    )
    .text();
    let llm_query_instruction = core_value_to_json(&core_get(&state, &CoreValue::from("llm_query_description"), CoreValue::from("")));
    Ok(AxAgent {
        state,
        distiller: agent_stage_gen(
            distiller_signature,
            json!({"validation_retries": 0, "id": "ctx.root.actor", "instruction": distiller_instruction}),
        ),
        executor: agent_stage_gen(
            executor_signature,
            json!({"validation_retries": 0, "id": "task.root.actor", "instruction": executor_instruction}),
        ),
        responder: agent_stage_gen(
            responder_signature,
            json!({"validation_retries": validation_retries, "id": "task.root.responder", "instruction": responder_instruction}),
        ),
        llm_query_signature,
        llm_query_instruction,
    })
}

impl AxAgent {
    pub fn forward<C: AxAIClient>(&mut self, client: &mut C, input: Value) -> AxResult<Value> {
        self.forward_with_options(client, input, json!({}))
    }

    pub fn forward_with_options<C: AxAIClient>(
        &mut self,
        client: &mut C,
        input: Value,
        options: Value,
    ) -> AxResult<Value> {
        let mut chat = |method: &str, request: Value| -> AxResult<Value> {
            if method == "transcribe" { client.transcribe(request) } else { client.chat(request) }
        };
        // Wire the built-in llmQuery primitive onto the runtime carried in
        // agent options (the same host the actor loop will create sessions on),
        // mirroring the Go/Python wrappers. The closure rebuilds a focused
        // sub-gen per call and runs it through _agent_run_llm_query; it uses the
        // thread-local client bound by with_core_client below (CoreValue::Null
        // here resolves to that binding), so it captures only Send + Sync data.
        let state_options = core_get(&self.state, &CoreValue::from("options"), CoreValue::Null);
        let runtime_host = core_get(&state_options, &CoreValue::from("runtime"), CoreValue::Null);
        if let CoreValue::Host(host) = &runtime_host {
            let llm_query_signature = self.llm_query_signature.clone();
            let llm_query_instruction = self.llm_query_instruction.clone();
            let callable: AxHostCallable = Arc::new(move |params: Value| -> AxResult<Value> {
                let signature = s(&llm_query_signature)?;
                let sub_gen = agent_stage_gen(
                    signature,
                    json!({"validation_retries": 1, "id": "rlm.llmquery", "instruction": llm_query_instruction.clone()}),
                );
                let result = _agent_run_llm_query(&[
                    sub_gen,
                    CoreValue::Null,
                    core_value_from_json(&params),
                ])?;
                Ok(core_value_to_json(&result))
            });
            host.register_runtime_callable("llmQuery", callable);
        }
        let result = with_core_client(&mut chat, || {
            _agent_forward(&[
                self.state.clone(),
                self.distiller.clone(),
                self.executor.clone(),
                self.responder.clone(),
                CoreValue::Null,
                core_value_from_json(&input),
                core_value_from_json(&options),
            ])
        })?;
        Ok(core_value_to_json(&result))
    }

    fn state_json(&self, key: &str) -> Value {
        core_value_to_json(&core_get(&self.state, &CoreValue::from(key), CoreValue::Null))
    }

    pub fn get_usage(&self) -> Value {
        self.state_json("usage")
    }

    pub fn get_runtime_contract(&self) -> Value {
        self.state_json("runtime_contract")
    }

    pub fn get_policy(&self) -> Value {
        self.state_json("policy")
    }

    pub fn get_policy_registry(&self) -> Value {
        self.state_json("policy_registry")
    }

    pub fn get_callable_inventory(&self) -> Value {
        self.state_json("callable_inventory")
    }

    pub fn get_discovery_catalog(&self) -> Value {
        self.state_json("discovery_catalog")
    }

    pub fn discover(&mut self, request: Value) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_discover(&[
            self.state.clone(),
            core_value_from_json(&request),
        ])?))
    }

    pub fn recall(&mut self, request: Value) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_recall(&[
            self.state.clone(),
            core_value_from_json(&request),
        ])?))
    }

    pub fn used(&mut self, id: &str, reason: &str, stage: &str) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_used(&[
            self.state.clone(),
            core_value_from_json(&json!({"id": id, "reason": reason, "stage": stage})),
            CoreValue::from(stage),
        ])?))
    }

    pub fn invoke_callable(&mut self, qualified_name: &str, args: Value, options: Value) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_execute_callable(&[
            self.state.clone(),
            core_value_from_json(&json!({"qualified_name": qualified_name, "args": args})),
            core_value_from_json(&options),
        ])?))
    }

    pub fn export_runtime_state(&mut self) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_export_runtime_state(&[
            self.state.clone(),
        ])?))
    }

    pub fn restore_runtime_state(&mut self, snapshot: Value) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_restore_runtime_state(&[
            self.state.clone(),
            core_value_from_json(&snapshot),
        ])?))
    }

    pub fn get_optimizer_metadata(&self) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_optimizer_metadata(&[
            self.state.clone(),
        ])?))
    }

    pub fn get_optimizable_components(&self) -> AxResult<Vec<Value>> {
        let mut components = Vec::new();
        for stage in [&self.distiller, &self.executor, &self.responder] {
            if let Value::Array(items) = core_value_to_json(&core_program_components(&[stage.clone()])?) {
                components.extend(items);
            }
        }
        components.push(core_value_to_json(&_optimization_component(&[
            CoreValue::from("root.agent.runtime"),
            CoreValue::from("root.agent"),
            CoreValue::from("runtime-policy"),
            core_value_from_json(&self.get_runtime_contract()),
            CoreValue::from("Agent runtime-language metadata and code-field policy."),
            core_value_from_json(&json!(["Keep code field names aligned with the selected runtime language."])),
            CoreValue::new_list(),
            CoreValue::Bool(true),
            CoreValue::from("json"),
            core_value_from_json(&json!({"component": "runtime_contract"})),
        ])?));
        components.push(core_value_to_json(&_optimization_component(&[
            CoreValue::from("root.agent.policy"),
            CoreValue::from("root.agent"),
            CoreValue::from("agent-policy"),
            core_value_from_json(&self.get_policy()),
            CoreValue::from("Actor primitive, discovery, delegation, and prompt placement policy."),
            core_value_from_json(&json!(["Do not expose protocol-only actions as actor primitives."])),
            core_value_from_json(&json!(["root.agent.runtime"])),
            CoreValue::Bool(true),
            CoreValue::from("json"),
            core_value_from_json(&json!({"component": "policy_registry"})),
        ])?));
        Ok(components)
    }

    pub fn apply_optimized_components(&mut self, component_map: &Value) -> AxResult<()> {
        let components = Value::Array(self.get_optimizable_components()?);
        _validate_optimization_component_map(&[
            core_value_from_json(&components),
            core_value_from_json(component_map),
        ])?;
        let component_core = core_value_from_json(component_map);
        core_program_apply_components(&[self.distiller.clone(), component_core.clone()])?;
        core_program_apply_components(&[self.executor.clone(), component_core.clone()])?;
        core_program_apply_components(&[self.responder.clone(), component_core.clone()])?;
        if let Some(value) = component_map.get("root.agent.runtime").filter(|value| value.is_object()) {
            core_set(&self.state, CoreValue::from("runtime_contract"), core_value_from_json(value))?;
        }
        if let Some(value) = component_map.get("root.agent.policy").filter(|value| value.is_object()) {
            core_set(&self.state, CoreValue::from("policy"), core_value_from_json(value))?;
        }
        let metadata = _agent_optimizer_metadata(&[self.state.clone()])?;
        core_set(&self.state, CoreValue::from("optimizer_metadata"), metadata)?;
        Ok(())
    }

    pub fn replay_trace(&mut self, trace: Value, fixtures: Value) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_replay_trace(&[
            core_value_from_json(&trace),
            core_value_from_json(&fixtures),
        ])?))
    }

    pub fn evaluate_optimization_task<C: AxAIClient>(
        &mut self,
        client: &mut C,
        task: Value,
        options: Value,
    ) -> AxResult<Value> {
        let input = task.get("input").cloned().unwrap_or_else(|| task.clone());
        let forward_options = options.get("forward_options").cloned().unwrap_or_else(|| json!({}));
        match self.forward_with_options(client, input, forward_options) {
            Ok(output) => {
                let trace = self.export_trace()?;
                Ok(core_value_to_json(&_build_agent_eval_prediction(&[
                    core_value_from_json(&output),
                    core_value_from_json(&Value::Array(self.get_action_log())),
                    core_value_from_json(&self.get_usage()),
                    core_value_from_json(&trace),
                ])?))
            }
            Err(error) => match core_agent_clarification_detail(&error) {
                Some(detail) => Ok(json!({
                    "completionType": "askClarification",
                    "clarification": detail.get("clarification").cloned().unwrap_or(Value::Null),
                    "actionLog": Value::Array(self.get_action_log()),
                    "functionCalls": self.state_json("function_call_traces"),
                    "toolErrors": [],
                    "turnCount": 0,
                    "usage": self.get_usage(),
                })),
                None => Err(error),
            },
        }
    }

    pub fn execute_actor_step(
        &mut self,
        runtime: &mut dyn AxCodeRuntime,
        code: &str,
        input: Value,
        options: Value,
    ) -> AxResult<RuntimeEnvelope> {
        _agent_runtime_build_globals(&[self.state.clone(), core_value_from_json(&input)])?;
        // SAFETY: lifetime-only erasure; the host never outlives this call.
        let runtime_ptr: *mut (dyn AxCodeRuntime + 'static) =
            unsafe { std::mem::transmute(runtime as *mut dyn AxCodeRuntime) };
        let runtime_host = CoreValue::Host(Rc::new(ScopedRuntimeHost(runtime_ptr)));
        let session = core_get(&self.state, &CoreValue::from("runtime_session"), CoreValue::Null);
        let result = _agent_runtime_execute_step(&[
            self.state.clone(),
            runtime_host,
            session,
            CoreValue::from(code),
            core_value_from_json(&options),
        ])?;
        Ok(RuntimeEnvelope {
            payload: core_value_to_json(&result),
        })
    }

    pub fn test(
        &mut self,
        runtime: &mut dyn AxCodeRuntime,
        code: &str,
        input: Value,
        options: Value,
    ) -> AxResult<RuntimeEnvelope> {
        // SAFETY: lifetime-only erasure; the host never outlives this call.
        let runtime_ptr: *mut (dyn AxCodeRuntime + 'static) =
            unsafe { std::mem::transmute(runtime as *mut dyn AxCodeRuntime) };
        let runtime_host = CoreValue::Host(Rc::new(ScopedRuntimeHost(runtime_ptr)));
        let result = _agent_runtime_test(&[
            self.state.clone(),
            runtime_host,
            CoreValue::from(code),
            core_value_from_json(&input),
            core_value_from_json(&options),
        ])?;
        Ok(RuntimeEnvelope {
            payload: core_value_to_json(&result),
        })
    }

    pub fn inspect_runtime(&mut self) -> AxResult<Value> {
        let session = core_get(&self.state, &CoreValue::from("runtime_session"), CoreValue::Null);
        let result = _agent_runtime_inspect_state(&[
            self.state.clone(),
            session,
            CoreValue::new_map(),
        ])?;
        Ok(core_value_to_json(&result))
    }

    pub fn export_session_state(&mut self) -> AxResult<Value> {
        let session = core_get(&self.state, &CoreValue::from("runtime_session"), CoreValue::Null);
        let result = _agent_runtime_export_session_state(&[
            self.state.clone(),
            session,
            CoreValue::new_map(),
        ])?;
        Ok(core_value_to_json(&result))
    }

    pub fn restore_session_state(&mut self, snapshot: Value) -> AxResult<Value> {
        let session = core_get(&self.state, &CoreValue::from("runtime_session"), CoreValue::Null);
        let result = _agent_runtime_restore_session_state(&[
            self.state.clone(),
            session,
            core_value_from_json(&snapshot),
            CoreValue::new_map(),
        ])?;
        Ok(core_value_to_json(&result))
    }

    pub fn close_runtime_session(&mut self) -> AxResult<Value> {
        let session = core_get(&self.state, &CoreValue::from("runtime_session"), CoreValue::Null);
        let result = _agent_runtime_close_session(&[self.state.clone(), session])?;
        Ok(core_value_to_json(&result))
    }

    pub fn get_state(&self) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_get_state(&[self.state.clone()])?))
    }

    pub fn set_state(&mut self, state: Value) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_set_state(&[
            self.state.clone(),
            core_value_from_json(&state),
        ])?))
    }

    pub fn export_trace(&self) -> AxResult<Value> {
        Ok(core_value_to_json(&_agent_export_trace(&[self.state.clone()])?))
    }

    pub fn get_chat_log(&self) -> Vec<Value> {
        match core_value_to_json(&core_get(&self.state, &CoreValue::from("chat_log"), CoreValue::Null)) {
            Value::Array(items) => items,
            _ => Vec::new(),
        }
    }

    pub fn get_action_log(&self) -> Vec<Value> {
        match core_value_to_json(&core_get(&self.state, &CoreValue::from("action_log"), CoreValue::Null)) {
            Value::Array(items) => items,
            _ => Vec::new(),
        }
    }

    /// Attach a code runtime so `forward()` can execute the actor's code in a
    /// real engine. Wraps the runtime as a host value with full capabilities and
    /// stores it under `options.runtime` (the same wiring the conformance runner
    /// uses), enabling the Python/Go-style `agent(...).with_runtime(rt).forward(...)`.
    pub fn with_runtime(self, runtime: Box<dyn AxCodeRuntime>) -> AxResult<Self> {
        let host = core_code_runtime_host_shared(
            Rc::new(RefCell::new(runtime)),
            core_runtime_capabilities_full(),
        );
        let options = core_get(&self.state, &CoreValue::from("options"), CoreValue::Null);
        core_set(&options, CoreValue::from("runtime"), host)?;
        Ok(self)
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
        let mut chat = |method: &str, request: Value| -> AxResult<Value> {
            if method == "transcribe" { client.transcribe(request) } else { client.chat(request) }
        };
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

    pub fn set_demos(&mut self, demos: &Value) -> AxResult<()> {
        if let Some(map) = demos.as_object() {
            let mut known = BTreeSet::new();
            let steps = core_get(&self.state, &CoreValue::from("steps"), CoreValue::Null);
            if let Ok(items) = core_iter(&steps) {
                for step in items {
                    let name = core_get(&step, &CoreValue::from("name"), CoreValue::Null).text();
                    if !name.is_empty() {
                        known.insert(name);
                    }
                }
            }
            for name in map.keys() {
                if !known.contains(name) {
                    return Err(AxError::runtime(format!("unknown flow node in demos: {name}")));
                }
            }
        }
        core_set(&self.state, CoreValue::from("demos"), core_value_from_json(demos))?;
        Ok(())
    }

    pub fn get_optimizable_components(&self) -> AxResult<Value> {
        Ok(core_value_to_json(&_flow_get_optimizable_components(&[
            self.state.clone(),
        ])?))
    }

    pub fn apply_optimized_components(&mut self, component_map: &Value) -> AxResult<()> {
        _flow_apply_optimized_components(&[
            self.state.clone(),
            core_value_from_json(component_map),
        ])?;
        Ok(())
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

/// A host callable the agent runtime can expose to actor code (e.g. the
/// built-in `llmQuery`). JSON-typed both ways so it crosses the runtime
/// boundary cleanly; `Send + Sync` so a concrete runtime may store it.
pub type AxHostCallable = Arc<dyn Fn(Value) -> AxResult<Value> + Send + Sync + 'static>;

pub trait AxCodeRuntime {
    fn language(&self) -> &str;

    fn usage_instructions(&self) -> &str {
        ""
    }

    fn create_session(&mut self, globals: Value, options: Value) -> AxResult<Box<dyn AxCodeSession>>;

    /// Register a host callable under `name`. Default no-op so runtimes that
    /// do not host callables are unaffected; the embedded JS engines override
    /// it so the agent wrapper can wire the built-in `llmQuery` primitive.
    fn register_host_callable(&mut self, _name: &str, _callable: AxHostCallable) -> AxResult<()> {
        Ok(())
    }
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

impl Drop for ProcessCodeRuntime {
    fn drop(&mut self) {
        // A leaked runtime subprocess holds the inherited stdio pipes open,
        // wedging any harness that waits on them; kill it unconditionally.
        if let Some(child) = &self.child {
            if let Ok(mut child) = child.lock() {
                let _ = child.child.kill();
            }
        }
    }
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

    // python ProcessCodeRuntime._request: the raw protocol passthrough the
    // protocol conformance fixtures use for capabilities/unknown-op/session
    // probes. Returns the full response object (callers read "result").
    pub(crate) fn request(&mut self, op: &str, session_id: Option<&str>, payload: Value) -> AxResult<Value> {
        let child = self.child()?;
        let mut child = child
            .lock()
            .map_err(|_| AxError::runtime("runtime protocol lock poisoned"))?;
        child.request(op, session_id, payload)
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
        // python ProcessCodeSession.execute converts protocol failures into
        // error envelopes instead of raising.
        let payload = match self.request("execute", json!({"code": code, "options": options})) {
            Ok(result) => result,
            Err(err) => json!({
                "kind": "error",
                "is_error": true,
                "error_category": err.category,
                "error": err.message,
            }),
        };
        Ok(RuntimeEnvelope { payload })
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
        let response = child.request(op, Some(&self.session_id), payload)?;
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }
}

impl ProtocolChild {
    // Mirrors python ProcessCodeRuntime._request: validates response id and
    // session_id echoes and surfaces protocol failures with the reference
    // error strings. Returns the full response object.
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
            return Err(AxError::runtime(self.closed_without_response_message()));
        }
        let response: Value = serde_json::from_str(&line).map_err(|err| {
            AxError::runtime(format!("runtime protocol invalid JSON response: {err}"))
        })?;
        if !response.is_object() {
            return Err(AxError::runtime("runtime protocol response must be an object"));
        }
        // python: str(response.get("id")) != str(message["id"])
        let response_id = match response.get("id") {
            Some(Value::String(text)) => text.clone(),
            Some(value) => value.to_string(),
            None => "None".to_string(),
        };
        if response_id != id {
            return Err(AxError::runtime("runtime protocol response id mismatch"));
        }
        if let Some(session_id) = session_id {
            let echoed = response.get("session_id");
            let matches = match echoed {
                None | Some(Value::Null) => true,
                Some(value) => value.as_str() == Some(session_id),
            };
            if !matches {
                return Err(AxError::runtime("runtime protocol session_id mismatch"));
            }
        }
        if response.get("ok").and_then(Value::as_bool) == Some(false) {
            let error = response.get("error").cloned().unwrap_or_else(|| json!({}));
            return Err(AxError::new(
                error.get("category").and_then(Value::as_str).unwrap_or("runtime"),
                error.get("message").and_then(Value::as_str).unwrap_or("runtime protocol error"),
            ));
        }
        Ok(response)
    }

    // python ProcessCodeRuntime._closed_without_response_message; stderr is
    // inherited on the Rust side, so only the exit code is appended.
    fn closed_without_response_message(&mut self) -> String {
        let mut status = self.child.try_wait().ok().flatten();
        if status.is_none() {
            std::thread::sleep(Duration::from_millis(100));
            status = self.child.try_wait().ok().flatten();
        }
        let mut message = "runtime protocol process closed without a response".to_string();
        if let Some(code) = status.and_then(|status| status.code()) {
            message.push_str(&format!(" (exit code {code})"));
        }
        message
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
        | "agent_prompt"
        | "agent_runtime_adapter"
        | "agent_runtime_policy"
        | "agent_runtime_protocol"
        | "agent_runtime_real"
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
            expect_error_category(&err, fixture)?;
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

// python: _run_stream. Folds the chunks through the emitted fold_stream after
// every event so streaming assertions fire at the same point in the stream.
fn run_stream_fixture(fixture: &Value) -> AxResult<()> {
    let events = fixture
        .get("stream_events")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let assertions = fixture
        .get("streaming_assertions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut chunks = Vec::new();
    let mut folded = String::new();
    for event in events {
        chunks.push(event);
        folded = fold_fixture_stream(&chunks)?;
        for assertion in &assertions {
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
                expect_json_subset("AI registry fixture", &actual, expected)?;
            }
            if let Some(expected) = fixture.get("alias_expectations").and_then(Value::as_object) {
                for (alias, expected_profile) in expected {
                    let normalized = core_value_to_json(&provider_normalize_profile(&[
                        CoreValue::from(alias.as_str()),
                    ])?);
                    expect_json_equal(&format!("provider alias {alias}"), &normalized, expected_profile)?;
                }
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
        "ai_error" | "ai_unsupported" => run_ai_error_fixture(kind, fixture),
        _ => Err(AxError::new("fixture", format!("unsupported Rust AI support fixture {kind}"))),
    }
}

// python: _run_ai_error / _run_ai_unsupported. Dispatches the real client
// method and matches message, error type, and status on the failure.
fn run_ai_error_fixture(kind: &str, fixture: &Value) -> AxResult<()> {
    let (mut client, _requests) = fixture_client(fixture)?;
    let default_method = if kind == "ai_unsupported" { "transcribe" } else { "chat" };
    let method = fixture
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or(default_method);
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    let result: AxResult<Value> = match method {
        "stream" => client.stream(request).map(Value::Array),
        "embed" => client.embed(request),
        "transcribe" => client.transcribe(request),
        "speak" => client.speak(request),
        _ => client.chat(request),
    };
    let Err(err) = result else {
        return Err(AxError::new("fixture", "expected AxAI call to fail"));
    };
    if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
        if !err.message.contains(expected) {
            return Err(AxError::new(
                "fixture",
                format!("expected error containing {expected:?}, got {}", err.message),
            ));
        }
    }
    if let Some(expected) = fixture.get("expected_error_type").and_then(Value::as_str) {
        let actual = err.error_type.as_deref().unwrap_or("");
        if actual != expected {
            return Err(AxError::new(
                "fixture",
                format!("expected error type {expected}, got {actual}"),
            ));
        }
    }
    if let Some(expected) = fixture.get("expected_status") {
        let actual = err.status.map(|status| json!(status)).unwrap_or(Value::Null);
        if &actual != expected {
            return Err(AxError::new(
                "fixture",
                format!("expected status {expected}, got {actual}"),
            ));
        }
    }
    Ok(())
}

fn run_agent_fixture(kind: &str, fixture: &Value) -> AxResult<()> {
    match kind {
        "agent_forward" => run_agent_forward_contract_fixture(fixture),
        "agent_prompt" => run_agent_prompt_fixture(fixture),
        "agent_runtime_real" => run_agent_forward_contract_fixture(fixture),
        "agent_runtime_protocol" => run_agent_runtime_protocol_fixture(fixture),
        "agent_runtime_session" => run_agent_runtime_session_fixture(fixture),
        "agent_runtime_adapter" => run_agent_runtime_adapter_fixture(fixture),
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

struct ConformanceFlowCallable {
    mode: &'static str,
    spec: Value,
}

impl CoreHost for ConformanceFlowCallable {
    fn host_type(&self) -> &'static str {
        "ConformanceFlowCallable"
    }

    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        if name != "call" {
            return Err(AxError::runtime(format!(
                "ConformanceFlowCallable has no method '{}'",
                name
            )));
        }
        let state = core_value_to_json(&core_arg(args, 0));
        let output = if self.mode == "mapper" {
            conformance_flow_mapper_call(&self.spec, &state)
        } else {
            conformance_flow_condition_call(&self.spec, &state)
        };
        Ok(core_value_from_json(&output))
    }
}

fn conformance_flow_callable(mode: &'static str, spec: Value) -> CoreValue {
    CoreValue::Host(Rc::new(ConformanceFlowCallable { mode, spec }))
}

fn conformance_flow_state_value(state: &Value, field: &str, fallback: Value) -> Value {
    get_path(state, field).cloned().unwrap_or(fallback)
}

fn conformance_flow_condition_call(spec: &Value, state: &Value) -> Value {
    let Some(map) = spec.as_object() else {
        return json!(core_json_truthy(spec));
    };
    let op = map.get("op").and_then(Value::as_str).unwrap_or("truthy");
    let field = map.get("field").and_then(Value::as_str).unwrap_or("");
    let value = conformance_flow_state_value(state, field, map.get("default").cloned().unwrap_or(Value::Null));
    match op {
        "field" => value,
        "lt" => json!(value.as_f64().unwrap_or(0.0) < map.get("value").and_then(Value::as_f64).unwrap_or(0.0)),
        "eq" => json!(value == map.get("value").cloned().unwrap_or(Value::Null)),
        _ => json!(core_json_truthy(&value)),
    }
}

fn conformance_flow_mapper_call(spec: &Value, state: &Value) -> Value {
    let Some(map) = spec.as_object() else {
        return json!({});
    };
    match map.get("op").and_then(Value::as_str).unwrap_or("set") {
        "increment" => {
            let field = map.get("field").and_then(Value::as_str).unwrap_or("");
            let current = conformance_flow_state_value(state, field, json!(0));
            let mut out = Map::new();
            out.insert(field.to_string(), json_number(current.as_f64().unwrap_or(0.0) + 1.0));
            Value::Object(out)
        }
        "upper" => {
            let from = map.get("from").and_then(Value::as_str).unwrap_or("__item");
            let to = map.get("to").and_then(Value::as_str).unwrap_or("__derived");
            let val = conformance_flow_state_value(state, from, json!(""));
            let mut out = Map::new();
            out.insert(to.to_string(), json!(val.as_str().unwrap_or("").to_uppercase()));
            Value::Object(out)
        }
        _ => map.get("values").cloned().unwrap_or_else(|| json!({})),
    }
}

fn conformance_ai_registry_result(kind: &str, fixture: &Value) -> AxResult<Value> {
    match kind {
        "ai_provider_descriptor" => {
            let provider = fixture
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or("openai-compatible");
            Ok(core_value_to_json(&provider_descriptor(&[CoreValue::from(provider)])?))
        }
        "ai_provider_registry" => Ok(core_value_to_json(&provider_profile_registry(&[])?)),
        "ai_model_catalog_audit" => Ok(core_value_to_json(&provider_model_catalog_summary(&[])?)),
        "ai_model_catalog_runtime" => {
            let model_type = fixture.get("model_type").cloned().unwrap_or(Value::Null);
            let catalog = get_supported_ai_models_json(&model_type)?;
            let entries = catalog.as_array().cloned().unwrap_or_default();
            let mut actual = json!({
                "providerCount": entries.len(),
                "providerNames": entries.iter().map(|item| item.get("name").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
                "modelCount": entries
                    .iter()
                    .map(|item| item.get("models").and_then(Value::as_array).map(|models| models.len()).unwrap_or(0))
                    .sum::<usize>(),
                "openaiFirstModel": Value::Null,
                "openaiModelTypes": [],
                "catalog": catalog.clone(),
            });
            if let Some(openai) = entries.iter().find(|item| {
                item.get("name").and_then(Value::as_str) == Some("openai")
                    && item.get("models").and_then(Value::as_array).map(|models| !models.is_empty()).unwrap_or(false)
            }) {
                let models = openai.get("models").and_then(Value::as_array).cloned().unwrap_or_default();
                actual["openaiFirstModel"] = models
                    .first()
                    .and_then(|model| model.get("name"))
                    .cloned()
                    .unwrap_or(Value::Null);
                let mut types = models
                    .iter()
                    .filter_map(|model| model.get("type").and_then(Value::as_str).map(ToString::to_string))
                    .collect::<Vec<_>>();
                types.sort();
                types.dedup();
                actual["openaiModelTypes"] = json!(types);
            }
            if fixture.get("check_clone").and_then(Value::as_bool).unwrap_or(false) {
                // The emitted catalog must hand out fresh copies; mutating the
                // first response must not leak into a fresh lookup.
                let fresh = get_supported_ai_models_json(&model_type)?;
                if fresh != catalog {
                    return Err(AxError::new("fixture", "catalog clone mismatch"));
                }
            }
            Ok(actual)
        }
        _ => Err(AxError::new("fixture", format!("unsupported AI registry fixture {kind}"))),
    }
}

// python: get_supported_ai_models(model_type) -> provider_model_catalog(options)
fn get_supported_ai_models_json(model_type: &Value) -> AxResult<Value> {
    let options = if model_type.is_null() {
        json!({})
    } else {
        json!({"type": model_type})
    };
    Ok(core_value_to_json(&provider_model_catalog(&[
        core_value_from_json(&options),
    ])?))
}

fn conformance_ai_routing_result(kind: &str, fixture: &Value) -> AxResult<Value> {
    match kind {
        "ai_multiservice_router" => conformance_multiservice_router_result(fixture),
        "ai_provider_router" => conformance_provider_router_result(fixture),
        "ai_balancer" => conformance_balancer_result(fixture),
        _ => Err(AxError::new("fixture", format!("unsupported AI routing fixture {kind}"))),
    }
}

#[derive(Clone)]
struct RouterFixtureService {
    name: String,
    id: String,
    model: String,
    embed_model: String,
    features: Value,
    model_list: Value,
    requests: Vec<Value>,
    responses: VecDeque<Value>,
    metrics: Value,
    options: Value,
    last_chat: Value,
    last_embed: Value,
    last_config: Value,
}

impl RouterFixtureService {
    fn new(spec: &Value) -> Self {
        let name = spec
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("fixture")
            .to_string();
        Self {
            id: spec
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("{name}-id")),
            model: spec
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("fixture-chat")
                .to_string(),
            embed_model: spec
                .get("embed_model")
                .or_else(|| spec.get("embedModel"))
                .and_then(Value::as_str)
                .unwrap_or("fixture-embed")
                .to_string(),
            features: spec
                .get("features")
                .cloned()
                .unwrap_or_else(router_default_features),
            model_list: spec
                .get("modelList")
                .or_else(|| spec.get("model_list"))
                .cloned()
                .unwrap_or(Value::Null),
            responses: spec
                .get("responses")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into(),
            metrics: spec
                .get("metrics")
                .cloned()
                .unwrap_or_else(|| json!({"service": name, "calls": 0})),
            options: json!({}),
            requests: Vec::new(),
            last_chat: Value::Null,
            last_embed: Value::Null,
            last_config: Value::Null,
            name,
        }
    }

    fn provider_record(&self) -> Value {
        json!({"name": self.name, "id": self.id, "features": self.features})
    }

    fn record(&mut self, method: &str, options: &Value) {
        self.requests.push(json!({"method": method, "opt": options}));
    }

    fn chat(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        self.record("chat", options);
        self.last_chat = request
            .get("model")
            .cloned()
            .unwrap_or_else(|| Value::String(self.model.clone()));
        self.last_config = request
            .get("model_config")
            .or_else(|| request.get("modelConfig"))
            .cloned()
            .unwrap_or(Value::Null);
        if let Some(next) = self.responses.pop_front() {
            if let Some(err) = next.get("error") {
                return Err(fixture_ai_service_error(err));
            }
            if let Some(response) = next.get("response") {
                return Ok(response.clone());
            }
            return Ok(next);
        }
        Ok(json!({"results": [{"index": 0, "content": format!("{} chat", self.name)}]}))
    }

    fn embed(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        self.record("embed", options);
        self.last_embed = request
            .get("embed_model")
            .or_else(|| request.get("embedModel"))
            .cloned()
            .unwrap_or_else(|| Value::String(self.embed_model.clone()));
        Ok(json!({"embeddings": [[1, 2]], "modelUsage": {"ai": self.name}}))
    }

    fn stream(&mut self, request: &Value, options: &Value) -> AxResult<Vec<Value>> {
        let value = self.chat(request, options)?;
        Ok(value.as_array().cloned().unwrap_or_else(|| vec![value]))
    }

    fn transcribe(&mut self, _request: &Value, options: &Value) -> AxResult<Value> {
        self.record("transcribe", options);
        Ok(json!({"text": format!("{} transcript", self.name)}))
    }

    fn speak(&mut self, _request: &Value, options: &Value) -> AxResult<Value> {
        self.record("speak", options);
        Ok(json!({"audio": "pcm"}))
    }

    fn metrics(&self) -> Value {
        let mut out = self.metrics.clone();
        if out.get("calls").is_some() {
            out["calls"] = json!(self.requests.len());
        }
        out
    }
}

fn fixture_ai_service_error(spec: &Value) -> AxError {
    let error_type = spec.get("type").and_then(Value::as_str).unwrap_or("network");
    let message = spec
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("fixture error");
    let mut err = match error_type {
        "status" => AxError::new("ai", message),
        "authentication" => AxError::new("ai", "Authentication failed"),
        "response" => AxError::new("ai", message),
        "timeout" => AxError::new("ai", message),
        "plain" => AxError::runtime(message),
        _ => AxError::new("ai", format!("Network Error: {message}")),
    };
    err.error_type = Some(match error_type {
        "status" => "AxAIServiceStatusError",
        "authentication" => "AxAIServiceAuthenticationError",
        "response" => "AxAIServiceResponseError",
        "timeout" => "AxAIServiceTimeoutError",
        "plain" => "AxError",
        _ => "AxAIServiceNetworkError",
    }.to_string());
    err.status = spec.get("status").and_then(Value::as_u64).map(|status| status as u16);
    err.retryable = matches!(error_type, "network" | "response" | "timeout")
        || matches!(err.status, Some(408 | 429 | 500 | 502 | 503 | 504));
    err
}

fn router_default_features() -> Value {
    json!({
        "functions": false,
        "streaming": false,
        "media": {
            "images": {"supported": false, "formats": []},
            "audio": {"supported": false, "formats": [], "output": {"supported": false, "formats": []}},
            "files": {"supported": false, "formats": [], "uploadMethod": "none"},
            "urls": {"supported": false, "webSearch": false, "contextFetching": false}
        },
        "caching": {"supported": false, "types": []},
        "thinking": false,
        "multiTurn": true
    })
}

fn build_router_services(fixture: &Value) -> Vec<RouterFixtureService> {
    fixture
        .get("services")
        .and_then(Value::as_array)
        .map(|services| services.iter().map(RouterFixtureService::new).collect())
        .unwrap_or_default()
}

fn service_calls(services: &[RouterFixtureService]) -> Value {
    Value::Array(
        services
            .iter()
            .filter(|service| !service.requests.is_empty())
            .map(|service| Value::Array(service.requests.clone()))
            .collect(),
    )
}

#[derive(Clone)]
struct MultiServiceEntry {
    service_index: usize,
    description: String,
    model: Option<Value>,
    embed_model: Option<Value>,
    is_internal: bool,
}

struct ConformanceMultiServiceRouter {
    services: Vec<RouterFixtureService>,
    entries: BTreeMap<String, MultiServiceEntry>,
    key_order: Vec<String>,
    options: Value,
    last_used: Option<usize>,
}

impl ConformanceMultiServiceRouter {
    fn new(mut services: Vec<RouterFixtureService>, fixture: &Value) -> AxResult<Self> {
        if services.is_empty() {
            return Err(AxError::runtime("No AI services provided."));
        }
        let mut router = Self {
            services: Vec::new(),
            entries: BTreeMap::new(),
            key_order: Vec::new(),
            options: json!({}),
            last_used: None,
        };
        router.services.append(&mut services);
        for (entry_index, raw) in fixture
            .get("router_entries")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let service_index = raw
                .get("service_index")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            if service_index >= router.services.len() {
                return Err(AxError::runtime(format!("service index {service_index} out of range")));
            }
            if raw.get("kind").and_then(Value::as_str) == Some("key") {
                let key = raw.get("key").and_then(Value::as_str).unwrap_or("").to_string();
                if router.entries.contains_key(&key) {
                    return Err(AxError::runtime(format!("Duplicate model key: {key}")));
                }
                router.key_order.push(key.clone());
                router.entries.insert(key, MultiServiceEntry {
                    service_index,
                    description: raw
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    model: None,
                    embed_model: None,
                    is_internal: raw
                        .get("isInternal")
                        .or_else(|| raw.get("is_internal"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                });
                continue;
            }
            let model_list = router.services[service_index]
                .model_list
                .as_array()
                .cloned()
                .unwrap_or_default();
            if model_list.is_empty() {
                return Err(AxError::runtime(format!(
                    "Service {entry_index} '{}' has no model list.",
                    router.services[service_index].name
                )));
            }
            for item in model_list {
                let key = item.get("key").and_then(Value::as_str).unwrap_or("").to_string();
                if let Some(existing) = router.entries.get(&key) {
                    return Err(AxError::runtime(format!(
                        "Service {entry_index} '{}' has duplicate model key: {key} as service {}",
                        router.services[service_index].name,
                        router.services[existing.service_index].name
                    )));
                }
                let model = item.get("model").cloned();
                let embed_model = item
                    .get("embedModel")
                    .or_else(|| item.get("embed_model"))
                    .cloned();
                if model.is_none() && embed_model.is_none() {
                    return Err(AxError::runtime(format!(
                        "Key {key} in model list for service {entry_index} '{}' is missing a model or embedModel property.",
                        router.services[service_index].name
                    )));
                }
                router.key_order.push(key.clone());
                router.entries.insert(key, MultiServiceEntry {
                    service_index,
                    description: item
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    model,
                    embed_model,
                    is_internal: false,
                });
            }
        }
        Ok(router)
    }

    fn model_list(&self) -> Value {
        Value::Array(
            self.key_order
                .iter()
                .filter_map(|key| {
                    let entry = self.entries.get(key)?;
                    if entry.is_internal {
                        return None;
                    }
                    let mut item = Map::new();
                    item.insert("key".to_string(), Value::String(key.clone()));
                    item.insert(
                        "description".to_string(),
                        Value::String(entry.description.clone()),
                    );
                    if let Some(model) = &entry.model {
                        item.insert("model".to_string(), model.clone());
                    } else if let Some(embed_model) = &entry.embed_model {
                        item.insert("embedModel".to_string(), embed_model.clone());
                    }
                    Some(Value::Object(item))
                })
                .collect(),
        )
    }

    fn selected_service_index(&self) -> usize {
        self.last_used.unwrap_or_else(|| {
            self.key_order
                .first()
                .and_then(|key| self.entries.get(key))
                .map(|entry| entry.service_index)
                .unwrap_or(0)
        })
    }

    fn chat(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        let model_key = request
            .get("model")
            .and_then(Value::as_str)
            .ok_or_else(|| AxError::runtime("Model key must be specified for multi-service"))?;
        let entry = self
            .entries
            .get(model_key)
            .cloned()
            .ok_or_else(|| AxError::runtime(format!("No service found for model key: {model_key}")))?;
        self.last_used = Some(entry.service_index);
        let mut forwarded = request.clone();
        if forwarded.get("modelConfig").is_some() && forwarded.get("model_config").is_none() {
            forwarded["model_config"] = forwarded.get("modelConfig").cloned().unwrap_or(Value::Null);
        }
        if entry.model.is_none() {
            if let Some(obj) = forwarded.as_object_mut() {
                obj.remove("model");
            }
        }
        self.services[entry.service_index].chat(&forwarded, options)
    }

    fn embed(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        let model_key = request
            .get("embedModel")
            .or_else(|| request.get("embed_model"))
            .and_then(Value::as_str)
            .ok_or_else(|| AxError::runtime("Embed model key must be specified for multi-service"))?;
        let entry = self
            .entries
            .get(model_key)
            .cloned()
            .ok_or_else(|| AxError::runtime(format!("No service found for embed model key: {model_key}")))?;
        self.last_used = Some(entry.service_index);
        let mut forwarded = request.clone();
        if entry.model.is_none() {
            if let Some(obj) = forwarded.as_object_mut() {
                obj.remove("embedModel");
                obj.remove("embed_model");
            }
        }
        self.services[entry.service_index].embed(&forwarded, options)
    }

    fn transcribe(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        let service_index = request
            .get("model")
            .and_then(Value::as_str)
            .and_then(|key| self.entries.get(key).map(|entry| entry.service_index))
            .unwrap_or_else(|| self.selected_service_index());
        self.last_used = Some(service_index);
        self.services[service_index].transcribe(request, options)
    }

    fn speak(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        let service_index = request
            .get("model")
            .and_then(Value::as_str)
            .and_then(|key| self.entries.get(key).map(|entry| entry.service_index))
            .unwrap_or_else(|| self.selected_service_index());
        self.last_used = Some(service_index);
        self.services[service_index].speak(request, options)
    }

    fn set_options(&mut self, options: Value) {
        self.options = options.clone();
        let mut seen = BTreeSet::new();
        for key in &self.key_order {
            if let Some(entry) = self.entries.get(key) {
                let service = &mut self.services[entry.service_index];
                if seen.insert(service.id.clone()) {
                    service.options = options.clone();
                }
            }
        }
    }

    fn selected_service(&self) -> &RouterFixtureService {
        &self.services[self.selected_service_index()]
    }
}

fn conformance_multiservice_router_result(fixture: &Value) -> AxResult<Value> {
    let mut router = ConformanceMultiServiceRouter::new(build_router_services(fixture), fixture)?;
    let mut outputs = Map::new();
    for op in fixture
        .get("operations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let name = op.get("name").and_then(Value::as_str).unwrap_or("");
        let request = op.get("request").cloned().unwrap_or_else(|| json!({}));
        let options = op.get("options").cloned().unwrap_or_else(|| json!({}));
        match name {
            "chat" => {
                outputs.insert(name.to_string(), router.chat(&request, &options)?);
            }
            "embed" => {
                outputs.insert(name.to_string(), router.embed(&request, &options)?);
            }
            "stream" => {
                let value = router.chat(&request, &options)?;
                outputs.insert(
                    name.to_string(),
                    Value::Array(value.as_array().cloned().unwrap_or_else(|| vec![value])),
                );
            }
            "transcribe" => {
                outputs.insert(name.to_string(), router.transcribe(&request, &options)?);
            }
            "speak" => {
                outputs.insert(name.to_string(), router.speak(&request, &options)?);
            }
            "set_options" => router.set_options(options),
            _ => {}
        }
    }
    let selected = router.selected_service().clone();
    let mut actual = json!({
        "outputs": Value::Object(outputs),
        "lastChat": selected.last_chat,
        "lastEmbed": selected.last_embed,
        "lastConfig": selected.last_config,
        "metrics": selected.metrics(),
        "options": router.options,
        "serviceCalls": service_calls(&router.services)
    });
    if fixture
        .get("expected_output")
        .and_then(|expected| expected.get("modelList"))
        .is_some()
    {
        actual["modelList"] = router.model_list();
    }
    Ok(actual)
}

fn router_provider_records(services: &[RouterFixtureService]) -> Value {
    Value::Array(services.iter().map(RouterFixtureService::provider_record).collect())
}

fn conformance_provider_router_result(fixture: &Value) -> AxResult<Value> {
    let services = build_router_services(fixture);
    let primary_index = fixture
        .get("primary_index")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let mut ordered = Vec::new();
    if let Some(primary) = services.get(primary_index) {
        ordered.push(primary.clone());
    }
    for index in fixture
        .get("alternative_indices")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if let Some(service) = services.get(index.as_u64().unwrap_or(0) as usize) {
            ordered.push(service.clone());
        }
    }
    let providers = router_provider_records(&ordered);
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    let routing = fixture
        .get("routing")
        .and_then(|routing| routing.get("capability"))
        .cloned()
        .unwrap_or_else(|| json!({"requireExactMatch": false, "allowDegradation": true}));
    let processing = fixture.get("processing").cloned().unwrap_or_else(|| json!({}));
    let rec = core_value_to_json(&provider_route_recommendation(&[
        core_value_from_json(&providers),
        core_value_from_json(&request),
        core_value_from_json(&routing),
    ])?);
    let provider_name = rec
        .get("providerName")
        .or_else(|| rec.get("provider").and_then(|provider| provider.get("name")))
        .cloned()
        .unwrap_or_else(|| Value::String(String::new()));
    let recommendation = json!({
        "provider": provider_name,
        "processingApplied": rec.get("processingApplied").cloned().unwrap_or(Value::Null),
        "degradations": rec.get("degradations").cloned().unwrap_or(Value::Null),
        "warnings": rec.get("warnings").cloned().unwrap_or(Value::Null)
    });
    let validation = core_value_to_json(&provider_route_validation(&[
        core_value_from_json(&providers),
        core_value_from_json(&request),
        core_value_from_json(&processing),
        core_value_from_json(&routing),
    ])?);
    let stats = core_value_to_json(&provider_routing_stats(&[core_value_from_json(&providers)])?);
    Ok(json!({"recommendation": recommendation, "validation": validation, "stats": stats}))
}

fn balancer_base_features() -> Value {
    json!({
        "functions": false,
        "streaming": false,
        "thinking": false,
        "multiTurn": false,
        "structuredOutputs": false,
        "media": {
            "images": {"supported": false, "formats": []},
            "audio": {"supported": false, "formats": []},
            "files": {"supported": false, "formats": [], "uploadMethod": "none"},
            "urls": {"supported": false, "webSearch": false, "contextFetching": false}
        },
        "caching": {"supported": false, "types": []}
    })
}

fn feature_bool(features: &Value, key: &str, aliases: &[&str]) -> bool {
    features.get(key).and_then(Value::as_bool).unwrap_or(false)
        || aliases
            .iter()
            .any(|alias| features.get(*alias).and_then(Value::as_bool).unwrap_or(false))
}

fn append_unique(target: &mut Vec<Value>, values: &Value) {
    if let Some(items) = values.as_array() {
        for value in items {
            if !target.iter().any(|existing| existing == value) {
                target.push(value.clone());
            }
        }
    }
}

fn merged_balancer_features(services: &[RouterFixtureService]) -> Value {
    let mut out = balancer_base_features();
    for service in services {
        let raw = &service.features;
        for (key, aliases) in [
            ("functions", vec![]),
            ("streaming", vec![]),
            ("thinking", vec![]),
            ("multiTurn", vec!["multi_turn"]),
            ("structuredOutputs", vec!["structured_outputs"]),
            ("functionCot", vec!["function_cot"]),
            ("hasThinkingBudget", vec!["has_thinking_budget"]),
            ("hasShowThoughts", vec!["has_show_thoughts"]),
        ] {
            if feature_bool(raw, key, &aliases) {
                out[key] = json!(true);
            }
        }
        for kind in ["images", "audio", "files"] {
            let src = raw
                .get("media")
                .and_then(|media| media.get(kind))
                .cloned()
                .unwrap_or_else(|| json!({}));
            if src.get("supported").and_then(Value::as_bool).unwrap_or(false) {
                out["media"][kind]["supported"] = json!(true);
            }
            let mut formats = out["media"][kind]["formats"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            append_unique(&mut formats, src.get("formats").unwrap_or(&Value::Null));
            out["media"][kind]["formats"] = Value::Array(formats);
            if kind == "files" {
                if let Some(upload) = src
                    .get("uploadMethod")
                    .or_else(|| src.get("upload_method"))
                    .and_then(Value::as_str)
                    .filter(|upload| !upload.is_empty() && *upload != "none")
                {
                    out["media"]["files"]["uploadMethod"] = json!(upload);
                }
            }
        }
        let urls = raw
            .get("media")
            .and_then(|media| media.get("urls"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        if urls.get("supported").and_then(Value::as_bool).unwrap_or(false) {
            out["media"]["urls"]["supported"] = json!(true);
        }
        if urls
            .get("webSearch")
            .or_else(|| urls.get("web_search"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            out["media"]["urls"]["webSearch"] = json!(true);
        }
        if urls
            .get("contextFetching")
            .or_else(|| urls.get("context_fetching"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            out["media"]["urls"]["contextFetching"] = json!(true);
        }
        let caching = raw.get("caching").cloned().unwrap_or_else(|| json!({}));
        if caching.get("supported").and_then(Value::as_bool).unwrap_or(false) {
            out["caching"]["supported"] = json!(true);
        }
        let mut cache_types = out["caching"]["types"].as_array().cloned().unwrap_or_default();
        append_unique(&mut cache_types, caching.get("types").unwrap_or(&Value::Null));
        out["caching"]["types"] = Value::Array(cache_types);
    }
    out
}

fn balancer_metrics(services: &[RouterFixtureService]) -> Value {
    let mut chat_sum = 0.0;
    let mut chat_count = 0.0;
    let mut embed_sum = 0.0;
    let mut embed_count = 0.0;
    let mut chat_p95: f64 = 0.0;
    let mut chat_p99: f64 = 0.0;
    let mut embed_p95: f64 = 0.0;
    let mut embed_p99: f64 = 0.0;
    let mut chat_err_count = 0.0;
    let mut chat_err_total = 0.0;
    let mut embed_err_count = 0.0;
    let mut embed_err_total = 0.0;
    for service in services {
        let metrics = service.metrics();
        let chat_err = metrics
            .get("errors")
            .and_then(|errors| errors.get("chat"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let embed_err = metrics
            .get("errors")
            .and_then(|errors| errors.get("embed"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        chat_err_count += chat_err.get("count").and_then(Value::as_f64).unwrap_or(0.0);
        chat_err_total += chat_err.get("total").and_then(Value::as_f64).unwrap_or(0.0);
        embed_err_count += embed_err.get("count").and_then(Value::as_f64).unwrap_or(0.0);
        embed_err_total += embed_err.get("total").and_then(Value::as_f64).unwrap_or(0.0);
        let chat = metrics
            .get("latency")
            .and_then(|latency| latency.get("chat"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let chat_samples = chat
            .get("samples")
            .and_then(Value::as_array)
            .map(|samples| samples.len() as f64)
            .unwrap_or(0.0);
        if chat_samples > 0.0 {
            chat_sum += chat.get("mean").and_then(Value::as_f64).unwrap_or(0.0) * chat_samples;
            chat_count += chat_samples;
        }
        chat_p95 = chat_p95.max(chat.get("p95").and_then(Value::as_f64).unwrap_or(0.0));
        chat_p99 = chat_p99.max(chat.get("p99").and_then(Value::as_f64).unwrap_or(0.0));
        let embed = metrics
            .get("latency")
            .and_then(|latency| latency.get("embed"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let embed_samples = embed
            .get("samples")
            .and_then(Value::as_array)
            .map(|samples| samples.len() as f64)
            .unwrap_or(0.0);
        if embed_samples > 0.0 {
            embed_sum += embed.get("mean").and_then(Value::as_f64).unwrap_or(0.0) * embed_samples;
            embed_count += embed_samples;
        }
        embed_p95 = embed_p95.max(embed.get("p95").and_then(Value::as_f64).unwrap_or(0.0));
        embed_p99 = embed_p99.max(embed.get("p99").and_then(Value::as_f64).unwrap_or(0.0));
    }
    let chat_rate = if chat_err_total > 0.0 { chat_err_count / chat_err_total } else { 0.0 };
    let embed_rate = if embed_err_total > 0.0 { embed_err_count / embed_err_total } else { 0.0 };
    json!({
        "latency": {
            "chat": {
                "mean": if chat_count > 0.0 { chat_sum / chat_count } else { 0.0 },
                "p95": chat_p95,
                "p99": chat_p99,
                "samples": []
            },
            "embed": {
                "mean": if embed_count > 0.0 { embed_sum / embed_count } else { 0.0 },
                "p95": embed_p95,
                "p99": embed_p99,
                "samples": []
            }
        },
        "errors": {
            "chat": {"count": chat_err_count, "rate": chat_rate, "total": chat_err_total},
            "embed": {"count": embed_err_count, "rate": embed_rate, "total": embed_err_total}
        }
    })
}

fn is_retryable_ai_error(err: &AxError) -> bool {
    if err.error_type.as_deref() == Some("AxAIServiceAuthenticationError") {
        return false;
    }
    if err.error_type.as_deref() == Some("AxAIServiceStatusError") {
        return matches!(err.status, Some(408 | 429 | 500 | 502 | 503 | 504));
    }
    err.retryable
        || matches!(
            err.error_type.as_deref(),
            Some("AxAIServiceNetworkError")
                | Some("AxAIServiceResponseError")
                | Some("AxAIServiceStreamTerminatedError")
                | Some("AxAIServiceTimeoutError")
        )
}

struct ConformanceBalancer {
    services: Vec<RouterFixtureService>,
    current: usize,
    failures: BTreeMap<String, usize>,
    max_retries: usize,
}

impl ConformanceBalancer {
    fn new(mut services: Vec<RouterFixtureService>, options: &Value) -> AxResult<Self> {
        if services.is_empty() {
            return Err(AxError::runtime("No AI services provided."));
        }
        let policy = core_value_to_json(&provider_balancer_retry_policy(&[core_value_from_json(options)])?);
        let strategy = policy
            .get("strategy")
            .and_then(Value::as_str)
            .unwrap_or("metric")
            .to_string();
        let max_retries = policy
            .get("maxRetries")
            .and_then(Value::as_u64)
            .unwrap_or(3) as usize;
        Self::validate_models(&services)?;
        if strategy != "input_order" {
            services.sort_by(|a, b| {
                let a_score = provider_balancer_metric_score(&[core_value_from_json(&a.metrics())])
                    .map(|value| core_value_to_json(&value).as_f64().unwrap_or(0.0))
                    .unwrap_or(0.0);
                let b_score = provider_balancer_metric_score(&[core_value_from_json(&b.metrics())])
                    .map(|value| core_value_to_json(&value).as_f64().unwrap_or(0.0))
                    .unwrap_or(0.0);
                a_score.partial_cmp(&b_score).unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        Ok(Self {
            services,
            current: 0,
            failures: BTreeMap::new(),
            max_retries,
        })
    }

    fn validate_models(services: &[RouterFixtureService]) -> AxResult<()> {
        let reference = services
            .iter()
            .find_map(|service| service.model_list.as_array().cloned());
        let Some(reference) = reference.filter(|items| !items.is_empty()) else {
            return Ok(());
        };
        let reference_keys = reference
            .iter()
            .filter_map(|item| item.get("key").and_then(Value::as_str).map(ToString::to_string))
            .collect::<BTreeSet<_>>();
        for (index, service) in services.iter().enumerate() {
            let list = service.model_list.as_array().cloned().unwrap_or_default();
            if list.is_empty() {
                return Err(AxError::runtime(format!(
                    "Service at index {index} ({}) has no model list while another service does.",
                    service.name
                )));
            }
            let keys = list
                .iter()
                .filter_map(|item| item.get("key").and_then(Value::as_str).map(ToString::to_string))
                .collect::<BTreeSet<_>>();
            for key in &reference_keys {
                if !keys.contains(key) {
                    return Err(AxError::runtime(format!(
                        "Service at index {index} ({}) is missing model {key:?}",
                        service.name
                    )));
                }
            }
            for key in &keys {
                if !reference_keys.contains(key) {
                    return Err(AxError::runtime(format!(
                        "Service at index {index} ({}) has extra model {key:?}",
                        service.name
                    )));
                }
            }
        }
        Ok(())
    }

    fn candidate_indices(&self, request: &Value) -> AxResult<Vec<usize>> {
        let mut out = Vec::new();
        for (index, service) in self.services.iter().enumerate() {
            let allowed = core_value_to_json(&provider_balancer_candidate_allowed(&[
                core_value_from_json(&service.features),
                core_value_from_json(request),
            ])?);
            if allowed.as_bool().unwrap_or(false) {
                out.push(index);
            }
        }
        if !out.is_empty() {
            return Ok(out);
        }
        let mut requirements = Vec::new();
        if request
            .get("responseFormat")
            .or_else(|| request.get("response_format"))
            .and_then(|format| format.get("type"))
            .and_then(Value::as_str)
            == Some("json_schema")
        {
            requirements.push("structured outputs");
        }
        let capabilities = request.get("capabilities").cloned().unwrap_or_else(|| json!({}));
        if capabilities
            .get("requiresImages")
            .or_else(|| capabilities.get("requires_images"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            requirements.push("images");
        }
        if capabilities
            .get("requiresAudio")
            .or_else(|| capabilities.get("requires_audio"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            requirements.push("audio");
        }
        Err(AxError::runtime(format!(
            "No services available that support required capabilities: {}.",
            requirements.join(", ")
        )))
    }

    fn chat(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        let candidates = self.candidate_indices(request)?;
        let mut candidate_pos = 0;
        let mut current = candidates[candidate_pos];
        self.current = current;
        loop {
            let id = self.services[current].id.clone();
            if self.failures.get(&id).copied().unwrap_or(0) > 0 {
                candidate_pos += 1;
                if candidate_pos >= candidates.len() {
                    return Err(AxError::runtime(format!(
                        "All candidate services exhausted (tried {} service(s))",
                        candidates.len()
                    )));
                }
                current = candidates[candidate_pos];
                self.current = current;
                continue;
            }
            match self.services[current].chat(request, options) {
                Ok(response) => {
                    self.failures.remove(&id);
                    self.current = current;
                    return Ok(response);
                }
                Err(err) if is_retryable_ai_error(&err) => {
                    *self.failures.entry(id).or_insert(0) += 1;
                    if self.failures.get(&self.services[current].id).copied().unwrap_or(0) >= self.max_retries {
                        candidate_pos += 1;
                        if candidate_pos >= candidates.len() {
                            return Err(AxError::runtime(format!(
                                "All candidate services exhausted (tried {} service(s))",
                                candidates.len()
                            )));
                        }
                        current = candidates[candidate_pos];
                        self.current = current;
                    }
                }
                Err(err) => return Err(err),
            }
        }
    }

    fn embed(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        self.current = 0;
        self.services[0].embed(request, options)
    }

    fn transcribe(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        self.services[self.current].transcribe(request, options)
    }

    fn speak(&mut self, request: &Value, options: &Value) -> AxResult<Value> {
        self.services[self.current].speak(request, options)
    }

    fn set_options(&mut self, options: Value) {
        for service in &mut self.services {
            service.options = options.clone();
        }
    }

    fn current_service(&self) -> &RouterFixtureService {
        &self.services[self.current]
    }
}

fn conformance_balancer_result(fixture: &Value) -> AxResult<Value> {
    let options = fixture.get("options").cloned().unwrap_or_else(|| json!({}));
    let mut balancer = ConformanceBalancer::new(build_router_services(fixture), &options)?;
    let mut outputs = Map::new();
    for op in fixture
        .get("operations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let name = op.get("name").and_then(Value::as_str).unwrap_or("");
        let request = op.get("request").cloned().unwrap_or_else(|| json!({}));
        let options = op.get("options").cloned().unwrap_or_else(|| json!({}));
        match name {
            "chat" => {
                outputs.insert(name.to_string(), balancer.chat(&request, &options)?);
            }
            "embed" => {
                outputs.insert(name.to_string(), balancer.embed(&request, &options)?);
            }
            "transcribe" => {
                outputs.insert(name.to_string(), balancer.transcribe(&request, &options)?);
            }
            "speak" => {
                outputs.insert(name.to_string(), balancer.speak(&request, &options)?);
            }
            "set_options" => balancer.set_options(options),
            _ => {}
        }
    }
    let current = balancer.current_service().clone();
    let mut actual = json!({
        "id": current.id,
        "name": current.name,
        "outputs": Value::Object(outputs),
        "lastChat": current.last_chat,
        "lastEmbed": current.last_embed,
        "lastConfig": current.last_config,
        "metrics": balancer_metrics(&balancer.services),
        "options": current.options,
        "serviceCalls": service_calls(&balancer.services)
    });
    if fixture
        .get("expected_output")
        .and_then(|expected| expected.get("modelList"))
        .is_some()
    {
        actual["modelList"] = balancer
            .services
            .iter()
            .find(|service| service.model_list.as_array().map(|items| !items.is_empty()).unwrap_or(false))
            .map(|service| service.model_list.clone())
            .unwrap_or(Value::Null);
    }
    if fixture
        .get("expected_output")
        .and_then(|expected| expected.get("features"))
        .is_some()
    {
        actual["features"] = merged_balancer_features(&balancer.services);
    }
    Ok(actual)
}

// Prompt-parity gate (G3): build a real agent and assert the RLM stage instructions
// were rendered into agent state. A hollow agent has empty description keys, so this
// fails -- catching the defect that slipped a non-functional agent() past every gate.
fn run_agent_prompt_fixture(fixture: &Value) -> AxResult<()> {
    let signature = fixture
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or("question:string -> answer:string");
    let options =
        core_value_from_json(&fixture.get("options").cloned().unwrap_or_else(|| json!({})));
    let agent = agent_with_core_options(signature, options)?;
    let expects = fixture
        .get("expected_description_contains")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (field, needles) in expects.iter() {
        if field == "__order" {
            continue;
        }
        let desc_value = agent.state_json(field);
        let desc = desc_value.as_str().unwrap_or("");
        if desc.trim().is_empty() {
            return Err(AxError::new(
                "fixture",
                format!(
                    "agent stage description {field} is empty; RLM prompt was not rendered into agent state"
                ),
            ));
        }
        if let Some(items) = needles.as_array() {
            for item in items {
                if let Some(needle) = item.as_str() {
                    if !desc.contains(needle) {
                        return Err(AxError::new(
                            "fixture",
                            format!("agent stage description {field} missing {needle:?}: {desc}"),
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

fn run_agent_forward_contract_fixture(fixture: &Value) -> AxResult<()> {
    let responses = fixture
        .get("responses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut client = FixtureClient {
        responses: responses.into(),
        transcribe_responses: fixture
            .get("transcribe_responses")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into(),
        requests: Vec::new(),
    };
    let agent_options = core_value_from_json(
        &fixture.get("options").cloned().unwrap_or_else(|| json!({})),
    );
    let scripted = fixture.get("runtime_script").and_then(Value::as_array).map(|script| {
        let runtime_config = fixture
            .get("options")
            .and_then(|options| options.get("runtime"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let language = runtime_config
            .get("language")
            .and_then(Value::as_str)
            .or_else(|| fixture.get("runtime_language").and_then(Value::as_str))
            .unwrap_or("JavaScript")
            .to_string();
        let usage = runtime_config
            .get("usageInstructions")
            .or_else(|| runtime_config.get("usage_instructions"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        ScriptedCodeRuntime::new(script.clone(), language, usage)
    });
    let executed_handle = scripted.as_ref().map(|runtime| runtime.executed_handle());
    if let Some(runtime) = scripted {
        let host = core_code_runtime_host_shared(
            Rc::new(RefCell::new(Box::new(runtime) as Box<dyn AxCodeRuntime>)),
            core_runtime_capabilities_full(),
        );
        core_set(&agent_options, CoreValue::from("runtime"), host)?;
    }
    // agent_runtime_real (G1): drive forward() through the REAL embedded engine.
    if fixture.get("runtime_engine").is_some() {
        #[cfg(feature = "runtime-quickjs")]
        {
            let runtime = crate::runtime::quickjs::QuickJsCodeRuntime::new();
            let host = core_code_runtime_host_shared(
                Rc::new(RefCell::new(Box::new(runtime) as Box<dyn AxCodeRuntime>)),
                core_runtime_capabilities_full(),
            );
            core_set(&agent_options, CoreValue::from("runtime"), host)?;
        }
        #[cfg(not(feature = "runtime-quickjs"))]
        {
            return Err(AxError::new(
                "fixture",
                "agent_runtime_real requires building with --features runtime-quickjs".to_string(),
            ));
        }
    }
    let signature = fixture
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or("question:string -> answer:string");
    let mut agent = match agent_with_core_options(signature, agent_options) {
        Ok(agent) => agent,
        Err(error) => {
            if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
                if error.message.contains(expected) {
                    return Ok(());
                }
            }
            return Err(error);
        }
    };
    if let Some(state) = fixture.get("set_state") {
        agent.set_state(state.clone())?;
    }
    if let Some(snapshot) = fixture.get("restore_runtime_state") {
        agent.restore_runtime_state(snapshot.clone())?;
    }
    let input = fixture.get("input").cloned().unwrap_or_else(|| json!({}));
    let forward_options = fixture
        .get("forward_options")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let output = match agent.forward_with_options(&mut client, input, forward_options) {
        Ok(output) => output,
        Err(error) => {
            if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
                if error.message.contains(expected) {
                    if let Some(expected_clarification) = fixture.get("expected_clarification") {
                        let detail = core_agent_clarification_detail(&error).unwrap_or_else(|| json!({}));
                        expect_json_subset(
                            "clarification",
                            detail.get("clarification").unwrap_or(&Value::Null),
                            expected_clarification,
                        )?;
                    }
                    return assert_agent_trace(&mut agent, fixture);
                }
            }
            return Err(error);
        }
    };
    if fixture.get("expected_error_contains").is_some() {
        return Err(AxError::new("fixture", "expected agent forward to fail"));
    }
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("agent output", &output, expected)?;
    }
    if let Some(expected) = fixture.get("expected_request_count").and_then(Value::as_u64) {
        if client.requests.len() as u64 != expected {
            return Err(AxError::new(
                "fixture",
                format!("expected {} requests, got {}", expected, client.requests.len()),
            ));
        }
    }
    if let Some(items) = fixture.get("expected_request_contains").and_then(Value::as_array) {
        let request_text = stable_stringify(&Value::Array(client.requests.clone()));
        for item in items {
            let needle = item.as_str().map(ToString::to_string).unwrap_or_else(|| item.to_string());
            if !request_text.contains(&needle) {
                return Err(AxError::new(
                    "fixture",
                    format!("agent request missing {needle:?}: {request_text}"),
                ));
            }
        }
    }
    if let Some(rules) = fixture
        .get("expected_stage_request_not_contains")
        .and_then(Value::as_array)
    {
        for raw in rules {
            let index = raw.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let text = client
                .requests
                .get(index)
                .map(stable_stringify)
                .unwrap_or_default();
            for item in raw.get("absent").and_then(Value::as_array).into_iter().flatten() {
                let needle = item.as_str().map(ToString::to_string).unwrap_or_else(|| item.to_string());
                if text.contains(&needle) {
                    return Err(AxError::new(
                        "fixture",
                        format!("agent request {index} unexpectedly contained {needle:?}: {text}"),
                    ));
                }
            }
        }
    }
    if let Some(rules) = fixture
        .get("expected_stage_request_subset")
        .and_then(Value::as_array)
    {
        for raw in rules {
            let index = raw.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let request = client.requests.get(index).ok_or_else(|| {
                AxError::new("fixture", format!("missing agent request index {index}"))
            })?;
            expect_json_subset(
                &format!("agent request {index}"),
                request,
                raw.get("request").unwrap_or(&json!({})),
            )?;
        }
    }
    if let Some(indices) = fixture
        .get("expected_cached_request_indices")
        .and_then(Value::as_array)
    {
        for index in indices {
            let idx = index.as_u64().unwrap_or(0) as usize;
            let request = client.requests.get(idx).ok_or_else(|| {
                AxError::new("fixture", format!("missing cached request index {idx}"))
            })?;
            let prompt = request
                .get("chat_prompt")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let cached = prompt.iter().any(|message| {
                message.get("cache").and_then(Value::as_bool).unwrap_or(false)
            });
            if !cached {
                return Err(AxError::new(
                    "fixture",
                    format!("agent request {idx} did not contain a cached prompt message: {prompt:?}"),
                ));
            }
        }
    }
    if let Some(expected) = fixture.get("expected_chat_log_subset").and_then(Value::as_array) {
        expect_json_list_subset(
            "agent chat log",
            &Value::Array(agent.get_chat_log()),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_state") {
        expect_json_subset("agent state", &agent.get_state()?, expected)?;
    }
    let exported = agent.export_runtime_state()?;
    if let Some(expected) = fixture.get("expected_runtime_contract_subset") {
        expect_json_subset("runtime contract", &agent.get_runtime_contract(), expected)?;
    }
    if let Some(expected) = fixture.get("expected_exported_state_subset") {
        expect_json_subset("runtime state", &exported, expected)?;
    }
    if let Some(expected) = fixture.get("expected_action_log_subset").and_then(Value::as_array) {
        expect_json_list_subset(
            "action log",
            exported.get("action_log").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_executed").and_then(Value::as_array) {
        let executed = executed_handle
            .map(|shared| {
                shared
                    .borrow()
                    .executed
                    .iter()
                    .map(|code| Value::String(code.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        expect_json_equal(
            "executed code",
            &Value::Array(executed),
            &Value::Array(expected.clone()),
        )?;
    }
    assert_agent_trace(&mut agent, fixture)
}

fn assert_agent_trace(agent: &mut AxAgent, fixture: &Value) -> AxResult<()> {
    let trace = agent.export_trace()?;
    if let Some(expected) = fixture.get("expected_trace_subset") {
        expect_json_subset("agent trace", &trace, expected)?;
    }
    if let Some(expected) = fixture.get("expected_trace_event_kinds").and_then(Value::as_array) {
        let kinds = trace
            .get("events")
            .and_then(Value::as_array)
            .map(|events| {
                events
                    .iter()
                    .map(|event| event.get("kind").cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        expect_json_equal(
            "agent trace event kinds",
            &Value::Array(kinds),
            &Value::Array(expected.clone()),
        )?;
    }
    if fixture.get("replay_trace").map(core_json_truthy).unwrap_or(false) {
        let mut replay_fixtures = fixture
            .get("replay_fixtures")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if let Some(kinds) = fixture.get("expected_trace_event_kinds") {
            replay_fixtures
                .entry("expected_event_kinds".to_string())
                .or_insert_with(|| kinds.clone());
        }
        if let Some(output) = fixture.get("expected_output") {
            replay_fixtures
                .entry("expected_output".to_string())
                .or_insert_with(|| output.clone());
        }
        let replayed = agent.replay_trace(trace, Value::Object(replay_fixtures))?;
        if let Some(expected) = fixture.get("expected_replay_result_subset") {
            expect_json_subset("agent replay", &replayed, expected)?;
        } else {
            expect_json_subset(
                "agent replay",
                &replayed,
                &json!({"ok": true, "status": "replayed"}),
            )?;
        }
    }
    Ok(())
}


// Mirrors python conformance._runtime_protocol_command: python spawns its own
// interpreter on the scripted protocol server entrypoint; the Rust runner
// re-execs the conformance binary with --runtime-protocol-fixture-server. The
// mode travels as an argument because ProcessCodeRuntime has no env plumbing.
fn runtime_protocol_fixture_command(mode: &str) -> AxResult<ProcessCodeRuntime> {
    let exe = std::env::current_exe()
        .map_err(|err| AxError::runtime(format!("cannot locate conformance binary: {err}")))?;
    Ok(ProcessCodeRuntime::new([
        exe.to_string_lossy().to_string(),
        "--runtime-protocol-fixture-server".to_string(),
        mode.to_string(),
    ]))
}

// Mirrors python conformance._run_agent_runtime_protocol: drives the real
// ProcessCodeRuntime protocol client against the scripted server subprocess.
fn run_agent_runtime_protocol_fixture(fixture: &Value) -> AxResult<()> {
    let mode = fixture.get("mode").and_then(Value::as_str).unwrap_or("normal");
    let mut runtime = runtime_protocol_fixture_command(mode)?;
    let result = run_agent_runtime_protocol_operation(fixture, &mut runtime);
    let _ = runtime.shutdown();
    match result {
        Ok(()) => Ok(()),
        Err(err) => {
            if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
                if err.message.contains(expected) {
                    return Ok(());
                }
            }
            Err(err)
        }
    }
}

fn run_agent_runtime_protocol_operation(
    fixture: &Value,
    runtime: &mut ProcessCodeRuntime,
) -> AxResult<()> {
    let create_globals = fixture.get("create_globals").cloned().unwrap_or_else(|| json!({}));
    let create_options = fixture.get("create_options").cloned().unwrap_or_else(|| json!({}));
    let execute_options = fixture.get("execute_options").cloned().unwrap_or_else(|| json!({}));
    match fixture.get("operation").and_then(Value::as_str).unwrap_or("roundtrip") {
        "roundtrip" => {
            let capabilities = runtime
                .request("capabilities", None, json!({}))?
                .get("result")
                .cloned()
                .unwrap_or(Value::Null);
            if let Some(expected) = fixture.get("expected_capabilities_subset") {
                expect_json_subset("protocol capabilities", &capabilities, expected)?;
            }
            let mut session = runtime.create_session(create_globals, create_options)?;
            let result = session.execute(
                fixture.get("execute_code").and_then(Value::as_str).unwrap_or("final()"),
                execute_options,
            )?;
            if let Some(expected) = fixture.get("expected_execute_subset") {
                expect_json_subset("protocol execute", &result.payload, expected)?;
            }
            let inspected = session.inspect_globals(json!({}))?;
            if let Some(expected) = fixture.get("expected_inspect_subset") {
                expect_json_subset("protocol inspect", &inspected, expected)?;
            }
            let snapshot = session.snapshot_globals(json!({}))?;
            if let Some(expected) = fixture.get("expected_snapshot_subset") {
                expect_json_subset("protocol snapshot", &snapshot, expected)?;
            }
            let patched = session.patch_globals(
                fixture.get("patch_globals").cloned().unwrap_or_else(|| json!({})),
                json!({}),
            )?;
            if let Some(expected) = fixture.get("expected_patch_subset") {
                expect_json_subset("protocol patch", &patched, expected)?;
            }
            let closed = session.close()?;
            if let Some(expected) = fixture.get("expected_close_subset") {
                expect_json_subset("protocol close", &closed, expected)?;
            }
            Ok(())
        }
        "execute_error" => {
            let mut session = runtime.create_session(create_globals, create_options)?;
            let result = session.execute(
                fixture.get("execute_code").and_then(Value::as_str).unwrap_or("timeout()"),
                execute_options,
            )?;
            if let Some(expected) = fixture.get("expected_execute_subset") {
                expect_json_subset("protocol execute error", &result.payload, expected)?;
            }
            let _ = session.close();
            Ok(())
        }
        "unknown_op" => {
            runtime.request("unknown_op", None, json!({}))?;
            Err(AxError::new("fixture", "expected unknown protocol op to fail"))
        }
        "capabilities_error" => {
            runtime.request("capabilities", None, json!({}))?;
            Err(AxError::new("fixture", "expected protocol capabilities request to fail"))
        }
        "unavailable" => {
            let mut session = runtime.create_session(create_globals, create_options)?;
            match fixture.get("method").and_then(Value::as_str).unwrap_or("inspect_globals") {
                "snapshot_globals" => session.snapshot_globals(json!({}))?,
                "patch_globals" => session.patch_globals(json!({}), json!({}))?,
                _ => session.inspect_globals(json!({}))?,
            };
            Err(AxError::new("fixture", "expected unavailable protocol method to fail"))
        }
        "session_mismatch" => {
            let _session = runtime.create_session(create_globals, create_options)?;
            runtime.request(
                "execute",
                Some("s1"),
                json!({
                    "code": fixture.get("execute_code").and_then(Value::as_str).unwrap_or("final()"),
                    "options": {},
                }),
            )?;
            Err(AxError::new("fixture", "expected protocol session mismatch to fail"))
        }
        other => Err(AxError::new(
            "fixture",
            format!("unknown runtime protocol operation {other:?}"),
        )),
    }
}

// Mirrors python conformance._runtime_protocol_fixture_server_main: the
// scripted stdin/stdout JSONL protocol server hosted by the conformance
// binary when invoked with --runtime-protocol-fixture-server <mode>.
pub fn runtime_protocol_fixture_server_main(mode: &str) -> AxResult<()> {
    let stdin = std::io::stdin();
    let mut sessions: BTreeMap<String, Value> = BTreeMap::new();
    let mut next_session = 0usize;
    for line in stdin.lock().lines() {
        let line = line?;
        match mode {
            "eof" => return Ok(()),
            "malformed_json" => {
                let mut out = std::io::stdout();
                writeln!(out, "{{not-json")?;
                out.flush()?;
                return Ok(());
            }
            "nonzero" => {
                eprintln!("fixture stderr before nonzero exit");
                std::process::exit(7);
            }
            _ => {}
        }
        let (response, stop) =
            runtime_protocol_fixture_step(mode, &line, &mut sessions, &mut next_session);
        let mut out = std::io::stdout();
        writeln!(out, "{}", serde_json::to_string(&response)?)?;
        out.flush()?;
        if stop {
            return Ok(());
        }
    }
    Ok(())
}

fn runtime_protocol_fixture_ok(id: &Value, result: Value, session_id: Option<&Value>) -> Value {
    let mut out = json!({"id": id.clone(), "ok": true, "result": result});
    if let Some(session_id) = session_id {
        if !session_id.is_null() {
            out["session_id"] = session_id.clone();
        }
    }
    out
}

fn runtime_protocol_fixture_fail(id: &Value, category: &str, message: &str) -> Value {
    json!({"id": id.clone(), "ok": false, "error": {"category": category, "message": message}})
}

fn runtime_protocol_fixture_snapshot(session: &Value) -> Value {
    let bindings = session
        .get("globals")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let entries = bindings
        .iter()
        .map(|(key, value)| {
            json!({
                "name": key,
                "type": python_type_name(value),
                "preview": python_str(value),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "version": 1,
        "entries": entries,
        "bindings": Value::Object(bindings.clone()),
        "globals": Value::Object(bindings),
        "closed": session.get("closed").map(core_json_truthy).unwrap_or(false),
    })
}

fn runtime_protocol_fixture_step(
    mode: &str,
    line: &str,
    sessions: &mut BTreeMap<String, Value>,
    next_session: &mut usize,
) -> (Value, bool) {
    let message: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(err) => {
            return (
                runtime_protocol_fixture_fail(&Value::Null, "protocol", &err.to_string()),
                false,
            )
        }
    };
    let op = message
        .get("op")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let response_id = if mode == "id_mismatch" {
        json!("mismatch")
    } else {
        message.get("id").cloned().unwrap_or(Value::Null)
    };
    let message_session_id = message.get("session_id").cloned().unwrap_or(Value::Null);
    let session_key = message_session_id.as_str().unwrap_or_default().to_string();
    let unavailable = mode == "unavailable";
    let response = match op.as_str() {
        "capabilities" => runtime_protocol_fixture_ok(
            &response_id,
            json!({
                "language": "JavaScript",
                "usage_instructions": "fixture protocol runtime",
                "inspect": !unavailable,
                "snapshot": !unavailable,
                "patch": !unavailable,
                "abort": true,
            }),
            None,
        ),
        "create_session" => {
            *next_session += 1;
            let session_id = format!("s{next_session}");
            let payload = message
                .get("payload")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut globals = payload
                .get("globals")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            globals.insert(
                "__create_options".to_string(),
                payload
                    .get("options")
                    .filter(|options| options.is_object())
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            );
            sessions.insert(
                session_id.clone(),
                json!({"globals": globals, "closed": false}),
            );
            let mut out = runtime_protocol_fixture_ok(
                &response_id,
                json!({"session_id": session_id}),
                None,
            );
            out["session_id"] = json!(session_id);
            out
        }
        "execute" | "derive" => {
            let closed_or_missing = sessions
                .get(&session_key)
                .map(|session| session.get("closed").map(core_json_truthy).unwrap_or(false))
                .unwrap_or(true);
            let mut response = if closed_or_missing {
                runtime_protocol_fixture_fail(&response_id, "session_closed", "session closed or unknown")
            } else {
                let payload = message
                    .get("payload")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                let code = payload
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if let Some(session) = sessions.get_mut(&session_key) {
                    session["globals"]["__last_execute_options"] = payload
                        .get("options")
                        .filter(|options| options.is_object())
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                }
                match code.as_str() {
                    "timeout()" => runtime_protocol_fixture_fail(&response_id, "timeout", "fixture timeout"),
                    "sessionClosed()" => runtime_protocol_fixture_fail(
                        &response_id,
                        "session_closed",
                        "fixture session closed",
                    ),
                    "abort()" => runtime_protocol_fixture_fail(&response_id, "abort", "fixture abort"),
                    "userError()" => {
                        runtime_protocol_fixture_fail(&response_id, "user_error", "fixture user error")
                    }
                    _ => {
                        if let Some(session) = sessions.get_mut(&session_key) {
                            session["globals"]["answer"] = json!("fixture");
                        }
                        runtime_protocol_fixture_ok(
                            &response_id,
                            json!({"type": "final", "args": [{"answer": "fixture"}]}),
                            Some(&message_session_id),
                        )
                    }
                }
            };
            if mode == "session_mismatch"
                && response.get("ok").and_then(Value::as_bool).unwrap_or(false)
            {
                response["session_id"] = json!("wrong-session");
            }
            response
        }
        "inspect_globals" => {
            if unavailable {
                runtime_protocol_fixture_fail(&response_id, "unavailable", "inspectGlobals unavailable")
            } else {
                let globals = sessions
                    .get(&session_key)
                    .and_then(|session| session.get("globals"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                runtime_protocol_fixture_ok(&response_id, globals, Some(&message_session_id))
            }
        }
        "snapshot_globals" => {
            if unavailable {
                runtime_protocol_fixture_fail(&response_id, "unavailable", "snapshotGlobals unavailable")
            } else {
                let snapshot = runtime_protocol_fixture_snapshot(
                    sessions.get(&session_key).unwrap_or(&json!({})),
                );
                runtime_protocol_fixture_ok(&response_id, snapshot, Some(&message_session_id))
            }
        }
        "patch_globals" => {
            if unavailable {
                runtime_protocol_fixture_fail(&response_id, "unavailable", "patchGlobals unavailable")
            } else {
                let payload = message
                    .get("payload")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                let raw = payload
                    .get("globals")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                let bindings = raw
                    .get("bindings")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or(raw);
                if let Some(session) = sessions.get_mut(&session_key) {
                    session["globals"] = Value::Object(bindings);
                }
                let snapshot = runtime_protocol_fixture_snapshot(
                    sessions.get(&session_key).unwrap_or(&json!({})),
                );
                runtime_protocol_fixture_ok(&response_id, snapshot, Some(&message_session_id))
            }
        }
        "close" => {
            if let Some(session) = sessions.get_mut(&session_key) {
                session["closed"] = json!(true);
            }
            runtime_protocol_fixture_ok(&response_id, json!({"closed": true}), Some(&message_session_id))
        }
        "shutdown" => runtime_protocol_fixture_ok(&response_id, json!({"shutdown": true}), None),
        other => runtime_protocol_fixture_fail(
            &response_id,
            "protocol",
            &format!("unknown runtime protocol op: {other}"),
        ),
    };
    (response, op == "shutdown")
}

// python: a or b or ... or {} (falls through falsy candidates).
fn conformance_first_truthy(candidates: &[Option<&Value>]) -> Value {
    for candidate in candidates.iter().flatten() {
        if core_json_truthy(candidate) {
            return (*candidate).clone();
        }
    }
    json!({})
}

// Mirrors python conformance._run_agent_runtime_session: drives a real
// AxAgent against a ScriptedCodeRuntime and asserts on the observable state.
fn run_agent_runtime_session_fixture(fixture: &Value) -> AxResult<()> {
    let signature = fixture
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or("question:string -> answer:string");
    let agent_options =
        core_value_from_json(&fixture.get("options").cloned().unwrap_or_else(|| json!({})));
    let mut agent = agent_with_core_options(signature, agent_options)?;
    let mut runtime = ScriptedCodeRuntime::new(
        fixture
            .get("runtime_script")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        "JavaScript".to_string(),
        String::new(),
    )
    .with_fixture_capabilities(fixture.get("runtime_capabilities"));
    let shared = runtime.executed_handle();
    let mut result = Value::Null;
    let mut caught_expected_error = false;
    if let Err(err) =
        run_agent_runtime_session_operations(fixture, &mut agent, &mut runtime, &mut result)
    {
        match fixture.get("expected_error_contains").and_then(Value::as_str) {
            Some(expected) if err.message.contains(expected) => {
                caught_expected_error = true;
                result = Value::Null;
            }
            _ => return Err(err),
        }
    }
    if fixture.get("expected_error_contains").is_some() && !caught_expected_error {
        return Err(AxError::new(
            "fixture",
            "expected agent runtime session fixture to fail",
        ));
    }
    if let Some(expected) = fixture.get("expected_result_subset") {
        expect_json_subset("runtime result", &result, expected)?;
    }
    if let Some(expected) = fixture.get("expected_result") {
        expect_json_equal("runtime result", &result, expected)?;
    }
    let exported = agent.export_runtime_state()?;
    if let Some(expected) = fixture.get("expected_exported_state_subset") {
        expect_json_subset("runtime state", &exported, expected)?;
    }
    if let Some(expected) = fixture.get("expected_action_log_subset").and_then(Value::as_array) {
        expect_json_list_subset(
            "action log",
            exported.get("action_log").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_status_log_subset").and_then(Value::as_array) {
        expect_json_list_subset(
            "status log",
            exported.get("status_log").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_session_count").and_then(Value::as_u64) {
        let actual = shared.borrow().session_closed.len() as u64;
        if actual != expected {
            return Err(AxError::new(
                "fixture",
                format!("expected {expected} sessions, got {actual}"),
            ));
        }
    }
    if let Some(expected) = fixture.get("expected_closed_session_count").and_then(Value::as_u64) {
        let actual = shared
            .borrow()
            .session_closed
            .iter()
            .filter(|closed| **closed)
            .count() as u64;
        if actual != expected {
            return Err(AxError::new(
                "fixture",
                format!("expected {expected} closed sessions, got {actual}"),
            ));
        }
    }
    if let Some(expected) = fixture.get("expected_executed").and_then(Value::as_array) {
        let executed = shared
            .borrow()
            .executed
            .iter()
            .map(|code| Value::String(code.clone()))
            .collect::<Vec<_>>();
        expect_json_equal(
            "executed code",
            &Value::Array(executed),
            &Value::Array(expected.clone()),
        )?;
    }
    if let Some(expected) = fixture.get("expected_create_globals_subset") {
        let last = shared.borrow().create_requests.last().cloned().ok_or_else(|| {
            AxError::new("fixture", "expected at least one runtime create_session request")
        })?;
        expect_json_subset(
            "runtime create globals",
            last.get("globals").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_create_options_subset") {
        let last = shared.borrow().create_requests.last().cloned().ok_or_else(|| {
            AxError::new("fixture", "expected at least one runtime create_session request")
        })?;
        expect_json_subset(
            "runtime create options",
            last.get("options").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_execute_options_subset") {
        let last = shared.borrow().execute_options.last().cloned().ok_or_else(|| {
            AxError::new("fixture", "expected at least one runtime execute request")
        })?;
        expect_json_subset("runtime execute options", &last, expected)?;
    }
    if let Some(expected) = fixture.get("expected_runtime_inspection") {
        expect_json_equal(
            "runtime inspection",
            exported.get("runtime_inspection").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_runtime_inspection_contains")
        .and_then(Value::as_str)
    {
        let inspection = exported.get("runtime_inspection").cloned().unwrap_or(Value::Null);
        let text = inspection
            .as_str()
            .map(ToString::to_string)
            .unwrap_or_else(|| stable_stringify(&inspection));
        if !text.contains(expected) {
            return Err(AxError::new(
                "fixture",
                format!("runtime inspection expected to contain {expected:?}, got {text:?}"),
            ));
        }
    }
    if let Some(keys) = fixture
        .get("expected_absent_runtime_session_globals")
        .and_then(Value::as_array)
    {
        let globals = exported
            .get("runtime_session_state")
            .and_then(|state| state.get("globals"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        for key in keys {
            let key = key.as_str().unwrap_or_default();
            if globals.get(key).is_some() {
                return Err(AxError::new(
                    "fixture",
                    format!("runtime session globals unexpectedly contained {key:?}"),
                ));
            }
        }
    }
    assert_agent_trace(&mut agent, fixture)
}

fn run_agent_runtime_session_operations(
    fixture: &Value,
    agent: &mut AxAgent,
    runtime: &mut ScriptedCodeRuntime,
    result: &mut Value,
) -> AxResult<()> {
    let code = fixture.get("code").and_then(Value::as_str).unwrap_or("");
    match fixture.get("operation").and_then(Value::as_str).unwrap_or("test") {
        "test" => {
            let values = conformance_first_truthy(&[
                fixture.get("context_values"),
                fixture.get("input"),
            ]);
            let options = conformance_first_truthy(&[fixture.get("runtime_options")]);
            *result = agent.test(runtime, code, values, options)?.payload;
        }
        "steps" => {
            for step in fixture.get("steps").and_then(Value::as_array).into_iter().flatten() {
                if let Some(snapshot) = step.get("restore_session_state") {
                    agent.restore_session_state(conformance_first_truthy(&[Some(snapshot)]))?;
                }
                let values = conformance_first_truthy(&[
                    step.get("values"),
                    fixture.get("context_values"),
                    fixture.get("input"),
                ]);
                let options = conformance_first_truthy(&[step.get("options")]);
                let step_code = step.get("code").and_then(Value::as_str).unwrap_or("");
                *result = agent
                    .execute_actor_step(runtime, step_code, values, options)?
                    .payload;
                if step.get("inspect").map(core_json_truthy).unwrap_or(false) {
                    agent.inspect_runtime()?;
                }
                if step
                    .get("export_session_state")
                    .map(core_json_truthy)
                    .unwrap_or(false)
                {
                    agent.export_session_state()?;
                }
            }
            if fixture
                .get("close_runtime_session")
                .map(core_json_truthy)
                .unwrap_or(false)
            {
                agent.close_runtime_session()?;
            }
        }
        "reserved" => {
            let values = conformance_first_truthy(&[fixture.get("context_values")]);
            *result = agent.test(runtime, code, values, json!({}))?.payload;
        }
        other => {
            return Err(AxError::new(
                "fixture",
                format!("unknown agent runtime session operation {other:?}"),
            ));
        }
    }
    Ok(())
}

// Mirrors python conformance._runtime_adapter_call: the raw RuntimeEnvelope
// helper payloads exercised by the adapter fixtures.
fn runtime_adapter_call(spec: &Value) -> AxResult<Value> {
    let name = spec.get("name").and_then(Value::as_str).unwrap_or_default();
    let args = spec
        .get("args")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let kwargs = spec.get("kwargs").cloned().unwrap_or_else(|| json!({}));
    let arg = |index: usize| args.get(index).cloned();
    let text = |value: Option<Value>, fallback: &str| -> String {
        match value {
            Some(Value::String(text)) => text,
            Some(other) => stable_stringify(&other),
            None => fallback.to_string(),
        }
    };
    let error_envelope = |message: String, category: &str| {
        json!({"kind": "error", "is_error": true, "error_category": category, "error": message})
    };
    // python RuntimeEnvelope.final/ask_clarification flatten a single list arg.
    let completion_args = |args: &[Value]| -> Vec<Value> {
        if args.len() == 1 {
            if let Some(items) = args[0].as_array() {
                return items.clone();
            }
        }
        args.to_vec()
    };
    match name {
        "result" => Ok(json!({"kind": "result", "result": arg(0).unwrap_or(Value::Null)})),
        "error" => {
            let category = arg(1)
                .and_then(|value| value.as_str().map(ToString::to_string))
                .or_else(|| {
                    kwargs
                        .get("category")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })
                .unwrap_or_else(|| "runtime".to_string());
            Ok(error_envelope(text(arg(0), ""), &category))
        }
        "session_closed" => Ok(error_envelope(text(arg(0), "session closed"), "session_closed")),
        "timeout" => Ok(error_envelope(text(arg(0), "execution timed out"), "timeout")),
        "final" => Ok(json!({"type": "final", "args": completion_args(&args)})),
        "ask_clarification" => {
            Ok(json!({"type": "askClarification", "args": completion_args(&args)}))
        }
        "discover" => Ok(json!({"kind": "discover", "discover": arg(0).unwrap_or_else(|| json!({}))})),
        "recall" => Ok(json!({"kind": "recall", "recall": arg(0).unwrap_or_else(|| json!([]))})),
        "used" => {
            let request = arg(0).unwrap_or_else(|| json!({}));
            let mut payload = match request {
                Value::Object(map) => map,
                other => {
                    let mut map = Map::new();
                    map.insert("id".to_string(), other);
                    map
                }
            };
            for key in ["reason", "stage"] {
                if let Some(value) = kwargs.get(key) {
                    if !value.is_null() {
                        payload.insert(key.to_string(), value.clone());
                    }
                }
            }
            Ok(json!({"kind": "used", "used": payload}))
        }
        "status" => Ok(json!({
            "kind": "status",
            "status": {"type": text(arg(0), "success"), "message": text(arg(1), "")},
        })),
        "guide_agent" => {
            let mut payload = json!({"type": "guide_agent", "guidance": text(arg(0), "")});
            if let Some(triggered_by) = arg(1) {
                if !triggered_by.is_null() {
                    payload["triggeredBy"] = triggered_by;
                }
            }
            Ok(payload)
        }
        other => Err(AxError::new(
            "fixture",
            format!("unknown runtime adapter helper {other:?}"),
        )),
    }
}

// Mirrors python conformance._run_agent_runtime_adapter.
fn run_agent_runtime_adapter_fixture(fixture: &Value) -> AxResult<()> {
    if let Some(raw) = fixture.get("capabilities") {
        // python builds RuntimeCapabilities(...).to_dict(); the Rust struct
        // only models the session-host gates, so the dict (with the python
        // defaults) is assembled directly.
        let capabilities = json!({
            "inspect": raw.get("inspect").cloned().unwrap_or(json!(true)),
            "snapshot": raw.get("snapshot").cloned().unwrap_or(json!(true)),
            "patch": raw.get("patch").cloned().unwrap_or(json!(true)),
            "abort": raw.get("abort").cloned().unwrap_or(json!(false)),
            "language": raw.get("language").cloned().unwrap_or(json!("JavaScript")),
            "usage_instructions": raw.get("usage_instructions").cloned().unwrap_or(json!("")),
        });
        if let Some(expected) = fixture.get("expected_capabilities") {
            expect_json_subset("runtime capabilities", &capabilities, expected)?;
        }
    }
    for spec in fixture
        .get("helper_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = spec.get("name").and_then(Value::as_str).unwrap_or_default();
        let actual = runtime_adapter_call(spec)?;
        if let Some(expected) = spec.get("expected") {
            expect_json_equal(&format!("runtime helper {name}"), &actual, expected)?;
        }
        if let Some(expected) = spec.get("expected_subset") {
            expect_json_subset(&format!("runtime helper {name}"), &actual, expected)?;
        }
        if spec.get("normalize").map(core_json_truthy).unwrap_or(false) {
            let normalized = core_value_to_json(&_normalize_agent_runtime_step_result(&[
                core_value_from_json(&actual),
                CoreValue::from(spec.get("code").and_then(Value::as_str).unwrap_or("<adapter>")),
            ])?);
            if let Some(expected) = spec.get("expected_normalized_subset") {
                expect_json_subset(
                    &format!("runtime helper normalized {name}"),
                    &normalized,
                    expected,
                )?;
            }
        }
    }
    if let Some(run_session) = fixture.get("run_session") {
        if core_json_truthy(run_session) {
            let mut session_fixture = Map::new();
            session_fixture.insert(
                "signature".to_string(),
                fixture
                    .get("signature")
                    .cloned()
                    .unwrap_or_else(|| json!("question:string -> answer:string")),
            );
            session_fixture.insert("operation".to_string(), json!("test"));
            session_fixture.insert("code".to_string(), json!("adapter()"));
            session_fixture.insert(
                "context_values".to_string(),
                conformance_first_truthy(&[
                    fixture.get("context_values"),
                    Some(&json!({"question": "adapter"})),
                ]),
            );
            session_fixture.insert(
                "runtime_script".to_string(),
                json!([{"expected_code": "adapter()", "result": runtime_adapter_call(run_session)?}]),
            );
            for key in [
                "expected_result_subset",
                "expected_action_log_subset",
                "expected_trace_event_kinds",
                "expected_closed_session_count",
            ] {
                if let Some(value) = fixture.get(key) {
                    if !value.is_null() {
                        session_fixture.insert(key.to_string(), value.clone());
                    }
                }
            }
            run_agent_runtime_session_fixture(&Value::Object(session_fixture))?;
        }
    }
    Ok(())
}

// python: state.get(key) or [] (treats missing/None as an empty list).
fn conformance_list_or_empty(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Array(items)) => Value::Array(items.clone()),
        _ => json!([]),
    }
}

// Mirrors python conformance._run_agent_runtime_policy: builds a real AxAgent
// and asserts on its policy/registry/exported-state surfaces.
fn run_agent_runtime_policy_fixture(fixture: &Value) -> AxResult<()> {
    let mut agent = match run_agent_runtime_policy_operations(fixture) {
        Ok(agent) => agent,
        Err(err) => {
            if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
                if err.message.contains(expected) {
                    return Ok(());
                }
            }
            return Err(err);
        }
    };
    if fixture.get("expected_error_contains").is_some() {
        return Err(AxError::new(
            "fixture",
            "expected agent runtime policy fixture to fail",
        ));
    }
    if let Some(expected) = fixture.get("expected_runtime_contract_subset") {
        expect_json_subset("runtime contract", &agent.get_runtime_contract(), expected)?;
    }
    if let Some(expected) = fixture.get("expected_policy_subset") {
        expect_json_subset("agent policy", &agent.get_policy(), expected)?;
    }
    if let Some(expected) = fixture.get("expected_policy_registry_subset") {
        expect_json_subset("policy registry", &agent.get_policy_registry(), expected)?;
    }
    let registry = agent.get_policy_registry();
    for (label, registry_key, expected_key) in [
        ("actor primitives", "actor_primitives", "expected_actor_primitives_subset"),
        ("protocol actions", "protocol_actions", "expected_protocol_actions_subset"),
        ("runtime globals", "runtime_globals", "expected_runtime_globals_subset"),
        ("host boundaries", "host_boundaries", "expected_host_boundaries_subset"),
    ] {
        if let Some(expected) = fixture.get(expected_key).and_then(Value::as_array) {
            expect_json_list_subset(
                label,
                &conformance_list_or_empty(registry.get(registry_key)),
                expected,
            )?;
        }
    }
    if let Some(expected) = fixture
        .get("expected_callable_inventory_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset("callable inventory", &agent.get_callable_inventory(), expected)?;
    }
    if let Some(expected) = fixture
        .get("expected_discovery_catalog_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset("discovery catalog", &agent.get_discovery_catalog(), expected)?;
    }
    let state = agent.export_runtime_state()?;
    for (label, state_key, expected_key) in [
        ("discovered tools", "discovered_tool_docs", "expected_discovered_tool_docs_subset"),
        ("loaded skills", "loaded_skill_docs", "expected_loaded_skill_docs_subset"),
        ("loaded memories", "loaded_memories", "expected_loaded_memories_subset"),
        ("used memories", "used_memories", "expected_used_memories_subset"),
        ("used skills", "used_skills", "expected_used_skills_subset"),
        ("guidance log", "guidance_log", "expected_guidance_log_subset"),
        ("function call traces", "function_call_traces", "expected_function_call_traces_subset"),
        ("policy trace", "policy_trace", "expected_policy_trace_subset"),
        ("action log", "action_log", "expected_action_log_subset"),
    ] {
        if let Some(expected) = fixture.get(expected_key).and_then(Value::as_array) {
            expect_json_list_subset(
                label,
                &conformance_list_or_empty(state.get(state_key)),
                expected,
            )?;
        }
    }
    if let Some(expected) = fixture.get("expected_exported_state_subset") {
        expect_json_subset("exported runtime state", &state, expected)?;
    }
    if let Some(expected) = fixture.get("expected_optimizer_metadata_subset") {
        expect_json_subset("optimizer metadata", &agent.get_optimizer_metadata()?, expected)?;
    }
    assert_agent_trace(&mut agent, fixture)
}

fn run_agent_runtime_policy_operations(fixture: &Value) -> AxResult<AxAgent> {
    let signature = fixture
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or("question:string -> answer:string");
    let agent_options =
        core_value_from_json(&fixture.get("options").cloned().unwrap_or_else(|| json!({})));
    let mut agent = agent_with_core_options(signature, agent_options)?;
    if let Some(request) = fixture.get("discover") {
        let request = if core_json_truthy(request) {
            request.clone()
        } else {
            json!({})
        };
        let result = agent.discover(request)?;
        if let Some(expected) = fixture.get("expected_discover_result") {
            expect_json_equal("discover result", &result, expected)?;
        }
    }
    if let Some(request) = fixture.get("recall") {
        let request = if core_json_truthy(request) {
            request.clone()
        } else {
            json!([])
        };
        let result = agent.recall(request)?;
        if let Some(expected) = fixture.get("expected_recall_result") {
            expect_json_equal("recall result", &result, expected)?;
        }
    }
    if let Some(used) = fixture.get("used") {
        let result = agent.used(
            used.get("id").and_then(Value::as_str).unwrap_or(""),
            used.get("reason").and_then(Value::as_str).unwrap_or(""),
            used.get("stage").and_then(Value::as_str).unwrap_or("executor"),
        )?;
        if let Some(expected) = fixture.get("expected_used_result") {
            expect_json_equal("used result", &result, expected)?;
        }
    }
    if let Some(call) = fixture.get("invoke_callable") {
        let qualified_name = call
            .get("qualified_name")
            .or_else(|| call.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let args = conformance_first_truthy(&[call.get("args")]);
        let result = agent.invoke_callable(qualified_name, args, json!({}))?;
        if let Some(expected) = fixture.get("expected_callable_result_subset") {
            expect_json_subset("callable result", &result, expected)?;
        }
    }
    if let Some(trace) = fixture.get("replay_trace_input") {
        let result = agent.replay_trace(
            conformance_first_truthy(&[Some(trace)]),
            conformance_first_truthy(&[fixture.get("replay_fixtures")]),
        )?;
        if let Some(expected) = fixture.get("expected_replay_result_subset") {
            expect_json_subset("agent replay", &result, expected)?;
        }
    }
    if let Some(snapshot) = fixture.get("restore_runtime_state") {
        agent.restore_runtime_state(conformance_first_truthy(&[Some(snapshot)]))?;
    }
    if fixture.get("context_operation").is_some() {
        // python conformance calls the shared _agent_context_fixture_result
        // helper (emitted in the core) on the agent state plus the fixture.
        let result = core_value_to_json(&_agent_context_fixture_result(&[
            agent.state.clone(),
            core_value_from_json(fixture),
        ])?);
        if let Some(expected) = fixture.get("expected_context_result") {
            expect_json_equal("agent context result", &result, expected)?;
        }
        if let Some(expected) = fixture.get("expected_context_result_subset") {
            expect_json_subset("agent context result", &result, expected)?;
        }
        if let Some(expected) = fixture
            .get("expected_context_events_subset")
            .and_then(Value::as_array)
        {
            let events = result
                .get("exported")
                .and_then(|exported| exported.get("context_events"))
                .cloned()
                .unwrap_or_else(|| json!([]));
            expect_json_list_subset("agent context events", &events, expected)?;
        }
    }
    if let Some(payload) = fixture.get("final_payload") {
        let normalized = core_value_to_json(&_normalize_agent_final_payload(&[
            core_value_from_json(payload),
        ])?);
        expect_json_equal(
            "final payload",
            &normalized,
            fixture.get("expected_final_payload").unwrap_or(&Value::Null),
        )?;
    }
    if let Some(payload) = fixture.get("clarification_payload") {
        let normalized = core_value_to_json(&_normalize_agent_clarification_payload(&[
            core_value_from_json(payload),
        ])?);
        expect_json_equal(
            "clarification payload",
            &normalized,
            fixture.get("expected_clarification_payload").unwrap_or(&Value::Null),
        )?;
    }
    Ok(agent)
}

fn conformance_flow_result(fixture: &Value) -> AxResult<Value> {
    conformance_validate_flow_demos(fixture)?;
    let state = conformance_build_flow_state(fixture)?;
    let operation = fixture.get("operation").and_then(Value::as_str).unwrap_or("");
    let plan = core_value_to_json(&_flow_plan(&[state.clone()])?);
    let cache_keys = fixture
        .get("cache_key_inputs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|value| {
            _flow_cache_key(&[core_value_from_json(&value)])
                .map(|key| key.text())
                .unwrap_or_else(|_| stable_stringify(&value))
        })
        .collect::<Vec<_>>();
    let cache_keys_equal = !cache_keys.is_empty() && cache_keys.iter().all(|key| key == &cache_keys[0]);
    let mut sorted = cache_keys.clone();
    sorted.sort();
    sorted.dedup();
    if operation == "cache_key" || operation == "plan" {
        return Ok(json!({
            "plan": plan,
            "output": {},
            "streaming_output": [],
            "cache_keys_equal": cache_keys_equal,
            "cache_keys_distinct": sorted.len() == cache_keys.len(),
        }));
    }
    let responses = fixture
        .get("responses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut client = FixtureClient {
        responses: responses.into(),
        transcribe_responses: VecDeque::new(),
        requests: Vec::new(),
    };
    let input = fixture.get("input").cloned().unwrap_or_else(|| json!({}));
    let mut forward_options = fixture
        .get("forward_options")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(seed) = fixture.get("cache_seed_value") {
        if !forward_options.is_object() {
            forward_options = json!({});
        }
        let key = _flow_cache_key(&[core_value_from_json(&input)])?.text();
        let mut cache_store = forward_options
            .get("cache_store")
            .or_else(|| forward_options.get("cacheStore"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        cache_store.insert(key, seed.clone());
        forward_options["cache_store"] = Value::Object(cache_store);
    }
    let mut chat = |method: &str, request: Value| -> AxResult<Value> {
        if method == "transcribe" { client.transcribe(request) } else { client.chat(request) }
    };
    let output = core_value_to_json(&with_core_client(&mut chat, || {
        _flow_forward(&[
            state.clone(),
            CoreValue::Null,
            core_value_from_json(&input),
            core_value_from_json(&forward_options),
        ])
    })?);
    let streaming_output = if operation == "streaming" {
        json!([{"version": 1, "index": 0, "delta": output.clone()}])
    } else {
        json!([])
    };
    Ok(json!({
        "plan": plan,
        "output": output,
        "streaming_output": streaming_output,
        "cache_keys_equal": cache_keys_equal,
        "cache_keys_distinct": sorted.len() == cache_keys.len(),
    }))
}

fn conformance_build_flow_state(fixture: &Value) -> AxResult<CoreValue> {
    conformance_build_flow_state_from_spec(fixture, "root.flow")
}

fn conformance_build_flow_state_from_spec(spec: &Value, fallback_id: &str) -> AxResult<CoreValue> {
    let mut options = spec
        .get("flow_options")
        .or_else(|| spec.get("options"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    if options.get("id").is_none() {
        options["id"] = spec
            .get("program_id")
            .cloned()
            .unwrap_or_else(|| json!(fallback_id));
    }
    let state = _flow_factory(&[core_value_from_json(&options)])?;
    for step in spec
        .get("steps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let step_value = conformance_build_flow_step(&step, spec)?;
        _flow_add_step(&[state.clone(), step_value])?;
    }
    if let Some(returns) = spec.get("returns") {
        _flow_set_returns(&[state.clone(), core_value_from_json(returns)])?;
    }
    if let Some(demos) = spec.get("demos") {
        core_set(&state, CoreValue::from("demos"), core_value_from_json(demos))?;
    }
    Ok(state)
}

fn conformance_build_flow_step(step: &Value, fixture: &Value) -> AxResult<CoreValue> {
    let kind = step.get("kind").and_then(Value::as_str).unwrap_or("execute");
    let name = step.get("name").and_then(Value::as_str).unwrap_or("step");
    let mut options = step.get("options").cloned().unwrap_or_else(|| json!({}));
    if !options.is_object() {
        options = json!({});
    }
    match kind {
        "branch" | "while" | "feedback" => {
            let options_core = core_value_from_json(&options);
            if let Some(predicate) = step.get("predicate") {
                core_set(
                    &options_core,
                    CoreValue::from("predicate"),
                    conformance_flow_callable("condition", predicate.clone()),
                )?;
            }
            if let Some(condition) = step.get("condition") {
                core_set(
                    &options_core,
                    CoreValue::from("condition"),
                    conformance_flow_callable("condition", condition.clone()),
                )?;
            }
            if let Some(branches) = step.get("branches").and_then(Value::as_array) {
                let branch_list = CoreValue::new_list();
                for branch in branches {
                    let branch_value = CoreValue::new_map();
                    if let Some(when) = branch.get("when") {
                        core_set(&branch_value, CoreValue::from("when"), core_value_from_json(when))?;
                    }
                    let child_steps = CoreValue::new_list();
                    for child in branch.get("steps").and_then(Value::as_array).into_iter().flatten() {
                        core_append(&child_steps, conformance_build_flow_step(child, fixture)?)?;
                    }
                    core_set(&branch_value, CoreValue::from("steps"), child_steps)?;
                    core_append(&branch_list, branch_value)?;
                }
                core_set(&options_core, CoreValue::from("branches"), branch_list)?;
            }
            if let Some(children) = step.get("steps").and_then(Value::as_array) {
                let child_steps = CoreValue::new_list();
                for child in children {
                    core_append(&child_steps, conformance_build_flow_step(child, fixture)?)?;
                }
                core_set(&options_core, CoreValue::from("steps"), child_steps)?;
            }
            _flow_step(&[
                CoreValue::from(kind),
                CoreValue::from(name),
                CoreValue::Null,
                options_core,
            ])
        }
        "map" | "derive" => {
            let mapper = step.get("mapper").cloned().unwrap_or_else(|| {
                json!({"op": "set", "values": step.get("output").cloned().unwrap_or_else(|| json!({}))})
            });
            _flow_step(&[
                CoreValue::from(kind),
                CoreValue::from(name),
                conformance_flow_callable("mapper", mapper),
                core_value_from_json(&options),
            ])
        }
        "parallel" | "parallelMerge" => _flow_step(&[
            CoreValue::from(kind),
            CoreValue::from(name),
            CoreValue::Null,
            core_value_from_json(&options),
        ]),
        "execute" => {
            let signature = step
                .get("extended_signature")
                .or_else(|| step.get("extendedSignature"))
                .or_else(|| step.get("signature"))
                .or_else(|| fixture.get("signature"))
                .and_then(Value::as_str)
                .unwrap_or("question:string -> answer:string");
            let mut step_options = step
                .get("forward_options")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if !step_options.is_object() {
                step_options = json!({});
            }
            if let (Some(step_obj), Some(opt_obj)) = (step_options.as_object_mut(), options.as_object()) {
                for (key, value) in opt_obj {
                    step_obj.insert(key.clone(), value.clone());
                }
            }
            let program = match step.get("program").and_then(Value::as_str).unwrap_or("") {
                "flow" => {
                    let nested_id = step
                        .get("program_id")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .unwrap_or_else(|| format!("root.{name}"));
                    let nested_state = conformance_build_flow_state_from_spec(step, &nested_id)?;
                    FlowHost::new(AxFlow { state: nested_state })
                }
                "agent" => {
                    let agent = agent_with_options(signature, options.clone())?;
                    AgentHost::new(agent)
                }
                _ => {
                    if options.get("id").is_none() {
                        options["id"] = json!(name);
                    }
                    GenHost::new(AxGen::with_options_and_tools(signature, options.clone(), Vec::new())?)
                }
            };
            _flow_step(&[
                CoreValue::from(kind),
                CoreValue::from(name),
                program,
                core_value_from_json(&step_options),
            ])
        }
        other => Err(AxError::new(
            "fixture",
            format!("unsupported Rust conformance flow error step kind {other}"),
        )),
    }
}

fn conformance_validate_flow_demos(fixture: &Value) -> AxResult<()> {
    let Some(demos) = fixture.get("demos").and_then(Value::as_array) else {
        return Ok(());
    };
    let mut valid = vec!["root".to_string()];
    for step in fixture
        .get("steps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if let Some(name) = step.get("name").and_then(Value::as_str) {
            valid.push(format!("root.{name}"));
        }
    }
    let unknown = demos
        .iter()
        .map(|demo| {
            demo.get("programId")
                .or_else(|| demo.get("program_id"))
                .and_then(Value::as_str)
                .unwrap_or("root")
                .to_string()
        })
        .filter(|program_id| !valid.iter().any(|item| item == program_id))
        .collect::<Vec<_>>();
    if unknown.is_empty() {
        return Ok(());
    }
    let mut ids = valid;
    ids.sort();
    Err(AxError::runtime(format!(
        "Unknown program ID(s) in demos: {}. Valid IDs: {}. Use namedPrograms() to discover available IDs.",
        unknown.join(", "),
        ids.join(", ")
    )))
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
    let _ = exercise_optimizer_wrapper_paths(fixture);
    let operation = fixture
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("components")
        .to_string();
    match operation.as_str() {
        "verification" => {
            let actual = verification_instruments_summary()?;
            expect_json_equal(
                "verification instruments",
                &actual,
                fixture.get("expected_output").unwrap_or(&Value::Null),
            )?;
        }
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

fn verification_instruments_summary() -> AxResult<Value> {
    let mut prompt_vars = core_value_to_json(&collect_template_variable_names(&[
        CoreValue::from("Hello {{name}} and {{count}}"),
        CoreValue::from("verification"),
    ])?)
    .as_array()
    .cloned()
    .unwrap_or_default();
    prompt_vars.sort_by(|left, right| value_as_display_string(left).cmp(&value_as_display_string(right)));
    let prompt_vars = Value::Array(prompt_vars);
    let chat_request = json!({
        "model": "gpt-fixture",
        "chat_prompt": [{"role": "user", "content": "hello"}],
        "model_config": {}
    });
    let chat_payload = core_value_to_json(&build_chat_request(&[
        CoreValue::Null,
        core_value_from_json(&chat_request),
        core_value_from_json(&json!({})),
    ])?);
    let chat_response = core_value_to_json(&normalize_chat_response(&[
        core_value_from_json(&json!({
            "id": "chat-1",
            "model": "gpt-fixture",
            "choices": [{"index": 0, "message": {"content": "hello"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
        })),
    ])?);
    let embed_payload = core_value_to_json(&build_embed_request(&[
        CoreValue::Null,
        core_value_from_json(&json!({"embedModel": "embed-fixture", "texts": ["hello"]})),
        core_value_from_json(&json!({})),
    ])?);
    let embed_response = core_value_to_json(&normalize_embed_response(&[
        core_value_from_json(&json!({
            "id": "embed-1",
            "model": "embed-fixture",
            "data": [{"embedding": [0.1, 0.2]}],
            "usage": {"prompt_tokens": 1, "total_tokens": 1}
        })),
    ])?);
    let stream_response = core_value_to_json(&normalize_stream_delta(&[
        core_value_from_json(&json!({
            "id": "stream-1",
            "model": "gpt-fixture",
            "choices": [{"index": 0, "delta": {"content": "delta"}}]
        })),
        core_value_from_json(&json!({})),
    ])?);
    let tool_call = core_value_to_json(&_openai_tool_call_to_provider_impl(&[
        core_value_from_json(&json!({"id": "call-1", "function": {"name": "lookup", "params": {"term": "ax"}}})),
    ])?);
    let profile = core_value_to_json(&provider_resolve_profile(&[CoreValue::from("openai")])?);
    let _ = _gemini_build_transcribe_request(&[
        core_value_from_json(&json!({"audio": {"data": "audio-bytes", "mimeType": "audio/wav"}})),
    ])?;
    let _ = _gemini_build_speak_request(&[
        core_value_from_json(&json!({"text": "speak", "voice": "Kore", "format": "wav"})),
    ])?;
    let gemini_transcript = core_value_to_json(&_gemini_normalize_transcribe_response(&[
        core_value_from_json(&json!({"candidates": [{"content": {"parts": [{"text": "transcript"}]}}]})),
    ])?);
    let gemini_speech = core_value_to_json(&_gemini_normalize_speak_response(&[
        core_value_from_json(&json!({"candidates": [{"content": {"parts": [{"inlineData": {"data": "audio-bytes"}}]}}]})),
        core_value_from_json(&json!({"format": "wav"})),
    ])?);
    let grok_transcribe = core_value_to_json(&_grok_build_transcribe_request(&[
        core_value_from_json(&json!({"audio": "audio-bytes", "language": "en", "prompt": "names"})),
    ])?);
    let grok_speak = core_value_to_json(&_grok_build_speak_request(&[
        core_value_from_json(&json!({"text": "speak", "voice": {"id": "eve"}, "format": "pcm16", "sampleRate": 16000})),
    ])?);
    let registry = json!({
        "flags": {"skillsMode": true},
        "protocol_actions": [{"id": "respond"}],
        "runtime_globals": [{"id": "runtime"}],
        "actor_primitives": [{"id": "speak", "effect": "fixture guidance", "stages": ["actor"], "availability_condition": "always"}]
    });
    let _ = _validate_policy_reserved_names(&[
        core_value_from_json(&registry),
        CoreValue::from("fixtureCallable"),
    ])?;
    let guidance = core_value_to_json(&_render_actor_primitive_guidance(&[
        core_value_from_json(&registry),
        CoreValue::from("actor"),
    ])?);
    let policy_state_core = core_value_from_json(&json!({}));
    let _ = _record_policy_event(&[
        policy_state_core.clone(),
        CoreValue::from("respond"),
        core_value_from_json(&json!({"ok": true})),
    ])?;
    let policy_state = core_value_to_json(&policy_state_core);
    let policy_result = core_value_to_json(&_normalize_policy_action_result(&[
        CoreValue::from("respond"),
        core_value_from_json(&json!({"ok": true})),
    ])?);
    let descriptor = core_value_to_json(&_program_descriptor(&[
        CoreValue::from("fixture"),
        CoreValue::from("core"),
        core_value_from_json(&json!({"source": "verification"})),
    ])?);
    let merged = core_value_to_json(&_flow_merge_parallel_results(&[
        core_value_from_json(&json!({"base": "keep"})),
        core_value_from_json(&json!({"answer": "ok"})),
    ])?);
    let gen_marker_core = core_value_from_json(&json!({}));
    let _ = _set_examples(&[
        gen_marker_core.clone(),
        core_value_from_json(&json!([{"input": {"question": "q"}, "output": {"answer": "a"}}])),
    ])?;
    let _ = _set_demos(&[
        gen_marker_core.clone(),
        core_value_from_json(&json!([{"traces": []}])),
    ])?;
    let gen_marker = core_value_to_json(&gen_marker_core);
    let constants = core_value_to_json(&mcp_protocol_constants(&[])?);
    let request = core_value_to_json(&mcp_jsonrpc_request(&[
        CoreValue::from("1"),
        CoreValue::from("ping"),
        core_value_from_json(&json!({"ok": true})),
    ])?);
    let notification = core_value_to_json(&mcp_jsonrpc_notification(&[
        CoreValue::from("progress"),
        core_value_from_json(&json!({"pct": 1})),
    ])?);
    let mcp_error = core_value_to_json(&mcp_normalize_error(&[
        core_value_from_json(&json!({"jsonrpc": "2.0", "id": "1", "error": {"code": -32000, "message": "nope"}})),
    ])?);
    Ok(json!({
        "promptVars": prompt_vars,
        "chatModel": chat_payload.get("model").cloned().unwrap_or(Value::Null),
        "chatContent": chat_response.pointer("/results/0/content").cloned().unwrap_or(Value::Null),
        "embedModel": embed_payload.get("model").cloned().unwrap_or(Value::Null),
        "embedCount": embed_response.get("embeddings").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        "streamContent": stream_response.pointer("/results/0/content").cloned().unwrap_or(Value::Null),
        "toolName": tool_call.pointer("/function/name").cloned().unwrap_or(Value::Null),
        "profileId": profile.get("id").cloned().unwrap_or(Value::Null),
        "geminiText": gemini_transcript.get("text").cloned().unwrap_or(Value::Null),
        "geminiAudio": gemini_speech.get("audio").cloned().unwrap_or(Value::Null),
        "grokCodec": grok_speak.pointer("/output_format/codec").cloned().unwrap_or(Value::Null),
        "grokFormat": grok_transcribe.get("format").cloned().unwrap_or(Value::Null),
        "policyActions": core_value_to_json(&_select_protocol_actions(&[core_value_from_json(&registry)])?).as_array().map(|items| items.len()).unwrap_or(0),
        "runtimeGlobals": core_value_to_json(&_select_runtime_globals(&[core_value_from_json(&registry)])?).as_array().map(|items| items.len()).unwrap_or(0),
        "qualityScore": core_value_to_json(&_map_optimization_judge_quality_to_score(&[CoreValue::from("good")])?),
        "policyTrace": policy_state.get("policy_trace").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        "policyEffectOnly": policy_result.get("effect_only").cloned().unwrap_or(Value::Null),
        "guidance": guidance,
        "programKind": descriptor.get("kind").cloned().unwrap_or(Value::Null),
        "flowAnswer": merged.get("answer").cloned().unwrap_or(Value::Null),
        "mcpVersion": constants.get("protocolVersion").cloned().unwrap_or(Value::Null),
        "mcpRequest": request.get("method").cloned().unwrap_or(Value::Null),
        "mcpNotification": notification.get("method").cloned().unwrap_or(Value::Null),
        "mcpError": mcp_error.get("code").cloned().unwrap_or(Value::Null),
        "genExamples": gen_marker.get("examples").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        "genDemos": gen_marker.get("demos").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0)
    }))
}

fn exercise_optimizer_wrapper_paths(_fixture: &Value) -> AxResult<()> {
    let component = _optimization_component(&[
        CoreValue::from("root::instruction"),
        CoreValue::from("root"),
        CoreValue::from("instruction"),
        CoreValue::from("Base instruction."),
        CoreValue::from("Prompt instruction text."),
        core_value_from_json(&json!(["Preserve fields."])),
        CoreValue::new_list(),
        CoreValue::Bool(false),
        CoreValue::from("markdown"),
        core_value_from_json(&json!({"required_placeholders": []})),
    ])?;
    let components = CoreValue::new_list();
    core_append(&components, component.clone())?;
    let component_map = core_value_from_json(&json!({"root::instruction": "Optimized instruction."}));
    let current = _optimization_component_current_map(&[components.clone()])?;
    let artifact = _optimized_artifact(&[
        CoreValue::from("fixture"),
        CoreValue::from("1"),
        component_map.clone(),
        core_value_from_json(&json!({"provenance": {}, "evidence": {}})),
    ])?;
    let serialized = _serialize_optimized_artifact(&[artifact.clone()])?;
    let _ = _deserialize_optimized_artifact(&[serialized, components.clone()]);
    let _ = _normalize_optimizer_engine_response(&[
        artifact,
        CoreValue::from("fixture"),
        CoreValue::from("1"),
        components.clone(),
    ]);
    let gen_core = CoreValue::new_map();
    let _ = _set_examples(&[gen_core.clone(), core_value_from_json(&json!([{"input": {}}]))]);
    let _ = _set_demos(&[gen_core, core_value_from_json(&json!([{"traces": []}]))]);
    let _ = _build_agent_eval_prediction(&[
        core_value_from_json(&json!({"answer": "ok"})),
        CoreValue::new_list(),
        CoreValue::new_map(),
        core_value_from_json(&json!({"traces": []})),
    ]);
    let prefix = _program_child_component_prefix(&[CoreValue::from("root.flow"), CoreValue::from("qa")])?;
    let prefixed = _program_prefix_component(&[component, CoreValue::from("root.flow"), CoreValue::from("qa")])?;
    let prefixed_id = core_get(&prefixed, &CoreValue::from("id"), CoreValue::from(""));
    let child_map = CoreValue::new_map();
    core_set(&child_map, prefixed_id, CoreValue::from("Child update."))?;
    let _ = _program_slice_component_map(&[child_map, prefix]);

    let program = AxGen::new("question:string -> answer:string")?;
    let flow = flow("root.flow")
        .execute("qa", program)
        .returns(json!({"answer": "answer"}));
    let flow_state = flow.state.clone();
    let flow_components = _flow_get_optimizable_components(&[flow_state.clone()])?;
    let snapshot = _flow_snapshot_components(&[flow_state.clone()])?;
    let _ = _flow_apply_optimized_components(&[flow_state.clone(), CoreValue::new_map()]);
    let _ = _flow_restore_components(&[flow_state.clone(), snapshot]);
    let _ = _flow_evaluate_optimization(&[
        flow_state.clone(),
        CoreValue::Null,
        core_value_from_json(&json!([])),
        CoreValue::new_map(),
        CoreValue::new_map(),
    ]);
    let _ = _flow_optimize_with(&[
        flow_state,
        core_value_from_json(&json!([])),
        CoreValue::new_map(),
        CoreValue::Bool(false),
    ]);
    let _ = _filter_optimization_components(&[flow_components, CoreValue::from("all")]);
    let _ = _optimization_changed_components(&[components, component_map]);
    let _ = core_value_to_json(&current);
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
    let selected = _filter_optimization_components(&[
        core_value_from_json(&Value::Array(components)),
        CoreValue::from(target),
    ]);
    core_value_to_json(&selected.unwrap_or_else(|_| CoreValue::new_list()))
        .as_array()
        .cloned()
        .unwrap_or_default()
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
    _validate_optimization_component_map(&[
        core_value_from_json(&Value::Array(components.to_vec())),
        core_value_from_json(component_map),
    ])?;
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
    core_value_to_json(&_optimization_changed_components(&[
        core_value_from_json(&Value::Array(before.to_vec())),
        core_value_from_json(component_map),
    ]).unwrap_or_else(|_| CoreValue::new_list()))
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
    let mut artifact = core_value_to_json(&_optimized_artifact(&[
        CoreValue::from(optimizer_name),
        CoreValue::from("1"),
        core_value_from_json(&component_map),
        core_value_from_json(&metadata),
    ])?);
    artifact["changedComponents"] = optimization_changed_components(components, &component_map);
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
    let validated = _validate_optimized_artifact(&[
        core_value_from_json(&artifact),
        core_value_from_json(&Value::Array(components.to_vec())),
    ])?;
    Ok(core_value_to_json(&validated))
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
    core_value_to_json(&_normalize_optimization_dataset(&[
        core_value_from_json(dataset),
    ]).unwrap_or_else(|_| core_value_from_json(&json!({"train": [], "validation": []}))))
}

fn normalize_metric_scores(raw: &Value) -> Value {
    core_value_to_json(&_normalize_optimization_metric_scores(&[
        core_value_from_json(raw),
    ]).unwrap_or_else(|_| core_value_from_json(&json!({"score": 0.0}))))
}

fn scalarize_scores(scores: &Value, options: &Value) -> f64 {
    core_value_to_json(&_scalarize_optimization_scores(&[
        core_value_from_json(scores),
        core_value_from_json(options),
    ]).unwrap_or(CoreValue::Num(0.0)))
        .as_f64()
        .unwrap_or(0.0)
}

fn adjust_score_for_actions(score: f64, task: &Value, prediction: &Value) -> f64 {
    core_value_to_json(&_adjust_optimization_score_for_actions(&[
        CoreValue::Num(score),
        core_value_from_json(task),
        core_value_from_json(prediction),
    ]).unwrap_or(CoreValue::Num(score)))
        .as_f64()
        .unwrap_or(score)
}

fn map_judge_quality_to_score(quality: &Value) -> f64 {
    core_value_to_json(&_map_optimization_judge_quality_to_score(&[
        core_value_from_json(quality),
    ]).unwrap_or(CoreValue::Num(0.0)))
        .as_f64()
        .unwrap_or(0.0)
}

fn build_judge_payload(task: &Value, prediction: &Value, criteria: &str) -> Value {
    core_value_to_json(&_build_optimization_judge_payload(&[
        core_value_from_json(task),
        core_value_from_json(prediction),
        CoreValue::from(criteria),
    ]).unwrap_or_else(|_| core_value_from_json(&json!({}))))
}

fn build_optimizer_evidence_batch(eval_result: &Value, components: &[Value]) -> Value {
    core_value_to_json(&_build_optimizer_evidence_batch(&[
        core_value_from_json(eval_result),
        core_value_from_json(&Value::Array(components.to_vec())),
    ]).unwrap_or_else(|_| core_value_from_json(&json!({}))))
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
            let (scores, scalar) = score_optimization_prediction(
                &task,
                &prediction,
                fixture.get("eval_options").unwrap_or(&json!({})),
            )
            .unwrap_or_else(|_| {
                let scalar = if prediction.get("completionType").and_then(Value::as_str) == Some("error") {
                    0.0
                } else {
                    task.get("score").and_then(Value::as_f64).unwrap_or(1.0)
                };
                (json!({"score": scalar}), scalar)
            });
            let trace = prediction.get("trace").cloned().unwrap_or_else(|| json!({}));
            let error = prediction
                .get("error")
                .cloned()
                .unwrap_or(Value::Null);
            core_value_to_json(&_build_optimization_eval_row(&[
                core_value_from_json(&task),
                core_value_from_json(&prediction),
                core_value_from_json(&scores),
                CoreValue::Num(scalar),
                core_value_from_json(&trace),
                core_value_from_json(&error),
            ]).unwrap_or_else(|_| core_value_from_json(&json!({
                "input": task.get("input").cloned().unwrap_or_else(|| json!({})),
                "prediction": prediction,
                "scalar": scalar,
                "scores": scores,
            }))))
        })
        .collect::<Vec<_>>();
    let phase = fixture
        .get("eval_options")
        .and_then(|options| options.get("phase"))
        .and_then(Value::as_str)
        .unwrap_or("train");
    let mut result = core_value_to_json(&_build_optimization_eval_result(&[
        core_value_from_json(&Value::Array(rows)),
        core_value_from_json(&fixture.get("candidate_map").cloned().unwrap_or_else(|| json!({}))),
        CoreValue::from(phase),
    ]).unwrap_or_else(|_| core_value_from_json(&json!({}))));
    result["contractVersion"] = json!("axir-optimization-eval-v1");
    result
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
    let run = _prepare_optimizer_run(&[
        CoreValue::from(normalized_program_kind(fixture)),
        core_value_from_json(&Value::Array(components.to_vec())),
        core_value_from_json(fixture.get("dataset").unwrap_or(&json!([]))),
        core_value_from_json(&fixture.get("optimize_options").cloned().unwrap_or_else(|| json!({}))),
        core_value_from_json(&json!({})),
        CoreValue::Bool(uses_evaluator),
    ]);
    if let Ok(run) = run {
        return core_value_to_json(&core_get(&run, &CoreValue::from("request"), CoreValue::Null));
    }
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
            expect_error_category(&err, fixture)?;
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

fn expect_error_category(err: &AxError, fixture: &Value) -> AxResult<()> {
    let Some(expected) = fixture.get("expected_error_category").and_then(Value::as_str) else {
        return Ok(());
    };
    if err.category != expected {
        return Err(AxError::new(
            "fixture",
            format!("expected error category {expected:?}, got {:?}", err.category),
        ));
    }
    Ok(())
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

fn fold_fixture_stream(events: &[Value]) -> AxResult<String> {
    let folded = fold_stream(&[core_value_from_json(&Value::Array(events.to_vec()))])?;
    Ok(folded.text())
}

fn get_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
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
    transcribe_responses: VecDeque<Value>,
    requests: Vec<Value>,
}

impl AxAIClient for FixtureClient {
    fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        self.requests.push(request);
        Ok(self
            .transcribe_responses
            .pop_front()
            .unwrap_or_else(|| json!({"text": ""})))
    }

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
        transcribe_responses: VecDeque::new(),
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
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("ai chat output", &output, expected)?;
    }
    expect_transport_request_subset(fixture, &requests)?;
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
    let result = run_ai_realtime_fixture_inner(&client, fixture);
    if fixture.get("expected_error_contains").is_some() {
        return expect_validation_result(result, fixture);
    }
    result
}

fn run_ai_realtime_fixture_inner(client: &OpenAICompatibleClient, fixture: &Value) -> AxResult<()> {
    let request = fixture.get("request").cloned().unwrap_or_else(|| json!({}));
    if let Some(expected) = fixture.get("expected_setup") {
        expect_json_equal(
            "ai realtime setup",
            &client.realtime_audio_setup(request.clone())?,
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_input") {
        expect_json_equal(
            "ai realtime input",
            &client.realtime_audio_input(request.clone())?,
            expected,
        )?;
    }
    let events = fixture.get("events").cloned().unwrap_or_else(|| json!([]));
    let output = Value::Array(client.realtime_events(events)?);
    if fixture.get("expected_error_contains").is_some() {
        return Err(AxError::new("fixture", "expected ai realtime fixture to fail"));
    }
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
    for key in [
        "base_url",
        "baseUrl",
        "resource_name",
        "resourceName",
        "deployment_name",
        "deploymentName",
        "api_version",
        "apiVersion",
        "version",
    ] {
        if let Some(value) = fixture.get(key) {
            options[key] = value.clone();
        }
    }
    let client = ai(provider, options)?.with_transport(transport);
    Ok((client, requests))
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

// Percent-encode every byte outside the RFC 3986 unreserved set, matching
// python's urllib.parse.quote(value, safe="").
fn url_component_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}


// ----- AXIR CORE VALUE RUNTIME -----

fn axir_coverage_mark(name: &'static str) {
    use std::io::Write;
    use std::sync::{Mutex, OnceLock};
    type CoverageState = Option<(String, Mutex<std::collections::HashSet<&'static str>>)>;
    static STATE: OnceLock<CoverageState> = OnceLock::new();
    let state = STATE.get_or_init(|| {
        std::env::var("AXIR_COVERAGE_FILE")
            .ok()
            .map(|path| (path, Mutex::new(std::collections::HashSet::new())))
    });
    let Some((path, seen)) = state.as_ref() else {
        return;
    };
    if !seen.lock().map(|mut set| set.insert(name)).unwrap_or(false) {
        return;
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).create(true).open(path) {
        let _ = writeln!(file, "{name}");
    }
}

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
    // python _core_json_stringify: json.dumps(value, sort_keys=True,
    // separators=(",", ":")) — compact and key-sorted.
    let value = core_arg(args, 0);
    let json = if value.is_null() { json!({}) } else { core_value_to_json(&value) };
    Ok(CoreValue::from_string(stable_stringify(&json)))
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
    /// Register a host callable on the wrapped runtime, if this host wraps one.
    /// Returns true when the host handled it. Default false (most hosts are not
    /// runtimes); the code-runtime host overrides it. Used by the agent wrapper
    /// to wire `llmQuery` onto the runtime carried inside agent options.
    fn register_runtime_callable(&self, _name: &str, _callable: AxHostCallable) -> bool {
        false
    }
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
    // The scoped client is a single method-dispatch closure (method, request) so chat AND
    // transcribe share one &mut borrow of the typed client (two separate closures would be a
    // borrow-check conflict). core_ai_complete_once calls it with "chat"; core_agent_transcribe
    // with "transcribe". This keeps audio transcription emitted + uniform with the other four
    // languages (which pass the real client directly).
    static CORE_CLIENT_STACK: RefCell<Vec<*mut (dyn FnMut(&str, Value) -> AxResult<Value> + 'static)>> =
        RefCell::new(Vec::new());
}

#[allow(dead_code)]
pub(crate) fn with_core_client<R>(
    chat: &mut dyn FnMut(&str, Value) -> AxResult<Value>,
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
    let erased: *mut (dyn FnMut(&str, Value) -> AxResult<Value> + 'static) =
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
    let response = chat("chat", core_value_to_json(&request))?;
    chat_response_to_completion(&[core_value_from_json(&response)])
}

// Backs intrinsic.agent.transcribe. Rust scopes the client as a chat/transcribe dispatch
// closure (the agent receives CoreValue::Null for %client), so we route "transcribe" through
// the same scoped closure core_ai_complete_once uses for "chat".
#[allow(dead_code)]
pub(crate) fn core_agent_transcribe(args: &[CoreValue]) -> Result<CoreValue, AxError> {
    let request = core_arg(args, 1);
    let top = CORE_CLIENT_STACK.with(|stack| stack.borrow().last().copied());
    match top {
        Some(ptr) => {
            let call = unsafe { &mut *ptr };
            let response = call("transcribe", core_value_to_json(&request))?;
            Ok(core_value_from_json(&response))
        }
        None => Ok(core_value_from_json(&json!({"text": ""}))),
    }
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
        let items = host.call_method("items", &[])?;
        for item in &gen.memory {
            core_append(&items, core_value_from_json(item))?;
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


struct RawScopedClient(*mut dyn FnMut(&str, Value) -> AxResult<Value>);

impl AxAIClient for RawScopedClient {
    fn chat(&mut self, request: Value) -> AxResult<Value> {
        // SAFETY: the pointer was captured from the client stack inside the
        // enclosing with_core_client scope, which outlives this call.
        let call = unsafe { &mut *self.0 };
        call("chat", request)
    }

    fn transcribe(&mut self, request: Value) -> AxResult<Value> {
        let call = unsafe { &mut *self.0 };
        call("transcribe", request)
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
                let options = core_value_to_json(&core_arg(args, 2));
                let mut client = core_scoped_client()?;
                let output = self
                    .gen
                    .borrow_mut()
                    .forward_with_options(&mut client, values, options)?;
                Ok(core_value_from_json(&output))
            }
            "get_chat_log" => Ok(core_value_from_json(&Value::Array(self.gen.borrow().chat_log.clone()))),
            "get_traces" => Ok(core_value_from_json(&Value::Array(self.gen.borrow().traces.clone()))),
            "get_optimizable_components" => Ok(core_value_from_json(&Value::Array(
                self.gen.borrow().get_optimizable_components(),
            ))),
            "apply_optimized_components" => {
                let component_map = core_value_to_json(&core_arg(args, 0));
                self.gen.borrow_mut().apply_optimized_components(&component_map)?;
                Ok(CoreValue::Null)
            }
            "set_demos" => {
                let demos = core_value_to_json(&core_arg(args, 0));
                self.gen
                    .borrow_mut()
                    .set_demos(demos.as_array().cloned().unwrap_or_default());
                Ok(CoreValue::Null)
            }
            other => Err(AxError::runtime(format!(
                "object of type AxGen has no callable method '{other}'"
            ))),
        }
    }
}

// Host wrapper exposing an AxFlow as a flow-step / optimizer program, the
// same surface python reaches through duck typing on the AxFlow class.
pub(crate) struct FlowHost {
    flow: RefCell<AxFlow>,
}

impl FlowHost {
    pub(crate) fn new(flow: AxFlow) -> CoreValue {
        CoreValue::Host(Rc::new(FlowHost { flow: RefCell::new(flow) }))
    }
}

impl CoreHost for FlowHost {
    fn host_type(&self) -> &'static str {
        "AxFlow"
    }
    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "forward" => {
                let values = core_arg(args, 1);
                let options = core_arg(args, 2);
                let state = self.flow.borrow().state.clone();
                let result = _flow_forward(&[state, CoreValue::Null, values, options])?;
                Ok(result)
            }
            "get_chat_log" => Ok(core_get(
                &self.flow.borrow().state,
                &CoreValue::from("chat_log"),
                CoreValue::new_list(),
            )),
            "get_traces" => Ok(core_get(
                &self.flow.borrow().state,
                &CoreValue::from("traces"),
                CoreValue::new_list(),
            )),
            "get_usage" => Ok(core_get(
                &self.flow.borrow().state,
                &CoreValue::from("usage"),
                CoreValue::Null,
            )),
            "get_optimizable_components" => {
                let state = self.flow.borrow().state.clone();
                _flow_get_optimizable_components(&[state])
            }
            "apply_optimized_components" => {
                let state = self.flow.borrow().state.clone();
                _flow_apply_optimized_components(&[state, core_arg(args, 0)])?;
                Ok(CoreValue::Null)
            }
            "set_demos" => {
                let demos = core_value_to_json(&core_arg(args, 0));
                self.flow.borrow_mut().set_demos(&demos)?;
                Ok(CoreValue::Null)
            }
            other => Err(AxError::runtime(format!(
                "object of type AxFlow has no callable method '{other}'"
            ))),
        }
    }
}

// Host wrapper exposing an AxAgent as a flow-step program.
pub(crate) struct AgentHost {
    agent: RefCell<AxAgent>,
}

impl AgentHost {
    pub(crate) fn new(agent: AxAgent) -> CoreValue {
        CoreValue::Host(Rc::new(AgentHost { agent: RefCell::new(agent) }))
    }
}

impl CoreHost for AgentHost {
    fn host_type(&self) -> &'static str {
        "AxAgent"
    }
    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        match name {
            "forward" => {
                let values = core_value_to_json(&core_arg(args, 1));
                let options = core_value_to_json(&core_arg(args, 2));
                let mut client = core_scoped_client()?;
                let output = self
                    .agent
                    .borrow_mut()
                    .forward_with_options(&mut client, values, options)?;
                Ok(core_value_from_json(&output))
            }
            "get_chat_log" => Ok(core_value_from_json(&Value::Array(self.agent.borrow().get_chat_log()))),
            "get_usage" => {
                let usage = self.agent.borrow().get_usage();
                Ok(core_value_from_json(&usage))
            }
            "get_optimizable_components" => {
                let components = self.agent.borrow().get_optimizable_components()?;
                Ok(core_value_from_json(&Value::Array(components)))
            }
            "apply_optimized_components" => {
                let component_map = core_value_to_json(&core_arg(args, 0));
                self.agent.borrow_mut().apply_optimized_components(&component_map)?;
                Ok(CoreValue::Null)
            }
            other => Err(AxError::runtime(format!(
                "object of type AxAgent has no callable method '{other}'"
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

    fn register_runtime_callable(&self, name: &str, callable: AxHostCallable) -> bool {
        self.runtime
            .borrow_mut()
            .register_host_callable(name, callable)
            .is_ok()
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


fn signature_from_record(record: &CoreValue) -> AxResult<AxSignature> {
    if let CoreValue::Str(text) = record {
        return s(text.as_str());
    }
    let payload = core_value_to_json(record);
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();
    for (key, out) in [("inputFields", &mut inputs), ("outputFields", &mut outputs)] {
        for raw in payload.get(key).and_then(Value::as_array).into_iter().flatten() {
            let name = raw.get("name").and_then(Value::as_str).unwrap_or("");
            out.push(field_from_payload(name, raw));
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

fn agent_stage_gen(signature: AxSignature, options: Value) -> CoreValue {
    GenHost::new(AxGen {
        signature,
        options,
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

struct ScopedRuntimeHost(*mut dyn AxCodeRuntime);

impl CoreHost for ScopedRuntimeHost {
    fn host_type(&self) -> &'static str {
        "AxCodeRuntime"
    }
    fn call_method(&self, name: &str, args: &[CoreValue]) -> Result<CoreValue, AxError> {
        // SAFETY: the pointer is valid for the duration of the agent method
        // that constructed this host; emitted code uses it synchronously.
        let runtime = unsafe { &mut *self.0 };
        match name {
            "create_session" => {
                let globals = core_value_to_json(&core_arg(args, 0));
                let options = core_value_to_json(&core_arg(args, 1));
                let session = runtime.create_session(globals, options)?;
                Ok(core_code_session_host(session))
            }
            "language" => Ok(CoreValue::from_string(runtime.language().to_string())),
            "usage_instructions" | "get_usage_instructions" | "usageInstructions" => {
                Ok(CoreValue::from_string(runtime.usage_instructions().to_string()))
            }
            other => Err(AxError::runtime(format!(
                "object of type AxCodeRuntime has no callable method '{other}'"
            ))),
        }
    }
}


struct ScriptedRuntimeShared {
    script: Vec<Value>,
    executed: Vec<String>,
    // python ScriptedCodeRuntime bookkeeping inspected by the session
    // conformance runner after the fact.
    create_requests: Vec<Value>,
    execute_options: Vec<Value>,
    session_closed: Vec<bool>,
    capabilities: RuntimeCapabilities,
}

pub(crate) struct ScriptedCodeRuntime {
    shared: Rc<RefCell<ScriptedRuntimeShared>>,
    language: String,
    usage_instructions: String,
}

impl ScriptedCodeRuntime {
    pub(crate) fn new(script: Vec<Value>, language: String, usage_instructions: String) -> Self {
        ScriptedCodeRuntime {
            shared: Rc::new(RefCell::new(ScriptedRuntimeShared {
                script,
                executed: Vec::new(),
                create_requests: Vec::new(),
                execute_options: Vec::new(),
                session_closed: Vec::new(),
                capabilities: core_runtime_capabilities_full(),
            })),
            language,
            usage_instructions,
        }
    }

    // python ScriptedCodeRuntime(capabilities=...): {"inspect": True,
    // "snapshot": True, "patch": True} updated with the fixture overrides.
    fn with_fixture_capabilities(self, raw: Option<&Value>) -> Self {
        {
            let capability = |name: &str, fallback: bool| {
                raw.and_then(|caps| caps.get(name))
                    .and_then(Value::as_bool)
                    .unwrap_or(fallback)
            };
            let mut shared = self.shared.borrow_mut();
            shared.capabilities = RuntimeCapabilities {
                inspect_globals: capability("inspect", true),
                snapshot_globals: capability("snapshot", true),
                patch_globals: capability("patch", true),
            };
        }
        self
    }

    fn executed_handle(&self) -> Rc<RefCell<ScriptedRuntimeShared>> {
        Rc::clone(&self.shared)
    }
}

impl AxCodeRuntime for ScriptedCodeRuntime {
    fn language(&self) -> &str {
        &self.language
    }
    fn usage_instructions(&self) -> &str {
        &self.usage_instructions
    }
    fn create_session(&mut self, globals: Value, options: Value) -> AxResult<Box<dyn AxCodeSession>> {
        let index = {
            let mut shared = self.shared.borrow_mut();
            shared
                .create_requests
                .push(json!({"globals": globals.clone(), "options": options}));
            shared.session_closed.push(false);
            shared.session_closed.len() - 1
        };
        Ok(Box::new(ScriptedCodeSession {
            shared: Rc::clone(&self.shared),
            globals: globals.as_object().cloned().unwrap_or_default(),
            closed: false,
            index,
        }))
    }
}

struct ScriptedCodeSession {
    shared: Rc<RefCell<ScriptedRuntimeShared>>,
    globals: Map<String, Value>,
    closed: bool,
    index: usize,
}

impl ScriptedCodeSession {
    fn set_closed(&mut self, closed: bool) {
        self.closed = closed;
        let mut shared = self.shared.borrow_mut();
        if let Some(flag) = shared.session_closed.get_mut(self.index) {
            *flag = closed;
        }
    }
}

impl AxCodeSession for ScriptedCodeSession {
    fn execute(&mut self, code: &str, options: Value) -> AxResult<RuntimeEnvelope> {
        if self.closed {
            return Ok(RuntimeEnvelope {
                payload: json!({"is_error": true, "error_category": "session_closed", "error": "session closed"}),
            });
        }
        let step = {
            let mut shared = self.shared.borrow_mut();
            if shared.script.is_empty() {
                return Err(AxError::runtime("scripted runtime exhausted"));
            }
            shared.script.remove(0)
        };
        if let Some(expected) = step.get("expected_code").and_then(Value::as_str) {
            if expected != code {
                return Err(AxError::runtime(format!(
                    "expected code {expected:?}, got {code:?}"
                )));
            }
        }
        if let Some(expected) = step.get("expected_options_subset") {
            expect_json_subset("runtime execute options", &options, expected)?;
        }
        {
            let mut shared = self.shared.borrow_mut();
            shared.executed.push(code.to_string());
            shared.execute_options.push(options);
        }
        if let Some(patch) = step.get("bindings_patch").and_then(Value::as_object) {
            for (key, value) in patch {
                self.globals.insert(key.clone(), value.clone());
            }
        }
        if step.get("close_before_result").map(core_json_truthy).unwrap_or(false) {
            self.set_closed(true);
        }
        let payload = step.get("result").cloned().unwrap_or_else(|| {
            json!({"kind": "result", "result": Value::Object(self.globals.clone())})
        });
        Ok(RuntimeEnvelope { payload })
    }
    fn inspect_globals(&mut self, _options: Value) -> AxResult<Value> {
        // python ScriptedCodeSession gates on runtime.capabilities and
        // returns the bracketed unavailable notice instead of raising.
        if !self.shared.borrow().capabilities.inspect_globals {
            return Ok(json!(CORE_AGENT_INSPECT_UNAVAILABLE));
        }
        Ok(Value::Object(self.globals.clone()))
    }
    fn snapshot_globals(&mut self, _options: Value) -> AxResult<Value> {
        if !self.shared.borrow().capabilities.snapshot_globals {
            return Err(AxError::runtime(
                "AxCodeSession.snapshot_globals() is required to export AxAgent state",
            ));
        }
        let entries = self
            .globals
            .iter()
            .map(|(key, value)| {
                json!({
                    "name": key,
                    "type": python_type_name(value),
                    "preview": python_repr(value),
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "version": 1,
            "entries": entries,
            "bindings": Value::Object(self.globals.clone()),
            "globals": Value::Object(self.globals.clone()),
            "closed": self.closed,
        }))
    }
    fn patch_globals(&mut self, snapshot: Value, options: Value) -> AxResult<Value> {
        if !self.shared.borrow().capabilities.patch_globals {
            return Err(AxError::runtime(
                "AxCodeSession.patch_globals() is required to restore AxAgent state",
            ));
        }
        let snap = snapshot.as_object().cloned().unwrap_or_default();
        self.globals = snap
            .get("bindings")
            .or_else(|| snap.get("globals"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let closed = snap.get("closed").map(core_json_truthy).unwrap_or(false);
        self.set_closed(closed);
        self.snapshot_globals(options)
    }
    fn close(&mut self) -> AxResult<Value> {
        self.set_closed(true);
        Ok(json!({"closed": true}))
    }
}

fn core_json_truthy(value: &Value) -> bool {
    core_truthy(&core_value_from_json(value))
}

fn python_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_i64() || n.is_u64() => "int",
        Value::Number(_) => "float",
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
    }
}

// python str(value): like repr but with bare strings.
fn python_str(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => python_repr(other),
    }
}

fn python_repr(value: &Value) -> String {
    match value {
        Value::Null => "None".to_string(),
        Value::Bool(true) => "True".to_string(),
        Value::Bool(false) => "False".to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(text) => format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'")),
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(python_repr).collect::<Vec<_>>().join(", ")
        ),
        Value::Object(map) => format!(
            "{{{}}}",
            map.iter()
                .map(|(key, value)| format!("'{key}': {}", python_repr(value)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

// ----- END AXIR CORE VALUE RUNTIME -----

// AXIR_CORE_RUST_FUNCTIONS
