from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
import copy
import re
from typing import Any


class AxSignatureError(ValueError):
    pass


VALID_FIELD_TYPES = {
    "audio",
    "boolean",
    "class",
    "code",
    "date",
    "dateRange",
    "datetime",
    "datetimeRange",
    "file",
    "image",
    "json",
    "number",
    "object",
    "string",
    "url",
}


@dataclass
class FieldType:
    name: str = "string"
    is_array: bool = False
    options: list[str] | None = None
    fields: dict[str, Any] | None = None
    min_length: int | None = None
    max_length: int | None = None
    minimum: float | None = None
    maximum: float | None = None
    pattern: str | None = None
    pattern_description: str | None = None
    format: str | None = None
    description: str | None = None


@dataclass
class Field:
    name: str
    type: FieldType = dataclass_field(default_factory=FieldType)
    description: str | None = None
    title: str | None = None
    is_optional: bool = False
    is_internal: bool = False
    is_cached: bool = False

    def __post_init__(self):
        if self.title is None:
            self.title = _title(self.name)


class FluentField:
    def __init__(self, type_name: str, description: str | None = None, *, fields: dict[str, "FluentField"] | None = None):
        nested_fields = None
        if fields:
            nested_fields = {}
            for key, value in fields.items():
                nested = value.to_field(key)
                if nested.description is not None and nested.type.description is None:
                    nested.type.description = nested.description
                nested_fields[key] = nested
        self.type = FieldType(
            type_name,
            fields=nested_fields,
        )
        self.description = description
        self.item_description = description
        self.is_optional = False
        self.is_internal = False
        self.is_cached = False

    def optional(self):
        clone = self._clone()
        clone.is_optional = True
        return clone

    def internal(self):
        clone = self._clone()
        clone.is_internal = True
        return clone

    def cache(self):
        clone = self._clone()
        clone.is_cached = True
        return clone

    def array(self, description: str | None = None):
        clone = self._clone()
        clone.type.is_array = True
        if clone.item_description is not None and clone.type.description is None:
            clone.type.description = clone.item_description
        if description is not None:
            clone.description = description
        return clone

    def min(self, value: int | float):
        clone = self._clone()
        if clone.type.name == "number":
            clone.type.minimum = value
        else:
            clone.type.min_length = int(value)
        return clone

    def max(self, value: int | float):
        clone = self._clone()
        if clone.type.name == "number":
            clone.type.maximum = value
        else:
            clone.type.max_length = int(value)
        return clone

    def regex(self, pattern: str, description: str):
        if not description:
            raise AxSignatureError("regex() requires a pattern description")
        clone = self._clone()
        clone.type.pattern = pattern
        clone.type.pattern_description = description
        return clone

    def email(self):
        clone = self._clone()
        clone.type.format = "email"
        return clone

    def url(self):
        clone = self._clone()
        clone.type.format = "uri"
        return clone

    def to_field(self, name: str) -> Field:
        return Field(
            name=name,
            type=self.to_type(),
            description=self.description,
            is_optional=self.is_optional,
            is_internal=self.is_internal,
            is_cached=self.is_cached,
        )

    def to_type(self) -> FieldType:
        return copy.deepcopy(self.type)

    def _clone(self):
        cloned = FluentField(self.type.name, self.description)
        cloned.type = self.to_type()
        cloned.item_description = self.item_description
        cloned.is_optional = self.is_optional
        cloned.is_internal = self.is_internal
        cloned.is_cached = self.is_cached
        return cloned


class SignatureBuilder:
    def __init__(self):
        self.inputs: list[Field] = []
        self.outputs: list[Field] = []
        self.desc: str | None = None
        self.force_structured = False

    def input(self, name: str, field_info: FluentField, prepend: bool = False):
        item = field_info.to_field(name)
        if prepend:
            self.inputs.insert(0, item)
        else:
            self.inputs.append(item)
        return self

    def output(self, name: str, field_info: FluentField, prepend: bool = False):
        item = field_info.to_field(name)
        if prepend:
            self.outputs.insert(0, item)
        else:
            self.outputs.append(item)
        return self

    def description(self, text: str):
        self.desc = text
        return self

    def use_structured(self):
        self.force_structured = True
        return self

    def build(self):
        sig = AxSignature(inputs=self.inputs, outputs=self.outputs, description=self.desc)
        sig.force_structured = self.force_structured
        return sig


