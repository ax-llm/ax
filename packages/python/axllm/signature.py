from __future__ import annotations
import os

from dataclasses import dataclass, field as dataclass_field
import copy
import json
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
    language: str | None = None
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
        return signature_to_string(self)


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
def _core_is_not_none(value): return value is not None
def _core_none(): return None
def _core_coalesce(value, fallback): return fallback if value is None else value


def _core_signature_error(message):
    return AxSignatureError(message)


def _core_coverage_mark(name):
    path = os.environ.get("AXIR_COVERAGE_FILE")
    if not path or name in _CORE_COVERAGE_SEEN:
        return
    _CORE_COVERAGE_SEEN.add(name)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(name + "\n")


_CORE_COVERAGE_SEEN: set[str] = set()


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_map_merge(left, right):
    merged = dict(left or {})
    merged.update(right or {})
    return merged


def _core_map_contains(values, key):
    return isinstance(values, dict) and key in values


def _core_json_parse(value):
    return json.loads(str(value))


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(pattern, value) is not None


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in values)


def _core_string_starts_with(value, prefix):
    return isinstance(value, str) and value.startswith(str(prefix))


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


def _core_string_split_top_level(text, sep):
    text, sep = str(text), str(sep)
    items, current = [], []
    quote, escaped, paren_depth, brace_depth = None, False, 0, 0
    index = 0
    while index < len(text):
        ch = text[index]
        if escaped:
            current.append(ch)
            escaped = False
            index += 1
            continue
        if ch == "\\":
            current.append(ch)
            escaped = True
            index += 1
            continue
        if quote:
            current.append(ch)
            if ch == quote:
                quote = None
            index += 1
            continue
        if ch in ("'", '"'):
            current.append(ch)
            quote = ch
            index += 1
            continue
        if ch == "(":
            paren_depth += 1
        elif ch == ")" and paren_depth > 0:
            paren_depth -= 1
        elif ch == "{":
            brace_depth += 1
        elif ch == "}" and brace_depth > 0:
            brace_depth -= 1
        if sep and paren_depth == 0 and brace_depth == 0 and text.startswith(sep, index):
            items.append("".join(current).strip())
            current = []
            index += len(sep)
            continue
        current.append(ch)
        index += 1
    if quote:
        raise AxSignatureError("Unterminated string")
    items.append("".join(current).strip())
    return items


def _core_string_extract_leading_group(text, open_char, close_char):
    text, open_char, close_char = str(text), str(open_char), str(close_char)
    if not open_char or not close_char or not text.startswith(open_char):
        return {"found": False, "balanced": True, "group": "", "rest": text}
    quote, escaped, depth = None, False, 0
    index = 0
    while index < len(text):
        ch = text[index]
        if escaped:
            escaped = False
        elif ch == "\\":
            escaped = True
        elif quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        elif text.startswith(open_char, index):
            depth += 1
            index += len(open_char) - 1
        elif text.startswith(close_char, index):
            depth -= 1
            if depth == 0:
                start = len(open_char)
                return {
                    "found": True,
                    "balanced": True,
                    "group": text[start:index],
                    "rest": text[index + len(close_char):],
                }
            index += len(close_char) - 1
        index += 1
    if quote:
        raise AxSignatureError("Unterminated string")
    return {"found": True, "balanced": False, "group": text[len(open_char):], "rest": ""}


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
            min_length=values.get("min_length", values.get("minLength")),
            max_length=values.get("max_length", values.get("maxLength")),
            minimum=values.get("minimum"),
            maximum=values.get("maximum"),
            pattern=values.get("pattern"),
            pattern_description=values.get("pattern_description", values.get("patternDescription")),
            format=values.get("format"),
            language=values.get("language"),
            description=values.get("description"),
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


# BEGIN AXIR CORE EMITTED FUNCTIONS
def parse_signature(signature: str) -> AxSignature:
    _core_coverage_mark("parse_signature")
    parsed = _signature_parse_impl(signature)
    return parsed


def validate_signature(signature: AxSignature) -> None:
    _core_coverage_mark("validate_signature")
    _signature_validate_impl(signature)
    return None


def _signature_input_fields(signature: AxSignature) -> list[Any]:
    _core_coverage_mark("_signature_input_fields")
    fields = _core_get(signature, "input_fields", None)
    out = []
    for field in fields:
        type = _core_get(field, "type", None)
        type_out = {}
        type_name = _core_get(type, "name", "")
        type_out["name"] = type_name
        empty_options = []
        type_options = _core_get(type, "options", empty_options)
        type_out["options"] = type_options
        item = {}
        field_name = _core_get(field, "name", "")
        field_optional = _core_get(field, "is_optional", False)
        item["name"] = field_name
        item["isOptional"] = field_optional
        item["type"] = type_out
        out.append(item)
    return out


