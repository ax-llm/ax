from __future__ import annotations
import os

from dataclasses import dataclass, field as dataclass_field
import copy
import json
import re
from typing import Any
# AXIR_CORE_IMPORTS


class AxSignatureError(ValueError):
    pass


# JSON text as JavaScript's JSON.stringify writes it, shared by prompts, wire
# bodies and the json.* intrinsics. json.dumps differs in its numbers: it writes
# 2.0 for a float two, switches to exponents at 1e16 and 1e-5 (as 1e+16 and
# 1e-05), and writes NaN and Infinity, which are not JSON.

# JSON string escaping as json.dumps(ensure_ascii=False) does it (C-accelerated).
_json_encode_string = json.encoder.encode_basestring


def _js_number_text(value) -> str:
    """A float as JavaScript's String(x) writes it (Number.prototype.toString):
    repr's shortest round-trip digits, plain decimals from 1e-6 up to 1e21,
    exponent form outside that range (1e-7, 1.5e+21), 0 for -0.0, and NaN,
    Infinity or -Infinity."""
    value = float(value)
    if value != value:
        return "NaN"
    if value in (float("inf"), float("-inf")):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    text = repr(value)
    if "e" not in text:
        # repr writes plain decimals from 1e-4 up to 1e16, where JavaScript
        # does too; only an integral value's ".0" differs.
        return text[:-2] if text.endswith(".0") else text
    mantissa, _, exponent = repr(abs(value)).partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = (whole + fraction).lstrip("0")
    # digits read as 0.ddd x 10^point
    point = len(whole) + int(exponent or 0) - (len(whole + fraction) - len(digits))
    digits = digits.rstrip("0")
    count = len(digits)
    if count <= point <= 21:
        text = digits + "0" * (point - count)
    elif 0 < point <= 21:
        text = digits[:point] + "." + digits[point:]
    elif -6 < point <= 0:
        text = "0." + "0" * -point + digits
    else:
        power = point - 1
        text = digits[0] + ("." + digits[1:] if count > 1 else "") + ("e+" if power >= 0 else "e-") + str(abs(power))
    return "-" + text if value < 0 else text


def _js_json_number(value) -> str:
    """JSON.stringify's number: _js_number_text, or null for NaN and the
    infinities."""
    text = _js_number_text(value)
    return "null" if text in ("NaN", "Infinity", "-Infinity") else text


def _js_json_key(key) -> str:
    if isinstance(key, str):
        return key
    if key is True or key is False or key is None:
        return {True: "true", False: "false", None: "null"}[key]
    if isinstance(key, int):
        return int.__repr__(key)
    if isinstance(key, float):
        return _js_number_text(key)
    raise TypeError(f"keys must be str, int, float, bool or None, not {type(key).__name__}")


def _js_json_dumps(value, indent: int | None = None, sort_keys: bool = False, default=None, separators: tuple[str, str] | None = None) -> str:
    """json.dumps(value, ensure_ascii=False) with JavaScript's output: compact
    separators by default (JSON.stringify(value)), `indent`-space lines as
    JSON.stringify(value, null, indent) writes them, floats as
    _js_json_number, and NaN or Infinity as null. Ints keep their exact digits;
    dict keys convert and sort, and `default` and `separators` work, as in
    json.dumps."""
    out: list[str] = []
    active: set[int] = set()
    item_separator, key_separator = separators or ((",", ":") if indent is None else (",", ": "))

    def write(item, prefix: str) -> None:
        if isinstance(item, str):
            out.append(_json_encode_string(item))
        elif item is None:
            out.append("null")
        elif item is True:
            out.append("true")
        elif item is False:
            out.append("false")
        elif isinstance(item, int):
            out.append(int.__repr__(item))
        elif isinstance(item, float):
            out.append(_js_json_number(item))
        elif isinstance(item, (dict, list, tuple)):
            marker = id(item)
            if marker in active:
                raise ValueError("Circular reference detected")
            active.add(marker)
            inner = prefix + " " * indent if indent is not None else ""
            if isinstance(item, dict):
                entries = sorted(item.items(), key=lambda entry: entry[0]) if sort_keys else list(item.items())
                opening, closing = "{", "}"
            else:
                entries = [(None, element) for element in item]
                opening, closing = "[", "]"
            if not entries:
                out.append(opening + closing)
            else:
                out.append(opening)
                for index, (key, element) in enumerate(entries):
                    if index:
                        out.append(item_separator)
                    if indent is not None:
                        out.append("\n" + inner)
                    if opening == "{":
                        out.append(_json_encode_string(_js_json_key(key)))
                        out.append(key_separator)
                    write(element, inner)
                if indent is not None:
                    out.append("\n" + prefix)
                out.append(closing)
            active.discard(marker)
        elif default is not None:
            write(default(item), prefix)
        else:
            raise TypeError(f"Object of type {type(item).__name__} is not JSON serializable")

    write(value, "")
    return "".join(out)


