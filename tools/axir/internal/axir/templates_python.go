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
    AxBalancer,
    AxUnsupportedCapabilityError,
    AnthropicClient,
    AzureOpenAIClient,
    CohereClient,
    DeepSeekClient,
    GrokClient,
    GoogleGeminiClient,
    MistralClient,
    MultiServiceRouter,
    OpenAICompatibleClient,
    OpenAIResponsesClient,
    ProviderRouter,
    RekaClient,
    ai,
    get_supported_ai_models,
)
from .gen import AxGen, AxMemory, ax
from .agent import AxAgent, AxAgentClarificationError, AxCodeRuntime, AxCodeSession, AxGEPA, OptimizerEngine, OptimizerEvaluator, agent
from .flow import AxFlow, AxProgram, flow
from .prompt import AxPromptTemplate, TemplateError, render_template_content, validate_prompt_template_syntax
from .runtime import ProcessCodeRuntime, ProcessCodeSession, RuntimeCapabilities, RuntimeEnvelope

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
    "AxBalancer",
    "AxGen",
    "AxFlow",
    "AxAgent",
    "AxAgentClarificationError",
    "AxCodeRuntime",
    "AxCodeSession",
    "AxGEPA",
    "AxMemory",
    "OptimizerEngine",
    "OptimizerEvaluator",
    "ProcessCodeRuntime",
    "ProcessCodeSession",
    "AxPromptTemplate",
    "AxProgram",
    "AxSignature",
    "AxSignatureError",
    "AxUnsupportedCapabilityError",
    "AxValidationError",
    "AnthropicClient",
    "AzureOpenAIClient",
    "CohereClient",
    "DeepSeekClient",
    "Field",
    "FieldType",
    "GrokClient",
    "GoogleGeminiClient",
    "MistralClient",
    "MultiServiceRouter",
    "OpenAICompatibleClient",
    "OpenAIResponsesClient",
    "ProviderRouter",
    "RekaClient",
    "RuntimeCapabilities",
    "RuntimeEnvelope",
    "SignatureBuilder",
    "TemplateError",
    "Tool",
    "ai",
    "agent",
    "ax",
    "f",
    "fn",
    "flow",
    "get_supported_ai_models",
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


def _core_map_keys(values):
    if values is None:
        return []
    if isinstance(values, dict):
        return list(values.keys())
    return []


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


def _core_string_lower(value):
    return str(value).lower()


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
def _core_truthy(value): return bool(value)
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
import urllib.parse
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
    resolved = provider_resolve_profile(provider or "openai")
    if not resolved.get("known"):
        raise ValueError(f"unsupported AxAI provider: {provider}")
    canonical = resolved.get("id")
    if canonical == "openai-compatible":
        return OpenAICompatibleClient(**options)
    if canonical == "openai-responses":
        return OpenAIResponsesClient(**options)
    if canonical == "google-gemini":
        return GoogleGeminiClient(**options)
    if canonical == "anthropic":
        return AnthropicClient(**options)
    if canonical == "azure-openai":
        return AzureOpenAIClient(**options)
    if canonical == "deepseek":
        return DeepSeekClient(**options)
    if canonical == "mistral":
        return MistralClient(**options)
    if canonical == "reka":
        return RekaClient(**options)
    if canonical == "cohere":
        return CohereClient(**options)
    if canonical == "grok":
        return GrokClient(**options)
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


