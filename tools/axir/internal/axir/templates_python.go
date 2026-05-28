package axir

const pyInit = `from .signature import AxSignature, AxSignatureError, Field, FieldType, SignatureBuilder, f, s
from .schema import AxValidationError
from .tool import Tool, fn
from .ai import (
    AIClient,
    AxAIRefusalError,
    AxAIService,
    AxAIServiceAuthenticationError,
    AxAIServiceError,
    AxAIServiceNetworkError,
    AxAIServiceResponseError,
    AxAIServiceStatusError,
    AxAIServiceStreamTerminatedError,
    AxAIServiceTimeoutError,
    AxBaseAI,
    AxUnsupportedCapabilityError,
    OpenAICompatibleClient,
    ai,
)
from .gen import AxGen, AxMemory, ax
from .prompt import AxPromptTemplate, TemplateError, render_template_content, validate_prompt_template_syntax

__all__ = [
    "AIClient",
    "AxAIRefusalError",
    "AxAIService",
    "AxAIServiceAuthenticationError",
    "AxAIServiceError",
    "AxAIServiceNetworkError",
    "AxAIServiceResponseError",
    "AxAIServiceStatusError",
    "AxAIServiceStreamTerminatedError",
    "AxAIServiceTimeoutError",
    "AxBaseAI",
    "AxGen",
    "AxMemory",
    "AxPromptTemplate",
    "AxSignature",
    "AxSignatureError",
    "AxUnsupportedCapabilityError",
    "AxValidationError",
    "Field",
    "FieldType",
    "OpenAICompatibleClient",
    "SignatureBuilder",
    "TemplateError",
    "Tool",
    "ai",
    "ax",
    "f",
    "fn",
    "render_template_content",
    "s",
    "validate_prompt_template_syntax",
]
`

const pySignature = `from __future__ import annotations

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


# AXIR_CORE_SIGNATURE_FUNCTIONS
`

const pySchema = `from __future__ import annotations

import copy
import re
from typing import Any


class AxValidationError(ValueError):
    pass


def _core_not(value):
    return not value


def _core_and(left, right):
    return bool(left and right)


def _core_or(left, right):
    return bool(left or right)


def _core_eq(left, right):
    return left == right


def _core_ne(left, right):
    return left != right


def _core_lt(left, right):
    return left < right


def _core_lte(left, right):
    return left <= right


def _core_gt(left, right):
    return left > right


def _core_gte(left, right):
    return left >= right


def _core_contains(container, item):
    if container is None:
        return False
    return item in container


def _core_len(value):
    return len(value)


def _core_truthy(value):
    return bool(value)


def _core_is_none(value):
    return value is None


def _core_is_not_none(value):
    return value is not None


def _core_none():
    return None


def _core_coalesce(value, fallback):
    return fallback if value is None else value


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    return getattr(target, key, default)


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_type_is(value, type_name):
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "list":
        return isinstance(value, list)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "number":
        return (isinstance(value, (int, float)) and not isinstance(value, bool))
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "null":
        return value is None
    if type_name == "json":
        return value is None or isinstance(value, (dict, list, str, int, float, bool))
    return False


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(pattern, value) is not None


def _core_map_contains(values, key):
    return isinstance(values, dict) and key in values


def _core_map_get(values, key):
    return values[key]


def _core_map_update(target, values):
    target.update(values or {})
    return target


def _core_map_values(values):
    if values is None:
        return []
    if isinstance(values, dict):
        return list(values.values())
    return list(values)


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in values)


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_description_append(base, hint):
    if not hint or not str(hint).strip():
        return base
    if not base or not str(base).strip():
        return str(hint)
    text = str(base).strip()
    if not text.endswith("."):
        text += "."
    return text + " " + str(hint)


def _core_url_valid(value):
    return isinstance(value, str) and re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", value) is not None


def _core_validation_error(message):
    return AxValidationError(message)


def _core_field_item(field):
    item_type = copy.deepcopy(field.type)
    item_type.is_array = False
    return field.__class__(name=field.name, type=item_type, description=field.description)


def _core_fields_from_map(fields):
    if not fields:
        return []
    return [_nested_field(name, item) for name, item in fields.items()]


def _nested_field(name, item):
    from .signature import Field, FieldType
    if isinstance(item, Field):
        return item
    if isinstance(item, FieldType):
        return Field(name=name, type=item)
    if isinstance(item, dict):
        typ = FieldType(
            item.get("type", item.get("name", "string")),
            is_array=bool(item.get("isArray", item.get("is_array", False))),
            options=item.get("options"),
            fields=item.get("fields"),
            min_length=item.get("minLength", item.get("min_length")),
            max_length=item.get("maxLength", item.get("max_length")),
            minimum=item.get("minimum"),
            maximum=item.get("maximum"),
            pattern=item.get("pattern"),
            pattern_description=item.get("patternDescription", item.get("pattern_description")),
            format=item.get("format"),
            description=item.get("description"),
        )
        return Field(
            name=name,
            type=typ,
            description=item.get("description"),
            is_optional=bool(item.get("isOptional", item.get("is_optional", False))),
            is_internal=bool(item.get("isInternal", item.get("is_internal", False))),
        )
    return Field(name=name, type=item)


def _valid_image(value):
    return isinstance(value, dict) and "mimeType" in value and "data" in value


def _valid_audio(value):
    return isinstance(value, str) or (isinstance(value, dict) and ("data" in value or "id" in value))


def _valid_file(value):
    if not isinstance(value, dict) or "mimeType" not in value:
        return False
    return ("data" in value) != ("fileUri" in value)


def _valid_url_shape(value):
    return isinstance(value, str) or (isinstance(value, dict) and "url" in value)


# AXIR_CORE_SCHEMA_FUNCTIONS
`

const pyTool = `from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .schema import to_json_schema, validate_fields


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], Any]
    returns: list[Any] = field(default_factory=list)
    namespace: str | None = None
    args: list[Any] = field(default_factory=list)

    def call(self, args: dict[str, Any]):
        validate_fields(self.args, args, f"tool.{self.name}.args")
        result = self.handler(args)
        if self.returns and isinstance(result, dict):
            validate_fields(self.returns, result, f"tool.{self.name}.return")
        return result


class FunctionBuilder:
    def __init__(self, name: str):
        self.name = name
        self.desc = None
        self.ns = None
        self.args = []
        self.return_fields = []
        self.fn = None

    def description(self, text: str):
        self.desc = text
        return self

    def namespace(self, text: str):
        self.ns = text
        return self

    def arg(self, name: str, field_info):
        self.args.append(field_info.to_field(name))
        return self

    def returns_field(self, name: str, field_info):
        self.return_fields.append(field_info.to_field(name))
        return self

    def handler(self, fn: Callable[[dict[str, Any]], Any]):
        self.fn = fn
        return self

    def build(self):
        if not self.name.strip():
            raise ValueError("fn() requires a non-empty function name")
        if not self.desc:
            raise ValueError(f"Function {self.name!r} must define a description")
        if self.fn is None:
            raise ValueError(f"Function {self.name!r} must define a handler")
        return Tool(
            self.name,
            self.desc,
            to_json_schema(self.args),
            self.fn,
            returns=self.return_fields,
            namespace=self.ns,
            args=self.args,
        )


def fn(name: str) -> FunctionBuilder:
    return FunctionBuilder(name)
`

