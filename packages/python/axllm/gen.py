from __future__ import annotations
import os

import json
import re
import time
from typing import Any

from .ai import AIClient, chat_response_to_completion
from .prompt import AxPromptTemplate
from .schema import AxValidationError, strip_internal, validate_fields, validate_output
from .signature import AxSignature
from .schema import (
    _schema_to_json_schema_impl,
)


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


def _normalize_optimization_metric_scores_local(raw):
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return {"score": raw}
    if isinstance(raw, dict):
        return dict(raw)
    return {"score": 0}


def _scalarize_optimization_scores_local(scores, options):
    key = (options or {}).get("paretoMetricKey")
    if key:
        try:
            return float((scores or {}).get(key, 0))
        except (TypeError, ValueError):
            return 0
    values = []
    for value in (scores or {}).values():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            values.append(float(value))
    return sum(values) / len(values) if values else 0


def _optimization_action_name_matches_local(expected, call):
    qualified = str((call or {}).get("qualifiedName") or "")
    name = str((call or {}).get("name") or "")
    return qualified == expected or name == expected or qualified.endswith(f".{expected}")


def _adjust_optimization_score_for_actions_local(score, task, prediction):
    adjusted = float(score)
    calls = (prediction or {}).get("functionCalls") or (prediction or {}).get("function_calls") or []
    expected = (task or {}).get("expectedActions") or []
    if expected:
        matched = sum(1 for item in expected if any(_optimization_action_name_matches_local(str(item), call) for call in calls))
        adjusted *= 0.5 + 0.5 * (matched / max(1, len(expected)))
    forbidden = (task or {}).get("forbiddenActions") or []
    if forbidden and any(_optimization_action_name_matches_local(str(item), call) for item in forbidden for call in calls):
        adjusted *= 0.25
    return adjusted


def _score_optimization_prediction_local(task, prediction, options):
    if "metric_score" in task:
        raw_scores = task.get("metric_score")
    elif "scores" in task:
        raw_scores = task.get("scores")
    elif "score" in task:
        raw_scores = task.get("score")
    elif (prediction or {}).get("completionType") == "error":
        raw_scores = 0
    else:
        raw_scores = 1
    scores = _normalize_optimization_metric_scores_local(raw_scores)
    scalar = _scalarize_optimization_scores_local(scores, options or {})
    scalar = _adjust_optimization_score_for_actions_local(scalar, task or {}, prediction or {})
    return scores, scalar


class AxMemory:
    def __init__(self):
        self.items: list[dict[str, Any]] = []

    def add_request(self, messages, session_id: str | None = None):
        self.items.append({"role": "request", "messages": messages, "session_id": session_id, "tags": []})
        return self

    def add_response(self, response, session_id: str | None = None):
        if not _ax_memory_response_meaningful(response):
            return self
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


def _ax_memory_response_meaningful(response) -> bool:
    if isinstance(response, list):
        return any(_ax_memory_response_meaningful(item) for item in response)
    if not isinstance(response, dict):
        return bool(response)
    content = response.get("content")
    if isinstance(content, str) and content.strip():
        return True
    for key in ("function_calls", "functionCalls", "tool_calls", "toolCalls", "thought_blocks", "thoughtBlocks"):
        value = response.get(key)
        if isinstance(value, list) and value:
            return True
    return response.get("audio") is not None


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
        if self.instruction:
            self.prompt_template.set_instruction(self.instruction)

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
                scores, scalar = _score_optimization_prediction_local(task if isinstance(task, dict) else {}, prediction, opts)
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

            class _Evaluator:
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
            raise ValueError("options.engine must implement OptimizerEngine for optimize()")
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


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_lower(value):
    return str(value).lower()


def _core_string_starts_with(value, prefix):
    return str(value).startswith(str(prefix))


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_default_if_empty(value, fallback):
    text = str(value or "").strip()
    return text if text else fallback


def _core_ai_complete_once(client, request):
    chat = getattr(client, "chat", None)
    if callable(chat):
        return chat_response_to_completion(chat(request))
    complete = getattr(client, "complete", None)
    if callable(complete):
        return complete(request)
    raise TypeError("AI client must implement chat() or complete()")


def _core_retry_sleep(attempt):
    time.sleep(min(0.25 * (int(attempt) + 1), 1.0))


def _core_exception_message(error):
    return str(error)


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(pattern, value) is not None


def _core_runtime_error(message):
    return RuntimeError(str(message))


def _core_validation_error(message):
    return AxValidationError(str(message))


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


# BEGIN AXIR CORE EMITTED FUNCTIONS
def _build_gen_chat_request(gen: AxGen, messages: list[Any], options: Any) -> AxChatRequest:
    _core_coverage_mark("_build_gen_chat_request")
    model_config = {}
    stream_value = _core_get(options, "stream", False)
    stream_bool = _core_truthy(stream_value)
    model_config["stream"] = stream_bool
    temperature = _core_get(options, "temperature", None)
    has_temperature = _core_is_not_none(temperature)
    if has_temperature:
        model_config["temperature"] = temperature
    else:
        pass
    max_tokens = _core_get(options, "max_tokens", None)
    has_max_tokens = _core_is_not_none(max_tokens)
    if has_max_tokens:
        model_config["max_tokens"] = max_tokens
    else:
        pass
    top_p = _core_get(options, "top_p", None)
    has_top_p = _core_is_not_none(top_p)
    if has_top_p:
        model_config["top_p"] = top_p
    else:
        pass
    presence_penalty = _core_get(options, "presence_penalty", None)
    has_presence_penalty = _core_is_not_none(presence_penalty)
    if has_presence_penalty:
        model_config["presence_penalty"] = presence_penalty
    else:
        pass
    frequency_penalty = _core_get(options, "frequency_penalty", None)
    has_frequency_penalty = _core_is_not_none(frequency_penalty)
    if has_frequency_penalty:
        model_config["frequency_penalty"] = frequency_penalty
    else:
        pass
    n = _core_get(options, "n", None)
    has_n = _core_is_not_none(n)
    if has_n:
        model_config["n"] = n
    else:
        pass
    stop_sequences = _core_get(options, "stop_sequences", None)
    has_stop_sequences = _core_is_not_none(stop_sequences)
    if has_stop_sequences:
        model_config["stop_sequences"] = stop_sequences
    else:
        pass
    request = {}
    model = _core_get(options, "model", None)
    request["model"] = model
    request["chat_prompt"] = messages
    functions = _core_get(gen, "functions", None)
    function_specs = []
    for fn in functions:
        spec = _tool_spec_impl(fn)
        function_specs.append(spec)
    request["functions"] = function_specs
    mode_snake = _core_get(options, "function_call_mode", None)
    mode_raw = _core_get(options, "functionCallMode", mode_snake)
    mode = _function_call_mode_impl(mode_raw)
    request["function_call"] = mode
    signature = _core_get(gen, "signature", None)
    output_fields = _core_get(signature, "output_fields", None)
    has_code_field = False
    for of in output_fields:
        of_type = _core_get(of, "type", None)
        of_type_name = _core_get(of_type, "name", None)
        of_is_code = _core_eq(of_type_name, "code")
        if of_is_code:
            has_code_field = True
        else:
            pass
    response_format = {}
    fn_count = _core_len(function_specs)
    has_functions = _core_gt(fn_count, 0)
    no_functions = _core_not(has_functions)
    use_json_schema = _core_or(has_code_field, no_functions)
    if use_json_schema:
        schema_options = {}
        schema_options["strictStructuredOutputs"] = True
        schema_options["flexibleJsonFieldsAsString"] = True
        code_schema = _schema_to_json_schema_impl(output_fields, "output", schema_options)
        code_schema_wrap = {}
        code_schema_wrap["name"] = "output"
        code_schema_wrap["strict"] = True
        code_schema_wrap["schema"] = code_schema
        response_format["type"] = "json_schema"
        response_format["schema"] = code_schema_wrap
    else:
        response_format["type"] = "json_object"
    request["response_format"] = response_format
    request["model_config"] = model_config
    return request


def fold_stream(events: list[Any]) -> str:
    _core_coverage_mark("fold_stream")
    chunks = []
    for event in events:
        parts = _stream_event_content_parts_impl(event)
        for part in parts:
            chunks.append(part)
    folded = _core_string_join("", chunks)
    return folded


def _execute_tool_call(functions: list[Any], call: Any) -> Any:
    _core_coverage_mark("_execute_tool_call")
    fn_call = _core_get(call, "function", None)
    direct_name = _core_get(call, "name", None)
    name = _core_get(fn_call, "name", direct_name)
    direct_params = _core_get(call, "params", None)
    params = _core_get(fn_call, "params", direct_params)
    missing_params = _core_is_none(params)
    if missing_params:
        argument_params = _core_get(call, "arguments", None)
        params = argument_params
    else:
        pass
    params_is_string = _core_type_is(params, "string")
    if params_is_string:
        parsed_params = _core_json_parse(params)
        params = parsed_params
    else:
        pass
    params_still_missing = _core_is_none(params)
    if params_still_missing:
        empty_params = {}
        params = empty_params
    else:
        pass
    for fn in functions:
        fn_name = _core_get(fn, "name", None)
        matches = _core_eq(fn_name, name)
        if matches:
            result = _core_tool_invoke(fn, params)
            return result
        else:
            pass
    available_names = []
    for fn in functions:
        available_name = _core_get(fn, "name", None)
        available_names.append(available_name)
    available_joined = _core_string_join(", ", available_names)
    available = _core_string_default_if_empty(available_joined, "(none)")
    message = _core_string_format("Function not found: {}. Available functions: {}. Call one of these exact function names.", name, available)
    error = _core_validation_error(message)
    raise error