class FluentFactory:
    def __call__(self):
        return SignatureBuilder()

    def string(self, description: str | None = None): return FluentField("string", description)
    def number(self, description: str | None = None): return FluentField("number", description)
    def boolean(self, description: str | None = None): return FluentField("boolean", description)
    def json(self, description: str | None = None): return FluentField("json", description)
    def object(self, fields: dict[str, FluentField] | None = None, description: str | None = None): return FluentField("object", description, fields=fields)
    def date(self, description: str | None = None): return FluentField("date", description)
    def datetime(self, description: str | None = None): return FluentField("datetime", description)
    def date_range(self, description: str | None = None): return FluentField("dateRange", description)
    def datetime_range(self, description: str | None = None): return FluentField("datetimeRange", description)
    def image(self, description: str | None = None): return FluentField("image", description)
    def audio(self, description: str | None = None): return FluentField("audio", description)
    def file(self, description: str | None = None): return FluentField("file", description)
    def url(self, description: str | None = None): return FluentField("url", description)
    def code(self, description: str | None = None): return FluentField("code", description)
    def classification(self, options: list[str], description: str | None = None):
        if not options:
            raise AxSignatureError("classification() requires at least one option")
        item = FluentField("class", description)
        item.type.options = list(options)
        return item


f = FluentFactory()


class AxSignature:
    def __init__(self, signature: str | None = None, *, inputs: list[Field] | None = None, outputs: list[Field] | None = None, description: str | None = None):
        self.description = description
        self.input_fields = list(inputs or [])
        self.output_fields = list(outputs or [])
        self.force_structured = False
        if signature is not None:
            parsed = parse_signature(signature)
            self.description = parsed.description
            self.input_fields = parsed.input_fields
            self.output_fields = parsed.output_fields
        self.validate()

    @classmethod
    def create(cls, signature: str):
        return cls(signature)

    def get_input_fields(self): return list(self.input_fields)
    def get_output_fields(self): return list(self.output_fields)
    def get_description(self): return self.description

    def has_complex_fields(self) -> bool:
        return self.force_structured or any(field.type.name == "object" or field.type.fields for field in self.output_fields)

    def to_json_schema(self, target: str = "outputs", options: dict[str, Any] | None = None):
        from .schema import to_json_schema
        fields = self.input_fields if target == "inputs" else self.output_fields
        return to_json_schema(fields, options=options)

    def toJSONSchema(self, target: str = "outputs", options: dict[str, Any] | None = None):
        return self.to_json_schema(target, options)

    def validate(self):
        validate_signature(self)
        return True

    def __str__(self):
        return ", ".join(_render_field(f) for f in self.input_fields) + " -> " + ", ".join(_render_field(f) for f in self.output_fields)


def s(signature: str) -> AxSignature:
    return AxSignature.create(signature)


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_truthy(value): return bool(value)
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_lt(left, right): return left < right
def _core_gt(left, right): return left > right
def _core_add(left, right): return left + right
def _core_len(value): return len(value)
def _core_contains(container, item): return False if container is None else item in container
def _core_truthy(value): return bool(value)
def _core_is_none(value): return value is None
def _core_none(): return None


def _core_signature_error(message):
    return AxSignatureError(message)


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(pattern, value) is not None


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_slice(value, start, end=None):
    return str(value)[start:] if end is None else str(value)[start:end]


def _core_string_replace(value, old, new):
    return str(value).replace(str(old), str(new))


def _core_string_remove_suffix(value, suffix):
    text = str(value)
    suffix = str(suffix)
    if suffix and text.endswith(suffix):
        return {"value": text[:-len(suffix)], "removed": True}
    return {"value": text, "removed": False}


def _core_string_words(value):
    return str(value).split()


def _core_string_default_if_empty(value, fallback):
    text = str(value).strip()
    return fallback if text == "" else text


def _core_string_split_once(value, sep):
    text = str(value)
    if sep in text:
        left, right = text.split(sep, 1)
        return {"left": left, "right": right, "found": True}
    return {"left": text, "right": "", "found": False}


def _core_string_split_trim_nonempty(value, sep):
    return [part.strip() for part in str(value).split(str(sep)) if part.strip()]


def _core_string_find_outside_quotes(text, needle):
    quote = None
    escaped = False
    text = str(text)
    for i, ch in enumerate(text):
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
            continue
        if text.startswith(str(needle), i):
            return i
    if quote:
        raise AxSignatureError("Unterminated string")
    return -1


def _core_string_split_outside_quotes(text, sep):
    items, current, quote, escaped = [], [], None, False
    for ch in str(text):
        if escaped:
            current.append(ch)
            escaped = False
            continue
        if ch == "\\":
            current.append(ch)
            escaped = True
            continue
        if quote:
            current.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            current.append(ch)
            quote = ch
            continue
        if ch == sep:
            item = "".join(current).strip()
            if item:
                items.append(item)
            current = []
            continue
        current.append(ch)
    if quote:
        raise AxSignatureError("Unterminated string")
    item = "".join(current).strip()
    if item:
        items.append(item)
    return items


