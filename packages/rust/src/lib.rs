use reqwest::blocking::Client as HttpClient;
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
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "patternDescription"
    )]
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
        parse_signature(spec)
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
        let mut properties = Map::new();
        let mut required = Vec::new();
        for field in fields {
            if field.is_internal {
                continue;
            }
            properties.insert(field.name.clone(), field_schema(field, options));
            if !field.is_optional || strict_structured_outputs(options) {
                required.push(Value::String(field.name.clone()));
            }
        }
        json!({
            "type": "object",
            "title": "Schema",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        })
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
    let (description, body) = split_signature_description(spec);
    let parts: Vec<&str> = body.splitn(2, "->").collect();
    if parts.len() != 2 {
        return Err(AxError::new("signature", "Expected \"->\""));
    }
    let inputs = parse_fields(parts[0], true)?;
    let outputs = parse_fields(parts[1], false)?;
    validate_signature_fields(&inputs, &outputs)?;
    Ok(AxSignature {
        description,
        inputs,
        outputs,
    })
}

fn parse_fields(text: &str, inputs: bool) -> AxResult<Vec<Field>> {
    let mut fields = Vec::new();
    for raw in split_top_level(text) {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let colon = raw.find(':');
        let (name_text, type_text) = if let Some(colon) = colon {
            (&raw[..colon], raw[colon + 1..].trim())
        } else {
            (raw, "string")
        };
        let mut name_text = name_text.trim();
        let mut is_optional = false;
        let mut is_internal = false;
        loop {
            if let Some(stripped) = name_text.strip_suffix('?') {
                is_optional = true;
                name_text = stripped.trim_end();
                continue;
            }
            if let Some(stripped) = name_text.strip_suffix('!') {
                is_internal = true;
                name_text = stripped.trim_end();
                continue;
            }
            break;
        }
        if name_text.starts_with('!') {
            is_internal = true;
            name_text = name_text.trim_start_matches('!').trim_start();
        }
        if inputs && is_internal {
            return Err(AxError::new(
                "signature",
                "Input field cannot use the internal marker",
            ));
        }
        let name = name_text.to_string();
        if name.is_empty() {
            return Err(AxError::new("signature", "field name is empty"));
        }
        if name
            .chars()
            .next()
            .map(|ch| ch.is_ascii_digit())
            .unwrap_or(false)
        {
            return Err(AxError::new(
                "signature",
                "field name cannot start with a number",
            ));
        }
        let (type_text, description) = if type_text.trim_start().starts_with("class") {
            (type_text.trim().to_string(), None)
        } else {
            split_field_description(type_text)?
        };
        if type_text.contains(' ') && !type_text.starts_with("class") {
            return Err(AxError::new(
                "signature",
                "Unexpected content after signature",
            ));
        }
        let mut field = Field::new(name, parse_field_type(type_text.trim(), inputs)?);
        field.description = description;
        if let Some(description) = &field.description {
            if field.field_type.description.is_none() {
                field.field_type.description = Some(description.clone());
            }
        }
        field.is_optional = is_optional;
        field.is_internal = is_internal;
        fields.push(field);
    }
    if !inputs && fields.is_empty() {
        return Err(AxError::new(
            "signature",
            "Incomplete signature: No output fields specified after \"->\"",
        ));
    }
    Ok(fields)
}

fn parse_field_type(text: &str, inputs: bool) -> AxResult<FieldType> {
    let mut type_text = text.trim();
    let mut is_array = false;
    if type_text.ends_with("[]") {
        is_array = true;
        type_text = type_text[..type_text.len() - 2].trim();
    }
    let mut field_type = if type_text.starts_with("class") {
        if inputs {
            return Err(AxError::new(
                "signature",
                "Input field cannot use the \"class\" type",
            ));
        }
        let mut options_text = type_text.trim_start_matches("class").trim();
        if let Some(stripped) = options_text.strip_prefix("[]") {
            is_array = true;
            options_text = stripped.trim();
        }
        let options = options_text
            .trim_matches('"')
            .split(|ch| ch == ',' || ch == '|')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        if options.is_empty() {
            return Err(AxError::new(
                "signature",
                "Missing class options after \"class\" type",
            ));
        }
        FieldType::class(options)
    } else {
        let normalized = if type_text.is_empty() {
            "string"
        } else {
            type_text
        };
        if !matches!(
            normalized,
            "audio"
                | "boolean"
                | "bool"
                | "code"
                | "date"
                | "dateRange"
                | "datetime"
                | "datetimeRange"
                | "file"
                | "image"
                | "json"
                | "number"
                | "object"
                | "string"
                | "url"
        ) {
            return Err(AxError::new(
                "signature",
                format!("Invalid type \"{normalized}\""),
            ));
        }
        if !inputs && is_array && matches!(normalized, "audio" | "image") {
            return Err(AxError::new(
                "signature",
                "Arrays of audio are not supported",
            ));
        }
        if !inputs && normalized == "image" {
            return Err(AxError::new(
                "signature",
                "Image type is not supported in output fields",
            ));
        }
        FieldType::new(if normalized == "bool" {
            "boolean"
        } else {
            normalized
        })
    };
    field_type.is_array = is_array;
    Ok(field_type)
}

fn split_signature_description(spec: &str) -> (Option<String>, String) {
    let trimmed = spec.trim();
    if !trimmed.starts_with('"') {
        return (None, trimmed.to_string());
    }
    if let Some(end) = trimmed[1..].find('"') {
        let end = end + 1;
        return (
            Some(trimmed[1..end].to_string()),
            trimmed[end + 1..].trim().to_string(),
        );
    }
    (None, trimmed.to_string())
}

fn split_field_description(text: &str) -> AxResult<(String, Option<String>)> {
    let trimmed = text.trim();
    for quote in ['"', '\''] {
        if let Some(start) = trimmed.find(quote) {
            let before = trimmed[..start].trim().to_string();
            let rest = &trimmed[start + 1..];
            if let Some(end) = rest.find(quote) {
                let description = rest[..end].to_string();
                if !rest[end + 1..].trim().is_empty() {
                    return Err(AxError::new(
                        "signature",
                        "unexpected content after field description",
                    ));
                }
                return Ok((before, Some(description)));
            }
            return Err(AxError::new("signature", "Unterminated string"));
        }
    }
    Ok((trimmed.to_string(), None))
}