def _stream_event_content_parts_impl(event: Any) -> list[Any]:
    _core_coverage_mark("_stream_event_content_parts_impl")
    parts = _core_stream_event_content_parts(event)
    return parts


def _validate_optimization_component_value(component: Any, value: Any) -> bool:
    _core_coverage_mark("_validate_optimization_component_value")
    current = _core_get(component, "current", None)
    current_is_string = _core_type_is(current, "string")
    if current_is_string:
        value_is_string = _core_type_is(value, "string")
        bad_string = _core_not(value_is_string)
        if bad_string:
            id = _core_get(component, "id", "")
            message = _core_string_format("invalid optimized component value for {}", id)
            error = _core_runtime_error(message)
            raise error
        else:
            pass
    else:
        pass
    current_is_object = _core_type_is(current, "object")
    if current_is_object:
        value_is_object = _core_type_is(value, "object")
        bad_object = _core_not(value_is_object)
        if bad_object:
            id_object = _core_get(component, "id", "")
            message_object = _core_string_format("invalid optimized component value for {}", id_object)
            error_object = _core_runtime_error(message_object)
            raise error_object
        else:
            pass
    else:
        pass
    current_is_list = _core_type_is(current, "list")
    if current_is_list:
        value_is_list = _core_type_is(value, "list")
        bad_list = _core_not(value_is_list)
        if bad_list:
            id_list = _core_get(component, "id", "")
            message_list = _core_string_format("invalid optimized component value for {}", id_list)
            error_list = _core_runtime_error(message_list)
            raise error_list
        else:
            pass
    else:
        pass
    current_is_number = _core_type_is(current, "number")
    if current_is_number:
        value_is_number = _core_type_is(value, "number")
        bad_number = _core_not(value_is_number)
        if bad_number:
            id_number = _core_get(component, "id", "")
            message_number = _core_string_format("invalid optimized component value for {}", id_number)
            error_number = _core_runtime_error(message_number)
            raise error_number
        else:
            pass
    else:
        pass
    current_is_boolean = _core_type_is(current, "boolean")
    if current_is_boolean:
        value_is_boolean = _core_type_is(value, "boolean")
        bad_boolean = _core_not(value_is_boolean)
        if bad_boolean:
            id_boolean = _core_get(component, "id", "")
            message_boolean = _core_string_format("invalid optimized component value for {}", id_boolean)
            error_boolean = _core_runtime_error(message_boolean)
            raise error_boolean
        else:
            pass
    else:
        pass
    format = _core_get(component, "format", "")
    is_snake = _core_eq(format, "snake_case")
    if is_snake:
        snake_ok = _core_regex_match("^[a-z][a-z0-9_]{0,31}$", value)
        bad_snake = _core_not(snake_ok)
        if bad_snake:
            error_snake = _core_runtime_error("invalid optimized function name")
            raise error_snake
        else:
            pass
    else:
        pass
    return True


def _forward_impl(gen: AxGen, client: AIClient, values: Any, options: Any) -> Any:
    _core_coverage_mark("_forward_impl")
    base_options = _core_get(gen, "options", None)
    runtime_options = _core_map_merge(base_options, options)
    signature = _core_get(gen, "signature", None)
    input_fields = _core_get(signature, "input_fields", None)
    validate_fields(input_fields, values, "input")
    prompt_template = _core_get(gen, "prompt_template", None)
    messages = _core_object_call_method(prompt_template, "render", values)
    example_messages = _render_examples(gen)
    demo_messages = _render_demos(gen)
    system_message = _core_list_get(messages, 0, messages)
    user_message = _core_list_get(messages, 1, messages)
    ordered_messages = []
    ordered_messages.append(system_message)
    for example_message in example_messages:
        ordered_messages.append(example_message)
    for demo_message in demo_messages:
        ordered_messages.append(demo_message)
    ordered_messages.append(user_message)
    cached_messages = _core_axgen_apply_context_cache(gen, ordered_messages, options)
    messages = cached_messages
    _core_axgen_memory_add_request(gen, messages)
    validation_retries_snake = _core_get(runtime_options, "validation_retries", 2)
    validation_retries = _core_get(runtime_options, "validationRetries", validation_retries_snake)
    infra_retries_snake = _core_get(runtime_options, "infra_retries", 2)
    infra_retries = _core_get(runtime_options, "infraRetries", infra_retries_snake)
    attempt = 0
    output_fields = _core_get(signature, "output_fields", None)
    functions = _core_get(gen, "functions", None)
    last_tool_result = _core_none()
    while True:
        request = _build_gen_chat_request(gen, messages, runtime_options)
        response = _complete_with_retries_impl(client, request, infra_retries)
        _core_axgen_memory_add_response(gen, request, response)
        _core_axgen_record_chat_log(gen, request, response)
        calls = _response_function_calls_impl(response)
        call_count = _core_len(calls)
        has_calls = _core_gt(call_count, 0)
        if has_calls:
            _append_tool_call_messages_impl(messages, response, calls)
            for call in calls:
                try:
                    tool_result = _execute_tool_call(functions, call)
                    last_tool_result = tool_result
                    tool_message = _tool_result_message_impl(call, tool_result)
                    messages.append(tool_message)
                    _core_axgen_memory_add_function_result(gen, call, tool_result, True)
                    _core_axgen_record_function_call(gen, call, tool_result, "ok")
                except Exception as tool_error:
                    tool_error_message = _tool_error_message_impl(call, tool_error)
                    messages.append(tool_error_message)
                    _core_axgen_memory_add_function_result(gen, call, tool_error_message, False)
                    _core_axgen_record_function_call(gen, call, tool_error_message, "error")
            continue_after_tools = _should_continue_steps(gen, calls)
            if continue_after_tools:
                continue
            else:
                validated_tool_result = validate_output(output_fields, last_tool_result)
                processed_tool_result = _apply_field_processors(gen, validated_tool_result)
                _run_assertions(gen, processed_tool_result)
                public_tool_result = strip_internal(output_fields, processed_tool_result)
                _core_axgen_memory_cleanup_corrections(gen)
                _record_trace(gen, values, public_tool_result, "ok")
                return public_tool_result
        else:
            try:
                content = _core_get(response, "content", "")
                output = _parse_output_impl(content)
                recovered = _parse_json_string_fields(output_fields, output)
                validated = validate_output(output_fields, recovered)
                processed = _apply_field_processors(gen, validated)
                _run_assertions(gen, processed)
                public_output = strip_internal(output_fields, processed)
                _core_axgen_memory_cleanup_corrections(gen)
                _record_trace(gen, values, public_output, "ok")
                return public_output
            except Exception as validation_error:
                retries_exhausted = _core_gte(attempt, validation_retries)
                if retries_exhausted:
                    raise validation_error
                else:
                    pass
                next_attempt = _core_add(attempt, 1)
                attempt = next_attempt
                _append_assertion_retry_messages(messages, response, validation_error)
                _core_axgen_memory_add_correction(gen, response, validation_error)
                continue
    raise RuntimeError("unreachable AxGen forward loop exit")


def _validate_optimization_component_map(components: Any, component_map: Any) -> bool:
    _core_coverage_mark("_validate_optimization_component_map")
    known = []
    component_by_id = {}
    for component in components:
        id = _core_get(component, "id", "")
        known.append(id)
        component_by_id[id] = component
    keys = _core_map_keys(component_map)
    for id in keys:
        ok = _core_contains(known, id)
        bad = _core_not(ok)
        if bad:
            message = _core_string_format("unknown optimized component id: {}", id)
            error = _core_runtime_error(message)
            raise error
        else:
            pass
        component = _core_get(component_by_id, id, None)
        value = _core_get(component_map, id, None)
        _validate_optimization_component_value(component, value)
    return True


def _validate_optimized_artifact_provenance(artifact: Any, components: Any) -> bool:
    _core_coverage_mark("_validate_optimized_artifact_provenance")
    empty_map = {}
    provenance = _core_get(artifact, "provenance", empty_map)
    owners = _core_get(provenance, "componentOwners", empty_map)
    owners_is_object = _core_type_is(owners, "object")
    bad_owners = _core_not(owners_is_object)
    if bad_owners:
        owners_error = _core_runtime_error("optimized artifact provenance componentOwners must be an object")
        raise owners_error
    else:
        pass
    for component in components:
        id = _core_get(component, "id", "")
        expected_owner = _core_get(owners, id, None)
        has_expected_owner = _core_is_not_none(expected_owner)
        if has_expected_owner:
            actual_owner = _core_get(component, "owner", "")
            owner_ok = _core_eq(expected_owner, actual_owner)
            stale_owner = _core_not(owner_ok)
            if stale_owner:
                message = _core_string_format("stale optimized component owner: {}", id)
                error = _core_runtime_error(message)
                raise error
            else:
                pass
        else:
            pass
    return True