def _core_consume_quoted_prefix(text):
    if not text or text[0] not in ("'", '"'):
        return {"value": None, "rest": text, "found": False}
    quote, escaped, out = text[0], False, []
    for i, ch in enumerate(text[1:], start=1):
        if escaped:
            out.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == quote:
            return {"value": "".join(out), "rest": text[i + 1 :], "found": True}
        else:
            out.append(ch)
    raise AxSignatureError("Unterminated string")


def _core_string_consume_optional_quoted_prefix(text):
    return _core_consume_quoted_prefix(str(text))


def _core_string_extract_quoted_suffix(text):
    text = str(text)
    escaped = False
    for i, ch in enumerate(text):
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch in ("'", '"'):
            consumed = _core_consume_quoted_prefix(text[i:])
            return {
                "value": consumed["value"],
                "index": i,
                "rest": consumed["rest"],
                "head": text[:i],
                "found": True,
            }
    return {"value": None, "index": None, "rest": "", "head": text, "found": False}


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_record_new(name, values):
    values = values or {}
    if name == "FieldType":
        return FieldType(
            name=values.get("name", "string"),
            is_array=bool(values.get("is_array", values.get("isArray", False))),
            options=values.get("options"),
            fields=values.get("fields"),
        )
    if name == "Field":
        return Field(
            name=values["name"],
            type=values.get("type") or FieldType(),
            description=values.get("description"),
            title=values.get("title"),
            is_optional=bool(values.get("is_optional", values.get("isOptional", False))),
            is_internal=bool(values.get("is_internal", values.get("isInternal", False))),
            is_cached=bool(values.get("is_cached", values.get("isCached", False))),
        )
    if name == "AxSignature":
        return AxSignature(
            inputs=values.get("inputs") or [],
            outputs=values.get("outputs") or [],
            description=values.get("description"),
        )
    raise AxSignatureError(f"Unknown record type: {name}")


def _core_fields_from_map(fields):
    if not fields:
        return []
    return [item if isinstance(item, Field) else Field(name=name, type=item) for name, item in fields.items()]


def _title(name: str) -> str:
    out = []
    for i, ch in enumerate(name.replace("_", " ")):
        if i > 0 and (ch.isupper() or ch.isdigit()):
            out.append(" ")
        out.append(ch)
    text = "".join(out).strip()
    return text[:1].upper() + text[1:]


def _render_field(field: Field) -> str:
    marker = ("?" if field.is_optional else "") + ("!" if field.is_internal else "")
    typ = field.type.name + ("[]" if field.type.is_array else "")
    return f"{field.name}{marker}:{typ}"


# BEGIN AXIR CORE EMITTED FUNCTIONS
def parse_signature(signature: str) -> AxSignature:
    parsed = _signature_parse_impl(signature)
    return parsed


def validate_signature(signature: AxSignature) -> None:
    _signature_validate_impl(signature)
    return None


def _signature_parse_impl(signature: str) -> AxSignature:
    text = str(signature).strip()
    text_len = _core_len(text)
    is_empty = _core_eq(text_len, 0)
    if is_empty:
        error = _core_signature_error("Empty signature provided")
        raise error
    else:
        pass
    prefix = _core_string_consume_optional_quoted_prefix(text)
    description = _core_get(prefix, "value", None)
    rest = _core_get(prefix, "rest", None)
    body = str(rest).strip()
    arrow = _core_string_find_outside_quotes(body, "->")
    missing_arrow = _core_lt(arrow, 0)
    if missing_arrow:
        error = _core_signature_error("Expected \"->\"")
        raise error
    else:
        pass
    left_raw = _core_string_slice(body, 0, arrow)
    left = str(left_raw).strip()
    right_start = _core_add(arrow, 2)
    right_raw = _core_string_slice(body, right_start)
    right = str(right_raw).strip()
    left_len = _core_len(left)
    left_empty = _core_eq(left_len, 0)
    if left_empty:
        error = _core_signature_error("No input fields specified")
        raise error
    else:
        pass
    right_len = _core_len(right)
    right_empty = _core_eq(right_len, 0)
    if right_empty:
        error = _core_signature_error("No output fields specified")
        raise error
    else:
        pass
    inputs = _signature_parse_fields_impl(left, False)
    outputs = _signature_parse_fields_impl(right, True)
    attrs = {}
    attrs["inputs"] = inputs
    attrs["outputs"] = outputs
    attrs["description"] = description
    parsed = _core_record_new("AxSignature", attrs)
    return parsed