class ProviderOperationClient(AxBaseAI):
    def __init__(
        self,
        profile: str,
        name: str,
        model: str = "gpt-4.1-mini",
        embed_model: str = "text-embedding-3-small",
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 60.0,
        api_version: str | None = None,
        options: dict[str, Any] | None = None,
        model_config: dict[str, Any] | None = None,
        transport: Callable[[dict[str, Any]], Any] | None = None,
    ):
        descriptor = provider_descriptor(profile)
        super().__init__(
            name=name,
            model=model,
            embed_model=embed_model,
            model_config=model_config,
            options=options,
            features=descriptor.get("features") or default_features(),
        )
        self.profile = profile
        self.descriptor = descriptor
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL") or descriptor.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.api_version = api_version or descriptor.get("apiVersion")
        self.timeout = timeout
        self.transport = transport

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        return False

    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        payload = provider_build_chat_request(self.profile, request)
        if payload.get("stream"):
            return self._stream_chat(payload, request)
        model = request.get("model") or payload.get("model") or self.model
        endpoint = self._operation_path("chat", model)
        raw = self._request_json(endpoint, payload, stream=False)
        return provider_normalize_chat_response(self.profile, raw, self.name, model)

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        req = _coerce_chat_request(request)
        req.setdefault("model_config", {})["stream"] = True
        validate_chat_request(req)
        merged_options = {**self.options, **(options or {}), "stream": True}
        model = req.get("model") or self.model
        model_config = merge_model_config(self.model_config, req.get("model_config"), merged_options)
        model_config["stream"] = True
        req = {**req, "model": model, "model_config": model_config}
        self.last_used_chat_model = model
        self.last_used_model_config = copy.deepcopy(model_config)
        payload = provider_build_chat_request(self.profile, req)
        yield from self._stream_chat(payload, req)

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        payload = provider_build_embed_request(self.profile, request)
        model = request.get("embed_model") or request.get("embedModel") or payload.get("model") or self.embed_model
        endpoint = self._operation_path("embed", model)
        raw = self._request_json(endpoint, payload, stream=False)
        return provider_normalize_embed_response(self.profile, raw, self.name, model)

    def _stream_chat(self, payload: dict[str, Any], request: dict[str, Any]):
        model = request.get("model") or payload.get("model") or self.model
        endpoint = self._operation_path("stream_chat", model)
        raw = self._request_json(endpoint, payload, stream=True)
        state: dict[str, Any] = {}
        for event in _iter_sse_json(raw):
            yield provider_normalize_stream_delta(self.profile, event, state, self.name, model)

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        payload = provider_build_transcribe_request(self.profile, request)
        raw = self._request_json(self._operation_path("transcribe"), payload, stream=False, body_key="data")
        return provider_normalize_transcribe_response(self.profile, raw)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        payload = provider_build_speak_request(self.profile, request)
        raw = self._request_json(self._operation_path("speak"), payload, stream=False)
        return provider_normalize_speak_response(self.profile, raw, request)

    def realtime(self, events: Iterable[dict[str, Any]], model: str | None = None):
        state: dict[str, Any] = {}
        for event in events:
            yield provider_normalize_realtime_event(self.profile, event, state, self.name, model or self.model)

    def realtime_audio_setup(self, request: dict[str, Any]):
        return provider_build_realtime_audio_setup(self.profile, request)

    def realtime_audio_input(self, request: dict[str, Any]):
        return provider_build_realtime_audio_input(self.profile, request)

    def _operation_path(self, operation: str, model: str | None = None):
        descriptor = provider_operation_descriptor(self.profile, operation)
        path = str(descriptor.get("path", "/" + operation))
        if model is not None:
            path = path.replace("{model}", urllib.parse.quote(str(model), safe=""))
        if self.descriptor.get("auth") == "api_key_query":
            key_name = self.descriptor.get("apiKeyQuery") or "key"
            separator = "&" if "?" in path else "?"
            path += separator + urllib.parse.quote(str(key_name), safe="") + "=" + urllib.parse.quote(self.api_key or "", safe="")
        if self.api_version:
            separator = "&" if "?" in path else "?"
            path += separator + "api-version=" + urllib.parse.quote(str(self.api_version), safe="")
        return path

    def _request_json(self, endpoint: str, payload: dict[str, Any], *, stream: bool, body_key: str = "json"):
        call = {
            "method": "POST",
            "url": self.base_url + endpoint,
            "headers": self._headers(),
            body_key: payload,
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
        headers = {
            "Content-Type": "application/json",
        }
        if self.descriptor.get("auth") == "bearer":
            headers["Authorization"] = "Bearer " + (self.api_key or "")
        if self.descriptor.get("auth") == "anthropic_key":
            headers["x-api-key"] = self.api_key or ""
        if self.descriptor.get("auth") == "api_key_header":
            key_name = self.descriptor.get("apiKeyHeader") or "api-key"
            headers[str(key_name)] = self.api_key or ""
        for key, value in (self.descriptor.get("headers") or {}).items():
            headers[str(key)] = str(value)
        return headers


class OpenAICompatibleClient(ProviderOperationClient):
    def __init__(self, **options):
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", "text-embedding-3-small")
        super().__init__(
            "openai-compatible",
            "openai",
            model=options.pop("model", "gpt-4.1-mini"),
            embed_model=embed_model,
            **options,
        )


class OpenAIResponsesClient(ProviderOperationClient):
    def __init__(self, **options):
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", "text-embedding-ada-002")
        super().__init__(
            "openai-responses",
            "openai-responses",
            model=options.pop("model", "gpt-4o"),
            embed_model=embed_model,
            **options,
        )


class GoogleGeminiClient(ProviderOperationClient):
    def __init__(self, **options):
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", "gemini-embedding-2")
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("GOOGLE_GEMINI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta"
        super().__init__(
            "google-gemini",
            "GoogleGeminiAI",
            model=options.pop("model", "gemini-2.5-flash"),
            embed_model=embed_model,
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class AnthropicClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("ANTHROPIC_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com/v1"
        super().__init__(
            "anthropic",
            "anthropic",
            model=options.pop("model", "claude-3-7-sonnet-latest"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


def _normalize_azure_api_version(version: Any) -> str:
    text = str(version or "2024-02-15-preview").strip()
    marker = "api-version="
    if marker in text:
        return text.split(marker, 1)[1].split("&", 1)[0]
    return text


class AzureOpenAIClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("AZURE_OPENAI_API_KEY")
        resource = options.pop("resource_name", None) or options.pop("resourceName", None) or os.environ.get("AZURE_OPENAI_RESOURCE_NAME")
        deployment = options.pop("deployment_name", None) or options.pop("deploymentName", None) or os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME")
        api_version = _normalize_azure_api_version(options.pop("api_version", None) or options.pop("apiVersion", None) or options.pop("version", None) or "2024-02-15-preview")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("AZURE_OPENAI_BASE_URL")
        if not base_url and resource and deployment:
            host = str(resource)
            if "://" not in host:
                host = f"https://{host}.openai.azure.com"
            base_url = host.rstrip("/") + "/openai/deployments/" + urllib.parse.quote(str(deployment), safe="")
        super().__init__(
            "azure-openai",
            "Azure OpenAI",
            model=options.pop("model", "gpt-5-mini"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "text-embedding-3-small")),
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            **options,
        )


class DeepSeekClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("DEEPSEEK_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
        super().__init__(
            "deepseek",
            "DeepSeek",
            model=options.pop("model", "deepseek-v4-flash"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class MistralClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("MISTRAL_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("MISTRAL_BASE_URL") or "https://api.mistral.ai/v1"
        super().__init__(
            "mistral",
            "Mistral",
            model=options.pop("model", "mistral-small-latest"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "mistral-embed")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class RekaClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("REKA_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("REKA_BASE_URL") or "https://api.reka.ai/v1"
        super().__init__(
            "reka",
            "Reka",
            model=options.pop("model", "reka-core"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class CohereClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("COHERE_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("COHERE_BASE_URL") or "https://api.cohere.ai/compatibility/v1"
        super().__init__(
            "cohere",
            "Cohere",
            model=options.pop("model", "command-r-plus"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "embed-english-v3.0")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class GrokClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("XAI_BASE_URL") or os.environ.get("GROK_BASE_URL") or "https://api.x.ai/v1"
        super().__init__(
            "grok",
            "Grok",
            model=options.pop("model", "grok-4.3"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


def get_supported_ai_models(model_type: str | None = None):
    options = {} if model_type is None else {"type": model_type}
    return copy.deepcopy(provider_model_catalog(options))


def _router_default_features() -> dict[str, Any]:
    return {
        "functions": False,
        "streaming": False,
        "media": {
            "images": {"supported": False, "formats": []},
            "audio": {"supported": False, "formats": [], "output": {"supported": False, "formats": []}},
            "files": {"supported": False, "formats": [], "uploadMethod": "none"},
            "urls": {"supported": False, "webSearch": False, "contextFetching": False},
        },
        "caching": {"supported": False, "types": []},
        "thinking": False,
        "multiTurn": True,
    }


class MultiServiceRouter(AxAIService):
    def __init__(self, services):
        if not services:
            raise ValueError("No AI services provided.")
        self.services: dict[Any, dict[str, Any]] = {}
        self.options: dict[str, Any] | None = None
        self.last_used_service = None
        for index, item in enumerate(services):
            if isinstance(item, dict) and "key" in item:
                key = item["key"]
                if key in self.services:
                    raise ValueError(f"Duplicate model key: {key}")
                self.services[key] = {
                    "service": item["service"],
                    "description": item.get("description", ""),
                    "isInternal": item.get("isInternal", item.get("is_internal")),
                }
                continue
            service = item
            model_list = service.get_model_list()
            if not model_list:
                raise ValueError(f"Service {index} '{service.get_name()}' has no model list.")
            for entry in model_list:
                key = entry.get("key")
                if key in self.services:
                    other = self.services[key]["service"]
                    raise ValueError(f"Service {index} '{service.get_name()}' has duplicate model key: {key} as service {other.get_name()}")
                if "model" in entry and entry.get("model") is not None:
                    self.services[key] = {"service": service, "description": entry.get("description", ""), "model": entry.get("model")}
                elif "embedModel" in entry and entry.get("embedModel"):
                    self.services[key] = {"service": service, "description": entry.get("description", ""), "embedModel": entry.get("embedModel")}
                elif "embed_model" in entry and entry.get("embed_model"):
                    self.services[key] = {"service": service, "description": entry.get("description", ""), "embedModel": entry.get("embed_model")}
                else:
                    raise ValueError(f"Key {key} in model list for service {index} '{service.get_name()}' is missing a model or embedModel property.")

    @staticmethod
    def create(services):
        return MultiServiceRouter(services)

    def get_id(self) -> str:
        return "MultiServiceRouter:" + ",".join(str(entry["service"].get_id()) for entry in self.services.values())

    def get_name(self) -> str:
        return "MultiServiceRouter"

    def get_model_list(self):
        out = []
        for key, entry in self.services.items():
            if entry.get("isInternal"):
                continue
            item = {"key": key, "description": entry.get("description", "")}
            if "model" in entry:
                item["model"] = entry["model"]
            elif "embedModel" in entry:
                item["embedModel"] = entry["embedModel"]
            else:
                raise ValueError(f"Service {key} has no model or embedModel")
            out.append(item)
        return out

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        if model is not None and model in self.services:
            return copy.deepcopy(self.services[model]["service"].get_features(model))
        return _router_default_features()

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        model_key = request.get("model")
        if not model_key:
            raise ValueError("Model key must be specified for multi-service")
        entry = self.services.get(model_key)
        if entry is None:
            raise ValueError(f"No service found for model key: {model_key}")
        self.last_used_service = entry["service"]
        req = copy.deepcopy(request)
        if "modelConfig" in req and "model_config" not in req:
            req["model_config"] = copy.deepcopy(req["modelConfig"])
        if "model" not in entry:
            req.pop("model", None)
            return entry["service"].chat(req, options)
        return entry["service"].chat(req, options)

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        embed_key = request.get("embedModel", request.get("embed_model"))
        if not embed_key:
            raise ValueError("Embed model key must be specified for multi-service")
        entry = self.services.get(embed_key)
        if entry is None:
            raise ValueError(f"No service found for embed model key: {embed_key}")
        self.last_used_service = entry["service"]
        if "model" not in entry:
            req = copy.deepcopy(request)
            req.pop("embedModel", None)
            req.pop("embed_model", None)
            return entry["service"].embed(req, options)
        return entry["service"].embed(copy.deepcopy(request), options)

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        model_key = request.get("model")
        if not model_key:
            if not self.services:
                raise ValueError("No AI services provided.")
            service = next(iter(self.services.values()))["service"]
            self.last_used_service = service
            return service.transcribe(request, options)
        entry = self.services.get(model_key)
        if entry is None:
            raise ValueError(f"No service found for transcription model key: {model_key}")
        self.last_used_service = entry["service"]
        return entry["service"].transcribe(request, options)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        model_key = request.get("model")
        if not model_key:
            if not self.services:
                raise ValueError("No AI services provided.")
            service = next(iter(self.services.values()))["service"]
            self.last_used_service = service
            return service.speak(request, options)
        entry = self.services.get(model_key)
        if entry is None:
            raise ValueError(f"No service found for speech model key: {model_key}")
        self.last_used_service = entry["service"]
        return entry["service"].speak(request, options)

    def get_metrics(self) -> dict[str, Any]:
        service = self.last_used_service or (next(iter(self.services.values()))["service"] if self.services else None)
        if service is None:
            raise ValueError("No service available to get metrics.")
        return service.get_metrics()

    def get_estimated_cost(self, model_usage: dict[str, Any] | None = None) -> float:
        return self.last_used_service.get_estimated_cost(model_usage) if self.last_used_service else 0.0

    def get_logger(self):
        service = self.last_used_service or (next(iter(self.services.values()))["service"] if self.services else None)
        if service is None:
            raise ValueError("No service available to get logger.")
        return service.get_logger()

    def set_options(self, options: dict[str, Any]):
        for entry in self.services.values():
            entry["service"].set_options(options)
        self.options = dict(options or {})

    def get_options(self) -> dict[str, Any]:
        return dict(self.options or {})

    def get_last_used_chat_model(self):
        return self.last_used_service.get_last_used_chat_model() if self.last_used_service else None

    def get_last_used_embed_model(self):
        return self.last_used_service.get_last_used_embed_model() if self.last_used_service else None

    def get_last_used_model_config(self):
        return self.last_used_service.get_last_used_model_config() if self.last_used_service else None

    def complete(self, request: dict[str, Any]) -> dict[str, Any]:
        return chat_response_to_completion(self.chat(_coerce_chat_request(request)))


def _feature_bool(features: dict[str, Any], key: str, fallback: bool = False) -> bool:
    if key in features:
        return bool(features.get(key))
    snake = {
        "structuredOutputs": "structured_outputs",
        "multiTurn": "multi_turn",
        "functionCot": "function_cot",
        "hasThinkingBudget": "has_thinking_budget",
        "hasShowThoughts": "has_show_thoughts",
    }.get(key)
    if snake and snake in features:
        return bool(features.get(snake))
    return fallback


def _append_unique(left: list[Any], values: list[Any]):
    for value in values or []:
        if value not in left:
            left.append(value)


def _service_latency_score(service: AxAIService) -> float:
    try:
        return float(provider_balancer_metric_score(service.get_metrics()))
    except Exception:
        return 0.0


def _is_retryable_ai_error(exc: AxAIServiceError) -> bool:
    if isinstance(exc, AxAIServiceAuthenticationError):
        return False
    if isinstance(exc, AxAIServiceStatusError):
        return getattr(exc, "status", None) in {408, 429, 500, 502, 503, 504}
    return isinstance(
        exc,
        (
            AxAIServiceNetworkError,
            AxAIServiceResponseError,
            AxAIServiceStreamTerminatedError,
            AxAIServiceTimeoutError,
        ),
    )


class AxBalancer(AxAIService):
    input_order_comparator = "input_order"

    @staticmethod
    def create(services, options: dict[str, Any] | None = None):
        return AxBalancer(services, options)

    def __init__(self, services, options: dict[str, Any] | None = None):
        if not services:
            raise ValueError("No AI services provided.")
        self.policy = provider_balancer_retry_policy(options or {})
        self.debug = bool(self.policy.get("debug", True))
        self.max_retries = int(self.policy.get("maxRetries", 3))
        self.initial_backoff_ms = int(self.policy.get("initialBackoffMs", 1000))
        self.max_backoff_ms = int(self.policy.get("maxBackoffMs", 32000))
        self.service_failures: dict[str, dict[str, Any]] = {}
        self.services = list(services)
        self._validate_models()
        if self.policy.get("strategy") != "input_order":
            self.services.sort(key=_service_latency_score)
        self.current_service_index = 0
        self.current_service = self.services[0]

    def _validate_models(self):
        reference = next((service.get_model_list() for service in self.services if service.get_model_list() is not None), None)
        if reference is None:
            return
        reference_keys = {entry.get("key") for entry in reference}
        for index, service in enumerate(self.services):
            model_list = service.get_model_list()
            if model_list is None:
                raise ValueError(f"Service at index {index} ({service.get_name()}) has no model list while another service does.")
            keys = {entry.get("key") for entry in model_list}
            for key in reference_keys:
                if key not in keys:
                    raise ValueError(f"Service at index {index} ({service.get_name()}) is missing model {key!r}")
            for key in keys:
                if key not in reference_keys:
                    raise ValueError(f"Service at index {index} ({service.get_name()}) has extra model {key!r}")

    def _next_service(self, services, current_index: int):
        next_index = current_index + 1
        return (services[next_index] if next_index < len(services) else None, next_index)

    def _reset(self):
        self.current_service_index = 0
        self.current_service = self.services[0]

    def _can_retry_service(self, service: AxAIService) -> bool:
        return service.get_id() not in self.service_failures

    def _handle_failure(self, service: AxAIService, exc: AxAIServiceError):
        failure = self.service_failures.get(service.get_id(), {"retries": 0})
        self.service_failures[service.get_id()] = {"retries": int(failure.get("retries", 0)) + 1}

    def _handle_success(self, service: AxAIService):
        self.service_failures.pop(service.get_id(), None)

    def _candidate_services(self, request: dict[str, Any]):
        candidates = [service for service in self.services if provider_balancer_candidate_allowed(service.get_features(str(request.get("model"))) or {}, request)]
        if candidates:
            return candidates
        requirements = []
        if (request.get("responseFormat") or request.get("response_format") or {}).get("type") == "json_schema":
            requirements.append("structured outputs")
        caps = request.get("capabilities") or {}
        if caps.get("requiresImages") or caps.get("requires_images"):
            requirements.append("images")
        if caps.get("requiresAudio") or caps.get("requires_audio"):
            requirements.append("audio")
        raise ValueError(f"No services available that support required capabilities: {', '.join(requirements)}.")

    def get_id(self) -> str:
        return self.current_service.get_id()

    def get_name(self) -> str:
        return self.current_service.get_name()

    def get_model_list(self):
        for service in self.services:
            model_list = service.get_model_list()
            if model_list:
                return copy.deepcopy(model_list)
        return None

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        features = {
            "functions": False,
            "streaming": False,
            "thinking": False,
            "multiTurn": False,
            "structuredOutputs": False,
            "media": {
                "images": {"supported": False, "formats": []},
                "audio": {"supported": False, "formats": []},
                "files": {"supported": False, "formats": [], "uploadMethod": "none"},
                "urls": {"supported": False, "webSearch": False, "contextFetching": False},
            },
            "caching": {"supported": False, "types": []},
        }
        for service in self.services:
            raw = service.get_features(model) or {}
            for key in ("functions", "streaming", "thinking", "multiTurn", "structuredOutputs", "functionCot", "hasThinkingBudget", "hasShowThoughts"):
                if _feature_bool(raw, key):
                    features[key] = True
            media = raw.get("media") or {}
            for kind in ("images", "audio", "files"):
                src = media.get(kind) or {}
                if src.get("supported"):
                    features["media"][kind]["supported"] = True
                _append_unique(features["media"][kind]["formats"], list(src.get("formats") or []))
            upload = (media.get("files") or {}).get("uploadMethod") or (media.get("files") or {}).get("upload_method")
            if upload and upload != "none":
                features["media"]["files"]["uploadMethod"] = upload
            urls = media.get("urls") or {}
            if urls.get("supported"):
                features["media"]["urls"]["supported"] = True
            if urls.get("webSearch") or urls.get("web_search"):
                features["media"]["urls"]["webSearch"] = True
            if urls.get("contextFetching") or urls.get("context_fetching"):
                features["media"]["urls"]["contextFetching"] = True
            caching = raw.get("caching") or {}
            if caching.get("supported"):
                features["caching"]["supported"] = True
            _append_unique(features["caching"]["types"], list(caching.get("types") or []))
        return features

    def get_metrics(self) -> dict[str, Any]:
        out = default_metrics()
        chat_sum = chat_count = embed_sum = embed_count = 0.0
        for service in self.services:
            metrics = service.get_metrics() or {}
            errors = metrics.get("errors") or {}
            for kind in ("chat", "embed"):
                src = errors.get(kind) or {}
                out["errors"][kind]["count"] += src.get("count", 0) or 0
                out["errors"][kind]["total"] += src.get("total", 0) or 0
            latency = metrics.get("latency") or {}
            chat = latency.get("chat") or {}
            chat_samples = len(chat.get("samples") or [])
            if chat_samples:
                chat_sum += (chat.get("mean", 0) or 0) * chat_samples
                chat_count += chat_samples
            embed = latency.get("embed") or {}
            embed_samples = len(embed.get("samples") or [])
            if embed_samples:
                embed_sum += (embed.get("mean", 0) or 0) * embed_samples
                embed_count += embed_samples
            out["latency"]["chat"]["p95"] = max(out["latency"]["chat"]["p95"], chat.get("p95", 0) or 0)
            out["latency"]["chat"]["p99"] = max(out["latency"]["chat"]["p99"], chat.get("p99", 0) or 0)
            out["latency"]["embed"]["p95"] = max(out["latency"]["embed"]["p95"], embed.get("p95", 0) or 0)
            out["latency"]["embed"]["p99"] = max(out["latency"]["embed"]["p99"], embed.get("p99", 0) or 0)
        for kind in ("chat", "embed"):
            total = out["errors"][kind]["total"]
            if total:
                out["errors"][kind]["rate"] = out["errors"][kind]["count"] / total
        if chat_count:
            out["latency"]["chat"]["mean"] = chat_sum / chat_count
        if embed_count:
            out["latency"]["embed"]["mean"] = embed_sum / embed_count
        return out

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        candidates = self._candidate_services(request)
        index = 0
        current = candidates[index]
        self.current_service = current
        while True:
            if not self._can_retry_service(current):
                current, index = self._next_service(candidates, index)
                if current is None:
                    raise ValueError(f"All candidate services exhausted (tried {len(candidates)} service(s))")
                self.current_service = current
                continue
            try:
                response = current.chat(request, options)
                self._handle_success(current)
                return response
            except AxAIServiceError as exc:
                if not _is_retryable_ai_error(exc):
                    raise
                self._handle_failure(current, exc)
                failure = self.service_failures.get(current.get_id(), {})
                if int(failure.get("retries", 0)) >= self.max_retries:
                    current, index = self._next_service(candidates, index)
                    if current is None:
                        raise
                    self.current_service = current
            except Exception:
                raise

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self._reset()
        index = self.current_service_index
        while True:
            if not self._can_retry_service(self.current_service):
                next_service, index = self._next_service(self.services, index)
                if next_service is None:
                    raise ValueError(f"All services exhausted (tried {len(self.services)} service(s))")
                self.current_service = next_service
                self.current_service_index = index
                continue
            try:
                response = self.current_service.embed(request, options)
                self._handle_success(self.current_service)
                return response
            except AxAIServiceError as exc:
                if not _is_retryable_ai_error(exc):
                    raise
                self._handle_failure(self.current_service, exc)
                failure = self.service_failures.get(self.current_service.get_id(), {})
                if int(failure.get("retries", 0)) >= self.max_retries:
                    next_service, index = self._next_service(self.services, index)
                    if next_service is None:
                        raise
                    self.current_service = next_service
                    self.current_service_index = index

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        return self.current_service.transcribe(request, options)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        return self.current_service.speak(request, options)

    def get_estimated_cost(self, model_usage: dict[str, Any] | None = None) -> float:
        return self.current_service.get_estimated_cost(model_usage)

    def get_logger(self):
        return self.current_service.get_logger()

    def set_options(self, options: dict[str, Any]):
        for service in self.services:
            service.set_options(options)
        self.current_service.set_options(options)
        self.debug = bool((options or {}).get("debug", self.debug))

    def get_options(self) -> dict[str, Any]:
        return self.current_service.get_options()

    def get_last_used_chat_model(self):
        return self.current_service.get_last_used_chat_model()

    def get_last_used_embed_model(self):
        return self.current_service.get_last_used_embed_model()

    def get_last_used_model_config(self):
        return self.current_service.get_last_used_model_config()

    def complete(self, request: dict[str, Any]) -> dict[str, Any]:
        return chat_response_to_completion(self.chat(_coerce_chat_request(request)))


class ProviderRouter:
    def __init__(self, config: dict[str, Any]):
        providers_config = config.get("providers") or {}
        self.providers = [providers_config.get("primary"), *(providers_config.get("alternatives") or [])]
        self.providers = [provider for provider in self.providers if provider is not None]
        self.processing = config.get("processing") or {}
        routing = config.get("routing") or {}
        self.routing = routing.get("capability") or {}

    def _provider_records(self):
        return [
            {"name": provider.get_name(), "id": provider.get_id(), "features": copy.deepcopy(provider.get_features())}
            for provider in self.providers
        ]

    def _service_for_name(self, name: str):
        for provider in self.providers:
            if provider.get_name() == name:
                return provider
        return self.providers[0] if self.providers else None

    def get_routing_recommendation(self, request: dict[str, Any]):
        rec = provider_route_recommendation(self._provider_records(), _coerce_chat_request(request), self.routing)
        out = copy.deepcopy(rec)
        out["provider"] = self._service_for_name(out.get("providerName"))
        return out

    def validate_request(self, request: dict[str, Any]):
        return provider_route_validation(self._provider_records(), _coerce_chat_request(request), self.processing, self.routing)

    def get_routing_stats(self):
        return provider_routing_stats(self._provider_records())

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        rec = self.get_routing_recommendation(request)
        provider = rec.get("provider")
        if provider is None:
            raise AxUnsupportedCapabilityError("No provider selected")
        response = provider.chat(request, options)
        return {"response": response, "routing": rec}


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_add(left, right): return left + right
def _core_mul(left, right): return left * right
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_gt(left, right): return left > right
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


def _core_map_delete(target, key):
    if isinstance(target, dict):
        target.pop(key, None)
    return target


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


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in values)


def _core_string_lower(value):
    return str(value).lower()


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

for _axir_provider_public_name in (
    "provider_normalize_profile",
    "provider_profile_registry",
    "provider_resolve_profile",
    "provider_model_catalog_summary",
    "provider_model_catalog",
    "provider_route_request_requirements",
    "provider_route_recommendation",
    "provider_route_validation",
    "provider_balancer_retry_policy",
    "provider_balancer_metric_score",
    "provider_balancer_candidate_allowed",
    "provider_routing_stats",
    "provider_descriptor",
    "provider_operation_descriptor",
    "provider_build_chat_request",
    "provider_build_embed_request",
    "provider_normalize_chat_response",
    "provider_normalize_stream_delta",
    "provider_normalize_embed_response",
    "provider_build_transcribe_request",
    "provider_build_speak_request",
    "provider_normalize_transcribe_response",
    "provider_normalize_speak_response",
    "provider_normalize_realtime_event",
    "openai_build_chat_request",
    "openai_build_embed_request",
    "openai_normalize_chat_response",
    "openai_normalize_stream_delta",
    "openai_normalize_embed_response",
    "openai_responses_build_chat_request",
    "openai_responses_normalize_chat_response",
    "openai_responses_normalize_stream_delta",
    "openai_responses_build_transcribe_request",
    "openai_responses_build_speak_request",
    "openai_responses_normalize_realtime_event",
):
    if _axir_provider_public_name in globals():
        globals().setdefault(f"_{_axir_provider_public_name}", globals()[_axir_provider_public_name])
del _axir_provider_public_name


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
import re
import time
from typing import Any

from .ai import AIClient, chat_response_to_completion
from .prompt import AxPromptTemplate
from .schema import strip_internal, validate_fields, validate_output
from .signature import AxSignature


def _call_optimizer_engine(engine, request: dict[str, Any], evaluator):
    try:
        return engine.optimize(request, evaluator)
    except TypeError as exc:
        if evaluator is None:
            raise
        try:
            return engine.optimize(request)
        except TypeError:
            raise exc


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
        self.streaming_assertions = list(self.options.get("streaming_assertions") or self.options.get("streamingAssertions") or [])
        self.field_processors = list(self.options.get("field_processors") or self.options.get("fieldProcessors") or [])
        self.stop_functions = list(self.options.get("stop_functions") or self.options.get("stopFunctions") or [])
        self.memory = self.options.get("memory") or self.options.get("mem") or AxMemory()
        self.chat_log: list[dict[str, Any]] = []
        self.function_call_traces: list[dict[str, Any]] = []
        self.traces: list[dict[str, Any]] = []
        self.program_id = self.options.get("id") or self.options.get("program_id") or self.options.get("programId") or "root"
        self.instruction = str(self.options.get("instruction") or "")
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

    def add_assert(self, assertion):
        self.assertions.append(assertion)
        return self

    def add_streaming_assert(self, field, not_contains=None, message=None):
        spec = dict(field) if isinstance(field, dict) else {"field": field, "not_contains": not_contains}
        if message is not None:
            spec["message"] = message
        self.streaming_assertions.append(spec)
        return self

    def add_field_processor(self, field, processor):
        self.field_processors.append({"field": field, "processor": processor})
        return self

    def set_stop_functions(self, names):
        self.stop_functions = list(names or [])
        return self

    def set_instruction(self, instruction: str):
        self.instruction = str(instruction or "")
        self.options["instruction"] = self.instruction
        if hasattr(self.prompt_template, "set_instruction"):
            self.prompt_template.set_instruction(self.instruction)
        return self

    def get_instruction(self):
        return self.instruction

    def clear_instruction(self):
        return self.set_instruction("")

    def get_optimizable_components(self):
        components = []
        owner = self.program_id
        if self.signature.get_description():
            components.append({
                "id": f"{owner}::description",
                "owner": owner,
                "kind": "description",
                "current": self.signature.get_description(),
                "description": "Program signature description.",
                "constraints": ["Preserve the task intent and field references."],
                "dependsOn": [],
                "preserve": False,
                "format": "markdown",
                "validation": {"required_placeholders": []},
            })
        components.append({
            "id": f"{owner}::instruction",
            "owner": owner,
            "kind": "instruction",
            "current": self.instruction,
            "description": "Prompt instruction text used by this generator.",
            "constraints": ["Keep required input and output fields intact."],
            "dependsOn": [],
            "preserve": False,
            "format": "markdown",
            "validation": {"required_placeholders": []},
        })
        seen_names = set()
        for tool in self.functions:
            name = getattr(tool, "name", None) or _core_get(tool, "name", "")
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            desc = getattr(tool, "description", None) or _core_get(tool, "description", "")
            components.append({
                "id": f"{owner}::fn:{name}:desc",
                "owner": owner,
                "kind": "fn-desc",
                "current": desc,
                "description": f"Description for tool {name}.",
                "constraints": ["Non-empty, concise, and faithful to the tool behavior."],
                "dependsOn": [],
                "preserve": False,
                "format": "text",
                "validation": {"maxLength": 320},
            })
            components.append({
                "id": f"{owner}::fn:{name}:name",
                "owner": owner,
                "kind": "fn-name",
                "current": name,
                "description": f"Callable name for tool {name}.",
                "constraints": ["snake_case", "32 characters or fewer", "unique among tools"],
                "dependsOn": [],
                "preserve": True,
                "format": "snake_case",
                "validation": {"pattern": "^[a-z][a-z0-9_]{0,31}$"},
            })
        return components

    def apply_optimized_components(self, component_map: dict[str, Any]):
        updates = dict(component_map or {})
        owner = self.program_id
        if f"{owner}::description" in updates:
            self.signature.description = str(updates[f"{owner}::description"] or "")
        if f"{owner}::instruction" in updates:
            self.set_instruction(str(updates[f"{owner}::instruction"] or ""))
        for tool in self.functions:
            old_name = getattr(tool, "name", None) or _core_get(tool, "name", "")
            desc_id = f"{owner}::fn:{old_name}:desc"
            name_id = f"{owner}::fn:{old_name}:name"
            if desc_id in updates and hasattr(tool, "description"):
                tool.description = str(updates[desc_id] or "")
            if name_id in updates:
                new_name = str(updates[name_id] or "").strip()
                if not re.match(r"^[a-z][a-z0-9_]{0,31}$", new_name):
                    raise RuntimeError(f"invalid optimized function name: {new_name}")
                if any((getattr(other, "name", None) or _core_get(other, "name", "")) == new_name for other in self.functions if other is not tool):
                    raise RuntimeError(f"duplicate optimized function name: {new_name}")
                if hasattr(tool, "name"):
                    tool.name = new_name
        return self

    def apply_optimization(self, artifact):
        components = self.get_optimizable_components()
        if isinstance(artifact, str):
            artifact = _deserialize_optimized_artifact(artifact, components)
        else:
            artifact = _validate_optimized_artifact(artifact or {}, components)
        if "demos" in artifact and hasattr(self, "set_demos"):
            self.set_demos(artifact.get("demos") or [])
        return self.apply_optimized_components(artifact.get("componentMap") or {})

    def evaluate_optimization(self, client, dataset, candidate_map: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        opts = options or {}
        normalized = _normalize_optimization_dataset(dataset or [])
        rows = []
        original = _optimization_component_current_map(self.get_optimizable_components())
        candidate = dict(candidate_map or {})
        phase = opts.get("phase", "train")
        try:
            if candidate:
                self.apply_optimized_components(candidate)
            for task in normalized.get("train", []) or []:
                error = None
                try:
                    prediction = self.forward(client, task.get("input", task), opts.get("forward_options") or {})
                    prediction = {"completionType": "final", "output": prediction, "finalOutput": prediction, "functionCalls": self.get_function_call_traces(), "actionLog": self.get_chat_log(), "usage": {}, "trace": {"traces": self.get_traces()}}
                except Exception as exc:
                    error = {"message": str(exc)}
                    prediction = {"completionType": "error", "error": error, "functionCalls": self.get_function_call_traces(), "actionLog": self.get_chat_log(), "usage": {}, "trace": {"traces": self.get_traces()}}
                scores, scalar = _score_optimization_prediction(task if isinstance(task, dict) else {}, prediction, opts)
                rows.append(_build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), error))
            return _build_optimization_eval_result(rows, candidate, phase)
        finally:
            self.apply_optimized_components(original)

    def optimize_with(self, engine, dataset, options: dict[str, Any] | None = None):
        opts = options or {}
        components = self.get_optimizable_components()
        client = opts.get("client") or opts.get("ai")
        run = _prepare_optimizer_run("axgen", components, dataset or [], opts, {"traces": self.get_traces(), "chat_log": self.get_chat_log()}, client is not None)
        request = run.get("request") or {}
        evaluator = None
        if client is not None:
            outer = self

            class _Evaluator(OptimizerEvaluator):
                def evaluate(self, candidate_map, options=None):
                    merged = {**opts, **(options or {})}
                    eval_dataset = merged.pop("dataset", None) or merged.pop("_dataset", None) or dataset or []
                    return outer.evaluate_optimization(client, eval_dataset, candidate_map or {}, merged)

            evaluator = _Evaluator()
        response = _call_optimizer_engine(engine, request, evaluator)
        artifact = _normalize_optimizer_engine_response(
            response,
            getattr(engine, "name", engine.__class__.__name__),
            getattr(engine, "version", "host"),
            components,
        )
        if opts.get("apply", True) is not False:
            self.apply_optimization(artifact)
        return artifact

    def optimize(self, dataset=None, options: dict[str, Any] | None = None):
        opts = options or {}
        engine = opts.get("engine") or opts.get("optimizer")
        if engine is None:
            raise NotImplementedError("AxIR generated runtimes require an OptimizerEngine for optimize()")
        return self.optimize_with(engine, dataset or [], opts)

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
            _core_axgen_run_streaming_assertions(self, fold_stream(chunks))
            yield event
        content = fold_stream(chunks)
        _core_axgen_run_streaming_assertions(self, content)
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
def _core_ne(left, right): return left != right
def _core_lt(left, right): return left < right
def _core_lte(left, right): return left <= right
def _core_gt(left, right): return left > right
def _core_gte(left, right): return left >= right
def _core_add(left, right): return left + right
def _core_mul(left, right): return float(left or 0) * float(right or 0)
def _core_div(left, right): return float(left or 0) / float(right or 1)
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


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_type_is(value, type_name):
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "list":
        return isinstance(value, list)
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
    merged = dict(left or {})
    merged.update(right or {})
    return merged


def _core_map_contains(values, key):
    return isinstance(values, dict) and key in values


def _core_map_delete(target, key):
    if isinstance(target, dict):
        target.pop(key, None)
    return target


def _core_map_keys(values):
    if isinstance(values, dict):
        return list(values.keys())
    return []


def _core_map_values(values):
    if isinstance(values, dict):
        return list(values.values())
    return []


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


def _core_string_lower(value):
    return str(value).lower()


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


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


def _core_string_str(value):
    return str(value)


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


def _core_axgen_apply_context_cache(gen, messages, runtime_options=None):
    messages = [dict(item) if isinstance(item, dict) else item for item in (messages or [])]
    options = {**(_core_get(gen, "options", {}) or {}), **(runtime_options or {})}
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


def _core_axgen_run_streaming_assertions(gen, content):
    for assertion in _core_get(gen, "streaming_assertions", []) or []:
        message = "streaming assertion failed"
        if callable(assertion):
            result = assertion(content)
            if isinstance(result, str):
                raise RuntimeError(result)
            if result is False:
                raise RuntimeError(message)
            continue
        if not isinstance(assertion, dict):
            continue
        needle = assertion.get("not_contains", assertion.get("notContains"))
        if needle is None:
            continue
        message = assertion.get("message") or f"streaming assertion failed for field '{assertion.get('field')}'"
        if str(needle) in str(content):
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

const pyFlow = `from __future__ import annotations

import copy
import json
from typing import Any, Callable

from .ai import AIClient
from .gen import (
    AxGen,
    _core_exception_message,
    _core_eq,
    _core_gte,
    _core_get,
    _core_is_none,
    _core_json_stringify,
    _core_map_merge,
    _core_object_call_method,
    _core_or,
    _core_runtime_error,
    _core_string_format,
    _core_truthy,
    _filter_optimization_components,
)
from .agent import (
    OptimizerEngine,
    OptimizerEvaluator,
    _adjust_optimization_score_for_actions,
    _build_optimization_eval_result,
    _build_optimization_eval_row,
    _build_agent_eval_prediction,
    _build_optimizer_request,
    _call_optimizer_engine,
    _core_agent_stage_chat_log,
    _core_agent_stage_forward,
    _core_agent_stage_traces,
    _core_agent_stage_usage,
    _normalize_optimization_dataset,
    _normalize_optimization_metric_scores,
    _optimization_component,
    _optimization_changed_components,
    _optimization_component_current_map,
    _normalize_optimizer_engine_response,
    _prepare_optimizer_run,
    _scalarize_optimization_scores,
    _deserialize_optimized_artifact,
    _validate_optimized_artifact,
    _validate_optimization_component_map,
)


class _FlowCallable:
    def __init__(self, fn: Callable[[dict[str, Any]], Any]):
        self.fn = fn

    def call(self, state):
        return self.fn(copy.deepcopy(state or {}))


def _flow_get_state_value(state, field, default=None):
    if not field:
        return default
    cur = state or {}
    for part in str(field).split("."):
        if isinstance(cur, dict):
            cur = cur.get(part, default)
        else:
            return default
    return cur


def _flow_eval_spec(spec, state):
    if not isinstance(spec, dict):
        return spec
    op = spec.get("op", "value")
    if op == "field":
        return _flow_get_state_value(state, spec.get("field"), spec.get("default"))
    if op == "len":
        return len(_flow_get_state_value(state, spec.get("field"), []) or [])
    if "value" in spec:
        return spec.get("value")
    return spec


def _flow_condition_from_spec(spec):
    def _condition(state):
        if not isinstance(spec, dict):
            return bool(spec)
        op = spec.get("op", "truthy")
        if op == "truthy":
            return bool(_flow_get_state_value(state, spec.get("field")))
        if op == "field":
            return _flow_get_state_value(state, spec.get("field"))
        if op == "lt":
            return (_flow_get_state_value(state, spec.get("field"), 0) or 0) < spec.get("value", 0)
        if op == "eq":
            return _flow_get_state_value(state, spec.get("field")) == spec.get("value")
        if op == "always":
            return bool(spec.get("value", True))
        return False
    return _FlowCallable(_condition)


def _flow_mapper_from_spec(spec):
    def _mapper(state):
        out = dict(state or {})
        if not isinstance(spec, dict):
            return out
        op = spec.get("op", "set")
        if op == "set":
            out.update(copy.deepcopy(spec.get("values") or {}))
        elif op == "increment":
            field = spec.get("field")
            out[field] = (_flow_get_state_value(out, field, 0) or 0) + spec.get("by", 1)
        elif op == "append":
            field = spec.get("field")
            value = _flow_get_state_value(out, spec.get("valueField")) if spec.get("valueField") else spec.get("value")
            out[field] = list(_flow_get_state_value(out, field, []) or []) + [value]
        elif op == "copy":
            out[spec.get("to")] = _flow_get_state_value(out, spec.get("from"))
        return out
    return _FlowCallable(_mapper)


class AxProgram:
    def forward(self, client, values, options=None):
        raise NotImplementedError

    def get_optimizable_components(self):
        return []

    def apply_optimized_components(self, component_map):
        return self


class AxFlow(AxProgram):
    def __init__(self, options: dict[str, Any] | None = None):
        self.state = _flow_factory(options or {})

    def execute(self, name: str, program, options: dict[str, Any] | None = None):
        return self._add_step("execute", name, program, options)

    def derive(self, name: str, program, options: dict[str, Any] | None = None):
        return self._add_step("derive", name, program, options)

    def map(self, name: str, mapper: Callable[[dict[str, Any]], Any], options: dict[str, Any] | None = None):
        return self._add_step("map", name, _FlowCallable(mapper), options or {})

    def branch(self, name: str, predicate: Callable[[dict[str, Any]], Any], branches: list[dict[str, Any]], options: dict[str, Any] | None = None):
        opts = dict(options or {})
        opts["predicate"] = _FlowCallable(predicate)
        opts["branches"] = list(branches or [])
        return self._add_step("branch", name, None, opts)

    def while_loop(self, name: str, condition: Callable[[dict[str, Any]], bool], steps: list[dict[str, Any]], max_iterations: int = 100, options: dict[str, Any] | None = None):
        opts = dict(options or {})
        opts["condition"] = _FlowCallable(condition)
        opts["steps"] = list(steps or [])
        opts["maxIterations"] = max_iterations
        return self._add_step("while", name, None, opts)

    def feedback(self, name: str, condition: Callable[[dict[str, Any]], bool], steps: list[dict[str, Any]], max_iterations: int = 10, options: dict[str, Any] | None = None):
        opts = dict(options or {})
        opts["condition"] = _FlowCallable(condition)
        opts["steps"] = list(steps or [])
        opts["maxIterations"] = max_iterations
        opts.setdefault("label", name)
        return self._add_step("feedback", name, None, opts)

    def node_extended(self, name: str, base_signature: str, extensions: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        signature = (extensions or {}).get("extended_signature") or (extensions or {}).get("extendedSignature") or base_signature
        return self.execute(name, ax(signature, options or {}), options or {})

    def nx(self, name: str, base_signature: str, extensions: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        return self.node_extended(name, base_signature, extensions, options)

    def parallel(self, steps):
        for step in steps or []:
            self._add_step(step.get("kind", "execute"), step.get("name"), step.get("program"), step.get("options") or {})
        return self

    def returns(self, spec):
        _flow_set_returns(self.state, spec or {})
        return self

    def set_demos(self, demos):
        if isinstance(demos, list):
            owner = self.state.get("program_id", "root.flow")
            known_ids = {owner, "root"}
            for step in self.state.get("steps", []):
                name = step.get("name")
                if name:
                    known_ids.add(f"{owner}.{name}")
                    known_ids.add(f"root.{name}")
            unknown = sorted({
                item.get("programId")
                for item in demos
                if isinstance(item, dict) and item.get("programId") not in known_ids
            })
            if unknown:
                raise RuntimeError(f"Unknown program ID(s) in demos: {', '.join(unknown)}")
            self.state["demos"] = list(demos)
            return self
        known = {step.get("name") for step in self.state.get("steps", [])}
        for name, value in (demos or {}).items():
            if name not in known:
                raise RuntimeError(f"unknown flow node in demos: {name}")
            step = next(step for step in self.state.get("steps", []) if step.get("name") == name)
            program = step.get("program")
            if hasattr(program, "set_demos"):
                program.set_demos(value)
        self.state["demos"] = dict(demos or {})
        return self

    def get_plan(self):
        return _flow_plan(self.state)

    def get_traces(self):
        return list(self.state.get("traces") or [])

    def get_chat_log(self):
        return list(self.state.get("chat_log") or [])

    def get_usage(self):
        return dict(self.state.get("usage") or {})

    def get_optimizable_components(self):
        return _flow_get_optimizable_components(self.state)

    def apply_optimized_components(self, component_map: dict[str, Any]):
        _flow_apply_optimized_components(self.state, component_map or {})
        return self

    def apply_optimization(self, artifact):
        components = self.get_optimizable_components()
        if isinstance(artifact, str):
            artifact = _deserialize_optimized_artifact(artifact, components)
        else:
            artifact = _validate_optimized_artifact(artifact or {}, components)
        if "demos" in artifact and hasattr(self, "set_demos"):
            self.set_demos(artifact.get("demos") or [])
        return self.apply_optimized_components(artifact.get("componentMap") or {})

    def evaluate_optimization(self, client, dataset, candidate_map: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        return _flow_evaluate_optimization(self.state, client, dataset or [], candidate_map or {}, options or {})

    def optimize_with(self, engine: OptimizerEngine, dataset, options: dict[str, Any] | None = None):
        opts = options or {}
        client = opts.get("client") or opts.get("ai")
        request = _flow_optimize_with(self.state, dataset or [], opts, client is not None)
        evaluator = None
        if client is not None:
            outer = self

            class _Evaluator(OptimizerEvaluator):
                def evaluate(self, candidate_map, options=None):
                    merged = {**opts, **(options or {})}
                    eval_dataset = merged.pop("dataset", None) or merged.pop("_dataset", None) or dataset or []
                    return outer.evaluate_optimization(client, eval_dataset, candidate_map or {}, merged)

            evaluator = _Evaluator()
        response = _call_optimizer_engine(engine, request, evaluator)
        artifact = _normalize_optimizer_engine_response(
            response,
            getattr(engine, "name", engine.__class__.__name__),
            getattr(engine, "version", "host"),
            self.get_optimizable_components(),
        )
        if opts.get("apply", True) is not False:
            self.apply_optimization(artifact)
        return artifact

    def optimize(self, dataset=None, options: dict[str, Any] | None = None):
        opts = options or {}
        engine = opts.get("engine") or opts.get("optimizer")
        if engine is None:
            raise NotImplementedError("AxIR generated runtimes require an OptimizerEngine for optimize()")
        return self.optimize_with(engine, dataset or [], opts)

    def forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        return _flow_forward(self.state, client, values or {}, options or {})

    def streaming_forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        yield {"version": 1, "index": 0, "delta": self.forward(client, values or {}, options or {})}

    def _add_step(self, kind, name, program, options):
        _flow_add_step(self.state, _flow_step(kind, name, program, options or {}))
        return self


def flow(options: dict[str, Any] | None = None) -> AxFlow:
    return AxFlow(options)


def _core_map_get(values, key):
    return _core_get(values, key)


def _core_add(left, right):
    return left + right


def _core_and(left, right):
    return bool(left and right)


def _core_not(value):
    return not value


def _core_len(value):
    return len(value or [])


def _core_gt(left, right):
    return left > right


def _core_contains(container, item):
    return False if container is None else item in container


def _core_none():
    return None


def _core_is_not_none(value):
    return value is not None


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


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= int(index) < len(values) else default


def _core_map_contains(values, key):
    return isinstance(values, dict) and key in values


def _core_map_update(target, values):
    target.update(values or {})
    return target


def _core_map_keys(values):
    if values is None:
        return []
    if isinstance(values, dict):
        return list(values.keys())
    return []


def _core_map_delete(target, key):
    if isinstance(target, dict):
        target.pop(key, None)
    return target


def _core_string_slice(value, start, end=None):
    return str(value)[int(start):] if end is None else str(value)[int(start):int(end)]


def _core_string_split(value, sep):
    return str(value).split(str(sep))


def _core_string_split_trim_nonempty(value, sep):
    return [part.strip() for part in str(value).split(str(sep)) if part.strip()]


def _core_string_str(value):
    return str(value)


def _core_string_starts_with(value, prefix):
    return str(value).startswith(str(prefix))


def _core_json_stable_stringify(value):
    return json.dumps(value or {}, sort_keys=True, separators=(",", ":"))


def _core_program_components(program):
    if hasattr(program, "get_optimizable_components"):
        return program.get_optimizable_components()
    return []


def _core_program_apply_components(program, component_map):
    if hasattr(program, "apply_optimized_components"):
        program.apply_optimized_components(component_map or {})
    return {}


# AXIR_CORE_FLOW_FUNCTIONS
`

const pyAgent = `from __future__ import annotations

import copy
import json
import math
import re
from typing import Any

from .gen import AxGen
from .signature import AxSignature


class AxAgentClarificationError(RuntimeError):
    def __init__(self, clarification: Any, *, state: Any = None, payload: Any = None):
        if isinstance(clarification, dict):
            message = str(clarification.get("question") or clarification.get("message") or clarification)
        else:
            message = str(clarification)
        super().__init__(message)
        self.clarification = clarification
        self.state = state
        self.payload = payload


class AxCodeSession:
    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        raise NotImplementedError

    def inspect_globals(self, options: dict[str, Any] | None = None) -> Any:
        return "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]"

    def snapshot_globals(self, options: dict[str, Any] | None = None) -> Any:
        raise RuntimeError("AxCodeSession.snapshot_globals() is required to export AxAgent state")

    def patch_globals(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> Any:
        raise RuntimeError("AxCodeSession.patch_globals() is required to restore AxAgent state")

    def export_state(self, options: dict[str, Any] | None = None) -> Any:
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        return self.patch_globals(snapshot or {}, options or {})

    def close(self) -> Any:
        return {"closed": True}


class AxCodeRuntime:
    language = "JavaScript"

    def get_usage_instructions(self) -> str:
        return ""

    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> AxCodeSession:
        raise NotImplementedError


class OptimizerEngine:
    name = "host"
    version = "host"

    def optimize(self, request: dict[str, Any], evaluator: "OptimizerEvaluator | None" = None) -> dict[str, Any]:
        raise NotImplementedError


class OptimizerEvaluator:
    def evaluate(self, candidate_map: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
        raise NotImplementedError


def _call_optimizer_engine(engine: OptimizerEngine, request: dict[str, Any], evaluator: OptimizerEvaluator | None):
    try:
        return engine.optimize(request, evaluator)
    except TypeError as exc:
        if evaluator is None:
            raise
        try:
            return engine.optimize(request)
        except TypeError:
            raise exc


def _gepa_num(value, default=0.0):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(float(value)) else float(default)


def _gepa_int(value, default=0, minimum=None, maximum=None):
    out = int(math.floor(_gepa_num(value, default)))
    if minimum is not None:
        out = max(int(minimum), out)
    if maximum is not None:
        out = min(int(maximum), out)
    return out


def _gepa_current_map(components):
    return {
        str(component.get("id")): str(component.get("current", ""))
        for component in (components or [])
        if isinstance(component, dict) and component.get("id") is not None and isinstance(component.get("current", ""), str)
    }


def _gepa_avg_vec(rows):
    sums, counts = {}, {}
    for row in rows or []:
        for key, value in (row.get("scores") or {}).items():
            if isinstance(value, (int, float)) and math.isfinite(float(value)):
                sums[key] = sums.get(key, 0.0) + float(value)
                counts[key] = counts.get(key, 0) + 1
    return {key: sums[key] / max(counts.get(key, 1), 1) for key in sorted(sums)}


def _gepa_scalar(scores, options):
    key = (options or {}).get("paretoMetricKey") or (options or {}).get("pareto_metric_key")
    if key and isinstance(scores, dict):
        return _gepa_num(scores.get(key), 0)
    vals = [float(v) for v in (scores or {}).values() if isinstance(v, (int, float)) and math.isfinite(float(v))]
    return sum(vals) / len(vals) if vals else 0.0


def _gepa_dominates(a, b, eps=0.0):
    keys = set((a or {}).keys()) | set((b or {}).keys())
    at_least = True
    strict = False
    for key in keys:
        av = _gepa_num((a or {}).get(key), 0)
        bv = _gepa_num((b or {}).get(key), 0)
        if av + eps < bv:
            at_least = False
            break
        if av > bv + eps:
            strict = True
    return at_least and strict


def _gepa_pareto_front(candidates, eps=0.0):
    front = []
    for i, item in enumerate(candidates):
        dominated = False
        dominated_count = 0
        for j, other in enumerate(candidates):
            if i == j:
                continue
            if _gepa_dominates(other.get("scores") or {}, item.get("scores") or {}, eps):
                dominated = True
                break
            if _gepa_dominates(item.get("scores") or {}, other.get("scores") or {}, eps):
                dominated_count += 1
        if not dominated:
            front.append({"idx": i, "scores": copy.deepcopy(item.get("scores") or {}), "dominated": dominated_count})
    return front


def _gepa_hypervolume_2d(front_scores):
    if not front_scores:
        return None
    keys = list((front_scores[0] or {}).keys())
    if len(keys) != 2:
        return None
    k1, k2 = keys
    hv = 0.0
    prev_y = 0.0
    for point in sorted(front_scores, key=lambda item: _gepa_num(item.get(k1), 0), reverse=True):
        x = _gepa_num(point.get(k1), 0)
        y = _gepa_num(point.get(k2), 0)
        dy = max(y - prev_y, 0)
        hv += x * dy
        prev_y = max(prev_y, y)
    return hv


def _gepa_extract_text(response):
    if isinstance(response, dict):
        results = response.get("results") or []
        if results and isinstance(results[0], dict):
            content = results[0].get("content")
            if isinstance(content, str):
                text = content.strip()
                if text.startswith("New Value:"):
                    return text.split(":", 1)[1].strip()
                fence = "\x60\x60\x60"
                start = text.find(fence)
                end = text.rfind(fence)
                if start >= 0 and end > start:
                    inner = text[start + 3 : end].strip()
                    if "\n" in inner and inner.split("\n", 1)[0].strip().isidentifier():
                        inner = inner.split("\n", 1)[1]
                    return inner.strip()
                return text
    return ""


def _gepa_validate_component_value(component, value):
    if not isinstance(value, str) or not value.strip():
        return "component value must be a non-empty string"
    fmt = (component or {}).get("format")
    if fmt == "snake_case":
        import re

        if not re.match(r"^[a-z_][a-z0-9_]*$", value):
            return "must be snake_case"
    max_len = (component or {}).get("maxLength")
    if isinstance(max_len, (int, float)) and len(value) > int(max_len):
        return f"must be at most {int(max_len)} characters"
    for literal in (component or {}).get("preserve") or []:
        if str(literal) not in value:
            return f"must preserve {literal}"
    return True


def _gepa_option(options, *keys, default=None):
    for key in keys:
        if key in options and options.get(key) is not None:
            return options.get(key)
    return default


class AxGEPA(OptimizerEngine):
    name = "GEPA"
    version = "axir-gepa-v1"

    def __init__(self, reflection_client=None, **options):
        self.reflection_client = reflection_client
        self.options = dict(options or {})
        self.rng_state = _gepa_int(self.options.get("seed"), 123456789) or 123456789
        self.selector_state = {}
        self.feedback_memory = []

    def _rand(self):
        self.rng_state ^= (self.rng_state << 13) & 0xFFFFFFFF
        self.rng_state ^= (self.rng_state >> 17) & 0xFFFFFFFF
        self.rng_state ^= (self.rng_state << 5) & 0xFFFFFFFF
        self.rng_state &= 0xFFFFFFFF
        return self.rng_state / 4294967296.0

    def _selector_init(self, components, initial=None):
        self.selector_state = {}
        initial = initial or {}
        for component in components:
            cid = component.get("id")
            old = initial.get(cid) if isinstance(initial, dict) else {}
            self.selector_state[cid] = {
                "proposals": max(0, int(old.get("proposals", 0) if isinstance(old, dict) else 0)),
                "accepts": max(0, int(old.get("accepts", 0) if isinstance(old, dict) else 0)),
                "lastAcceptIter": int(old.get("lastAcceptIter", -1) if isinstance(old, dict) else -1),
                "stagnation": max(0, int(old.get("stagnation", 0) if isinstance(old, dict) else 0)),
            }

    def _pick_component(self, components, iteration):
        if len(components) == 1:
            return components[0]
        if self._rand() < 0.1:
            return components[min(len(components) - 1, int(self._rand() * len(components)))]
        total_props = max(1, sum(state["proposals"] for state in self.selector_state.values()))
        weights = []
        for component in components:
            state = self.selector_state[component["id"]]
            accept_rate = 0 if state["proposals"] == 0 else state["accepts"] / state["proposals"]
            pressure = state["proposals"] / total_props
            stale = min(iteration + 1, 10) if state["lastAcceptIter"] < 0 else min(iteration - state["lastAcceptIter"], 10)
            weights.append(1.4 * (1 - accept_rate) + 0.8 * state["stagnation"] + 0.2 * stale - 0.7 * pressure)
        max_w = max(weights)
        exp = [math.exp(w - max_w) for w in weights]
        threshold = self._rand() * sum(exp)
        for component, weight in zip(components, exp):
            threshold -= weight
            if threshold <= 0:
                return component
        return components[-1]

    def _record_proposal(self, cid):
        if cid in self.selector_state:
            self.selector_state[cid]["proposals"] += 1

    def _record_result(self, cid, accepted, iteration):
        if cid not in self.selector_state:
            return
        state = self.selector_state[cid]
        if accepted:
            state["accepts"] += 1
            state["lastAcceptIter"] = iteration
            state["stagnation"] = 0
        else:
            state["stagnation"] += 1

    def _component_group(self, component, components):
        by_id = {item.get("id"): item for item in components}
        out = []
        seen = set()

        def visit(cid):
            if cid in seen or cid not in by_id:
                return
            seen.add(cid)
            item = by_id[cid]
            out.append(item)
            for dep in item.get("dependsOn") or item.get("depends_on") or []:
                visit(dep)

        visit(component.get("id"))
        return out

    def _dataset_for(self, examples):
        return {"train": list(examples or []), "validation": []}

    def _evaluate(self, evaluator, cfg, examples, phase, max_calls, total_calls, throw=False, capture_traces=False):
        needed = len(examples or [])
        if total_calls + needed > max_calls:
            if throw:
                raise RuntimeError(f"AxGEPA: options.maxMetricCalls={max_calls} is too small to evaluate the initial Pareto set; need at least {needed} metric calls")
            return None, total_calls
        result = evaluator.evaluate(dict(cfg), {"dataset": self._dataset_for(examples), "phase": phase, "captureTraces": capture_traces})
        rows = list((result or {}).get("rows") or [])
        scalars = [_gepa_num(row.get("scalar"), 0) for row in rows]
        out = {
            "rows": rows,
            "avgScores": _gepa_avg_vec(rows),
            "avg": _gepa_num((result or {}).get("avg"), sum(scalars) / len(scalars) if scalars else 0),
            "sum": _gepa_num((result or {}).get("sum"), sum(scalars)),
            "count": int((result or {}).get("count", len(rows))),
            "scalars": scalars,
            "candidateMap": dict(cfg),
        }
        return out, total_calls + out["count"]

    def _reflect(self, component, current, tuples, trace_dataset, options):
        if self.reflection_client is None:
            raise RuntimeError("AxGEPA requires a reflection_client for reflective trials")
        attempts = max(1, _gepa_int(_gepa_option(options, "maxReflectionAttempts", "max_reflection_attempts", default=2), 2))
        previous_error = None
        for _ in range(attempts):
            prompt = {
                "chatPrompt": [
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "componentKey": component.get("id"),
                                "componentKind": component.get("kind"),
                                "currentValue": current,
                                "previousValidationError": previous_error,
                                "minibatch": tuples,
                                "traceDataset": trace_dataset,
                            },
                            sort_keys=True,
                        ),
                    }
                ],
                "model": _gepa_option(options, "reflectionModel", "reflection_model"),
            }
            response = self.reflection_client.chat(prompt, {"stream": False})
            candidate = _gepa_extract_text(response).strip()
            validation = _gepa_validate_component_value(component, candidate)
            if validation is True:
                return candidate
            previous_error = validation
        return current

    def _next_minibatch(self, train, iteration, size):
        if not train:
            return []
        if size <= 0 or size >= len(train):
            return list(train)
        start = (iteration * size) % len(train)
        out = []
        for i in range(size):
            out.append(train[(start + i) % len(train)])
        return out

    def _bootstrap(self, evaluator, base_cfg, train, options, total_calls, max_calls):
        raw = options.get("bootstrap")
        if not raw:
            return [], total_calls
        opts = raw if isinstance(raw, dict) else {}
        threshold = _gepa_num(_gepa_option(opts, "scoreThreshold", "score_threshold", default=0.8), 0.8)
        max_demos = _gepa_int(_gepa_option(opts, "maxBootstrapDemos", "max_bootstrap_demos", default=4), 4, 1)
        max_boot_calls = _gepa_int(_gepa_option(opts, "maxBootstrapMetricCalls", "max_bootstrap_metric_calls", default=min(len(train), 8) or 1), min(len(train), 8) or 1, 1)
        demos = []
        calls = 0
        for example in train:
            if calls >= max_boot_calls or len(demos) >= max_demos:
                break
            result, total_calls = self._evaluate(evaluator, base_cfg, [example], "bootstrap", max_calls, total_calls)
            calls += 1
            if not result or not result["rows"]:
                continue
            row = result["rows"][0]
            if _gepa_num(row.get("scalar"), 0) >= threshold:
                demos.append({"programId": "root", "traces": [copy.deepcopy(row.get("prediction", row.get("input", {})))]})
        return demos, total_calls

    def optimize(self, request: dict[str, Any], evaluator: OptimizerEvaluator | None = None) -> dict[str, Any]:
        if evaluator is None:
            raise RuntimeError("AxGEPA requires an OptimizerEvaluator")
        options = {**self.options, **((request or {}).get("options") or {})}
        components = [copy.deepcopy(c) for c in ((request or {}).get("components") or []) if isinstance(c, dict) and isinstance(c.get("current", ""), str)]
        if not components:
            raise RuntimeError("AxGEPA: program exposes no optimizable components")
        dataset = (request or {}).get("dataset") or {}
        train = list(dataset.get("train") or [])
        validation = list(dataset.get("validation") or []) or train
        max_calls = _gepa_int(_gepa_option(options, "maxMetricCalls", "max_metric_calls", default=0), 0)
        if max_calls <= 0:
            raise RuntimeError("AxGEPA: options.maxMetricCalls must be set to a positive integer")
        num_trials = _gepa_int(_gepa_option(options, "numTrials", "num_trials", default=30), 30, 0)
        minibatch = options.get("minibatch", True) is not False
        minibatch_size = _gepa_int(_gepa_option(options, "minibatchSize", "minibatch_size", default=20), 20, 1)
        early_stop = _gepa_int(_gepa_option(options, "earlyStoppingTrials", "early_stopping_trials", default=5), 5, 1)
        min_improvement = _gepa_num(_gepa_option(options, "minImprovementThreshold", "min_improvement_threshold", default=0), 0)
        pareto_size = _gepa_int(_gepa_option(options, "paretoSetSize", "pareto_set_size", default=max(10, min(200, minibatch_size * 3))), max(10, min(200, minibatch_size * 3)), 1, 1000)
        tie_eps = _gepa_num(_gepa_option(options, "tieEpsilon", "tie_epsilon", default=0), 0)
        base_cfg = _gepa_current_map(components)
        pareto_set = validation[:pareto_size]
        self._selector_init(components, _gepa_option(options, "selectorState", "selector_state"))
        total_calls = 0
        demos, total_calls = self._bootstrap(evaluator, base_cfg, train, options, total_calls, max_calls)
        base_eval, total_calls = self._evaluate(evaluator, base_cfg, pareto_set, "initial Pareto evaluation", max_calls, total_calls, True)
        candidates = [{"cfg": dict(base_cfg), "scores": base_eval["avgScores"] or {"score": base_eval["avg"]}, "parent": None}]
        per_instance = [base_eval["scalars"]]
        stagnation = 0
        for iteration in range(num_trials):
            if total_calls >= max_calls:
                break
            parent_idx = max(range(len(candidates)), key=lambda idx: sum(per_instance[idx]) / max(len(per_instance[idx]), 1))
            mini = self._next_minibatch(train, iteration, minibatch_size) if minibatch else train
            parent_eval, total_calls = self._evaluate(evaluator, candidates[parent_idx]["cfg"], mini, "parent minibatch", max_calls, total_calls, False, True)
            if parent_eval is None:
                break
            perfect = _gepa_num(_gepa_option(options, "perfectScore", "perfect_score", default=1), 1)
            if _gepa_option(options, "skipPerfectScore", "skip_perfect_score", default=True) is not False and parent_eval["scalars"] and all(score >= perfect for score in parent_eval["scalars"]):
                continue
            target = self._pick_component(components, iteration)
            group = self._component_group(target, components)
            proposed = dict(candidates[parent_idx]["cfg"])
            rows = parent_eval["rows"]
            tuples = [{"input": row.get("input"), "prediction": row.get("prediction"), "score": row.get("scalar", 0)} for row in rows]
            for component in group:
                self._record_proposal(component["id"])
                current = proposed.get(component["id"], "")
                trace_dataset = [{"score": row.get("scalar", 0), "trace": row.get("trace"), "output": row.get("prediction")} for row in rows]
                proposed[component["id"]] = self._reflect(component, current, tuples, trace_dataset, options)
            child_mini, total_calls = self._evaluate(evaluator, proposed, mini, "child minibatch", max_calls, total_calls)
            if child_mini is None:
                break
            accepted = child_mini["sum"] > parent_eval["sum"] + min_improvement
            for component in group:
                self._record_result(component["id"], accepted, iteration)
            if not accepted:
                stagnation += 1
                if stagnation >= early_stop:
                    break
                continue
            child_eval, total_calls = self._evaluate(evaluator, proposed, pareto_set, "validation evaluation", max_calls, total_calls)
            if child_eval is None:
                break
            candidates.append({"cfg": dict(proposed), "scores": child_eval["avgScores"] or {"score": child_eval["avg"]}, "parent": parent_idx})
            per_instance.append(child_eval["scalars"])
            stagnation = 0
        front = _gepa_pareto_front(candidates, tie_eps)
        best_idx = front[0]["idx"] if front else 0
        best_score = -1e100
        for item in front:
            score = _gepa_scalar(item["scores"], options)
            if score > best_score:
                best_score = score
                best_idx = item["idx"]
        best_cfg = dict(candidates[best_idx]["cfg"])
        owners = {component["id"]: component.get("owner", component.get("id", "").split("::", 1)[0]) for component in components}
        pareto_meta = [
            {"candidate": item["idx"], "scores": item["scores"], "dominatedSolutions": item["dominated"], "componentMap": candidates[item["idx"]]["cfg"]}
            for item in front
        ]
        hv = _gepa_hypervolume_2d([item["scores"] for item in front])
        return {
            "artifactVersion": "axir-optimized-artifact-v1",
            "optimizerName": "GEPA",
            "optimizerVersion": self.version,
            "componentMap": best_cfg,
            "demos": demos,
            "metadata": {
                "optimizer": "GEPA",
                "selectorState": copy.deepcopy(self.selector_state),
                "paretoFront": pareto_meta,
                "bestScore": 0 if best_score == -1e100 else best_score,
                "totalMetricCalls": total_calls,
                "candidatesExplored": len(candidates),
                "report": {
                    "summary": "GEPA Multi-Objective Optimization Complete",
                    "statistics": {"totalEvaluations": total_calls, "candidatesExplored": len(candidates), "converged": True},
                    "paretoFrontier": {"solutionCount": len(front), "hypervolume": hv or 0},
                },
            },
            "evidence": {"avg": 0 if best_score == -1e100 else best_score, "count": len(pareto_set), "totalMetricCalls": total_calls},
            "provenance": {"sourceProgramKind": (request or {}).get("programKind", "unknown"), "componentOwners": owners},
        }


def _score_optimization_prediction(task, prediction, options):
    opts = options or {}
    if "metric_score" in task:
        raw_scores = task.get("metric_score")
    elif "scores" in task:
        raw_scores = task.get("scores")
    elif "score" in task:
        raw_scores = task.get("score")
    elif _core_get(prediction, "completionType") == "error":
        raw_scores = 0
    else:
        raw_scores = 1
    scores = _normalize_optimization_metric_scores(raw_scores)
    scalar = _scalarize_optimization_scores(scores, opts)
    scalar = _adjust_optimization_score_for_actions(scalar, task or {}, prediction or {})
    return scores, scalar


class AxAgent:
    def __init__(self, signature, options: dict[str, Any] | None = None):
        self.options = dict(options or {})
        self.state = _agent_factory(signature, self.options)
        self.signature = _core_get(self.state, "signature")
        self.distiller = AxGen(_core_get(self.state, "distiller_signature"), {"validation_retries": 0, "id": "ctx.root.actor"})
        self.executor = AxGen(_core_get(self.state, "executor_signature"), {"validation_retries": 0, "id": "task.root.actor"})
        self.responder = AxGen(self.signature, {"validation_retries": self.options.get("validation_retries", 2), "id": "task.root.responder"})

    def forward(self, client, values: dict[str, Any], options: dict[str, Any] | None = None):
        return _agent_forward(
            self.state,
            self.distiller,
            self.executor,
            self.responder,
            client,
            values or {},
            options or {},
        )

    def test(self, runtime: AxCodeRuntime, code: str, context_field_values: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        return _agent_runtime_test(
            self.state,
            runtime,
            code,
            context_field_values or {},
            options or {},
        )

    def execute_actor_step(self, runtime: AxCodeRuntime, code: str, values: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        _agent_runtime_build_globals(self.state, values or {})
        session = _core_get(self.state, "runtime_session")
        return _agent_runtime_execute_step(self.state, runtime, session, code, options or {})

    def inspect_runtime(self, options: dict[str, Any] | None = None):
        return _agent_runtime_inspect_state(self.state, _core_get(self.state, "runtime_session"), options or {})

    def export_session_state(self, options: dict[str, Any] | None = None):
        return _agent_runtime_export_session_state(self.state, _core_get(self.state, "runtime_session"), options or {})

    def restore_session_state(self, snapshot: Any, options: dict[str, Any] | None = None):
        return _agent_runtime_restore_session_state(self.state, _core_get(self.state, "runtime_session"), snapshot or {}, options or {})

    def close_runtime_session(self):
        return _agent_runtime_close_session(self.state, _core_get(self.state, "runtime_session"))

    def get_state(self):
        return _agent_get_state(self.state)

    def set_state(self, state):
        return _agent_set_state(self.state, state or {})

    def get_chat_log(self):
        return list(_core_get(self.state, "chat_log", []) or [])

    def get_action_log(self):
        return list(_core_get(self.state, "action_log", []) or [])

    def get_trace(self):
        return _agent_export_trace(self.state)

    def export_trace(self):
        return _agent_export_trace(self.state)

    def replay_trace(self, trace, fixtures: dict[str, Any] | None = None):
        return _agent_replay_trace(trace or {}, fixtures or {})

    def get_usage(self):
        return dict(_core_get(self.state, "usage", {}) or {})

    def get_runtime_contract(self):
        return dict(_core_get(self.state, "runtime_contract", {}) or {})

    def get_policy(self):
        return dict(_core_get(self.state, "policy", {}) or {})

    def get_policy_registry(self):
        return dict(_core_get(self.state, "policy_registry", {}) or {})

    def get_callable_inventory(self):
        return list(_core_get(self.state, "callable_inventory", []) or [])

    def get_discovery_catalog(self):
        return list(_core_get(self.state, "discovery_catalog", []) or [])

    def discover(self, request):
        return _agent_discover(self.state, request or {})

    def recall(self, request):
        return _agent_recall(self.state, request or [])

    def used(self, id, reason: str | None = None, stage: str = "executor"):
        return _agent_used(self.state, {"id": id, "reason": reason or "", "stage": stage}, stage)

    def invoke_callable(self, qualified_name: str, args: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        return _agent_execute_callable(self.state, {"qualified_name": qualified_name, "args": args or {}}, options or {})

    def export_runtime_state(self):
        return _agent_export_runtime_state(self.state)

    def restore_runtime_state(self, snapshot):
        return _agent_restore_runtime_state(self.state, snapshot or {})

    def get_optimizer_metadata(self):
        return _agent_optimizer_metadata(self.state)

    def get_optimizable_components(self):
        components = []
        components.extend(self.distiller.get_optimizable_components())
        components.extend(self.executor.get_optimizable_components())
        components.extend(self.responder.get_optimizable_components())
        runtime = self.get_runtime_contract()
        policy = self.get_policy()
        components.append(_optimization_component(
            "root.agent.runtime",
            "root.agent",
            "runtime-policy",
            runtime,
            "Agent runtime-language metadata and code-field policy.",
            ["Keep code field names aligned with the selected runtime language."],
            [],
            True,
            "json",
            {"component": "runtime_contract"},
        ))
        components.append(_optimization_component(
            "root.agent.policy",
            "root.agent",
            "agent-policy",
            policy,
            "Actor primitive, discovery, delegation, and prompt placement policy.",
            ["Do not expose protocol-only actions as actor primitives."],
            ["root.agent.runtime"],
            True,
            "json",
            {"component": "policy_registry"},
        ))
        return components

    def apply_optimized_components(self, component_map: dict[str, Any]):
        updates = dict(component_map or {})
        _validate_optimization_component_map(self.get_optimizable_components(), updates)
        self.distiller.apply_optimized_components(updates)
        self.executor.apply_optimized_components(updates)
        self.responder.apply_optimized_components(updates)
        if "root.agent.runtime" in updates and isinstance(updates["root.agent.runtime"], dict):
            self.state["runtime_contract"] = updates["root.agent.runtime"]
        if "root.agent.policy" in updates and isinstance(updates["root.agent.policy"], dict):
            self.state["policy"] = updates["root.agent.policy"]
        self.state["optimizer_metadata"] = _agent_optimizer_metadata(self.state)
        return self

    def apply_optimization(self, artifact):
        components = self.get_optimizable_components()
        if isinstance(artifact, str):
            artifact = _deserialize_optimized_artifact(artifact, components)
        else:
            artifact = _validate_optimized_artifact(artifact or {}, components)
        if "demos" in artifact and hasattr(self, "set_demos"):
            self.set_demos(artifact.get("demos") or [])
        return self.apply_optimized_components(artifact.get("componentMap") or {})

    def evaluate_optimization_task(self, client, task: dict[str, Any], options: dict[str, Any] | None = None):
        opts = options or {}
        try:
            output = self.forward(client, task.get("input") or task, opts.get("forward_options") or {})
            return _build_agent_eval_prediction(output, self.get_action_log(), self.get_usage(), self.export_trace())
        except AxAgentClarificationError as exc:
            return {
                "completionType": "askClarification",
                "clarification": exc.clarification,
                "actionLog": self.get_action_log(),
                "functionCalls": _core_get(self.state, "function_call_traces", []) or [],
                "toolErrors": [],
                "turnCount": 0,
                "usage": self.get_usage(),
                "trace": self.export_trace(),
            }
        except Exception as exc:
            return {
                "completionType": "error",
                "error": {"message": str(exc)},
                "actionLog": self.get_action_log(),
                "functionCalls": _core_get(self.state, "function_call_traces", []) or [],
                "toolErrors": [str(exc)],
                "turnCount": 0,
                "usage": self.get_usage(),
                "trace": self.export_trace(),
            }

    def evaluate_optimization(self, client, dataset, candidate_map: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        opts = options or {}
        normalized = _normalize_optimization_dataset(dataset or [])
        rows = []
        original = _optimization_component_current_map(self.get_optimizable_components())
        candidate = dict(candidate_map or {})
        phase = opts.get("phase", "train")
        max_metric_calls = int(opts.get("maxMetricCalls", opts.get("max_metric_calls", 10**9)))
        calls = 0
        try:
            if candidate:
                self.apply_optimized_components(candidate)
            for task in normalized.get("train", []) or []:
                if calls >= max_metric_calls:
                    raise RuntimeError(f"max metric calls exceeded: {max_metric_calls}")
                calls += 1
                prediction = self.evaluate_optimization_task(client, task if isinstance(task, dict) else {"input": task}, opts)
                error = prediction.get("error") if isinstance(prediction, dict) else None
                scores, scalar = _score_optimization_prediction(task if isinstance(task, dict) else {}, prediction, opts)
                rows.append(_build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), error))
            return _build_optimization_eval_result(rows, candidate, phase)
        finally:
            self.apply_optimized_components(original)

    def optimize_with(self, engine: OptimizerEngine, dataset, options: dict[str, Any] | None = None):
        opts = options or {}
        components = self.get_optimizable_components()
        client = opts.get("client") or opts.get("ai")
        run = _prepare_optimizer_run("axagent", components, dataset or [], opts, self.export_trace(), client is not None)
        request = run.get("request") or {}
        evaluator = None
        if client is not None:
            outer = self

            class _Evaluator(OptimizerEvaluator):
                def evaluate(self, candidate_map, options=None):
                    merged = {**opts, **(options or {})}
                    eval_dataset = merged.pop("dataset", None) or merged.pop("_dataset", None) or dataset or []
                    return outer.evaluate_optimization(client, eval_dataset, candidate_map or {}, merged)

            evaluator = _Evaluator()
        response = _call_optimizer_engine(engine, request, evaluator)
        artifact = _normalize_optimizer_engine_response(
            response,
            getattr(engine, "name", engine.__class__.__name__),
            getattr(engine, "version", "host"),
            components,
        )
        if opts.get("apply", True) is not False:
            self.apply_optimization(artifact)
        return artifact

    def optimize(self, dataset=None, options: dict[str, Any] | None = None):
        opts = options or {}
        engine = opts.get("engine") or opts.get("optimizer")
        if engine is None:
            raise NotImplementedError("AxIR generated runtimes require an OptimizerEngine for optimize()")
        return self.optimize_with(engine, dataset or [], opts)


def agent(signature, config: dict[str, Any] | None = None) -> AxAgent:
    return AxAgent(signature, config)


def _parse_signature(signature):
    return AxSignature(signature)


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_truthy(value): return bool(value)
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_lt(left, right): return left < right
def _core_lte(left, right): return left <= right
def _core_gt(left, right): return left > right
def _core_gte(left, right): return left >= right
def _core_add(left, right): return left + right
def _core_mul(left, right): return float(left or 0) * float(right or 0)
def _core_div(left, right): return float(left or 0) / float(right or 1)
def _core_len(value): return len(value or [])
def _core_contains(container, item): return False if container is None else item in container
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


def _core_type_is(value, type_name):
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "list":
        return isinstance(value, list)
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


def _core_map_delete(target, key):
    if isinstance(target, dict):
        target.pop(key, None)
    return target


def _core_map_contains(target, key):
    return isinstance(target, dict) and key in target


def _core_map_keys(values):
    if values is None:
        return []
    if isinstance(values, dict):
        return list(values.keys())
    return []


def _core_map_values(values):
    if values is None:
        return []
    if isinstance(values, dict):
        return list(values.values())
    return []


def _core_list_get(values, index, default=None):
    return values[index] if isinstance(values, list) and 0 <= int(index) < len(values) else default


def _core_json_stringify(value):
    import json
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _core_json_stable_stringify(value):
    import json
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _core_json_parse(value):
    return json.loads(value)


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_slice(value, start, end=None):
    text = str(value)
    s = max(0, min(len(text), int(start)))
    if end is None:
        return text[s:]
    e = max(s, min(len(text), int(end)))
    return text[s:e]


def _core_regex_replace(pattern, repl, value):
    return re.sub(str(pattern), str(repl), str(value))


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(str(pattern), value) is not None


def _core_string_words(value):
    return str(value).split()


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in (values or []))


def _core_string_split_trim_nonempty(value, sep):
    return [part.strip() for part in str(value).split(str(sep)) if part.strip()]


def _core_string_starts_with(value, prefix):
    return str(value).startswith(str(prefix))


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_lower(value):
    return str(value).lower()


def _core_string_lower_camel(words):
    items = [str(item) for item in (words or []) if str(item)]
    if not items:
        return ""
    first, rest = items[0].lower(), items[1:]
    return first + "".join(item.lower().capitalize() for item in rest)


def _core_string_title_from_camel(value):
    text = re.sub(r"Code$", " Code", str(value))
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text).strip()
    return text[:1].upper() + text[1:]


def _core_runtime_error(message):
    return RuntimeError(str(message))


def _core_agent_stage_forward(stage, client, values, options):
    return stage.forward(client, values or {}, options or {})


def _core_agent_stage_chat_log(stage):
    if hasattr(stage, "get_chat_log"):
        return stage.get_chat_log()
    return []


def _core_agent_stage_usage(stage):
    if hasattr(stage, "get_usage"):
        usage = stage.get_usage()
        if usage:
            return usage
    if hasattr(stage, "get_chat_log"):
        items = []
        for entry in stage.get_chat_log() or []:
            usage = _core_get(entry, "usage")
            if usage:
                items.append(usage)
        return items
    return []


def _core_agent_stage_traces(stage):
    if hasattr(stage, "get_traces"):
        return stage.get_traces()
    return []


def _core_agent_clarification_error(payload, state):
    args = _core_get(payload, "args", []) or []
    clarification = args[0] if args else payload
    return AxAgentClarificationError(
        clarification,
        state=_core_get(state, "runtime_state", {}),
        payload=payload,
    )


def _core_agent_runtime_create_session(runtime, globals_, options):
    if not hasattr(runtime, "create_session"):
        raise RuntimeError("agent runtime does not implement AxCodeRuntime")
    session = runtime.create_session(globals_ or {}, options or {})
    if session is None:
        raise RuntimeError("agent runtime returned no session")
    return session


def _core_agent_runtime_execute(session, code, options):
    if not hasattr(session, "execute"):
        raise RuntimeError("agent code session is not active")
    return session.execute(str(code), options or {})


def _core_agent_runtime_inspect(session, options):
    if hasattr(session, "inspect_globals"):
        try:
            return session.inspect_globals(options or {})
        except NotImplementedError:
            return "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]"
    if hasattr(session, "inspect"):
        return session.inspect(options or {})
    return "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]"


def _core_agent_runtime_export_state(session, options):
    if hasattr(session, "snapshot_globals") and type(session).snapshot_globals is not AxCodeSession.snapshot_globals:
        return session.snapshot_globals(options or {})
    if hasattr(session, "export_state") and type(session).export_state is not AxCodeSession.export_state:
        return session.export_state(options or {})
    raise RuntimeError("AxCodeSession.snapshot_globals() is required to export AxAgent state")


def _core_agent_runtime_restore_state(session, snapshot, options):
    if hasattr(session, "patch_globals") and type(session).patch_globals is not AxCodeSession.patch_globals:
        return session.patch_globals(snapshot or {}, options or {})
    if hasattr(session, "restore_state") and type(session).restore_state is not AxCodeSession.restore_state:
        return session.restore_state(snapshot or {}, options or {})
    raise RuntimeError("AxCodeSession.patch_globals() is required to restore AxAgent state")


def _core_agent_runtime_close(session):
    if hasattr(session, "close"):
        result = session.close()
        return {"closed": True} if result is None else result
    return {"closed": True}


def _core_agent_memory_search(state, searches, already_loaded):
    options = _core_get(state, "options", {}) or {}
    callback = options.get("on_memories_search") or options.get("onMemoriesSearch")
    if callable(callback):
        return callback(list(searches or []), list(already_loaded or [])) or []
    scripted = options.get("memory_search_results") or options.get("memorySearchResults") or {}
    if isinstance(scripted, dict):
        joined = "|".join(str(item) for item in (searches or []))
        if joined in scripted:
            return copy.deepcopy(scripted[joined])
        for item in searches or []:
            if str(item) in scripted:
                return copy.deepcopy(scripted[str(item)])
        return copy.deepcopy(scripted.get("*", []))
    if isinstance(scripted, list):
        return copy.deepcopy(scripted)
    return []


def _core_agent_skill_search(state, searches):
    options = _core_get(state, "options", {}) or {}
    callback = options.get("on_skills_search") or options.get("onSkillsSearch")
    if callable(callback):
        return callback(list(searches or [])) or []
    scripted = options.get("skill_search_results") or options.get("skillSearchResults") or {}
    if isinstance(scripted, dict):
        joined = "|".join(str(item) for item in (searches or []))
        if joined in scripted:
            return copy.deepcopy(scripted[joined])
        out = []
        for item in searches or []:
            out.extend(copy.deepcopy(scripted.get(str(item), [])))
        if out:
            return out
        return copy.deepcopy(scripted.get("*", []))
    if isinstance(scripted, list):
        return copy.deepcopy(scripted)
    return []


def _core_agent_callable_invoke(state, request, options):
    agent_options = _core_get(state, "options", {}) or {}
    qualified = _core_get(request, "qualified_name", _core_get(request, "name", ""))
    args = _core_get(request, "args", {})
    for group in _core_get(state, "callable_inventory", []) or []:
        for callable_meta in _core_get(group, "callables", []) or []:
            if _core_get(callable_meta, "qualified_name") == qualified:
                handler = _core_get(callable_meta, "handler")
                if callable(handler):
                    return {"status": "ok", "value": handler(args)}
    scripted = agent_options.get("callable_results") or agent_options.get("callableResults") or {}
    if isinstance(scripted, dict):
        result = scripted.get(qualified, scripted.get(_core_get(request, "name", ""), scripted.get("*")))
        if result is not None:
            copied = copy.deepcopy(result)
            if isinstance(copied, dict) and copied.get("error"):
                return {"status": "error", "error": copied.get("error")}
            if isinstance(copied, dict):
                copied.setdefault("status", "ok")
                return copied
            return {"status": "ok", "value": copied}
    return {"status": "error", "error": f"unknown callable: {qualified}"}


# AXIR_CORE_AGENT_FUNCTIONS
`

const pyConformance = `from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path
from typing import Any

from .ai import AnthropicClient, AzureOpenAIClient, AxAIServiceAuthenticationError, AxAIServiceError, AxAIServiceNetworkError, AxAIServiceResponseError, AxAIServiceStatusError, AxAIServiceStreamTerminatedError, AxAIServiceTimeoutError, AxBaseAI, AxBalancer, CohereClient, DeepSeekClient, GoogleGeminiClient, GrokClient, MistralClient, MultiServiceRouter, OpenAICompatibleClient, OpenAIResponsesClient, ProviderRouter, RekaClient, get_supported_ai_models, provider_descriptor, provider_model_catalog_summary, provider_normalize_profile, provider_profile_registry
from .gen import ax, fold_stream
from .flow import (
    _FlowCallable,
    _flow_add_step,
    _flow_cache_key,
    _flow_condition_from_spec,
    _flow_mapper_from_spec,
    _flow_step,
    flow,
)
from .agent import (
    AxAgent,
    AxAgentClarificationError,
    AxCodeRuntime,
    AxCodeSession,
    AxGEPA,
    OptimizerEngine,
    OptimizerEvaluator,
    _adjust_optimization_score_for_actions,
    _agent_context_fixture_result,
    _build_agent_eval_prediction,
    _build_optimizer_evidence_batch,
    _build_optimization_eval_row,
    _build_optimization_eval_result,
    _build_optimization_judge_payload,
    _deserialize_optimized_artifact,
    _filter_optimization_components,
    _map_optimization_judge_quality_to_score,
    _normalize_optimization_dataset,
    _normalize_optimization_metric_scores,
    _optimization_changed_components,
    _optimized_artifact,
    _scalarize_optimization_scores,
    _serialize_optimized_artifact,
    _validate_optimized_artifact,
    _normalize_agent_clarification_payload,
    _normalize_agent_final_payload,
    _normalize_agent_runtime_step_result,
    agent,
)
from .prompt import AxPromptTemplate, render_template_content, validate_prompt_template_syntax
from .runtime import ProcessCodeRuntime, RuntimeCapabilities, RuntimeEnvelope, RuntimeProtocolError
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


def _fixture_ai_service_error(spec):
    error_type = (spec or {}).get("type", "network")
    message = (spec or {}).get("message", "fixture error")
    if error_type == "status":
        return AxAIServiceStatusError(message, status=int((spec or {}).get("status", 500)), retryable=True)
    if error_type == "authentication":
        return AxAIServiceAuthenticationError("Authentication failed", status=int((spec or {}).get("status", 401)))
    if error_type == "response":
        return AxAIServiceResponseError(message)
    if error_type == "timeout":
        return AxAIServiceTimeoutError(message, retryable=True)
    if error_type == "plain":
        return RuntimeError(message)
    return AxAIServiceNetworkError("Network Error: " + str(message), retryable=True)


class RouterFixtureService(AxBaseAI):
    def __init__(self, spec):
        super().__init__(
            name=spec.get("name", "fixture"),
            model=spec.get("model", "fixture-chat"),
            embed_model=spec.get("embed_model", spec.get("embedModel", "fixture-embed")),
            features=copy.deepcopy(spec.get("features") or _router_fixture_features()),
        )
        self.fixture_id = spec.get("id", f"{self.name}-id")
        self.model_list = copy.deepcopy(spec.get("modelList", spec.get("model_list")))
        self.requests = []
        self.responses = list(spec.get("responses") or [])
        self.metrics_value = copy.deepcopy(spec.get("metrics") or {"service": self.name, "calls": 0})

    def get_id(self):
        return self.fixture_id

    def get_model_list(self):
        return copy.deepcopy(self.model_list)

    def get_metrics(self):
        out = copy.deepcopy(self.metrics_value)
        if isinstance(out, dict) and "calls" in out:
            out["calls"] = len(self.requests)
        return out

    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        self.requests.append({"method": "chat", "opt": copy.deepcopy(options or {})})
        if self.responses:
            next_response = self.responses.pop(0)
            if isinstance(next_response, dict) and "error" in next_response:
                raise _fixture_ai_service_error(next_response.get("error") or {})
            return copy.deepcopy(next_response.get("response", next_response)) if isinstance(next_response, dict) else copy.deepcopy(next_response)
        return {"results": [{"index": 0, "content": f"{self.name} chat"}]}

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        self.requests.append({"method": "embed", "opt": copy.deepcopy(options or {})})
        return {"embeddings": [[1, 2]], "modelUsage": {"ai": self.name}}

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self.requests.append({"method": "transcribe", "opt": copy.deepcopy(options or {})})
        return {"text": f"{self.name} transcript"}

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self.requests.append({"method": "speak", "opt": copy.deepcopy(options or {})})
        return {"audio": "pcm"}


def _router_fixture_features(overrides=None):
    base = {
        "functions": False,
        "streaming": False,
        "media": {
            "images": {"supported": False, "formats": []},
            "audio": {"supported": False, "formats": [], "output": {"supported": False, "formats": []}},
            "files": {"supported": False, "formats": [], "uploadMethod": "none"},
            "urls": {"supported": False, "webSearch": False, "contextFetching": False},
        },
        "caching": {"supported": False, "types": []},
        "thinking": False,
        "multiTurn": True,
    }
    if overrides:
        base = _deep_merge(base, overrides)
    return base


def _deep_merge(left, right):
    out = copy.deepcopy(left)
    for key, value in (right or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses or [])
        self.requests = []

    def __call__(self, request):
        self.requests.append(copy.deepcopy(request))
        if not self.responses:
            raise RuntimeError("fake transport exhausted")
        return copy.deepcopy(self.responses.pop(0))


class FakeCodeSession(AxCodeSession):
    def __init__(self, runtime, globals_, options=None):
        self.runtime = runtime
        self.globals = copy.deepcopy(globals_ or {})
        self.create_options = copy.deepcopy(options or {})
        self.closed = False

    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        if self.closed:
            return {"is_error": True, "error_category": "session_closed", "error": "session closed"}
        if not self.runtime.script:
            raise RuntimeError("fake runtime exhausted")
        step = copy.deepcopy(self.runtime.script.pop(0))
        expected = step.get("expected_code")
        if expected is not None and expected != code:
            raise RuntimeError(f"expected code {expected!r}, got {code!r}")
        if "expected_options_subset" in step:
            _assert_subset(options or {}, step["expected_options_subset"], "runtime execute options")
        self.runtime.executed.append(code)
        self.runtime.execute_options.append(copy.deepcopy(options or {}))
        self.globals.update(step.get("bindings_patch") or {})
        if step.get("close_before_result"):
            self.closed = True
        return copy.deepcopy(step.get("result", {"kind": "result", "result": dict(self.globals)}))

    def inspect_globals(self, options: dict[str, Any] | None = None) -> Any:
        if not self.runtime.capabilities.get("inspect", True):
            return "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]"
        return copy.deepcopy(self.globals)

    def snapshot_globals(self, options: dict[str, Any] | None = None) -> Any:
        if not self.runtime.capabilities.get("snapshot", True):
            raise RuntimeError("AxCodeSession.snapshot_globals() is required to export AxAgent state")
        entries = [
            {"name": key, "type": type(value).__name__, "preview": repr(value)}
            for key, value in self.globals.items()
        ]
        return {
            "version": 1,
            "entries": entries,
            "bindings": copy.deepcopy(self.globals),
            "globals": copy.deepcopy(self.globals),
            "closed": self.closed,
        }

    def patch_globals(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        if not self.runtime.capabilities.get("patch", True):
            raise RuntimeError("AxCodeSession.patch_globals() is required to restore AxAgent state")
        snap = copy.deepcopy(snapshot or {})
        self.globals = dict(snap.get("bindings") or snap.get("globals") or {})
        self.closed = bool(snap.get("closed", False))
        return self.snapshot_globals(options or {})

    def export_state(self, options: dict[str, Any] | None = None) -> Any:
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        return self.patch_globals(snapshot or {}, options or {})

    def close(self) -> Any:
        self.closed = True
        return {"closed": True}


class FakeCodeRuntime(AxCodeRuntime):
    def __init__(self, script=None, language="JavaScript", usage_instructions="", capabilities=None):
        self.script = list(script or [])
        self.sessions = []
        self.executed = []
        self.create_requests = []
        self.execute_options = []
        self.language = language
        self._usage_instructions = usage_instructions
        self.capabilities = {"inspect": True, "snapshot": True, "patch": True}
        self.capabilities.update(capabilities or {})

    def get_usage_instructions(self) -> str:
        return self._usage_instructions

    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> FakeCodeSession:
        self.create_requests.append({"globals": copy.deepcopy(globals or {}), "options": copy.deepcopy(options or {})})
        session = FakeCodeSession(self, globals, options)
        self.sessions.append(session)
        return session


def _runtime_protocol_response(message, result=None, *, ok=True, error=None, session_id=None):
    out = {"id": message.get("id"), "ok": ok}
    if ok:
        out["result"] = result if result is not None else {}
    else:
        out["error"] = error or {"category": "runtime", "message": "runtime protocol error"}
    if session_id is not None:
        out["session_id"] = session_id
    return out


def _runtime_protocol_fail(message, category, message_text):
    return _runtime_protocol_response(message, ok=False, error={"category": category, "message": message_text})


def _runtime_protocol_snapshot(session):
    bindings = copy.deepcopy(session.get("globals") or {})
    return {
        "version": 1,
        "entries": [{"name": key, "type": type(value).__name__, "preview": str(value)} for key, value in bindings.items()],
        "bindings": bindings,
        "globals": copy.deepcopy(bindings),
        "closed": bool(session.get("closed")),
    }


def _runtime_protocol_fixture_server_main():
    mode = os.environ.get("AXIR_RUNTIME_PROTOCOL_FIXTURE_MODE", "normal")
    sessions: dict[str, dict[str, Any]] = {}
    next_session = 0
    for line in sys.stdin:
        if mode == "eof":
            return
        if mode == "malformed_json":
            print("{not-json", flush=True)
            return
        if mode == "nonzero":
            print("fixture stderr before nonzero exit", file=sys.stderr, flush=True)
            raise SystemExit(7)
        try:
            message = json.loads(line)
            op = message.get("op")
            response_id = "mismatch" if mode == "id_mismatch" else message.get("id")
            if op == "capabilities":
                response = {"id": response_id, "ok": True, "result": {
                    "language": "JavaScript",
                    "usage_instructions": "fixture protocol runtime",
                    "inspect": mode != "unavailable",
                    "snapshot": mode != "unavailable",
                    "patch": mode != "unavailable",
                    "abort": True,
                }}
            elif op == "create_session":
                next_session += 1
                session_id = f"s{next_session}"
                payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
                globals_ = copy.deepcopy(payload.get("globals") if isinstance(payload.get("globals"), dict) else {})
                globals_["__create_options"] = copy.deepcopy(payload.get("options") if isinstance(payload.get("options"), dict) else {})
                sessions[session_id] = {"globals": globals_, "closed": False}
                response = {"id": response_id, "ok": True, "session_id": session_id, "result": {"session_id": session_id}}
            elif op == "execute":
                session_id = message.get("session_id")
                session = sessions.get(session_id or "")
                if not session or session.get("closed"):
                    response = _runtime_protocol_fail(message, "session_closed", "session closed or unknown")
                else:
                    payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
                    code = str(payload.get("code") or "")
                    session["globals"]["__last_execute_options"] = copy.deepcopy(payload.get("options") if isinstance(payload.get("options"), dict) else {})
                    if code == "timeout()":
                        response = _runtime_protocol_fail(message, "timeout", "fixture timeout")
                    elif code == "sessionClosed()":
                        response = _runtime_protocol_fail(message, "session_closed", "fixture session closed")
                    elif code == "abort()":
                        response = _runtime_protocol_fail(message, "abort", "fixture abort")
                    elif code == "userError()":
                        response = _runtime_protocol_fail(message, "user_error", "fixture user error")
                    else:
                        session["globals"]["answer"] = "fixture"
                        response = _runtime_protocol_response(message, {"type": "final", "args": [{"answer": "fixture"}]}, session_id=session_id)
                if mode == "session_mismatch" and response.get("ok"):
                    response["session_id"] = "wrong-session"
            elif op == "inspect_globals":
                if mode == "unavailable":
                    response = _runtime_protocol_fail(message, "unavailable", "inspectGlobals unavailable")
                else:
                    response = _runtime_protocol_response(message, copy.deepcopy((sessions.get(message.get("session_id") or "") or {}).get("globals") or {}), session_id=message.get("session_id"))
            elif op == "snapshot_globals":
                if mode == "unavailable":
                    response = _runtime_protocol_fail(message, "unavailable", "snapshotGlobals unavailable")
                else:
                    response = _runtime_protocol_response(message, _runtime_protocol_snapshot(sessions.get(message.get("session_id") or "") or {}), session_id=message.get("session_id"))
            elif op == "patch_globals":
                if mode == "unavailable":
                    response = _runtime_protocol_fail(message, "unavailable", "patchGlobals unavailable")
                else:
                    session = sessions.get(message.get("session_id") or "")
                    payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
                    raw = payload.get("globals") if isinstance(payload.get("globals"), dict) else {}
                    bindings = raw.get("bindings") if isinstance(raw.get("bindings"), dict) else raw
                    if session is not None:
                        session["globals"] = copy.deepcopy(bindings)
                    response = _runtime_protocol_response(message, _runtime_protocol_snapshot(session or {}), session_id=message.get("session_id"))
            elif op == "close":
                session = sessions.get(message.get("session_id") or "")
                if session is not None:
                    session["closed"] = True
                response = _runtime_protocol_response(message, {"closed": True}, session_id=message.get("session_id"))
            elif op == "shutdown":
                response = _runtime_protocol_response(message, {"shutdown": True})
            else:
                response = _runtime_protocol_fail(message, "protocol", f"unknown runtime protocol op: {op}")
            print(json.dumps(response, separators=(",", ":")), flush=True)
            if op == "shutdown":
                return
        except Exception as exc:
            print(json.dumps(_runtime_protocol_fail({"id": None}, "protocol", str(exc))), flush=True)


def _runtime_protocol_command(mode="normal"):
    env = {"AXIR_RUNTIME_PROTOCOL_FIXTURE_MODE": mode}
    return ProcessCodeRuntime([sys.executable, "-m", "axllm.conformance", "--runtime-protocol-fixture-server"], env=env)


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
        elif kind == "ai_provider_descriptor":
            _run_ai_provider_descriptor(fixture)
        elif kind == "ai_provider_registry":
            _run_ai_provider_registry(fixture)
        elif kind == "ai_model_catalog_audit":
            _run_ai_model_catalog_audit(fixture)
        elif kind == "ai_model_catalog_runtime":
            _run_ai_model_catalog_runtime(fixture)
        elif kind == "ai_multiservice_router":
            _run_ai_multiservice_router(fixture)
        elif kind == "ai_provider_router":
            _run_ai_provider_router(fixture)
        elif kind == "ai_balancer":
            _run_ai_balancer(fixture)
        elif kind == "ai_transcribe":
            _run_ai_transcribe(fixture)
        elif kind == "ai_speak":
            _run_ai_speak(fixture)
        elif kind == "ai_realtime":
            _run_ai_realtime(fixture)
        elif kind == "agent_forward":
            _run_agent_forward(fixture)
        elif kind == "agent_runtime_policy":
            _run_agent_runtime_policy(fixture)
        elif kind == "agent_runtime_session":
            _run_agent_runtime_session(fixture)
        elif kind == "agent_runtime_adapter":
            _run_agent_runtime_adapter(fixture)
        elif kind == "agent_runtime_protocol":
            _run_agent_runtime_protocol(fixture)
        elif kind == "program_contract":
            _run_program_contract(fixture)
        elif kind == "flow":
            _run_flow(fixture)
        elif kind == "optimize":
            _run_optimize(fixture)
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
    chunks = []
    try:
        for event in fixture.get("stream_events") or []:
            chunks.append(event)
            content = fold_stream(chunks)
            for assertion in fixture.get("streaming_assertions") or []:
                needle = assertion.get("not_contains", assertion.get("notContains"))
                if needle is not None and str(needle) in str(content):
                    raise RuntimeError(assertion.get("message") or "streaming assertion failed")
    except Exception as exc:
        if "expected_error_contains" not in fixture:
            raise
        _assert_expected_error(exc, fixture)
        return
    if "expected_error_contains" in fixture:
        raise FixtureError("expected stream assertion to fail")
    _assert_equal(fold_stream(chunks), fixture.get("expected_folded", ""), "stream fold")


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
        gen.add_assert(assertion)
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


def _flow_build_step_from_fixture(step, fixture):
    kind = step.get("kind", "execute")
    name = step.get("name")
    options = copy.deepcopy(step.get("options") or {})
    if kind == "map":
        mapper = _flow_mapper_from_spec(step["mapper"]) if "mapper" in step else _FlowCallable(lambda _state, output=copy.deepcopy(step.get("output") or {}): copy.deepcopy(output))
        return _flow_step("map", name, mapper, options)
    if kind == "branch":
        predicate_spec = step.get("predicate", options.get("predicate"))
        options["predicate"] = _flow_condition_from_spec(predicate_spec)
        branches = []
        for branch in step.get("branches", options.get("branches") or []):
            branches.append({
                "when": branch.get("when"),
                "steps": [_flow_build_step_from_fixture(child, fixture) for child in branch.get("steps") or []],
            })
        options["branches"] = branches
        return _flow_step("branch", name, None, options)
    if kind == "while" or kind == "feedback":
        condition_spec = step.get("condition", options.get("condition"))
        options["condition"] = _flow_condition_from_spec(condition_spec)
        options["steps"] = [_flow_build_step_from_fixture(child, fixture) for child in step.get("steps", options.get("steps") or [])]
        return _flow_step(kind, name, None, options)
    if kind == "parallel" or kind == "parallelMerge":
        return _flow_step(kind, name, None, options)
    step_options = {**(step.get("forward_options") or {}), **options}
    if step.get("program") == "flow":
        program = _build_flow({
            "flow_options": step.get("flow_options") or {"id": step.get("program_id", f"root.{name}")},
            "steps": step.get("steps") or [],
            "returns": step.get("returns") or {},
            "signature": step.get("signature", fixture.get("signature", "question:string -> answer:string")),
        })
    elif step.get("program") == "agent":
        program = agent(step.get("signature", fixture.get("signature", "question:string -> answer:string")), step.get("options") or {})
    else:
        signature = step.get("extended_signature") or step.get("extendedSignature") or step.get("signature", fixture.get("signature", "question:string -> answer:string"))
        program = ax(signature, step.get("options") or {})
    return _flow_step(kind, name, program, step_options)


def _build_flow(fixture):
    fl = flow(fixture.get("flow_options") or {"id": fixture.get("program_id", "root.flow")})
    for step in fixture.get("steps") or []:
        _flow_add_step(fl.state, _flow_build_step_from_fixture(step, fixture))
    if "returns" in fixture:
        fl.returns(fixture.get("returns") or {})
    if "demos" in fixture:
        fl.set_demos(fixture.get("demos") or {})
    return fl


def _run_program_contract(fixture):
    program = ax(fixture.get("signature", "question:string -> answer:string"), fixture.get("options") or {})
    if fixture.get("program") == "flow":
        program = _build_flow(fixture)
    components = program.get_optimizable_components()
    if "expected_component_ids" in fixture:
        _assert_equal([item.get("id") for item in components], fixture["expected_component_ids"], "program component ids")
    if "expected_components_subset" in fixture:
        _assert_list_subset(components, fixture["expected_components_subset"], "program components")


def _run_flow(fixture):
    try:
        fl = _build_flow(fixture)
        if fixture.get("operation") == "cache_key":
            keys = [_flow_cache_key(item) for item in fixture.get("cache_key_inputs") or []]
            if fixture.get("expected_cache_keys_equal") and len(set(keys)) != 1:
                raise FixtureError(f"expected equal flow cache keys, got {keys}")
            if fixture.get("expected_cache_keys_distinct") and len(set(keys)) != len(keys):
                raise FixtureError(f"expected distinct flow cache keys, got {keys}")
            return
        if "expected_plan" in fixture:
            _assert_equal(fl.get_plan(), fixture["expected_plan"], "flow plan")
        if "expected_plan_subset" in fixture:
            _assert_list_subset(fl.get_plan(), fixture["expected_plan_subset"], "flow plan")
        if fixture.get("operation") == "plan":
            return
        client = FakeAIService(fixture.get("responses") or [], fixture.get("stream_events") or [])
        forward_options = copy.deepcopy(fixture.get("forward_options") or {})
        if "cache_seed_value" in fixture:
            cache_store = forward_options.setdefault("cache_store", {})
            cache_store[_flow_cache_key(fixture.get("input") or {})] = copy.deepcopy(fixture.get("cache_seed_value"))
        if fixture.get("operation") == "streaming":
            output = list(fl.streaming_forward(client, fixture.get("input") or {}, forward_options))
        else:
            output = fl.forward(client, fixture.get("input") or {}, forward_options)
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected flow to fail")
    if "expected_output" in fixture:
        _assert_equal(output, fixture["expected_output"], "flow output")
    if "expected_streaming_output" in fixture:
        _assert_equal(output, fixture["expected_streaming_output"], "flow streaming output")
    if "expected_request_count" in fixture and len(client.requests) != fixture["expected_request_count"]:
        raise FixtureError(f"expected {fixture['expected_request_count']} requests, got {len(client.requests)}")
    if "expected_request_contains" in fixture:
        request_text = json.dumps(client.requests, sort_keys=True)
        for item in fixture.get("expected_request_contains") or []:
            if str(item) not in request_text:
                raise FixtureError(f"flow request missing {item!r}: {request_text}")
    if "expected_chat_log_subset" in fixture:
        _assert_list_subset(fl.get_chat_log(), fixture["expected_chat_log_subset"], "flow chat log")
    if "expected_trace_kinds" in fixture:
        _assert_equal([event.get("kind") for event in fl.get_traces()], fixture["expected_trace_kinds"], "flow trace kinds")
    if "expected_trace_subset" in fixture:
        _assert_list_subset(fl.get_traces(), fixture["expected_trace_subset"], "flow traces")
    if "expected_usage_subset" in fixture:
        _assert_subset(fl.get_usage(), fixture["expected_usage_subset"], "flow usage")
    if "expected_cache_store_subset" in fixture:
        cache_store = forward_options.get("cache_store") or forward_options.get("cacheStore") or {}
        _assert_subset(cache_store, fixture["expected_cache_store_subset"], "flow cache store")
    if "expected_cache_value_for_input" in fixture:
        cache_store = forward_options.get("cache_store") or forward_options.get("cacheStore") or {}
        _assert_equal(cache_store.get(_flow_cache_key(fixture.get("input") or {})), fixture["expected_cache_value_for_input"], "flow cache value")
    if "expected_components_subset" in fixture:
        _assert_list_subset(fl.get_optimizable_components(), fixture["expected_components_subset"], "flow components")


def _run_optimize(fixture):
    class FakeOptimizer(OptimizerEngine):
        name = "fake"
        version = "1"

        def __init__(self, response):
            self.response = response
            self.requests = []
            self.evaluations = []
            self.transcripts = []

        def optimize(self, request, evaluator=None):
            self.requests.append(copy.deepcopy(request))
            if evaluator is not None and isinstance(self.response, dict):
                if "referenceCandidates" in self.response:
                    best_map = {}
                    best_score = None
                    for step in self.response.get("referenceCandidates") or []:
                        candidate_map = step.get("component_map") or step.get("componentMap") or {}
                        eval_options = step.get("options") or {}
                        result = evaluator.evaluate(candidate_map, eval_options)
                        evidence = _build_optimizer_evidence_batch(result, request.get("components") or [])
                        self.evaluations.append(copy.deepcopy(result))
                        self.transcripts.append({
                            "candidateMap": copy.deepcopy(candidate_map),
                            "options": copy.deepcopy(eval_options),
                            "result": copy.deepcopy(result),
                            "evidence": copy.deepcopy(evidence),
                        })
                        score = result.get("avg", 0) if isinstance(result, dict) else 0
                        if best_score is None or score > best_score:
                            best_score = score
                            best_map = copy.deepcopy(candidate_map)
                    return {
                        "componentMap": best_map,
                        "metadata": {
                            "referenceEngine": True,
                            "evaluations": copy.deepcopy(self.transcripts),
                        },
                    }
                for step in self.response.get("evaluate") or []:
                    candidate_map = step.get("component_map") or step.get("componentMap") or {}
                    eval_options = step.get("options") or {}
                    result = evaluator.evaluate(candidate_map, eval_options)
                    evidence = _build_optimizer_evidence_batch(result, request.get("components") or [])
                    self.evaluations.append(copy.deepcopy(result))
                    self.transcripts.append({
                        "candidateMap": copy.deepcopy(candidate_map),
                        "options": copy.deepcopy(eval_options),
                        "result": copy.deepcopy(result),
                        "evidence": copy.deepcopy(evidence),
                    })
            return copy.deepcopy(self.response)

    class ScriptedGEPAEvaluator(OptimizerEvaluator):
        def __init__(self, fixture):
            self.fixture = fixture
            self.evaluations = []

        def evaluate(self, candidate_map, options=None):
            opts = options or {}
            normalized = _normalize_optimization_dataset(opts.get("dataset") or self.fixture.get("dataset") or [])
            rows = []
            score_component = self.fixture.get("score_component_id")
            components = self.fixture.get("components") or []
            if not score_component and components:
                score_component = components[0].get("id")
            component_value = (candidate_map or {}).get(score_component, self.fixture.get("base_component_value", ""))
            score_map = self.fixture.get("gepa_scores") or {}
            scripted = score_map.get(str(component_value), score_map.get("*", 0))
            for index, task in enumerate(normalized.get("train") or []):
                raw_score = scripted[index] if isinstance(scripted, list) and scripted else scripted
                if isinstance(scripted, list) and index >= len(scripted):
                    raw_score = scripted[-1]
                scores = _normalize_optimization_metric_scores(raw_score)
                scalar = _scalarize_optimization_scores(scores, self.fixture.get("score_options") or {})
                prediction = {
                    "completionType": "final",
                    "output": {"componentValue": component_value},
                    "finalOutput": {"componentValue": component_value},
                    "functionCalls": [],
                    "actionLog": [],
                    "usage": {},
                    "trace": {"componentValue": component_value},
                }
                rows.append(_build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), None))
            result = _build_optimization_eval_result(rows, candidate_map or {}, opts.get("phase", "train"))
            self.evaluations.append(copy.deepcopy(result))
            return result

    def build_gepa_request():
        components = copy.deepcopy(fixture.get("components") or program.get_optimizable_components())
        dataset = _normalize_optimization_dataset(fixture.get("dataset") or [])
        return {
            "contractVersion": "axir-optimize-contract-v1",
            "programKind": fixture.get("program", "axgen"),
            "components": components,
            "dataset": dataset,
            "options": copy.deepcopy(fixture.get("optimize_options") or {}),
            "trace": {},
            "evaluator": {"available": True, "contractVersion": "axir-optimizer-evaluator-v1"},
        }

    def build_program():
        sig = fixture.get("signature", "question:string -> answer:string")
        options = copy.deepcopy(fixture.get("options") or {})
        tools, _ = _build_tools(fixture.get("tools") or [])
        if tools:
            options["functions"] = tools
        if fixture.get("program", "agent") == "axgen":
            return ax(sig, options)
        if fixture.get("program") == "flow":
            return _build_flow(fixture)
        return agent(sig, options)

    program = build_program()
    operation = fixture.get("operation", "components")
    try:
        if operation == "components":
            components = program.get_optimizable_components()
            if "expected_components_subset" in fixture:
                _assert_list_subset(components, fixture["expected_components_subset"], "optimizable components")
            if "expected_component_ids" in fixture:
                _assert_equal([item.get("id") for item in components], fixture["expected_component_ids"], "component ids")
            return
        if operation == "filter":
            components = program.get_optimizable_components()
            filtered = _filter_optimization_components(components, fixture.get("target", "all"))
            _assert_equal([item.get("id") for item in filtered], fixture.get("expected_component_ids", []), "filtered component ids")
            return
        if operation == "apply":
            before = program.get_optimizable_components()
            artifact = _optimized_artifact("fixture", "1", fixture.get("component_map") or {}, fixture.get("metadata") or {"source": "fixture"})
            artifact = _validate_optimized_artifact(artifact, before)
            payload = _serialize_optimized_artifact(artifact) if fixture.get("serialized_artifact") else artifact
            program.apply_optimization(payload)
            after = program.get_optimizable_components()
            if "expected_components_subset" in fixture:
                _assert_list_subset(after, fixture["expected_components_subset"], "optimized components")
            if "expected_changed_components" in fixture:
                _assert_equal(_optimization_changed_components(before, fixture.get("component_map") or {}), fixture["expected_changed_components"], "changed components")
            return
        if operation == "artifact":
            components = program.get_optimizable_components()
            artifact = _optimized_artifact("fixture", "1", fixture.get("component_map") or {}, fixture.get("metadata") or {})
            validated = _validate_optimized_artifact(artifact, components)
            text = _serialize_optimized_artifact(validated)
            decoded = _deserialize_optimized_artifact(text, components)
            if "expected_artifact_subset" in fixture:
                _assert_subset(decoded, fixture["expected_artifact_subset"], "optimized artifact")
            return
        if operation == "dataset":
            normalized = _normalize_optimization_dataset(fixture.get("dataset") or [])
            _assert_equal(normalized, fixture.get("expected_dataset"), "normalized dataset")
            return
        if operation == "score":
            scores = _normalize_optimization_metric_scores(fixture.get("metric_score"))
            scalar = _scalarize_optimization_scores(scores, fixture.get("score_options") or {})
            prediction = fixture.get("prediction") or {"functionCalls": []}
            adjusted = _adjust_optimization_score_for_actions(scalar, fixture.get("task") or {}, prediction)
            if "expected_scores" in fixture:
                _assert_equal(scores, fixture["expected_scores"], "metric scores")
            if "expected_scalar" in fixture:
                _assert_equal(adjusted, fixture["expected_scalar"], "metric scalar")
            if "quality" in fixture:
                _assert_equal(_map_optimization_judge_quality_to_score(fixture["quality"]), fixture.get("expected_quality_score"), "judge quality score")
            return
        if operation == "judge_payload":
            payload = _build_optimization_judge_payload(fixture.get("task") or {}, fixture.get("prediction") or {}, fixture.get("criteria") or "")
            if "expected_judge_payload_subset" in fixture:
                _assert_subset(payload, fixture["expected_judge_payload_subset"], "judge payload")
            return
        if operation == "evidence":
            components = fixture.get("components") or program.get_optimizable_components()
            eval_result = fixture.get("eval_result") or {}
            evidence = _build_optimizer_evidence_batch(eval_result, components)
            if "expected_evidence_subset" in fixture:
                _assert_subset(evidence, fixture["expected_evidence_subset"], "optimizer evidence")
            return
        if operation == "evaluate":
            if not hasattr(program, "evaluate_optimization"):
                raise FixtureError("evaluate operation requires an optimizable program")
            client = FakeAIService(fixture.get("responses") or [], fixture.get("stream_events") or [])
            result = program.evaluate_optimization(client, fixture.get("dataset") or [], fixture.get("candidate_map") or {}, fixture.get("eval_options") or {})
            if "expected_evaluation_subset" in fixture:
                _assert_subset(result, fixture["expected_evaluation_subset"], "optimization evaluation")
            if "expected_evaluation_rows_subset" in fixture:
                _assert_list_subset(result.get("rows") or [], fixture["expected_evaluation_rows_subset"], "optimization evaluation rows")
            if "expected_components_subset_after" in fixture:
                _assert_list_subset(program.get_optimizable_components(), fixture["expected_components_subset_after"], "post-eval components")
            return
        if operation == "engine":
            engine = FakeOptimizer(fixture.get("engine_response") or {})
            opts = copy.deepcopy(fixture.get("optimize_options") or {})
            if fixture.get("engine_uses_evaluator"):
                opts["client"] = FakeAIService(fixture.get("responses") or [], fixture.get("stream_events") or [])
            artifact = program.optimize_with(engine, fixture.get("dataset") or [], opts)
            if "expected_engine_request_subset" in fixture:
                if not engine.requests:
                    raise FixtureError("optimizer engine was not called")
                _assert_subset(engine.requests[0], fixture["expected_engine_request_subset"], "optimizer engine request")
            if "expected_engine_evaluations_subset" in fixture:
                _assert_list_subset(engine.evaluations, fixture["expected_engine_evaluations_subset"], "optimizer engine evaluations")
            if "expected_engine_transcripts_subset" in fixture:
                _assert_list_subset(engine.transcripts, fixture["expected_engine_transcripts_subset"], "optimizer engine transcripts")
            if "expected_artifact_subset" in fixture:
                _assert_subset(artifact, fixture["expected_artifact_subset"], "optimizer artifact")
            if "expected_components_subset" in fixture:
                _assert_list_subset(program.get_optimizable_components(), fixture["expected_components_subset"], "optimized components")
            return
        if operation == "gepa":
            reflection = FakeAIService(fixture.get("reflection_responses") or [], fixture.get("stream_events") or [])
            engine = AxGEPA(reflection, **copy.deepcopy(fixture.get("gepa_options") or {}))
            evaluator = ScriptedGEPAEvaluator(fixture)
            artifact = engine.optimize(build_gepa_request(), evaluator)
            if "expected_artifact_subset" in fixture:
                _assert_subset(artifact, fixture["expected_artifact_subset"], "GEPA artifact")
            if "expected_gepa_evaluations_subset" in fixture:
                _assert_list_subset(evaluator.evaluations, fixture["expected_gepa_evaluations_subset"], "GEPA evaluations")
            return
        if operation == "eval":
            if not isinstance(program, AxAgent):
                raise FixtureError("eval operation requires agent program")
            client = FakeAIService(fixture.get("responses") or [], fixture.get("stream_events") or [])
            prediction = program.evaluate_optimization_task(client, fixture.get("task") or {"input": fixture.get("input") or {}}, fixture.get("eval_options") or {})
            if "expected_prediction_subset" in fixture:
                _assert_subset(prediction, fixture["expected_prediction_subset"], "eval prediction")
            return
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    raise FixtureError(f"unknown optimize operation {operation!r}")


def _run_agent_forward(fixture):
    client = FakeAIService(fixture.get("responses") or [], fixture.get("stream_events") or [])
    runtime = None
    agent_options = copy.deepcopy(fixture.get("options") or {})
    if "runtime_script" in fixture:
        runtime_config = agent_options.get("runtime") if isinstance(agent_options.get("runtime"), dict) else {}
        runtime = FakeCodeRuntime(
            fixture.get("runtime_script") or [],
            language=runtime_config.get("language", fixture.get("runtime_language", "JavaScript")),
            usage_instructions=runtime_config.get("usageInstructions", runtime_config.get("usage_instructions", "")),
        )
        agent_options["runtime"] = runtime
    ag = None
    try:
        ag = agent(fixture.get("signature"), agent_options)
        if "set_state" in fixture:
            ag.set_state(fixture.get("set_state") or {})
        output = ag.forward(client, fixture.get("input") or {}, fixture.get("forward_options"))
    except AxAgentClarificationError as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            if "expected_clarification" in fixture:
                _assert_subset(exc.clarification, fixture["expected_clarification"], "clarification")
            if ag is not None:
                _assert_agent_trace(ag, fixture)
            return
        raise
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            if ag is not None:
                _assert_agent_trace(ag, fixture)
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected agent forward to fail")
    if "expected_output" in fixture:
        _assert_equal(output, fixture["expected_output"], "agent output")
    if "expected_request_count" in fixture and len(client.requests) != fixture["expected_request_count"]:
        raise FixtureError(f"expected {fixture['expected_request_count']} requests, got {len(client.requests)}")
    if "expected_request_contains" in fixture:
        request_text = json.dumps(client.requests, sort_keys=True)
        for item in fixture.get("expected_request_contains") or []:
            if str(item) not in request_text:
                raise FixtureError(f"agent request missing {item!r}: {request_text}")
    if "expected_stage_request_not_contains" in fixture:
        for raw in fixture["expected_stage_request_not_contains"]:
            index = int(raw.get("index", 0))
            text = json.dumps(client.requests[index], sort_keys=True) if index < len(client.requests) else ""
            for item in raw.get("absent") or []:
                if str(item) in text:
                    raise FixtureError(f"agent request {index} unexpectedly contained {item!r}: {text}")
    if "expected_stage_request_subset" in fixture:
        for raw in fixture["expected_stage_request_subset"]:
            index = int(raw.get("index", 0))
            if index >= len(client.requests):
                raise FixtureError(f"missing agent request index {index}")
            _assert_subset(client.requests[index], raw.get("request") or {}, f"agent request {index}")
    if "expected_cached_request_indices" in fixture:
        for index in fixture.get("expected_cached_request_indices") or []:
            idx = int(index)
            if idx >= len(client.requests):
                raise FixtureError(f"missing cached request index {idx}")
            prompt = client.requests[idx].get("chat_prompt") or []
            if not any(isinstance(message, dict) and message.get("cache") is True for message in prompt):
                raise FixtureError(f"agent request {idx} did not contain a cached prompt message: {prompt!r}")
    if "expected_chat_log_subset" in fixture:
        _assert_list_subset(ag.get_chat_log(), fixture["expected_chat_log_subset"], "agent chat log")
    if "expected_state" in fixture:
        _assert_subset(ag.get_state(), fixture["expected_state"], "agent state")
    exported = ag.export_runtime_state()
    if "expected_runtime_contract_subset" in fixture:
        _assert_subset(ag.get_runtime_contract(), fixture["expected_runtime_contract_subset"], "runtime contract")
    if "expected_exported_state_subset" in fixture:
        _assert_subset(exported, fixture["expected_exported_state_subset"], "runtime state")
    if "expected_action_log_subset" in fixture:
        _assert_list_subset(exported.get("action_log") or [], fixture["expected_action_log_subset"], "action log")
    if runtime is not None and "expected_executed" in fixture:
        _assert_equal(runtime.executed, fixture["expected_executed"], "executed code")
    _assert_agent_trace(ag, fixture)


def _assert_agent_trace(ag, fixture):
    trace = ag.export_trace()
    if "expected_trace_subset" in fixture:
        _assert_subset(trace, fixture["expected_trace_subset"], "agent trace")
    if "expected_trace_event_kinds" in fixture:
        kinds = [event.get("kind") for event in trace.get("events") or []]
        _assert_equal(kinds, fixture["expected_trace_event_kinds"], "agent trace event kinds")
    if fixture.get("replay_trace"):
        replay_fixtures = dict(fixture.get("replay_fixtures") or {})
        if "expected_trace_event_kinds" in fixture and "expected_event_kinds" not in replay_fixtures:
            replay_fixtures["expected_event_kinds"] = fixture["expected_trace_event_kinds"]
        if "expected_output" in fixture and "expected_output" not in replay_fixtures:
            replay_fixtures["expected_output"] = fixture["expected_output"]
        replayed = ag.replay_trace(trace, replay_fixtures)
        if "expected_replay_result_subset" in fixture:
            _assert_subset(replayed, fixture["expected_replay_result_subset"], "agent replay")
        else:
            _assert_subset(replayed, {"ok": True, "status": "replayed"}, "agent replay")


def _run_agent_runtime_policy(fixture):
    ag = None
    try:
        ag = agent(fixture.get("signature", "question:string -> answer:string"), fixture.get("options") or {})
        if "discover" in fixture:
            result = ag.discover(fixture.get("discover") or {})
            if "expected_discover_result" in fixture:
                _assert_equal(result, fixture.get("expected_discover_result"), "discover result")
        if "recall" in fixture:
            result = ag.recall(fixture.get("recall") or [])
            if "expected_recall_result" in fixture:
                _assert_equal(result, fixture.get("expected_recall_result"), "recall result")
        if "used" in fixture:
            used = fixture.get("used") or {}
            result = ag.used(used.get("id"), used.get("reason"), used.get("stage", "executor"))
            if "expected_used_result" in fixture:
                _assert_equal(result, fixture.get("expected_used_result"), "used result")
        if "invoke_callable" in fixture:
            call = fixture.get("invoke_callable") or {}
            result = ag.invoke_callable(call.get("qualified_name") or call.get("name"), call.get("args") or {})
            if "expected_callable_result_subset" in fixture:
                _assert_subset(result, fixture.get("expected_callable_result_subset"), "callable result")
        if "replay_trace_input" in fixture:
            result = ag.replay_trace(fixture.get("replay_trace_input") or {}, fixture.get("replay_fixtures") or {})
            if "expected_replay_result_subset" in fixture:
                _assert_subset(result, fixture.get("expected_replay_result_subset"), "agent replay")
        if "restore_runtime_state" in fixture:
            ag.restore_runtime_state(fixture.get("restore_runtime_state") or {})
        if "context_operation" in fixture:
            result = _agent_context_fixture_result(ag.state, fixture)
            if "expected_context_result" in fixture:
                _assert_equal(result, fixture.get("expected_context_result"), "agent context result")
            if "expected_context_result_subset" in fixture:
                _assert_subset(result, fixture.get("expected_context_result_subset"), "agent context result")
            if "expected_context_events_subset" in fixture:
                exported = (result or {}).get("exported") or {}
                _assert_list_subset(exported.get("context_events") or [], fixture.get("expected_context_events_subset"), "agent context events")
        if "final_payload" in fixture:
            payload = _normalize_agent_final_payload(fixture.get("final_payload"))
            _assert_equal(payload, fixture.get("expected_final_payload"), "final payload")
        if "clarification_payload" in fixture:
            payload = _normalize_agent_clarification_payload(fixture.get("clarification_payload"))
            _assert_equal(payload, fixture.get("expected_clarification_payload"), "clarification payload")
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected agent runtime policy fixture to fail")
    if "expected_runtime_contract_subset" in fixture:
        _assert_subset(ag.get_runtime_contract(), fixture["expected_runtime_contract_subset"], "runtime contract")
    if "expected_policy_subset" in fixture:
        _assert_subset(ag.get_policy(), fixture["expected_policy_subset"], "agent policy")
    if "expected_policy_registry_subset" in fixture:
        _assert_subset(ag.get_policy_registry(), fixture["expected_policy_registry_subset"], "policy registry")
    registry = ag.get_policy_registry()
    if "expected_actor_primitives_subset" in fixture:
        _assert_list_subset(registry.get("actor_primitives") or [], fixture["expected_actor_primitives_subset"], "actor primitives")
    if "expected_protocol_actions_subset" in fixture:
        _assert_list_subset(registry.get("protocol_actions") or [], fixture["expected_protocol_actions_subset"], "protocol actions")
    if "expected_runtime_globals_subset" in fixture:
        _assert_list_subset(registry.get("runtime_globals") or [], fixture["expected_runtime_globals_subset"], "runtime globals")
    if "expected_host_boundaries_subset" in fixture:
        _assert_list_subset(registry.get("host_boundaries") or [], fixture["expected_host_boundaries_subset"], "host boundaries")
    if "expected_callable_inventory_subset" in fixture:
        _assert_list_subset(ag.get_callable_inventory(), fixture["expected_callable_inventory_subset"], "callable inventory")
    if "expected_discovery_catalog_subset" in fixture:
        _assert_list_subset(ag.get_discovery_catalog(), fixture["expected_discovery_catalog_subset"], "discovery catalog")
    state = ag.export_runtime_state()
    if "expected_discovered_tool_docs_subset" in fixture:
        _assert_list_subset(state.get("discovered_tool_docs") or [], fixture["expected_discovered_tool_docs_subset"], "discovered tools")
    if "expected_loaded_skill_docs_subset" in fixture:
        _assert_list_subset(state.get("loaded_skill_docs") or [], fixture["expected_loaded_skill_docs_subset"], "loaded skills")
    if "expected_loaded_memories_subset" in fixture:
        _assert_list_subset(state.get("loaded_memories") or [], fixture["expected_loaded_memories_subset"], "loaded memories")
    if "expected_used_memories_subset" in fixture:
        _assert_list_subset(state.get("used_memories") or [], fixture["expected_used_memories_subset"], "used memories")
    if "expected_used_skills_subset" in fixture:
        _assert_list_subset(state.get("used_skills") or [], fixture["expected_used_skills_subset"], "used skills")
    if "expected_guidance_log_subset" in fixture:
        _assert_list_subset(state.get("guidance_log") or [], fixture["expected_guidance_log_subset"], "guidance log")
    if "expected_function_call_traces_subset" in fixture:
        _assert_list_subset(state.get("function_call_traces") or [], fixture["expected_function_call_traces_subset"], "function call traces")
    if "expected_policy_trace_subset" in fixture:
        _assert_list_subset(state.get("policy_trace") or [], fixture["expected_policy_trace_subset"], "policy trace")
    if "expected_action_log_subset" in fixture:
        _assert_list_subset(state.get("action_log") or [], fixture["expected_action_log_subset"], "action log")
    if "expected_exported_state_subset" in fixture:
        _assert_subset(state, fixture["expected_exported_state_subset"], "exported runtime state")
    if "expected_optimizer_metadata_subset" in fixture:
        _assert_subset(ag.get_optimizer_metadata(), fixture["expected_optimizer_metadata_subset"], "optimizer metadata")
    _assert_agent_trace(ag, fixture)


def _run_agent_runtime_session(fixture):
    ag = agent(fixture.get("signature", "question:string -> answer:string"), fixture.get("options") or {})
    runtime = FakeCodeRuntime(
        fixture.get("runtime_script") or [],
        capabilities=fixture.get("runtime_capabilities") or {},
    )
    caught_expected_error = False
    result = None
    try:
        operation = fixture.get("operation", "test")
        if operation == "test":
            result = ag.test(
                runtime,
                fixture.get("code", ""),
                fixture.get("context_values") or fixture.get("input") or {},
                fixture.get("runtime_options") or {},
            )
        elif operation == "steps":
            result = None
            for step in fixture.get("steps") or []:
                if "restore_session_state" in step:
                    ag.restore_session_state(step.get("restore_session_state") or {})
                result = ag.execute_actor_step(
                    runtime,
                    step.get("code", ""),
                    step.get("values") or fixture.get("context_values") or fixture.get("input") or {},
                    step.get("options") or {},
                )
                if step.get("inspect"):
                    ag.inspect_runtime()
                if step.get("export_session_state"):
                    ag.export_session_state()
            if fixture.get("close_runtime_session"):
                ag.close_runtime_session()
        elif operation == "reserved":
            result = ag.test(runtime, fixture.get("code", ""), fixture.get("context_values") or {}, {})
        else:
            raise FixtureError(f"unknown agent runtime session operation {operation!r}")
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            caught_expected_error = True
            result = None
        else:
            raise
    if "expected_error_contains" in fixture and not caught_expected_error:
        raise FixtureError("expected agent runtime session fixture to fail")
    if "expected_result_subset" in fixture:
        _assert_subset(result, fixture["expected_result_subset"], "runtime result")
    if "expected_result" in fixture:
        _assert_equal(result, fixture["expected_result"], "runtime result")
    exported = ag.export_runtime_state()
    if "expected_exported_state_subset" in fixture:
        _assert_subset(exported, fixture["expected_exported_state_subset"], "runtime state")
    if "expected_action_log_subset" in fixture:
        _assert_list_subset(exported.get("action_log") or [], fixture["expected_action_log_subset"], "action log")
    if "expected_status_log_subset" in fixture:
        _assert_list_subset(exported.get("status_log") or [], fixture["expected_status_log_subset"], "status log")
    if "expected_session_count" in fixture and len(runtime.sessions) != fixture["expected_session_count"]:
        raise FixtureError(f"expected {fixture['expected_session_count']} sessions, got {len(runtime.sessions)}")
    if "expected_closed_session_count" in fixture:
        closed_count = sum(1 for session in runtime.sessions if getattr(session, "closed", False))
        if closed_count != fixture["expected_closed_session_count"]:
            raise FixtureError(f"expected {fixture['expected_closed_session_count']} closed sessions, got {closed_count}")
    if "expected_executed" in fixture:
        _assert_equal(runtime.executed, fixture["expected_executed"], "executed code")
    if "expected_create_globals_subset" in fixture:
        if not runtime.create_requests:
            raise FixtureError("expected at least one runtime create_session request")
        _assert_subset(runtime.create_requests[-1].get("globals") or {}, fixture["expected_create_globals_subset"], "runtime create globals")
    if "expected_create_options_subset" in fixture:
        if not runtime.create_requests:
            raise FixtureError("expected at least one runtime create_session request")
        _assert_subset(runtime.create_requests[-1].get("options") or {}, fixture["expected_create_options_subset"], "runtime create options")
    if "expected_execute_options_subset" in fixture:
        if not runtime.execute_options:
            raise FixtureError("expected at least one runtime execute request")
        _assert_subset(runtime.execute_options[-1], fixture["expected_execute_options_subset"], "runtime execute options")
    if "expected_runtime_inspection" in fixture:
        _assert_equal(exported.get("runtime_inspection"), fixture["expected_runtime_inspection"], "runtime inspection")
    if "expected_runtime_inspection_contains" in fixture:
        actual_inspection = str(exported.get("runtime_inspection"))
        if fixture["expected_runtime_inspection_contains"] not in actual_inspection:
            raise FixtureError(f"runtime inspection expected to contain {fixture['expected_runtime_inspection_contains']!r}, got {actual_inspection!r}")
    if "expected_absent_runtime_session_globals" in fixture:
        globals_ = (exported.get("runtime_session_state") or {}).get("globals") or {}
        for key in fixture["expected_absent_runtime_session_globals"]:
            if isinstance(globals_, dict) and key in globals_:
                raise FixtureError(f"runtime session globals unexpectedly contained {key!r}")
    _assert_agent_trace(ag, fixture)


def _runtime_adapter_call(spec):
    name = spec.get("name")
    args = spec.get("args") or []
    kwargs = spec.get("kwargs") or {}
    if name == "result":
        return RuntimeEnvelope.result(args[0] if args else None)
    if name == "error":
        return RuntimeEnvelope.error(args[0] if args else "", args[1] if len(args) > 1 else kwargs.get("category", "runtime"))
    if name == "session_closed":
        return RuntimeEnvelope.session_closed(args[0] if args else "session closed")
    if name == "timeout":
        return RuntimeEnvelope.timeout(args[0] if args else "execution timed out")
    if name == "final":
        return RuntimeEnvelope.final(*args)
    if name == "ask_clarification":
        return RuntimeEnvelope.ask_clarification(*args)
    if name == "discover":
        return RuntimeEnvelope.discover(args[0] if args else {})
    if name == "recall":
        return RuntimeEnvelope.recall(args[0] if args else [])
    if name == "used":
        return RuntimeEnvelope.used(args[0] if args else {}, kwargs.get("reason"), kwargs.get("stage"))
    if name == "status":
        return RuntimeEnvelope.status(args[0] if args else "success", args[1] if len(args) > 1 else "")
    if name == "guide_agent":
        return RuntimeEnvelope.guide_agent(args[0] if args else "", args[1] if len(args) > 1 else None)
    raise FixtureError(f"unknown runtime adapter helper {name!r}")


def _run_agent_runtime_adapter(fixture):
    if "capabilities" in fixture:
        raw = fixture.get("capabilities") or {}
        caps = RuntimeCapabilities(
            inspect=raw.get("inspect", True),
            snapshot=raw.get("snapshot", True),
            patch=raw.get("patch", True),
            abort=raw.get("abort", False),
            language=raw.get("language", "JavaScript"),
            usage_instructions=raw.get("usage_instructions", ""),
        )
        if "expected_capabilities" in fixture:
            _assert_subset(caps.to_dict(), fixture["expected_capabilities"], "runtime capabilities")
    for spec in fixture.get("helper_calls") or []:
        actual = _runtime_adapter_call(spec)
        if "expected" in spec:
            _assert_equal(actual, spec["expected"], f"runtime helper {spec.get('name')}")
        if "expected_subset" in spec:
            _assert_subset(actual, spec["expected_subset"], f"runtime helper {spec.get('name')}")
        if spec.get("normalize"):
            normalized = _normalize_agent_runtime_step_result(actual, spec.get("code", "<adapter>"))
            if "expected_normalized_subset" in spec:
                _assert_subset(normalized, spec["expected_normalized_subset"], f"runtime helper normalized {spec.get('name')}")
    if fixture.get("run_session"):
        script = [{"expected_code": "adapter()", "result": _runtime_adapter_call(fixture["run_session"])}]
        session_fixture = {
            "signature": fixture.get("signature", "question:string -> answer:string"),
            "operation": "test",
            "code": "adapter()",
            "context_values": fixture.get("context_values") or {"question": "adapter"},
            "runtime_script": script,
            "expected_result_subset": fixture.get("expected_result_subset"),
            "expected_action_log_subset": fixture.get("expected_action_log_subset"),
            "expected_trace_event_kinds": fixture.get("expected_trace_event_kinds"),
            "expected_closed_session_count": fixture.get("expected_closed_session_count"),
        }
        _run_agent_runtime_session({k: v for k, v in session_fixture.items() if v is not None})


def _run_agent_runtime_protocol(fixture):
    runtime = _runtime_protocol_command(fixture.get("mode", "normal"))
    session = None
    try:
        operation = fixture.get("operation", "roundtrip")
        if operation == "roundtrip":
            capabilities = runtime._request("capabilities", None, {}).get("result")
            if "expected_capabilities_subset" in fixture:
                _assert_subset(capabilities, fixture["expected_capabilities_subset"], "protocol capabilities")
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            result = session.execute(fixture.get("execute_code", "final()"), fixture.get("execute_options") or {})
            if "expected_execute_subset" in fixture:
                _assert_subset(result, fixture["expected_execute_subset"], "protocol execute")
            inspected = session.inspect_globals({})
            if "expected_inspect_subset" in fixture:
                _assert_subset(inspected, fixture["expected_inspect_subset"], "protocol inspect")
            snapshot = session.snapshot_globals({})
            if "expected_snapshot_subset" in fixture:
                _assert_subset(snapshot, fixture["expected_snapshot_subset"], "protocol snapshot")
            patched = session.patch_globals(fixture.get("patch_globals") or {}, {})
            if "expected_patch_subset" in fixture:
                _assert_subset(patched, fixture["expected_patch_subset"], "protocol patch")
            closed = session.close()
            if "expected_close_subset" in fixture:
                _assert_subset(closed, fixture["expected_close_subset"], "protocol close")
            return
        if operation == "execute_error":
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            result = session.execute(fixture.get("execute_code", "timeout()"), fixture.get("execute_options") or {})
            if "expected_execute_subset" in fixture:
                _assert_subset(result, fixture["expected_execute_subset"], "protocol execute error")
            return
        if operation == "unknown_op":
            runtime._request("unknown_op", None, {})
            raise FixtureError("expected unknown protocol op to fail")
        if operation == "capabilities_error":
            runtime._request("capabilities", None, {})
            raise FixtureError("expected protocol capabilities request to fail")
        if operation == "unavailable":
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            method = getattr(session, fixture.get("method", "inspect_globals"))
            method({})
            raise FixtureError("expected unavailable protocol method to fail")
        if operation == "session_mismatch":
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            runtime._request("execute", "s1", {"code": fixture.get("execute_code", "final()"), "options": {}})
            raise FixtureError("expected protocol session mismatch to fail")
        raise FixtureError(f"unknown runtime protocol operation {operation!r}")
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    finally:
        try:
            if session is not None:
                session.close()
        except Exception:
            pass
        try:
            runtime.shutdown()
        except Exception:
            pass


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
        elif method in ("transcribe", "speak"):
            getattr(client, method)(fixture.get("request") or {}, fixture.get("options"))
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


def _run_ai_provider_descriptor(fixture):
    descriptor = provider_descriptor(fixture.get("provider", "openai-compatible"))
    if "expected_output" in fixture:
        _assert_subset(descriptor, fixture["expected_output"], "provider descriptor")


def _run_ai_provider_registry(fixture):
    registry = provider_profile_registry()
    if "expected_output" in fixture:
        _assert_subset(registry, fixture["expected_output"], "provider profile registry")
    for alias, expected in (fixture.get("alias_expectations") or {}).items():
        _assert_equal(provider_normalize_profile(alias), expected, f"provider alias {alias}")


def _run_ai_model_catalog_audit(fixture):
    summary = provider_model_catalog_summary()
    if "expected_output" in fixture:
        _assert_subset(summary, fixture["expected_output"], "provider model catalog audit")


def _run_ai_model_catalog_runtime(fixture):
    model_type = fixture.get("model_type")
    result = get_supported_ai_models(model_type)
    expected = fixture.get("expected_output")
    if expected is not None:
        actual = {
            "providerCount": len(result),
            "providerNames": [item.get("name") for item in result],
            "modelCount": sum(len(item.get("models") or []) for item in result),
            "openaiFirstModel": next((p.get("models", [{}])[0].get("name") for p in result if p.get("name") == "openai" and p.get("models")), None),
            "openaiModelTypes": sorted(set(model.get("type") for p in result if p.get("name") == "openai" for model in p.get("models", []))),
        }
        _assert_subset(actual, expected, "provider model catalog runtime")
    if fixture.get("check_clone"):
        result[0]["models"].append({"name": "mutated"})
        fresh = get_supported_ai_models(model_type)
        _assert_equal(any(model.get("name") == "mutated" for model in fresh[0].get("models", [])), False, "catalog clone")


def _build_router_services(fixture):
    return [RouterFixtureService(spec) for spec in fixture.get("services", [])]


def _run_ai_multiservice_router(fixture):
    services = _build_router_services(fixture)
    entries = []
    for raw in fixture.get("router_entries", []):
        if raw.get("kind") == "key":
            entries.append({"key": raw["key"], "description": raw.get("description", ""), "service": services[raw.get("service_index", 0)], "isInternal": raw.get("isInternal", raw.get("is_internal"))})
        else:
            entries.append(services[raw.get("service_index", 0)])
    try:
        router = MultiServiceRouter(entries)
        outputs = {}
        for op in fixture.get("operations", []):
            name = op.get("name")
            if name == "chat":
                outputs[name] = router.chat(op.get("request") or {}, op.get("options"))
            elif name == "embed":
                outputs[name] = router.embed(op.get("request") or {}, op.get("options"))
            elif name == "transcribe":
                outputs[name] = router.transcribe(op.get("request") or {}, op.get("options"))
            elif name == "speak":
                outputs[name] = router.speak(op.get("request") or {}, op.get("options"))
            elif name == "set_options":
                router.set_options(op.get("options") or {})
        actual = {
            "outputs": outputs,
            "lastChat": router.get_last_used_chat_model(),
            "lastEmbed": router.get_last_used_embed_model(),
            "lastConfig": router.get_last_used_model_config(),
            "metrics": router.get_metrics(),
            "options": router.get_options(),
            "serviceCalls": [service.requests for service in services if service.requests],
        }
        expected_output = fixture.get("expected_output") or {}
        if "modelList" in expected_output:
            actual["modelList"] = router.get_model_list()
        if fixture.get("expected_error_contains"):
            raise FixtureError("expected multi-service router to fail")
        if "expected_output" in fixture:
            _assert_subset(actual, expected_output, "multi-service router")
    except Exception as exc:
        if not fixture.get("expected_error_contains"):
            raise
        if fixture["expected_error_contains"] not in str(exc):
            raise FixtureError(f"expected error containing {fixture['expected_error_contains']}, got {exc}")


def _run_ai_provider_router(fixture):
    services = _build_router_services(fixture)
    primary = services[fixture.get("primary_index", 0)] if services else None
    alternatives = [services[index] for index in fixture.get("alternative_indices", [])]
    router = ProviderRouter({
        "providers": {"primary": primary, "alternatives": alternatives},
        "routing": fixture.get("routing") or {"capability": {"requireExactMatch": False, "allowDegradation": True}},
        "processing": fixture.get("processing") or {},
    })
    request = fixture.get("request") or {}
    rec = router.get_routing_recommendation(request)
    provider = rec.get("provider")
    recommendation = {
        "provider": provider.get_name() if provider else rec.get("providerName"),
        "processingApplied": rec.get("processingApplied"),
        "degradations": rec.get("degradations"),
        "warnings": rec.get("warnings"),
    }
    actual = {
        "recommendation": recommendation,
        "validation": router.validate_request(request),
        "stats": router.get_routing_stats(),
    }
    if "expected_output" in fixture:
        _assert_subset(actual, fixture["expected_output"], "provider router")


def _run_ai_balancer(fixture):
    services = _build_router_services(fixture)
    try:
        balancer = AxBalancer(services, fixture.get("options") or {})
        outputs = {}
        for op in fixture.get("operations", []):
            name = op.get("name")
            if name == "chat":
                outputs[name] = balancer.chat(op.get("request") or {}, op.get("options"))
            elif name == "embed":
                outputs[name] = balancer.embed(op.get("request") or {}, op.get("options"))
            elif name == "transcribe":
                outputs[name] = balancer.transcribe(op.get("request") or {}, op.get("options"))
            elif name == "speak":
                outputs[name] = balancer.speak(op.get("request") or {}, op.get("options"))
            elif name == "set_options":
                balancer.set_options(op.get("options") or {})
        actual = {
            "id": balancer.get_id(),
            "name": balancer.get_name(),
            "outputs": outputs,
            "lastChat": balancer.get_last_used_chat_model(),
            "lastEmbed": balancer.get_last_used_embed_model(),
            "lastConfig": balancer.get_last_used_model_config(),
            "metrics": balancer.get_metrics(),
            "options": balancer.get_options(),
            "serviceCalls": [service.requests for service in services if service.requests],
        }
        expected_output = fixture.get("expected_output") or {}
        if "modelList" in expected_output:
            actual["modelList"] = balancer.get_model_list()
        if "features" in expected_output:
            actual["features"] = balancer.get_features()
        if fixture.get("expected_error_contains"):
            raise FixtureError("expected balancer to fail")
        if "expected_output" in fixture:
            _assert_subset(actual, fixture["expected_output"], "balancer")
    except Exception as exc:
        if not fixture.get("expected_error_contains"):
            raise
        if fixture["expected_error_contains"] not in str(exc):
            raise FixtureError(f"expected error containing {fixture['expected_error_contains']}, got {exc}")


def _run_ai_transcribe(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.transcribe(fixture.get("request") or {}, fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai transcribe output")
    _assert_transport_request(fixture, transport)


def _run_ai_speak(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.speak(fixture.get("request") or {}, fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai speak output")
    _assert_transport_request(fixture, transport)


def _run_ai_realtime(fixture):
    client, _ = _openai_fixture_client(fixture)
    try:
        request = fixture.get("request") or {}
        if "expected_setup" in fixture:
            _assert_equal(client.realtime_audio_setup(request), fixture["expected_setup"], "ai realtime setup")
        if "expected_input" in fixture:
            _assert_equal(client.realtime_audio_input(request), fixture["expected_input"], "ai realtime input")
        result = list(client.realtime(fixture.get("events") or []))
        if fixture.get("expected_error_contains"):
            raise FixtureError("expected ai realtime fixture to fail")
        if "expected_output" in fixture:
            _assert_equal(result, fixture["expected_output"], "ai realtime output")
    except Exception as exc:
        if not fixture.get("expected_error_contains"):
            raise
        if fixture["expected_error_contains"] not in str(exc):
            raise FixtureError(f"expected error containing {fixture['expected_error_contains']}, got {exc}")


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
    provider = provider_normalize_profile(str(fixture.get("provider", "openai-compatible")))
    if provider == "openai-responses":
        client_cls = OpenAIResponsesClient
        default_model = "gpt-4o"
        default_embed_model = "text-embedding-ada-002"
    elif provider == "google-gemini":
        client_cls = GoogleGeminiClient
        default_model = "gemini-2.5-flash"
        default_embed_model = "gemini-embedding-2"
    elif provider == "anthropic":
        client_cls = AnthropicClient
        default_model = "claude-3-7-sonnet-latest"
        default_embed_model = ""
    elif provider == "azure-openai":
        client_cls = AzureOpenAIClient
        default_model = "gpt-5-mini"
        default_embed_model = "text-embedding-3-small"
    elif provider == "deepseek":
        client_cls = DeepSeekClient
        default_model = "deepseek-v4-flash"
        default_embed_model = ""
    elif provider == "mistral":
        client_cls = MistralClient
        default_model = "mistral-small-latest"
        default_embed_model = "mistral-embed"
    elif provider == "reka":
        client_cls = RekaClient
        default_model = "reka-core"
        default_embed_model = ""
    elif provider == "cohere":
        client_cls = CohereClient
        default_model = "command-r-plus"
        default_embed_model = "embed-english-v3.0"
    elif provider == "grok":
        client_cls = GrokClient
        default_model = "grok-4.3"
        default_embed_model = ""
    else:
        client_cls = OpenAICompatibleClient
        default_model = "gpt-4.1-mini"
        default_embed_model = "text-embedding-3-small"
    extra_options = {}
    for key in ("base_url", "baseUrl", "resource_name", "resourceName", "deployment_name", "deploymentName", "api_version", "apiVersion", "version"):
        if key in fixture:
            extra_options[key] = fixture[key]
    client = client_cls(
        model=fixture.get("model", default_model),
        embed_model=fixture.get("embed_model", default_embed_model),
        api_key="test-key",
        transport=transport,
        model_config=fixture.get("model_config"),
        **extra_options,
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
    if argv and argv[0] == "--runtime-protocol-fixture-server":
        _runtime_protocol_fixture_server_main()
        return
    if not argv:
        raise SystemExit("usage: python -m axllm.conformance <fixture-or-dir>...")
    for result in run_fixtures(argv):
        print("ok", result["name"])


if __name__ == "__main__":
    main()
`

const pyProvidersInit = `from .openai import AnthropicClient, AzureOpenAIClient, CohereClient, DeepSeekClient, GoogleGeminiClient, GrokClient, MistralClient, OpenAICompatibleClient, OpenAIResponsesClient, RekaClient

__all__ = ["AnthropicClient", "AzureOpenAIClient", "CohereClient", "DeepSeekClient", "GoogleGeminiClient", "GrokClient", "MistralClient", "OpenAICompatibleClient", "OpenAIResponsesClient", "RekaClient"]
`

const pyOpenAIProvider = `from ..ai import AnthropicClient, AzureOpenAIClient, CohereClient, DeepSeekClient, GoogleGeminiClient, GrokClient, MistralClient, OpenAICompatibleClient, OpenAIResponsesClient, RekaClient

__all__ = ["AnthropicClient", "AzureOpenAIClient", "CohereClient", "DeepSeekClient", "GoogleGeminiClient", "GrokClient", "MistralClient", "OpenAICompatibleClient", "OpenAIResponsesClient", "RekaClient"]
`