const pyPrompt = `from __future__ import annotations

import json
import re
from typing import Any


PROMPT_FEATURES = {
    "template_engine": True,
    "default_prompt": True,
    "custom_prompt_template": True,
    "prompt_conformance": True,
}

BT = chr(96)

DEFAULT_DSPY_TEMPLATE = (
    "<identity>\n{{ identityText }}\n</identity>{{ if hasFunctions }}\n\n"
    "<available_functions>\n"
    "**Available Functions**: You can call the following functions to complete the task:\n\n"
    "{{ functionsList }}\n\n"
    "## Function Call Instructions\n"
    "- Complete the task, using the functions defined earlier in this prompt.\n"
    "- Output fields should only be generated after all functions have been called.\n"
    "- Use the function results to generate the output fields.\n"
    "</available_functions>{{ /if }}\n\n"
    "<input_fields>\n{{ inputFieldsSection }}\n</input_fields>{{ if hasOutputFields }}\n\n"
    "<output_fields>\n{{ outputFieldsSection }}\n</output_fields>{{ /if }}\n"
    "{{ if hasTaskDefinition }}\n\n"
    "<task_definition>\n{{ taskDefinitionText }}\n</task_definition>{{ /if }}\n\n"
    "<formatting_rules>\n{{ if hasStructuredOutputFunction }}\n"
    "Return the complete output by calling " + BT + "{{ structuredOutputFunctionName }}" + BT + ".\n"
    "{{ else }}{{ if hasComplexFields }}\n"
    "Return valid JSON matching <output_fields>.\n"
    "{{ else }}\n"
    "Return one " + BT + "field name: value" + BT + " pair per line for the required output fields only.\n"
    "{{ /if }}{{ /if }}Above rules override later instructions.\n\n"
    "</formatting_rules>\n"
    "{{ if hasExampleDemonstrations }}\n\n"
    "## Example Demonstrations\n"
    "The following User/Assistant turns are examples only until --- END OF EXAMPLES ---, not context for the current task.\n"
    "{{ /if }}\n"
)

TAG_PATTERN = re.compile(r"{{\s*([^}]+?)\s*}}")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$")
STRING_EQUALITY_PATTERN = re.compile(
    r"^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*===\s*(?:'([^']*)'|\"([^\"]*)\")$"
)


class TemplateError(ValueError):
    pass


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_add(left, right): return left + right
def _core_len(value): return len(value)
def _core_contains(container, item): return False if container is None else item in container
def _core_truthy(value): return bool(value)
def _core_is_none(value): return value is None
def _core_is_not_none(value): return value is not None
def _core_none(): return None


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in values)


def _core_string_split(value, sep):
    return str(value).split(str(sep))


def _core_string_starts_with(value, prefix):
    return str(value).startswith(str(prefix))


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_replace(value, old, new):
    return str(value).replace(str(old), str(new))


def _core_regex_replace(pattern, repl, value):
    return re.sub(str(pattern), str(repl), str(value))


def _core_sorted_strings(values):
    return sorted(str(item) for item in values)


def _core_json_pretty(value):
    return json.dumps(value, indent=2)


def _core_template_error_message(context: str, source: str, index: int, message: str) -> str:
    snippet = source[:index]
    lines = snippet.split("\n")
    line = len(lines)
    column = len(lines[-1]) + 1 if lines else 1
    return f"{context}:{line}:{column} {message}"


def _core_template_tokenize(template: str):
    tokens = []
    last_index = 0
    for match in TAG_PATTERN.finditer(template):
        start = match.start()
        if start > last_index:
            tokens.append({"type": "text", "value": template[last_index:start]})
        tokens.append({"type": "tag", "value": match.group(1).strip(), "index": start})
        last_index = match.end()
    if last_index < len(template):
        tokens.append({"type": "text", "value": template[last_index:]})
    return tokens


def _core_template_parse_range(tokens, source: str, context: str, start_index: int = 0, terminators=None):
    terminators = set(terminators or [])
    nodes = []
    i = start_index
    while i < len(tokens):
        token = tokens[i]
        if token["type"] == "text":
            nodes.append({"type": "text", "value": token["value"]})
            i += 1
            continue

        tag = token["value"]
        if tag in terminators:
            return {"nodes": nodes, "index": i, "terminator": tag}

        if tag.startswith("if "):
            condition = tag[3:].strip()
            if not IDENTIFIER_PATTERN.match(condition) and not STRING_EQUALITY_PATTERN.match(condition):
                raise TemplateError(_core_template_error_message(context, source, token["index"], f"Invalid if condition '{condition}'"))
            then_result = _core_template_parse_range(tokens, source, context, i + 1, {"else", "/if"})
            terminator = then_result["terminator"]
            if not terminator:
                raise TemplateError(_core_template_error_message(context, source, token["index"], "Unclosed 'if' block"))
            else_nodes = []
            next_index = then_result["index"]
            if terminator == "else":
                else_result = _core_template_parse_range(tokens, source, context, next_index + 1, {"/if"})
                if else_result["terminator"] != "/if":
                    raise TemplateError(_core_template_error_message(context, source, token["index"], "Unclosed 'if' block"))
                else_nodes = else_result["nodes"]
                next_index = else_result["index"]
            nodes.append({
                "type": "if",
                "condition": condition,
                "then": then_result["nodes"],
                "else": else_nodes,
                "index": token["index"],
            })
            i = next_index + 1
            continue

        if tag == "else":
            raise TemplateError(_core_template_error_message(context, source, token["index"], "Unexpected 'else'"))
        if tag == "/if":
            raise TemplateError(_core_template_error_message(context, source, token["index"], "Unexpected '/if'"))
        if tag.startswith("!"):
            i += 1
            continue
        if tag.startswith("include "):
            raise TemplateError(_core_template_error_message(context, source, token["index"], "Unexpected 'include' directive at runtime (includes must be compiled)"))
        if not IDENTIFIER_PATTERN.match(tag):
            raise TemplateError(_core_template_error_message(context, source, token["index"], f"Invalid tag '{tag}'"))
        nodes.append({"type": "var", "name": tag, "index": token["index"]})
        i += 1
    return {"nodes": nodes, "index": i, "terminator": None}


def _core_template_parse(template: str, context: str):
    result = _core_template_parse_range(_core_template_tokenize(template), template, context)
    if result["terminator"]:
        raise TemplateError(f"Unexpected template terminator '{result['terminator']}' in {context}")
    return result["nodes"]


def _core_template_resolve_var(vars: dict[str, Any], path: str, source: str, context: str, index: int):
    current: Any = vars
    for part in str(path).split("."):
        if not isinstance(current, dict) or part not in current:
            raise TemplateError(_core_template_error_message(context, source, index, f"Missing template variable '{path}'"))
        current = current[part]
    return current


def _core_template_render_tree(nodes, vars: dict[str, Any], source: str, context: str) -> str:
    out = []
    for node in nodes:
        if node["type"] == "text":
            out.append(node["value"])
            continue
        if node["type"] == "var":
            value = _core_template_resolve_var(vars, node["name"], source, context, node["index"])
            if not isinstance(value, (str, int, float, bool)):
                raise TemplateError(_core_template_error_message(context, source, node["index"], f"Variable '{node['name']}' must be string, number, or boolean"))
            out.append(str(value))
            continue
        equality = STRING_EQUALITY_PATTERN.match(node["condition"])
        if equality:
            path = equality.group(1)
            expected = equality.group(2) if equality.group(2) is not None else equality.group(3) or ""
            condition_value = _core_template_resolve_var(vars, path, source, context, node["index"]) == expected
        else:
            resolved = _core_template_resolve_var(vars, node["condition"], source, context, node["index"])
            if not isinstance(resolved, bool):
                raise TemplateError(_core_template_error_message(context, source, node["index"], f"Condition '{node['condition']}' must be boolean"))
            condition_value = resolved
        out.append(_core_template_render_tree(node["then"] if condition_value else node["else"], vars, source, context))
    return "".join(out)


def _core_template_collect_vars_from_tree(nodes, out: set[str]):
    for node in nodes:
        if node["type"] == "var":
            out.add(node["name"])
        elif node["type"] == "if":
            equality = STRING_EQUALITY_PATTERN.match(node["condition"])
            out.add(equality.group(1) if equality else node["condition"])
            _core_template_collect_vars_from_tree(node["then"], out)
            _core_template_collect_vars_from_tree(node["else"], out)


def _core_template_collect_vars(nodes) -> list[str]:
    out: set[str] = set()
    _core_template_collect_vars_from_tree(nodes, out)
    return sorted(out)


def _core_template_validate(source: str, context: str, required_variables=None):
    try:
        present = set(_core_template_collect_vars(_core_template_parse(source, context)))
        for variable in required_variables or []:
            if variable not in present:
                return f"must preserve template variable {{{{{variable}}}}}"
        return True
    except Exception as exc:
        return str(exc)


def _core_prompt_get_input_fields(signature):
    return list(getattr(signature, "input_fields", None) or signature.get_input_fields())


def _core_prompt_get_output_fields(signature):
    return list(getattr(signature, "output_fields", None) or signature.get_output_fields())


def _core_prompt_get_description(signature):
    return getattr(signature, "description", None) or signature.get_description()


def _core_prompt_has_complex_fields(signature) -> bool:
    return signature.has_complex_fields()


def _core_prompt_field_name_to_title(signature) -> dict[str, str]:
    out = {}
    for field in _core_prompt_get_input_fields(signature):
        out[field.name] = field.title
    for field in _core_prompt_get_output_fields(signature):
        out[field.name] = field.title
    return out


def _core_prompt_is_provided_value(value) -> bool:
    if value is None:
        return False
    if isinstance(value, (str, list)) and len(value) == 0:
        return False
    return True


def _core_prompt_input_fields_for_values(signature, values=None):
    fields = sorted(_core_prompt_get_input_fields(signature), key=lambda field: 0 if getattr(field, "is_cached", False) else 1)
    if not isinstance(values, dict):
        return fields
    return [field for field in fields if not field.is_optional or _core_prompt_is_provided_value(values.get(field.name))]


def _core_prompt_render_desc_fields(fields) -> str:
    return ", ".join(BT + field.title + BT for field in fields)


def _core_prompt_format_description(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    suffix = "" if value.endswith(".") else "."
    return value[0].upper() + value[1:] + suffix


def _core_prompt_format_field_references(description: str, field_map: dict[str, str]) -> str:
    result = description
    for field_name in sorted(field_map.keys(), key=len, reverse=True):
        title = field_map[field_name]
        result = result.replace(BT + field_name + BT, BT + title + BT)
        result = result.replace('"' + field_name + '"', '"' + title + '"')
        result = result.replace("'" + field_name + "'", "'" + title + "'")
        result = re.sub(r"\[" + re.escape(field_name) + r"\]", "[" + title + "]", result)
        result = re.sub(r"\(" + re.escape(field_name) + r"\)", "(" + title + ")", result)
        result = re.sub(r"\$" + re.escape(field_name) + r"\b", BT + title + BT, result)
    return result


def _core_prompt_format_object_structure(fields) -> str:
    entries = []
    for key, item in (fields or {}).items():
        nested = item
        nested_type = getattr(nested, "type", nested)
        optional = "?" if getattr(nested, "is_optional", False) else ""
        entries.append(f"{key}{optional}: {_core_prompt_field_type_text(nested_type)}")
    return "{ " + ", ".join(entries) + " }"


def _core_prompt_field_type_text(field_type) -> str:
    name = getattr(field_type, "name", "string")
    if name == "string":
        base = "string"
    elif name == "number":
        base = "number"
    elif name == "boolean":
        base = "boolean (true or false)"
    elif name == "date":
        base = "date (YYYY-MM-DD, e.g. 2024-05-09)"
    elif name == "dateRange":
        base = 'date range ({ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }, e.g. {"start":"2024-05-09","end":"2024-05-12"})'
    elif name == "datetime":
        base = "datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00)"
    elif name == "datetimeRange":
        base = 'datetime range ({ "start": ISO datetime, "end": ISO datetime }, e.g. {"start":"2024-05-09T14:30:00Z","end":"2024-05-09T15:30:00Z"})'
    elif name == "json":
        base = "JSON object"
    elif name == "class":
        base = "classification class"
    elif name == "code":
        base = "code"
    elif name == "file":
        base = "file (with filename, mimeType, and data)"
    elif name == "audio":
        base = "speech script (plain text to synthesize as audio)"
    elif name == "url":
        base = "URL (string or object with url, title, description)"
    elif name == "object":
        base = "object " + _core_prompt_format_object_structure(field_type.fields) if field_type.fields else "object"
    else:
        base = "string"
    return f"json array of {base} items" if getattr(field_type, "is_array", False) else base


def _core_prompt_render_input_fields(fields, field_map: dict[str, str]) -> str:
    rows = []
    for field in fields:
        description = ""
        if field.description:
            description = " " + _core_prompt_format_field_references(_core_prompt_format_description(field.description), field_map)
        rows.append((field.title + ":" + description).strip())
    return "\n".join(rows)


def _core_prompt_render_output_fields(fields, field_map: dict[str, str]) -> str:
    rows = []
    for field in fields:
        type_text = _core_prompt_field_type_text(field.type) if field.type else "string"
        required = (
            f"Only include this {type_text} field if its value is available"
            if field.is_optional
            else f"This {type_text} field must be included"
        )
        description = ""
        if field.description:
            value = field.description if field.type and field.type.name == "class" else _core_prompt_format_description(field.description)
            description = " " + _core_prompt_format_field_references(value, field_map)
        if field.type and field.type.options:
            if description:
                description += ". "
            description += "Allowed values: " + ", ".join(field.type.options)
        rows.append((field.title + f": ({required})" + description).strip())
    return "\n".join(rows)


def _core_prompt_function_descriptors(functions) -> list[dict[str, Any]]:
    out = []
    for item in functions or []:
        if isinstance(item, dict):
            out.append({"name": item.get("name"), "description": item.get("description", "")})
        else:
            out.append({"name": getattr(item, "name", None), "description": getattr(item, "description", "")})
    return [item for item in out if item.get("name")]


def _core_prompt_render_functions_section(funcs) -> str:
    return "\n".join(f"- {BT}{item['name']}{BT}: {_core_prompt_format_description(item.get('description') or '')}" for item in funcs)


def _core_prompt_identity_section(signature, values=None) -> str:
    in_args = _core_prompt_render_desc_fields(_core_prompt_input_fields_for_values(signature, values))
    out_args = _core_prompt_render_desc_fields(_core_prompt_get_output_fields(signature))
    return f"You will be provided with the following fields: {in_args}. Your task is to generate new fields: {out_args}."


def _core_prompt_task_definition_section(signature) -> str:
    desc = _core_prompt_get_description(signature)
    if not desc:
        return ""
    return _core_prompt_format_field_references(_core_prompt_format_description(desc), _core_prompt_field_name_to_title(signature))


def _core_prompt_input_fields_section(signature, values=None) -> str:
    fields = _core_prompt_render_input_fields(_core_prompt_input_fields_for_values(signature, values), _core_prompt_field_name_to_title(signature))
    return "**Input Fields**: The following fields will be provided to you:\n\n" + fields


def _core_prompt_output_fields_section(signature) -> str:
    fields = _core_prompt_render_output_fields(_core_prompt_get_output_fields(signature), _core_prompt_field_name_to_title(signature))
    return "**Output Fields**: You must generate the following fields:\n\n" + fields


def _core_prompt_structured(signature, values, functions, options) -> str:
    values = values or {}
    options = options or {}
    has_complex_fields = _core_prompt_has_complex_fields(signature)
    task_definition = _core_prompt_task_definition_section(signature)
    funcs = _core_prompt_function_descriptors(functions)
    template_vars = {
        "hasFunctions": len(funcs) > 0,
        "hasTaskDefinition": bool(task_definition),
        "hasExampleDemonstrations": bool(options.get("has_example_demonstrations", options.get("hasExampleDemonstrations", False))),
        "hasOutputFields": not has_complex_fields,
        "hasComplexFields": has_complex_fields,
        "hasStructuredOutputFunction": bool(has_complex_fields and options.get("structured_output_function_name")),
        "identityText": _core_prompt_identity_section(signature, values),
        "taskDefinitionText": task_definition,
        "functionsList": _core_prompt_render_functions_section(funcs) if funcs else "",
        "inputFieldsSection": _core_prompt_input_fields_section(signature, values),
        "outputFieldsSection": _core_prompt_output_fields_section(signature) if not has_complex_fields else "",
        "structuredOutputFunctionName": options.get("structured_output_function_name") or "",
    }
    source = options.get("custom_template")
    context = "inline-template"
    if source is None:
        source = DEFAULT_DSPY_TEMPLATE
        context = "template:dsp/dspy.md"
    return render_template_content(source, template_vars, context).strip()


def _core_prompt_process_value(field, value):
    if isinstance(value, str):
        return value
    if field.type and field.type.name in ("image", "audio", "file", "url") and isinstance(value, dict):
        return value
    return json.dumps(value, indent=2)


def _core_prompt_default_render_in_field(field, value):
    typ = field.type.name if field.type else "string"
    if typ in ("image", "audio", "file", "url"):
        if isinstance(value, list):
            parts = [{"type": "text", "text": f"{field.title}: "}]
            parts.extend(value)
            return parts
        if isinstance(value, dict):
            part = dict(value)
            part.setdefault("type", typ)
            return [{"type": "text", "text": f"{field.title}: "}, part]
    part = {"type": "text", "text": f"{field.title}: {value}"}
    if getattr(field, "is_cached", False):
        part["cache"] = True
    return [part]


def _core_prompt_render_in_field(field, values: dict):
    value = values.get(field.name)
    if not _core_prompt_is_provided_value(value):
        if field.is_optional or field.is_internal:
            return None
        raise ValueError(f"Value for input field '{field.name}' is required.")
    return _core_prompt_default_render_in_field(field, _core_prompt_process_value(field, value))


def _core_prompt_user_parts(signature, values: dict):
    out = []
    for field in _core_prompt_input_fields_for_values(signature, values):
        rendered = _core_prompt_render_in_field(field, values)
        if rendered is not None:
            out.extend(rendered)
    for part in out:
        if part.get("type") == "text":
            part["text"] = part.get("text", "") + "\n"
    return out


def _core_prompt_combine_consecutive_text(parts, separator: str):
    out = []
    for part in parts:
        if part.get("type") == "text" and out and out[-1].get("type") == "text":
            out[-1]["text"] = out[-1].get("text", "") + separator + part.get("text", "")
        else:
            out.append(part)
    return out


def _core_prompt_user_content(signature, values):
    parts = _core_prompt_user_parts(signature, values or {})
    if all(part.get("type") == "text" and not part.get("cache") for part in parts):
        return "\n".join(part.get("text", "") for part in parts)
    return _core_prompt_combine_consecutive_text(parts, "\n")


# AXIR_CORE_PROMPT_FUNCTIONS


class AxPromptTemplate:
    def __init__(
        self,
        signature,
        *,
        functions=None,
        thought_field_name: str = "thought",
        structured_output_function_name: str | None = None,
        custom_template: str | None = None,
        **kwargs,
    ):
        self.signature = signature
        self.functions = list(functions if functions is not None else kwargs.get("functions") or [])
        self.thought_field_name = kwargs.get("thoughtFieldName", thought_field_name)
        self.structured_output_function_name = kwargs.get("structuredOutputFunctionName", structured_output_function_name)
        self.custom_template = kwargs.get("customTemplate", custom_template)
        self.instruction = None

    def set_instruction(self, instruction: str):
        self.instruction = instruction

    def get_instruction(self):
        return self.instruction

    def clear_instruction(self):
        self.instruction = None

    def render(self, values: dict, options: dict | None = None):
        render_options = dict(options or {})
        if self.instruction is not None:
            render_options["instruction"] = self.instruction
        if self.structured_output_function_name is not None:
            render_options["structured_output_function_name"] = self.structured_output_function_name
        if self.custom_template is not None:
            render_options["custom_template"] = self.custom_template
        return render_prompt(self.signature, values or {}, self.functions, render_options)
`