def _signature_parse_fields_impl(text: str, output: bool) -> list[Any]:
    parts = _core_string_split_outside_quotes(text, ",")
    fields = []
    for part in parts:
        field = _signature_parse_field_impl(part, output)
        fields.append(field)
    return fields


def _signature_parse_field_impl(raw: str, output: bool) -> Field:
    text = str(raw).strip()
    quoted_info = _core_string_extract_quoted_suffix(text)
    quoted = _core_get(quoted_info, "value", None)
    rest_after_quote = _core_get(quoted_info, "rest", None)
    rest_after_quote_trimmed = str(rest_after_quote).strip()
    has_extra = _core_truthy(rest_after_quote_trimmed)
    if has_extra:
        error = _core_signature_error("Unexpected content after signature")
        raise error
    else:
        pass
    head_raw = _core_get(quoted_info, "head", None)
    head = str(head_raw).strip()
    head_parts = _core_string_split_once(head, ":")
    name_part_raw = _core_get(head_parts, "left", None)
    type_part_raw = _core_get(head_parts, "right", None)
    name_part = str(name_part_raw).strip()
    type_part_trimmed = str(type_part_raw).strip()
    type_part = _core_string_default_if_empty(type_part_trimmed, "string")
    is_optional = _core_contains(name_part, "?")
    is_internal = _core_contains(name_part, "!")
    name_without_optional = _core_string_replace(name_part, "?", "")
    name_without_markers = _core_string_replace(name_without_optional, "!", "")
    name = str(name_without_markers).strip()
    type_words = _core_string_words(type_part)
    type_word_count = _core_len(type_words)
    extra_type_tokens = _core_gt(type_word_count, 1)
    if extra_type_tokens:
        error = _core_signature_error("Unexpected content after signature")
        raise error
    else:
        pass
    type_token = _core_list_get(type_words, 0, "string")
    array_info = _core_string_remove_suffix(type_token, "[]")
    type_name_raw = _core_get(array_info, "value", None)
    type_name = _core_string_default_if_empty(type_name_raw, "string")
    is_array = _core_get(array_info, "removed", None)
    is_class = _core_eq(type_name, "class")
    if is_class:
        class_input = _core_not(output)
        if class_input:
            error = _core_signature_error("Input field cannot use the \"class\" type")
            raise error
        else:
            pass
        missing_quoted = _core_is_none(quoted)
        if missing_quoted:
            error = _core_signature_error("Missing class options after \"class\" type")
            raise error
        else:
            pass
        class_option_text = _core_string_replace(quoted, "|", ",")
        options = _core_string_split_trim_nonempty(class_option_text, ",")
        option_count = _core_len(options)
        empty_options = _core_eq(option_count, 0)
        if empty_options:
            error = _core_signature_error("Missing class options after \"class\" type")
            raise error
        else:
            pass
        type_attrs = {}
        type_attrs["name"] = type_name
        type_attrs["is_array"] = is_array
        type_attrs["options"] = options
        field_type = _core_record_new("FieldType", type_attrs)
        none = _core_none()
        field_attrs = {}
        field_attrs["name"] = name
        field_attrs["type"] = field_type
        field_attrs["description"] = none
        field_attrs["is_optional"] = is_optional
        field_attrs["is_internal"] = is_internal
        field = _core_record_new("Field", field_attrs)
        _signature_validate_field_shape_impl(field, output, False)
        return field
    else:
        pass
    type_attrs = {}
    type_attrs["name"] = type_name
    type_attrs["is_array"] = is_array
    field_type = _core_record_new("FieldType", type_attrs)
    field_attrs = {}
    field_attrs["name"] = name
    field_attrs["type"] = field_type
    field_attrs["description"] = quoted
    field_attrs["is_optional"] = is_optional
    field_attrs["is_internal"] = is_internal
    field = _core_record_new("Field", field_attrs)
    _signature_validate_field_shape_impl(field, output, False)
    return field


