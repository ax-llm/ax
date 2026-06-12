from __future__ import annotations
import os

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


# BEGIN AXIR CORE EMITTED FUNCTIONS
def validate_fields(fields: list[Any], values: Any, context: str = "value") -> None:
    _core_coverage_mark("validate_fields")
    _validate_fields_impl(fields, values, context)
    return None


def to_json_schema(fields: list[Any], schema_title: str = "Schema", options: Any = None) -> dict[str, Any]:
    _core_coverage_mark("to_json_schema")
    schema = _schema_to_json_schema_impl(fields, schema_title, options)
    return schema


def _schema_required_impl(field: Field, options: Any) -> bool:
    _core_coverage_mark("_schema_required_impl")
    strict_camel = _core_get(options, "strictStructuredOutputs", False)
    strict_snake = _core_get(options, "strict_structured_outputs", False)
    strict = _core_or(strict_camel, strict_snake)
    is_optional = _core_get(field, "is_optional", False)
    not_optional = _core_not(is_optional)
    required = _core_or(strict, not_optional)
    return required


def validate_output(fields: list[Any], values: Any) -> Any:
    _core_coverage_mark("validate_output")
    validated = _validate_output_impl(fields, values)
    return validated


def validate_value(field: Field, value: Any, path: str = None) -> None:
    _core_coverage_mark("validate_value")
    _validate_value_impl(field, value, path)
    return None


def _schema_flexible_json_as_string_impl(typ: FieldType, options: Any) -> bool:
    _core_coverage_mark("_schema_flexible_json_as_string_impl")
    camel = _core_get(options, "flexibleJsonFieldsAsString", False)
    snake = _core_get(options, "flexible_json_fields_as_string", False)
    enabled = _core_or(camel, snake)
    type_name = _core_get(typ, "name", None)
    is_json = _core_eq(type_name, "json")
    is_object = _core_eq(type_name, "object")
    fields = _core_get(typ, "fields", None)
    has_fields = _core_truthy(fields)
    unshaped = _core_not(has_fields)
    unshaped_object = _core_and(is_object, unshaped)
    flexible_type = _core_or(is_json, unshaped_object)
    as_string = _core_and(enabled, flexible_type)
    return as_string


def strip_internal(fields: list[Any], values: Any) -> Any:
    _core_coverage_mark("strip_internal")
    public_values = _strip_internal_fields_impl(fields, values)
    return public_values


def _validate_fields_impl(fields: list[Any], values: Any, context: str) -> None:
    _core_coverage_mark("_validate_fields_impl")
    values_is_object = _core_type_is(values, "object")
    values_not_object = _core_not(values_is_object)
    if values_not_object:
        message = _core_string_format("{} must be an object", context)
        error = _core_validation_error(message)
        raise error
    else:
        pass
    for field in fields:
        field_name = _core_get(field, "name", None)
        field_title = _core_get(field, "title", None)
        is_optional = _core_get(field, "is_optional", False)
        has_value = _core_map_contains(values, field_name)
        missing = _core_not(has_value)
        field_value = _core_get(values, field_name, None)
        is_null = _core_is_none(field_value)
        missing_or_null = _core_or(missing, is_null)
        if missing_or_null:
            required_missing = _core_not(is_optional)
            if required_missing:
                message = _core_string_format("Required field is missing: '{}'", field_title)
                error = _core_validation_error(message)
                raise error
            else:
                pass
        else:
            child_path = _core_string_format("{}.{}", context, field_name)
            _validate_value_impl(field, field_value, child_path)
    return None