const pyAI = `from __future__ import annotations

import copy
import json
import os
import time
import uuid
import urllib.error
import urllib.request
from typing import Any, Callable, Iterable


class AxAIServiceError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        response_body: Any = None,
        request: Any = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.response_body = response_body
        self.request = request
        self.retryable = retryable


class AxAIServiceStatusError(AxAIServiceError):
    pass


class AxAIServiceNetworkError(AxAIServiceError):
    pass


class AxAIServiceResponseError(AxAIServiceError):
    pass


class AxAIServiceStreamTerminatedError(AxAIServiceError):
    pass


class AxAIServiceTimeoutError(AxAIServiceError):
    pass


class AxAIServiceAuthenticationError(AxAIServiceError):
    pass


class AxAIRefusalError(AxAIServiceError):
    pass


class AxUnsupportedCapabilityError(AxAIServiceError):
    pass


def ai(provider: str = "openai", **options):
    normalized = provider.replace("-", "_").lower()
    if normalized in ("openai", "openai_compatible", "compatible"):
        return OpenAICompatibleClient(**options)
    raise ValueError(f"unsupported AxAI provider: {provider}")


def default_features() -> dict[str, Any]:
    return {
        "functions": True,
        "streaming": True,
        "structured_outputs": True,
        "media": {
            "images": {"supported": True, "formats": ["image/jpeg", "image/png", "image/webp"]},
            "audio": {"supported": False, "formats": [], "output": {"supported": False, "formats": []}},
            "files": {"supported": False, "formats": [], "upload_method": "none"},
            "urls": {"supported": False, "web_search": False, "context_fetching": False},
        },
        "caching": {"supported": False, "types": []},
        "thinking": False,
        "multi_turn": True,
    }


def default_metrics() -> dict[str, Any]:
    return {
        "latency": {
            "chat": {"mean": 0.0, "p95": 0.0, "p99": 0.0, "samples": []},
            "embed": {"mean": 0.0, "p95": 0.0, "p99": 0.0, "samples": []},
        },
        "errors": {
            "chat": {"count": 0, "rate": 0.0, "total": 0},
            "embed": {"count": 0, "rate": 0.0, "total": 0},
        },
    }


class AxAIService:
    def get_id(self) -> str:
        raise NotImplementedError

    def get_name(self) -> str:
        raise NotImplementedError

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        raise NotImplementedError

    def get_model_list(self):
        return None

    def get_metrics(self) -> dict[str, Any]:
        raise NotImplementedError

    def get_logger(self):
        return lambda _message: None

    def get_last_used_chat_model(self):
        return None

    def get_last_used_embed_model(self):
        return None

    def get_last_used_model_config(self):
        return None

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        raise NotImplementedError

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        stream_request = copy.deepcopy(_coerce_chat_request(request))
        stream_request.setdefault("model_config", {})["stream"] = True
        result = self.chat(stream_request, {**(options or {}), "stream": True})
        if isinstance(result, dict):
            yield result
        else:
            yield from result

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        raise NotImplementedError

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        raise AxUnsupportedCapabilityError("transcribe is not supported by this generated AxAI beta provider")

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        raise AxUnsupportedCapabilityError("speak is not supported by this generated AxAI beta provider")

    def get_estimated_cost(self, model_usage: dict[str, Any] | None = None) -> float:
        return 0.0

    def set_options(self, options: dict[str, Any]):
        raise NotImplementedError

    def get_options(self) -> dict[str, Any]:
        raise NotImplementedError

    def complete(self, request: dict[str, Any]) -> dict[str, Any]:
        return chat_response_to_completion(self.chat(_coerce_chat_request(request)))


class AIClient(AxAIService):
    pass


class AxBaseAI(AIClient):
    def __init__(
        self,
        *,
        name: str,
        model: str,
        embed_model: str | None = None,
        model_config: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
        features: dict[str, Any] | None = None,
    ):
        if not model:
            raise ValueError("No model defined")
        self.name = name
        self.id = str(uuid.uuid4())
        self.model = model
        self.embed_model = embed_model
        self.model_config = {"temperature": 0, **(model_config or {})}
        self.options = dict(options or {})
        self.features = copy.deepcopy(features or default_features())
        self.metrics = default_metrics()
        self.last_used_chat_model = None
        self.last_used_embed_model = None
        self.last_used_model_config = None

    def get_id(self) -> str:
        return self.id

    def get_name(self) -> str:
        return self.name

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        return copy.deepcopy(self.features)

    def get_metrics(self) -> dict[str, Any]:
        return copy.deepcopy(self.metrics)

    def get_last_used_chat_model(self):
        return self.last_used_chat_model

    def get_last_used_embed_model(self):
        return self.last_used_embed_model

    def get_last_used_model_config(self):
        return copy.deepcopy(self.last_used_model_config)

    def set_options(self, options: dict[str, Any]):
        self.options = dict(options)

    def get_options(self) -> dict[str, Any]:
        return copy.deepcopy(self.options)

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        started = time.perf_counter()
        is_error = False
        try:
            req = _coerce_chat_request(request)
            validate_chat_request(req)
            merged_options = {**self.options, **(options or {})}
            model = req.get("model") or self.model
            model_config = merge_model_config(self.model_config, req.get("model_config"), merged_options)
            if merged_options.get("stream") is not None:
                model_config["stream"] = bool(merged_options["stream"])
            req = {**req, "model": model, "model_config": model_config}
            self.last_used_chat_model = model
            self.last_used_model_config = copy.deepcopy(model_config)
            return self._chat(req, merged_options)
        except Exception:
            is_error = True
            raise
        finally:
            self._record_metrics("chat", time.perf_counter() - started, is_error)

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        started = time.perf_counter()
        is_error = False
        try:
            texts = request.get("texts")
            if not texts:
                raise AxAIServiceResponseError("Embed texts is empty")
            embed_model = request.get("embed_model") or request.get("embedModel") or self.embed_model
            if not embed_model:
                raise AxAIServiceResponseError("Embed model not set")
            req = {**request, "texts": list(texts), "embed_model": embed_model}
            self.last_used_embed_model = embed_model
            return self._embed(req, {**self.options, **(options or {})})
        except Exception:
            is_error = True
            raise
        finally:
            self._record_metrics("embed", time.perf_counter() - started, is_error)

    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        raise NotImplementedError

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        raise NotImplementedError

    def _record_metrics(self, kind: str, duration_seconds: float, is_error: bool):
        bucket = self.metrics["latency"][kind]
        bucket["samples"].append(duration_seconds * 1000)
        samples = bucket["samples"]
        bucket["mean"] = sum(samples) / len(samples)
        ordered = sorted(samples)
        bucket["p95"] = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
        bucket["p99"] = ordered[min(len(ordered) - 1, int(len(ordered) * 0.99))]
        errors = self.metrics["errors"][kind]
        errors["total"] += 1
        if is_error:
            errors["count"] += 1
        errors["rate"] = errors["count"] / errors["total"] if errors["total"] else 0.0


class OpenAICompatibleClient(AxBaseAI):
    def __init__(
        self,
        model: str = "gpt-4.1-mini",
        embed_model: str = "text-embedding-3-small",
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 60.0,
        options: dict[str, Any] | None = None,
        model_config: dict[str, Any] | None = None,
        transport: Callable[[dict[str, Any]], Any] | None = None,
    ):
        super().__init__(
            name="openai",
            model=model,
            embed_model=embed_model,
            model_config=model_config,
            options=options,
            features=default_features(),
        )
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.timeout = timeout
        self.transport = transport

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        return False

    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        payload = openai_build_chat_request(request)
        if payload.get("stream"):
            return self._stream_chat(payload, request)
        raw = self._request_json("/chat/completions", payload, stream=False)
        return openai_normalize_chat_response(raw, self.name, payload.get("model"))

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        payload = openai_build_embed_request(request)
        raw = self._request_json("/embeddings", payload, stream=False)
        return openai_normalize_embed_response(raw, self.name, payload.get("model"))

    def _stream_chat(self, payload: dict[str, Any], request: dict[str, Any]):
        raw = self._request_json("/chat/completions", payload, stream=True)
        state: dict[str, Any] = {}
        for event in _iter_sse_json(raw):
            yield openai_normalize_stream_delta(event, state, self.name, payload.get("model"))

    def _request_json(self, endpoint: str, payload: dict[str, Any], *, stream: bool):
        call = {
            "method": "POST",
            "url": self.base_url + endpoint,
            "headers": self._headers(),
            "json": payload,
            "stream": stream,
        }
        if self.transport:
            try:
                return _transport_result(self.transport(call), call)
            except AxAIServiceError:
                raise
            except TimeoutError as exc:
                raise AxAIServiceTimeoutError("OpenAI-compatible request timed out", request=call, retryable=True) from exc
            except OSError as exc:
                raise AxAIServiceNetworkError(str(exc), request=call, retryable=True) from exc
        if not self.api_key:
            raise AxAIServiceAuthenticationError("OPENAI_API_KEY is required")
        req = urllib.request.Request(
            call["url"],
            data=json.dumps(payload).encode(),
            headers=call["headers"],
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                body = res.read().decode()
                return body if stream else json.loads(body)
        except TimeoutError as exc:
            raise AxAIServiceTimeoutError("OpenAI-compatible request timed out", request=call, retryable=True) from exc
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = body
            raise openai_normalize_error(exc.code, parsed, call) from exc
        except OSError as exc:
            raise AxAIServiceNetworkError(str(exc), request=call, retryable=True) from exc

    def _headers(self):
        return {
            "Authorization": "Bearer " + (self.api_key or ""),
            "Content-Type": "application/json",
        }


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_gte(left, right): return left >= right
def _core_contains(container, item): return False if container is None else item in container
def _core_len(value): return len(value or [])
def _core_truthy(value): return bool(value)
def _core_is_none(value): return value is None
def _core_is_not_none(value): return value is not None
def _core_none(): return None
def _core_coalesce(value, fallback): return fallback if value is None else value


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_type_is(value, type_name):
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "list":
        return isinstance(value, list)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "null":
        return value is None
    if type_name == "json":
        return value is None or isinstance(value, (dict, list, str, int, float, bool))
    return False


def _core_map_merge(left, right):
    out = dict(left or {})
    out.update(right or {})
    return out


def _core_map_contains(values, key):
    return isinstance(values, dict) and key in values


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_json_parse(value):
    return json.loads(value)


def _core_json_stringify(value):
    return json.dumps(value or {})


def _core_string_starts_with(value, prefix):
    return isinstance(value, str) and value.startswith(str(prefix))


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_str(value):
    return str(value)


def _core_ai_error_response(message, response_body=None):
    return AxAIServiceResponseError(str(message), response_body=response_body)


def _core_ai_error_refusal(message, response_body=None):
    return AxAIRefusalError(str(message), response_body=response_body)


def _core_ai_error_stream(message, response_body=None, retryable=True):
    return AxAIServiceStreamTerminatedError(str(message), response_body=response_body, retryable=bool(retryable))


def _core_ai_error_unsupported(message):
    return AxUnsupportedCapabilityError(str(message))


def _core_ai_error_auth(message, status=None, code=None, response_body=None, request=None):
    return AxAIServiceAuthenticationError(str(message), status=status, code=code, response_body=response_body, request=request)


def _core_ai_error_timeout(message, status=None, code=None, response_body=None, request=None, retryable=True):
    return AxAIServiceTimeoutError(str(message), status=status, code=code, response_body=response_body, request=request, retryable=bool(retryable))


def _core_ai_error_status(message, status=None, code=None, response_body=None, request=None, retryable=False):
    return AxAIServiceStatusError(str(message), status=status, code=code, response_body=response_body, request=request, retryable=bool(retryable))


# AXIR_CORE_AI_FUNCTIONS


def _coerce_chat_request(request: dict[str, Any]):
    if "chat_prompt" in request:
        return copy.deepcopy(request)
    if "chatPrompt" in request:
        out = copy.deepcopy(request)
        out["chat_prompt"] = out.pop("chatPrompt")
        return out
    if "messages" in request:
        return {
            "chat_prompt": copy.deepcopy(request["messages"]),
            "functions": request.get("functions") or _tools_to_functions(request.get("tools") or []),
            "function_call": request.get("function_call") or request.get("tool_choice"),
            "response_format": request.get("response_format"),
            "model": request.get("model"),
            "model_config": request.get("model_config") or {},
        }
    return copy.deepcopy(request)


def _tools_to_functions(tools):
    out = []
    for tool in tools:
        fn = tool.get("function", tool)
        out.append({"name": fn.get("name"), "description": fn.get("description", ""), "parameters": fn.get("parameters")})
    return out


def _transport_result(result: Any, request: dict[str, Any]):
    if isinstance(result, tuple):
        status, body = result[0], result[1]
        result = {"status": status, "json": body}
    if isinstance(result, dict) and "status" in result:
        status = int(result.get("status") or 200)
        body = result.get("json", result.get("body", result.get("data")))
        if status >= 400:
            raise openai_normalize_error(status, body, request)
        return body
    return result


def _iter_sse_json(raw: Any):
    if isinstance(raw, list):
        for item in raw:
            if item != "[DONE]":
                yield item
        return
    text = raw.decode() if isinstance(raw, bytes) else str(raw)
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        yield json.loads(data)
`