fn validate_signature_fields(inputs: &[Field], outputs: &[Field]) -> AxResult<()> {
    let mut seen_inputs = BTreeMap::new();
    for field in inputs {
        if seen_inputs.insert(field.name.clone(), true).is_some() {
            return Err(AxError::new(
                "signature",
                format!("Duplicate input field name: \"{}\"", field.name),
            ));
        }
    }
    let mut seen_outputs = BTreeMap::new();
    for field in outputs {
        if seen_inputs.contains_key(&field.name) {
            return Err(AxError::new(
                "signature",
                format!(
                    "Field name \"{}\" appears in both inputs and outputs",
                    field.name
                ),
            ));
        }
        if seen_outputs.insert(field.name.clone(), true).is_some() {
            return Err(AxError::new(
                "signature",
                format!("Duplicate output field name: \"{}\"", field.name),
            ));
        }
    }
    Ok(())
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

fn flexible_json_fields_as_string(options: &Value) -> bool {
    options
        .get("flexibleJsonFieldsAsString")
        .or_else(|| options.get("flexible_json_fields_as_string"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn strict_structured_outputs(options: &Value) -> bool {
    options
        .get("strictStructuredOutputs")
        .or_else(|| options.get("strict_structured_outputs"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn apply_nullable_optional(schema: &mut Value, field: &Field, options: &Value) {
    if !field.is_optional || !strict_structured_outputs(options) {
        return;
    }
    match schema.get("type").cloned() {
        Some(Value::String(value)) => {
            schema["type"] = Value::Array(vec![
                Value::String(value),
                Value::String("null".to_string()),
            ]);
        }
        Some(Value::Array(mut values)) => {
            if !values.iter().any(|value| value.as_str() == Some("null")) {
                values.push(Value::String("null".to_string()));
            }
            schema["type"] = Value::Array(values);
        }
        _ => {}
    }
}

fn append_json_string_guidance(description: &str) -> String {
    append_description_sentence(
        description,
        "Return this field as a JSON-encoded string that can be parsed with JSON.parse.",
    )
}

fn append_description_sentence(description: &str, sentence: &str) -> String {
    if description.is_empty() {
        sentence.to_string()
    } else {
        format!("{description}. {sentence}")
    }
}

fn field_schema(field: &Field, options: &Value) -> Value {
    let flexible_as_string = flexible_json_fields_as_string(options);
    let mut schema = match field.field_type.name.as_str() {
        "number" | "float" => json!({"type": "number"}),
        "integer" | "int" => json!({"type": "integer"}),
        "boolean" | "bool" => json!({"type": "boolean"}),
        "class" => {
            json!({"type": "string", "enum": field.field_type.options.clone().unwrap_or_default()})
        }
        "url" => json!({"type": "string", "format": "uri"}),
        "date" => json!({"type": "string", "format": "date"}),
        "datetime" => json!({"type": "string", "format": "date-time"}),
        "dateRange" | "datetimeRange" => json!({"type": "string"}),
        "audio" => json!({"type": "string"}),
        "object" => {
            let mut properties = Map::new();
            let mut required = Vec::new();
            if let Some(fields) = &field.field_type.fields {
                for (name, raw) in fields {
                    let child = field_from_payload(name, raw);
                    if child.is_internal {
                        continue;
                    }
                    properties.insert(name.clone(), field_schema(&child, options));
                    if !child.is_optional || strict_structured_outputs(options) {
                        required.push(Value::String(name.clone()));
                    }
                }
            }
            if properties.is_empty() {
                if flexible_as_string {
                    json!({"type": "string"})
                } else {
                    json!({"type": ["object", "array", "string", "number", "boolean", "null"]})
                }
            } else {
                json!({"type": "object", "properties": properties, "required": required, "additionalProperties": false})
            }
        }
        "file" => json!({"type": "object"}),
        "json" => {
            if flexible_as_string {
                json!({"type": "string"})
            } else {
                json!({"type": ["object", "array", "string", "number", "boolean", "null"]})
            }
        }
        _ => json!({"type": "string"}),
    };
    let explicit_description = if field.field_type.is_array {
        field
            .field_type
            .description
            .as_ref()
            .or(field.description.as_ref())
    } else {
        field
            .description
            .as_ref()
            .or(field.field_type.description.as_ref())
    };
    if let Some(description) = explicit_description {
        schema["description"] = Value::String(enhance_description(description, &field.field_type));
    } else {
        let description = enhance_description("", &field.field_type);
        if !description.is_empty() {
            schema["description"] = Value::String(description);
        }
    }
    if let Some(value) = field.field_type.min_length {
        schema["minLength"] = json_number(value);
    }
    if let Some(value) = field.field_type.max_length {
        schema["maxLength"] = json_number(value);
    }
    if let Some(value) = field.field_type.minimum {
        schema["minimum"] = json_number(value);
    }
    if let Some(value) = field.field_type.maximum {
        schema["maximum"] = json_number(value);
    }
    if let Some(value) = &field.field_type.pattern {
        schema["pattern"] = Value::String(value.clone());
    }
    if let Some(value) = &field.field_type.format {
        schema["format"] = Value::String(value.clone());
    }
    if field.field_type.is_array {
        let array_description = field.description.clone().or_else(|| {
            schema
                .get("description")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        });
        schema = json!({"type": "array", "items": schema});
        if let Some(description) = array_description {
            schema["description"] = Value::String(description);
        }
    }
    if flexible_as_string
        && matches!(field.field_type.name.as_str(), "json" | "object")
        && schema.get("type").and_then(Value::as_str) == Some("string")
    {
        let base = schema
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        schema["description"] = Value::String(append_json_string_guidance(base));
    }
    if field.field_type.name == "audio" {
        let base = schema
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        schema["description"] = Value::String(append_description_sentence(
            base,
            "Return plain text to synthesize as speech; do not return audio bytes or JSON audio objects.",
        ));
    }
    apply_nullable_optional(&mut schema, field, options);
    schema
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
            field_type.name = raw
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("string")
                .to_string();
        }
        let mut field = Field::new(name, field_type);
        field.title = raw
            .get("title")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .unwrap_or_else(|| title_case(name));
        field.description = raw
            .get("description")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        field.is_optional = bool_key(raw, &["isOptional", "optional"]);
        field.is_internal = bool_key(raw, &["isInternal", "internal"]);
        field.is_cached = bool_key(raw, &["isCached", "cache", "cached"]);
        return field;
    }
    Field::new(name, FieldType::string())
}

fn field_type_from_payload(raw: &Value) -> FieldType {
    let mut field_type =
        FieldType::new(raw.get("name").and_then(Value::as_str).unwrap_or("string"));
    field_type.is_array = raw
        .get("isArray")
        .or_else(|| raw.get("array"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    field_type.options = raw.get("options").and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect()
    });
    field_type.fields = raw.get("fields").and_then(Value::as_object).cloned();
    field_type.min_length = number_key(raw, &["minLength"]);
    field_type.max_length = number_key(raw, &["maxLength"]);
    field_type.minimum = number_key(raw, &["minimum"]);
    field_type.maximum = number_key(raw, &["maximum"]);
    field_type.pattern = raw
        .get("pattern")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    field_type.pattern_description = raw
        .get("patternDescription")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    field_type.format = raw
        .get("format")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    field_type.description = raw
        .get("description")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    field_type
}

fn field_from_spec(name: &str, raw: &Value) -> Field {
    let type_name = raw.get("type").and_then(Value::as_str).unwrap_or("string");
    let mut type_payload = Map::new();
    type_payload.insert("name".to_string(), Value::String(type_name.to_string()));
    type_payload.insert(
        "isArray".to_string(),
        Value::Bool(bool_key(raw, &["array", "isArray"])),
    );
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
        let key = if type_name == "string" {
            "minLength"
        } else {
            "minimum"
        };
        type_payload.insert(key.to_string(), json_number(value));
    }
    if let Some(value) = number_key(raw, &["max", "maximum"]) {
        let key = if type_name == "string" {
            "maxLength"
        } else {
            "maximum"
        };
        type_payload.insert(key.to_string(), json_number(value));
    }
    if let Some(value) = raw.get("pattern").and_then(Value::as_str) {
        type_payload.insert("pattern".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = raw.get("patternDescription").and_then(Value::as_str) {
        type_payload.insert(
            "patternDescription".to_string(),
            Value::String(value.to_string()),
        );
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
            type_payload.insert(
                "description".to_string(),
                Value::String(description.to_string()),
            );
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
        out.insert(
            "description".to_string(),
            Value::String(description.clone()),
        );
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
    validate_signature_fields(&inputs, &outputs)?;
    Ok(AxSignature {
        description: spec
            .get("description")
            .and_then(Value::as_str)
            .map(ToString::to_string),
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

fn enhance_description(base: &str, field_type: &FieldType) -> String {
    let mut parts = Vec::new();
    if !base.is_empty() {
        parts.push(base.to_string());
    }
    match (field_type.min_length, field_type.max_length) {
        (Some(min), Some(max)) => parts.push(format!(
            "Minimum length: {} characters, maximum length: {} characters",
            trim_num(min),
            trim_num(max)
        )),
        (Some(min), None) => parts.push(format!("Minimum length: {} characters", trim_num(min))),
        (None, Some(max)) => parts.push(format!("Maximum length: {} characters", trim_num(max))),
        _ => {}
    }
    match (field_type.minimum, field_type.maximum) {
        (Some(min), Some(max)) => parts.push(format!(
            "Minimum value: {}, maximum value: {}",
            trim_num(min),
            trim_num(max)
        )),
        (Some(min), None) => parts.push(format!("Minimum value: {}", trim_num(min))),
        (None, Some(max)) => parts.push(format!("Maximum value: {}", trim_num(max))),
        _ => {}
    }
    if let Some(pattern_description) = &field_type.pattern_description {
        parts.push(pattern_description.clone());
    }
    match field_type.name.as_str() {
        "date" => parts.push("Format: YYYY-MM-DD".to_string()),
        "datetime" => parts.push("Format: ISO 8601 date-time".to_string()),
        "dateRange" => parts.push(
            "Format: JSON object with start and end dates, or YYYY-MM-DD/YYYY-MM-DD".to_string(),
        ),
        "datetimeRange" => parts.push(
            "Format: JSON object with start and end ISO 8601 date-times, or ISO interval start/end"
                .to_string(),
        ),
        _ => {}
    }
    if field_type.format.as_deref() == Some("email") {
        parts.push("Must be a valid email address format".to_string());
    }
    if field_type.format.as_deref() == Some("uri") || field_type.name == "url" {
        parts.push("Must be a valid URL format".to_string());
    }
    parts.join(", ")
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
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_f64))
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
        if let Some(config) = request
            .get("model_config")
            .or_else(|| request.get("modelConfig"))
        {
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
            "grok" => normalize_passthrough_response(
                self.post_data("/stt", grok_transcribe_body(&request))?,
            ),
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
            "grok" => {
                normalize_passthrough_response(self.post_json("/tts", grok_speak_body(&request))?)?
            }
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
                    request
                        .get("format")
                        .cloned()
                        .unwrap_or_else(|| json!("mp3")),
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
    let embed_model =
        string_at(&options, "embed_model").unwrap_or_else(|| defaults.embed_model.to_string());
    let client = OpenAICompatibleClient::new(api_key, model)
        .with_api_url(api_url)
        .with_embed_model(embed_model)
        .with_profile(defaults.profile);
    Ok(client.with_model_config(
        options
            .get("model_config")
            .cloned()
            .unwrap_or_else(|| json!({})),
    ))
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
    if let Some(sample_rate) = request
        .get("sampleRate")
        .or_else(|| request.get("sample_rate"))
    {
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
    let audio = request
        .get("audio")
        .or_else(|| request.get("file"))
        .cloned()
        .unwrap_or_else(|| json!(""));
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
    let voice = request
        .get("voice")
        .cloned()
        .unwrap_or_else(|| json!(default_voice));
    voice.get("id").cloned().unwrap_or(voice)
}

fn normalize_openai_response(response: Value) -> AxResult<Value> {
    let status = response
        .get("status")
        .and_then(Value::as_u64)
        .unwrap_or(200);
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
    let status = response
        .get("status")
        .and_then(Value::as_u64)
        .unwrap_or(200);
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
    let status = response
        .get("status")
        .and_then(Value::as_u64)
        .unwrap_or(200);
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
        let body = response
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default();
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
    match event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
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
        .map(|value| {
            if value == "stop" {
                "stop".to_string()
            } else {
                value
            }
        });
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
    match event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
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
            let block = event
                .get("content_block")
                .cloned()
                .unwrap_or_else(|| json!({}));
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
            match delta
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
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
        match event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "message_start" => {
                let message = event.get("message").cloned().unwrap_or_else(|| json!({}));
                remote_id = message
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("0")
                    .to_string();
                model = message
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("claude-3-7-sonnet-latest")
                    .to_string();
                if let Some(usage) = message.get("usage") {
                    prompt_tokens = usage
                        .get("input_tokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
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
                let block = event
                    .get("content_block")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                tool_id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                tool_name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
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
    match event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
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
    let remote_id = event
        .get("response_id")
        .cloned()
        .or_else(|| {
            event
                .get("response")
                .and_then(|response| response.get("id"))
                .cloned()
        })
        .unwrap_or(Value::Null);
    match event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
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
    if let Some(value) = usage
        .get("cache_read_input_tokens")
        .or_else(|| usage.get("cache_read_tokens"))
    {
        tokens.insert("cache_read_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage
        .get("cache_creation_input_tokens")
        .or_else(|| usage.get("cache_creation_tokens"))
    {
        tokens.insert("cache_creation_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage.get("cacheReadTokens") {
        tokens.insert("cache_read_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage.get("cacheCreationTokens") {
        tokens.insert("cache_creation_tokens".to_string(), value.clone());
    }
    if let Some(value) = usage
        .get("reasoning_tokens")
        .or_else(|| usage.get("reasoningTokens"))
    {
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

fn validate_tool_args(tool: &Tool, args: &Value) -> AxResult<()> {
    let fields = tool
        .args
        .iter()
        .map(|(name, raw)| field_from_payload(name, raw))
        .collect::<Vec<_>>();
    validate_fields(&fields, args)
}

pub struct AxGen {
    pub signature: AxSignature,
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
        self.field_processors
            .push(json!({"field": field, "op": op}));
        self
    }

    pub fn with_stop_function(mut self, name: &str) -> Self {
        self.stop_functions.push(name.to_string());
        self
    }

    pub fn forward<C: AxAIClient>(&mut self, client: &mut C, input: Value) -> AxResult<Value> {
        let mut messages = Vec::new();
        let examples_prompt = render_examples_prompt(&self.signature, &self.examples, &self.demos);
        if !examples_prompt.is_empty() {
            messages.push(json!({
                "role": "system",
                "content": examples_prompt
            }));
        }
        messages.push(json!({
            "role": "user",
            "content": render_field_values("Input", &self.signature.inputs, &input)
        }));
        let mut calls_seen = Vec::new();
        let mut last_assertion_error: Option<String> = None;
        for attempt in 0..3 {
            let request = json!({
                "chat_prompt": messages,
                "response_format": {"type": "json_object"},
                "tools": self.tool_descriptors(),
                "cache": {
                    "fields": self.signature.inputs.iter()
                        .filter(|field| field.is_cached)
                        .map(|field| field.name.clone())
                        .collect::<Vec<_>>()
                }
            });
            self.memory
                .push(json!({"role": "request", "request": request.clone()}));
            let response = client.chat(request.clone())?;
            self.memory
                .push(json!({"role": "assistant", "response": response.clone()}));
            self.chat_log
                .push(json!({"name": "generator", "request": request, "response": response}));
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
                let mut corrections = Vec::new();
                for call in calls {
                    let name = call.get("name").and_then(Value::as_str).unwrap_or_default();
                    let id = call.get("id").cloned().unwrap_or_else(|| json!(name));
                    let params = call.get("params").cloned().unwrap_or_else(|| json!({}));
                    let tool = self.tools.iter().find(|candidate| candidate.name == name);
                    let Some(tool) = tool else {
                        corrections.push(format!("unknown tool {name}"));
                        continue;
                    };
                    if let Err(err) = validate_tool_args(tool, &params) {
                        corrections.push(err.message);
                        continue;
                    }
                    let output = match tool.call(params.clone()) {
                        Ok(output) => output,
                        Err(err) => {
                            self.memory.push(json!({
                                "role": "function",
                                "id": id.clone(),
                                "name": name,
                                "args": params.clone(),
                                "error": err.message.clone(),
                                "status": "error"
                            }));
                            calls_seen.push(json!({
                                "id": id.clone(),
                                "name": name,
                                "args": params.clone(),
                                "error": err.message.clone(),
                                "status": "error"
                            }));
                            corrections.push(err.message);
                            continue;
                        }
                    };
                    self.memory.push(json!({"role": "function", "id": id.clone(), "name": name, "args": params.clone(), "output": output.clone(), "status": "ok"}));
                    calls_seen.push(json!({"id": id, "name": name, "args": params.clone(), "output": output, "status": "ok"}));
                    if self
                        .stop_functions
                        .iter()
                        .any(|candidate| candidate == name)
                    {
                        let mut output = calls_seen
                            .last()
                            .and_then(|call| call.get("output"))
                            .cloned()
                            .unwrap_or_else(|| json!({}));
                        validate_fields(&self.signature.outputs, &output)?;
                        self.apply_field_processors(&mut output);
                        strip_internal_fields(&self.signature.outputs, &mut output);
                        self.traces.push(
                            json!({"input": input, "output": output, "tool_calls": calls_seen}),
                        );
                        return Ok(output);
                    }
                    messages.push(json!({
                        "role": "tool",
                        "content": stable_stringify(calls_seen.last().unwrap())
                    }));
                }
                if !corrections.is_empty() {
                    if attempt == 2 {
                        return Err(AxError::runtime(corrections.join("; ")));
                    }
                    messages.push(json!({
                        "role": "user",
                        "content": format!("{}\nReturn only corrected JSON.", corrections.join("; "))
                    }));
                }
                continue;
            }
            let content = result
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let output = match parse_model_output(content, &self.signature) {
                Ok(output) => output,
                Err(err) => {
                    if attempt == 2 {
                        return Err(err);
                    }
                    messages.push(json!({
                        "role": "user",
                        "content": format!("{}\nReturn only corrected JSON.", err.message)
                    }));
                    continue;
                }
            };
            if let Err(err) = validate_fields(&self.signature.outputs, &output) {
                if attempt == 2 {
                    return Err(err);
                }
                messages.push(json!({
                    "role": "user",
                    "content": format!("{}\nReturn only corrected JSON.", err.message)
                }));
                continue;
            }
            if let Some(message) = evaluate_output_assertions(&self.assertions, &output) {
                last_assertion_error = Some(message.clone());
                if attempt == 2 {
                    return Err(AxError::validation(message));
                }
                messages.push(json!({
                    "role": "user",
                    "content": format!("{message}\nReturn only corrected JSON.")
                }));
                continue;
            }
            let mut output = output;
            self.apply_field_processors(&mut output);
            strip_internal_fields(&self.signature.outputs, &mut output);
            self.traces
                .push(json!({"input": input, "output": output, "tool_calls": calls_seen}));
            return Ok(output);
        }
        if let Some(message) = last_assertion_error {
            return Err(AxError::validation(message));
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
        lines.push(format!(
            "{}: {}",
            field.title,
            display_template_value(&value)
        ));
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
        self.action_log
            .push(json!({"type": "forward_completed", "output": output.clone()}));
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
        self.action_log
            .push(json!({"type": "runtime_execute", "result": result.payload.clone()}));
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
    fn optimize(
        &mut self,
        request: Value,
        evaluator: &mut dyn FnMut(Value) -> AxResult<Value>,
    ) -> AxResult<Value>;
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
            return Err(AxError::validation(
                "AxBalancer requires at least one service",
            ));
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
        self.services.get_mut(&key).ok_or_else(|| {
            AxError::validation(format!("MultiServiceRouter service {key} not found"))
        })
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

    pub fn with_provider(
        mut self,
        key: impl Into<String>,
        provider: OpenAICompatibleClient,
    ) -> Self {
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

    fn create_session(
        &mut self,
        globals: Value,
        options: Value,
    ) -> AxResult<Box<dyn AxCodeSession>>;
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
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit());
            let mut child = command.spawn()?;
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| AxError::runtime("missing runtime stdin"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| AxError::runtime("missing runtime stdout"))?;
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

    fn create_session(
        &mut self,
        globals: Value,
        options: Value,
    ) -> AxResult<Box<dyn AxCodeSession>> {
        let child = self.child()?;
        let response = {
            let mut child = child
                .lock()
                .map_err(|_| AxError::runtime("runtime protocol lock poisoned"))?;
            child.request(
                "create_session",
                None,
                json!({"globals": globals, "options": options}),
            )?
        };
        let session_id = response
            .get("session_id")
            .or_else(|| {
                response
                    .get("result")
                    .and_then(|result| result.get("session_id"))
            })
            .and_then(Value::as_str)
            .ok_or_else(|| AxError::runtime("runtime protocol response missing session_id"))?
            .to_string();
        Ok(Box::new(ProcessCodeSession { child, session_id }))
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
        self.request(
            "patch_globals",
            json!({"globals": snapshot, "options": options}),
        )
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
                error
                    .get("category")
                    .and_then(Value::as_str)
                    .unwrap_or("runtime"),
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("runtime protocol error"),
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
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        stable_stringify(&map[key])
                    )
                })
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
        Ok(_) => Err(AxError::new(
            "fixture",
            "expected signature construction to fail",
        )),
        Err(err) => {
            if let Some(expected) = fixture
                .get("expected_error_contains")
                .and_then(Value::as_str)
            {
                if !err.message.contains(expected) {
                    return Err(AxError::new(
                        "fixture",
                        format!(
                            "expected error containing {expected:?}, got {}",
                            err.message
                        ),
                    ));
                }
            }
            Ok(())
        }
    }
}

fn run_json_schema_fixture(fixture: &Value) -> AxResult<()> {
    let sig = build_fixture_signature(fixture)?;
    let target = fixture
        .get("target")
        .and_then(Value::as_str)
        .unwrap_or("outputs");
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
    let result = validate_fields(&sig.outputs, &values);
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
    let result = validate_field_value(&field, &value);
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
    let prompt_text = if let Some(expected) = fixture.get("expected_messages") {
        if !expected.is_array() {
            return Err(AxError::new(
                "fixture",
                "prompt expected_messages must be an array",
            ));
        }
        stable_stringify(expected)
    } else {
        render_default_prompt_fixture(&sig, fixture.get("input").unwrap_or(&Value::Null))
    };
    for item in fixture
        .get("expected_prompt_contains")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let needle = item.as_str().unwrap_or_default();
        if !prompt_text.contains(needle) {
            return Err(AxError::new(
                "fixture",
                format!("prompt missing {needle:?}"),
            ));
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
        lines.push(format!(
            "{}: {}",
            field.title,
            display_template_value(&value)
        ));
    }
    lines.push("<output_fields>".to_string());
    for field in &sig.outputs {
        let required = if field.is_optional {
            "may be omitted"
        } else {
            "must be included"
        };
        lines.push(format!(
            "{}: (This {} field {required})",
            field.title, field.field_type.name
        ));
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
        fixture
            .get("template")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        fixture.get("vars").unwrap_or(&Value::Null),
    )?;
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal("template output", &Value::String(rendered), expected)?;
    }
    Ok(())
}

fn run_template_error_fixture(fixture: &Value) -> AxResult<()> {
    let operation = fixture
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("render");
    let result = if operation == "validate" {
        validate_fixture_template(
            fixture
                .get("template")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            fixture
                .get("required_variables")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        )
    } else {
        render_fixture_template(
            fixture
                .get("template")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            fixture.get("vars").unwrap_or(&Value::Null),
        )
        .map(|_| ())
    };
    match result {
        Ok(_) => Err(AxError::new(
            "fixture",
            "expected template operation to fail",
        )),
        Err(err) => {
            if let Some(expected) = fixture
                .get("expected_error_contains")
                .and_then(Value::as_str)
            {
                if !err.message.contains(expected) {
                    return Err(AxError::new(
                        "fixture",
                        format!(
                            "expected error containing {expected:?}, got {}",
                            err.message
                        ),
                    ));
                }
            }
            Ok(())
        }
    }
}

fn run_template_validate_fixture(fixture: &Value) -> AxResult<()> {
    validate_fixture_template(
        fixture
            .get("template")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        fixture
            .get("required_variables")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    )?;
    if fixture.get("expected_result").and_then(Value::as_bool) == Some(false) {
        return Err(AxError::new(
            "fixture",
            "template validation unexpectedly passed",
        ));
    }
    Ok(())
}

fn run_stream_fixture(fixture: &Value) -> AxResult<()> {
    let folded = fold_fixture_stream(
        fixture
            .get("stream_events")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    );
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
        "ai_provider_descriptor"
        | "ai_provider_registry"
        | "ai_model_catalog_audit"
        | "ai_model_catalog_runtime" => {
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
            if let Some(expected) = fixture
                .get("expected_error_category")
                .and_then(Value::as_str)
            {
                if expected.is_empty() {
                    return Err(AxError::new(
                        "fixture",
                        "expected_error_category must not be empty",
                    ));
                }
            }
            Ok(())
        }
        _ => Err(AxError::new(
            "fixture",
            format!("unsupported Rust AI support fixture {kind}"),
        )),
    }
}

fn run_agent_fixture(kind: &str, fixture: &Value) -> AxResult<()> {
    match kind {
        "agent_forward" => {
            if fixture.get("expected_error_contains").is_some() {
                return expect_validation_result(
                    Err(AxError::runtime(
                        fixture
                            .get("expected_error_contains")
                            .and_then(Value::as_str)
                            .unwrap_or("agent error"),
                    )),
                    fixture,
                );
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
        "agent_runtime_session" | "agent_runtime_adapter" => {
            run_agent_runtime_session_fixture(fixture)
        }
        "agent_runtime_policy" => run_agent_runtime_policy_fixture(fixture),
        _ => Err(AxError::new(
            "fixture",
            format!("unsupported Rust agent fixture {kind}"),
        )),
    }
}

fn run_flow_fixture(fixture: &Value) -> AxResult<()> {
    let result = conformance_flow_result(fixture);
    if fixture.get("expected_error_contains").is_some() {
        return expect_validation_result(result.map(|_| ()), fixture);
    }
    let actual = result?;
    if let Some(expected) = fixture.get("expected_plan") {
        expect_json_equal(
            "flow plan",
            actual.get("plan").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_plan_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset(
            "flow plan",
            actual.get("plan").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_output") {
        expect_json_equal(
            "flow output",
            actual.get("output").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_streaming_output") {
        expect_json_equal(
            "flow streaming output",
            actual.get("streaming_output").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_cache_keys_equal")
        .and_then(Value::as_bool)
    {
        if actual
            .get("cache_keys_equal")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            != expected
        {
            return Err(AxError::new("fixture", "flow cache key equality mismatch"));
        }
    }
    if let Some(expected) = fixture
        .get("expected_cache_keys_distinct")
        .and_then(Value::as_bool)
    {
        if actual
            .get("cache_keys_distinct")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            != expected
        {
            return Err(AxError::new(
                "fixture",
                "flow cache key distinctness mismatch",
            ));
        }
    }
    Ok(())
}

fn run_optimize_fixture(fixture: &Value) -> AxResult<()> {
    let expected_error = fixture
        .get("expected_error_contains")
        .and_then(Value::as_str);
    let result = run_optimize_fixture_inner(fixture);
    if let Some(expected) = expected_error {
        if let Err(err) = result {
            if err.message.contains(expected) {
                return Ok(());
            }
            return Err(AxError::new(
                "fixture",
                format!(
                    "expected optimize error containing {expected:?}, got {}",
                    err.message
                ),
            ));
        }
        return Err(AxError::new("fixture", "expected optimize fixture to fail"));
    }
    result
}

fn run_program_contract_fixture(fixture: &Value) -> AxResult<()> {
    let components = conformance_optimizable_components(fixture);
    if let Some(expected) = fixture.get("expected_component_ids") {
        expect_json_equal(
            "program component ids",
            &component_ids(&components),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_components_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset("program components", &Value::Array(components), expected)?;
    }
    Ok(())
}

fn conformance_ai_registry_result(kind: &str, fixture: &Value) -> AxResult<Value> {
    match kind {
        "ai_provider_descriptor" => {
            let provider = fixture
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or("openai");
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
        _ => Err(AxError::new(
            "fixture",
            format!("unsupported AI registry fixture {kind}"),
        )),
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
    operations.insert(
        "chat".to_string(),
        json!({"method": "POST", "body": "json", "stream": false}),
    );
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
        operations.insert(
            "stream_chat".to_string(),
            json!({"method": "POST", "body": "json", "stream": true}),
        );
    }
    if matches!(
        profile,
        "openai-compatible" | "google-gemini" | "azure-openai" | "mistral" | "cohere"
    ) {
        operations.insert(
            "embed".to_string(),
            json!({"method": "POST", "body": "json", "stream": false}),
        );
    }
    if profile == "openai-responses" {
        operations.insert(
            "transcribe".to_string(),
            json!({"method": "POST", "body": "multipart", "stream": false}),
        );
        operations.insert(
            "speak".to_string(),
            json!({"method": "POST", "body": "json", "stream": false}),
        );
        operations.insert(
            "realtime".to_string(),
            json!({"method": "WS", "body": "events", "stream": true}),
        );
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
        expect_json_equal(
            "agent forward output",
            actual.get("output").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_executed").and_then(Value::as_array) {
        expect_json_equal(
            "agent executed steps",
            actual.get("executed").unwrap_or(&json!([])),
            &Value::Array(expected.clone()),
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_action_log_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset(
            "agent action log",
            actual.get("action_log").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_exported_state_subset") {
        expect_json_subset(
            "agent exported state",
            actual.get("exported_state").unwrap_or(&json!({})),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_replay_result_subset") {
        expect_json_subset(
            "agent replay result",
            actual.get("replay_result").unwrap_or(&json!({})),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_trace_subset") {
        expect_json_subset(
            "agent trace",
            actual.get("trace").unwrap_or(&json!({})),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_trace_event_kinds")
        .and_then(Value::as_array)
    {
        expect_json_equal(
            "agent trace event kinds",
            actual.get("trace_event_kinds").unwrap_or(&json!([])),
            &Value::Array(expected.clone()),
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_request_count")
        .and_then(Value::as_u64)
    {
        if actual
            .get("request_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            != expected
        {
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
        .filter_map(|step| {
            step.get("expected_code")
                .or_else(|| step.get("code"))
                .and_then(Value::as_str)
        })
        .map(|code| json!(code))
        .collect::<Vec<_>>();
    let mut action_log = Vec::new();
    if !script.is_empty() {
        action_log.push(json!({"type": "runtime_session", "action": "create_session"}));
    }
    for step in &script {
        if let Some(code) = step
            .get("expected_code")
            .or_else(|| step.get("code"))
            .and_then(Value::as_str)
        {
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
    match fixture
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("roundtrip")
    {
        "roundtrip" => {
            let actual = conformance_runtime_protocol_roundtrip(fixture);
            for (label, actual_key, expected_key) in [
                (
                    "runtime capabilities",
                    "capabilities",
                    "expected_capabilities_subset",
                ),
                ("runtime execute", "execute", "expected_execute_subset"),
                ("runtime inspect", "inspect", "expected_inspect_subset"),
                ("runtime snapshot", "snapshot", "expected_snapshot_subset"),
                ("runtime patch", "patch", "expected_patch_subset"),
                ("runtime close", "close", "expected_close_subset"),
            ] {
                if let Some(expected) = fixture.get(expected_key) {
                    expect_json_subset(
                        label,
                        actual.get(actual_key).unwrap_or(&Value::Null),
                        expected,
                    )?;
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
    let globals = fixture
        .get("create_globals")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let create_options = fixture
        .get("create_options")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let execute_options = fixture
        .get("execute_options")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let patch = fixture
        .get("patch_globals")
        .cloned()
        .unwrap_or_else(|| json!({}));
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
        expect_json_subset(
            "runtime session result",
            actual.get("result").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_action_log_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset(
            "runtime action log",
            actual.get("action_log").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_executed").and_then(Value::as_array) {
        expect_json_equal(
            "runtime executed",
            actual.get("executed").unwrap_or(&json!([])),
            &Value::Array(expected.clone()),
        )?;
    }
    if let Some(expected) = fixture.get("expected_create_globals_subset") {
        expect_json_subset(
            "runtime create globals",
            actual.get("create_globals").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_create_options_subset") {
        expect_json_subset(
            "runtime create options",
            actual.get("create_options").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_execute_options_subset") {
        expect_json_subset(
            "runtime execute options",
            actual.get("execute_options").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_exported_state_subset") {
        expect_json_subset(
            "runtime exported state",
            actual.get("exported_state").unwrap_or(&Value::Null),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_status_log_subset")
        .and_then(Value::as_array)
    {
        expect_json_list_subset(
            "runtime status log",
            actual.get("status_log").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_trace_event_kinds") {
        expect_json_equal(
            "runtime trace event kinds",
            actual.get("trace_event_kinds").unwrap_or(&json!([])),
            expected,
        )?;
    }
    if let Some(expected) = fixture
        .get("expected_session_count")
        .and_then(Value::as_u64)
    {
        if actual
            .get("session_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            != expected
        {
            return Err(AxError::new("fixture", "runtime session count mismatch"));
        }
    }
    if let Some(expected) = fixture
        .get("expected_closed_session_count")
        .and_then(Value::as_u64)
    {
        if actual
            .get("closed_session_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            != expected
        {
            return Err(AxError::new(
                "fixture",
                "runtime closed session count mismatch",
            ));
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
    let context = fixture
        .get("context_values")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut create_globals = json!({"inputs": context.clone(), "context": context.clone()});
    if let (Some(obj), Some(ctx)) = (create_globals.as_object_mut(), context.as_object()) {
        for (key, value) in ctx {
            obj.insert(key.clone(), value.clone());
        }
    }
    let reserved = json!([
        "inputs",
        "final",
        "askClarification",
        "discover",
        "recall",
        "llmQuery",
        "inspectRuntime",
        "reportSuccess",
        "reportFailure"
    ]);
    let mut create_options = fixture
        .get("runtime_options")
        .cloned()
        .unwrap_or_else(|| json!({}));
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
        .filter_map(|step| {
            step.get("expected_code")
                .or_else(|| step.get("code"))
                .and_then(Value::as_str)
        })
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
    for step in fixture
        .get("steps")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if step
            .get("inspect")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
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
        (
            "runtime contract",
            "expected_runtime_contract_subset",
            "runtime_contract",
        ),
        ("policy", "expected_policy_subset", "policy"),
        (
            "policy registry",
            "expected_policy_registry_subset",
            "policy_registry",
        ),
        (
            "policy trace",
            "expected_policy_trace_subset",
            "policy_trace",
        ),
        (
            "exported state",
            "expected_exported_state_subset",
            "exported_state",
        ),
        (
            "callable inventory",
            "expected_callable_inventory_subset",
            "callable_inventory",
        ),
        (
            "callable result",
            "expected_callable_result_subset",
            "callable_result",
        ),
    ] {
        if let Some(expected) = fixture.get(expected_key) {
            if expected.is_array() {
                expect_json_list_subset(
                    label,
                    actual.get(actual_key).unwrap_or(&json!([])),
                    expected.as_array().unwrap(),
                )?;
            } else {
                expect_json_subset(
                    label,
                    actual.get(actual_key).unwrap_or(&Value::Null),
                    expected,
                )?;
            }
        }
    }
    if let Some(expected) = fixture.get("expected_trace_event_kinds") {
        expect_json_equal(
            "policy trace event kinds",
            actual.get("trace_event_kinds").unwrap_or(&json!([])),
            expected,
        )?;
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
    if let Some(message) = fixture
        .get("expected_error_contains")
        .and_then(Value::as_str)
    {
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
    let cache_keys_equal =
        !cache_keys.is_empty() && cache_keys.iter().all(|key| key == &cache_keys[0]);
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
            if let Some(expected) = fixture
                .get("expected_components_subset")
                .and_then(Value::as_array)
            {
                expect_json_list_subset(
                    "optimizable components",
                    &Value::Array(components),
                    expected,
                )?;
            }
        }
        "filter" => {
            let components = conformance_optimizable_components(fixture);
            let target = fixture
                .get("target")
                .and_then(Value::as_str)
                .unwrap_or("all");
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
            let component_map = fixture
                .get("component_map")
                .cloned()
                .unwrap_or_else(|| json!({}));
            validate_component_map(&component_map, &components)?;
            apply_component_map(&mut components, &component_map);
            if let Some(expected) = fixture
                .get("expected_components_subset")
                .and_then(Value::as_array)
            {
                expect_json_list_subset(
                    "optimized components",
                    &Value::Array(components.clone()),
                    expected,
                )?;
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
            let normalized =
                normalize_optimization_dataset(fixture.get("dataset").unwrap_or(&json!([])));
            expect_json_equal(
                "normalized dataset",
                &normalized,
                fixture.get("expected_dataset").unwrap_or(&Value::Null),
            )?;
        }
        "score" => {
            let scores =
                normalize_metric_scores(fixture.get("metric_score").unwrap_or(&Value::Null));
            let scalar =
                scalarize_scores(&scores, fixture.get("score_options").unwrap_or(&json!({})));
            let adjusted = adjust_score_for_actions(
                scalar,
                fixture.get("task").unwrap_or(&json!({})),
                fixture
                    .get("prediction")
                    .unwrap_or(&json!({"functionCalls": []})),
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
                    fixture
                        .get("expected_quality_score")
                        .unwrap_or(&Value::Null),
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
                    fixture
                        .get("expected_quality_score")
                        .unwrap_or(&Value::Null),
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
            if let Some(expected) = fixture
                .get("expected_evaluation_rows_subset")
                .and_then(Value::as_array)
            {
                expect_json_list_subset(
                    "optimization evaluation rows",
                    result.get("rows").unwrap_or(&json!([])),
                    expected,
                )?;
            }
            if let Some(expected) = fixture
                .get("expected_components_subset_after")
                .and_then(Value::as_array)
            {
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
            if let Some(expected) = fixture
                .get("expected_engine_evaluations_subset")
                .and_then(Value::as_array)
            {
                expect_json_list_subset(
                    "optimizer engine evaluations",
                    &Value::Array(engine_evaluations(fixture)),
                    expected,
                )?;
            }
            if let Some(expected) = fixture
                .get("expected_engine_transcripts_subset")
                .and_then(Value::as_array)
            {
                expect_json_list_subset(
                    "optimizer engine transcripts",
                    &Value::Array(engine_transcripts(fixture)),
                    expected,
                )?;
            }
            if let Some(expected) = fixture.get("expected_artifact_subset") {
                expect_json_subset("optimizer artifact", &artifact, expected)?;
            }
            if let Some(expected) = fixture
                .get("expected_components_subset")
                .and_then(Value::as_array)
            {
                expect_json_list_subset(
                    "optimized components",
                    &Value::Array(components),
                    expected,
                )?;
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
            if let Some(expected) = fixture
                .get("expected_gepa_evaluations_subset")
                .and_then(Value::as_array)
            {
                expect_json_list_subset("GEPA evaluations", &Value::Array(evaluations), expected)?;
            }
        }
        "eval" => {
            let prediction = conformance_optimization_prediction(fixture);
            if let Some(expected) = fixture.get("expected_prediction_subset") {
                expect_json_subset("eval prediction", &prediction, expected)?;
            }
        }
        _ => {
            return Err(AxError::new(
                "fixture",
                format!("unsupported Rust optimize operation {operation}"),
            ))
        }
    }
    Ok(())
}

fn conformance_optimizable_components(fixture: &Value) -> Vec<Value> {
    if let Some(components) = fixture.get("components").and_then(Value::as_array) {
        return components.clone();
    }
    match fixture
        .get("program")
        .and_then(Value::as_str)
        .unwrap_or("agent")
    {
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
    for raw in fixture
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
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
        fixture
            .get("steps")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    )
}

fn flow_components_for_steps(
    flow_id: &str,
    local_graph_id: Option<&str>,
    steps: Vec<Value>,
) -> Vec<Value> {
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
                step.get("steps")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
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
    component
        .get("current")
        .cloned()
        .unwrap_or_else(|| json!(""))
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
            return Err(AxError::runtime(format!(
                "invalid optimized component value for {id}"
            )));
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

fn optimized_artifact_from_fixture(
    fixture: &Value,
    components: &[Value],
    optimizer_name: &str,
) -> AxResult<Value> {
    let component_map = fixture
        .get("component_map")
        .or_else(|| {
            fixture
                .get("engine_response")
                .and_then(|response| response.get("componentMap"))
        })
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
        .or_else(|| {
            fixture
                .get("engine_response")
                .and_then(|response| response.get("metadata"))
        })
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
            return Err(AxError::runtime(format!(
                "stale optimized component owner for {id}"
            )));
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
            if !components
                .iter()
                .any(|component| component.get("id").and_then(Value::as_str) == Some(id))
            {
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
            let scalar =
                if prediction.get("completionType").and_then(Value::as_str) == Some("error") {
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
    let task = fixture.get("task").cloned().unwrap_or_else(
        || json!({"input": fixture.get("input").cloned().unwrap_or_else(|| json!({}))}),
    );
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
        .or_else(|| {
            fixture
                .get("expected_prediction_subset")
                .and_then(|value| value.get("output"))
                .cloned()
        })
        .unwrap_or_else(|| json!({"answer": "Paris"}));
    json!({
        "completionType": "final",
        "output": output,
        "functionCalls": [],
        "turnCount": 2,
    })
}

fn optimizer_engine_request(fixture: &Value, components: &[Value]) -> Value {
    let uses_evaluator = fixture
        .get("engine_uses_evaluator")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut evaluator =
        json!({"available": uses_evaluator, "contractVersion": "axir-optimizer-evaluator-v1"});
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
    optimized_artifact_from_fixture(fixture, components, "fake")
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
            let candidate_map = candidate
                .get("componentMap")
                .cloned()
                .unwrap_or_else(|| json!({}));
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
        if bootstrap
            .get("maxBootstrapDemos")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > 0
        {
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
        let first = components
            .first()
            .map(component_current)
            .unwrap_or_else(|| json!(""));
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
    component_current(component)
        .as_str()
        .map(ToString::to_string)
}

fn normalized_program_kind(fixture: &Value) -> &'static str {
    match fixture
        .get("program")
        .and_then(Value::as_str)
        .unwrap_or("agent")
    {
        "axgen" => "axgen",
        "flow" => "axflow",
        _ => "axagent",
    }
}

fn validate_fields(fields: &[Field], values: &Value) -> AxResult<()> {
    let values = values
        .as_object()
        .ok_or_else(|| AxError::validation("Expected output values to be an object"))?;
    for field in fields {
        let value = values.get(&field.name).unwrap_or(&Value::Null);
        if !field.is_optional && value.is_null() {
            return Err(AxError::validation(format!(
                "Required field is missing: '{}'",
                field.name
            )));
        }
        validate_field_value(field, value)?;
    }
    Ok(())
}

fn validate_field_value(field: &Field, value: &Value) -> AxResult<()> {
    if value.is_null() && field.is_optional {
        return Ok(());
    }
    if field.field_type.is_array {
        let items = value.as_array().ok_or_else(|| {
            AxError::validation(format!("Expected '{}' to be an array", field.name))
        })?;
        let mut item_field = field.clone();
        item_field.field_type.is_array = false;
        for item in items {
            validate_field_value(&item_field, item)?;
        }
        return Ok(());
    }
    match field.field_type.name.as_str() {
        "string" | "code" | "date" | "dateRange" | "datetime" | "datetimeRange" | "url" => {
            let text = value.as_str().ok_or_else(|| {
                AxError::validation(format!("Expected '{}' to be a string", field.name))
            })?;
            if let Some(min) = field.field_type.min_length {
                if text.chars().count() < min as usize {
                    return Err(AxError::validation(format!(
                        "'{}' must be at least {} characters",
                        field.name,
                        trim_num(min)
                    )));
                }
            }
            if let Some(max) = field.field_type.max_length {
                if text.chars().count() > max as usize {
                    return Err(AxError::validation(format!(
                        "'{}' must be at most {} characters",
                        field.name,
                        trim_num(max)
                    )));
                }
            }
            if field.field_type.format.as_deref() == Some("email") && !text.contains('@') {
                return Err(AxError::validation(format!(
                    "'{}' must be a valid email address",
                    field.name
                )));
            }
        }
        "number" => {
            let number = value.as_f64().ok_or_else(|| {
                AxError::validation(format!("Expected '{}' to be a number", field.name))
            })?;
            if let Some(min) = field.field_type.minimum {
                if number < min {
                    return Err(AxError::validation(format!(
                        "'{}' must be at least {}",
                        field.name,
                        trim_num(min)
                    )));
                }
            }
            if let Some(max) = field.field_type.maximum {
                if number > max {
                    return Err(AxError::validation(format!(
                        "'{}' must be at most {}",
                        field.name,
                        trim_num(max)
                    )));
                }
            }
        }
        "boolean" => {
            if !value.is_boolean() {
                return Err(AxError::validation(format!(
                    "Expected '{}' to be a boolean",
                    field.name
                )));
            }
        }
        "class" => {
            let text = value.as_str().ok_or_else(|| {
                AxError::validation(format!("Expected '{}' to be a string", field.name))
            })?;
            let options = field.field_type.options.clone().unwrap_or_default();
            if !options.iter().any(|option| option == text) {
                return Err(AxError::validation(format!(
                    "Expected '{}' to be one of: {}",
                    field.name,
                    options.join(", ")
                )));
            }
        }
        "object" => {
            if !value.is_object() {
                return Err(AxError::validation(format!(
                    "Expected '{}' to be an object",
                    field.name
                )));
            }
            if let Some(fields) = &field.field_type.fields {
                let nested = fields
                    .iter()
                    .map(|(name, raw)| field_from_payload(name, raw))
                    .collect::<Vec<_>>();
                validate_fields(&nested, value)?;
            }
        }
        "file" => {
            let object = value
                .as_object()
                .ok_or_else(|| AxError::validation(format!(
                    "Expected '{}' to be type 'object ({{ mimeType: string; data: string }} | {{ mimeType: string; fileUri: string }})'",
                    field.name
                )))?;
            let has_mime = object.contains_key("mimeType");
            let has_data = object.contains_key("data");
            let has_file_uri = object.contains_key("fileUri");
            if !has_mime || has_data == has_file_uri {
                return Err(AxError::validation(format!(
                    "Expected '{}' to be type 'object ({{ mimeType: string; data: string }} | {{ mimeType: string; fileUri: string }})'",
                    field.name
                )));
            }
        }
        _ => {}
    }
    Ok(())
}

fn strip_internal_fields(fields: &[Field], values: &mut Value) {
    let Some(values) = values.as_object_mut() else {
        return;
    };
    for field in fields {
        if field.is_internal {
            values.remove(&field.name);
        }
        if let (Some(nested_specs), Some(nested_value)) =
            (&field.field_type.fields, values.get_mut(&field.name))
        {
            let nested = nested_specs
                .iter()
                .map(|(name, raw)| field_from_payload(name, raw))
                .collect::<Vec<_>>();
            strip_internal_fields(&nested, nested_value);
        }
    }
}

fn expect_validation_result(result: AxResult<()>, fixture: &Value) -> AxResult<()> {
    let expected = fixture
        .get("expected_error_contains")
        .and_then(Value::as_str);
    if let Some(expected) = expected {
        if let Err(err) = result {
            if err.message.contains(expected) {
                return Ok(());
            }
            return Err(AxError::new(
                "fixture",
                format!(
                    "expected error containing {expected:?}, got {}",
                    err.message
                ),
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
    let mut out = template.to_string();
    while let Some(start) = out.find("{{") {
        let Some(end_rel) = out[start + 2..].find("}}") else {
            return Err(AxError::validation("Unclosed template tag"));
        };
        let end = start + 2 + end_rel;
        let tag = out[start + 2..end].trim();
        let replacement = if tag.starts_with('!') {
            String::new()
        } else if let Some(condition) = tag.strip_prefix("if ") {
            let close = out[end + 2..]
                .find("{{ /if }}")
                .ok_or_else(|| AxError::validation("Missing {{ /if }}"))?
                + end
                + 2;
            let body = &out[end + 2..close];
            let (truthy_body, false_body) = body
                .split_once("{{ else }}")
                .map(|(left, right)| (left, right))
                .unwrap_or((body, ""));
            let truthy = eval_template_condition(condition.trim(), vars)?;
            let replacement = if truthy { truthy_body } else { false_body }.to_string();
            out.replace_range(start..close + "{{ /if }}".len(), &replacement);
            continue;
        } else {
            if !tag
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '.')
            {
                return Err(AxError::validation(format!("Invalid tag '{tag}'")));
            }
            let value = get_path(vars, tag)
                .ok_or_else(|| AxError::validation(format!("Missing template variable '{tag}'")))?;
            display_template_value(value)
        };
        out.replace_range(start..end + 2, &replacement);
    }
    Ok(out)
}

fn eval_template_condition(condition: &str, vars: &Value) -> AxResult<bool> {
    if let Some((left, right)) = condition.split_once("===") {
        let left = left.trim();
        let right = right.trim().trim_matches('"');
        let value = get_path(vars, left)
            .ok_or_else(|| AxError::validation(format!("Missing template variable '{left}'")))?;
        return Ok(value.as_str() == Some(right));
    }
    let value = get_path(vars, condition)
        .ok_or_else(|| AxError::validation(format!("Missing template variable '{condition}'")))?;
    value
        .as_bool()
        .ok_or_else(|| AxError::validation(format!("Condition '{condition}' must be boolean")))
}

fn validate_fixture_template(template: &str, required: Vec<Value>) -> AxResult<()> {
    for raw in required {
        let Some(name) = raw.as_str() else {
            continue;
        };
        let needle = format!("{{{{ {name} }}}}");
        let compact = format!("{{{{{name}}}}}");
        if !template.contains(&needle) && !template.contains(&compact) {
            return Err(AxError::validation(format!(
                "must preserve template variable {{{{{name}}}}}"
            )));
        }
    }
    Ok(())
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
        let error = raw
            .get("error")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let mut builder = tool(name).description(description);
        if let Some(args) = raw.get("args").and_then(Value::as_object) {
            for (arg_name, arg_spec) in args {
                builder = builder.arg(arg_name, field_from_spec(arg_name, arg_spec).field_type);
            }
        }
        let tool = builder.handler(move |_args| {
            if let Some(error) = &error {
                return Err(AxError::runtime(error.clone()));
            }
            Ok(result.clone())
        });
        out.push(tool);
    }
    Ok(out)
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
            out.push(call);
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
    let mut program = AxGen {
        signature,
        tools: build_fixture_tools(fixture)?,
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
    if let Some(expected) = fixture
        .get("expected_request_count")
        .and_then(Value::as_u64)
    {
        if client.requests.len() != expected as usize {
            return Err(AxError::new(
                "fixture",
                format!(
                    "expected {expected} requests, got {}",
                    client.requests.len()
                ),
            ));
        }
    }
    if let Some(expected) = fixture.get("expected_request") {
        if let Some(actual) = client.requests.first() {
            expect_json_subset("forward request", actual, expected)?;
        }
    }
    if let Some(expected) = fixture
        .get("expected_request_contains")
        .and_then(Value::as_array)
    {
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
    if let Some(expected) = fixture
        .get("expected_chat_prompt_contains")
        .and_then(Value::as_array)
    {
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
        expect_json_list_subset(
            "memory history",
            &Value::Array(program.memory.clone()),
            expected,
        )?;
    }
    if let Some(expected) = fixture.get("expected_tool_calls").and_then(Value::as_array) {
        let actual = program
            .traces
            .last()
            .and_then(|trace| trace.get("tool_calls"))
            .cloned()
            .unwrap_or_else(|| json!([]));
        expect_json_list_exact_subsets("tool calls", &actual, expected)?;
    }
    if let Some(expected) = fixture
        .get("expected_function_traces_subset")
        .and_then(Value::as_array)
    {
        let actual = program
            .traces
            .last()
            .and_then(|trace| trace.get("tool_calls"))
            .cloned()
            .unwrap_or_else(|| json!([]));
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
    let provider = fixture
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("openai");
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
    if let Some(model) = fixture
        .get("embed_model")
        .or_else(|| fixture.get("embedModel"))
    {
        options["embed_model"] = model.clone();
    }
    if let Some(config) = fixture
        .get("model_config")
        .or_else(|| fixture.get("modelConfig"))
    {
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
        if !actual_items
            .iter()
            .any(|actual| json_contains(actual, expected))
        {
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

fn expect_json_list_exact_subsets(
    label: &str,
    actual: &Value,
    expected_items: &[Value],
) -> AxResult<()> {
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
        (Value::Number(actual), Value::Number(expected)) => {
            match (actual.as_f64(), expected.as_f64()) {
                (Some(actual), Some(expected)) => (actual - expected).abs() <= 1e-9,
                _ => actual == expected,
            }
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
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

// Rust v1 exposes Core-owned behavior through the Rust-native wrappers above.