def _schema_json_type_impl(type_name: str) -> Any:
    _core_coverage_mark("_schema_json_type_impl")
    string_types = []
    string_types.append("string")
    string_types.append("code")
    string_types.append("url")
    string_types.append("date")
    string_types.append("datetime")
    string_types.append("dateRange")
    string_types.append("datetimeRange")
    string_types.append("image")
    string_types.append("audio")
    string_types.append("file")
    is_string = _core_contains(string_types, type_name)
    if is_string:
        return "string"
    else:
        pass
    is_number = _core_eq(type_name, "number")
    if is_number:
        return "number"
    else:
        pass
    is_boolean = _core_eq(type_name, "boolean")
    if is_boolean:
        return "boolean"
    else:
        pass
    json_types = []
    json_types.append("object")
    json_types.append("array")
    json_types.append("string")
    json_types.append("number")
    json_types.append("boolean")
    json_types.append("null")
    flexible_names = []
    flexible_names.append("json")
    flexible_names.append("object")
    is_flexible = _core_contains(flexible_names, type_name)
    if is_flexible:
        return json_types
    else:
        pass
    return "string"


def _validate_output_impl(fields: list[Any], values: Any) -> Any:
    _core_coverage_mark("_validate_output_impl")
    normalized = values
    for field in fields:
        field_name = _core_get(field, "name", None)
        field_title = _core_get(field, "title", None)
        has_name = _core_map_contains(normalized, field_name)
        missing_name = _core_not(has_name)
        has_title = _core_map_contains(normalized, field_title)
        alias_title = _core_and(missing_name, has_title)
        if alias_title:
            title_value = _core_get(normalized, field_title, None)
            normalized[field_name] = title_value
        else:
            pass
    _validate_fields_impl(fields, normalized, "output")
    return normalized


def _schema_enhance_description_impl(base: Any, typ: FieldType) -> Any:
    _core_coverage_mark("_schema_enhance_description_impl")
    constraints = []
    type_name = _core_get(typ, "name", None)
    format = _core_get(typ, "format", None)
    is_email = _core_eq(format, "email")
    if is_email:
        constraints.append("Must be a valid email address format")
    else:
        pass
    url_formats = []
    url_formats.append("uri")
    url_formats.append("url")
    format_url = _core_contains(url_formats, format)
    type_url = _core_eq(type_name, "url")
    is_url = _core_or(format_url, type_url)
    if is_url:
        constraints.append("Must be a valid URL format")
    else:
        pass
    length_types = []
    length_types.append("string")
    length_types.append("code")
    length_types.append("url")
    length_types.append("date")
    length_types.append("dateRange")
    length_types.append("datetime")
    length_types.append("datetimeRange")
    has_length_constraints = _core_contains(length_types, type_name)
    if has_length_constraints:
        min_length = _core_get(typ, "min_length", None)
        max_length = _core_get(typ, "max_length", None)
        has_min = _core_is_not_none(min_length)
        has_max = _core_is_not_none(max_length)
        has_both = _core_and(has_min, has_max)
        if has_both:
            text = _core_string_format("Minimum length: {} characters, maximum length: {} characters", min_length, max_length)
            constraints.append(text)
        else:
            if has_min:
                text = _core_string_format("Minimum length: {} characters", min_length)
                constraints.append(text)
            else:
                if has_max:
                    text = _core_string_format("Maximum length: {} characters", max_length)
                    constraints.append(text)
                else:
                    pass
    else:
        pass
    is_number = _core_eq(type_name, "number")
    if is_number:
        minimum = _core_get(typ, "minimum", None)
        maximum = _core_get(typ, "maximum", None)
        has_minimum = _core_is_not_none(minimum)
        has_maximum = _core_is_not_none(maximum)
        has_both = _core_and(has_minimum, has_maximum)
        if has_both:
            text = _core_string_format("Minimum value: {}, maximum value: {}", minimum, maximum)
            constraints.append(text)
        else:
            if has_minimum:
                text = _core_string_format("Minimum value: {}", minimum)
                constraints.append(text)
            else:
                if has_maximum:
                    text = _core_string_format("Maximum value: {}", maximum)
                    constraints.append(text)
                else:
                    pass
    else:
        pass
    pattern = _core_get(typ, "pattern", None)
    has_pattern = _core_is_not_none(pattern)
    if has_pattern:
        pattern_description = _core_get(typ, "pattern_description", None)
        missing_pattern_description = _core_is_none(pattern_description)
        if missing_pattern_description:
            message = _core_string_format("Field with pattern '{}' must include a patternDescription to explain the pattern to the LLM", pattern)
            error = _core_validation_error(message)
            raise error
        else:
            constraints.append(pattern_description)
    else:
        pass
    is_date = _core_eq(type_name, "date")
    if is_date:
        constraints.append("Format: YYYY-MM-DD")
    else:
        pass
    is_date_range = _core_eq(type_name, "dateRange")
    if is_date_range:
        constraints.append("Format: JSON object with start and end dates, or YYYY-MM-DD/YYYY-MM-DD")
    else:
        pass
    is_datetime = _core_eq(type_name, "datetime")
    if is_datetime:
        constraints.append("Format: ISO 8601 date-time")
    else:
        pass
    is_datetime_range = _core_eq(type_name, "datetimeRange")
    if is_datetime_range:
        constraints.append("Format: JSON object with start and end ISO 8601 date-times, or ISO interval start/end")
    else:
        pass
    constraint_count = _core_len(constraints)
    has_constraints = _core_gt(constraint_count, 0)
    if has_constraints:
        constraint_text = _core_string_join(". ", constraints)
        description = _core_description_append(base, constraint_text)
        return description
    else:
        pass
    return base