def _js_date_millis(value):
    """Epoch milliseconds of a native date or time value, read as TypeScript
    reads a Date: an aware datetime is its instant, a naive one is local time
    (as datetime.timestamp() reads it, and as new Date(2024, 4, 9) does), and
    a date is its UTC midnight (as new Date("2024-05-09") parses it). None
    for anything else."""
    import datetime as _datetime

    if isinstance(value, _datetime.datetime):
        instant = value if value.utcoffset() is not None else value.astimezone()
        delta = instant - _datetime.datetime(1970, 1, 1, tzinfo=_datetime.timezone.utc)
        return delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000
    if isinstance(value, _datetime.date):
        return (value.toordinal() - 719163) * 86400000
    return None


def _js_iso_string(millis) -> str:
    """Date.prototype.toISOString of epoch milliseconds."""
    import datetime as _datetime

    moment = _datetime.datetime(1970, 1, 1) + _datetime.timedelta(milliseconds=millis)
    return f"{moment.year:04d}-{moment.month:02d}-{moment.day:02d}T{moment.hour:02d}:{moment.minute:02d}:{moment.second:02d}.{moment.microsecond // 1000:03d}Z"


def _js_date_prompt_text(type_name, value):
    """The prompt text TypeScript writes for a native date in a date-typed
    field (processValue in src/ax/dsp/prompt.ts), or None when TS would not
    see a Date: a date field's UTC day, a datetime without milliseconds, and
    for a range with two dates the {start, end} JSON of those; a range object
    holding anything else is its JSON with each date as toISOString."""
    if type_name in ("date", "datetime"):
        millis = _js_date_millis(value)
        if millis is None:
            return None
        iso = _js_iso_string(millis)
        return iso[: iso.index("T")] if type_name == "date" else iso[:-5] + "Z"
    if type_name in ("dateRange", "datetimeRange") and isinstance(value, dict) and "start" in value and "end" in value:
        start = _js_date_millis(value["start"])
        end = _js_date_millis(value["end"])
        if start is not None and end is not None:
            if type_name == "dateRange":
                bounds = {"start": _js_iso_string(start)[:10], "end": _js_iso_string(end)[:10]}
            else:
                bounds = {"start": _js_iso_string(start)[:-5] + "Z", "end": _js_iso_string(end)[:-5] + "Z"}
            return _js_json_dumps(bounds, indent=2)
        if any(_js_date_millis(item) is not None for item in value.values()):
            dated = {key: (_js_iso_string(_js_date_millis(item)) if _js_date_millis(item) is not None else item) for key, item in value.items()}
            return _js_json_dumps(dated, indent=2)
    return None


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
    value_descriptions: dict[str, str] | None = None
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

    def describe_values(self, descriptions: dict[str, str]):
        clone = self._clone()
        clone.type.value_descriptions = copy.deepcopy(descriptions)
        _signature_validate_value_descriptions_impl(clone.type, clone.type.name)
        return clone

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


def _core_map_keys(values):
    return list(values) if isinstance(values, dict) else []


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
    # "{}" takes String(x): a float two is "2", 1e-7 is "1e-7".
    return str(template).format(*(_js_number_text(arg) if isinstance(arg, float) else arg for arg in args))


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
            value_descriptions=values.get("value_descriptions", values.get("valueDescriptions")),
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


# AXIR_CORE_SIGNATURE_FUNCTIONS