const pyGen = `from __future__ import annotations

import json
import time
from typing import Any

from .ai import AIClient, chat_response_to_completion
from .prompt import AxPromptTemplate
from .schema import strip_internal, validate_fields, validate_output
from .signature import AxSignature


class AxMemory:
    def __init__(self):
        self.items: list[dict[str, Any]] = []

    def add_request(self, messages, session_id: str | None = None):
        self.items.append({"role": "request", "messages": messages, "session_id": session_id, "tags": []})
        return self

    def add_response(self, response, session_id: str | None = None):
        self.items.append({"role": "assistant", "response": response, "session_id": session_id, "tags": []})
        return self

    def update_result(self, result, session_id: str | None = None):
        item = {"role": "assistant", "response": result, "session_id": session_id, "tags": []}
        for existing in reversed(self.items):
            if existing.get("role") == "assistant" and existing.get("session_id") == session_id:
                existing.update(item)
                return self
        self.items.append(item)
        return self

    def add_function_results(self, results, session_id: str | None = None):
        if not isinstance(results, list):
            results = [results]
        self.items.append({"role": "function", "results": results, "session_id": session_id, "tags": []})
        return self

    def history(self, index: int | None = None):
        if index is None:
            return list(self.items)
        return [item for item in self.items if item.get("index") == index]

    def get_last(self, session_id: str | None = None):
        for item in reversed(self.items):
            if session_id is None or item.get("session_id") == session_id:
                return item
        return None

    def add_tag(self, tag: str):
        if self.items:
            tags = self.items[-1].setdefault("tags", [])
            if tag not in tags:
                tags.append(tag)
        return self

    def rewind_to_tag(self, tag: str):
        for idx in range(len(self.items) - 1, -1, -1):
            if tag in (self.items[idx].get("tags") or []):
                self.items = self.items[: idx + 1]
                return self
        return self

    def remove_by_tag(self, tag: str):
        self.items = [item for item in self.items if tag not in (item.get("tags") or [])]
        return self


class AxGen:
    def __init__(self, signature, options: dict[str, Any] | None = None):
        self.signature = signature if isinstance(signature, AxSignature) else AxSignature(signature)
        self.options = options or {}
        self.functions = list(self.options.get("functions") or [])
        self.examples = list(self.options.get("examples") or [])
        self.demos = list(self.options.get("demos") or [])
        self.assertions = list(self.options.get("assertions") or [])
        self.field_processors = list(self.options.get("field_processors") or self.options.get("fieldProcessors") or [])
        self.stop_functions = list(self.options.get("stop_functions") or self.options.get("stopFunctions") or [])
        self.memory = self.options.get("memory") or self.options.get("mem") or AxMemory()
        self.chat_log: list[dict[str, Any]] = []
        self.function_call_traces: list[dict[str, Any]] = []
        self.traces: list[dict[str, Any]] = []
        self.prompt_template = AxPromptTemplate(
            self.signature,
            functions=self.functions,
            structured_output_function_name=self.options.get("structured_output_function_name", self.options.get("structuredOutputFunctionName")),
            custom_template=self.options.get("custom_template", self.options.get("customTemplate")),
        )

    def set_examples(self, examples):
        self.examples = list(examples or [])
        self.options["has_example_demonstrations"] = bool(self.examples or self.demos)
        return self

    def set_demos(self, demos):
        self.demos = list(demos or [])
        self.options["has_example_demonstrations"] = bool(self.examples or self.demos)
        return self

    def add_assertion(self, assertion):
        self.assertions.append(assertion)
        return self

    def add_field_processor(self, field, processor):
        self.field_processors.append({"field": field, "processor": processor})
        return self

    def set_stop_functions(self, names):
        self.stop_functions = list(names or [])
        return self

    def get_traces(self):
        return list(self.traces)

    def get_chat_log(self):
        return list(self.chat_log)

    def get_memory(self):
        return self.memory

    def get_function_call_traces(self):
        return list(self.function_call_traces)

    def forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        return _forward_impl(self, client, values, options)

    def streaming_forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        validate_fields(self.signature.get_input_fields(), values, "input")
        stream_options = {**self.options, **(options or {}), "stream": True}
        req = self._request(self.prompt_template.render(values), stream_options)
        chunks = []
        for event in client.stream(req):
            chunks.append(event)
            yield event
        content = fold_stream(chunks)
        if content:
            output = _parse_output_impl(content)
            validate_output(self.signature.get_output_fields(), output)

    def _request(self, messages, options):
        return _build_gen_chat_request(self, messages, options or {})

    def _execute_tool(self, call):
        return _execute_tool_call(self.functions, call)


def ax(signature, options: dict[str, Any] | None = None) -> AxGen:
    return AxGen(signature, options)


def _core_not(value): return not value
def _core_or(left, right): return bool(left or right)
def _core_eq(left, right): return left == right
def _core_gt(left, right): return left > right
def _core_gte(left, right): return left >= right
def _core_add(left, right): return left + right
def _core_len(value): return len(value)
def _core_truthy(value): return bool(value)
def _core_is_none(value): return value is None
def _core_is_not_none(value): return value is not None
def _core_none(): return None


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_type_is(value, type_name):
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "list":
        return isinstance(value, list)
    if type_name == "null":
        return value is None
    if type_name == "json":
        return value is None or isinstance(value, (dict, list, str, int, float, bool))
    return False


def _core_map_merge(left, right):
    merged = dict(left or {})
    merged.update(right or {})
    return merged


def _core_object_call_method(target, method_name, *args):
    return getattr(target, str(method_name))(*args)


def _core_json_parse(value):
    text = str(value).strip()
    fence = chr(96) * 3
    if text.startswith(fence):
        text = text.strip(chr(96))
        if text.startswith("json"):
            text = text[4:].strip()
    return json.loads(text)


def _core_json_stringify(value):
    return json.dumps(value)


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_ai_complete_once(client, request):
    if hasattr(client, "chat"):
        try:
            return chat_response_to_completion(client.chat(request))
        except NotImplementedError:
            pass
    return client.complete(request)


def _core_retry_sleep(attempt):
    time.sleep(min(0.25 * (int(attempt) + 1), 1.0))


def _core_exception_message(error):
    return str(error)


def _core_runtime_error(message):
    return RuntimeError(str(message))


def _core_tool_invoke(fn, params):
    return fn.call(params or {})


def _core_stream_event_content_parts(event) -> list[str]:
    if isinstance(event, str):
        return [event]
    if not isinstance(event, dict):
        return []
    data = event.get("data") if isinstance(event.get("data"), dict) else event
    if data.get("type") in ("done", "message_stop"):
        return []
    if data.get("results"):
        return [(result.get("content") or "") for result in data.get("results") or []]
    return [
        data.get("delta")
        or data.get("content_delta")
        or data.get("contentDelta")
        or data.get("text")
        or data.get("content")
        or ""
    ]


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in values)


def _core_axgen_value_text(value):
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True)


def _core_axgen_fields_for(gen, kind):
    sig = _core_get(gen, "signature")
    return list(_core_get(sig, f"{kind}_fields", []) or [])


def _core_axgen_format_values(gen, values, kind):
    values = values or {}
    fields = _core_axgen_fields_for(gen, kind)
    lines = []
    for field in fields:
        name = _core_get(field, "name")
        if name in values:
            title = _core_get(field, "title", name)
            lines.append(f"{title}: {_core_axgen_value_text(values[name])}")
    if not lines:
        for name, value in values.items():
            lines.append(f"{name}: {_core_axgen_value_text(value)}")
    return "\n".join(lines)


def _core_axgen_example_turn(gen, label, item):
    item = item or {}
    inp = item.get("input", item.get("values", {}))
    out = item.get("output", item.get("expected_output", {}))
    user = {
        "role": "user",
        "content": f"{label} Input:\n{_core_axgen_format_values(gen, inp, 'input')}",
    }
    assistant = {
        "role": "assistant",
        "content": f"{label} Output:\n{_core_axgen_format_values(gen, out, 'output')}",
    }
    return [user, assistant]


def _core_axgen_render_examples(gen):
    if _core_get(_core_get(gen, "options", {}), "examplesInSystem", False):
        return []
    messages = []
    for item in _core_get(gen, "examples", []) or []:
        messages.extend(_core_axgen_example_turn(gen, "Example", item))
    return messages


def _core_axgen_render_demos(gen):
    if _core_get(_core_get(gen, "options", {}), "examplesInSystem", False):
        return []
    messages = []
    for item in _core_get(gen, "demos", []) or []:
        if not (item or {}).get("input", (item or {}).get("values")):
            continue
        messages.extend(_core_axgen_example_turn(gen, "Demo", item))
    return messages


def _core_axgen_apply_context_cache(gen, messages):
    messages = [dict(item) if isinstance(item, dict) else item for item in (messages or [])]
    options = _core_get(gen, "options", {}) or {}
    if options.get("examplesInSystem") and messages:
        blocks = []
        for item in _core_get(gen, "examples", []) or []:
            for message in _core_axgen_example_turn(gen, "Example", item):
                blocks.append(message.get("content", ""))
        for item in _core_get(gen, "demos", []) or []:
            if not (item or {}).get("input", (item or {}).get("values")):
                continue
            for message in _core_axgen_example_turn(gen, "Demo", item):
                blocks.append(message.get("content", ""))
        if blocks and isinstance(messages[0], dict):
            messages[0]["content"] = str(messages[0].get("content", "")) + "\n\n--- EXAMPLES ---\n" + "\n\n".join(blocks) + "\n--- END OF EXAMPLES ---"
    context_cache = options.get("context_cache", options.get("contextCache"))
    if not context_cache or options.get("ignore_cache_breakpoints"):
        return messages
    if messages and isinstance(messages[0], dict):
        messages[0]["cache"] = True
    if isinstance(context_cache, dict):
        breakpoint = context_cache.get("breakpoint") or context_cache.get("cache_breakpoint") or context_cache.get("cacheBreakpoint")
    else:
        breakpoint = "after_examples"
    if breakpoint in (None, "after_examples", "afterExamples") and len(messages) > 2:
        for idx in range(len(messages) - 2, -1, -1):
            if messages[idx].get("role") in ("assistant", "tool"):
                messages[idx]["cache"] = True
                break
    return messages


def _core_axgen_apply_field_processors(gen, output):
    result = dict(output or {})
    changed = False
    for spec in _core_get(gen, "field_processors", []) or []:
        if callable(spec):
            processed = spec(dict(result))
            if processed is not None:
                result = dict(processed)
                changed = True
            continue
        field = spec.get("field") or spec.get("name")
        if not field or field not in result:
            continue
        processor = spec.get("processor", spec.get("op"))
        if callable(processor):
            result[field] = processor(result[field])
            changed = True
            continue
        op = str(processor)
        value = result[field]
        if op == "uppercase":
            result[field] = str(value).upper()
            changed = True
        elif op == "lowercase":
            result[field] = str(value).lower()
            changed = True
        elif op == "trim":
            result[field] = str(value).strip()
            changed = True
        elif op.startswith("prefix:"):
            result[field] = op.removeprefix("prefix:") + str(value)
            changed = True
        elif op.startswith("suffix:"):
            result[field] = str(value) + op.removeprefix("suffix:")
            changed = True
    if changed:
        memory = _core_get(gen, "memory")
        if memory is not None and hasattr(memory, "items"):
            memory.items.append({"role": "processor", "output": dict(result), "tags": ["processor"]})
    return result


def _core_axgen_run_assertions(gen, output):
    for assertion in _core_get(gen, "assertions", []) or []:
        if callable(assertion):
            result = assertion(output)
            if isinstance(result, str):
                raise RuntimeError(result)
            if result is False:
                raise RuntimeError("assertion failed")
            continue
        field = assertion.get("field")
        value = output.get(field) if field else output
        message = assertion.get("message") or "assertion failed"
        if "return" in assertion:
            returned = assertion.get("return")
            if returned is None:
                continue
            if returned is False and "message" not in assertion:
                raise RuntimeError("assertion failed without message")
            if returned is False:
                raise RuntimeError(str(message))
            if isinstance(returned, str):
                raise RuntimeError(returned)
        if "contains" in assertion and str(assertion["contains"]) not in str(value):
            raise RuntimeError(str(message))
        if "equals" in assertion and value != assertion["equals"]:
            raise RuntimeError(str(message))
    return None


def _core_axgen_record_trace(gen, values, output, status):
    traces = _core_get(gen, "traces", [])
    traces.append({
        "status": status,
        "input": values,
        "output": output,
        "chat_log": list(_core_get(gen, "chat_log", []) or []),
        "function_calls": list(_core_get(gen, "function_call_traces", []) or []),
    })
    return None


def _core_axgen_should_continue_steps(gen, calls):
    stops = set(_core_get(gen, "stop_functions", []) or [])
    if not stops:
        return True
    for call in calls or []:
        name = _core_get(_core_get(call, "function", {}), "name", _core_get(call, "name", None))
        if name in stops:
            return False
    return True


def _core_axgen_memory_add_request(gen, messages):
    memory = _core_get(gen, "memory")
    if memory is not None and hasattr(memory, "add_request"):
        memory.add_request(messages)
    return None


def _core_axgen_memory_add_response(gen, request, response):
    memory = _core_get(gen, "memory")
    if memory is not None and hasattr(memory, "add_response"):
        memory.add_response(response)
    return None


def _core_axgen_memory_add_function_result(gen, call, result, ok):
    memory = _core_get(gen, "memory")
    if memory is not None and hasattr(memory, "add_function_results"):
        memory.add_function_results({"call": call, "result": result, "ok": bool(ok)})
    return None


def _core_axgen_memory_add_correction(gen, response, error):
    memory = _core_get(gen, "memory")
    if memory is not None and hasattr(memory, "items"):
        memory.items.append({"role": "user", "content": f"Correction: {_core_exception_message(error)}", "response": response, "tags": ["correction"]})
    return None


def _core_axgen_memory_cleanup_corrections(gen):
    memory = _core_get(gen, "memory")
    if memory is not None and hasattr(memory, "remove_by_tag"):
        memory.remove_by_tag("correction")
    return None


def _core_axgen_record_chat_log(gen, request, response):
    chat_log = _core_get(gen, "chat_log", [])
    entry = {
        "model": _core_get(request, "model"),
        "messages": _core_get(request, "chat_prompt", []),
        "response": response,
        "remote_id": _core_get(response, "remote_id", _core_get(response, "id")),
        "session_id": _core_get(response, "session_id"),
        "usage": _core_get(response, "usage", _core_get(response, "model_usage")),
        "function_calls": _core_get(response, "function_calls", []),
    }
    chat_log.append(entry)
    return None


def _core_axgen_record_function_call(gen, call, result, status):
    traces = _core_get(gen, "function_call_traces", [])
    record = {
        "name": _core_get(call, "name", _core_get(_core_get(call, "function", {}), "name")),
        "id": _core_get(call, "id"),
        "args": _core_get(call, "params", _core_get(call, "args", {})),
        "status": status,
        "result": result,
    }
    traces.append(record)
    hook = _core_get(_core_get(gen, "options", {}), "on_function_call", _core_get(_core_get(gen, "options", {}), "onFunctionCall"))
    if callable(hook):
        try:
            hook(record)
        except Exception:
            pass
    return None


# AXIR_CORE_GEN_FUNCTIONS
`