def _validate_string_constraints_impl(value: str, field: Field) -> None:
    _core_coverage_mark("_validate_string_constraints_impl")
    typ = _core_get(field, "type", None)
    title = _core_get(field, "title", None)
    min_length = _core_get(typ, "min_length", None)
    has_min = _core_is_not_none(min_length)
    if has_min:
        length = _core_len(value)
        too_short = _core_lt(length, min_length)
        if too_short:
            message = _core_string_format("Field '{}' failed validation: String must be at least {} characters long.", title, min_length)
            error = _core_validation_error(message)
            raise error
        else:
            pass
    else:
        pass
    max_length = _core_get(typ, "max_length", None)
    has_max = _core_is_not_none(max_length)
    if has_max:
        length = _core_len(value)
        too_long = _core_gt(length, max_length)
        if too_long:
            message = _core_string_format("Field '{}' failed validation: String must be at most {} characters long.", title, max_length)
            error = _core_validation_error(message)
            raise error
        else:
            pass
    else:
        pass
    pattern = _core_get(typ, "pattern", None)
    has_pattern = _core_is_not_none(pattern)
    if has_pattern:
        matches = _core_regex_match(pattern, value)
        pattern_failed = _core_not(matches)
        if pattern_failed:
            message = _core_string_format("Field '{}' failed validation: String must match pattern /{}/.", title, pattern)
            error = _core_validation_error(message)
            raise error
        else:
            pass
    else:
        pass
    format = _core_get(typ, "format", None)
    is_email = _core_eq(format, "email")
    if is_email:
        valid_email = _core_regex_match("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", value)
        invalid_email = _core_not(valid_email)
        if invalid_email:
            message = _core_string_format("Field '{}' failed validation: String must be a valid email address.", title)
            error = _core_validation_error(message)
            raise error
        else:
            pass
    else:
        pass
    url_formats = []
    url_formats.append("uri")
    url_formats.append("url")
    is_url_format = _core_contains(url_formats, format)
    if is_url_format:
        valid_url = _core_url_valid(value)
        invalid_url = _core_not(valid_url)
        if invalid_url:
            message = _core_string_format("Invalid URL for '{}': Invalid URL format.", title)
            error = _core_validation_error(message)
            raise error
        else:
            pass
    else:
        pass
    return None


