from __future__ import annotations
import os

import json
import re
from typing import Any
# AXIR_CORE_IMPORTS


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