def _signature_validate_field_shape_impl(field: Field, output: bool, nested: bool) -> None:
    name = _core_get(field, "name", None)
    valid_name = _core_regex_match("^[A-Za-z_][A-Za-z0-9_]*$", name)
    invalid_name = _core_not(valid_name)
    if invalid_name:
        starts_number = _core_regex_match("^[0-9]", name)
        if starts_number:
            message = _core_string_format("Field name \"{}\" cannot start with a number", name)
            error = _core_signature_error(message)
            raise error
        else:
            message = _core_string_format("Invalid field name: \"{}\"", name)
            error = _core_signature_error(message)
            raise error
    else:
        pass
    typ = _core_get(field, "type", None)
    type_name = _core_get(typ, "name", None)
    valid_types = []
    valid_types.append("audio")
    valid_types.append("boolean")
    valid_types.append("class")
    valid_types.append("code")
    valid_types.append("date")
    valid_types.append("dateRange")
    valid_types.append("datetime")
    valid_types.append("datetimeRange")
    valid_types.append("file")
    valid_types.append("image")
    valid_types.append("json")
    valid_types.append("number")
    valid_types.append("object")
    valid_types.append("string")
    valid_types.append("url")
    known_type = _core_contains(valid_types, type_name)
    unknown_type = _core_not(known_type)
    if unknown_type:
        message = _core_string_format("Invalid type \"{}\"", type_name)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    media_types = []
    media_types.append("image")
    media_types.append("audio")
    media_types.append("file")
    is_media = _core_contains(media_types, type_name)
    nested_media = _core_and(nested, is_media)
    if nested_media:
        message = _core_string_format("Media type '{}' is not allowed in nested object fields", type_name)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    is_class = _core_eq(type_name, "class")
    is_input = _core_not(output)
    input_class = _core_and(is_class, is_input)
    if input_class:
        error = _core_signature_error("Input field cannot use the \"class\" type")
        raise error
    else:
        pass
    class_options = _core_get(typ, "options", None)
    has_class_options = _core_truthy(class_options)
    missing_class_options = _core_not(has_class_options)
    class_without_options = _core_and(is_class, missing_class_options)
    if class_without_options:
        error = _core_signature_error("Missing class options after \"class\" type")
        raise error
    else:
        pass
    is_internal = _core_get(field, "is_internal", False)
    internal_input = _core_and(is_internal, is_input)
    if internal_input:
        error = _core_signature_error("Input field cannot use the internal marker")
        raise error
    else:
        pass
    is_image = _core_eq(type_name, "image")
    output_image = _core_and(output, is_image)
    if output_image:
        error = _core_signature_error("Image type is not supported in output fields")
        raise error
    else:
        pass
    is_file = _core_eq(type_name, "file")
    output_file = _core_and(output, is_file)
    if output_file:
        error = _core_signature_error("File type is not supported in output fields")
        raise error
    else:
        pass
    is_audio = _core_eq(type_name, "audio")
    is_array = _core_get(typ, "is_array", False)
    output_audio = _core_and(output, is_audio)
    output_audio_array = _core_and(output_audio, is_array)
    if output_audio_array:
        error = _core_signature_error("Arrays of audio are not supported in output fields")
        raise error
    else:
        pass
    nested_map = _core_get(typ, "fields", None)
    has_nested = _core_truthy(nested_map)
    if has_nested:
        nested_fields = _core_fields_from_map(nested_map)
        for nested_field in nested_fields:
            _signature_validate_field_shape_impl(nested_field, output, True)
    else:
        pass
    return None


def _signature_validate_impl(signature: AxSignature) -> None:
    inputs = _core_get(signature, "input_fields", None)
    outputs = _core_get(signature, "output_fields", None)
    input_count = _core_len(inputs)
    no_inputs = _core_eq(input_count, 0)
    if no_inputs:
        error = _core_signature_error("No input fields specified")
        raise error
    else:
        pass
    output_count = _core_len(outputs)
    no_outputs = _core_eq(output_count, 0)
    if no_outputs:
        error = _core_signature_error("No output fields specified")
        raise error
    else:
        pass
    seen_inputs = []
    for field in inputs:
        _signature_validate_field_shape_impl(field, False, False)
        field_name = _core_get(field, "name", None)
        duplicate = _core_contains(seen_inputs, field_name)
        if duplicate:
            message = _core_string_format("Duplicate input field name: \"{}\"", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        seen_inputs.append(field_name)
    seen_outputs = []
    for field in outputs:
        _signature_validate_field_shape_impl(field, True, False)
        field_name = _core_get(field, "name", None)
        collision = _core_contains(seen_inputs, field_name)
        if collision:
            message = _core_string_format("Field name \"{}\" appears in both inputs and outputs", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        duplicate = _core_contains(seen_outputs, field_name)
        if duplicate:
            message = _core_string_format("Duplicate output field name: \"{}\"", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        seen_outputs.append(field_name)
    return None

# END AXIR CORE EMITTED FUNCTIONS