def _validate_number_constraints_impl(value: float, field: Field) -> None:
    _core_coverage_mark("_validate_number_constraints_impl")
    typ = _core_get(field, "type", None)
    title = _core_get(field, "title", None)
    minimum = _core_get(typ, "minimum", None)
    has_minimum = _core_is_not_none(minimum)
    if has_minimum:
        too_small = _core_lt(value, minimum)
        if too_small:
            message = _core_string_format("Field '{}' failed validation: Number must be at least {}.", title, minimum)
            error = _core_validation_error(message)
            raise error
        else:
            pass
    else:
        pass
    maximum = _core_get(typ, "maximum", None)
    has_maximum = _core_is_not_none(maximum)
    if has_maximum:
        too_large = _core_gt(value, maximum)
        if too_large:
            message = _core_string_format("Field '{}' failed validation: Number must be at most {}.", title, maximum)
            error = _core_validation_error(message)
            raise error
        else:
            pass
    else:
        pass
    return None


def _schema_apply_constraints_impl(schema: Any, typ: FieldType) -> Any:
    _core_coverage_mark("_schema_apply_constraints_impl")
    type_name = _core_get(typ, "name", None)
    string_types = []
    string_types.append("string")
    string_types.append("code")
    string_types.append("url")
    string_types.append("date")
    string_types.append("dateRange")
    string_types.append("datetime")
    string_types.append("datetimeRange")
    is_string_type = _core_contains(string_types, type_name)
    if is_string_type:
        min_length = _core_get(typ, "min_length", None)
        has_min = _core_is_not_none(min_length)
        if has_min:
            schema["minLength"] = min_length
        else:
            pass
        max_length = _core_get(typ, "max_length", None)
        has_max = _core_is_not_none(max_length)
        if has_max:
            schema["maxLength"] = max_length
        else:
            pass
        pattern = _core_get(typ, "pattern", None)
        has_pattern = _core_is_not_none(pattern)
        if has_pattern:
            schema["pattern"] = pattern
        else:
            pass
        format = _core_get(typ, "format", None)
        has_format = _core_is_not_none(format)
        if has_format:
            schema["format"] = format
        else:
            pass
        is_url = _core_eq(type_name, "url")
        missing_format = _core_not(has_format)
        default_url_format = _core_and(is_url, missing_format)
        if default_url_format:
            schema["format"] = "uri"
        else:
            pass
        is_date = _core_eq(type_name, "date")
        default_date_format = _core_and(is_date, missing_format)
        if default_date_format:
            schema["format"] = "date"
        else:
            pass
        is_datetime = _core_eq(type_name, "datetime")
        default_datetime_format = _core_and(is_datetime, missing_format)
        if default_datetime_format:
            schema["format"] = "date-time"
        else:
            pass
    else:
        is_number = _core_eq(type_name, "number")
        if is_number:
            minimum = _core_get(typ, "minimum", None)
            has_minimum = _core_is_not_none(minimum)
            if has_minimum:
                schema["minimum"] = minimum
            else:
                pass
            maximum = _core_get(typ, "maximum", None)
            has_maximum = _core_is_not_none(maximum)
            if has_maximum:
                schema["maximum"] = maximum
            else:
                pass
        else:
            pass
    return schema