def _signature_output_fields(signature: AxSignature) -> list[Any]:
    _core_coverage_mark("_signature_output_fields")
    fields = _core_get(signature, "output_fields", None)
    out = []
    for field in fields:
        type = _core_get(field, "type", None)
        type_out = {}
        type_name = _core_get(type, "name", "")
        type_out["name"] = type_name
        empty_options = []
        type_options = _core_get(type, "options", empty_options)
        type_out["options"] = type_options
        item = {}
        field_name = _core_get(field, "name", "")
        field_optional = _core_get(field, "is_optional", False)
        item["name"] = field_name
        item["isOptional"] = field_optional
        item["type"] = type_out
        out.append(item)
    return out


def _signature_parse_impl(signature: str) -> AxSignature:
    _core_coverage_mark("_signature_parse_impl")
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
        open_brace = _core_string_find_outside_quotes(body, "{")
        brace_missing = _core_lt(open_brace, 0)
        has_open_brace = _core_not(brace_missing)
        if has_open_brace:
            error = _core_signature_error("unbalanced \"{\" in object type")
            raise error
        else:
            pass
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
    _core_coverage_mark("_signature_parse_fields_impl")
    parts = _core_string_split_top_level(text, ",")
    fields = []
    for part in parts:
        trimmed = str(part).strip()
        empty = _core_eq(trimmed, "")
        if empty:
            error = _core_signature_error("Unexpected content after signature")
            raise error
        else:
            pass
        field = _signature_parse_field_impl(part, output)
        fields.append(field)
    return fields


def _signature_parse_field_impl(raw: str, output: bool) -> Field:
    _core_coverage_mark("_signature_parse_field_impl")
    field = _signature_parse_field_common_impl(raw, output, False, "")
    return field


def _signature_parse_field_common_impl(raw: str, output: bool, nested: bool, parent: str) -> Field:
    _core_coverage_mark("_signature_parse_field_common_impl")
    text = str(raw).strip()
    head_parts = _core_string_split_once(text, ":")
    has_type = _core_get(head_parts, "found", False)
    name_part_raw = _core_get(head_parts, "left", None)
    type_part_raw = _core_get(head_parts, "right", None)
    state = {}
    state["name_part"] = name_part_raw
    none = _core_none()
    state["description"] = none
    state["is_cached"] = False
    default_type_attrs = {}
    default_type_attrs["name"] = "string"
    default_type_attrs["is_array"] = False
    default_type = _core_record_new("FieldType", default_type_attrs)
    state["type"] = default_type
    if has_type:
        section_state = {}
        section_state["value"] = "input"
        if output:
            section_state["value"] = "output"
        else:
            pass
        if nested:
            section_state["value"] = "nested"
        else:
            pass
        section = _core_get(section_state, "value", None)
        name_for_error = str(name_part_raw).strip()
        if nested:
            name_for_error = _core_string_format("{}.{}", parent, name_for_error)
        else:
            pass
        parsed_type = _signature_parse_type_expr_impl(type_part_raw, section, name_for_error)
        parsed_field_type = _core_get(parsed_type, "type", None)
        parsed_cached = _core_get(parsed_type, "is_cached", False)
        state["type"] = parsed_field_type
        state["is_cached"] = parsed_cached
        language = _core_get(parsed_field_type, "language", None)
        parsed_rest = _core_get(parsed_type, "rest", None)
        description = _signature_parse_description_impl(parsed_rest, language)
        state["description"] = description
    else:
        quoted_info = _core_string_extract_quoted_suffix(name_part_raw)
        quoted = _core_get(quoted_info, "value", None)
        rest_after_quote_raw = _core_get(quoted_info, "rest", None)
        rest_after_quote = str(rest_after_quote_raw).strip()
        has_extra = _core_truthy(rest_after_quote)
        if has_extra:
            error = _core_signature_error("Unexpected content after signature")
            raise error
        else:
            pass
        quoted_head = _core_get(quoted_info, "head", None)
        state["name_part"] = quoted_head
        state["description"] = quoted
    name_part_value = _core_get(state, "name_part", None)
    name_part = str(name_part_value).strip()
    is_optional = _core_contains(name_part, "?")
    is_internal = _core_contains(name_part, "!")
    name_without_optional = _core_string_replace(name_part, "?", "")
    name_without_markers = _core_string_replace(name_without_optional, "!", "")
    name = str(name_without_markers).strip()
    nested_internal = _core_and(nested, is_internal)
    if nested_internal:
        qualified = _core_string_format("{}.{}", parent, name)
        message = _core_string_format("Object field \"{}\" cannot use the internal marker \"!\"", qualified)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    field_type = _core_get(state, "type", None)
    description = _core_get(state, "description", None)
    has_description = _core_is_not_none(description)
    has_nested_description = _core_and(nested, has_description)
    if has_nested_description:
        type_attrs = {}
        type_name = _core_get(field_type, "name", None)
        type_is_array = _core_get(field_type, "is_array", False)
        type_options = _core_get(field_type, "options", None)
        type_fields = _core_get(field_type, "fields", None)
        type_min_length = _core_get(field_type, "min_length", None)
        type_max_length = _core_get(field_type, "max_length", None)
        type_minimum = _core_get(field_type, "minimum", None)
        type_maximum = _core_get(field_type, "maximum", None)
        type_pattern = _core_get(field_type, "pattern", None)
        type_pattern_description = _core_get(field_type, "pattern_description", None)
        type_format = _core_get(field_type, "format", None)
        type_language = _core_get(field_type, "language", None)
        type_attrs["name"] = type_name
        type_attrs["is_array"] = type_is_array
        type_attrs["options"] = type_options
        type_attrs["fields"] = type_fields
        type_attrs["min_length"] = type_min_length
        type_attrs["max_length"] = type_max_length
        type_attrs["minimum"] = type_minimum
        type_attrs["maximum"] = type_maximum
        type_attrs["pattern"] = type_pattern
        type_attrs["pattern_description"] = type_pattern_description
        type_attrs["format"] = type_format
        type_attrs["language"] = type_language
        type_attrs["description"] = description
        field_type = _core_record_new("FieldType", type_attrs)
    else:
        pass
    field_attrs = {}
    field_attrs["name"] = name
    field_attrs["type"] = field_type
    field_attrs["description"] = description
    field_attrs["is_optional"] = is_optional
    field_attrs["is_internal"] = is_internal
    is_cached = _core_get(state, "is_cached", False)
    field_attrs["is_cached"] = is_cached
    field = _core_record_new("Field", field_attrs)
    _signature_validate_field_shape_impl(field, output, nested)
    return field