def _validate_optimized_artifact(artifact: Any, components: Any) -> Any:
    _core_coverage_mark("_validate_optimized_artifact")
    is_object = _core_type_is(artifact, "object")
    not_object = _core_not(is_object)
    if not_object:
        error = _core_runtime_error("optimized artifact must be an object")
        raise error
    else:
        pass
    version = _core_get(artifact, "artifactVersion", "")
    version_ok = _core_eq(version, "axir-optimized-artifact-v1")
    bad_version = _core_not(version_ok)
    if bad_version:
        error_version = _core_runtime_error("unsupported optimized artifact version")
        raise error_version
    else:
        pass
    optimizer_name = _core_get(artifact, "optimizerName", "")
    name_is_string = _core_type_is(optimizer_name, "string")
    name_empty = _core_eq(optimizer_name, "")
    bad_name_type = _core_not(name_is_string)
    bad_name = _core_or(bad_name_type, name_empty)
    if bad_name:
        name_error = _core_runtime_error("optimized artifact optimizerName must be a non-empty string")
        raise name_error
    else:
        pass
    optimizer_version = _core_get(artifact, "optimizerVersion", "")
    version_is_string = _core_type_is(optimizer_version, "string")
    optimizer_version_empty = _core_eq(optimizer_version, "")
    bad_optimizer_version_type = _core_not(version_is_string)
    bad_optimizer_version = _core_or(bad_optimizer_version_type, optimizer_version_empty)
    if bad_optimizer_version:
        optimizer_version_error = _core_runtime_error("optimized artifact optimizerVersion must be a non-empty string")
        raise optimizer_version_error
    else:
        pass
    empty_map = {}
    component_map = _core_get(artifact, "componentMap", empty_map)
    component_map_is_object = _core_type_is(component_map, "object")
    bad_component_map = _core_not(component_map_is_object)
    if bad_component_map:
        error_map = _core_runtime_error("optimized artifact componentMap must be an object")
        raise error_map
    else:
        pass
    metadata = _core_get(artifact, "metadata", None)
    metadata_is_object = _core_type_is(metadata, "object")
    bad_metadata = _core_not(metadata_is_object)
    if bad_metadata:
        metadata_error = _core_runtime_error("optimized artifact metadata must be an object")
        raise metadata_error
    else:
        pass
    provenance = _core_get(artifact, "provenance", None)
    provenance_is_object = _core_type_is(provenance, "object")
    bad_provenance = _core_not(provenance_is_object)
    if bad_provenance:
        provenance_error = _core_runtime_error("optimized artifact provenance must be an object")
        raise provenance_error
    else:
        pass
    evidence = _core_get(artifact, "evidence", None)
    evidence_is_object = _core_type_is(evidence, "object")
    bad_evidence = _core_not(evidence_is_object)
    if bad_evidence:
        evidence_error = _core_runtime_error("optimized artifact evidence must be an object")
        raise evidence_error
    else:
        pass
    _validate_optimization_component_map(components, component_map)
    _validate_optimized_artifact_provenance(artifact, components)
    return artifact


def _set_examples(gen: AxGen, examples: list[Any]) -> AxGen:
    _core_coverage_mark("_set_examples")
    gen["examples"] = examples
    return gen


def _set_demos(gen: AxGen, demos: list[Any]) -> AxGen:
    _core_coverage_mark("_set_demos")
    gen["demos"] = demos
    return gen


