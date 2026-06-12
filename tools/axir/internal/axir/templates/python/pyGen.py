from __future__ import annotations
import os

import json
import re
import time
from typing import Any

from .ai import AIClient, chat_response_to_completion
from .prompt import AxPromptTemplate
from .schema import strip_internal, validate_fields, validate_output
from .signature import AxSignature
# AXIR_CORE_IMPORTS


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


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_lower(value):
    return str(value).lower()


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


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