def _signature_parse_description_impl(raw: str, fallback: Any) -> Any:
    _core_coverage_mark("_signature_parse_description_impl")
    text = str(raw).strip()
    empty = _core_eq(text, "")
    if empty:
        return fallback
    else:
        pass
    quoted = _core_string_consume_optional_quoted_prefix(text)
    found = _core_get(quoted, "found", False)
    missing = _core_not(found)
    if missing:
        error = _core_signature_error("Unexpected content after signature")
        raise error
    else:
        pass
    rest_raw = _core_get(quoted, "rest", None)
    rest = str(rest_raw).strip()
    has_extra = _core_truthy(rest)
    if has_extra:
        error = _core_signature_error("Unexpected content after signature")
        raise error
    else:
        pass
    value_raw = _core_get(quoted, "value", None)
    value = str(value_raw).strip()
    return value


def _signature_parse_base_type_impl(raw: str) -> Any:
    _core_coverage_mark("_signature_parse_base_type_impl")
    text = str(raw).strip()
    types = []
    types.append("datetimeRange")
    types.append("dateRange")
    types.append("datetime")
    types.append("boolean")
    types.append("string")
    types.append("number")
    types.append("object")
    types.append("class")
    types.append("image")
    types.append("audio")
    types.append("file")
    types.append("json")
    types.append("date")
    types.append("code")
    types.append("url")
    state = {}
    state["name"] = ""
    state["rest"] = text
    for candidate in types:
        matched_name = _core_get(state, "name", None)
        unmatched = _core_eq(matched_name, "")
        if unmatched:
            starts = _core_string_starts_with(text, candidate)
            if starts:
                offset = _core_len(candidate)
                after = _core_string_slice(text, offset)
                first = _core_string_slice(after, 0, 1)
                boundary = _core_eq(after, "")
                space = _core_regex_match("^\\s", after)
                boundary = _core_or(boundary, space)
                open_paren = _core_eq(first, "(")
                boundary = _core_or(boundary, open_paren)
                open_brace = _core_eq(first, "{")
                boundary = _core_or(boundary, open_brace)
                open_array = _core_eq(first, "[")
                boundary = _core_or(boundary, open_array)
                double_quote = _core_eq(first, "\"")
                boundary = _core_or(boundary, double_quote)
                single_quote = _core_eq(first, "'")
                boundary = _core_or(boundary, single_quote)
                if boundary:
                    state["name"] = candidate
                    state["rest"] = after
                else:
                    pass
            else:
                pass
        else:
            pass
    name = _core_get(state, "name", None)
    missing = _core_eq(name, "")
    if missing:
        words = _core_string_words(text)
        word = _core_list_get(words, 0, "empty")
        message = _core_string_format("Invalid type \"{}\"", word)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    return state


