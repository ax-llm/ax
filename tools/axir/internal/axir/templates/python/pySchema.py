from __future__ import annotations
import os

import copy
import re
from typing import Any
# AXIR_CORE_IMPORTS


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