def _render_examples(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_examples")
    messages = _core_axgen_render_examples(gen)
    return messages


def _render_demos(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_demos")
    messages = _core_axgen_render_demos(gen)
    return messages


def _serialize_optimized_artifact(artifact: Any) -> str:
    _core_coverage_mark("_serialize_optimized_artifact")
    text = _core_json_stringify(artifact)
    return text


def _apply_field_processors(gen: AxGen, output: Any) -> Any:
    _core_coverage_mark("_apply_field_processors")
    processed = _core_axgen_apply_field_processors(gen, output)
    return processed


def _deserialize_optimized_artifact(text: str, components: Any) -> Any:
    _core_coverage_mark("_deserialize_optimized_artifact")
    artifact = _core_json_parse(text)
    validated = _validate_optimized_artifact(artifact, components)
    return validated


def _run_assertions(gen: AxGen, output: Any) -> None:
    _core_coverage_mark("_run_assertions")
    _core_axgen_run_assertions(gen, output)
    return None


def _optimization_changed_components(components: Any, component_map: Any) -> list[Any]:
    _core_coverage_mark("_optimization_changed_components")
    changes = []
    for component in components:
        id = _core_get(component, "id", "")
        current = _core_get(component, "current", None)
        next = _core_get(component_map, id, current)
        same = _core_eq(current, next)
        changed = _core_not(same)
        if changed:
            entry = {}
            entry["id"] = id
            entry["current"] = current
            entry["next"] = next
            changes.append(entry)
        else:
            pass
    return changes


def _append_assertion_retry_messages(messages: list[Any], response: Any, error: error) -> None:
    _core_coverage_mark("_append_assertion_retry_messages")
    _append_validation_retry_messages_impl(messages, response, error)
    return None


def _record_trace(gen: AxGen, input: Any, output: Any, status: str) -> None:
    _core_coverage_mark("_record_trace")
    _core_axgen_record_trace(gen, input, output, status)
    return None


def _optimization_component_current_map(components: Any) -> Any:
    _core_coverage_mark("_optimization_component_current_map")
    out = {}
    for component in components:
        id = _core_get(component, "id", "")
        current = _core_get(component, "current", None)
        out[id] = current
    return out


def _should_continue_steps(gen: AxGen, calls: list[Any]) -> bool:
    _core_coverage_mark("_should_continue_steps")
    should_continue = _core_axgen_should_continue_steps(gen, calls)
    return should_continue


def _normalize_optimization_dataset(dataset: Any) -> Any:
    _core_coverage_mark("_normalize_optimization_dataset")
    empty_list = []
    is_object = _core_type_is(dataset, "object")
    if is_object:
        train = _core_get(dataset, "train", empty_list)
        validation = _core_get(dataset, "validation", empty_list)
        out_obj = {}
        out_obj["train"] = train
        out_obj["validation"] = validation
        return out_obj
    else:
        pass
    out_list = {}
    out_list["train"] = dataset
    out_list["validation"] = empty_list
    return out_list


def _complete_with_retries_impl(client: AIClient, request: AxChatRequest, retries: int) -> Any:
    _core_coverage_mark("_complete_with_retries_impl")
    attempt = 0
    last_error = _core_none()
    while True:
        try:
            response = _core_ai_complete_once(client, request)
            return response
        except Exception as error:
            last_error = error
            exhausted = _core_gte(attempt, retries)
            if exhausted:
                raise error
            else:
                pass
            _core_retry_sleep(attempt)
            next_attempt = _core_add(attempt, 1)
            attempt = next_attempt
            continue
    raise last_error


def _normalize_optimization_metric_scores(raw: Any) -> Any:
    _core_coverage_mark("_normalize_optimization_metric_scores")
    is_number = _core_type_is(raw, "number")
    if is_number:
        out_number = {}
        out_number["score"] = raw
        return out_number
    else:
        pass
    is_object = _core_type_is(raw, "object")
    if is_object:
        return raw
    else:
        pass
    out_zero = {}
    out_zero["score"] = 0
    return out_zero


def _parse_output_impl(content: str) -> Any:
    _core_coverage_mark("_parse_output_impl")
    text = str(content).strip()
    output = _core_json_parse(text)
    return output


def _scalarize_optimization_scores(scores: Any, options: Any) -> f64:
    _core_coverage_mark("_scalarize_optimization_scores")
    metric_key = _core_get(options, "paretoMetricKey", "")
    has_metric = _core_ne(metric_key, "")
    if has_metric:
        picked = _core_get(scores, metric_key, 0)
        return picked
    else:
        pass
    values = _core_map_values(scores)
    sum = 0
    count = 0
    for value in values:
        sum_next = _core_add(sum, value)
        count_next = _core_add(count, 1)
        sum = sum_next
        count = count_next
    empty = _core_eq(count, 0)
    if empty:
        return 0
    else:
        pass
    avg = _core_div(sum, count)
    return avg


def _is_flexible_json_field(typ: FieldType) -> bool:
    _core_coverage_mark("_is_flexible_json_field")
    type_name = _core_get(typ, "name", None)
    is_json = _core_eq(type_name, "json")
    is_object = _core_eq(type_name, "object")
    fields = _core_get(typ, "fields", None)
    has_fields = _core_truthy(fields)
    no_fields = _core_not(has_fields)
    flexible = is_json
    if is_object:
        if no_fields:
            flexible = True
        else:
            pass
    else:
        pass
    return flexible


def _optimization_action_name_matches(expected: str, call: Any) -> bool:
    _core_coverage_mark("_optimization_action_name_matches")
    qualified = _core_get(call, "qualifiedName", "")
    name = _core_get(call, "name", "")
    qualified_match = _core_eq(qualified, expected)
    name_match = _core_eq(name, expected)
    dot_expected = _core_add(".", expected)
    suffix_match = _core_string_ends_with(qualified, dot_expected)
    direct_match = _core_or(qualified_match, name_match)
    any_match = _core_or(direct_match, suffix_match)
    return any_match


def _parse_json_string_value(value: Any) -> Any:
    _core_coverage_mark("_parse_json_string_value")
    is_string = _core_type_is(value, "string")
    not_string = _core_not(is_string)
    if not_string:
        return value
    else:
        pass
    result = value
    try:
        parsed = _core_json_parse(value)
        result = parsed
    except Exception as parse_error:
        result = value
    return result


def _adjust_optimization_score_for_actions(score: Any, task: Any, prediction: Any) -> f64:
    _core_coverage_mark("_adjust_optimization_score_for_actions")
    empty_list = []
    function_calls = _core_get(prediction, "functionCalls", empty_list)
    expected_actions = _core_get(task, "expectedActions", empty_list)
    forbidden_actions = _core_get(task, "forbiddenActions", empty_list)
    adjusted = score
    expected_count = _core_len(expected_actions)
    has_expected = _core_gt(expected_count, 0)
    if has_expected:
        matched = 0
        for expected in expected_actions:
            found = False
            for call in function_calls:
                call_matches = _optimization_action_name_matches(expected, call)
                if call_matches:
                    found = True
                else:
                    pass
            if found:
                matched_next = _core_add(matched, 1)
                matched = matched_next
            else:
                pass
        ratio = _core_div(matched, expected_count)
        half_ratio = _core_mul(0.5, ratio)
        factor = _core_add(0.5, half_ratio)
        adjusted_next = _core_mul(adjusted, factor)
        adjusted = adjusted_next
    else:
        pass
    for forbidden in forbidden_actions:
        bad_found = False
        for call in function_calls:
            bad_match = _optimization_action_name_matches(forbidden, call)
            if bad_match:
                bad_found = True
            else:
                pass
        if bad_found:
            penalized = _core_mul(adjusted, 0.2)
            adjusted = penalized
        else:
            pass
    return adjusted


def _parse_json_string_for_field(field: Field, value: Any) -> Any:
    _core_coverage_mark("_parse_json_string_for_field")
    typ = _core_get(field, "type", None)
    value_is_none = _core_is_none(value)
    if value_is_none:
        return value
    else:
        pass
    flexible = _is_flexible_json_field(typ)
    is_array = _core_get(typ, "is_array", False)
    typ_fields = _core_get(typ, "fields", None)
    has_typ_fields = _core_truthy(typ_fields)
    if is_array:
        value_is_list = _core_type_is(value, "list")
        not_list = _core_not(value_is_list)
        if not_list:
            return value
        else:
            pass
        if flexible:
            out = []
            for item in value:
                parsed_item = _parse_json_string_value(item)
                out.append(parsed_item)
            return out
        else:
            pass
        if has_typ_fields:
            rebuilt = []
            for item in value:
                item_is_map = _core_type_is(item, "object")
                if item_is_map:
                    parsed_obj = _parse_json_string_for_fields(typ_fields, item)
                    rebuilt.append(parsed_obj)
                else:
                    rebuilt.append(item)
            return rebuilt
        else:
            pass
        return value
    else:
        pass
    if flexible:
        parsed_scalar = _parse_json_string_value(value)
        return parsed_scalar
    else:
        pass
    type_name = _core_get(typ, "name", None)
    is_object = _core_eq(type_name, "object")
    if is_object:
        if has_typ_fields:
            parsed_obj2 = _parse_json_string_for_fields(typ_fields, value)
            return parsed_obj2
        else:
            pass
    else:
        pass
    return value


def _parse_json_string_fields(output_fields: list[Any], values: Any) -> Any:
    _core_coverage_mark("_parse_json_string_fields")
    values_is_map = _core_type_is(values, "object")
    not_map = _core_not(values_is_map)
    if not_map:
        return values
    else:
        pass
    for field in output_fields:
        name = _core_get(field, "name", None)
        has_key = _core_map_contains(values, name)
        if has_key:
            value = _core_get(values, name, None)
            parsed = _parse_json_string_for_field(field, value)
            values[name] = parsed
        else:
            pass
    return values


def _parse_json_string_for_fields(fields_map: Any, values: Any) -> Any:
    _core_coverage_mark("_parse_json_string_for_fields")
    values_is_map = _core_type_is(values, "object")
    not_map = _core_not(values_is_map)
    if not_map:
        return values
    else:
        pass
    nested_fields = _core_fields_from_map(fields_map)
    for field in nested_fields:
        name = _core_get(field, "name", None)
        has_key = _core_map_contains(values, name)
        if has_key:
            value = _core_get(values, name, None)
            parsed = _parse_json_string_for_field(field, value)
            values[name] = parsed
        else:
            pass
    return values


def _build_optimization_eval_row(task: Any, prediction: Any, scores: Any, scalar: Any, trace: Any, error: Any) -> Any:
    _core_coverage_mark("_build_optimization_eval_row")
    out = {}
    out["input"] = task
    out["prediction"] = prediction
    out["scores"] = scores
    out["scalar"] = scalar
    out["trace"] = trace
    has_error = _core_is_not_none(error)
    if has_error:
        out["error"] = error
    else:
        pass
    return out


def _tool_spec_impl(fn: Tool) -> Any:
    _core_coverage_mark("_tool_spec_impl")
    spec = {}
    name = _core_get(fn, "name", None)
    description = _core_get(fn, "description", None)
    parameters = _core_get(fn, "parameters", None)
    spec["name"] = name
    spec["description"] = description
    spec["parameters"] = parameters
    return spec


def _build_optimization_eval_result(rows: Any, candidate_map: Any, phase: str) -> Any:
    _core_coverage_mark("_build_optimization_eval_result")
    sum = 0
    count = 0
    for row in rows:
        scalar = _core_get(row, "scalar", 0)
        sum_next = _core_add(sum, scalar)
        count_next = _core_add(count, 1)
        sum = sum_next
        count = count_next
    avg = 0
    has_rows = _core_gt(count, 0)
    if has_rows:
        avg_next = _core_div(sum, count)
        avg = avg_next
    else:
        pass
    out = {}
    out["phase"] = phase
    out["candidateMap"] = candidate_map
    out["rows"] = rows
    out["sum"] = sum
    out["avg"] = avg
    out["count"] = count
    return out


def _function_call_mode_impl(mode: Any) -> str:
    _core_coverage_mark("_function_call_mode_impl")
    missing = _core_is_none(mode)
    if missing:
        return "auto"
    else:
        pass
    is_native = _core_eq(mode, "native")
    is_auto = _core_eq(mode, "auto")
    native_or_auto = _core_or(is_native, is_auto)
    if native_or_auto:
        return "auto"
    else:
        pass
    is_prompt = _core_eq(mode, "prompt")
    if is_prompt:
        return "none"
    else:
        pass
    return mode


def _response_function_calls_impl(response: Any) -> list[Any]:
    _core_coverage_mark("_response_function_calls_impl")
    empty = []
    calls = _core_get(response, "function_calls", empty)
    return calls


def _filter_optimization_components(components: Any, target: Any) -> list[Any]:
    _core_coverage_mark("_filter_optimization_components")
    out = []
    is_list = _core_type_is(target, "list")
    is_all = _core_eq(target, "all")
    is_actor = _core_eq(target, "actor")
    is_responder = _core_eq(target, "responder")
    is_flow = _core_eq(target, "flow")
    for component in components:
        id = _core_get(component, "id", "")
        kind = _core_get(component, "kind", "")
        include = False
        if is_all:
            include = True
        else:
            pass
        if is_list:
            listed = _core_contains(target, id)
            if listed:
                include = True
            else:
                pass
        else:
            pass
        if is_actor:
            actor_match = _core_string_ends_with(id, ".actor")
            actor_component_match = _core_contains(id, ".actor::")
            actor_any_match = _core_or(actor_match, actor_component_match)
            if actor_any_match:
                include = True
            else:
                pass
        else:
            pass
        if is_responder:
            responder_match = _core_string_ends_with(id, ".responder")
            responder_component_match = _core_contains(id, ".responder::")
            responder_any_match = _core_or(responder_match, responder_component_match)
            if responder_any_match:
                include = True
            else:
                pass
        else:
            pass
        if is_flow:
            flow_component = _core_eq(kind, "flow-graph")
            if flow_component:
                include = True
            else:
                pass
        else:
            pass
        explicit_match = _core_eq(target, id)
        if explicit_match:
            include = True
        else:
            pass
        if include:
            out.append(component)
        else:
            pass
    count = _core_len(out)
    empty = _core_eq(count, 0)
    if empty:
        message = _core_string_format("no optimizable components match target: {}", target)
        error = _core_runtime_error(message)
        raise error
    else:
        pass
    return out


def _append_tool_call_messages_impl(messages: list[Any], response: Any, calls: list[Any]) -> None:
    _core_coverage_mark("_append_tool_call_messages_impl")
    chat_calls = []
    for call in calls:
        chat_call = _completion_call_to_chat_impl(call)
        chat_calls.append(chat_call)
    content = _core_get(response, "content", "")
    message = {}
    message["role"] = "assistant"
    message["content"] = content
    message["function_calls"] = chat_calls
    messages.append(message)
    return None


def _completion_call_to_chat_impl(call: Any) -> Any:
    _core_coverage_mark("_completion_call_to_chat_impl")
    id = _core_get(call, "id", None)
    name = _core_get(call, "name", None)
    params = _core_get(call, "params", None)
    function = {}
    function["name"] = name
    function["params"] = params
    out = {}
    out["id"] = id
    out["type"] = "function"
    out["function"] = function
    return out


def _tool_result_message_impl(call: Any, result: Any) -> Any:
    _core_coverage_mark("_tool_result_message_impl")
    id = _core_get(call, "id", None)
    result_json = _core_json_stringify(result)
    message = {}
    message["role"] = "function"
    message["function_id"] = id
    message["result"] = result_json
    return message


def _build_optimizer_request(program_kind: str, components: Any, dataset: Any, options: Any, trace: Any) -> Any:
    _core_coverage_mark("_build_optimizer_request")
    out = {}
    out["contractVersion"] = "axir-optimize-contract-v1"
    out["programKind"] = program_kind
    out["components"] = components
    out["dataset"] = dataset
    out["options"] = options
    out["trace"] = trace
    evaluator = {}
    methods = []
    methods.append("evaluate")
    evaluator["available"] = True
    evaluator["contractVersion"] = "axir-optimizer-evaluator-v1"
    evaluator["evidenceContractVersion"] = "axir-optimizer-evidence-v1"
    evaluator["methods"] = methods
    out["evaluator"] = evaluator
    return out


def _tool_error_message_impl(call: Any, error: error) -> Any:
    _core_coverage_mark("_tool_error_message_impl")
    id = _core_get(call, "id", None)
    error_text = _core_exception_message(error)
    payload = {}
    payload["error"] = error_text
    payload_json = _core_json_stringify(payload)
    message = {}
    message["role"] = "function"
    message["function_id"] = id
    message["result"] = payload_json
    message["is_error"] = True
    return message


def _append_validation_retry_messages_impl(messages: list[Any], response: Any, error: error) -> None:
    _core_coverage_mark("_append_validation_retry_messages_impl")
    content = _core_get(response, "content", "")
    assistant_message = {}
    assistant_message["role"] = "assistant"
    assistant_message["content"] = content
    messages.append(assistant_message)
    error_text = _core_exception_message(error)
    prefix_message = _core_add("The previous response failed validation: ", error_text)
    retry_content = _core_add(prefix_message, ". Return only corrected JSON.")
    retry_message = {}
    retry_message["role"] = "user"
    retry_message["content"] = retry_content
    messages.append(retry_message)
    return None


def _prepare_optimizer_run(program_kind: str, components: Any, dataset: Any, options: Any, trace: Any, evaluator_available: bool) -> Any:
    _core_coverage_mark("_prepare_optimizer_run")
    empty_map = {}
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    normalized = _normalize_optimization_dataset(dataset)
    target = _core_get(opts, "target", "all")
    selected = _filter_optimization_components(components, target)
    request_options = _core_map_merge(empty_map, opts)
    _core_map_delete(request_options, "client")
    _core_map_delete(request_options, "ai")
    _core_map_delete(request_options, "engine")
    _core_map_delete(request_options, "optimizer")
    request = _build_optimizer_request(program_kind, selected, normalized, request_options, trace)
    evaluator = _core_get(request, "evaluator", None)
    evaluator["available"] = evaluator_available
    request["evaluator"] = evaluator
    out = {}
    out["components"] = components
    out["selectedComponents"] = selected
    out["dataset"] = normalized
    out["options"] = request_options
    out["request"] = request
    return out


def _normalize_optimizer_engine_response(response: Any, engine_name: str, engine_version: str, components: Any) -> Any:
    _core_coverage_mark("_normalize_optimizer_engine_response")
    response_is_object = _core_type_is(response, "object")
    bad_response = _core_not(response_is_object)
    if bad_response:
        error = _core_runtime_error("optimizer engine must return an optimized artifact")
        raise error
    else:
        pass
    empty_map = {}
    has_artifact = _core_map_contains(response, "artifact")
    artifact_source = response
    if has_artifact:
        artifact_value = _core_get(response, "artifact", None)
        artifact_source = artifact_value
    else:
        pass
    artifact = _core_map_merge(empty_map, artifact_source)
    artifact_is_object = _core_type_is(artifact, "object")
    bad_artifact = _core_not(artifact_is_object)
    if bad_artifact:
        artifact_error = _core_runtime_error("optimizer engine must return an optimized artifact")
        raise artifact_error
    else:
        pass
    version = _core_get(artifact, "artifactVersion", None)
    missing_version = _core_is_none(version)
    if missing_version:
        artifact["artifactVersion"] = "axir-optimized-artifact-v1"
    else:
        pass
    name = _core_get(artifact, "optimizerName", None)
    missing_name = _core_is_none(name)
    if missing_name:
        artifact["optimizerName"] = engine_name
    else:
        pass
    engine_ver = _core_get(artifact, "optimizerVersion", None)
    missing_engine_ver = _core_is_none(engine_ver)
    if missing_engine_ver:
        artifact["optimizerVersion"] = engine_version
    else:
        pass
    component_map = _core_get(artifact, "componentMap", None)
    missing_component_map = _core_is_none(component_map)
    if missing_component_map:
        snake_map = _core_get(artifact, "component_map", empty_map)
        artifact["componentMap"] = snake_map
    else:
        pass
    metadata = _core_get(artifact, "metadata", None)
    missing_metadata = _core_is_none(metadata)
    if missing_metadata:
        default_metadata = {}
        artifact["metadata"] = default_metadata
    else:
        pass
    metadata_final = _core_get(artifact, "metadata", None)
    provenance = _core_get(artifact, "provenance", None)
    missing_provenance = _core_is_none(provenance)
    if missing_provenance:
        empty_provenance = {}
        metadata_provenance = _core_get(metadata_final, "provenance", empty_provenance)
        artifact["provenance"] = metadata_provenance
    else:
        pass
    evidence = _core_get(artifact, "evidence", None)
    missing_evidence = _core_is_none(evidence)
    if missing_evidence:
        empty_evidence = {}
        metadata_evidence = _core_get(metadata_final, "evidence", empty_evidence)
        artifact["evidence"] = metadata_evidence
    else:
        pass
    validated = _validate_optimized_artifact(artifact, components)
    map = _core_get(validated, "componentMap", None)
    changed = _optimization_changed_components(components, map)
    validated["changedComponents"] = changed
    return validated


def _build_optimizer_evidence_batch(eval_result: Any, components: Any) -> Any:
    _core_coverage_mark("_build_optimizer_evidence_batch")
    empty_list = []
    empty_map = {}
    rows = _core_get(eval_result, "rows", empty_list)
    outputs = []
    scores = []
    score_vectors = []
    trajectories = []
    for row in rows:
        prediction = _core_get(row, "prediction", empty_map)
        output = _core_get(prediction, "output", prediction)
        outputs.append(output)
        scalar = _core_get(row, "scalar", 0)
        scores.append(scalar)
        vector = _core_get(row, "scores", empty_map)
        score_vectors.append(vector)
        trajectory = {}
        trace = _core_get(row, "trace", None)
        trajectory["trace"] = trace
        trajectory["output"] = output
        row_error = _core_get(row, "error", None)
        prediction_error = _core_get(prediction, "error", row_error)
        has_error = _core_is_not_none(prediction_error)
        if has_error:
            trajectory["error"] = prediction_error
        else:
            pass
        trajectories.append(trajectory)
    reflective = {}
    for component in components:
        id = _core_get(component, "id", "")
        items = []
        for row in rows:
            entry = {}
            prediction = _core_get(row, "prediction", empty_map)
            output = _core_get(prediction, "output", prediction)
            scalar = _core_get(row, "scalar", 0)
            trace = _core_get(row, "trace", None)
            entry["score"] = scalar
            entry["output"] = output
            entry["trace"] = trace
            error = _core_get(row, "error", None)
            has_error = _core_is_not_none(error)
            if has_error:
                entry["error"] = error
            else:
                pass
            items.append(entry)
        reflective[id] = items
    out = {}
    out["contractVersion"] = "axir-optimizer-evidence-v1"
    candidate_map = _core_get(eval_result, "candidateMap", empty_map)
    out["candidateMap"] = candidate_map
    out["outputs"] = outputs
    out["scores"] = scores
    out["scoreVectors"] = score_vectors
    out["trajectories"] = trajectories
    avg = _core_get(eval_result, "avg", 0)
    sum = _core_get(eval_result, "sum", 0)
    count = _core_get(eval_result, "count", 0)
    out["avg"] = avg
    out["sum"] = sum
    out["count"] = count
    out["reflectiveDataset"] = reflective
    return out


def _ace_estimate_token_count(text: str) -> i64:
    _core_coverage_mark("_ace_estimate_token_count")
    len = _core_len(text)
    tokens = 0
    remaining = len
    while True:
        done = _core_lte(remaining, 0)
        if done:
            break
        else:
            pass
        tokens_next = _core_add(tokens, 1)
        tokens = tokens_next
        remaining_next = _core_add(remaining, -4)
        remaining = remaining_next
    return tokens


def _ace_recompute_playbook_stats(playbook: Any) -> Any:
    _core_coverage_mark("_ace_recompute_playbook_stats")
    empty_map = {}
    sections = _core_get(playbook, "sections", empty_map)
    bullet_count = 0
    helpful_count = 0
    harmful_count = 0
    token_estimate = 0
    section_lists = _core_map_values(sections)
    for bullets in section_lists:
        for bullet in bullets:
            bullet_count_next = _core_add(bullet_count, 1)
            bullet_count = bullet_count_next
            helpful = _core_get(bullet, "helpfulCount", 0)
            harmful = _core_get(bullet, "harmfulCount", 0)
            helpful_count_next = _core_add(helpful_count, helpful)
            helpful_count = helpful_count_next
            harmful_count_next = _core_add(harmful_count, harmful)
            harmful_count = harmful_count_next
            content = _core_get(bullet, "content", "")
            bullet_tokens = _ace_estimate_token_count(content)
            token_estimate_next = _core_add(token_estimate, bullet_tokens)
            token_estimate = token_estimate_next
    stats = {}
    stats["bulletCount"] = bullet_count
    stats["helpfulCount"] = helpful_count
    stats["harmfulCount"] = harmful_count
    stats["tokenEstimate"] = token_estimate
    playbook["stats"] = stats
    return playbook


def _ace_empty_playbook(description: Any, now: str) -> Any:
    _core_coverage_mark("_ace_empty_playbook")
    out = {}
    out["version"] = 1
    sections = {}
    out["sections"] = sections
    stats = {}
    stats["bulletCount"] = 0
    stats["helpfulCount"] = 0
    stats["harmfulCount"] = 0
    stats["tokenEstimate"] = 0
    out["stats"] = stats
    out["updatedAt"] = now
    has_description = _core_is_not_none(description)
    if has_description:
        out["description"] = description
    else:
        pass
    return out


def _ace_render_playbook(playbook: Any) -> str:
    _core_coverage_mark("_ace_render_playbook")
    empty_map = {}
    description = _core_get(playbook, "description", None)
    has_description = _core_is_not_none(description)
    header = "## Context Playbook\n"
    if has_description:
        trimmed_description = str(description).strip()
        header_with_description = _core_string_format("## Context Playbook\n{}\n", trimmed_description)
        header = header_with_description
    else:
        pass
    sections = _core_get(playbook, "sections", empty_map)
    section_names = _core_map_keys(sections)
    section_blocks = []
    for section_name in section_names:
        bullets = _core_get(sections, section_name, None)
        bullet_lines = []
        for bullet in bullets:
            id = _core_get(bullet, "id", "")
            content = _core_get(bullet, "content", "")
            line = _core_string_format("- [{}] {}", id, content)
            bullet_lines.append(line)
        body = _core_string_join("\n", bullet_lines)
        has_body = _core_ne(body, "")
        block = ""
        if has_body:
            block_with_body = _core_string_format("### {}\n{}", section_name, body)
            block = block_with_body
        else:
            block_empty = _core_string_format("### {}\n_(empty)_", section_name)
            block = block_empty
        section_blocks.append(block)
    joined_sections = _core_string_join("\n\n", section_blocks)
    combined = _core_string_format("{}\n{}", header, joined_sections)
    result = str(combined).strip()
    return result


def _ace_update_bullet_feedback(playbook: Any, bullet_id: str, tag: str, now: str) -> Any:
    _core_coverage_mark("_ace_update_bullet_feedback")
    empty_map = {}
    sections = _core_get(playbook, "sections", empty_map)
    section_names = _core_map_keys(sections)
    found = False
    for section_name in section_names:
        already_found = found
        if already_found:
            pass
        else:
            bullets = _core_get(sections, section_name, None)
            for bullet in bullets:
                current_id = _core_get(bullet, "id", "")
                match = _core_eq(bullet_id, current_id)
                still_open = _core_not(found)
                if match:
                    if still_open:
                        is_helpful = _core_eq(tag, "helpful")
                        if is_helpful:
                            helpful = _core_get(bullet, "helpfulCount", 0)
                            helpful_next = _core_add(helpful, 1)
                            bullet["helpfulCount"] = helpful_next
                        else:
                            pass
                        is_harmful = _core_eq(tag, "harmful")
                        if is_harmful:
                            harmful = _core_get(bullet, "harmfulCount", 0)
                            harmful_next = _core_add(harmful, 1)
                            bullet["harmfulCount"] = harmful_next
                        else:
                            pass
                        bullet["updatedAt"] = now
                        found = True
                    else:
                        pass
                else:
                    pass
    did_find = found
    if did_find:
        updated = _ace_recompute_playbook_stats(playbook)
        return updated
    else:
        pass
    return playbook


def _ace_dedupe_playbook(playbook: Any) -> Any:
    _core_coverage_mark("_ace_dedupe_playbook")
    empty_map = {}
    sections = _core_get(playbook, "sections", empty_map)
    section_names = _core_map_keys(sections)
    for section_name in section_names:
        bullets = _core_get(sections, section_name, None)
        seen = {}
        unique = []
        for bullet in bullets:
            content = _core_get(bullet, "content", "")
            trimmed = str(content).strip()
            key = _core_string_lower(trimmed)
            has_existing = _core_map_contains(seen, key)
            if has_existing:
                existing = _core_get(seen, key, None)
                existing_helpful = _core_get(existing, "helpfulCount", 0)
                bullet_helpful = _core_get(bullet, "helpfulCount", 0)
                merged_helpful = _core_add(existing_helpful, bullet_helpful)
                existing["helpfulCount"] = merged_helpful
                existing_harmful = _core_get(existing, "harmfulCount", 0)
                bullet_harmful = _core_get(bullet, "harmfulCount", 0)
                merged_harmful = _core_add(existing_harmful, bullet_harmful)
                existing["harmfulCount"] = merged_harmful
                bullet_updated_at = _core_get(bullet, "updatedAt", "")
                existing["updatedAt"] = bullet_updated_at
            else:
                seen[key] = bullet
                unique.append(bullet)
        sections[section_name] = unique
    playbook["sections"] = sections
    recomputed = _ace_recompute_playbook_stats(playbook)
    return recomputed


def _ace_prune_section_for_addition(section: Any, protected_ids: Any) -> Any:
    _core_coverage_mark("_ace_prune_section_for_addition")
    candidate_index = -1
    candidate_net = 0
    candidate_helpful = 0
    candidate_recency = 0
    index = 0
    for bullet in section:
        id = _core_get(bullet, "id", "")
        is_protected = _core_contains(protected_ids, id)
        not_protected = _core_not(is_protected)
        if not_protected:
            helpful = _core_get(bullet, "helpfulCount", 0)
            harmful = _core_get(bullet, "harmfulCount", 0)
            harmful_weighted = _core_mul(harmful, 2)
            negative_harmful = _core_mul(harmful_weighted, -1)
            net_score = _core_add(helpful, negative_harmful)
            created_at = _core_get(bullet, "createdAt", "")
            recency = _core_get(bullet, "updatedAt", created_at)
            no_candidate = _core_lt(candidate_index, 0)
            if no_candidate:
                candidate_index = index
                candidate_net = net_score
                candidate_helpful = helpful
                candidate_recency = recency
            else:
                net_lower = _core_lt(net_score, candidate_net)
                net_equal = _core_eq(net_score, candidate_net)
                helpful_lower = _core_lt(helpful, candidate_helpful)
                helpful_equal = _core_eq(helpful, candidate_helpful)
                recency_lower = _core_lt(recency, candidate_recency)
                is_worse = net_lower
                if net_equal:
                    if helpful_lower:
                        is_worse = True
                    else:
                        pass
                    if helpful_equal:
                        if recency_lower:
                            is_worse = True
                        else:
                            pass
                    else:
                        pass
                else:
                    pass
                if is_worse:
                    candidate_index = index
                    candidate_net = net_score
                    candidate_helpful = helpful
                    candidate_recency = recency
                else:
                    pass
        else:
            pass
        index_next = _core_add(index, 1)
        index = index_next
    out = {}
    has_candidate = _core_gte(candidate_index, 0)
    new_section = []
    if has_candidate:
        pruned = _core_none()
        cursor = 0
        for bullet in section:
            is_target = _core_eq(cursor, candidate_index)
            if is_target:
                pruned = bullet
            else:
                new_section.append(bullet)
            cursor_next = _core_add(cursor, 1)
            cursor = cursor_next
        out["pruned"] = pruned
        out["section"] = new_section
        return out
    else:
        pass
    null_pruned = _core_none()
    out["pruned"] = null_pruned
    out["section"] = section
    return out


def _ace_apply_curator_operations(playbook: Any, operations: Any, options: Any, now: str) -> Any:
    _core_coverage_mark("_ace_apply_curator_operations")
    empty_map = {}
    empty_list = []
    opts = options
    opts_missing = _core_is_none(options)
    if opts_missing:
        opts = empty_map
    else:
        pass
    allow_dynamic = _core_get(opts, "allowDynamicSections", True)
    enable_auto_prune = _core_get(opts, "enableAutoPrune", False)
    has_max = _core_map_contains(opts, "maxSectionSize")
    max_section_size = _core_get(opts, "maxSectionSize", 0)
    protected_ids = _core_get(opts, "protectedBulletIds", empty_list)
    updated_bullets = []
    auto_removed = []
    sections = _core_get(playbook, "sections", empty_map)
    for op in operations:
        section_name = _core_get(op, "section", "")
        has_section_name = _core_ne(section_name, "")
        if has_section_name:
            section_exists = _core_map_contains(sections, section_name)
            missing_section = _core_not(section_exists)
            if missing_section:
                if allow_dynamic:
                    new_section_list = []
                    sections[section_name] = new_section_list
                else:
                    pass
            else:
                pass
            section_now_exists = _core_map_contains(sections, section_name)
            if section_now_exists:
                section = _core_get(sections, section_name, None)
                op_type = _core_get(op, "type", "")
                is_add = _core_eq(op_type, "ADD")
                if is_add:
                    raw_content = _core_get(op, "content", "")
                    content = str(raw_content).strip()
                    has_content = _core_ne(content, "")
                    if has_content:
                        section_len = _core_len(section)
                        at_capacity_raw = _core_gte(section_len, max_section_size)
                        at_capacity = False
                        if has_max:
                            if at_capacity_raw:
                                at_capacity = True
                            else:
                                pass
                        else:
                            pass
                        proceed = True
                        if at_capacity:
                            if enable_auto_prune:
                                prune_result = _ace_prune_section_for_addition(section, protected_ids)
                                pruned = _core_get(prune_result, "pruned", None)
                                has_pruned = _core_is_not_none(pruned)
                                if has_pruned:
                                    pruned_section = _core_get(prune_result, "section", None)
                                    section = pruned_section
                                    sections[section_name] = section
                                    pruned_id = _core_get(pruned, "id", "")
                                    updated_bullets.append(pruned_id)
                                    removal = {}
                                    removal["type"] = "REMOVE"
                                    removal["section"] = section_name
                                    removal["bulletId"] = pruned_id
                                    pruned_metadata = _core_get(pruned, "metadata", empty_map)
                                    removal_metadata = _core_map_merge(empty_map, pruned_metadata)
                                    removal_metadata["autoPruned"] = True
                                    removal_metadata["removedAt"] = now
                                    removal["metadata"] = removal_metadata
                                    auto_removed.append(removal)
                                else:
                                    proceed = False
                            else:
                                proceed = False
                        else:
                            pass
                        if proceed:
                            op_bullet_id = _core_get(op, "bulletId", None)
                            has_bullet_id = _core_is_not_none(op_bullet_id)
                            bullet_id = op_bullet_id
                            missing_bullet_id = _core_not(has_bullet_id)
                            if missing_bullet_id:
                                bullet_id = section_name
                            else:
                                pass
                            bullet = {}
                            bullet["id"] = bullet_id
                            bullet["section"] = section_name
                            bullet["content"] = content
                            bullet["helpfulCount"] = 0
                            bullet["harmfulCount"] = 0
                            bullet["createdAt"] = now
                            bullet["updatedAt"] = now
                            op_metadata = _core_get(op, "metadata", None)
                            has_metadata = _core_is_not_none(op_metadata)
                            if has_metadata:
                                bullet_metadata = _core_map_merge(empty_map, op_metadata)
                                bullet["metadata"] = bullet_metadata
                            else:
                                pass
                            section.append(bullet)
                            sections[section_name] = section
                            updated_bullets.append(bullet_id)
                        else:
                            pass
                    else:
                        pass
                else:
                    pass
                is_update = _core_eq(op_type, "UPDATE")
                if is_update:
                    target_id = _core_get(op, "bulletId", None)
                    for bullet in section:
                        candidate_bullet_id = _core_get(bullet, "id", "")
                        bullet_match = _core_eq(candidate_bullet_id, target_id)
                        if bullet_match:
                            op_content = _core_get(op, "content", None)
                            content_is_string = _core_type_is(op_content, "string")
                            if content_is_string:
                                bullet["content"] = op_content
                            else:
                                pass
                            bullet["updatedAt"] = now
                            op_metadata_update = _core_get(op, "metadata", None)
                            has_metadata_update = _core_is_not_none(op_metadata_update)
                            if has_metadata_update:
                                existing_metadata = _core_get(bullet, "metadata", empty_map)
                                merged_metadata = _core_map_merge(existing_metadata, op_metadata_update)
                                bullet["metadata"] = merged_metadata
                            else:
                                pass
                            bullet_id_update = _core_get(bullet, "id", "")
                            updated_bullets.append(bullet_id_update)
                        else:
                            pass
                else:
                    pass
                is_remove = _core_eq(op_type, "REMOVE")
                if is_remove:
                    remove_id = _core_get(op, "bulletId", None)
                    kept = []
                    none_value = _core_none()
                    removed_id = none_value
                    for bullet in section:
                        remove_candidate_id = _core_get(bullet, "id", "")
                        bullet_remove_match = _core_eq(remove_candidate_id, remove_id)
                        if bullet_remove_match:
                            removed_id = remove_candidate_id
                        else:
                            kept.append(bullet)
                    sections[section_name] = kept
                    did_remove = _core_is_not_none(removed_id)
                    if did_remove:
                        updated_bullets.append(removed_id)
                    else:
                        pass
                else:
                    pass
            else:
                pass
        else:
            pass
    playbook["sections"] = sections
    recomputed = _ace_recompute_playbook_stats(playbook)
    recomputed["updatedAt"] = now
    out = {}
    out["playbook"] = recomputed
    out["updatedBulletIds"] = updated_bullets
    out["autoRemoved"] = auto_removed
    return out


def _ace_is_noop_acknowledgment(content: str) -> bool:
    _core_coverage_mark("_ace_is_noop_acknowledgment")
    lowered = _core_string_lower(content)
    c = str(lowered).strip()
    is_noop = False
    empty = _core_eq(c, "")
    nonempty = _core_not(empty)
    if nonempty:
        markers = []
        markers.append("no-op")
        markers.append("noop")
        for marker in markers:
            marker_hit = _core_string_starts_with(c, marker)
            if marker_hit:
                is_noop = True
            else:
                pass
        subjects = []
        subjects.append("no update")
        subjects.append("no updates")
        subjects.append("no change")
        subjects.append("no changes")
        subjects.append("no modification")
        subjects.append("no modifications")
        subjects.append("no edit")
        subjects.append("no edits")
        subjects.append("no revision")
        subjects.append("no revisions")
        subjects.append("no action")
        subjects.append("no adjustment")
        subjects.append("no adjustments")
        subjects.append("no new")
        subjects.append("no additional")
        subjects.append("no further")
        has_subject = False
        for subject in subjects:
            subject_hit = _core_contains(c, subject)
            if subject_hit:
                has_subject = True
            else:
                pass
        if has_subject:
            qualifiers = []
            qualifiers.append("needed")
            qualifiers.append("required")
            qualifiers.append("necessary")
            qualifiers.append("warranted")
            for qualifier in qualifiers:
                qualifier_hit = _core_contains(c, qualifier)
                if qualifier_hit:
                    is_noop = True
                else:
                    pass
        else:
            pass
        phrases = []
        phrases.append("nothing to add")
        phrases.append("nothing to change")
        phrases.append("nothing to update")
        phrases.append("nothing to modify")
        phrases.append("nothing to revise")
        phrases.append("nothing needs")
        phrases.append("nothing further")
        for phrase in phrases:
            phrase_hit = _core_contains(c, phrase)
            if phrase_hit:
                is_noop = True
            else:
                pass
        keep_prefixes = []
        keep_prefixes.append("keep the existing")
        keep_prefixes.append("leave the existing")
        keep_prefixes.append("retain the existing")
        keep_prefixes.append("preserve the existing")
        has_keep_prefix = False
        for keep_prefix in keep_prefixes:
            keep_hit = _core_string_starts_with(c, keep_prefix)
            if keep_hit:
                has_keep_prefix = True
            else:
                pass
        if has_keep_prefix:
            stasis_list = []
            stasis_list.append("unchanged")
            stasis_list.append("as is")
            stasis_list.append("as-is")
            stasis_list.append("intact")
            stasis_list.append("in place")
            for stasis in stasis_list:
                stasis_hit = _core_contains(c, stasis)
                if stasis_hit:
                    is_noop = True
                else:
                    pass
        else:
            pass
        remains_list = []
        remains_list.append("remains correct")
        remains_list.append("remains unchanged")
        remains_list.append("remains the same")
        remains_list.append("remains valid")
        remains_list.append("remains accurate")
        remains_list.append("already correct")
        has_remains = False
        for remains in remains_list:
            remains_hit = _core_contains(c, remains)
            if remains_hit:
                has_remains = True
            else:
                pass
        if has_remains:
            referents = []
            referents.append("existing")
            referents.append("current")
            referents.append("rule")
            referents.append("guideline")
            referents.append("guidance")
            referents.append("playbook")
            referents.append("bullet")
            referents.append("entry")
            for referent in referents:
                referent_hit = _core_contains(c, referent)
                if referent_hit:
                    is_noop = True
                else:
                    pass
        else:
            pass
    else:
        pass
    return is_noop


def _ace_normalize_curator_operations(operations: Any) -> list[Any]:
    _core_coverage_mark("_ace_normalize_curator_operations")
    empty_list = []
    has_operations = _core_is_not_none(operations)
    missing = _core_not(has_operations)
    if missing:
        return empty_list
    else:
        pass
    is_list = _core_type_is(operations, "list")
    if is_list:
        normalized = []
        seen = {}
        for entry in operations:
            is_object = _core_type_is(entry, "object")
            if is_object:
                type_raw = _core_get(entry, "type", "ADD")
                type_is_string = _core_type_is(type_raw, "string")
                type_lower = "add"
                if type_is_string:
                    lowered = _core_string_lower(type_raw)
                    type_lower = lowered
                else:
                    pass
                is_update = _core_eq(type_lower, "update")
                is_remove = _core_eq(type_lower, "remove")
                type = "ADD"
                if is_update:
                    type = "UPDATE"
                else:
                    pass
                if is_remove:
                    type = "REMOVE"
                else:
                    pass
                section_raw = _core_get(entry, "section", "Guidelines")
                section_is_string = _core_type_is(section_raw, "string")
                section = "Guidelines"
                if section_is_string:
                    section_trimmed = str(section_raw).strip()
                    section_nonempty = _core_ne(section_trimmed, "")
                    if section_nonempty:
                        section = section_trimmed
                    else:
                        pass
                else:
                    pass
                content_raw = _core_get(entry, "content", "")
                content_is_string = _core_type_is(content_raw, "string")
                content = ""
                if content_is_string:
                    content_trimmed = str(content_raw).strip()
                    content = content_trimmed
                else:
                    pass
                not_remove = _core_ne(type, "REMOVE")
                content_empty = _core_eq(content, "")
                keep = True
                if not_remove:
                    if content_empty:
                        keep = False
                    else:
                        pass
                else:
                    pass
                is_add_type = _core_eq(type, "ADD")
                if is_add_type:
                    is_noop = _ace_is_noop_acknowledgment(content)
                    if is_noop:
                        keep = False
                    else:
                        pass
                else:
                    pass
                if keep:
                    bullet_id_raw = _core_get(entry, "bulletId", None)
                    has_bullet_id_field = _core_is_not_none(bullet_id_raw)
                    bullet_id_source = bullet_id_raw
                    if has_bullet_id_field:
                        pass
                    else:
                        id_field = _core_get(entry, "id", None)
                        bullet_id_source = id_field
                    bullet_id_is_string = _core_type_is(bullet_id_source, "string")
                    none_value = _core_none()
                    bullet_id = none_value
                    if bullet_id_is_string:
                        bullet_id_trimmed = str(bullet_id_source).strip()
                        bullet_id_nonempty = _core_ne(bullet_id_trimmed, "")
                        if bullet_id_nonempty:
                            bullet_id = bullet_id_trimmed
                        else:
                            pass
                    else:
                        pass
                    bullet_id_key = ""
                    has_bullet_id = _core_is_not_none(bullet_id)
                    if has_bullet_id:
                        bullet_id_key = bullet_id
                    else:
                        pass
                    key_a = _core_string_format("{}:{}", type, section)
                    key_b = _core_string_format("{}:{}", content, bullet_id_key)
                    key = _core_string_format("{}:{}", key_a, key_b)
                    already_seen = _core_map_contains(seen, key)
                    fresh = _core_not(already_seen)
                    if fresh:
                        seen[key] = True
                        normalized_entry = {}
                        normalized_entry["type"] = type
                        normalized_entry["section"] = section
                        if not_remove:
                            normalized_entry["content"] = content
                        else:
                            pass
                        if has_bullet_id:
                            normalized_entry["bulletId"] = bullet_id
                        else:
                            pass
                        metadata_raw = _core_get(entry, "metadata", None)
                        metadata_is_object = _core_type_is(metadata_raw, "object")
                        if metadata_is_object:
                            empty_metadata = {}
                            metadata_copy = _core_map_merge(empty_metadata, metadata_raw)
                            normalized_entry["metadata"] = metadata_copy
                        else:
                            pass
                        normalized.append(normalized_entry)
                    else:
                        pass
                else:
                    pass
            else:
                pass
        return normalized
    else:
        pass
    is_string = _core_type_is(operations, "string")
    if is_string:
        parsed = _core_json_parse(operations)
        parsed_is_none = _core_is_none(parsed)
        if parsed_is_none:
            return empty_list
        else:
            pass
        normalized_from_string = _ace_normalize_curator_operations(parsed)
        return normalized_from_string
    else:
        pass
    is_object = _core_type_is(operations, "object")
    if is_object:
        inner = _core_get(operations, "operations", None)
        has_inner = _core_is_not_none(inner)
        if has_inner:
            normalized_from_object = _ace_normalize_curator_operations(inner)
            return normalized_from_object
        else:
            pass
        return empty_list
    else:
        pass
    return empty_list


def _ace_locate_bullet_section(playbook: Any, bullet_id: str) -> Any:
    _core_coverage_mark("_ace_locate_bullet_section")
    empty_map = {}
    sections = _core_get(playbook, "sections", empty_map)
    section_names = _core_map_keys(sections)
    none_value = _core_none()
    found = none_value
    for section_name in section_names:
        already = _core_is_not_none(found)
        still_open = _core_not(already)
        if still_open:
            bullets = _core_get(sections, section_name, None)
            for bullet in bullets:
                open = _core_is_none(found)
                if open:
                    current_id = _core_get(bullet, "id", "")
                    match = _core_eq(current_id, bullet_id)
                    if match:
                        hit = {}
                        hit["section"] = section_name
                        hit["id"] = current_id
                        found = hit
                    else:
                        pass
                else:
                    pass
        else:
            pass
    return found


def _ace_resolve_curator_operation_targets(operations: Any, playbook: Any, reflection: Any, generator_output: Any) -> list[Any]:
    _core_coverage_mark("_ace_resolve_curator_operation_targets")
    op_count = _core_len(operations)
    is_empty = _core_eq(op_count, 0)
    if is_empty:
        return operations
    else:
        pass
    used_ids = {}
    for op in operations:
        existing_bullet_id = _core_get(op, "bulletId", None)
        has_existing = _core_is_not_none(existing_bullet_id)
        if has_existing:
            existing_is_string = _core_type_is(existing_bullet_id, "string")
            if existing_is_string:
                used_ids[existing_bullet_id] = True
            else:
                pass
        else:
            pass
    section_queues = {}
    empty_list = []
    reflection_present = _core_is_not_none(reflection)
    if reflection_present:
        bullet_tags = _core_get(reflection, "bulletTags", empty_list)
        for tag in bullet_tags:
            tag_id = _core_get(tag, "id", None)
            tag_id_is_string = _core_type_is(tag_id, "string")
            if tag_id_is_string:
                already_used = _core_map_contains(used_ids, tag_id)
                not_used = _core_not(already_used)
                if not_used:
                    located = _ace_locate_bullet_section(playbook, tag_id)
                    located_found = _core_is_not_none(located)
                    if located_found:
                        located_section = _core_get(located, "section", None)
                        located_id = _core_get(located, "id", None)
                        tag_value = _core_get(tag, "tag", "")
                        is_harmful = _core_eq(tag_value, "harmful")
                        priority = "primary"
                        if is_harmful:
                            priority = "harmful"
                        else:
                            pass
                        has_queue = _core_map_contains(section_queues, located_section)
                        missing_queue = _core_not(has_queue)
                        if missing_queue:
                            new_queue = {}
                            harmful_list = []
                            new_queue["harmful"] = harmful_list
                            primary_list = []
                            new_queue["primary"] = primary_list
                            generator_list = []
                            new_queue["generator"] = generator_list
                            section_queues[located_section] = new_queue
                        else:
                            pass
                        queue = _core_get(section_queues, located_section, None)
                        priority_list = _core_get(queue, priority, None)
                        priority_list.append(located_id)
                        queue[priority] = priority_list
                        section_queues[located_section] = queue
                    else:
                        pass
                else:
                    pass
            else:
                pass
    else:
        pass
    generator_present = _core_is_not_none(generator_output)
    if generator_present:
        generator_bullet_ids = _core_get(generator_output, "bulletIds", empty_list)
        for bullet_id in generator_bullet_ids:
            gen_id_is_string = _core_type_is(bullet_id, "string")
            if gen_id_is_string:
                gen_already_used = _core_map_contains(used_ids, bullet_id)
                gen_not_used = _core_not(gen_already_used)
                if gen_not_used:
                    gen_located = _ace_locate_bullet_section(playbook, bullet_id)
                    gen_found = _core_is_not_none(gen_located)
                    if gen_found:
                        gen_section = _core_get(gen_located, "section", None)
                        gen_located_id = _core_get(gen_located, "id", None)
                        gen_has_queue = _core_map_contains(section_queues, gen_section)
                        gen_missing_queue = _core_not(gen_has_queue)
                        if gen_missing_queue:
                            gen_new_queue = {}
                            gen_harmful = []
                            gen_new_queue["harmful"] = gen_harmful
                            gen_primary = []
                            gen_new_queue["primary"] = gen_primary
                            gen_generator = []
                            gen_new_queue["generator"] = gen_generator
                            section_queues[gen_section] = gen_new_queue
                        else:
                            pass
                        gen_queue = _core_get(section_queues, gen_section, None)
                        gen_generator_list = _core_get(gen_queue, "generator", None)
                        gen_generator_list.append(gen_located_id)
                        gen_queue["generator"] = gen_generator_list
                        section_queues[gen_section] = gen_queue
                    else:
                        pass
                else:
                    pass
            else:
                pass
    else:
        pass
    resolved = []
    for op in operations:
        op_type = _core_get(op, "type", "")
        op_is_update = _core_eq(op_type, "UPDATE")
        op_is_remove = _core_eq(op_type, "REMOVE")
        needs_target = _core_or(op_is_update, op_is_remove)
        current_bullet_id = _core_get(op, "bulletId", None)
        has_bullet_id = _core_is_not_none(current_bullet_id)
        missing_bullet_id = _core_not(has_bullet_id)
        empty_op = {}
        resolved_op = _core_map_merge(empty_op, op)
        if needs_target:
            if missing_bullet_id:
                op_section = _core_get(op, "section", "")
                candidate = _ace_dequeue_section_candidate(section_queues, op_section, used_ids, playbook)
                candidate_found = _core_is_not_none(candidate)
                if candidate_found:
                    resolved_op["bulletId"] = candidate
                    used_ids[candidate] = True
                else:
                    pass
            else:
                pass
        else:
            pass
        final_bullet_id = _core_get(resolved_op, "bulletId", None)
        final_has_bullet_id = _core_is_not_none(final_bullet_id)
        keep = True
        if needs_target:
            keep = final_has_bullet_id
        else:
            pass
        if keep:
            resolved.append(resolved_op)
        else:
            pass
    return resolved


def _ace_dequeue_section_candidate(section_queues: Any, section: str, used_ids: Any, playbook: Any) -> Any:
    _core_coverage_mark("_ace_dequeue_section_candidate")
    none_value = _core_none()
    picked = none_value
    has_queue = _core_map_contains(section_queues, section)
    if has_queue:
        queue = _core_get(section_queues, section, None)
        empty_list = []
        harmful_list = _core_get(queue, "harmful", empty_list)
        for candidate in harmful_list:
            open = _core_is_none(picked)
            if open:
                used = _core_map_contains(used_ids, candidate)
                not_used = _core_not(used)
                if not_used:
                    picked = candidate
                else:
                    pass
            else:
                pass
        primary_list = _core_get(queue, "primary", empty_list)
        for candidate in primary_list:
            open = _core_is_none(picked)
            if open:
                used = _core_map_contains(used_ids, candidate)
                not_used = _core_not(used)
                if not_used:
                    picked = candidate
                else:
                    pass
            else:
                pass
        generator_list = _core_get(queue, "generator", empty_list)
        for candidate in generator_list:
            open = _core_is_none(picked)
            if open:
                used = _core_map_contains(used_ids, candidate)
                not_used = _core_not(used)
                if not_used:
                    picked = candidate
                else:
                    pass
            else:
                pass
    else:
        pass
    still_open = _core_is_none(picked)
    if still_open:
        empty_map = {}
        sections = _core_get(playbook, "sections", empty_map)
        fallback_bullets = _core_get(sections, section, None)
        fallback_present = _core_is_not_none(fallback_bullets)
        if fallback_present:
            for bullet in fallback_bullets:
                open = _core_is_none(picked)
                if open:
                    bullet_id = _core_get(bullet, "id", "")
                    used = _core_map_contains(used_ids, bullet_id)
                    not_used = _core_not(used)
                    if not_used:
                        picked = bullet_id
                    else:
                        pass
                else:
                    pass
        else:
            pass
    else:
        pass
    return picked

# END AXIR CORE EMITTED FUNCTIONS