const pyConformance = `from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any

from .ai import AxAIServiceError, AxBaseAI, OpenAICompatibleClient
from .gen import ax, fold_stream
from .prompt import AxPromptTemplate, render_template_content, validate_prompt_template_syntax
from .schema import strip_internal, to_json_schema, validate_output, validate_value
from .signature import AxSignature, f, s
from .tool import fn


class FixtureError(AssertionError):
    pass


class FakeAIService(AxBaseAI):
    def __init__(self, responses=None, stream_events=None):
        super().__init__(name="fake", model="fake-chat", embed_model="fake-embed")
        self.responses = list(responses or [])
        self.stream_events = list(stream_events or [])
        self.requests = []
        self.chat_calls = 0

    def _chat(self, request: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
        self.chat_calls += 1
        self.requests.append(copy.deepcopy(request))
        if not self.responses:
            raise RuntimeError("fake client exhausted")
        return _legacy_response_to_chat_response(copy.deepcopy(self.responses.pop(0)))

    def _embed(self, request: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(copy.deepcopy(request))
        if not self.responses:
            raise RuntimeError("fake client exhausted")
        return copy.deepcopy(self.responses.pop(0))

    def stream(self, request: dict[str, Any]):
        self.requests.append(copy.deepcopy(request))
        for event in self.stream_events:
            yield copy.deepcopy(event)


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses or [])
        self.requests = []

    def __call__(self, request):
        self.requests.append(copy.deepcopy(request))
        if not self.responses:
            raise RuntimeError("fake transport exhausted")
        return copy.deepcopy(self.responses.pop(0))


def run_fixtures(paths):
    results = []
    for path in _expand_paths(paths):
        results.append(run_fixture_path(path))
    return results


def run_fixture_path(path):
    data = json.loads(Path(path).read_text())
    return run_fixture(data, source=str(path))


def run_fixture(fixture: dict[str, Any], *, source: str | None = None):
    name = fixture.get("name") or source or "<fixture>"
    kind = fixture.get("kind", "forward")
    try:
        if kind == "signature_error":
            _run_signature_error(fixture)
        elif kind == "signature":
            _run_signature(fixture)
        elif kind == "json_schema":
            _run_json_schema(fixture)
        elif kind == "prompt":
            _run_prompt(fixture)
        elif kind == "template":
            _run_template(fixture)
        elif kind == "template_error":
            _run_template_error(fixture)
        elif kind == "template_validate":
            _run_template_validate(fixture)
        elif kind == "stream":
            _run_stream(fixture)
        elif kind == "validate_value":
            _run_validate_value(fixture)
        elif kind == "validate_output":
            _run_validate_output(fixture)
        elif kind == "strip_internal":
            _run_strip_internal(fixture)
        elif kind == "forward":
            _run_forward(fixture)
        elif kind == "ai_chat":
            _run_ai_chat(fixture)
        elif kind == "ai_embed":
            _run_ai_embed(fixture)
        elif kind == "ai_stream":
            _run_ai_stream(fixture)
        elif kind == "ai_error":
            _run_ai_error(fixture)
        elif kind == "ai_unsupported":
            _run_ai_unsupported(fixture)
        else:
            raise FixtureError(f"unknown fixture kind {kind!r}")
    except Exception as exc:
        if isinstance(exc, FixtureError):
            raise
        raise FixtureError(f"{name}: {type(exc).__name__}: {exc}") from exc
    return {"name": name, "ok": True}


def _run_signature_error(fixture):
    try:
        _build_signature(fixture)
    except Exception as exc:
        expected_category = fixture.get("expected_error_category")
        if expected_category and _error_category(exc) != expected_category:
            raise FixtureError(f"expected error category {expected_category!r}, got {_error_category(exc)!r}")
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        return
    raise FixtureError("expected signature construction to fail")


def _run_signature(fixture):
    sig = _build_signature(fixture)
    _assert_equal(_signature_payload(sig), fixture["expected_signature"], "signature")


def _run_json_schema(fixture):
    sig = _build_signature(fixture)
    target = fixture.get("target", "outputs")
    fields = sig.get_input_fields() if target == "inputs" else sig.get_output_fields()
    schema = to_json_schema(fields, fixture.get("schema_title", "Schema"), fixture.get("schema_options") or {})
    _assert_equal(schema, fixture["expected_schema"], "json schema")


def _run_prompt(fixture):
    sig = _build_signature(fixture)
    tools, _ = _build_tools(fixture.get("tools") or [])
    options = fixture.get("options") or {}
    prompt = AxPromptTemplate(
        sig,
        functions=tools,
        custom_template=fixture.get("custom_template") or options.get("custom_template") or options.get("customTemplate"),
        structured_output_function_name=fixture.get("structured_output_function_name") or options.get("structured_output_function_name") or options.get("structuredOutputFunctionName"),
    )
    if fixture.get("instruction"):
        prompt.set_instruction(fixture["instruction"])
    messages = prompt.render(fixture.get("input") or fixture.get("values") or {})
    for item in fixture.get("expected_prompt_contains") or []:
        if item not in json.dumps(messages, sort_keys=True):
            raise FixtureError(f"prompt missing {item!r}: {messages!r}")
    if "expected_messages" in fixture:
        _assert_equal(messages, fixture["expected_messages"], "messages")


def _run_template(fixture):
    rendered = render_template_content(
        fixture["template"],
        fixture.get("vars") or {},
        fixture.get("context", "fixture-template"),
    )
    _assert_equal(rendered, fixture.get("expected_output", ""), "template output")


def _run_template_error(fixture):
    try:
        if fixture.get("operation") == "validate":
            result = validate_prompt_template_syntax(
                fixture["template"],
                fixture.get("context", "fixture-template"),
                fixture.get("required_variables") or [],
            )
            if result is not True:
                raise ValueError(result)
        else:
            render_template_content(
                fixture["template"],
                fixture.get("vars") or {},
                fixture.get("context", "fixture-template"),
            )
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        return
    raise FixtureError("expected template operation to fail")


def _run_template_validate(fixture):
    result = validate_prompt_template_syntax(
        fixture["template"],
        fixture.get("context", "fixture-template"),
        fixture.get("required_variables") or [],
    )
    _assert_equal(result, fixture.get("expected_result", True), "template validation")


def _run_stream(fixture):
    folded = fold_stream(fixture.get("stream_events") or [])
    _assert_equal(folded, fixture.get("expected_folded", ""), "stream fold")


def _run_validate_value(fixture):
    field = _field_for_validation(fixture)
    try:
        validate_value(field, fixture.get("value"))
    except Exception as exc:
        if "expected_error_contains" not in fixture:
            raise
        _assert_expected_error(exc, fixture)
        return
    if "expected_error_contains" in fixture:
        raise FixtureError("expected validate_value to fail")


def _run_validate_output(fixture):
    sig = _build_signature(fixture)
    values = copy.deepcopy(fixture.get("values") or {})
    try:
        result = validate_output(sig.get_output_fields(), values)
    except Exception as exc:
        if "expected_error_contains" not in fixture:
            raise
        _assert_expected_error(exc, fixture)
        return
    if "expected_error_contains" in fixture:
        raise FixtureError("expected validate_output to fail")
    _assert_equal(result, fixture.get("expected_values", values), "validated output")


def _run_strip_internal(fixture):
    sig = _build_signature(fixture)
    result = strip_internal(sig.get_output_fields(), fixture.get("values") or {})
    _assert_equal(result, fixture["expected_output"], "strip internal")


def _run_forward(fixture):
    sig = _build_signature(fixture)
    tools, tool_calls = _build_tools(fixture.get("tools") or [])
    options = {"functions": tools, **(fixture.get("options") or {})}
    gen = ax(sig, options)
    if "examples" in fixture:
        gen.set_examples(fixture.get("examples") or [])
    if "demos" in fixture:
        gen.set_demos(fixture.get("demos") or [])
    for assertion in fixture.get("assertions") or []:
        gen.add_assertion(assertion)
    for processor in fixture.get("field_processors") or fixture.get("fieldProcessors") or []:
        gen.add_field_processor(processor.get("field"), processor.get("processor", processor.get("op")))
    if "stop_functions" in fixture or "stopFunctions" in fixture:
        gen.set_stop_functions(fixture.get("stop_functions") or fixture.get("stopFunctions") or [])
    client = FakeAIService(fixture.get("responses") or [], fixture.get("stream_events") or [])
    try:
        output = gen.forward(client, fixture.get("input") or {}, fixture.get("forward_options"))
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected forward to fail")
    if "expected_output" in fixture:
        _assert_equal(output, fixture["expected_output"], "forward output")
    if "expected_request_count" in fixture and len(client.requests) != fixture["expected_request_count"]:
        raise FixtureError(f"expected {fixture['expected_request_count']} requests, got {len(client.requests)}")
    if fixture.get("expect_chat_path", True) and client.chat_calls == 0:
        raise FixtureError("expected AxGen to use AxAIService.chat()")
    if "expected_request" in fixture:
        if not client.requests:
            raise FixtureError("fixture expected a request but none were sent")
        _assert_subset(client.requests[0], fixture["expected_request"], "request")
    if "expected_request_contains" in fixture:
        request_text = json.dumps(client.requests, sort_keys=True)
        for item in fixture.get("expected_request_contains") or []:
            if str(item) not in request_text:
                raise FixtureError(f"request missing {item!r}: {request_text}")
    if "expected_tool_calls" in fixture:
        _assert_equal(tool_calls, fixture["expected_tool_calls"], "tool calls")
    if "expected_trace" in fixture:
        traces = gen.get_traces()
        if not traces:
            raise FixtureError("expected trace but none was recorded")
        _assert_subset(traces[-1], fixture["expected_trace"], "trace")
    if "expected_memory_history" in fixture:
        _assert_subset(gen.get_memory().history(), fixture["expected_memory_history"], "memory history")
    if "expected_memory_history_subset" in fixture:
        _assert_list_subset(gen.get_memory().history(), fixture["expected_memory_history_subset"], "memory history")
    if "expected_chat_log" in fixture:
        _assert_subset(gen.get_chat_log(), fixture["expected_chat_log"], "chat log")
    if "expected_chat_log_subset" in fixture:
        _assert_list_subset(gen.get_chat_log(), fixture["expected_chat_log_subset"], "chat log")
    if "expected_function_traces" in fixture:
        _assert_subset(gen.get_function_call_traces(), fixture["expected_function_traces"], "function call traces")
    if "expected_function_traces_subset" in fixture:
        _assert_list_subset(gen.get_function_call_traces(), fixture["expected_function_traces_subset"], "function call traces")
    if "expected_chat_prompt" in fixture:
        if not client.requests:
            raise FixtureError("fixture expected a request but none were sent")
        _assert_equal(client.requests[0].get("chat_prompt"), fixture["expected_chat_prompt"], "chat prompt")
    if "expected_chat_prompt_contains" in fixture:
        if not client.requests:
            raise FixtureError("fixture expected a request but none were sent")
        prompt_text = json.dumps(client.requests[0].get("chat_prompt"), sort_keys=True)
        for item in fixture.get("expected_chat_prompt_contains") or []:
            if str(item) not in prompt_text:
                raise FixtureError(f"chat prompt missing {item!r}: {prompt_text}")


def _run_ai_chat(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.chat(fixture["request"], fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai chat output")
    _assert_transport_request(fixture, transport)


def _run_ai_embed(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.embed(fixture["request"], fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai embed output")
    _assert_transport_request(fixture, transport)


def _run_ai_stream(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = list(client.stream(fixture["request"], fixture.get("options")))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai stream output")
    _assert_transport_request(fixture, transport)


def _run_ai_error(fixture):
    client, transport = _openai_fixture_client(fixture)
    try:
        method = fixture.get("method", "chat")
        if method == "stream":
            list(client.stream(fixture["request"], fixture.get("options")))
        elif method == "embed":
            client.embed(fixture["request"], fixture.get("options"))
        else:
            client.chat(fixture["request"], fixture.get("options"))
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        expected_type = fixture.get("expected_error_type")
        if expected_type and type(exc).__name__ != expected_type:
            raise FixtureError(f"expected error type {expected_type}, got {type(exc).__name__}")
        if "expected_status" in fixture and getattr(exc, "status", None) != fixture["expected_status"]:
            raise FixtureError(f"expected status {fixture['expected_status']}, got {getattr(exc, 'status', None)}")
        _assert_transport_request(fixture, transport)
        return
    raise FixtureError("expected AxAI call to fail")


def _run_ai_unsupported(fixture):
    client, _ = _openai_fixture_client(fixture)
    method = getattr(client, fixture.get("method", "transcribe"))
    try:
        method(fixture.get("request") or {})
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        return
    raise FixtureError("expected unsupported capability error")


def _build_signature(fixture):
    if "signature_spec" in fixture:
        return _signature_from_spec(fixture["signature_spec"])
    return s(fixture["signature"])


def _field_for_validation(fixture):
    name = fixture.get("field_name", "value")
    return _field_from_spec(fixture.get("field") or {}).to_field(name)


def _signature_payload(sig):
    return {
        "description": sig.get_description(),
        "inputs": [_field_payload(field) for field in sig.get_input_fields()],
        "outputs": [_field_payload(field) for field in sig.get_output_fields()],
    }


def _field_payload(field):
    out = {
        "name": field.name,
        "title": field.title,
        "type": _type_payload(field.type),
        "isOptional": bool(field.is_optional),
        "isInternal": bool(field.is_internal),
        "isCached": bool(field.is_cached),
    }
    if field.description is not None:
        out["description"] = field.description
    return out


def _type_payload(typ):
    out = {"name": typ.name, "isArray": bool(typ.is_array)}
    if typ.options is not None:
        out["options"] = list(typ.options)
    if typ.description is not None:
        out["description"] = typ.description
    if typ.fields:
        out["fields"] = {name: _field_payload(_nested_payload_field(name, item)) for name, item in typ.fields.items()}
    if typ.min_length is not None:
        out["minLength"] = typ.min_length
    if typ.max_length is not None:
        out["maxLength"] = typ.max_length
    if typ.minimum is not None:
        out["minimum"] = typ.minimum
    if typ.maximum is not None:
        out["maximum"] = typ.maximum
    if typ.pattern is not None:
        out["pattern"] = typ.pattern
    if typ.pattern_description is not None:
        out["patternDescription"] = typ.pattern_description
    if typ.format is not None:
        out["format"] = typ.format
    return out


def _nested_payload_field(name, item):
    from .signature import Field
    if isinstance(item, Field):
        return item
    return Field(name=name, type=item)


def _assert_expected_error(exc, fixture):
    expected_category = fixture.get("expected_error_category")
    if expected_category and _error_category(exc) != expected_category:
        raise FixtureError(f"expected error category {expected_category!r}, got {_error_category(exc)!r}")
    expected = fixture.get("expected_error_contains")
    if expected and expected not in str(exc):
        raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")


def _error_category(exc):
    name = type(exc).__name__
    if name == "AxSignatureError":
        return "signature"
    if name == "AxValidationError":
        return "validation"
    if name.startswith("AxAI"):
        return "ai"
    return "runtime"


def _openai_fixture_client(fixture):
    transport = FakeTransport(fixture.get("transport_responses") or fixture.get("responses") or [])
    client = OpenAICompatibleClient(
        model=fixture.get("model", "gpt-4.1-mini"),
        embed_model=fixture.get("embed_model", "text-embedding-3-small"),
        api_key="test-key",
        transport=transport,
        model_config=fixture.get("model_config"),
    )
    return client, transport


def _assert_transport_request(fixture, transport):
    if "expected_transport_request" not in fixture:
        return
    if not transport.requests:
        raise FixtureError("expected provider transport request but none were sent")
    _assert_subset(transport.requests[0], fixture["expected_transport_request"], "provider request")


def _legacy_response_to_chat_response(raw):
    if "results" in raw:
        return raw
    calls = []
    for call in raw.get("function_calls") or []:
        calls.append({
            "id": call.get("id"),
            "type": "function",
            "function": {
                "name": call.get("name"),
                "params": call.get("params"),
            },
        })
    return {
        "results": [{
            "index": 0,
            "content": raw.get("content", ""),
            "function_calls": calls,
            "finish_reason": raw.get("finish_reason", "stop"),
        }],
        "model_usage": {"tokens": raw.get("usage")} if raw.get("usage") else None,
    }


def _signature_from_spec(spec):
    builder = f()
    if spec.get("description"):
        builder.description(spec["description"])
    for name, field_spec in (spec.get("inputs") or {}).items():
        builder.input(name, _field_from_spec(field_spec))
    for name, field_spec in (spec.get("outputs") or {}).items():
        builder.output(name, _field_from_spec(field_spec))
    return builder.build()


def _field_from_spec(spec):
    typ = spec.get("type", "string")
    if typ == "class":
        field = f.classification(spec.get("options") or [], spec.get("description"))
    elif typ == "object":
        fields = {name: _field_from_spec(item) for name, item in (spec.get("fields") or {}).items()} if "fields" in spec else None
        field = f.object(fields, spec.get("description"))
    else:
        factory_name = {
            "dateRange": "date_range",
            "datetimeRange": "datetime_range",
        }.get(typ, typ)
        factory = getattr(f, factory_name)
        field = factory(spec.get("description"))
    if spec.get("array"):
        field = field.array(spec.get("arrayDescription"))
    if spec.get("optional"):
        field = field.optional()
    if spec.get("internal"):
        field = field.internal()
    if spec.get("cache"):
        field = field.cache()
    if "min" in spec:
        field = field.min(spec["min"])
    if "max" in spec:
        field = field.max(spec["max"])
    if spec.get("email"):
        field = field.email()
    if spec.get("url"):
        field = field.url()
    if spec.get("pattern"):
        field = field.regex(spec["pattern"], spec.get("patternDescription") or spec["pattern"])
    return field


def _build_tools(specs):
    calls = []
    tools = []
    for spec in specs:
        builder = fn(spec["name"]).description(spec.get("description") or spec["name"])
        for name, field_spec in (spec.get("args") or {}).items():
            builder.arg(name, _field_from_spec(field_spec))
        for name, field_spec in (spec.get("returns") or {}).items():
            builder.returns_field(name, _field_from_spec(field_spec))
        result = copy.deepcopy(spec.get("result"))
        error = spec.get("error")

        def handler(args, *, _name=spec["name"], _result=result, _error=error):
            calls.append({"name": _name, "args": copy.deepcopy(args)})
            if _error:
                raise RuntimeError(_error)
            return copy.deepcopy(_result)

        tools.append(builder.handler(handler).build())
    return tools, calls


def _assert_equal(actual, expected, label):
    if actual != expected:
        raise FixtureError(
            f"{label} mismatch\nactual: {json.dumps(actual, sort_keys=True)}\nexpected: {json.dumps(expected, sort_keys=True)}"
        )


def _assert_subset(actual, expected, label):
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            raise FixtureError(f"{label} expected dict subset, got {type(actual).__name__}")
        for key, value in expected.items():
            if key not in actual:
                raise FixtureError(f"{label} missing key {key!r}")
            _assert_subset(actual[key], value, f"{label}.{key}")
        return
    if isinstance(expected, list):
        _assert_equal(actual, expected, label)
        return
    if actual != expected:
        raise FixtureError(f"{label} expected {expected!r}, got {actual!r}")


def _assert_list_subset(actual, expected, label):
    if not isinstance(actual, list):
        raise FixtureError(f"{label} expected list, got {type(actual).__name__}")
    start = 0
    for expected_item in expected:
        matched = False
        for index in range(start, len(actual)):
            try:
                _assert_subset(actual[index], expected_item, f"{label}[{index}]")
                start = index + 1
                matched = True
                break
            except FixtureError:
                continue
        if not matched:
            raise FixtureError(f"{label} missing expected item {expected_item!r}")


def _expand_paths(paths):
    out = []
    for path in paths:
        p = Path(path)
        if p.is_dir():
            out.extend(sorted(p.glob("*.json")))
        else:
            out.append(p)
    return out


def main(argv=None):
    argv = list(argv or sys.argv[1:])
    if not argv:
        raise SystemExit("usage: python -m ax.conformance <fixture-or-dir>...")
    for result in run_fixtures(argv):
        print("ok", result["name"])


if __name__ == "__main__":
    main()
`

const pyProvidersInit = `from .openai import OpenAICompatibleClient

__all__ = ["OpenAICompatibleClient"]
`

const pyOpenAIProvider = `from ..ai import OpenAICompatibleClient

__all__ = ["OpenAICompatibleClient"]
`