def _signature_parse_type_expr_impl(raw: str, section: str, field_name: str) -> Any:
    _core_coverage_mark("_signature_parse_type_expr_impl")
    base = _signature_parse_base_type_impl(raw)
    type_name = _core_get(base, "name", None)
    base_rest = _core_get(base, "rest", None)
    rest = str(base_rest).strip()
    nested = _core_eq(section, "nested")
    media = []
    media.append("image")
    media.append("audio")
    media.append("file")
    is_media = _core_contains(media, type_name)
    nested_media = _core_and(nested, is_media)
    if nested_media:
        message = _core_string_format("Object field \"{}\": {} type is not allowed in nested object fields", field_name, type_name)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    is_class = _core_eq(type_name, "class")
    if is_class:
        input = _core_eq(section, "input")
        if input:
            error = _core_signature_error("Input field cannot use the \"class\" type")
            raise error
        else:
            pass
        bag = _core_string_starts_with(rest, "(")
        if bag:
            message = _core_string_format("Field \"{}\": constraints are not supported on class fields", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        is_array = _core_string_starts_with(rest, "[]")
        if is_array:
            rest_after_array = _core_string_slice(rest, 2)
            rest = str(rest_after_array).strip()
        else:
            pass
        bag_after = _core_string_starts_with(rest, "(")
        if bag_after:
            message = _core_string_format("Field \"{}\": constraints are not supported on class fields", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        quoted = _core_string_consume_optional_quoted_prefix(rest)
        has_options = _core_get(quoted, "found", False)
        if has_options:
            quoted_value = _core_get(quoted, "value", None)
            option_text = _core_string_replace(quoted_value, "|", ",")
            options = _core_string_split_trim_nonempty(option_text, ",")
            option_count = _core_len(options)
            empty_options = _core_eq(option_count, 0)
            if empty_options:
                error = _core_signature_error("Missing class options after \"class\" type")
                raise error
            else:
                pass
            attrs = {}
            attrs["name"] = "class"
            attrs["is_array"] = is_array
            attrs["options"] = options
            typ = _core_record_new("FieldType", attrs)
            out = {}
            out["type"] = typ
            out["is_cached"] = False
            quoted_rest = _core_get(quoted, "rest", None)
            out["rest"] = quoted_rest
            return out
        else:
            pass
        error = _core_signature_error("Missing class options after \"class\" type")
        raise error
    else:
        pass
    is_object = _core_eq(type_name, "object")
    starts_object_fields = _core_string_starts_with(rest, "{")
    has_object_fields = _core_and(is_object, starts_object_fields)
    if has_object_fields:
        group = _core_string_extract_leading_group(rest, "{", "}")
        balanced = _core_get(group, "balanced", False)
        unbalanced = _core_not(balanced)
        if unbalanced:
            message = _core_string_format("Field \"{}\": unbalanced \"{\" in object type", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        group_text = _core_get(group, "group", None)
        fields = _signature_parse_object_fields_impl(group_text, section, field_name)
        group_rest = _core_get(group, "rest", None)
        after = str(group_rest).strip()
        is_array = _core_string_starts_with(after, "[]")
        if is_array:
            after_array = _core_string_slice(after, 2)
            after = str(after_array).strip()
        else:
            pass
        attrs = {}
        attrs["name"] = "object"
        attrs["is_array"] = is_array
        attrs["fields"] = fields
        typ = _core_record_new("FieldType", attrs)
        out = {}
        out["type"] = typ
        out["is_cached"] = False
        out["rest"] = after
        return out
    else:
        pass
    attrs = {}
    attrs["name"] = type_name
    attrs["is_array"] = False
    modifier_state = {}
    modifier_state["attrs"] = attrs
    modifier_state["is_cached"] = False
    none = _core_none()
    modifier_state["item_description"] = none
    has_bag = _core_string_starts_with(rest, "(")
    if has_bag:
        group = _core_string_extract_leading_group(rest, "(", ")")
        balanced = _core_get(group, "balanced", False)
        unbalanced = _core_not(balanced)
        if unbalanced:
            message = _core_string_format("Field \"{}\": expected \",\" or \")\" in modifier list", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        group_text = _core_get(group, "group", None)
        parsed = _signature_parse_modifier_bag_impl(type_name, section, field_name, group_text)
        parsed_attrs = _core_get(parsed, "attrs", None)
        merged_attrs = _core_map_merge(attrs, parsed_attrs)
        parsed_cached = _core_get(parsed, "is_cached", False)
        parsed_item = _core_get(parsed, "item_description", None)
        modifier_state["attrs"] = merged_attrs
        modifier_state["is_cached"] = parsed_cached
        modifier_state["item_description"] = parsed_item
        group_rest = _core_get(group, "rest", None)
        rest = str(group_rest).strip()
    else:
        pass
    is_array = _core_string_starts_with(rest, "[]")
    if is_array:
        rest_after_array = _core_string_slice(rest, 2)
        rest = str(rest_after_array).strip()
    else:
        pass
    type_attrs = _core_get(modifier_state, "attrs", None)
    type_attrs["is_array"] = is_array
    item_description = _core_get(modifier_state, "item_description", None)
    has_item = _core_is_not_none(item_description)
    not_array = _core_not(is_array)
    item_without_array = _core_and(has_item, not_array)
    if item_without_array:
        message = _core_string_format("Field \"{}\": the \"item\" modifier requires an array type", field_name)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    if has_item:
        type_attrs["description"] = item_description
    else:
        pass
    typ = _core_record_new("FieldType", type_attrs)
    out = {}
    out["type"] = typ
    is_cached = _core_get(modifier_state, "is_cached", False)
    out["is_cached"] = is_cached
    out["rest"] = rest
    return out


def _signature_parse_modifier_bag_impl(type_name: str, section: str, field_name: str, raw: str) -> Any:
    _core_coverage_mark("_signature_parse_modifier_bag_impl")
    text = str(raw).strip()
    empty = _core_eq(text, "")
    if empty:
        message = _core_string_format("Field \"{}\": empty modifier list \"()\"", field_name)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    parts = _core_string_split_top_level(raw, ",")
    attrs = {}
    seen = []
    state = {}
    state["is_cached"] = False
    none = _core_none()
    state["item_description"] = none
    for part in parts:
        entry = str(part).strip()
        entry_empty = _core_eq(entry, "")
        if entry_empty:
            message = _core_string_format("Field \"{}\": trailing comma in modifier list", field_name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        words = _core_string_words(entry)
        token = _core_list_get(words, 0, "")
        token_len = _core_len(token)
        arg_raw = _core_string_slice(entry, token_len)
        arg = str(arg_raw).strip()
        handled = {}
        handled["value"] = False
        is_min = _core_eq(token, "min")
        is_max = _core_eq(token, "max")
        is_bound = _core_or(is_min, is_max)
        if is_bound:
            duplicate = _core_contains(seen, token)
            if duplicate:
                message = _core_string_format("Field \"{}\": duplicate \"{}\" modifier", field_name, token)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            seen.append(token)
            is_string = _core_eq(type_name, "string")
            is_number = _core_eq(type_name, "number")
            allowed = _core_or(is_string, is_number)
            not_allowed = _core_not(allowed)
            if not_allowed:
                message = _core_string_format("Field \"{}\": \"{}\" is not supported for type \"{}\"", field_name, token, type_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            numeric = _core_regex_match("^-?[0-9]+(\\.[0-9]+)?$", arg)
            not_numeric = _core_not(numeric)
            if not_numeric:
                message = _core_string_format("Field \"{}\": \"{}\" requires a numeric value", field_name, token)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            value = _core_json_parse(arg)
            if is_string:
                if is_min:
                    attrs["minLength"] = value
                else:
                    attrs["maxLength"] = value
            else:
                if is_min:
                    attrs["minimum"] = value
                else:
                    attrs["maximum"] = value
            handled["value"] = True
        else:
            pass
        is_format = _core_eq(token, "format")
        if is_format:
            duplicate = _core_contains(seen, "format")
            if duplicate:
                message = _core_string_format("Field \"{}\": duplicate \"format\" modifier", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            seen.append("format")
            is_string = _core_eq(type_name, "string")
            not_string = _core_not(is_string)
            if not_string:
                message = _core_string_format("Field \"{}\": \"format\" is not supported for type \"{}\"", field_name, type_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            formats = []
            formats.append("email")
            formats.append("uri")
            formats.append("date")
            formats.append("date-time")
            known = _core_contains(formats, arg)
            unknown = _core_not(known)
            if unknown:
                message = _core_string_format("Field \"{}\": unknown format \"{}\"", field_name, arg)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            attrs["format"] = arg
            handled["value"] = True
        else:
            pass
        is_pattern = _core_eq(token, "pattern")
        if is_pattern:
            duplicate = _core_contains(seen, "pattern")
            if duplicate:
                message = _core_string_format("Field \"{}\": duplicate \"pattern\" modifier", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            seen.append("pattern")
            is_string = _core_eq(type_name, "string")
            not_string = _core_not(is_string)
            if not_string:
                message = _core_string_format("Field \"{}\": \"pattern\" is not supported for type \"{}\"", field_name, type_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            quoted = _core_string_consume_optional_quoted_prefix(arg)
            found = _core_get(quoted, "found", False)
            missing = _core_not(found)
            if missing:
                message = _core_string_format("Field \"{}\": \"pattern\" requires a quoted regular expression", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            pattern_value = _core_get(quoted, "value", None)
            attrs["pattern"] = pattern_value
            pattern_rest_raw = _core_get(quoted, "rest", None)
            pattern_rest = str(pattern_rest_raw).strip()
            has_pattern_rest = _core_truthy(pattern_rest)
            if has_pattern_rest:
                desc = _core_string_consume_optional_quoted_prefix(pattern_rest)
                desc_found = _core_get(desc, "found", False)
                desc_missing = _core_not(desc_found)
                if desc_missing:
                    message = _core_string_format("Field \"{}\": expected \",\" or \")\" in modifier list", field_name)
                    error = _core_signature_error(message)
                    raise error
                else:
                    pass
                desc_rest_raw = _core_get(desc, "rest", None)
                desc_rest = str(desc_rest_raw).strip()
                desc_extra = _core_truthy(desc_rest)
                if desc_extra:
                    message = _core_string_format("Field \"{}\": expected \",\" or \")\" in modifier list", field_name)
                    error = _core_signature_error(message)
                    raise error
                else:
                    pass
                desc_value = _core_get(desc, "value", None)
                attrs["patternDescription"] = desc_value
            else:
                pass
            handled["value"] = True
        else:
            pass
        is_cache = _core_eq(token, "cache")
        if is_cache:
            duplicate = _core_contains(seen, "cache")
            if duplicate:
                message = _core_string_format("Field \"{}\": duplicate \"cache\" modifier", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            seen.append("cache")
            input = _core_eq(section, "input")
            not_input = _core_not(input)
            if not_input:
                message = _core_string_format("Field \"{}\": \"cache\" is only supported on top-level input fields", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            extra = _core_truthy(arg)
            if extra:
                message = _core_string_format("Field \"{}\": expected \",\" or \")\" in modifier list", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            state["is_cached"] = True
            handled["value"] = True
        else:
            pass
        is_item = _core_eq(token, "item")
        if is_item:
            duplicate = _core_contains(seen, "item")
            if duplicate:
                message = _core_string_format("Field \"{}\": duplicate \"item\" modifier", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            seen.append("item")
            nested = _core_eq(section, "nested")
            if nested:
                message = _core_string_format("Field \"{}\": \"item\" is not supported inside object fields", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            quoted = _core_string_consume_optional_quoted_prefix(arg)
            found = _core_get(quoted, "found", False)
            missing = _core_not(found)
            if missing:
                message = _core_string_format("Field \"{}\": \"item\" requires a quoted description", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            remaining_raw = _core_get(quoted, "rest", None)
            remaining = str(remaining_raw).strip()
            extra = _core_truthy(remaining)
            if extra:
                message = _core_string_format("Field \"{}\": expected \",\" or \")\" in modifier list", field_name)
                error = _core_signature_error(message)
                raise error
            else:
                pass
            item_value = _core_get(quoted, "value", None)
            state["item_description"] = item_value
            handled["value"] = True
        else:
            pass
        was_handled = _core_get(handled, "value", False)
        unhandled = _core_not(was_handled)
        if unhandled:
            is_code = _core_eq(type_name, "code")
            if is_code:
                duplicate = _core_contains(seen, "language")
                if duplicate:
                    message = _core_string_format("Field \"{}\": duplicate \"language\" modifier", field_name)
                    error = _core_signature_error(message)
                    raise error
                else:
                    pass
                extra = _core_truthy(arg)
                if extra:
                    message = _core_string_format("Field \"{}\": expected \",\" or \")\" in modifier list", field_name)
                    error = _core_signature_error(message)
                    raise error
                else:
                    pass
                seen.append("language")
                attrs["language"] = token
            else:
                message = _core_string_format("Field \"{}\": unknown modifier \"{}\" for type \"{}\"", field_name, token, type_name)
                error = _core_signature_error(message)
                raise error
        else:
            pass
    out = {}
    out["attrs"] = attrs
    is_cached = _core_get(state, "is_cached", False)
    item_description = _core_get(state, "item_description", None)
    out["is_cached"] = is_cached
    out["item_description"] = item_description
    return out


def _signature_parse_object_fields_impl(raw: str, section: str, parent: str) -> Any:
    _core_coverage_mark("_signature_parse_object_fields_impl")
    text = str(raw).strip()
    empty = _core_eq(text, "")
    if empty:
        message = _core_string_format("Field \"{}\": object type requires at least one field", parent)
        error = _core_signature_error(message)
        raise error
    else:
        pass
    parts = _core_string_split_top_level(raw, ",")
    fields = {}
    output = _core_eq(section, "output")
    for part in parts:
        entry = str(part).strip()
        entry_empty = _core_eq(entry, "")
        if entry_empty:
            message = _core_string_format("Field \"{}\": trailing comma in object type", parent)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        field = _signature_parse_field_common_impl(entry, output, True, parent)
        name = _core_get(field, "name", None)
        duplicate = _core_map_contains(fields, name)
        if duplicate:
            message = _core_string_format("Field \"{}\": duplicate object field name \"{}\"", parent, name)
            error = _core_signature_error(message)
            raise error
        else:
            pass
        fields[name] = field
    return fields


def signature_to_string(signature: AxSignature) -> str:
    _core_coverage_mark("signature_to_string")
    parts = []
    description = _core_get(signature, "description", None)
    has_description = _core_truthy(description)
    if has_description:
        escaped = _signature_escape_string_impl(description)
        prefix = _core_string_format("\"{}\"", escaped)
        parts.append(prefix)
    else:
        pass
    inputs = _core_get(signature, "input_fields", None)
    input_parts = []
    for field in inputs:
        rendered = _signature_render_field_impl(field)
        input_parts.append(rendered)
    input_text = _core_string_join(", ", input_parts)
    parts.append(input_text)
    left = _core_string_join(" ", parts)
    outputs = _core_get(signature, "output_fields", None)
    output_parts = []
    for field in outputs:
        rendered = _signature_render_field_impl(field)
        output_parts.append(rendered)
    right = _core_string_join(", ", output_parts)
    result = _core_string_format("{} -> {}", left, right)
    return result


def _signature_escape_string_impl(value: str) -> str:
    _core_coverage_mark("_signature_escape_string_impl")
    slashes = _core_string_replace(value, "\\", "\\\\")
    quotes = _core_string_replace(slashes, "\"", "\\\"")
    return quotes


def _signature_render_modifier_bag_impl(typ: FieldType, is_cached: bool) -> str:
    _core_coverage_mark("_signature_render_modifier_bag_impl")
    entries = []
    min_length = _core_get(typ, "min_length", None)
    minimum = _core_get(typ, "minimum", None)
    min = _core_coalesce(min_length, minimum)
    has_min = _core_is_not_none(min)
    if has_min:
        entry = _core_string_format("min {}", min)
        entries.append(entry)
    else:
        pass
    max_length = _core_get(typ, "max_length", None)
    maximum = _core_get(typ, "maximum", None)
    max = _core_coalesce(max_length, maximum)
    has_max = _core_is_not_none(max)
    if has_max:
        entry = _core_string_format("max {}", max)
        entries.append(entry)
    else:
        pass
    format = _core_get(typ, "format", None)
    has_format = _core_is_not_none(format)
    if has_format:
        entry = _core_string_format("format {}", format)
        entries.append(entry)
    else:
        pass
    pattern = _core_get(typ, "pattern", None)
    has_pattern = _core_is_not_none(pattern)
    if has_pattern:
        escaped_pattern = _signature_escape_string_impl(pattern)
        entry = _core_string_format("pattern \"{}\"", escaped_pattern)
        pattern_description = _core_get(typ, "pattern_description", None)
        has_pattern_description = _core_is_not_none(pattern_description)
        if has_pattern_description:
            escaped_description = _signature_escape_string_impl(pattern_description)
            entry = _core_string_format("{} \"{}\"", entry, escaped_description)
        else:
            pass
        entries.append(entry)
    else:
        pass
    is_array = _core_get(typ, "is_array", False)
    item_description = _core_get(typ, "description", None)
    has_item_description = _core_truthy(item_description)
    render_item = _core_and(is_array, has_item_description)
    if render_item:
        escaped_item = _signature_escape_string_impl(item_description)
        entry = _core_string_format("item \"{}\"", escaped_item)
        entries.append(entry)
    else:
        pass
    type_name = _core_get(typ, "name", None)
    is_code = _core_eq(type_name, "code")
    language = _core_get(typ, "language", None)
    has_language = _core_truthy(language)
    render_language = _core_and(is_code, has_language)
    if render_language:
        entries.append(language)
    else:
        pass
    if is_cached:
        entries.append("cache")
    else:
        pass
    count = _core_len(entries)
    empty = _core_eq(count, 0)
    if empty:
        return ""
    else:
        pass
    body = _core_string_join(", ", entries)
    result = _core_string_format("({})", body)
    return result


def _signature_render_type_impl(typ: FieldType, is_cached: bool) -> str:
    _core_coverage_mark("_signature_render_type_impl")
    type_name = _core_get(typ, "name", None)
    is_array = _core_get(typ, "is_array", False)
    is_class = _core_eq(type_name, "class")
    if is_class:
        state = {}
        state["value"] = "class"
        if is_array:
            state["value"] = "class[]"
        else:
            pass
        options = _core_get(typ, "options", None)
        joined = _core_string_join(" | ", options)
        class_name = _core_get(state, "value", None)
        result = _core_string_format("{} \"{}\"", class_name, joined)
        return result
    else:
        pass
    is_object = _core_eq(type_name, "object")
    fields = _core_get(typ, "fields", None)
    has_fields = _core_truthy(fields)
    structured_object = _core_and(is_object, has_fields)
    if structured_object:
        rendered_fields = _signature_render_object_fields_impl(fields)
        result = _core_string_format("object{}", rendered_fields)
        if is_array:
            result = _core_string_format("{}[]", result)
        else:
            pass
        return result
    else:
        pass
    bag = _signature_render_modifier_bag_impl(typ, is_cached)
    result = _core_string_format("{}{}", type_name, bag)
    if is_array:
        result = _core_string_format("{}[]", result)
    else:
        pass
    return result


def _signature_render_object_fields_impl(fields: Any) -> str:
    _core_coverage_mark("_signature_render_object_fields_impl")
    parts = []
    nested_fields = _core_fields_from_map(fields)
    for field in nested_fields:
        name = _core_get(field, "name", None)
        optional = _core_get(field, "is_optional", False)
        state = {}
        state["value"] = name
        if optional:
            marked = _core_string_format("{}?", name)
            state["value"] = marked
        else:
            pass
        typ = _core_get(field, "type", None)
        rendered_type = _signature_render_type_impl(typ, False)
        field_name = _core_get(state, "value", None)
        entry = _core_string_format("{}:{}", field_name, rendered_type)
        type_description = _core_get(typ, "description", None)
        field_description = _core_get(field, "description", None)
        description = _core_coalesce(type_description, field_description)
        has_description = _core_truthy(description)
        type_name = _core_get(typ, "name", None)
        is_code = _core_eq(type_name, "code")
        language = _core_get(typ, "language", None)
        same_as_language = _core_eq(description, language)
        implicit_code_description = _core_and(is_code, same_as_language)
        not_implicit = _core_not(implicit_code_description)
        explicit_description = _core_and(has_description, not_implicit)
        if explicit_description:
            escaped = _signature_escape_string_impl(description)
            entry = _core_string_format("{} \"{}\"", entry, escaped)
        else:
            pass
        parts.append(entry)
    body = _core_string_join(", ", parts)
    prefix = _core_add("{ ", body)
    result = _core_add(prefix, " }")
    return result


def _signature_render_field_impl(field: Field) -> str:
    _core_coverage_mark("_signature_render_field_impl")
    name = _core_get(field, "name", None)
    optional = _core_get(field, "is_optional", False)
    internal = _core_get(field, "is_internal", False)
    state = {}
    state["value"] = name
    if optional:
        current = _core_get(state, "value", None)
        marked = _core_string_format("{}?", current)
        state["value"] = marked
    else:
        pass
    if internal:
        current = _core_get(state, "value", None)
        marked = _core_string_format("{}!", current)
        state["value"] = marked
    else:
        pass
    typ = _core_get(field, "type", None)
    cached = _core_get(field, "is_cached", False)
    rendered_type = _signature_render_type_impl(typ, cached)
    field_name = _core_get(state, "value", None)
    entry = _core_string_format("{}:{}", field_name, rendered_type)
    description = _core_get(field, "description", None)
    has_description = _core_truthy(description)
    type_name = _core_get(typ, "name", None)
    is_code = _core_eq(type_name, "code")
    language = _core_get(typ, "language", None)
    same_as_language = _core_eq(description, language)
    implicit_code_description = _core_and(is_code, same_as_language)
    not_implicit = _core_not(implicit_code_description)
    explicit_description = _core_and(has_description, not_implicit)
    if explicit_description:
        escaped = _signature_escape_string_impl(description)
        entry = _core_string_format("{} \"{}\"", entry, escaped)
    else:
        pass
    return entry


def _signature_validate_field_shape_impl(field: Field, output: bool, nested: bool) -> None:
    _core_coverage_mark("_signature_validate_field_shape_impl")
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
    top_level = _core_not(nested)
    input_class_base = _core_and(is_class, is_input)
    input_class = _core_and(input_class_base, top_level)
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
    _core_coverage_mark("_signature_validate_impl")
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