def _validate_value_impl(field: Field, value: Any, path: str) -> None:
    _core_coverage_mark("_validate_value_impl")
    field_name = _core_get(field, "name", None)
    typ = _core_get(field, "type", None)
    type_name = _core_get(typ, "name", None)
    is_array = _core_get(typ, "is_array", False)
    if is_array:
        is_list = _core_type_is(value, "list")
        not_list = _core_not(is_list)
        if not_list:
            message = _core_string_format("{} must be an array", path)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        item_field = _core_field_item(field)
        for item in value:
            _validate_value_impl(item_field, item, path)
        return None
    else:
        pass
    is_image = _core_eq(type_name, "image")
    if is_image:
        valid_image = _valid_image(value)
        invalid_image = _core_not(valid_image)
        if invalid_image:
            message = _core_string_format("Validation failed: Expected '{}' to be type 'object ({{ mimeType: string; data: string }})'", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        return None
    else:
        pass
    is_audio = _core_eq(type_name, "audio")
    if is_audio:
        valid_audio = _valid_audio(value)
        invalid_audio = _core_not(valid_audio)
        if invalid_audio:
            message = _core_string_format("Validation failed: Expected '{}' to be type 'string or object ({{ data: string; format?: string }})'", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        return None
    else:
        pass
    is_file = _core_eq(type_name, "file")
    if is_file:
        valid_file = _valid_file(value)
        invalid_file = _core_not(valid_file)
        if invalid_file:
            message = _core_string_format("Validation failed: Expected '{}' to be type 'object ({{ mimeType: string; data: string }} | {{ mimeType: string; fileUri: string }})'", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        return None
    else:
        pass
    is_url = _core_eq(type_name, "url")
    if is_url:
        valid_url_shape = _valid_url_shape(value)
        invalid_url_shape = _core_not(valid_url_shape)
        if invalid_url_shape:
            message = _core_string_format("Validation failed: Expected '{}' to be type 'string or object ({{ url: string; title?: string; description?: string }})'", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        url_is_string = _core_type_is(value, "string")
        if url_is_string:
            valid_url = _core_url_valid(value)
            invalid_url = _core_not(valid_url)
            if invalid_url:
                field_title = _core_get(field, "title", None)
                message = _core_string_format("Invalid URL for '{}': Invalid URL format.", field_title)
                error = _core_validation_error(message)
                raise error
            else:
                pass
        else:
            pass
        return None
    else:
        pass
    string_types = []
    string_types.append("string")
    string_types.append("code")
    string_types.append("date")
    string_types.append("datetime")
    string_types.append("dateRange")
    string_types.append("datetimeRange")
    is_string_type = _core_contains(string_types, type_name)
    if is_string_type:
        is_string = _core_type_is(value, "string")
        not_string = _core_not(is_string)
        if not_string:
            message = _core_string_format("Validation failed: Expected '{}' to be a {}", field_name, type_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        _validate_string_constraints_impl(value, field)
        return None
    else:
        pass
    is_number_type = _core_eq(type_name, "number")
    if is_number_type:
        is_number = _core_type_is(value, "number")
        not_number = _core_not(is_number)
        if not_number:
            message = _core_string_format("Validation failed: Expected '{}' to be a number", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        _validate_number_constraints_impl(value, field)
        return None
    else:
        pass
    is_boolean_type = _core_eq(type_name, "boolean")
    if is_boolean_type:
        is_boolean = _core_type_is(value, "boolean")
        not_boolean = _core_not(is_boolean)
        if not_boolean:
            message = _core_string_format("Validation failed: Expected '{}' to be a boolean", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        return None
    else:
        pass
    is_class_type = _core_eq(type_name, "class")
    if is_class_type:
        is_class_string = _core_type_is(value, "string")
        not_class_string = _core_not(is_class_string)
        if not_class_string:
            message = _core_string_format("Validation failed: Expected '{}' to be a class", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        options = _core_get(typ, "options", None)
        has_options = _core_truthy(options)
        if has_options:
            known_class = _core_contains(options, value)
            unknown_class = _core_not(known_class)
            if unknown_class:
                message = _core_string_format("{} must be one of {}", path, options)
                error = _core_validation_error(message)
                raise error
            else:
                pass
        else:
            pass
        return None
    else:
        pass
    is_json_type = _core_eq(type_name, "json")
    if is_json_type:
        is_json = _core_type_is(value, "json")
        not_json = _core_not(is_json)
        if not_json:
            message = _core_string_format("Validation failed: Expected '{}' to be JSON", field_name)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        return None
    else:
        pass
    is_object_type = _core_eq(type_name, "object")
    if is_object_type:
        is_object = _core_type_is(value, "object")
        not_object = _core_not(is_object)
        if not_object:
            message = _core_string_format("{} must be an object", path)
            error = _core_validation_error(message)
            raise error
        else:
            pass
        nested_map = _core_get(typ, "fields", None)
        has_nested = _core_truthy(nested_map)
        if has_nested:
            nested_fields = _core_fields_from_map(nested_map)
            _validate_fields_impl(nested_fields, value, path)
        else:
            pass
        return None
    else:
        pass
    return None


def _schema_nullable_optional_impl(schema: Any, field: Field, options: Any) -> Any:
    _core_coverage_mark("_schema_nullable_optional_impl")
    is_optional = _core_get(field, "is_optional", False)
    strict_camel = _core_get(options, "strictStructuredOutputs", False)
    strict_snake = _core_get(options, "strict_structured_outputs", False)
    strict = _core_or(strict_camel, strict_snake)
    make_nullable = _core_and(is_optional, strict)
    if make_nullable:
        schema_type = _core_get(schema, "type", None)
        type_is_list = _core_type_is(schema_type, "list")
        if type_is_list:
            has_null_type = _core_contains(schema_type, "null")
            needs_null_type = _core_not(has_null_type)
            if needs_null_type:
                schema_type.append("null")
            else:
                pass
        else:
            nullable_type = []
            nullable_type.append(schema_type)
            nullable_type.append("null")
            schema["type"] = nullable_type
        enum_values = _core_get(schema, "enum", None)
        enum_is_list = _core_type_is(enum_values, "list")
        if enum_is_list:
            none = _core_none()
            enum_has_null = _core_contains(enum_values, none)
            enum_needs_null = _core_not(enum_has_null)
            if enum_needs_null:
                enum_values.append(none)
            else:
                pass
        else:
            pass
    else:
        pass
    return schema


def _schema_object_from_fields_impl(fields_map: Any, is_nested: bool, options: Any) -> Any:
    _core_coverage_mark("_schema_object_from_fields_impl")
    schema = {}
    properties = {}
    required = []
    schema["type"] = "object"
    schema["properties"] = properties
    schema["required"] = required
    schema["additionalProperties"] = False
    fields = _core_fields_from_map(fields_map)
    for field in fields:
        is_internal = _core_get(field, "is_internal", False)
        include = _core_not(is_internal)
        if include:
            field_name = _core_get(field, "name", None)
            field_schema = _schema_field_schema_impl(field, is_nested, options)
            properties[field_name] = field_schema
            is_required = _schema_required_impl(field, options)
            if is_required:
                required.append(field_name)
            else:
                pass
        else:
            pass
    return schema


def _schema_field_schema_impl(field: Field, is_nested: bool, options: Any) -> Any:
    _core_coverage_mark("_schema_field_schema_impl")
    typ = _core_get(field, "type", None)
    type_name = _core_get(typ, "name", None)
    media_types = []
    media_types.append("image")
    media_types.append("audio")
    media_types.append("file")
    is_media = _core_contains(media_types, type_name)
    nested_media = _core_and(is_nested, is_media)
    if nested_media:
        message = _core_string_format("Media type '{}' is not allowed in nested object fields", type_name)
        error = _core_validation_error(message)
        raise error
    else:
        pass
    schema = {}
    field_description = _core_get(field, "description", None)
    description = _schema_enhance_description_impl(field_description, typ)
    has_description = _core_truthy(description)
    if has_description:
        schema["description"] = description
    else:
        pass
    is_array = _core_get(typ, "is_array", False)
    if is_array:
        schema["type"] = "array"
        fields_map = _core_get(typ, "fields", None)
        has_fields = _core_truthy(fields_map)
        if has_fields:
            items = _schema_object_from_fields_impl(fields_map, True, options)
            type_description = _core_get(typ, "description", None)
            has_type_description = _core_truthy(type_description)
            if has_type_description:
                items["description"] = type_description
            else:
                pass
            schema["items"] = items
            nullable = _schema_nullable_optional_impl(schema, field, options)
            return nullable
        else:
            pass
        is_class = _core_eq(type_name, "class")
        if is_class:
            items = {}
            items["type"] = "string"
            class_options = _core_get(typ, "options", None)
            items["enum"] = class_options
            schema["items"] = items
            nullable = _schema_nullable_optional_impl(schema, field, options)
            return nullable
        else:
            pass
        items = {}
        flexible_string = _schema_flexible_json_as_string_impl(typ, options)
        if flexible_string:
            items["type"] = "string"
            type_description = _core_get(typ, "description", None)
            item_base_description = _core_coalesce(type_description, field_description)
            item_description = _schema_enhance_description_impl(item_base_description, typ)
            json_description = _core_description_append(item_description, "Return this field as a JSON-encoded string that can be parsed with JSON.parse.")
            items["description"] = json_description
        else:
            json_type = _schema_json_type_impl(type_name)
            items["type"] = json_type
            type_description = _core_get(typ, "description", None)
            item_base_description = _core_coalesce(type_description, field_description)
            item_description = _schema_enhance_description_impl(item_base_description, typ)
            has_item_description = _core_truthy(item_description)
            if has_item_description:
                items["description"] = item_description
            else:
                pass
        items_with_constraints = _schema_apply_constraints_impl(items, typ)
        schema["items"] = items_with_constraints
        nullable = _schema_nullable_optional_impl(schema, field, options)
        return nullable
    else:
        pass
    fields_map = _core_get(typ, "fields", None)
    is_object = _core_eq(type_name, "object")
    has_fields = _core_truthy(fields_map)
    is_shaped_object = _core_and(is_object, has_fields)
    if is_shaped_object:
        object_schema = _schema_object_from_fields_impl(fields_map, True, options)
        updated = _core_map_update(schema, object_schema)
        nullable = _schema_nullable_optional_impl(updated, field, options)
        return nullable
    else:
        pass
    is_class = _core_eq(type_name, "class")
    if is_class:
        schema["type"] = "string"
        class_options = _core_get(typ, "options", None)
        schema["enum"] = class_options
        nullable = _schema_nullable_optional_impl(schema, field, options)
        return nullable
    else:
        pass
    flexible_string = _schema_flexible_json_as_string_impl(typ, options)
    if flexible_string:
        schema["type"] = "string"
        json_description = _core_description_append(description, "Return this field as a JSON-encoded string that can be parsed with JSON.parse.")
        schema["description"] = json_description
        nullable = _schema_nullable_optional_impl(schema, field, options)
        return nullable
    else:
        pass
    json_type = _schema_json_type_impl(type_name)
    schema["type"] = json_type
    is_audio = _core_eq(type_name, "audio")
    if is_audio:
        audio_description = _core_description_append(description, "Return plain text to synthesize as speech; do not return audio bytes or JSON audio objects.")
        schema["description"] = audio_description
    else:
        pass
    schema_with_constraints = _schema_apply_constraints_impl(schema, typ)
    nullable = _schema_nullable_optional_impl(schema_with_constraints, field, options)
    return nullable


def _strip_internal_fields_impl(fields: list[Any], values: Any) -> Any:
    _core_coverage_mark("_strip_internal_fields_impl")
    public_values = {}
    for field in fields:
        is_internal = _core_get(field, "is_internal", False)
        is_public = _core_not(is_internal)
        field_name = _core_get(field, "name", None)
        has_value = _core_map_contains(values, field_name)
        keep = _core_and(is_public, has_value)
        if keep:
            field_value = _core_map_get(values, field_name)
            public_values[field_name] = field_value
        else:
            pass
    return public_values


def _schema_to_json_schema_impl(fields: list[Any], schema_title: str, options: Any) -> dict[str, Any]:
    _core_coverage_mark("_schema_to_json_schema_impl")
    schema = {}
    properties = {}
    required = []
    schema["type"] = "object"
    schema["title"] = schema_title
    schema["properties"] = properties
    schema["required"] = required
    schema["additionalProperties"] = False
    for field in fields:
        is_internal = _core_get(field, "is_internal", False)
        include = _core_not(is_internal)
        if include:
            field_name = _core_get(field, "name", None)
            field_schema = _schema_field_schema_impl(field, False, options)
            properties[field_name] = field_schema
            is_required = _schema_required_impl(field, options)
            if is_required:
                required.append(field_name)
            else:
                pass
        else:
            pass
    return schema

# END AXIR CORE EMITTED FUNCTIONS
