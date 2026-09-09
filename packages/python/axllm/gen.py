from __future__ import annotations
import os

import copy
import inspect
import math
import json
import re
import time
from typing import Any

from .ai import (
    _core_math_floor,
    AIClient,
    AxAIServiceAbortedError,
    AxCancellationToken,
    AxMeter,
    AxRateLimiter,
    AxRuntimeHooks,
    AxTracer,
    _coerce_runtime_hooks,
    _merge_runtime_hooks,
    _runtime_hook_scope,
    _runtime_hooks_from_options,
    _strip_runtime_hooks,
    chat_response_to_completion,
    ai_merge_replay_metadata,
)
from .prompt import AxPromptTemplate, _core_string_split
from .schema import AxValidationError, strip_internal, validate_fields, validate_output
from .signature import AxSignature, _core_string_replace
from .mcp import resolve_execution_context
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
                item["response"] = ai_merge_replay_metadata(existing.get("response") or {}, result)
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
    for key in ("function_calls", "functionCalls", "tool_calls", "toolCalls", "thought_blocks", "thoughtBlocks", "images"):
        value = response.get(key)
        if isinstance(value, list) and value:
            return True
    return response.get("audio") is not None


class AxGen:
    def owned_worker_factory(self):
        if self.execution_context is not None: return None
        memo = {id(self.runtime_hooks):self.runtime_hooks}
        try: snapshot = copy.deepcopy(self, dict(memo))
        except (TypeError, ValueError): return None
        return lambda: copy.deepcopy(snapshot, dict(memo))

    def __init__(self, signature, options: dict[str, Any] | None = None, hooks: AxRuntimeHooks | None = None):
        self.signature = signature if isinstance(signature, AxSignature) else AxSignature(signature)
        self.runtime_hooks = _merge_runtime_hooks(_coerce_runtime_hooks(hooks), _runtime_hooks_from_options(options))
        self.options = _strip_runtime_hooks(options)
        self._base_functions = list(self.options.get("functions") or [])
        self.execution_context = resolve_execution_context(self.options)
        self.functions = self._base_functions + (self.execution_context.native_tools() if self.execution_context else [])
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

    def set_rate_limiter(self, limiter: AxRateLimiter | None):
        self.runtime_hooks = AxRuntimeHooks(limiter, self.runtime_hooks.tracer, self.runtime_hooks.meter)
        return self

    def set_tracer(self, tracer: AxTracer | None):
        self.runtime_hooks = AxRuntimeHooks(self.runtime_hooks.rate_limiter, tracer, self.runtime_hooks.meter)
        return self

    def set_meter(self, meter: AxMeter | None):
        self.runtime_hooks = AxRuntimeHooks(self.runtime_hooks.rate_limiter, self.runtime_hooks.tracer, meter)
        return self

    def set_examples(self, examples):
        self.examples = list(examples or [])
        self.options["has_example_demonstrations"] = bool(self.examples or self.demos)
        return self

    def set_demos(self, demos):
        self.demos = list(demos or [])
        self.options["has_example_demonstrations"] = bool(self.examples or self.demos)
        return self

    def set_sample_count(self, sample_count: int):
        self.options["sample_count"] = int(sample_count)
        return self

    def set_result_picker(self, result_picker):
        self.options["result_picker"] = result_picker
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

    def forward(
        self,
        client: AIClient,
        values: dict[str, Any],
        options: dict[str, Any] | None = None,
        hooks: AxRuntimeHooks | None = None,
    ):
        call_hooks = _merge_runtime_hooks(_coerce_runtime_hooks(hooks), _runtime_hooks_from_options(options))
        with _runtime_hook_scope(
            call_hooks,
            self.runtime_hooks,
            span_name="ax_gen_forward",
            attributes={"ax.program.id": self.program_id, "ax.program.type": "AxGen"},
        ):
            return self._forward_unscoped(client, values, _strip_runtime_hooks(options))

    def _forward_unscoped(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        call_context = resolve_execution_context(options, self.execution_context)
        if call_context is not self.execution_context:
            call_gen = copy.copy(self)
            call_gen.execution_context = call_context
            call_gen.functions = self._base_functions + (call_context.native_tools() if call_context else [])
            call_gen.prompt_template = AxPromptTemplate(
                self.signature,
                functions=call_gen.functions,
                structured_output_function_name=self.options.get("structured_output_function_name", self.options.get("structuredOutputFunctionName")),
                custom_template=self.options.get("custom_template", self.options.get("customTemplate")),
            )
            if self.instruction:
                call_gen.prompt_template.set_instruction(self.instruction)
            return call_gen._forward_unscoped(client, values, options)
        run_options = {**self.options, **(options or {})}
        model = str(run_options.get("model") or getattr(client, "model", ""))
        session_enabled = (chat_session_mode_enabled(run_options)
            and (callable(getattr(client, "_pin_chat_run", None)) or
                 (callable(getattr(client, "open_chat_session", None)) and
                  bool(getattr(client, "get_features", lambda model=None: {})(model or None).get("asyncTools"))))
            and (run_options.get("control") is not None or any(getattr(tool, "execution", "blocking") == "background" for tool in self.functions)))
        if session_enabled:
            from .session import _SessionClient
            pinned = _SessionClient(self, client, run_options)
            try:
                result = self._forward_unscoped(pinned, values, {**run_options, "asyncMode": "off", "async_mode": "off", "infraRetries": 0, "infra_retries": 0})
            except BaseException as error:
                pinned.close(error)
                raise
            pinned.close()
            return result
        from .session import _BoundaryClient
        if run_options.get("control") is not None and not isinstance(client, (_BoundaryClient,)):
            from .session import _SessionClient
            if not isinstance(client, _SessionClient):
                bounded = _BoundaryClient(client, run_options)
                try:
                    result = self._forward_unscoped(bounded, values, run_options)
                except BaseException as error:
                    bounded.close(error)
                    raise
                bounded.close()
                return result
        return _forward_impl(self, client, values, options)

    def streaming_forward(
        self,
        client: AIClient,
        values: dict[str, Any],
        options: dict[str, Any] | None = None,
        hooks: AxRuntimeHooks | None = None,
    ):
        call_hooks = _merge_runtime_hooks(_coerce_runtime_hooks(hooks), _runtime_hooks_from_options(options))
        with _runtime_hook_scope(
            call_hooks,
            self.runtime_hooks,
            span_name="ax_gen_forward",
            attributes={"ax.program.id": self.program_id, "ax.program.type": "AxGen", "ax.streaming": True},
        ):
            yield from self._streaming_forward_unscoped(client, values, _strip_runtime_hooks(options))

    def _streaming_forward_unscoped(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        run_options = {**self.options, **(options or {})}
        model = str(run_options.get("model") or getattr(client, "model", ""))
        session_enabled = (chat_session_mode_enabled(run_options)
            and (callable(getattr(client, "_pin_chat_run", None)) or
                 (callable(getattr(client, "open_chat_session", None)) and
                  bool(getattr(client, "get_features", lambda model=None: {})(model or None).get("asyncTools"))))
            and (run_options.get("control") is not None or any(getattr(tool, "execution", "blocking") == "background" for tool in self.functions)))
        if session_enabled:
            import contextvars
            import queue
            import threading
            from .session import run_control
            deliveries = queue.Queue()
            control = run_options.get("control") or run_control()
            stopped = threading.Event()
            def emit(event):
                if not stopped.is_set():
                    deliveries.put(("delta", event))
            def run():
                try:
                    self._forward_unscoped(client, values, {**run_options, "control": control, "_session_delta": emit})
                    deliveries.put(("done", None))
                except BaseException as error:
                    deliveries.put(("error", error))
            context = contextvars.copy_context()
            threading.Thread(target=context.run, args=(run,), daemon=True).start()
            complete = False
            try:
                while True:
                    kind, event = deliveries.get()
                    if kind == "error":
                        raise event
                    if kind == "done":
                        complete = True
                        return
                    yield event
            finally:
                stopped.set()
                if not complete:
                    control.abort()
            return
        call_context = resolve_execution_context(options, self.execution_context)
        if call_context is not self.execution_context:
            call_gen = copy.copy(self)
            call_gen.execution_context = call_context
            call_gen.functions = self._base_functions + (call_context.native_tools() if call_context else [])
            call_gen.prompt_template = AxPromptTemplate(self.signature, functions=call_gen.functions)
            yield from call_gen._streaming_forward_unscoped(client, values, {**(options or {}), "executionContext": call_context})
            return
        validate_fields(self.signature.get_input_fields(), values, "input")
        stream_options = {**self.options, **(options or {}), "stream": True}
        req = self._request(self.prompt_template.render(values), stream_options, client)
        chunks = []
        for event in client.stream(req, stream_options):
            chunks.append(event)
            _core_axgen_run_streaming_assertions(self, fold_stream(chunks))
            yield event
        content = fold_stream(chunks)
        _core_axgen_run_streaming_assertions(self, content)
        if content:
            output = _parse_output_impl(content)
            validate_output(self.signature.get_output_fields(), output)

    def _request(self, messages, options, client=None):
        request_options = options or {}
        features = _core_ai_client_features(client, request_options.get("model")) if client is not None else {}
        selection = _select_structured_output_rung(self.signature, features, request_options)
        return _build_gen_chat_request(self, messages, request_options, selection)

    def _execute_tool(self, call):
        return _execute_tool_call(self.functions, call)


def ax(
    signature,
    options: dict[str, Any] | None = None,
    *,
    sample_count: int | None = None,
    result_picker=None,
    hooks: AxRuntimeHooks | None = None,
) -> AxGen:
    normalized = dict(options or {})
    if sample_count is not None:
        normalized["sample_count"] = int(sample_count)
    if result_picker is not None:
        normalized["result_picker"] = result_picker
    return AxGen(signature, normalized, hooks=hooks)


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
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
def _core_string_utf16_units(value):
    raw = value.encode("utf-16-le", "surrogatepass")
    return [raw[index] + 256 * raw[index + 1] for index in range(0, len(raw), 2)]

def _core_string_codepoint_length(value): return len(value)

def _core_math_is_finite(value): return math.isfinite(value)

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
    if str(method_name) == "call" and callable(target):
        payload = args[0] if args else None
        if isinstance(payload, dict) and payload.get("type") == "fields":
            return target(payload.get("results") or [])
        return target(*args)
    return getattr(target, str(method_name))(*args)


def _core_json_parse(value):
    text = str(value).strip()
    fence = chr(96) * 3
    if text.startswith(fence):
        text = text.strip(chr(96))
        if text.startswith("json"):
            text = text[4:].strip()
    return json.loads(text)


def _core_json_parse_strict(value):
    return json.loads(str(value).strip())


def _core_json_stringify(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


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


def _core_string_slice(value, start, end=None):
    return str(value)[int(start):None if end is None else int(end)]


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_default_if_empty(value, fallback):
    text = str(value or "").strip()
    return text if text else fallback


def _core_ai_complete_once(client, request, options):
    chat = getattr(client, "chat", None)
    if callable(chat):
        try:
            parameters = inspect.signature(chat).parameters.values()
            accepts_options = (
                len(inspect.signature(chat).parameters) >= 2
                or any(
                    parameter.kind
                    in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
                    for parameter in parameters
                )
            )
        except (TypeError, ValueError):
            accepts_options = False
        response = chat(request, options or {}) if accepts_options else chat(request)
        return chat_response_to_completion(response)
    complete = getattr(client, "complete", None)
    if callable(complete):
        return complete(request)
    raise TypeError("AI client must implement chat() or complete()")


def _core_ai_client_features(client, model):
    get_features = getattr(client, "get_features", None)
    if callable(get_features):
        return get_features(None if model is None else str(model)) or {}
    return {"functions": True, "structured_outputs": True}


def _core_retry_sleep(attempt, _client=None, options=None):
    delay = min(0.25 * (int(attempt) + 1), 1.0)
    token = None
    if isinstance(options, dict):
        token = options.get("cancellation") or options.get("cancellationToken") or options.get("cancellation_token")
    if token is None:
        time.sleep(delay)
        return
    if not isinstance(token, AxCancellationToken):
        raise TypeError("cancellation must be an AxCancellationToken")
    token.wait(delay)
    token.throw_if_cancelled()


def _core_exception_message(error):
    return str(error)


def _core_exception_is_aborted(error):
    return isinstance(error, AxAIServiceAbortedError)


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(pattern, value) is not None


def _core_runtime_error(message):
    return RuntimeError(str(message))


def _core_validation_error(message):
    return AxValidationError(str(message))


def _core_tool_invoke(fn, params, context=None):
    name = str(getattr(fn, "name", "") or "tool")
    with _runtime_hook_scope(
        None,
        None,
        span_name="ax_gen_tool",
        attributes={"ax.tool.name": name},
        metric_prefix="ax_gen_tool",
    ):
        return fn.call(params or {}, context) if context is not None else fn.call(params or {})


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
        "thought": _core_get(response, "thought"),
        "thought_blocks": _core_get(response, "thought_blocks", []),
        "providerMetadata": _core_get(request, "provider_metadata", {}),
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
def chat_session_mode_enabled(options: Any) -> bool:
    _core_coverage_mark("chat_session_mode_enabled")
    mode_snake = _core_get(options, "async_mode", "auto")
    mode = _core_get(options, "asyncMode", mode_snake)
    disabled = _core_eq(mode, "off")
    function_snake = _core_get(options, "function_call_mode", "auto")
    function_mode = _core_get(options, "functionCallMode", function_snake)
    prompt = _core_eq(function_mode, "prompt")
    legacy = _core_or(disabled, prompt)
    enabled = _core_not(legacy)
    return enabled


def fold_stream(events: list[Any]) -> str:
    _core_coverage_mark("fold_stream")
    chunks = []
    for event in events:
        empty_results = []
        results = _core_get(event, "results", empty_results)
        for result in results:
            finish_snake = _core_get(result, "finish_reason", None)
            finish = _core_get(result, "finishReason", finish_snake)
            is_length = _core_eq(finish, "length")
            if is_length:
                raise RuntimeError("Max tokens reached before completion")
            else:
                pass
            is_error = _core_eq(finish, "error")
            if is_error:
                raise RuntimeError("Streaming response failed")
            else:
                pass
        parts = _stream_event_content_parts_impl(event)
        for part in parts:
            chunks.append(part)
    folded = _core_string_join("", chunks)
    return folded


def _select_structured_output_rung(signature: AxSignature, features: Any, options: Any) -> Any:
    _core_coverage_mark("_select_structured_output_rung")
    native_snake = _core_get(features, "structured_outputs", None)
    native_raw = _core_get(features, "structuredOutputs", native_snake)
    modes_snake = _core_get(features, "structured_output_modes", None)
    modes = _core_get(features, "structuredOutputModes", modes_snake)
    has_modes = _core_is_not_none(modes)
    native_missing = _core_is_none(native_raw)
    supports_native = True
    if native_missing:
        supports_native = True
    else:
        supports_native = _core_truthy(native_raw)
    functions_raw = _core_get(features, "functions", None)
    functions_missing = _core_is_none(functions_raw)
    supports_functions = True
    if functions_missing:
        supports_functions = True
    else:
        supports_functions = _core_truthy(functions_raw)
    supports_json_object = True
    if has_modes:
        supports_native = False
        supports_functions = False
        supports_json_object = False
        for candidate_mode in modes:
            candidate_native = _core_eq(candidate_mode, "native")
            if candidate_native:
                supports_native = True
            else:
                pass
            candidate_function = _core_eq(candidate_mode, "function")
            if candidate_function:
                supports_functions = True
            else:
                pass
            candidate_json_object = _core_eq(candidate_mode, "json_object")
            if candidate_json_object:
                supports_json_object = True
            else:
                pass
    else:
        pass
    mode_snake = _core_get(options, "structured_output_mode", None)
    mode = _core_get(options, "structuredOutputMode", mode_snake)
    mode_missing = _core_is_none(mode)
    if mode_missing:
        mode = "auto"
    else:
        pass
    selection = {}
    explicit_native = _core_eq(mode, "native")
    if explicit_native:
        unsupported_native = _core_not(supports_native)
        if unsupported_native:
            raise RuntimeError("Structured output mode 'native' requires native JSON Schema support")
        else:
            pass
        selection["rung"] = "native"
        return selection
    else:
        pass
    explicit_function = _core_eq(mode, "function")
    if explicit_function:
        unsupported_functions = _core_not(supports_functions)
        if unsupported_functions:
            raise RuntimeError("Structured output mode 'function' requires function calling support")
        else:
            pass
        selection["rung"] = "function"
        return selection
    else:
        pass
    explicit_json_object = _core_eq(mode, "json_object")
    if explicit_json_object:
        unsupported_json_object = _core_not(supports_json_object)
        if unsupported_json_object:
            raise RuntimeError("Structured output mode 'json_object' requires JSON object response-format support")
        else:
            pass
        selection["rung"] = "json_object"
        return selection
    else:
        pass
    if has_modes:
        mode_count = _core_len(modes)
        no_modes = _core_eq(mode_count, 0)
        if no_modes:
            raise RuntimeError("Structured output is not verified for the selected provider and model")
        else:
            pass
    else:
        if supports_native:
            selection["rung"] = "native"
            return selection
        else:
            pass
    output_fields = _core_get(signature, "output_fields", None)
    visible_fields = []
    for field in output_fields:
        internal_snake = _core_get(field, "is_internal", False)
        internal = _core_get(field, "isInternal", internal_snake)
        visible = _core_not(internal)
        if visible:
            visible_fields.append(field)
        else:
            pass
    visible_count = _core_len(visible_fields)
    singleton = _core_eq(visible_count, 1)
    only_field = _core_list_get(visible_fields, 0, selection)
    optional_snake = _core_get(only_field, "is_optional", False)
    optional = _core_get(only_field, "isOptional", optional_snake)
    required = _core_not(optional)
    field_type = _core_get(only_field, "type", None)
    field_type_name = _core_get(field_type, "name", None)
    is_string = _core_eq(field_type_name, "string")
    is_code = _core_eq(field_type_name, "code")
    string_or_code = _core_or(is_string, is_code)
    not_array_snake = _core_get(field_type, "is_array", False)
    is_array = _core_get(field_type, "isArray", not_array_snake)
    not_array = _core_not(is_array)
    required_singleton = _core_and(singleton, required)
    singleton_string = _core_and(required_singleton, string_or_code)
    simple_shape = _core_and(singleton_string, not_array)
    native_unavailable = _core_not(supports_native)
    json_object_optimization = _core_and(simple_shape, native_unavailable)
    if json_object_optimization:
        if supports_json_object:
            selection["rung"] = "json_object"
            return selection
        else:
            pass
    else:
        pass
    if has_modes:
        preferred_mode = _core_list_get(modes, 0, "")
        selection["rung"] = preferred_mode
        return selection
    else:
        pass
    if supports_functions:
        selection["rung"] = "function"
        return selection
    else:
        pass
    selection["rung"] = "json_object"
    return selection


def _regex_peek(s: Any) -> Any:
    _core_coverage_mark("_regex_peek")
    t1 = _core_get(s, "p", None)
    t2 = _core_get(s, "u", None)
    t3 = _core_len(t2)
    t4 = _core_gte(t1, t3)
    if t4:
        t5 = _core_mul(-1, 1)
        t6 = _core_math_floor(t5)
        return t6
    else:
        pass
    t7 = _core_get(s, "u", None)
    t8 = _core_get(s, "p", None)
    t9 = _core_get(t7, t8, None)
    return t9


def chat_session_validate_required_arguments(schema: Any, arguments: Any, path: str) -> None:
    _core_coverage_mark("chat_session_validate_required_arguments")
    errors = _chat_session_argument_errors(schema, schema, arguments, path, 0)
    count = _core_len(errors)
    invalid = _core_gt(count, 0)
    if invalid:
        message = _core_string_join("; ", errors)
        error = _core_validation_error(message)
        raise error
    else:
        pass
    return None


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


def _regex_take(s: Any) -> Any:
    _core_coverage_mark("_regex_take")
    c = _core_none()
    t1 = _regex_peek(s)
    c = t1
    t2 = _core_get(s, "p", None)
    t3 = _core_add(t2, 1)
    s["p"] = t3
    return c


def stream_extraction_route(has_complex_fields: bool) -> str:
    _core_coverage_mark("stream_extraction_route")
    if has_complex_fields:
        return "structured_json"
    else:
        pass
    return "prompt_extraction"


def _chat_session_argument_equal(left: Any, right: Any, depth: int) -> bool:
    _core_coverage_mark("_chat_session_argument_equal")
    too_deep = _core_gt(depth, 64)
    if too_deep:
        return False
    else:
        pass
    next = _core_add(depth, 1)
    left_list = _core_type_is(left, "list")
    right_list = _core_type_is(right, "list")
    same_list = _core_eq(left_list, right_list)
    if same_list:
        pass
    else:
        return False
    left_object = _core_type_is(left, "object")
    right_object = _core_type_is(right, "object")
    same_object = _core_eq(left_object, right_object)
    if same_object:
        pass
    else:
        return False
    left_string = _core_type_is(left, "string")
    right_string = _core_type_is(right, "string")
    same_string = _core_eq(left_string, right_string)
    if same_string:
        pass
    else:
        return False
    left_number = _core_type_is(left, "number")
    right_number = _core_type_is(right, "number")
    same_number = _core_eq(left_number, right_number)
    if same_number:
        pass
    else:
        return False
    left_boolean = _core_type_is(left, "boolean")
    right_boolean = _core_type_is(right, "boolean")
    same_boolean = _core_eq(left_boolean, right_boolean)
    if same_boolean:
        pass
    else:
        return False
    if left_list:
        left_size = _core_len(left)
        right_size = _core_len(right)
        same_size = _core_eq(left_size, right_size)
        if same_size:
            pass
        else:
            return False
        index = 0
        for value in left:
            other = _core_get(right, index, None)
            same = _chat_session_argument_equal(value, other, next)
            if same:
                pass
            else:
                return False
            index = _core_add(index, 1)
        return True
    else:
        pass
    if left_object:
        left_keys = _core_map_keys(left)
        right_keys = _core_map_keys(right)
        same_keys = _chat_session_argument_equal(left_keys, right_keys, next)
        if same_keys:
            pass
        else:
            return False
        for key in left_keys:
            value = _core_get(left, key, None)
            other = _core_get(right, key, None)
            same = _chat_session_argument_equal(value, other, next)
            if same:
                pass
            else:
                return False
        return True
    else:
        pass
    same = _core_eq(left, right)
    return same


def _regex_digit(c: Any) -> Any:
    _core_coverage_mark("_regex_digit")
    t1 = _core_gte(c, 48)
    t2 = t1
    if t2:
        t3 = _core_lte(c, 57)
        t2 = t3
    else:
        pass
    return t2


def stream_structured_delta(fields: list[Any], parsed_values: Any, previous_values: Any, partial_array_incomplete: bool) -> Any:
    _core_coverage_mark("stream_structured_delta")
    delta = {}
    full_values = {}
    for field in fields:
        key = _core_get(field, "name", "")
        internal_snake = _core_get(field, "is_internal", False)
        is_internal = _core_get(field, "isInternal", internal_snake)
        has_parsed = _core_map_contains(parsed_values, key)
        not_internal = _core_not(is_internal)
        include = _core_and(has_parsed, not_internal)
        if include:
            new_value_raw = _core_get(parsed_values, key, None)
            new_is_list = _core_type_is(new_value_raw, "list")
            new_value = new_value_raw
            if new_is_list:
                new_count_raw = _core_len(new_value_raw)
                has_last = _core_gt(new_count_raw, 0)
                trim_last = _core_and(partial_array_incomplete, has_last)
                if trim_last:
                    trimmed = []
                    keep_count = _core_add(new_count_raw, -1)
                    trim_cursor = 0
                    for item in new_value_raw:
                        keep_item = _core_lt(trim_cursor, keep_count)
                        if keep_item:
                            trimmed.append(item)
                        else:
                            pass
                        trim_cursor_next = _core_add(trim_cursor, 1)
                        trim_cursor = trim_cursor_next
                    new_value = trimmed
                else:
                    pass
            else:
                pass
            full_values[key] = new_value
            old_present = _core_map_contains(previous_values, key)
            old_value = _core_get(previous_values, key, None)
            old_is_list = _core_type_is(old_value, "list")
            should_emit = False
            delta_value = _core_none()
            if new_is_list:
                if old_is_list:
                    new_count = _core_len(new_value)
                    old_count = _core_len(old_value)
                    grew = _core_gt(new_count, old_count)
                    if grew:
                        suffix = []
                        cursor = 0
                        for item in new_value:
                            is_suffix = _core_gte(cursor, old_count)
                            if is_suffix:
                                suffix.append(item)
                            else:
                                pass
                            cursor_next = _core_add(cursor, 1)
                            cursor = cursor_next
                        delta_value = suffix
                        should_emit = True
                    else:
                        pass
                else:
                    old_missing = _core_not(old_present)
                    if old_missing:
                        delta_value = new_value
                        should_emit = True
                    else:
                        pass
            else:
                new_is_string = _core_type_is(new_value, "string")
                old_is_string = _core_type_is(old_value, "string")
                both_strings = _core_and(new_is_string, old_is_string)
                if both_strings:
                    prefix_growing = _core_string_starts_with(new_value, old_value)
                    if prefix_growing:
                        old_length = _core_len(old_value)
                        new_length = _core_len(new_value)
                        string_grew = _core_gt(new_length, old_length)
                        if string_grew:
                            suffix = _core_string_slice(new_value, old_length)
                            delta_value = suffix
                            should_emit = True
                        else:
                            pass
                    else:
                        same_string = _core_eq(new_value, old_value)
                        changed_string = _core_not(same_string)
                        if changed_string:
                            delta_value = new_value
                            should_emit = True
                        else:
                            pass
                else:
                    same_value = _core_eq(new_value, old_value)
                    changed_value = _core_not(same_value)
                    old_missing = _core_not(old_present)
                    emit_value = _core_or(changed_value, old_missing)
                    if emit_value:
                        delta_value = new_value
                        should_emit = True
                    else:
                        pass
            if should_emit:
                delta[key] = delta_value
            else:
                pass
        else:
            pass
    out = {}
    out["delta"] = delta
    out["full_values"] = full_values
    return out


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


def _regex_hexdigit(c: Any) -> Any:
    _core_coverage_mark("_regex_hexdigit")
    t1 = _regex_digit(c)
    if t1:
        t2 = _core_mul(-1, 48)
        t3 = _core_add(c, t2)
        t4 = _core_math_floor(t3)
        return t4
    else:
        pass
    t5 = _core_gte(c, 65)
    t6 = t5
    if t6:
        t7 = _core_lte(c, 70)
        t6 = t7
    else:
        pass
    if t6:
        t8 = _core_mul(-1, 55)
        t9 = _core_add(c, t8)
        t10 = _core_math_floor(t9)
        return t10
    else:
        pass
    t11 = _core_gte(c, 97)
    t12 = t11
    if t12:
        t13 = _core_lte(c, 102)
        t12 = t13
    else:
        pass
    if t12:
        t14 = _core_mul(-1, 87)
        t15 = _core_add(c, t14)
        t16 = _core_math_floor(t15)
        return t16
    else:
        pass
    t17 = _core_mul(-1, 1)
    t18 = _core_math_floor(t17)
    return t18


def _regex_node(k: Any) -> Any:
    _core_coverage_mark("_regex_node")
    t1 = {}
    t1["k"] = k
    return t1


def _regex_literal(c: Any) -> Any:
    _core_coverage_mark("_regex_literal")
    t1 = {}
    t1["k"] = "char"
    t1["c"] = c
    return t1


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


def _chat_session_argument_errors(root: Any, schema: Any, arguments: Any, path: str, depth: int) -> Any:
    _core_coverage_mark("_chat_session_argument_errors")
    errors = []
    empty = {}
    empty_list = []
    too_deep = _core_gt(depth, 64)
    if too_deep:
        message = _core_string_format("{}: Arguments exceed schema nesting limit", path)
        errors.append(message)
        return errors
    else:
        pass
    next_depth = _core_add(depth, 1)
    reference = _core_get(schema, "$ref", "")
    if reference:
        local = _core_string_starts_with(reference, "#/")
        if local:
            tail = _core_string_slice(reference, 2)
            parts = _core_string_split(tail, "/")
            target = root
            for part in parts:
                slash = _core_string_replace(part, "~1", "/")
                key = _core_string_replace(slash, "~0", "~")
                array_target = _core_type_is(target, "list")
                if array_target:
                    found = _core_get(empty, "not_found", None)
                    index = 0
                    for entry in target:
                        index_key = _core_string_format("{}", index)
                        same_index = _core_eq(index_key, key)
                        if same_index:
                            found = entry
                        else:
                            pass
                        index = _core_add(index, 1)
                    target = found
                else:
                    target = _core_get(target, key, None)
            missing = _core_is_none(target)
            target_boolean = _core_type_is(target, "boolean")
            if target_boolean:
                is_false = _core_not(target)
                missing = _core_or(missing, is_false)
            else:
                pass
            target_number = _core_type_is(target, "number")
            if target_number:
                is_zero = _core_eq(target, 0)
                missing = _core_or(missing, is_zero)
            else:
                pass
            target_string = _core_type_is(target, "string")
            if target_string:
                is_empty = _core_eq(target, "")
                missing = _core_or(missing, is_empty)
            else:
                pass
            if missing:
                message = _core_string_format("{}: Unresolved schema reference", path)
                errors.append(message)
                return errors
            else:
                pass
            referenced_errors = _chat_session_argument_errors(root, target, arguments, path, next_depth)
            return referenced_errors
        else:
            message = _core_string_format("{}: External schema references are unsupported", path)
            errors.append(message)
            return errors
    else:
        pass
    all = _core_get(schema, "allOf", empty_list)
    for branch in all:
        branch_errors = _chat_session_argument_errors(root, branch, arguments, path, next_depth)
        for error in branch_errors:
            errors.append(error)
    keywords = []
    keywords.append("anyOf")
    keywords.append("oneOf")
    for keyword in keywords:
        branches = _core_get(schema, keyword, None)
        union_branches = _core_type_is(branches, "list")
        if union_branches:
            matches = 0
            for branch in branches:
                branch_errors = _chat_session_argument_errors(root, branch, arguments, path, next_depth)
                error_count = _core_len(branch_errors)
                match = _core_eq(error_count, 0)
                if match:
                    matches = _core_add(matches, 1)
                else:
                    pass
            no_match = _core_eq(matches, 0)
            one = _core_eq(keyword, "oneOf")
            ambiguous = _core_gt(matches, 1)
            too_many = _core_and(one, ambiguous)
            invalid_union = _core_or(no_match, too_many)
            if invalid_union:
                message = _core_string_format("{}: Arguments do not match {}", path, keyword)
                errors.append(message)
            else:
                pass
        else:
            pass
    declared_type = _core_get(schema, "type", None)
    has_type = _core_is_not_none(declared_type)
    if has_type:
        types = []
        is_union = _core_type_is(declared_type, "list")
        if is_union:
            types = declared_type
        else:
            types.append(declared_type)
        matches = False
        for type in types:
            wants_string = _core_eq(type, "string")
            if wants_string:
                value_string = _core_type_is(arguments, "string")
                matches = _core_or(matches, value_string)
            else:
                pass
            wants_object = _core_eq(type, "object")
            if wants_object:
                value_object = _core_type_is(arguments, "object")
                matches = _core_or(matches, value_object)
            else:
                pass
            wants_array = _core_eq(type, "array")
            if wants_array:
                value_array = _core_type_is(arguments, "list")
                matches = _core_or(matches, value_array)
            else:
                pass
            wants_number = _core_eq(type, "number")
            if wants_number:
                value_number = _core_type_is(arguments, "number")
                matches = _core_or(matches, value_number)
            else:
                pass
            wants_boolean = _core_eq(type, "boolean")
            if wants_boolean:
                value_boolean = _core_type_is(arguments, "boolean")
                matches = _core_or(matches, value_boolean)
            else:
                pass
            wants_null = _core_eq(type, "null")
            if wants_null:
                value_null = _core_is_none(arguments)
                matches = _core_or(matches, value_null)
            else:
                pass
            wants_integer = _core_eq(type, "integer")
            if wants_integer:
                numeric = _core_type_is(arguments, "number")
                if numeric:
                    finite = _core_math_is_finite(arguments)
                    if finite:
                        whole = _core_math_floor(arguments)
                        value_integer = _core_eq(whole, arguments)
                        matches = _core_or(matches, value_integer)
                    else:
                        pass
                else:
                    pass
            else:
                pass
        if matches:
            pass
        else:
            message = _core_string_format("Validation failed: Expected '{}' to have type {}", path, declared_type)
            errors.append(message)
            return errors
    else:
        pass
    enum_values = _core_get(schema, "enum", None)
    has_enum = _core_type_is(enum_values, "list")
    if has_enum:
        allowed = False
        for choice in enum_values:
            same = _chat_session_argument_equal(choice, arguments, 0)
            allowed = _core_or(allowed, same)
        if allowed:
            pass
        else:
            message = _core_string_format("{}: Value is not in the allowed enum", path)
            errors.append(message)
    else:
        pass
    has_const = _core_map_contains(schema, "const")
    if has_const:
        constant = _core_get(schema, "const", None)
        same = _chat_session_argument_equal(constant, arguments, 0)
        if same:
            pass
        else:
            message = _core_string_format("{}: Value does not match const", path)
            errors.append(message)
    else:
        pass
    string = _core_type_is(arguments, "string")
    if string:
        length = _core_string_codepoint_length(arguments)
        minimum = _core_get(schema, "minLength", 0)
        maximum = _core_get(schema, "maxLength", length)
        too_short = _core_lt(length, minimum)
        too_long = _core_gt(length, maximum)
        if too_short:
            message = _core_string_format("{}: String is too short", path)
            errors.append(message)
        else:
            pass
        if too_long:
            message = _core_string_format("{}: String is too long", path)
            errors.append(message)
        else:
            pass
        pattern = _core_get(schema, "pattern", "")
        if pattern:
            matches = _regex_test(pattern, arguments)
            if matches:
                pass
            else:
                message = _core_string_format("{}: String does not match pattern", path)
                errors.append(message)
        else:
            pass
    else:
        pass
    number = _core_type_is(arguments, "number")
    if number:
        finite = _core_math_is_finite(arguments)
        if finite:
            pass
        else:
            message = _core_string_format("{}: Number must be finite", path)
            errors.append(message)
        minimum = _core_get(schema, "minimum", arguments)
        maximum = _core_get(schema, "maximum", arguments)
        low = _core_lt(arguments, minimum)
        high = _core_gt(arguments, maximum)
        if low:
            message = _core_string_format("{}: Number is below minimum", path)
            errors.append(message)
        else:
            pass
        if high:
            message = _core_string_format("{}: Number is above maximum", path)
            errors.append(message)
        else:
            pass
    else:
        pass
    object = _core_type_is(arguments, "object")
    if object:
        required = _core_get(schema, "required", empty_list)
        for name in required:
            present = _core_map_contains(arguments, name)
            if present:
                pass
            else:
                message = _core_string_format("Required field is missing: '{}.{}'", path, name)
                errors.append(message)
        properties = _core_get(schema, "properties", empty)
        additional = _core_get(schema, "additionalProperties", True)
        forbidden = _core_eq(additional, False)
        additional_schema = _core_type_is(additional, "object")
        names = _core_map_keys(arguments)
        for name in names:
            child = _core_get(arguments, name, None)
            child_path = _core_string_format("{}.{}", path, name)
            child_schema = _core_get(properties, name, None)
            known = _core_is_not_none(child_schema)
            if known:
                child_errors = _chat_session_argument_errors(root, child_schema, child, child_path, next_depth)
                for error in child_errors:
                    errors.append(error)
            else:
                if forbidden:
                    message = _core_string_format("{}: Unexpected property: {}", path, name)
                    errors.append(message)
                else:
                    pass
                if additional_schema:
                    child_errors = _chat_session_argument_errors(root, additional, child, child_path, next_depth)
                    for error in child_errors:
                        errors.append(error)
                else:
                    pass
    else:
        pass
    array = _core_type_is(arguments, "list")
    if array:
        length = _core_len(arguments)
        minimum = _core_get(schema, "minItems", 0)
        maximum = _core_get(schema, "maxItems", length)
        too_short = _core_lt(length, minimum)
        too_long = _core_gt(length, maximum)
        if too_short:
            message = _core_string_format("{}: Too few items", path)
            errors.append(message)
        else:
            pass
        if too_long:
            message = _core_string_format("{}: Too many items", path)
            errors.append(message)
        else:
            pass
        items = _core_get(schema, "items", empty)
        index = 0
        for item in arguments:
            child_path = _core_string_format("{}[{}]", path, index)
            child_errors = _chat_session_argument_errors(root, items, item, child_path, next_depth)
            for error in child_errors:
                errors.append(error)
            index = _core_add(index, 1)
    else:
        pass
    return errors


def _regex_scan_groups(u: Any) -> Any:
    _core_coverage_mark("_regex_scan_groups")
    c = _core_none()
    count = _core_none()
    i = _core_none()
    ids = _core_none()
    inside = _core_none()
    name = _core_none()
    named = _core_none()
    names = _core_none()
    parser = _core_none()
    special = _core_none()
    count = 0
    i = 0
    inside = False
    t1 = {}
    names = t1
    while True:
        t2 = _core_len(u)
        t3 = _core_lt(i, t2)
        t4 = _core_not(t3)
        if t4:
            break
        else:
            pass
        t5 = _core_get(u, i, None)
        c = t5
        t6 = _core_add(i, 1)
        i = t6
        t7 = _core_eq(c, 92)
        if t7:
            t8 = _core_add(i, 1)
            i = t8
            continue
        else:
            pass
        t9 = _core_eq(c, 91)
        if t9:
            inside = True
        else:
            pass
        t10 = _core_eq(c, 93)
        if t10:
            inside = False
        else:
            pass
        t11 = _core_eq(c, 40)
        t12 = t11
        if t12:
            t13 = _core_not(inside)
            t12 = t13
        else:
            pass
        if t12:
            t14 = _core_len(u)
            t15 = _core_lt(i, t14)
            t16 = t15
            if t16:
                t17 = _core_get(u, i, None)
                t18 = _core_eq(t17, 63)
                t16 = t18
            else:
                pass
            special = t16
            t19 = special
            if t19:
                t20 = _core_add(i, 2)
                t21 = _core_len(u)
                t22 = _core_lt(t20, t21)
                t19 = t22
            else:
                pass
            if t19:
                t23 = _core_add(i, 1)
                t24 = _core_get(u, t23, None)
                t25 = _core_eq(t24, 60)
                t19 = t25
            else:
                pass
            if t19:
                t26 = _core_add(i, 2)
                t27 = _core_get(u, t26, None)
                t28 = _core_ne(t27, 61)
                t19 = t28
            else:
                pass
            if t19:
                t29 = _core_add(i, 2)
                t30 = _core_get(u, t29, None)
                t31 = _core_ne(t30, 33)
                t19 = t31
            else:
                pass
            named = t19
            t32 = _core_not(special)
            t33 = t32
            t34 = _core_not(t33)
            if t34:
                t33 = named
            else:
                pass
            if t33:
                t35 = _core_add(count, 1)
                count = t35
                if named:
                    t36 = {}
                    t36["u"] = u
                    t37 = _core_add(i, 2)
                    t36["p"] = t37
                    parser = t36
                    t38 = _regex_read_name(parser)
                    name = t38
                    t39 = _core_get(parser, "p", None)
                    i = t39
                    t40 = _core_get(names, name, None)
                    ids = t40
                    t41 = _core_none()
                    t42 = _core_eq(ids, t41)
                    if t42:
                        t43 = []
                        ids = t43
                    else:
                        pass
                    ids.append(count)
                    names[name] = ids
                else:
                    pass
            else:
                pass
        else:
            pass
    t44 = {}
    t44["count"] = count
    t44["names"] = names
    return t44


def _structured_output_scalar_placeholder(typ: Any) -> Any:
    _core_coverage_mark("_structured_output_scalar_placeholder")
    type_name = _core_get(typ, "name", None)
    is_string = _core_eq(type_name, "string")
    if is_string:
        return "<string>"
    else:
        pass
    is_code = _core_eq(type_name, "code")
    if is_code:
        return "<complete source>"
    else:
        pass
    is_number = _core_eq(type_name, "number")
    if is_number:
        return 0
    else:
        pass
    is_boolean = _core_eq(type_name, "boolean")
    if is_boolean:
        return True
    else:
        pass
    is_class = _core_eq(type_name, "class")
    if is_class:
        options = _core_get(typ, "options", None)
        class_placeholder = _core_list_get(options, 0, "<allowed value>")
        return class_placeholder
    else:
        pass
    is_date = _core_eq(type_name, "date")
    if is_date:
        return "<YYYY-MM-DD>"
    else:
        pass
    is_datetime = _core_eq(type_name, "datetime")
    if is_datetime:
        return "<ISO 8601 datetime>"
    else:
        pass
    is_date_range = _core_eq(type_name, "dateRange")
    if is_date_range:
        date_range = {}
        date_range["start"] = "<YYYY-MM-DD>"
        date_range["end"] = "<YYYY-MM-DD>"
        return date_range
    else:
        pass
    is_datetime_range = _core_eq(type_name, "datetimeRange")
    if is_datetime_range:
        datetime_range = {}
        datetime_range["start"] = "<ISO 8601 datetime>"
        datetime_range["end"] = "<ISO 8601 datetime>"
        return datetime_range
    else:
        pass
    is_url = _core_eq(type_name, "url")
    if is_url:
        return "<url>"
    else:
        pass
    is_object = _core_eq(type_name, "object")
    if is_object:
        object_placeholder = {}
        nested_map = _core_get(typ, "fields", None)
        nested_fields = _core_fields_from_map(nested_map)
        for nested_field in nested_fields:
            nested_internal_snake = _core_get(nested_field, "is_internal", False)
            nested_internal = _core_get(nested_field, "isInternal", nested_internal_snake)
            nested_visible = _core_not(nested_internal)
            if nested_visible:
                nested_name = _core_get(nested_field, "name", None)
                nested_type = _core_get(nested_field, "type", nested_field)
                nested_placeholder = _structured_output_type_placeholder(nested_type)
                object_placeholder[nested_name] = nested_placeholder
            else:
                pass
        return object_placeholder
    else:
        pass
    is_json = _core_eq(type_name, "json")
    if is_json:
        json_placeholder = {}
        return json_placeholder
    else:
        pass
    return "<value>"


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


def _stream_event_content_parts_impl(event: Any) -> list[Any]:
    _core_coverage_mark("_stream_event_content_parts_impl")
    parts = _core_stream_event_content_parts(event)
    return parts


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


def _structured_output_type_placeholder(typ: Any) -> Any:
    _core_coverage_mark("_structured_output_type_placeholder")
    placeholder = _structured_output_scalar_placeholder(typ)
    is_array_snake = _core_get(typ, "is_array", False)
    is_array = _core_get(typ, "isArray", is_array_snake)
    if is_array:
        array_placeholder = []
        array_placeholder.append(placeholder)
        return array_placeholder
    else:
        pass
    return placeholder


def _structured_output_shape(output_fields: list[Any]) -> str:
    _core_coverage_mark("_structured_output_shape")
    shape = {}
    for field in output_fields:
        internal_snake = _core_get(field, "is_internal", False)
        internal = _core_get(field, "isInternal", internal_snake)
        visible = _core_not(internal)
        if visible:
            name = _core_get(field, "name", None)
            typ = _core_get(field, "type", None)
            placeholder = _structured_output_type_placeholder(typ)
            shape[name] = placeholder
        else:
            pass
    shape_json = _core_json_stringify(shape)
    return shape_json


def _serialize_optimized_artifact(artifact: Any) -> str:
    _core_coverage_mark("_serialize_optimized_artifact")
    text = _core_json_stringify(artifact)
    return text


def _regex_escaped(s: Any, inside: Any) -> Any:
    _core_coverage_mark("_regex_escaped")
    c = _core_none()
    d = _core_none()
    i = _core_none()
    limit = _core_none()
    n = _core_none()
    name = _core_none()
    start = _core_none()
    value = _core_none()
    t1 = _regex_take(s)
    c = t1
    t2 = _core_lt(c, 0)
    if t2:
        t3 = _core_string_format("Invalid regular expression: {}", "Trailing escape")
        t4 = _core_validation_error(t3)
        raise t4
    else:
        pass
    t5 = _core_eq(c, 100)
    t6 = t5
    t7 = _core_not(t6)
    if t7:
        t8 = _core_eq(c, 68)
        t6 = t8
    else:
        pass
    t9 = _core_not(t6)
    if t9:
        t10 = _core_eq(c, 119)
        t6 = t10
    else:
        pass
    t11 = _core_not(t6)
    if t11:
        t12 = _core_eq(c, 87)
        t6 = t12
    else:
        pass
    t13 = _core_not(t6)
    if t13:
        t14 = _core_eq(c, 115)
        t6 = t14
    else:
        pass
    t15 = _core_not(t6)
    if t15:
        t16 = _core_eq(c, 83)
        t6 = t16
    else:
        pass
    if t6:
        t17 = {}
        t17["k"] = "class_escape"
        t17["c"] = c
        return t17
    else:
        pass
    t18 = _core_eq(c, 98)
    if t18:
        if inside:
            t19 = _regex_literal(8)
            return t19
        else:
            pass
        t20 = {}
        t20["k"] = "boundary"
        t20["negative"] = False
        return t20
    else:
        pass
    t21 = _core_eq(c, 66)
    t22 = t21
    if t22:
        t23 = _core_not(inside)
        t22 = t23
    else:
        pass
    if t22:
        t24 = {}
        t24["k"] = "boundary"
        t24["negative"] = True
        return t24
    else:
        pass
    t25 = _core_eq(c, 102)
    if t25:
        t26 = _regex_literal(12)
        return t26
    else:
        pass
    t27 = _core_eq(c, 110)
    if t27:
        t28 = _regex_literal(10)
        return t28
    else:
        pass
    t29 = _core_eq(c, 114)
    if t29:
        t30 = _regex_literal(13)
        return t30
    else:
        pass
    t31 = _core_eq(c, 116)
    if t31:
        t32 = _regex_literal(9)
        return t32
    else:
        pass
    t33 = _core_eq(c, 118)
    if t33:
        t34 = _regex_literal(11)
        return t34
    else:
        pass
    t35 = _core_eq(c, 120)
    t36 = t35
    t37 = _core_not(t36)
    if t37:
        t38 = _core_eq(c, 117)
        t36 = t38
    else:
        pass
    if t36:
        n = 2
        t39 = _core_eq(c, 117)
        if t39:
            n = 4
        else:
            pass
        t40 = _core_get(s, "p", None)
        start = t40
        value = 0
        i = 0
        while True:
            t41 = _core_lt(i, n)
            t42 = t41
            if t42:
                t43 = _regex_peek(s)
                t44 = _regex_hexdigit(t43)
                t45 = _core_gte(t44, 0)
                t42 = t45
            else:
                pass
            t46 = _core_not(t42)
            if t46:
                break
            else:
                pass
            t47 = _core_mul(value, 16)
            t48 = _core_math_floor(t47)
            t49 = _regex_take(s)
            t50 = _regex_hexdigit(t49)
            t51 = _core_add(t48, t50)
            value = t51
            t52 = _core_add(i, 1)
            i = t52
        t53 = _core_eq(i, n)
        if t53:
            t54 = _regex_literal(value)
            return t54
        else:
            pass
        s["p"] = start
        t55 = _regex_literal(c)
        return t55
    else:
        pass
    t56 = _core_eq(c, 99)
    if t56:
        t57 = _regex_peek(s)
        d = t57
        t58 = _core_gte(d, 65)
        t59 = t58
        if t59:
            t60 = _core_lte(d, 90)
            t59 = t60
        else:
            pass
        t61 = t59
        t62 = _core_not(t61)
        if t62:
            t63 = _core_gte(d, 97)
            t64 = t63
            if t64:
                t65 = _core_lte(d, 122)
                t64 = t65
            else:
                pass
            t61 = t64
        else:
            pass
        t66 = _core_not(t61)
        if t66:
            t67 = inside
            if t67:
                t68 = _regex_digit(d)
                t69 = t68
                t70 = _core_not(t69)
                if t70:
                    t71 = _core_eq(d, 95)
                    t69 = t71
                else:
                    pass
                t67 = t69
            else:
                pass
            t61 = t67
        else:
            pass
        if t61:
            t72 = _regex_take(s)
            t73 = _core_div(d, 32)
            t74 = _core_math_floor(t73)
            t75 = _core_mul(32, t74)
            t76 = _core_mul(-1, t75)
            t77 = _core_add(d, t76)
            t78 = _core_math_floor(t77)
            t79 = _regex_literal(t78)
            return t79
        else:
            pass
        t80 = _core_get(s, "p", None)
        t81 = _core_mul(-1, 1)
        t82 = _core_add(t80, t81)
        t83 = _core_math_floor(t82)
        s["p"] = t83
        t84 = _regex_literal(92)
        return t84
    else:
        pass
    t85 = _regex_digit(c)
    if t85:
        t86 = _core_get(s, "p", None)
        start = t86
        t87 = _core_mul(-1, 48)
        t88 = _core_add(c, t87)
        t89 = _core_math_floor(t88)
        value = t89
        while True:
            t90 = _regex_peek(s)
            t91 = _regex_digit(t90)
            t92 = _core_not(t91)
            if t92:
                break
            else:
                pass
            t93 = _core_mul(value, 10)
            t94 = _core_math_floor(t93)
            t95 = _regex_take(s)
            t96 = _core_add(t94, t95)
            t97 = _core_mul(-1, 48)
            t98 = _core_add(t96, t97)
            t99 = _core_math_floor(t98)
            value = t99
        t100 = _core_ne(c, 48)
        t101 = t100
        if t101:
            t102 = _core_not(inside)
            t101 = t102
        else:
            pass
        if t101:
            t103 = _core_get(s, "total", None)
            t104 = _core_lte(value, t103)
            t101 = t104
        else:
            pass
        if t101:
            t105 = {}
            t105["k"] = "ref"
            t106 = []
            t106.append(value)
            t105["ids"] = t106
            return t105
        else:
            pass
        s["p"] = start
        t107 = _core_lte(c, 55)
        if t107:
            t108 = _core_mul(-1, 48)
            t109 = _core_add(c, t108)
            t110 = _core_math_floor(t109)
            value = t110
            n = 1
            limit = 3
            t111 = _core_gt(c, 51)
            if t111:
                limit = 2
            else:
                pass
            while True:
                t112 = _core_lt(n, limit)
                t113 = t112
                if t113:
                    t114 = _regex_peek(s)
                    t115 = _core_gte(t114, 48)
                    t113 = t115
                else:
                    pass
                if t113:
                    t116 = _regex_peek(s)
                    t117 = _core_lte(t116, 55)
                    t113 = t117
                else:
                    pass
                t118 = _core_not(t113)
                if t118:
                    break
                else:
                    pass
                t119 = _core_mul(value, 8)
                t120 = _core_math_floor(t119)
                t121 = _regex_take(s)
                t122 = _core_add(t120, t121)
                t123 = _core_mul(-1, 48)
                t124 = _core_add(t122, t123)
                t125 = _core_math_floor(t124)
                value = t125
                t126 = _core_add(n, 1)
                n = t126
            t127 = _regex_literal(value)
            return t127
        else:
            pass
        t128 = _regex_literal(c)
        return t128
    else:
        pass
    t129 = _core_eq(c, 107)
    t130 = t129
    if t130:
        t131 = _core_not(inside)
        t130 = t131
    else:
        pass
    if t130:
        t132 = _core_get(s, "names", None)
        t133 = _core_len(t132)
        t134 = _core_gt(t133, 0)
        t130 = t134
    else:
        pass
    if t130:
        t135 = _regex_take(s)
        t136 = _core_ne(t135, 60)
        if t136:
            t137 = _core_string_format("Invalid regular expression: {}", "Invalid named backreference")
            t138 = _core_validation_error(t137)
            raise t138
        else:
            pass
        t139 = _regex_read_name(s)
        name = t139
        t140 = _core_get(s, "names", None)
        t141 = _core_map_contains(t140, name)
        t142 = _core_not(t141)
        if t142:
            t143 = _core_string_format("Invalid regular expression: {}", "Unknown named backreference")
            t144 = _core_validation_error(t143)
            raise t144
        else:
            pass
        t145 = {}
        t145["k"] = "ref"
        t146 = _core_get(s, "names", None)
        t147 = _core_get(t146, name, None)
        t145["ids"] = t147
        return t145
    else:
        pass
    t148 = _regex_literal(c)
    return t148


def _append_structured_output_instruction(messages: list[Any], output_fields: list[Any], selection: Any) -> None:
    _core_coverage_mark("_append_structured_output_instruction")
    rung = _core_get(selection, "rung", None)
    is_function = _core_eq(rung, "function")
    content = ""
    if is_function:
        content = "Emit the complete structured output by calling `__axOutput` with exactly the declared wire keys."
    else:
        shape = _structured_output_shape(output_fields)
        parts = []
        parts.append("Return exactly one JSON object with this shape: `")
        parts.append(shape)
        parts.append("`. Use only these exact wire keys, with no prose or Markdown fences.")
        content = _core_string_join("", parts)
    message = {}
    message["role"] = "user"
    message["content"] = content
    messages.append(message)
    return None


def _deserialize_optimized_artifact(text: str, components: Any) -> Any:
    _core_coverage_mark("_deserialize_optimized_artifact")
    artifact = _core_json_parse(text)
    validated = _validate_optimized_artifact(artifact, components)
    return validated


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


def _assert_no_reserved_output_functions(functions: list[Any]) -> None:
    _core_coverage_mark("_assert_no_reserved_output_functions")
    for fn in functions:
        name = _core_get(fn, "name", None)
        canonical = _core_eq(name, "__axOutput")
        legacy = _core_eq(name, "__finalResult")
        reserved = _core_or(canonical, legacy)
        if reserved:
            raise RuntimeError("Function names '__axOutput' and '__finalResult' are reserved for Ax structured-output handling")
        else:
            pass
    return None


def _optimization_component_current_map(components: Any) -> Any:
    _core_coverage_mark("_optimization_component_current_map")
    out = {}
    for component in components:
        id = _core_get(component, "id", "")
        current = _core_get(component, "current", None)
        out[id] = current
    return out


def _find_structured_output_call(calls: list[Any]) -> Any:
    _core_coverage_mark("_find_structured_output_call")
    for call in calls:
        direct_name = _core_get(call, "name", None)
        fn = _core_get(call, "function", None)
        name = _core_get(fn, "name", direct_name)
        canonical = _core_eq(name, "__axOutput")
        legacy = _core_eq(name, "__finalResult")
        reserved = _core_or(canonical, legacy)
        if reserved:
            return call
        else:
            pass
    none = _core_none()
    return none


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


def _structured_output_call_args(call: Any) -> Any:
    _core_coverage_mark("_structured_output_call_args")
    fn = _core_get(call, "function", None)
    direct_params = _core_get(call, "params", None)
    params = _core_get(fn, "params", direct_params)
    missing = _core_is_none(params)
    if missing:
        arguments = _core_get(call, "arguments", None)
        params = arguments
    else:
        pass
    is_string = _core_type_is(params, "string")
    if is_string:
        parsed = _core_json_parse_strict(params)
        params = parsed
    else:
        pass
    return params


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


def _build_gen_chat_request(gen: AxGen, messages: list[Any], options: Any, selection: Any) -> AxChatRequest:
    _core_coverage_mark("_build_gen_chat_request")
    empty_model_config = {}
    model_config_snake = _core_get(options, "model_config", empty_model_config)
    model_config_base = _core_get(options, "modelConfig", model_config_snake)
    model_config = _core_map_merge(empty_model_config, model_config_base)
    stream_value = _core_get(options, "stream", False)
    stream_bool = _core_truthy(stream_value)
    model_config["stream"] = stream_bool
    budget_snake = _core_get(options, "thinking_token_budget", None)
    budget = _core_get(options, "thinkingTokenBudget", budget_snake)
    has_budget = _core_is_not_none(budget)
    if has_budget:
        model_config["thinkingTokenBudget"] = budget
    else:
        pass
    reasoning_snake = _core_get(options, "reasoning_effort", None)
    reasoning = _core_get(options, "reasoningEffort", reasoning_snake)
    has_reasoning = _core_is_not_none(reasoning)
    if has_reasoning:
        model_config["reasoning_effort"] = reasoning
    else:
        pass
    show_thoughts_snake = _core_get(options, "show_thoughts", None)
    show_thoughts = _core_get(options, "showThoughts", show_thoughts_snake)
    has_show_thoughts = _core_is_not_none(show_thoughts)
    if has_show_thoughts:
        model_config["showThoughts"] = show_thoughts
    else:
        pass
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
    sample_count_snake = _core_get(options, "sample_count", None)
    sample_count = _core_get(options, "sampleCount", sample_count_snake)
    n = _core_get(options, "n", sample_count)
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
    _assert_no_reserved_output_functions(functions)
    function_specs = []
    for fn in functions:
        spec = _tool_spec_impl(fn)
        function_specs.append(spec)
    mode_snake = _core_get(options, "function_call_mode", None)
    mode_raw = _core_get(options, "functionCallMode", mode_snake)
    mode = _function_call_mode_impl(mode_raw)
    request["function_call"] = mode
    signature = _core_get(gen, "signature", None)
    output_fields = _core_get(signature, "output_fields", None)
    rung = _core_get(selection, "rung", None)
    fn_count = _core_len(function_specs)
    use_function = _core_eq(rung, "function")
    if use_function:
        schema_options = {}
        function_schema = _schema_to_json_schema_impl(output_fields, "output", schema_options)
        synthetic = {}
        synthetic["name"] = "__axOutput"
        synthetic["description"] = "Emit the complete structured program output using the declared argument shape."
        synthetic["parameters"] = function_schema
        function_specs.append(synthetic)
        no_user_functions = _core_eq(fn_count, 0)
        if no_user_functions:
            forced_function_ref = {}
            forced_function_ref["name"] = "__axOutput"
            forced_function = {}
            forced_function["type"] = "function"
            forced_function["function"] = forced_function_ref
            request["function_call"] = forced_function
            request["function_call_source"] = "ax"
        else:
            pass
    else:
        pass
    request["functions"] = function_specs
    use_native = _core_eq(rung, "native")
    if use_native:
        schema_options = {}
        schema_options["strictStructuredOutputs"] = True
        schema_options["flexibleJsonFieldsAsString"] = True
        output_schema = _schema_to_json_schema_impl(output_fields, "output", schema_options)
        schema_wrap = {}
        schema_wrap["name"] = "output"
        schema_wrap["strict"] = True
        schema_wrap["schema"] = output_schema
        response_format = {}
        response_format["type"] = "json_schema"
        response_format["schema"] = schema_wrap
        request["response_format"] = response_format
    else:
        pass
    use_json_object = _core_eq(rung, "json_object")
    if use_json_object:
        response_format = {}
        response_format["type"] = "json_object"
        request["response_format"] = response_format
    else:
        pass
    ax_metadata = {}
    ax_metadata["structured_output_rung"] = rung
    provider_metadata = {}
    provider_metadata["ax"] = ax_metadata
    request["provider_metadata"] = provider_metadata
    request["model_config"] = model_config
    return request


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


def chat_session_record_result(gen: Any, state: Any, call: Any, result: Any, ok: bool) -> bool:
    _core_coverage_mark("chat_session_record_result")
    id = _core_get(call, "id", None)
    text = result
    is_string = _core_type_is(result, "string")
    if is_string:
        pass
    else:
        text = _core_json_stringify(result)
    output = {}
    output["function_id"] = id
    output["result"] = text
    changed = chat_session_complete_call(state, id, output)
    if changed:
        status = "error"
        if ok:
            status = "ok"
        else:
            pass
        _core_axgen_memory_add_function_result(gen, call, result, ok)
        _core_axgen_record_function_call(gen, call, result, status)
    else:
        pass
    return changed


def chat_session_observe_output(gen: Any, state: Any, event: Any) -> Any:
    _core_coverage_mark("chat_session_observe_output")
    empty_map = {}
    empty_list = []
    texts = _core_get(state, "texts", empty_map)
    id = _core_get(event, "response_id", None)
    text = _core_get(texts, id, "")
    response = _core_get(event, "response", None)
    results = _core_get(response, "results", empty_list)
    for result in results:
        delta = _core_get(result, "content", "")
        text = _core_string_format("{}{}", text, delta)
    texts[id] = text
    state["texts"] = texts
    assertions = _core_get(gen, "streaming_assertions", empty_list)
    for assertion in assertions:
        is_map = _core_type_is(assertion, "object")
        if is_map:
            needle_camel = _core_get(assertion, "notContains", None)
            needle = _core_get(assertion, "not_contains", needle_camel)
            has_needle = _core_is_not_none(needle)
            if has_needle:
                found = _core_contains(text, needle)
                if found:
                    message = _core_get(assertion, "message", "streaming assertion failed")
                    error = _core_runtime_error(message)
                    raise error
                else:
                    pass
            else:
                pass
        else:
            pass
    version = _core_get(state, "version", 0)
    output = {}
    output["response_id"] = id
    output["text"] = text
    output["version"] = version
    return output


def _parse_sample_outputs(gen: AxGen, output_fields: list[Any], response: Any, validate_exact_json: bool) -> Any:
    _core_coverage_mark("_parse_sample_outputs")
    empty_results = []
    completions = _core_get(response, "results", empty_results)
    completion_count = _core_len(completions)
    missing_completions = _core_eq(completion_count, 0)
    if missing_completions:
        completions = []
        completions.append(response)
    else:
        pass
    outputs = []
    samples = []
    position = 0
    for completion in completions:
        content = _core_get(completion, "content", "")
        output = _parse_output_impl(content)
        if validate_exact_json:
            _validate_exact_output_keys(output_fields, output, "output")
        else:
            pass
        recovered = _parse_json_string_fields(output_fields, output)
        validated = validate_output(output_fields, recovered)
        processed = _apply_field_processors(gen, validated)
        _run_assertions(gen, processed)
        public_output = strip_internal(output_fields, processed)
        outputs.append(public_output)
        sample_index = _core_get(completion, "index", position)
        sample = {}
        sample["index"] = sample_index
        sample["sample"] = public_output
        samples.append(sample)
        next_position = _core_add(position, 1)
        position = next_position
    bundle = {}
    bundle["outputs"] = outputs
    bundle["samples"] = samples
    return bundle


def chat_session_apply_boundary_updates(request: Any, updates: list[Any], level: Any) -> Any:
    _core_coverage_mark("chat_session_apply_boundary_updates")
    empty = {}
    config = _core_get(request, "model_config", empty)
    config = _core_map_merge(config, empty)
    messages = _core_get(request, "chat_prompt", None)
    current_level = level
    applied = []
    for update in updates:
        kind = _core_get(update, "type", None)
        steering = _core_eq(kind, "steer")
        if steering:
            message = {}
            text = _core_get(update, "text", None)
            message["role"] = "user"
            message["content"] = text
            messages.append(message)
        else:
            next_level = _core_get(update, "level", None)
            current_level = next_level
        id = _core_get(update, "id", None)
        applied.append(id)
    has_level = _core_is_not_none(current_level)
    if has_level:
        config["thinkingTokenBudget"] = current_level
    else:
        pass
    request["model_config"] = config
    request["chat_prompt"] = messages
    result = {}
    result["request"] = request
    result["level"] = current_level
    result["applied"] = applied
    return result


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


def _select_sample_index(samples: list[Any], options: Any) -> number:
    _core_coverage_mark("_select_sample_index")
    picker_snake = _core_get(options, "result_picker", None)
    picker = _core_get(options, "resultPicker", picker_snake)
    missing_picker = _core_is_none(picker)
    sample_count = _core_len(samples)
    single_or_empty = _core_lte(sample_count, 1)
    use_default = _core_or(missing_picker, single_or_empty)
    if use_default:
        return 0
    else:
        pass
    payload = {}
    payload["type"] = "fields"
    payload["results"] = samples
    selected = _core_object_call_method(picker, "call", payload)
    is_number = _core_type_is(selected, "number")
    not_number = _core_not(is_number)
    negative = _core_lt(selected, 0)
    too_large = _core_gte(selected, sample_count)
    out_of_bounds = _core_or(negative, too_large)
    invalid = _core_or(not_number, out_of_bounds)
    if invalid:
        max_index = _core_add(sample_count, -1)
        message = _core_string_format("Result picker returned invalid index: {}. Must be between 0 and {}", selected, max_index)
        error = _core_runtime_error(message)
        raise error
    else:
        pass
    return selected


def chat_session_create_state(model: str, path: str, max_steps: Any) -> Any:
    _core_coverage_mark("chat_session_create_state")
    state = {}
    pending = {}
    responses = {}
    updates = {}
    state["model"] = model
    state["path"] = path
    state["max_steps"] = max_steps
    state["steps"] = 0
    state["version"] = 0
    state["pending"] = pending
    state["responses"] = responses
    state["updates"] = updates
    state["boundary"] = False
    state["terminal"] = False
    return state


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


def chat_session_target_matches(target: str, path: str) -> bool:
    _core_coverage_mark("chat_session_target_matches")
    exact = _core_eq(target, path)
    prefix = _core_string_format("{}/", target)
    descendant = _core_string_starts_with(path, prefix)
    matches = _core_or(exact, descendant)
    return matches


def _forward_impl(gen: AxGen, client: AIClient, values: Any, options: Any) -> Any:
    _core_coverage_mark("_forward_impl")
    base_options = _core_get(gen, "options", None)
    runtime_options = _core_map_merge(base_options, options)
    signature = _core_get(gen, "signature", None)
    model = _core_get(runtime_options, "model", None)
    features = _core_ai_client_features(client, model)
    selection = _select_structured_output_rung(signature, features, runtime_options)
    selected_rung = _core_get(selection, "rung", None)
    validate_exact_json = _core_eq(selected_rung, "json_object")
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
    output_fields = _core_get(signature, "output_fields", None)
    _append_structured_output_instruction(ordered_messages, output_fields, selection)
    validation_feedback_snake = _core_get(runtime_options, "validation_feedback", "")
    validation_feedback = _core_get(runtime_options, "validationFeedback", validation_feedback_snake)
    has_validation_feedback = _core_truthy(validation_feedback)
    if has_validation_feedback:
        validation_feedback_message = {}
        validation_feedback_message["role"] = "user"
        validation_feedback_message["content"] = validation_feedback
        ordered_messages.append(validation_feedback_message)
    else:
        pass
    cached_messages = _core_axgen_apply_context_cache(gen, ordered_messages, options)
    messages = cached_messages
    _core_axgen_memory_add_request(gen, messages)
    validation_retries_snake = _core_get(runtime_options, "validation_retries", 2)
    validation_retries = _core_get(runtime_options, "validationRetries", validation_retries_snake)
    infra_retries_snake = _core_get(runtime_options, "infra_retries", 2)
    infra_retries = _core_get(runtime_options, "infraRetries", infra_retries_snake)
    attempt = 0
    functions = _core_get(gen, "functions", None)
    last_tool_result = _core_none()
    while True:
        request = _build_gen_chat_request(gen, messages, runtime_options, selection)
        response = _complete_with_retries_impl(client, request, runtime_options, infra_retries)
        _core_axgen_memory_add_response(gen, request, response)
        _core_axgen_record_chat_log(gen, request, response)
        calls = _response_function_calls_impl(response)
        call_count = _core_len(calls)
        has_calls = _core_gt(call_count, 0)
        if has_calls:
            structured_call = _find_structured_output_call(calls)
            has_structured_call = _core_is_not_none(structured_call)
            if has_structured_call:
                try:
                    structured_args = _structured_output_call_args(structured_call)
                    _validate_exact_output_keys(output_fields, structured_args, "output")
                    structured_recovered = _parse_json_string_fields(output_fields, structured_args)
                    structured_validated = validate_output(output_fields, structured_recovered)
                    structured_processed = _apply_field_processors(gen, structured_validated)
                    _run_assertions(gen, structured_processed)
                    structured_public = strip_internal(output_fields, structured_processed)
                    _core_axgen_memory_cleanup_corrections(gen)
                    _record_trace(gen, values, structured_public, "ok")
                    return structured_public
                except Exception as structured_validation_error:
                    structured_retries_exhausted = _core_gte(attempt, validation_retries)
                    if structured_retries_exhausted:
                        raise structured_validation_error
                    else:
                        pass
                    structured_next_attempt = _core_add(attempt, 1)
                    attempt = structured_next_attempt
                    _append_assertion_retry_messages(messages, response, structured_validation_error)
                    _core_axgen_memory_add_correction(gen, response, structured_validation_error)
                    continue
            else:
                pass
            updated_messages = _append_tool_call_messages_impl(messages, response, calls)
            messages = updated_messages
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
            parsed_bundle = {}
            try:
                parsed = _parse_sample_outputs(gen, output_fields, response, validate_exact_json)
                parsed_bundle = parsed
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
            public_outputs = _core_get(parsed_bundle, "outputs", None)
            structured_samples = _core_get(parsed_bundle, "samples", None)
            selected_index = _select_sample_index(structured_samples, runtime_options)
            empty_public = {}
            public_output = _core_list_get(public_outputs, selected_index, empty_public)
            _core_axgen_memory_cleanup_corrections(gen)
            _record_trace(gen, values, public_output, "ok")
            return public_output
    raise RuntimeError("unreachable AxGen forward loop exit")


def chat_session_unresolved(state: Any) -> list[Any]:
    _core_coverage_mark("chat_session_unresolved")
    out = []
    pending = _core_get(state, "pending", None)
    ids = _core_map_keys(pending)
    for id in ids:
        call = _core_get(pending, id, None)
        status = _core_get(call, "status", None)
        sent = _core_eq(status, "sent")
        unresolved = _core_not(sent)
        if unresolved:
            out.append(id)
        else:
            pass
    return out


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
            stage_instruction_match = _core_eq(id, "root::instruction")
            actor_any_match = _core_or(actor_any_match, stage_instruction_match)
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


def _regex_class_atom(s: Any) -> Any:
    _core_coverage_mark("_regex_class_atom")
    c = _core_none()
    t1 = _regex_take(s)
    c = t1
    t2 = _core_eq(c, 92)
    if t2:
        t3 = _regex_escaped(s, True)
        return t3
    else:
        pass
    t4 = _regex_literal(c)
    return t4


def chat_session_register_call(state: Any, call: Any, execution: str) -> bool:
    _core_coverage_mark("chat_session_register_call")
    terminal = _core_get(state, "terminal", False)
    if terminal:
        return False
    else:
        pass
    id = _core_get(call, "id", "")
    missing = _core_eq(id, "")
    if missing:
        raise RuntimeError("Completed tool calls require a call ID")
    else:
        pass
    pending = _core_get(state, "pending", None)
    exists = _core_map_contains(pending, id)
    if exists:
        return False
    else:
        pass
    record = {}
    record["call"] = call
    record["execution"] = execution
    record["status"] = "running"
    pending[id] = record
    state["pending"] = pending
    return True


def _regex_character_class(s: Any) -> Any:
    _core_coverage_mark("_regex_character_class")
    first = _core_none()
    last = _core_none()
    negative = _core_none()
    terms = _core_none()
    negative = False
    t1 = []
    terms = t1
    t2 = _regex_peek(s)
    t3 = _core_eq(t2, 94)
    if t3:
        t4 = _regex_take(s)
        negative = True
    else:
        pass
    while True:
        t5 = _regex_peek(s)
        t6 = _core_ne(t5, 93)
        t7 = _core_not(t6)
        if t7:
            break
        else:
            pass
        t8 = _regex_peek(s)
        t9 = _core_lt(t8, 0)
        if t9:
            t10 = _core_string_format("Invalid regular expression: {}", "Unterminated character class")
            t11 = _core_validation_error(t10)
            raise t11
        else:
            pass
        t12 = _regex_class_atom(s)
        first = t12
        t13 = _regex_peek(s)
        t14 = _core_eq(t13, 45)
        t15 = t14
        if t15:
            t16 = _core_get(s, "p", None)
            t17 = _core_add(t16, 1)
            t18 = _core_get(s, "u", None)
            t19 = _core_len(t18)
            t20 = _core_lt(t17, t19)
            t15 = t20
        else:
            pass
        if t15:
            t21 = _core_get(s, "u", None)
            t22 = _core_get(s, "p", None)
            t23 = _core_add(t22, 1)
            t24 = _core_get(t21, t23, None)
            t25 = _core_ne(t24, 93)
            t15 = t25
        else:
            pass
        if t15:
            t26 = _regex_take(s)
            t27 = _regex_class_atom(s)
            last = t27
            t28 = _core_get(first, "k", None)
            t29 = _core_eq(t28, "char")
            t30 = t29
            if t30:
                t31 = _core_get(last, "k", None)
                t32 = _core_eq(t31, "char")
                t30 = t32
            else:
                pass
            if t30:
                t33 = _core_get(first, "c", None)
                t34 = _core_get(last, "c", None)
                t35 = _core_gt(t33, t34)
                if t35:
                    t36 = _core_string_format("Invalid regular expression: {}", "Invalid character range")
                    t37 = _core_validation_error(t36)
                    raise t37
                else:
                    pass
                t38 = {}
                t38["k"] = "range"
                t39 = _core_get(first, "c", None)
                t38["lo"] = t39
                t40 = _core_get(last, "c", None)
                t38["hi"] = t40
                terms.append(t38)
            else:
                terms.append(first)
                t41 = _regex_literal(45)
                terms.append(t41)
                terms.append(last)
        else:
            terms.append(first)
    t42 = _regex_take(s)
    t43 = {}
    t43["k"] = "class"
    t43["negative"] = negative
    t43["terms"] = terms
    return t43


def chat_session_result(response: Any, id: str) -> Any:
    _core_coverage_mark("chat_session_result")
    empty = {}
    response = _core_map_merge(response, empty)
    response["__session_response_id"] = id
    return response


def chat_session_completion(response: Any, id: str) -> Any:
    _core_coverage_mark("chat_session_completion")
    completion = chat_response_to_completion(response)
    completion["remote_id"] = id
    return completion


def chat_session_has_continuation_work(state: Any) -> bool:
    _core_coverage_mark("chat_session_has_continuation_work")
    pending = chat_session_unresolved(state)
    pending = _core_truthy(pending)
    native_wait = chat_session_native_wait(state)
    continuation = _core_get(state, "needs_continuation", False)
    work = _core_or(pending, native_wait)
    work = _core_or(work, continuation)
    return work


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


def chat_session_normalize_call(call: Any) -> Any:
    _core_coverage_mark("chat_session_normalize_call")
    function = _core_get(call, "function", None)
    missing = _core_is_none(function)
    if missing:
        call = _completion_call_to_chat_impl(call)
        function = _core_get(call, "function", None)
    else:
        pass
    name = _core_get(function, "name", None)
    params = _core_get(function, "params", None)
    call["name"] = name
    call["params"] = params
    return call


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


def chat_session_defer_final_call(state: Any, call: Any) -> bool:
    _core_coverage_mark("chat_session_defer_final_call")
    unresolved = chat_session_unresolved(state)
    pending = _core_truthy(unresolved)
    updates = _core_get(state, "needs_continuation", False)
    defer = _core_or(pending, updates)
    if defer:
        registered = chat_session_register_call(state, call, "blocking")
        if registered:
            id = _core_get(call, "id", None)
            result = {}
            result["function_id"] = id
            result["result"] = "Not executed: incorporate the background tool results and queued updates before calling this finalization function again."
            chat_session_complete_call(state, id, result)
        else:
            pass
        return registered
    else:
        pass
    return False


def _regex_atom(s: Any) -> Any:
    _core_coverage_mark("_regex_atom")
    c = _core_none()
    candidate = _core_none()
    capture = _core_none()
    child = _core_none()
    direction = _core_none()
    kind = _core_none()
    mode = _core_none()
    name = _core_none()
    negative = _core_none()
    t1 = _regex_take(s)
    c = t1
    t2 = _core_eq(c, 46)
    if t2:
        t3 = _regex_node("dot")
        return t3
    else:
        pass
    t4 = _core_eq(c, 94)
    if t4:
        t5 = _regex_node("start")
        return t5
    else:
        pass
    t6 = _core_eq(c, 36)
    if t6:
        t7 = _regex_node("end")
        return t7
    else:
        pass
    t8 = _core_eq(c, 92)
    if t8:
        t9 = _regex_escaped(s, False)
        return t9
    else:
        pass
    t10 = _core_eq(c, 91)
    if t10:
        t11 = _regex_character_class(s)
        return t11
    else:
        pass
    t12 = _core_eq(c, 42)
    t13 = t12
    t14 = _core_not(t13)
    if t14:
        t15 = _core_eq(c, 43)
        t13 = t15
    else:
        pass
    t16 = _core_not(t13)
    if t16:
        t17 = _core_eq(c, 63)
        t13 = t17
    else:
        pass
    if t13:
        t18 = _core_string_format("Invalid regular expression: {}", "Nothing to repeat")
        t19 = _core_validation_error(t18)
        raise t19
    else:
        pass
    t20 = _core_eq(c, 40)
    if t20:
        kind = "capture"
        negative = False
        direction = 1
        capture = 0
        t21 = _core_none()
        name = t21
        t22 = _regex_peek(s)
        t23 = _core_eq(t22, 63)
        if t23:
            t24 = _regex_take(s)
            t25 = _regex_take(s)
            mode = t25
            t26 = _core_eq(mode, 58)
            if t26:
                kind = "group"
            else:
                t27 = _core_eq(mode, 61)
                t28 = t27
                t29 = _core_not(t28)
                if t29:
                    t30 = _core_eq(mode, 33)
                    t28 = t30
                else:
                    pass
                if t28:
                    kind = "look"
                    t31 = _core_eq(mode, 33)
                    negative = t31
                else:
                    t32 = _core_eq(mode, 60)
                    if t32:
                        t33 = _regex_peek(s)
                        t34 = _core_eq(t33, 61)
                        t35 = t34
                        t36 = _core_not(t35)
                        if t36:
                            t37 = _regex_peek(s)
                            t38 = _core_eq(t37, 33)
                            t35 = t38
                        else:
                            pass
                        if t35:
                            kind = "look"
                            t39 = _regex_take(s)
                            t40 = _core_eq(t39, 33)
                            negative = t40
                            t41 = _core_mul(-1, 1)
                            t42 = _core_math_floor(t41)
                            direction = t42
                        else:
                            t43 = _regex_read_name(s)
                            name = t43
                    else:
                        t44 = _core_string_format("Invalid regular expression: {}", "Invalid group")
                        t45 = _core_validation_error(t44)
                        raise t45
        else:
            pass
        t46 = _core_eq(kind, "capture")
        if t46:
            t47 = _core_get(s, "next", None)
            t48 = _core_add(t47, 1)
            s["next"] = t48
            t49 = _core_get(s, "next", None)
            capture = t49
        else:
            pass
        t50 = _regex_alternative(s)
        child = t50
        t51 = _regex_take(s)
        t52 = _core_ne(t51, 41)
        if t52:
            t53 = _core_string_format("Invalid regular expression: {}", "Unterminated group")
            t54 = _core_validation_error(t53)
            raise t54
        else:
            pass
        t55 = {}
        t55["k"] = kind
        t55["child"] = child
        t55["id"] = capture
        t55["negative"] = negative
        t55["direction"] = direction
        t55["name"] = name
        return t55
    else:
        pass
    t56 = _core_eq(c, 123)
    if t56:
        t57 = _core_get(s, "p", None)
        t58 = _core_mul(-1, 1)
        t59 = _core_add(t57, t58)
        t60 = _core_math_floor(t59)
        s["p"] = t60
        t61 = _regex_node("empty")
        t62 = _regex_quantifier(s, t61)
        candidate = t62
        t63 = _core_get(candidate, "k", None)
        t64 = _core_eq(t63, "repeat")
        if t64:
            t65 = _core_string_format("Invalid regular expression: {}", "Nothing to repeat")
            t66 = _core_validation_error(t65)
            raise t66
        else:
            pass
        t67 = _regex_take(s)
    else:
        pass
    t68 = _regex_literal(c)
    return t68


def chat_session_complete_call(state: Any, id: str, result: Any) -> bool:
    _core_coverage_mark("chat_session_complete_call")
    terminal = _core_get(state, "terminal", False)
    if terminal:
        return False
    else:
        pass
    pending = _core_get(state, "pending", None)
    exists = _core_map_contains(pending, id)
    missing = _core_not(exists)
    if missing:
        raise RuntimeError("Tool result has no registered call")
    else:
        pass
    record = _core_get(pending, id, None)
    status = _core_get(record, "status", None)
    running = _core_eq(status, "running")
    if running:
        record["result"] = result
        record["status"] = "ready"
        pending[id] = record
        state["pending"] = pending
        return True
    else:
        pass
    return False


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


def _set_examples(gen: AxGen, examples: list[Any]) -> AxGen:
    _core_coverage_mark("_set_examples")
    gen["examples"] = examples
    return gen


def _set_demos(gen: AxGen, demos: list[Any]) -> AxGen:
    _core_coverage_mark("_set_demos")
    gen["demos"] = demos
    return gen


def chat_session_complete_response(state: Any, id: str) -> bool:
    _core_coverage_mark("chat_session_complete_response")
    terminal = _core_get(state, "terminal", False)
    if terminal:
        return False
    else:
        pass
    responses = _core_get(state, "responses", None)
    duplicate = _core_map_contains(responses, id)
    if duplicate:
        return False
    else:
        pass
    steps = _core_get(state, "steps", 0)
    limit = _core_get(state, "max_steps", None)
    exhausted = _core_gte(steps, limit)
    if exhausted:
        raise RuntimeError("Maximum model steps exhausted before final completion")
    else:
        pass
    next = _core_add(steps, 1)
    responses[id] = True
    state["responses"] = responses
    state["response_id"] = id
    state["steps"] = next
    state["boundary"] = True
    updates = _core_get(state, "updates", None)
    update_ids = _core_map_keys(updates)
    had_successor = False
    for update_id in update_ids:
        record = _core_get(updates, update_id, None)
        parent = _core_get(record, "native_parent", None)
        has_parent = _core_is_not_none(parent)
        successor = _core_ne(parent, id)
        finished = _core_and(has_parent, successor)
        if finished:
            had_successor = True
            record["native_state"] = "done"
            updates[update_id] = record
        else:
            pass
    state["updates"] = updates
    if had_successor:
        queued = chat_session_has_queued_updates(state)
        state["needs_continuation"] = queued
    else:
        pass
    return True


def _render_examples(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_examples")
    messages = _core_axgen_render_examples(gen)
    return messages


def _render_demos(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_demos")
    messages = _core_axgen_render_demos(gen)
    return messages


def _apply_field_processors(gen: AxGen, output: Any) -> Any:
    _core_coverage_mark("_apply_field_processors")
    processed = _core_axgen_apply_field_processors(gen, output)
    return processed


def _run_assertions(gen: AxGen, output: Any) -> None:
    _core_coverage_mark("_run_assertions")
    _core_axgen_run_assertions(gen, output)
    return None


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


def chat_session_has_queued_updates(state: Any) -> bool:
    _core_coverage_mark("chat_session_has_queued_updates")
    updates = _core_get(state, "updates", None)
    ids = _core_map_keys(updates)
    for id in ids:
        record = _core_get(updates, id, None)
        status = _core_get(record, "status", None)
        queued = _core_eq(status, "queued")
        if queued:
            return True
        else:
            pass
    return False


def _append_assertion_retry_messages(messages: list[Any], response: Any, error: error) -> None:
    _core_coverage_mark("_append_assertion_retry_messages")
    _append_validation_retry_messages_impl(messages, response, error)
    return None


def _record_trace(gen: AxGen, input: Any, output: Any, status: str) -> None:
    _core_coverage_mark("_record_trace")
    _core_axgen_record_trace(gen, input, output, status)
    return None


def chat_session_native_update(state: Any, id: str) -> bool:
    _core_coverage_mark("chat_session_native_update")
    terminal = _core_get(state, "terminal", False)
    if terminal:
        return False
    else:
        pass
    updates = _core_get(state, "updates", None)
    record = _core_get(updates, id, None)
    native_state = _core_get(record, "native_state", None)
    new_native = _core_is_none(native_state)
    if new_native:
        record["native_state"] = "awaiting_ack"
        responses = _core_get(state, "responses", None)
        empty_baseline = {}
        baseline = _core_map_merge(empty_baseline, responses)
        record["native_responses"] = baseline
        updates[id] = record
        state["updates"] = updates
    else:
        pass
    return new_native


def _should_continue_steps(gen: AxGen, calls: list[Any]) -> bool:
    _core_coverage_mark("_should_continue_steps")
    should_continue = _core_axgen_should_continue_steps(gen, calls)
    return should_continue


def _complete_with_retries_impl(client: AIClient, request: AxChatRequest, options: Any, retries: int) -> Any:
    _core_coverage_mark("_complete_with_retries_impl")
    attempt = 0
    last_error = _core_none()
    while True:
        try:
            response = _core_ai_complete_once(client, request, options)
            return response
        except Exception as error:
            aborted = _core_exception_is_aborted(error)
            if aborted:
                raise error
            else:
                pass
            last_error = error
            exhausted = _core_gte(attempt, retries)
            if exhausted:
                raise error
            else:
                pass
            _core_retry_sleep(attempt, client, options)
            next_attempt = _core_add(attempt, 1)
            attempt = next_attempt
            continue
    raise last_error


def chat_session_native_wait(state: Any) -> bool:
    _core_coverage_mark("chat_session_native_wait")
    updates = _core_get(state, "updates", None)
    ids = _core_map_keys(updates)
    for id in ids:
        record = _core_get(updates, id, None)
        native_state = _core_get(record, "native_state", None)
        has_native = _core_is_not_none(native_state)
        if has_native:
            status = _core_get(record, "status", None)
            queued = _core_eq(status, "queued")
            successor = _core_eq(native_state, "awaiting_successor")
            waiting = _core_or(queued, successor)
            if waiting:
                return True
            else:
                pass
        else:
            pass
    return False


def chat_session_native_event(state: Any, event: Any) -> Any:
    _core_coverage_mark("chat_session_native_event")
    result = {}
    result["changed"] = False
    terminal = _core_get(state, "terminal", False)
    if terminal:
        return result
    else:
        pass
    status = _core_get(event, "status", None)
    failed = _core_eq(status, "failed")
    if failed:
        error = _core_get(event, "error", "Provider rejected steering")
        raise error
    else:
        pass
    updates = _core_get(state, "updates", None)
    ids = _core_map_keys(updates)
    steer_id = _core_get(event, "steer_id", None)
    selected = _core_none()
    for id in ids:
        record = _core_get(updates, id, None)
        record_steer = _core_get(record, "steer_id", None)
        same = _core_eq(record_steer, steer_id)
        has_steer = _core_is_not_none(steer_id)
        matches = _core_and(same, has_steer)
        if matches:
            selected = id
        else:
            pass
    missing = _core_is_none(selected)
    if missing:
        for id in ids:
            record = _core_get(updates, id, None)
            native_state = _core_get(record, "native_state", None)
            record_steer = _core_get(record, "steer_id", None)
            waiting = _core_eq(native_state, "awaiting_ack")
            unassigned = _core_is_none(record_steer)
            missing = _core_is_none(selected)
            candidate = _core_and(waiting, unassigned)
            choose_record = _core_and(missing, candidate)
            if choose_record:
                selected = id
            else:
                pass
    else:
        pass
    found = _core_is_not_none(selected)
    if found:
        record = _core_get(updates, selected, None)
        record["steer_id"] = steer_id
        parent = _core_get(event, "response_id", None)
        record["native_parent"] = parent
        native_state = _core_get(record, "native_state", None)
        empty_map = {}
        baseline = _core_get(record, "native_responses", empty_map)
        responses = _core_get(state, "responses", None)
        response_ids = _core_map_keys(responses)
        for response_id in response_ids:
            old_response = _core_map_contains(baseline, response_id)
            new_response = _core_not(old_response)
            not_parent = _core_ne(response_id, parent)
            successor_seen = _core_and(new_response, not_parent)
            if successor_seen:
                native_state = "done"
                record["native_state"] = "done"
            else:
                pass
        pending_status = _core_eq(status, "pending")
        done = _core_eq(native_state, "done")
        not_done = _core_not(done)
        pending = _core_and(pending_status, not_done)
        if pending:
            changed_state = _core_ne(native_state, "pending_input")
            record["native_state"] = "pending_input"
            empty = []
            required = _core_get(event, "required_call_ids", empty)
            old_required = _core_get(record, "required_call_ids", empty)
            changed_ids = _core_ne(required, old_required)
            changed = _core_or(changed_state, changed_ids)
            record["required_call_ids"] = required
            state["needs_continuation"] = True
            result["changed"] = changed
        else:
            accepted = _core_eq(status, "accepted")
            if accepted:
                record_status = _core_get(record, "status", None)
                queued = _core_eq(record_status, "queued")
                if queued:
                    pending_input = _core_eq(native_state, "pending_input")
                    done = _core_eq(native_state, "done")
                    settled = _core_or(pending_input, done)
                    await_successor = _core_not(settled)
                    if await_successor:
                        record["native_state"] = "awaiting_successor"
                    else:
                        pass
                    record["status"] = "applied"
                    version = _core_get(state, "version", 0)
                    version = _core_add(version, 1)
                    state["version"] = version
                    result["changed"] = True
                    result["applied_id"] = selected
                else:
                    pass
            else:
                pass
        updates[selected] = record
        state["updates"] = updates
        accepted = _core_eq(status, "accepted")
        native_state = _core_get(record, "native_state", None)
        pending_input = _core_eq(native_state, "pending_input")
        not_pending = _core_not(pending_input)
        can_clear = _core_and(accepted, not_pending)
        if can_clear:
            queued = chat_session_has_queued_updates(state)
            state["needs_continuation"] = queued
        else:
            pass
    else:
        pass
    return result


def _parse_output_impl(content: str) -> Any:
    _core_coverage_mark("_parse_output_impl")
    text = str(content).strip()
    output = _core_json_parse_strict(text)
    return output


def _regex_quantifier(s: Any, child: Any) -> Any:
    _core_coverage_mark("_regex_quantifier")
    c = _core_none()
    hi = _core_none()
    lazy = _core_none()
    lo = _core_none()
    start = _core_none()
    t1 = _core_get(s, "p", None)
    start = t1
    t2 = _regex_peek(s)
    c = t2
    lo = 0
    t3 = _core_mul(-1, 1)
    t4 = _core_math_floor(t3)
    hi = t4
    t5 = _core_eq(c, 42)
    if t5:
        t6 = _regex_take(s)
    else:
        t7 = _core_eq(c, 43)
        if t7:
            t8 = _regex_take(s)
            lo = 1
        else:
            t9 = _core_eq(c, 63)
            if t9:
                t10 = _regex_take(s)
                hi = 1
            else:
                t11 = _core_eq(c, 123)
                if t11:
                    t12 = _regex_take(s)
                    t13 = _regex_peek(s)
                    t14 = _regex_digit(t13)
                    t15 = _core_not(t14)
                    if t15:
                        s["p"] = start
                        return child
                    else:
                        pass
                    while True:
                        t16 = _regex_peek(s)
                        t17 = _regex_digit(t16)
                        t18 = _core_not(t17)
                        if t18:
                            break
                        else:
                            pass
                        t19 = _core_mul(lo, 10)
                        t20 = _core_math_floor(t19)
                        t21 = _regex_take(s)
                        t22 = _core_add(t20, t21)
                        t23 = _core_mul(-1, 48)
                        t24 = _core_add(t22, t23)
                        t25 = _core_math_floor(t24)
                        lo = t25
                    hi = lo
                    t26 = _regex_peek(s)
                    t27 = _core_eq(t26, 44)
                    if t27:
                        t28 = _regex_take(s)
                        t29 = _core_mul(-1, 1)
                        t30 = _core_math_floor(t29)
                        hi = t30
                        t31 = _regex_peek(s)
                        t32 = _regex_digit(t31)
                        if t32:
                            hi = 0
                            while True:
                                t33 = _regex_peek(s)
                                t34 = _regex_digit(t33)
                                t35 = _core_not(t34)
                                if t35:
                                    break
                                else:
                                    pass
                                t36 = _core_mul(hi, 10)
                                t37 = _core_math_floor(t36)
                                t38 = _regex_take(s)
                                t39 = _core_add(t37, t38)
                                t40 = _core_mul(-1, 48)
                                t41 = _core_add(t39, t40)
                                t42 = _core_math_floor(t41)
                                hi = t42
                        else:
                            pass
                    else:
                        pass
                    t43 = _regex_peek(s)
                    t44 = _core_ne(t43, 125)
                    if t44:
                        s["p"] = start
                        return child
                    else:
                        pass
                    t45 = _regex_take(s)
                    t46 = _core_gte(hi, 0)
                    t47 = t46
                    if t47:
                        t48 = _core_lt(hi, lo)
                        t47 = t48
                    else:
                        pass
                    if t47:
                        t49 = _core_string_format("Invalid regular expression: {}", "Invalid quantifier range")
                        t50 = _core_validation_error(t49)
                        raise t50
                    else:
                        pass
                else:
                    return child
    t51 = _core_get(child, "k", None)
    t52 = _core_eq(t51, "start")
    t53 = t52
    t54 = _core_not(t53)
    if t54:
        t55 = _core_get(child, "k", None)
        t56 = _core_eq(t55, "end")
        t53 = t56
    else:
        pass
    t57 = _core_not(t53)
    if t57:
        t58 = _core_get(child, "k", None)
        t59 = _core_eq(t58, "boundary")
        t53 = t59
    else:
        pass
    t60 = _core_not(t53)
    if t60:
        t61 = _core_get(child, "k", None)
        t62 = _core_eq(t61, "look")
        t63 = t62
        if t63:
            t64 = _core_get(child, "direction", None)
            t65 = _core_mul(-1, 1)
            t66 = _core_math_floor(t65)
            t67 = _core_eq(t64, t66)
            t63 = t67
        else:
            pass
        t53 = t63
    else:
        pass
    if t53:
        t68 = _core_string_format("Invalid regular expression: {}", "Invalid quantified assertion")
        t69 = _core_validation_error(t68)
        raise t69
    else:
        pass
    lazy = False
    t70 = _regex_peek(s)
    t71 = _core_eq(t70, 63)
    if t71:
        t72 = _regex_take(s)
        lazy = True
    else:
        pass
    t73 = {}
    t73["k"] = "repeat"
    t73["child"] = child
    t73["lo"] = lo
    t73["hi"] = hi
    t73["lazy"] = lazy
    return t73


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
    has_description = _core_truthy(description)
    if has_description:
        out["description"] = description
    else:
        pass
    return out


def _ace_render_playbook(playbook: Any) -> str:
    _core_coverage_mark("_ace_render_playbook")
    empty_map = {}
    empty_list = []
    description = _core_get(playbook, "description", None)
    has_description = _core_truthy(description)
    sections = _core_get(playbook, "sections", empty_map)
    section_names = _core_map_keys(sections)
    bullet_count = 0
    for section_name in section_names:
        section_bullets = _core_get(sections, section_name, empty_list)
        section_count = _core_len(section_bullets)
        next_bullet_count = _core_add(bullet_count, section_count)
        bullet_count = next_bullet_count
    has_bullets = _core_gt(bullet_count, 0)
    no_bullets = _core_not(has_bullets)
    no_description = _core_not(has_description)
    empty_playbook = _core_and(no_bullets, no_description)
    if empty_playbook:
        return ""
    else:
        pass
    header = "## Context Playbook\n"
    if has_description:
        trimmed_description = str(description).strip()
        header_with_description = _core_string_format("## Context Playbook\n{}\n", trimmed_description)
        header = header_with_description
    else:
        pass
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


def chat_session_boundary_action(state: Any) -> Any:
    _core_coverage_mark("chat_session_boundary_action")
    action = {}
    action["type"] = "wait"
    terminal = _core_get(state, "terminal", False)
    if terminal:
        action["type"] = "closed"
        return action
    else:
        pass
    native_wait = chat_session_native_wait(state)
    if native_wait:
        return action
    else:
        pass
    boundary = _core_get(state, "boundary", False)
    active = _core_not(boundary)
    if active:
        return action
    else:
        pass
    pending = _core_get(state, "pending", None)
    ids = _core_map_keys(pending)
    results = []
    running = False
    blocking = False
    for id in ids:
        record = _core_get(pending, id, None)
        status = _core_get(record, "status", None)
        is_running = _core_eq(status, "running")
        execution = _core_get(record, "execution", None)
        is_blocking = _core_eq(execution, "blocking")
        running_barrier = _core_and(is_running, is_blocking)
        blocking = _core_or(blocking, running_barrier)
        running = _core_or(running, is_running)
        ready = _core_eq(status, "ready")
        if ready:
            result = _core_get(record, "result", None)
            results.append(result)
        else:
            pass
    if blocking:
        return action
    else:
        pass
    has_results = _core_truthy(results)
    if has_results:
        action["type"] = "submit"
        action["results"] = results
        return action
    else:
        pass
    if running:
        return action
    else:
        pass
    needs_continuation = _core_get(state, "needs_continuation", False)
    if needs_continuation:
        action["type"] = "continue"
    else:
        action["type"] = "validate"
    return action


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


def _validate_exact_output_keys(fields: list[Any], values: Any, context: str) -> None:
    _core_coverage_mark("_validate_exact_output_keys")
    is_object = _core_type_is(values, "object")
    not_object = _core_not(is_object)
    if not_object:
        object_message = _core_string_format("{} must be one JSON object", context)
        object_error = _core_validation_error(object_message)
        raise object_error
    else:
        pass
    keys = _core_map_keys(values)
    for key in keys:
        known = False
        for field in fields:
            field_name = _core_get(field, "name", None)
            matches = _core_eq(field_name, key)
            if matches:
                known = True
            else:
                pass
        unknown = _core_not(known)
        if unknown:
            unknown_message = _core_string_format("Unexpected field '{}' in {}. Use only the exact declared wire keys.", key, context)
            unknown_error = _core_validation_error(unknown_message)
            raise unknown_error
        else:
            pass
    for field in fields:
        field_name = _core_get(field, "name", None)
        has_value = _core_map_contains(values, field_name)
        if has_value:
            typ = _core_get(field, "type", None)
            nested_map = _core_get(typ, "fields", None)
            has_nested = _core_truthy(nested_map)
            if has_nested:
                nested_fields = _core_fields_from_map(nested_map)
                field_value = _core_get(values, field_name, None)
                child_context = _core_string_format("{}.{}", context, field_name)
                array_snake = _core_get(typ, "is_array", False)
                is_array = _core_get(typ, "isArray", array_snake)
                if is_array:
                    for item in field_value:
                        _validate_exact_output_keys(nested_fields, item, child_context)
                else:
                    _validate_exact_output_keys(nested_fields, field_value, child_context)
            else:
                pass
        else:
            pass
    return None


def _regex_alternative(s: Any) -> Any:
    _core_coverage_mark("_regex_alternative")
    choices = _core_none()
    terms = _core_none()
    t1 = []
    choices = t1
    t2 = []
    terms = t2
    while True:
        t3 = _regex_peek(s)
        t4 = _core_gte(t3, 0)
        t5 = t4
        if t5:
            t6 = _regex_peek(s)
            t7 = _core_ne(t6, 41)
            t5 = t7
        else:
            pass
        t8 = _core_not(t5)
        if t8:
            break
        else:
            pass
        t9 = _regex_peek(s)
        t10 = _core_eq(t9, 124)
        if t10:
            t11 = _regex_take(s)
            t12 = {}
            t12["k"] = "seq"
            t12["terms"] = terms
            choices.append(t12)
            t13 = []
            terms = t13
        else:
            t14 = _regex_atom(s)
            t15 = _regex_quantifier(s, t14)
            terms.append(t15)
    t16 = {}
    t16["k"] = "seq"
    t16["terms"] = terms
    choices.append(t16)
    t17 = {}
    t17["k"] = "alt"
    t17["terms"] = choices
    return t17


def chat_session_mark_submitted(state: Any, ids: list[Any]) -> None:
    _core_coverage_mark("chat_session_mark_submitted")
    pending = _core_get(state, "pending", None)
    for id in ids:
        record = _core_get(pending, id, None)
        record["status"] = "sent"
        pending[id] = record
    state["pending"] = pending
    state["boundary"] = False
    state["needs_continuation"] = False
    return None


def chat_session_queue_update(state: Any, update: Any) -> bool:
    _core_coverage_mark("chat_session_queue_update")
    terminal = _core_get(state, "terminal", False)
    if terminal:
        return False
    else:
        pass
    target = _core_get(update, "target", "root")
    path = _core_get(state, "path", None)
    matches = chat_session_target_matches(target, path)
    unmatched = _core_not(matches)
    if unmatched:
        return False
    else:
        pass
    id = _core_get(update, "id", None)
    updates = _core_get(state, "updates", None)
    exists = _core_map_contains(updates, id)
    if exists:
        return False
    else:
        pass
    record = {}
    record["update"] = update
    record["status"] = "queued"
    updates[id] = record
    state["updates"] = updates
    state["needs_continuation"] = True
    return True


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


def _regex_word(c: Any) -> Any:
    _core_coverage_mark("_regex_word")
    t1 = _core_gte(c, 48)
    t2 = t1
    if t2:
        t3 = _core_lte(c, 57)
        t2 = t3
    else:
        pass
    t4 = t2
    t5 = _core_not(t4)
    if t5:
        t6 = _core_gte(c, 65)
        t7 = t6
        if t7:
            t8 = _core_lte(c, 90)
            t7 = t8
        else:
            pass
        t4 = t7
    else:
        pass
    t9 = _core_not(t4)
    if t9:
        t10 = _core_gte(c, 97)
        t11 = t10
        if t11:
            t12 = _core_lte(c, 122)
            t11 = t12
        else:
            pass
        t4 = t11
    else:
        pass
    t13 = _core_not(t4)
    if t13:
        t14 = _core_eq(c, 95)
        t4 = t14
    else:
        pass
    return t4


def _tool_spec_impl(fn: Tool) -> Any:
    _core_coverage_mark("_tool_spec_impl")
    spec = {}
    name = _core_get(fn, "name", None)
    description = _core_get(fn, "description", None)
    parameters = _core_get(fn, "parameters", None)
    spec["name"] = name
    spec["description"] = description
    spec["parameters"] = parameters
    execution = _core_get(fn, "execution", "blocking")
    background = _core_eq(execution, "background")
    if background:
        spec["execution"] = execution
    else:
        pass
    return spec


def chat_session_record_unresolved(gen: Any, state: Any) -> None:
    _core_coverage_mark("chat_session_record_unresolved")
    pending = _core_get(state, "pending", None)
    ids = _core_map_keys(pending)
    for id in ids:
        record = _core_get(pending, id, None)
        status = _core_get(record, "status", None)
        running = _core_eq(status, "running")
        recorded = _core_get(record, "diagnostic_recorded", False)
        not_recorded = _core_not(recorded)
        needed = _core_and(running, not_recorded)
        if needed:
            call = _core_get(record, "call", None)
            message = "Run closed before the started tool settled; its external effects may still complete"
            _core_axgen_record_function_call(gen, call, message, "unresolved")
            record["diagnostic_recorded"] = True
            pending[id] = record
        else:
            pass
    state["pending"] = pending
    return None


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


def chat_session_close_state(state: Any) -> list[Any]:
    _core_coverage_mark("chat_session_close_state")
    state["terminal"] = True
    unresolved = chat_session_unresolved(state)
    return unresolved


def chat_session_transition(state: Any, event: Any) -> Any:
    _core_coverage_mark("chat_session_transition")
    type = _core_get(event, "type", None)
    call = _core_eq(type, "tool.validated")
    result = _core_eq(type, "tool.result")
    response = _core_eq(type, "response.completed")
    update = _core_eq(type, "update.queued")
    submitted = _core_eq(type, "results.submitted")
    closed = _core_eq(type, "closed")
    validated = _core_eq(type, "validated")
    applied = _core_eq(type, "update.applied")
    changed = False
    native_queued = _core_eq(type, "native.queued")
    if native_queued:
        id = _core_get(event, "id", None)
        changed = chat_session_native_update(state, id)
        action = chat_session_boundary_action(state)
        action["changed"] = changed
        return action
    else:
        pass
    steering = _core_eq(type, "steering")
    if steering:
        change = chat_session_native_event(state, event)
        action = chat_session_boundary_action(state)
        action = _core_map_merge(action, change)
        return action
    else:
        pass
    final_call = _core_eq(type, "tool.final")
    if final_call:
        tool_call = _core_get(event, "call", None)
        changed = chat_session_defer_final_call(state, tool_call)
        action = chat_session_boundary_action(state)
        action["changed"] = changed
        return action
    else:
        pass
    if call:
        tool_call = _core_get(event, "call", None)
        execution = _core_get(event, "execution", "blocking")
        changed = chat_session_register_call(state, tool_call, execution)
    else:
        if result:
            id = _core_get(event, "id", None)
            value = _core_get(event, "result", None)
            changed = chat_session_complete_call(state, id, value)
        else:
            if response:
                id = _core_get(event, "id", None)
                changed = chat_session_complete_response(state, id)
            else:
                if update:
                    item = _core_get(event, "update", None)
                    changed = chat_session_queue_update(state, item)
                else:
                    if submitted:
                        ids = _core_get(event, "ids", None)
                        chat_session_mark_submitted(state, ids)
                        changed = True
                    else:
                        if closed:
                            chat_session_close_state(state)
                            changed = True
                        else:
                            if validated:
                                action = chat_session_boundary_action(state)
                                action_type = _core_get(action, "type", None)
                                ready = _core_eq(action_type, "validate")
                                not_ready = _core_not(ready)
                                if not_ready:
                                    raise RuntimeError("Cannot finalize while model or tool work is unresolved")
                                else:
                                    pass
                                state["terminal"] = True
                                changed = True
                            else:
                                if applied:
                                    id = _core_get(event, "id", None)
                                    updates = _core_get(state, "updates", None)
                                    exists = _core_map_contains(updates, id)
                                    if exists:
                                        record = _core_get(updates, id, None)
                                        status = _core_get(record, "status", None)
                                        queued = _core_eq(status, "queued")
                                        if queued:
                                            record["status"] = "applied"
                                            updates[id] = record
                                            state["updates"] = updates
                                            item = _core_get(record, "update", None)
                                            kind = _core_get(item, "type", None)
                                            steer = _core_eq(kind, "steer")
                                            if steer:
                                                version = _core_get(state, "version", 0)
                                                next_version = _core_add(version, 1)
                                                state["version"] = next_version
                                            else:
                                                pass
                                            changed = True
                                        else:
                                            pass
                                    else:
                                        pass
                                else:
                                    raise RuntimeError("Unknown chat session transition")
    action = chat_session_boundary_action(state)
    action["changed"] = changed
    return action


def _regex_space(c: Any) -> Any:
    _core_coverage_mark("_regex_space")
    t1 = _core_eq(c, 9)
    t2 = t1
    t3 = _core_not(t2)
    if t3:
        t4 = _core_eq(c, 10)
        t2 = t4
    else:
        pass
    t5 = _core_not(t2)
    if t5:
        t6 = _core_eq(c, 11)
        t2 = t6
    else:
        pass
    t7 = _core_not(t2)
    if t7:
        t8 = _core_eq(c, 12)
        t2 = t8
    else:
        pass
    t9 = _core_not(t2)
    if t9:
        t10 = _core_eq(c, 13)
        t2 = t10
    else:
        pass
    t11 = _core_not(t2)
    if t11:
        t12 = _core_eq(c, 32)
        t2 = t12
    else:
        pass
    t13 = _core_not(t2)
    if t13:
        t14 = _core_eq(c, 160)
        t2 = t14
    else:
        pass
    t15 = _core_not(t2)
    if t15:
        t16 = _core_eq(c, 5760)
        t2 = t16
    else:
        pass
    t17 = _core_not(t2)
    if t17:
        t18 = _core_gte(c, 8192)
        t19 = t18
        if t19:
            t20 = _core_lte(c, 8202)
            t19 = t20
        else:
            pass
        t2 = t19
    else:
        pass
    t21 = _core_not(t2)
    if t21:
        t22 = _core_eq(c, 8232)
        t2 = t22
    else:
        pass
    t23 = _core_not(t2)
    if t23:
        t24 = _core_eq(c, 8233)
        t2 = t24
    else:
        pass
    t25 = _core_not(t2)
    if t25:
        t26 = _core_eq(c, 8239)
        t2 = t26
    else:
        pass
    t27 = _core_not(t2)
    if t27:
        t28 = _core_eq(c, 8287)
        t2 = t28
    else:
        pass
    t29 = _core_not(t2)
    if t29:
        t30 = _core_eq(c, 12288)
        t2 = t30
    else:
        pass
    t31 = _core_not(t2)
    if t31:
        t32 = _core_eq(c, 65279)
        t2 = t32
    else:
        pass
    return t2


def _response_function_calls_impl(response: Any) -> list[Any]:
    _core_coverage_mark("_response_function_calls_impl")
    empty = []
    calls = _core_get(response, "function_calls", empty)
    return calls


def _append_tool_call_messages_impl(messages: list[Any], response: Any, calls: list[Any]) -> list[Any]:
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
    thought = _core_get(response, "thought", None)
    has_thought = _core_is_not_none(thought)
    if has_thought:
        message["thought"] = thought
    else:
        pass
    thought_blocks = _core_get(response, "thought_blocks", None)
    has_thought_blocks = _core_is_not_none(thought_blocks)
    if has_thought_blocks:
        message["thought_blocks"] = thought_blocks
    else:
        pass
    images = _core_get(response, "images", None)
    has_images = _core_is_not_none(images)
    if has_images:
        message["images"] = images
    else:
        pass
    phase = _core_get(response, "phase", None)
    has_phase = _core_is_not_none(phase)
    if has_phase:
        message["phase"] = phase
    else:
        pass
    messages.append(message)
    return messages


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
    operation_index = 0
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
                                bullet_id_prefix = _core_string_format("{}-{}-{}", section_name, now, section_len)
                                bullet_id = _core_string_format("{}-{}", bullet_id_prefix, operation_index)
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
        next_operation_index = _core_add(operation_index, 1)
        operation_index = next_operation_index
    playbook["sections"] = sections
    recomputed = _ace_recompute_playbook_stats(playbook)
    recomputed["updatedAt"] = now
    out = {}
    out["playbook"] = recomputed
    out["updatedBulletIds"] = updated_bullets
    out["autoRemoved"] = auto_removed
    return out


def _tool_result_message_impl(call: Any, result: Any) -> Any:
    _core_coverage_mark("_tool_result_message_impl")
    id = _core_get(call, "id", None)
    name = _core_get(call, "name", None)
    result_json = _core_json_stringify(result)
    message = {}
    message["role"] = "function"
    message["function_id"] = id
    message["name"] = name
    message["result"] = result_json
    return message


def _regex_member(n: Any, c: Any) -> Any:
    _core_coverage_mark("_regex_member")
    e = _core_none()
    k = _core_none()
    term = _core_none()
    yes = _core_none()
    t1 = _core_get(n, "k", None)
    k = t1
    t2 = _core_eq(k, "char")
    if t2:
        t3 = _core_get(n, "c", None)
        t4 = _core_eq(c, t3)
        return t4
    else:
        pass
    t5 = _core_eq(k, "range")
    if t5:
        t6 = _core_get(n, "lo", None)
        t7 = _core_gte(c, t6)
        t8 = t7
        if t8:
            t9 = _core_get(n, "hi", None)
            t10 = _core_lte(c, t9)
            t8 = t10
        else:
            pass
        return t8
    else:
        pass
    t11 = _core_eq(k, "dot")
    if t11:
        t12 = _core_ne(c, 10)
        t13 = t12
        if t13:
            t14 = _core_ne(c, 13)
            t13 = t14
        else:
            pass
        if t13:
            t15 = _core_ne(c, 8232)
            t13 = t15
        else:
            pass
        if t13:
            t16 = _core_ne(c, 8233)
            t13 = t16
        else:
            pass
        return t13
    else:
        pass
    t17 = _core_eq(k, "class_escape")
    if t17:
        t18 = _core_get(n, "c", None)
        e = t18
        yes = False
        t19 = _core_eq(e, 100)
        t20 = t19
        t21 = _core_not(t20)
        if t21:
            t22 = _core_eq(e, 68)
            t20 = t22
        else:
            pass
        if t20:
            t23 = _regex_digit(c)
            yes = t23
        else:
            pass
        t24 = _core_eq(e, 119)
        t25 = t24
        t26 = _core_not(t25)
        if t26:
            t27 = _core_eq(e, 87)
            t25 = t27
        else:
            pass
        if t25:
            t28 = _regex_word(c)
            yes = t28
        else:
            pass
        t29 = _core_eq(e, 115)
        t30 = t29
        t31 = _core_not(t30)
        if t31:
            t32 = _core_eq(e, 83)
            t30 = t32
        else:
            pass
        if t30:
            t33 = _regex_space(c)
            yes = t33
        else:
            pass
        t34 = _core_eq(e, 68)
        t35 = t34
        t36 = _core_not(t35)
        if t36:
            t37 = _core_eq(e, 87)
            t35 = t37
        else:
            pass
        t38 = _core_not(t35)
        if t38:
            t39 = _core_eq(e, 83)
            t35 = t39
        else:
            pass
        if t35:
            t40 = _core_not(yes)
            return t40
        else:
            pass
        return yes
    else:
        pass
    t41 = _core_eq(k, "class")
    if t41:
        yes = False
        t42 = _core_get(n, "terms", None)
        for iter_43 in t42:
            term = iter_43
            t44 = _regex_member(term, c)
            if t44:
                yes = True
            else:
                pass
        t45 = _core_get(n, "negative", None)
        if t45:
            t46 = _core_not(yes)
            return t46
        else:
            pass
        return yes
    else:
        pass
    return False


def _tool_error_message_impl(call: Any, error: error) -> Any:
    _core_coverage_mark("_tool_error_message_impl")
    id = _core_get(call, "id", None)
    name = _core_get(call, "name", None)
    error_text = _core_exception_message(error)
    payload = {}
    payload["error"] = error_text
    payload_json = _core_json_stringify(payload)
    message = {}
    message["role"] = "function"
    message["function_id"] = id
    message["name"] = name
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


def _regex_state(pos: Any, caps: Any) -> Any:
    _core_coverage_mark("_regex_state")
    t1 = {}
    t1["pos"] = pos
    t2 = _regex_copy_map(caps)
    t1["caps"] = t2
    return t1


def _regex_capture_ids(n: Any) -> Any:
    _core_coverage_mark("_regex_capture_ids")
    i = _core_none()
    k = _core_none()
    out = _core_none()
    term = _core_none()
    t1 = []
    out = t1
    t2 = _core_get(n, "k", None)
    k = t2
    t3 = _core_eq(k, "capture")
    if t3:
        t4 = _core_get(n, "id", None)
        out.append(t4)
    else:
        pass
    t5 = _core_map_contains(n, "child")
    if t5:
        t6 = _core_get(n, "child", None)
        t7 = _regex_capture_ids(t6)
        for iter_8 in t7:
            i = iter_8
            out.append(i)
    else:
        pass
    t9 = _core_eq(k, "seq")
    t10 = t9
    t11 = _core_not(t10)
    if t11:
        t12 = _core_eq(k, "alt")
        t10 = t12
    else:
        pass
    if t10:
        t13 = _core_get(n, "terms", None)
        for iter_14 in t13:
            term = iter_14
            t15 = _regex_capture_ids(term)
            for iter_16 in t15:
                i = iter_16
                out.append(i)
    else:
        pass
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


def _regex_push(stack: Any, top: Any, value: Any) -> Any:
    _core_coverage_mark("_regex_push")
    t1 = _core_string_format("{}", top)
    stack[t1] = value
    t2 = _core_add(top, 1)
    return t2


def _regex_task(n: Any, next: Any) -> Any:
    _core_coverage_mark("_regex_task")
    t1 = {}
    t1["node"] = n
    t1["next"] = next
    return t1


def _regex_frame(todo: Any, st: Any) -> Any:
    _core_coverage_mark("_regex_frame")
    t1 = {}
    t1["todo"] = todo
    t1["st"] = st
    return t1


def _regex_search(n: Any, u: Any, initial: Any, d: Any) -> Any:
    _core_coverage_mark("_regex_search")
    accept = _core_none()
    after = _core_none()
    at = _core_none()
    before = _core_none()
    begin = _core_none()
    caps = _core_none()
    capture = _core_none()
    capture_id = _core_none()
    clean = _core_none()
    copied = _core_none()
    count = _core_none()
    current = _core_none()
    end = _core_none()
    equal = _core_none()
    hi = _core_none()
    i = _core_none()
    k = _core_none()
    lo = _core_none()
    matched = _core_none()
    more = _core_none()
    moreframe = _core_none()
    next = _core_none()
    nextcount = _core_none()
    p = _core_none()
    pending = _core_none()
    repeat = _core_none()
    rest = _core_none()
    size = _core_none()
    st = _core_none()
    terms = _core_none()
    todo = _core_none()
    top = _core_none()
    yes = _core_none()
    t1 = {}
    t2 = _core_none()
    t3 = _regex_task(n, t2)
    t4 = _regex_frame(t3, initial)
    t1["0"] = t4
    pending = t1
    top = 1
    while True:
        t5 = _core_gt(top, 0)
        t6 = _core_not(t5)
        if t6:
            break
        else:
            pass
        t7 = _core_mul(-1, 1)
        t8 = _core_add(top, t7)
        t9 = _core_math_floor(t8)
        top = t9
        t10 = _core_string_format("{}", top)
        t11 = _core_get(pending, t10, None)
        current = t11
        t12 = _core_get(current, "todo", None)
        todo = t12
        t13 = _core_get(current, "st", None)
        st = t13
        t14 = _core_none()
        t15 = _core_eq(todo, t14)
        if t15:
            return st
        else:
            pass
        t16 = _core_get(todo, "node", None)
        n = t16
        t17 = _core_get(todo, "next", None)
        rest = t17
        t18 = _core_get(n, "k", None)
        k = t18
        t19 = _core_get(st, "pos", None)
        p = t19
        t20 = _core_get(st, "caps", None)
        caps = t20
        t21 = _core_eq(k, "seq")
        if t21:
            t22 = _core_get(n, "terms", None)
            terms = t22
            t23 = _core_len(terms)
            t24 = _core_mul(-1, 1)
            t25 = _core_add(t23, t24)
            t26 = _core_math_floor(t25)
            i = t26
            t27 = _core_lt(d, 0)
            if t27:
                i = 0
            else:
                pass
            while True:
                t28 = _core_gte(i, 0)
                t29 = t28
                if t29:
                    t30 = _core_len(terms)
                    t31 = _core_lt(i, t30)
                    t29 = t31
                else:
                    pass
                t32 = _core_not(t29)
                if t32:
                    break
                else:
                    pass
                t33 = _core_get(terms, i, None)
                t34 = _regex_task(t33, rest)
                rest = t34
                t35 = _core_mul(-1, d)
                t36 = _core_add(i, t35)
                t37 = _core_math_floor(t36)
                i = t37
            t38 = _regex_frame(rest, st)
            t39 = _regex_push(pending, top, t38)
            top = t39
            continue
        else:
            pass
        t40 = _core_eq(k, "alt")
        if t40:
            t41 = _core_get(n, "terms", None)
            t42 = _core_len(t41)
            t43 = _core_mul(-1, 1)
            t44 = _core_add(t42, t43)
            t45 = _core_math_floor(t44)
            i = t45
            while True:
                t46 = _core_gte(i, 0)
                t47 = _core_not(t46)
                if t47:
                    break
                else:
                    pass
                t48 = _core_get(n, "terms", None)
                t49 = _core_get(t48, i, None)
                t50 = _regex_task(t49, rest)
                t51 = _regex_frame(t50, st)
                t52 = _regex_push(pending, top, t51)
                top = t52
                t53 = _core_mul(-1, 1)
                t54 = _core_add(i, t53)
                t55 = _core_math_floor(t54)
                i = t55
            continue
        else:
            pass
        t56 = _core_eq(k, "group")
        if t56:
            t57 = _core_get(n, "child", None)
            t58 = _regex_task(t57, rest)
            t59 = _regex_frame(t58, st)
            t60 = _regex_push(pending, top, t59)
            top = t60
            continue
        else:
            pass
        t61 = _core_eq(k, "capture")
        if t61:
            t62 = {}
            t62["k"] = "capture_end"
            t63 = _core_get(n, "id", None)
            t62["id"] = t63
            t62["begin"] = p
            t64 = _regex_task(t62, rest)
            end = t64
            t65 = _core_get(n, "child", None)
            t66 = _regex_task(t65, end)
            t67 = _regex_frame(t66, st)
            t68 = _regex_push(pending, top, t67)
            top = t68
            continue
        else:
            pass
        t69 = _core_eq(k, "capture_end")
        if t69:
            t70 = _core_get(n, "begin", None)
            lo = t70
            hi = p
            t71 = _core_lt(d, 0)
            if t71:
                lo = p
                t72 = _core_get(n, "begin", None)
                hi = t72
            else:
                pass
            t73 = _regex_state(p, caps)
            copied = t73
            t74 = []
            t74.append(lo)
            t74.append(hi)
            t75 = _core_get(copied, "caps", None)
            t76 = _core_get(n, "id", None)
            t75[t76] = t74
            t77 = _regex_frame(rest, copied)
            t78 = _regex_push(pending, top, t77)
            top = t78
            continue
        else:
            pass
        t79 = _core_eq(k, "look")
        if t79:
            t80 = _core_get(n, "child", None)
            t81 = _core_get(n, "direction", None)
            t82 = _regex_search(t80, u, st, t81)
            matched = t82
            t83 = _core_get(n, "negative", None)
            if t83:
                t84 = _core_none()
                t85 = _core_eq(matched, t84)
                if t85:
                    t86 = _regex_frame(rest, st)
                    t87 = _regex_push(pending, top, t86)
                    top = t87
                else:
                    pass
            else:
                t88 = _core_none()
                t89 = _core_ne(matched, t88)
                if t89:
                    t90 = _core_get(matched, "caps", None)
                    t91 = _regex_state(p, t90)
                    t92 = _regex_frame(rest, t91)
                    t93 = _regex_push(pending, top, t92)
                    top = t93
                else:
                    pass
            continue
        else:
            pass
        t94 = _core_eq(k, "repeat")
        t95 = t94
        t96 = _core_not(t95)
        if t96:
            t97 = _core_eq(k, "repeat_step")
            t95 = t97
        else:
            pass
        if t95:
            count = 0
            repeat = n
            t98 = _core_eq(k, "repeat_step")
            if t98:
                t99 = _core_get(n, "count", None)
                count = t99
                t100 = _core_get(n, "repeat", None)
                repeat = t100
            else:
                pass
            t101 = _core_get(repeat, "lo", None)
            t102 = _core_gte(count, t101)
            accept = t102
            t103 = _core_get(repeat, "hi", None)
            t104 = _core_lt(t103, 0)
            t105 = t104
            t106 = _core_not(t105)
            if t106:
                t107 = _core_get(repeat, "hi", None)
                t108 = _core_lt(count, t107)
                t105 = t108
            else:
                pass
            more = t105
            t109 = _core_none()
            moreframe = t109
            if more:
                t110 = _regex_state(p, caps)
                clean = t110
                t111 = _core_get(repeat, "child", None)
                t112 = _regex_capture_ids(t111)
                for iter_113 in t112:
                    i = iter_113
                    t114 = _core_none()
                    t115 = _core_get(clean, "caps", None)
                    t115[i] = t114
                t116 = {}
                t116["k"] = "repeat_after"
                t116["repeat"] = repeat
                t116["count"] = count
                t116["begin"] = p
                t117 = _regex_task(t116, rest)
                after = t117
                t118 = _core_get(repeat, "child", None)
                t119 = _regex_task(t118, after)
                t120 = _regex_frame(t119, clean)
                moreframe = t120
            else:
                pass
            t121 = _core_get(repeat, "lazy", None)
            if t121:
                if more:
                    t122 = _regex_push(pending, top, moreframe)
                    top = t122
                else:
                    pass
                if accept:
                    t123 = _regex_frame(rest, st)
                    t124 = _regex_push(pending, top, t123)
                    top = t124
                else:
                    pass
            else:
                if accept:
                    t125 = _regex_frame(rest, st)
                    t126 = _regex_push(pending, top, t125)
                    top = t126
                else:
                    pass
                if more:
                    t127 = _regex_push(pending, top, moreframe)
                    top = t127
                else:
                    pass
            continue
        else:
            pass
        t128 = _core_eq(k, "repeat_after")
        if t128:
            t129 = _core_get(n, "count", None)
            count = t129
            t130 = _core_get(n, "repeat", None)
            repeat = t130
            t131 = _core_add(count, 1)
            nextcount = t131
            t132 = _core_get(n, "begin", None)
            t133 = _core_eq(p, t132)
            if t133:
                t134 = _core_get(repeat, "lo", None)
                t135 = _core_gte(count, t134)
                if t135:
                    continue
                else:
                    pass
                t136 = _core_get(repeat, "lo", None)
                nextcount = t136
            else:
                pass
            t137 = {}
            t137["k"] = "repeat_step"
            t137["repeat"] = repeat
            t137["count"] = nextcount
            t138 = _regex_task(t137, rest)
            next = t138
            t139 = _regex_frame(next, st)
            t140 = _regex_push(pending, top, t139)
            top = t140
            continue
        else:
            pass
        t141 = _core_eq(k, "start")
        if t141:
            t142 = _core_eq(p, 0)
            if t142:
                t143 = _regex_frame(rest, st)
                t144 = _regex_push(pending, top, t143)
                top = t144
            else:
                pass
            continue
        else:
            pass
        t145 = _core_eq(k, "end")
        if t145:
            t146 = _core_len(u)
            t147 = _core_eq(p, t146)
            if t147:
                t148 = _regex_frame(rest, st)
                t149 = _regex_push(pending, top, t148)
                top = t149
            else:
                pass
            continue
        else:
            pass
        t150 = _core_eq(k, "boundary")
        if t150:
            before = False
            after = False
            t151 = _core_gt(p, 0)
            if t151:
                t152 = _core_mul(-1, 1)
                t153 = _core_add(p, t152)
                t154 = _core_math_floor(t153)
                t155 = _core_get(u, t154, None)
                t156 = _regex_word(t155)
                before = t156
            else:
                pass
            t157 = _core_len(u)
            t158 = _core_lt(p, t157)
            if t158:
                t159 = _core_get(u, p, None)
                t160 = _regex_word(t159)
                after = t160
            else:
                pass
            t161 = _core_ne(before, after)
            yes = t161
            t162 = _core_get(n, "negative", None)
            if t162:
                t163 = _core_not(yes)
                yes = t163
            else:
                pass
            if yes:
                t164 = _regex_frame(rest, st)
                t165 = _regex_push(pending, top, t164)
                top = t165
            else:
                pass
            continue
        else:
            pass
        t166 = _core_eq(k, "ref")
        if t166:
            t167 = _core_none()
            capture = t167
            t168 = _core_get(n, "ids", None)
            for iter_169 in t168:
                capture_id = iter_169
                t170 = _core_get(caps, capture_id, None)
                t171 = _core_none()
                t172 = _core_ne(t170, t171)
                if t172:
                    t173 = _core_get(caps, capture_id, None)
                    capture = t173
                else:
                    pass
            t174 = _core_none()
            t175 = _core_eq(capture, t174)
            if t175:
                t176 = _regex_frame(rest, st)
                t177 = _regex_push(pending, top, t176)
                top = t177
                continue
            else:
                pass
            t178 = 1
            t179 = _core_get(capture, t178, None)
            t180 = 0
            t181 = _core_get(capture, t180, None)
            t182 = _core_mul(-1, t181)
            t183 = _core_add(t179, t182)
            t184 = _core_math_floor(t183)
            size = t184
            begin = p
            t185 = _core_lt(d, 0)
            if t185:
                t186 = _core_mul(-1, size)
                t187 = _core_add(p, t186)
                t188 = _core_math_floor(t187)
                begin = t188
            else:
                pass
            t189 = _core_lt(begin, 0)
            t190 = t189
            t191 = _core_not(t190)
            if t191:
                t192 = _core_add(begin, size)
                t193 = _core_len(u)
                t194 = _core_gt(t192, t193)
                t190 = t194
            else:
                pass
            if t190:
                continue
            else:
                pass
            i = 0
            equal = True
            while True:
                t195 = _core_lt(i, size)
                t196 = _core_not(t195)
                if t196:
                    break
                else:
                    pass
                t197 = _core_add(begin, i)
                t198 = _core_get(u, t197, None)
                t199 = 0
                t200 = _core_get(capture, t199, None)
                t201 = _core_add(t200, i)
                t202 = _core_get(u, t201, None)
                t203 = _core_ne(t198, t202)
                if t203:
                    equal = False
                    break
                else:
                    pass
                t204 = _core_add(i, 1)
                i = t204
            if equal:
                t205 = _core_mul(d, size)
                t206 = _core_math_floor(t205)
                t207 = _core_add(p, t206)
                t208 = _regex_state(t207, caps)
                t209 = _regex_frame(rest, t208)
                t210 = _regex_push(pending, top, t209)
                top = t210
            else:
                pass
            continue
        else:
            pass
        at = p
        t211 = _core_lt(d, 0)
        if t211:
            t212 = _core_mul(-1, 1)
            t213 = _core_add(p, t212)
            t214 = _core_math_floor(t213)
            at = t214
        else:
            pass
        t215 = _core_gte(at, 0)
        t216 = t215
        if t216:
            t217 = _core_len(u)
            t218 = _core_lt(at, t217)
            t216 = t218
        else:
            pass
        if t216:
            t219 = _core_get(u, at, None)
            t220 = _regex_member(n, t219)
            t216 = t220
        else:
            pass
        if t216:
            t221 = _core_add(p, d)
            t222 = _regex_state(t221, caps)
            t223 = _regex_frame(rest, t222)
            t224 = _regex_push(pending, top, t223)
            top = t224
        else:
            pass
    t225 = _core_none()
    return t225


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
        bullet_tags = _ace_normalize_reflection_bullet_tags(reflection)
        for tag in bullet_tags:
            tag_id = _core_get(tag, "id", None)
            tag_value = _core_get(tag, "tag", None)
            is_harmful = _core_eq(tag_value, "harmful")
            already_used = _core_map_contains(used_ids, tag_id)
            not_used = _core_not(already_used)
            if not_used:
                located = _ace_locate_bullet_section(playbook, tag_id)
                located_found = _core_is_not_none(located)
                if located_found:
                    located_section = _core_get(located, "section", None)
                    located_id = _core_get(located, "id", None)
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


def _ace_normalize_reflection_bullet_tags(reflection: Any) -> list[Any]:
    _core_coverage_mark("_ace_normalize_reflection_bullet_tags")
    empty_list = []
    raw_bullet_tags = _core_get(reflection, "bulletTags", empty_list)
    candidates = []
    tags_is_list = _core_type_is(raw_bullet_tags, "list")
    if tags_is_list:
        candidates = raw_bullet_tags
    else:
        tags_is_object = _core_type_is(raw_bullet_tags, "object")
        if tags_is_object:
            candidates.append(raw_bullet_tags)
        else:
            pass
    normalized = []
    for tag in candidates:
        tag_is_object = _core_type_is(tag, "object")
        if tag_is_object:
            tag_id = _core_get(tag, "id", None)
            tag_id_is_string = _core_type_is(tag_id, "string")
            tag_value = _core_get(tag, "tag", None)
            tag_value_is_string = _core_type_is(tag_value, "string")
            valid_tag_shape = _core_and(tag_id_is_string, tag_value_is_string)
            if valid_tag_shape:
                normalized.append(tag)
            else:
                pass
        else:
            pass
    return normalized


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


def _regex_test(pattern: Any, value: Any) -> Any:
    _core_coverage_mark("_regex_test")
    groups = _core_none()
    i = _core_none()
    s = _core_none()
    text = _core_none()
    tree = _core_none()
    u = _core_none()
    t1 = _core_string_utf16_units(pattern)
    u = t1
    t2 = _regex_scan_groups(u)
    groups = t2
    t3 = {}
    t3["u"] = u
    t3["p"] = 0
    t4 = _core_get(groups, "count", None)
    t3["total"] = t4
    t5 = _core_get(groups, "names", None)
    t3["names"] = t5
    t3["next"] = 0
    s = t3
    t6 = _regex_alternative(s)
    tree = t6
    t7 = _core_get(s, "p", None)
    t8 = _core_len(u)
    t9 = _core_ne(t7, t8)
    if t9:
        t10 = _core_string_format("Invalid regular expression: {}", "Unmatched group")
        t11 = _core_validation_error(t10)
        raise t11
    else:
        pass
    t12 = {}
    t13 = {}
    t14 = {}
    t14["next"] = 0
    t15 = _regex_validate_names(tree, t12, t13, t14)
    t16 = _core_string_utf16_units(value)
    text = t16
    i = 0
    while True:
        t17 = _core_len(text)
        t18 = _core_lte(i, t17)
        t19 = _core_not(t18)
        if t19:
            break
        else:
            pass
        t20 = {}
        t21 = _regex_state(i, t20)
        t22 = _regex_search(tree, text, t21, 1)
        t23 = _core_none()
        t24 = _core_ne(t22, t23)
        if t24:
            return True
        else:
            pass
        t25 = _core_add(i, 1)
        i = t25
    return False


def _regex_identifier(c: Any, first: Any) -> Any:
    _core_coverage_mark("_regex_identifier")
    entry = _core_none()
    hi = _core_none()
    lo = _core_none()
    mid = _core_none()
    ranges = _core_none()
    t1 = _core_eq(c, 36)
    t2 = t1
    t3 = _core_not(t2)
    if t3:
        t4 = _core_eq(c, 95)
        t2 = t4
    else:
        pass
    if t2:
        return True
    else:
        pass
    t5 = _core_not(first)
    t6 = t5
    if t6:
        t7 = _core_eq(c, 8204)
        t8 = t7
        t9 = _core_not(t8)
        if t9:
            t10 = _core_eq(c, 8205)
            t8 = t10
        else:
            pass
        t6 = t8
    else:
        pass
    if t6:
        return True
    else:
        pass
    t11 = _regex_id_continue_ranges()
    ranges = t11
    if first:
        t12 = _regex_id_start_ranges()
        ranges = t12
    else:
        pass
    lo = 0
    t13 = _core_len(ranges)
    hi = t13
    while True:
        t14 = _core_lt(lo, hi)
        t15 = _core_not(t14)
        if t15:
            break
        else:
            pass
        t16 = _core_add(lo, hi)
        t17 = _core_div(t16, 2)
        t18 = _core_math_floor(t17)
        mid = t18
        t19 = _core_get(ranges, mid, None)
        entry = t19
        t20 = 0
        t21 = _core_get(entry, t20, None)
        t22 = _core_lt(c, t21)
        if t22:
            hi = mid
        else:
            t23 = 1
            t24 = _core_get(entry, t23, None)
            t25 = _core_gt(c, t24)
            if t25:
                t26 = _core_add(mid, 1)
                lo = t26
            else:
                return True
    return False


def _regex_read_name(s: Any) -> Any:
    _core_coverage_mark("_regex_read_name")
    c = _core_none()
    i = _core_none()
    n = _core_none()
    name = _core_none()
    values = _core_none()
    t1 = []
    values = t1
    while True:
        t2 = _regex_peek(s)
        t3 = _core_ne(t2, 62)
        t4 = t3
        if t4:
            t5 = _regex_peek(s)
            t6 = _core_gte(t5, 0)
            t4 = t6
        else:
            pass
        t7 = _core_not(t4)
        if t7:
            break
        else:
            pass
        t8 = _regex_take(s)
        c = t8
        t9 = _core_eq(c, 92)
        if t9:
            t10 = _regex_take(s)
            t11 = _core_ne(t10, 117)
            if t11:
                t12 = _core_string_format("Invalid regular expression: {}", "Invalid capture name escape")
                t13 = _core_validation_error(t12)
                raise t13
            else:
                pass
            c = 0
            n = 0
            t14 = _regex_peek(s)
            t15 = _core_eq(t14, 123)
            if t15:
                t16 = _regex_take(s)
                while True:
                    t17 = _regex_peek(s)
                    t18 = _regex_hexdigit(t17)
                    t19 = _core_gte(t18, 0)
                    t20 = _core_not(t19)
                    if t20:
                        break
                    else:
                        pass
                    t21 = _core_mul(c, 16)
                    t22 = _core_math_floor(t21)
                    t23 = _regex_take(s)
                    t24 = _regex_hexdigit(t23)
                    t25 = _core_add(t22, t24)
                    c = t25
                    t26 = _core_add(n, 1)
                    n = t26
                t27 = _core_eq(n, 0)
                t28 = t27
                t29 = _core_not(t28)
                if t29:
                    t30 = _regex_take(s)
                    t31 = _core_ne(t30, 125)
                    t28 = t31
                else:
                    pass
                t32 = _core_not(t28)
                if t32:
                    t33 = _core_gt(c, 1114111)
                    t28 = t33
                else:
                    pass
                if t28:
                    t34 = _core_string_format("Invalid regular expression: {}", "Invalid Unicode capture name")
                    t35 = _core_validation_error(t34)
                    raise t35
                else:
                    pass
            else:
                while True:
                    t36 = _core_lt(n, 4)
                    t37 = t36
                    if t37:
                        t38 = _regex_peek(s)
                        t39 = _regex_hexdigit(t38)
                        t40 = _core_gte(t39, 0)
                        t37 = t40
                    else:
                        pass
                    t41 = _core_not(t37)
                    if t41:
                        break
                    else:
                        pass
                    t42 = _core_mul(c, 16)
                    t43 = _core_math_floor(t42)
                    t44 = _regex_take(s)
                    t45 = _regex_hexdigit(t44)
                    t46 = _core_add(t43, t45)
                    c = t46
                    t47 = _core_add(n, 1)
                    n = t47
                t48 = _core_ne(n, 4)
                if t48:
                    t49 = _core_string_format("Invalid regular expression: {}", "Invalid Unicode capture name")
                    t50 = _core_validation_error(t49)
                    raise t50
                else:
                    pass
        else:
            pass
        values.append(c)
    t51 = _regex_take(s)
    t52 = _core_ne(t51, 62)
    t53 = t52
    t54 = _core_not(t53)
    if t54:
        t55 = _core_len(values)
        t56 = _core_eq(t55, 0)
        t53 = t56
    else:
        pass
    if t53:
        t57 = _core_string_format("Invalid regular expression: {}", "Invalid capture name")
        t58 = _core_validation_error(t57)
        raise t58
    else:
        pass
    name = ""
    i = 0
    while True:
        t59 = _core_len(values)
        t60 = _core_lt(i, t59)
        t61 = _core_not(t60)
        if t61:
            break
        else:
            pass
        t62 = _core_get(values, i, None)
        c = t62
        t63 = _core_add(i, 1)
        i = t63
        t64 = _core_gte(c, 55296)
        t65 = t64
        if t65:
            t66 = _core_lte(c, 56319)
            t65 = t66
        else:
            pass
        if t65:
            t67 = _core_len(values)
            t68 = _core_lt(i, t67)
            t65 = t68
        else:
            pass
        if t65:
            t69 = _core_get(values, i, None)
            t70 = _core_gte(t69, 56320)
            t65 = t70
        else:
            pass
        if t65:
            t71 = _core_get(values, i, None)
            t72 = _core_lte(t71, 57343)
            t65 = t72
        else:
            pass
        if t65:
            t73 = _core_mul(-1, 55296)
            t74 = _core_add(c, t73)
            t75 = _core_math_floor(t74)
            t76 = _core_mul(t75, 1024)
            t77 = _core_math_floor(t76)
            t78 = _core_add(65536, t77)
            t79 = _core_get(values, i, None)
            t80 = _core_add(t78, t79)
            t81 = _core_mul(-1, 56320)
            t82 = _core_add(t80, t81)
            t83 = _core_math_floor(t82)
            c = t83
            t84 = _core_add(i, 1)
            i = t84
        else:
            pass
        t85 = _core_eq(name, "")
        t86 = _regex_identifier(c, t85)
        t87 = _core_not(t86)
        if t87:
            t88 = _core_string_format("Invalid regular expression: {}", "Invalid capture identifier")
            t89 = _core_validation_error(t88)
            raise t89
        else:
            pass
        t90 = _core_string_format("{}", c)
        t91 = _core_add(t90, ",")
        t92 = _core_add(name, t91)
        name = t92
    return name


def _regex_validate_names(n: Any, path: Any, seen: Any, counter: Any) -> Any:
    _core_coverage_mark("_regex_validate_names")
    branch = _core_none()
    exclusive = _core_none()
    index = _core_none()
    k = _core_none()
    key = _core_none()
    name = _core_none()
    other = _core_none()
    previous = _core_none()
    term = _core_none()
    t1 = _core_get(n, "k", None)
    k = t1
    t2 = _core_eq(k, "capture")
    t3 = t2
    if t3:
        t4 = _core_get(n, "name", None)
        t5 = _core_none()
        t6 = _core_ne(t4, t5)
        t3 = t6
    else:
        pass
    if t3:
        t7 = _core_get(n, "name", None)
        name = t7
        t8 = _core_get(seen, name, None)
        previous = t8
        t9 = _core_none()
        t10 = _core_eq(previous, t9)
        if t10:
            t11 = []
            previous = t11
        else:
            pass
        for iter_12 in previous:
            other = iter_12
            exclusive = False
            t13 = _core_map_keys(path)
            for iter_14 in t13:
                key = iter_14
                t15 = _core_get(other, key, None)
                t16 = _core_none()
                t17 = _core_ne(t15, t16)
                t18 = t17
                if t18:
                    t19 = _core_get(other, key, None)
                    t20 = _core_get(path, key, None)
                    t21 = _core_ne(t19, t20)
                    t18 = t21
                else:
                    pass
                if t18:
                    exclusive = True
                else:
                    pass
            t22 = _core_not(exclusive)
            if t22:
                t23 = _core_string_format("Invalid regular expression: {}", "Duplicate capture name")
                t24 = _core_validation_error(t23)
                raise t24
            else:
                pass
        t25 = _regex_copy_map(path)
        previous.append(t25)
        seen[name] = previous
    else:
        pass
    t26 = _core_eq(k, "alt")
    if t26:
        t27 = _core_get(counter, "next", None)
        t28 = _core_add(t27, 1)
        counter["next"] = t28
        t29 = _core_get(counter, "next", None)
        key = t29
        index = 0
        t30 = _core_get(n, "terms", None)
        for iter_31 in t30:
            term = iter_31
            t32 = _regex_copy_map(path)
            branch = t32
            branch[key] = index
            t33 = _core_add(index, 1)
            index = t33
            t34 = _regex_validate_names(term, branch, seen, counter)
    else:
        t35 = _core_eq(k, "seq")
        if t35:
            t36 = _core_get(n, "terms", None)
            for iter_37 in t36:
                term = iter_37
                t38 = _regex_validate_names(term, path, seen, counter)
        else:
            t39 = _core_get(n, "child", None)
            t40 = _core_none()
            t41 = _core_ne(t39, t40)
            if t41:
                t42 = _core_get(n, "child", None)
                t43 = _regex_validate_names(t42, path, seen, counter)
            else:
                pass
    return None


def _regex_id_start_ranges() -> Any:
    _core_coverage_mark("_regex_id_start_ranges")
    t1 = _core_json_parse("[[65,90],[97,122],[170,170],[181,181],[186,186],[192,214],[216,246],[248,705],[710,721],[736,740],[748,748],[750,750],[880,884],[886,887],[890,893],[895,895],[902,902],[904,906],[908,908],[910,929],[931,1013],[1015,1153],[1162,1327],[1329,1366],[1369,1369],[1376,1416],[1488,1514],[1519,1522],[1568,1610],[1646,1647],[1649,1747],[1749,1749],[1765,1766],[1774,1775],[1786,1788],[1791,1791],[1808,1808],[1810,1839],[1869,1957],[1969,1969],[1994,2026],[2036,2037],[2042,2042],[2048,2069],[2074,2074],[2084,2084],[2088,2088],[2112,2136],[2144,2154],[2160,2183],[2185,2191],[2208,2249],[2308,2361],[2365,2365],[2384,2384],[2392,2401],[2417,2432],[2437,2444],[2447,2448],[2451,2472],[2474,2480],[2482,2482],[2486,2489],[2493,2493],[2510,2510],[2524,2525],[2527,2529],[2544,2545],[2556,2556],[2565,2570],[2575,2576],[2579,2600],[2602,2608],[2610,2611],[2613,2614],[2616,2617],[2649,2652],[2654,2654],[2674,2676],[2693,2701],[2703,2705],[2707,2728],[2730,2736],[2738,2739],[2741,2745],[2749,2749],[2768,2768],[2784,2785],[2809,2809],[2821,2828],[2831,2832],[2835,2856],[2858,2864],[2866,2867],[2869,2873],[2877,2877],[2908,2909],[2911,2913],[2929,2929],[2947,2947],[2949,2954],[2958,2960],[2962,2965],[2969,2970],[2972,2972],[2974,2975],[2979,2980],[2984,2986],[2990,3001],[3024,3024],[3077,3084],[3086,3088],[3090,3112],[3114,3129],[3133,3133],[3160,3162],[3164,3165],[3168,3169],[3200,3200],[3205,3212],[3214,3216],[3218,3240],[3242,3251],[3253,3257],[3261,3261],[3292,3294],[3296,3297],[3313,3314],[3332,3340],[3342,3344],[3346,3386],[3389,3389],[3406,3406],[3412,3414],[3423,3425],[3450,3455],[3461,3478],[3482,3505],[3507,3515],[3517,3517],[3520,3526],[3585,3632],[3634,3635],[3648,3654],[3713,3714],[3716,3716],[3718,3722],[3724,3747],[3749,3749],[3751,3760],[3762,3763],[3773,3773],[3776,3780],[3782,3782],[3804,3807],[3840,3840],[3904,3911],[3913,3948],[3976,3980],[4096,4138],[4159,4159],[4176,4181],[4186,4189],[4193,4193],[4197,4198],[4206,4208],[4213,4225],[4238,4238],[4256,4293],[4295,4295],[4301,4301],[4304,4346],[4348,4680],[4682,4685],[4688,4694],[4696,4696],[4698,4701],[4704,4744],[4746,4749],[4752,4784],[4786,4789],[4792,4798],[4800,4800],[4802,4805],[4808,4822],[4824,4880],[4882,4885],[4888,4954],[4992,5007],[5024,5109],[5112,5117],[5121,5740],[5743,5759],[5761,5786],[5792,5866],[5870,5880],[5888,5905],[5919,5937],[5952,5969],[5984,5996],[5998,6000],[6016,6067],[6103,6103],[6108,6108],[6176,6264],[6272,6312],[6314,6314],[6320,6389],[6400,6430],[6480,6509],[6512,6516],[6528,6571],[6576,6601],[6656,6678],[6688,6740],[6823,6823],[6917,6963],[6981,6988],[7043,7072],[7086,7087],[7098,7141],[7168,7203],[7245,7247],[7258,7293],[7296,7306],[7312,7354],[7357,7359],[7401,7404],[7406,7411],[7413,7414],[7418,7418],[7424,7615],[7680,7957],[7960,7965],[7968,8005],[8008,8013],[8016,8023],[8025,8025],[8027,8027],[8029,8029],[8031,8061],[8064,8116],[8118,8124],[8126,8126],[8130,8132],[8134,8140],[8144,8147],[8150,8155],[8160,8172],[8178,8180],[8182,8188],[8305,8305],[8319,8319],[8336,8348],[8450,8450],[8455,8455],[8458,8467],[8469,8469],[8472,8477],[8484,8484],[8486,8486],[8488,8488],[8490,8505],[8508,8511],[8517,8521],[8526,8526],[8544,8584],[11264,11492],[11499,11502],[11506,11507],[11520,11557],[11559,11559],[11565,11565],[11568,11623],[11631,11631],[11648,11670],[11680,11686],[11688,11694],[11696,11702],[11704,11710],[11712,11718],[11720,11726],[11728,11734],[11736,11742],[12293,12295],[12321,12329],[12337,12341],[12344,12348],[12353,12438],[12443,12447],[12449,12538],[12540,12543],[12549,12591],[12593,12686],[12704,12735],[12784,12799],[13312,19903],[19968,42124],[42192,42237],[42240,42508],[42512,42527],[42538,42539],[42560,42606],[42623,42653],[42656,42735],[42775,42783],[42786,42888],[42891,42972],[42993,43009],[43011,43013],[43015,43018],[43020,43042],[43072,43123],[43138,43187],[43250,43255],[43259,43259],[43261,43262],[43274,43301],[43312,43334],[43360,43388],[43396,43442],[43471,43471],[43488,43492],[43494,43503],[43514,43518],[43520,43560],[43584,43586],[43588,43595],[43616,43638],[43642,43642],[43646,43695],[43697,43697],[43701,43702],[43705,43709],[43712,43712],[43714,43714],[43739,43741],[43744,43754],[43762,43764],[43777,43782],[43785,43790],[43793,43798],[43808,43814],[43816,43822],[43824,43866],[43868,43881],[43888,44002],[44032,55203],[55216,55238],[55243,55291],[63744,64109],[64112,64217],[64256,64262],[64275,64279],[64285,64285],[64287,64296],[64298,64310],[64312,64316],[64318,64318],[64320,64321],[64323,64324],[64326,64433],[64467,64829],[64848,64911],[64914,64967],[65008,65019],[65136,65140],[65142,65276],[65313,65338],[65345,65370],[65382,65470],[65474,65479],[65482,65487],[65490,65495],[65498,65500],[65536,65547],[65549,65574],[65576,65594],[65596,65597],[65599,65613],[65616,65629],[65664,65786],[65856,65908],[66176,66204],[66208,66256],[66304,66335],[66349,66378],[66384,66421],[66432,66461],[66464,66499],[66504,66511],[66513,66517],[66560,66717],[66736,66771],[66776,66811],[66816,66855],[66864,66915],[66928,66938],[66940,66954],[66956,66962],[66964,66965],[66967,66977],[66979,66993],[66995,67001],[67003,67004],[67008,67059],[67072,67382],[67392,67413],[67424,67431],[67456,67461],[67463,67504],[67506,67514],[67584,67589],[67592,67592],[67594,67637],[67639,67640],[67644,67644],[67647,67669],[67680,67702],[67712,67742],[67808,67826],[67828,67829],[67840,67861],[67872,67897],[67904,67929],[67968,68023],[68030,68031],[68096,68096],[68112,68115],[68117,68119],[68121,68149],[68192,68220],[68224,68252],[68288,68295],[68297,68324],[68352,68405],[68416,68437],[68448,68466],[68480,68497],[68608,68680],[68736,68786],[68800,68850],[68864,68899],[68938,68965],[68975,68997],[69248,69289],[69296,69297],[69314,69319],[69376,69404],[69415,69415],[69424,69445],[69488,69505],[69552,69572],[69600,69622],[69635,69687],[69745,69746],[69749,69749],[69763,69807],[69840,69864],[69891,69926],[69956,69956],[69959,69959],[69968,70002],[70006,70006],[70019,70066],[70081,70084],[70106,70106],[70108,70108],[70144,70161],[70163,70187],[70207,70208],[70272,70278],[70280,70280],[70282,70285],[70287,70301],[70303,70312],[70320,70366],[70405,70412],[70415,70416],[70419,70440],[70442,70448],[70450,70451],[70453,70457],[70461,70461],[70480,70480],[70493,70497],[70528,70537],[70539,70539],[70542,70542],[70544,70581],[70583,70583],[70609,70609],[70611,70611],[70656,70708],[70727,70730],[70751,70753],[70784,70831],[70852,70853],[70855,70855],[71040,71086],[71128,71131],[71168,71215],[71236,71236],[71296,71338],[71352,71352],[71424,71450],[71488,71494],[71680,71723],[71840,71903],[71935,71942],[71945,71945],[71948,71955],[71957,71958],[71960,71983],[71999,71999],[72001,72001],[72096,72103],[72106,72144],[72161,72161],[72163,72163],[72192,72192],[72203,72242],[72250,72250],[72272,72272],[72284,72329],[72349,72349],[72368,72440],[72640,72672],[72704,72712],[72714,72750],[72768,72768],[72818,72847],[72960,72966],[72968,72969],[72971,73008],[73030,73030],[73056,73061],[73063,73064],[73066,73097],[73112,73112],[73136,73179],[73440,73458],[73474,73474],[73476,73488],[73490,73523],[73648,73648],[73728,74649],[74752,74862],[74880,75075],[77712,77808],[77824,78895],[78913,78918],[78944,82938],[82944,83526],[90368,90397],[92160,92728],[92736,92766],[92784,92862],[92880,92909],[92928,92975],[92992,92995],[93027,93047],[93053,93071],[93504,93548],[93760,93823],[93856,93880],[93883,93907],[93952,94026],[94032,94032],[94099,94111],[94176,94177],[94179,94179],[94194,94198],[94208,101589],[101631,101662],[101760,101874],[110576,110579],[110581,110587],[110589,110590],[110592,110882],[110898,110898],[110928,110930],[110933,110933],[110948,110951],[110960,111355],[113664,113770],[113776,113788],[113792,113800],[113808,113817],[119808,119892],[119894,119964],[119966,119967],[119970,119970],[119973,119974],[119977,119980],[119982,119993],[119995,119995],[119997,120003],[120005,120069],[120071,120074],[120077,120084],[120086,120092],[120094,120121],[120123,120126],[120128,120132],[120134,120134],[120138,120144],[120146,120485],[120488,120512],[120514,120538],[120540,120570],[120572,120596],[120598,120628],[120630,120654],[120656,120686],[120688,120712],[120714,120744],[120746,120770],[120772,120779],[122624,122654],[122661,122666],[122928,122989],[123136,123180],[123191,123197],[123214,123214],[123536,123565],[123584,123627],[124112,124139],[124368,124397],[124400,124400],[124608,124638],[124640,124642],[124644,124645],[124647,124653],[124656,124660],[124670,124671],[124896,124902],[124904,124907],[124909,124910],[124912,124926],[124928,125124],[125184,125251],[125259,125259],[126464,126467],[126469,126495],[126497,126498],[126500,126500],[126503,126503],[126505,126514],[126516,126519],[126521,126521],[126523,126523],[126530,126530],[126535,126535],[126537,126537],[126539,126539],[126541,126543],[126545,126546],[126548,126548],[126551,126551],[126553,126553],[126555,126555],[126557,126557],[126559,126559],[126561,126562],[126564,126564],[126567,126570],[126572,126578],[126580,126583],[126585,126588],[126590,126590],[126592,126601],[126603,126619],[126625,126627],[126629,126633],[126635,126651],[131072,173791],[173824,178205],[178208,183981],[183984,191456],[191472,192093],[194560,195101],[196608,201546],[201552,210041]]")
    return t1


def _regex_id_continue_ranges() -> Any:
    _core_coverage_mark("_regex_id_continue_ranges")
    t1 = _core_json_parse("[[48,57],[65,90],[95,95],[97,122],[170,170],[181,181],[183,183],[186,186],[192,214],[216,246],[248,705],[710,721],[736,740],[748,748],[750,750],[768,884],[886,887],[890,893],[895,895],[902,906],[908,908],[910,929],[931,1013],[1015,1153],[1155,1159],[1162,1327],[1329,1366],[1369,1369],[1376,1416],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],[1488,1514],[1519,1522],[1552,1562],[1568,1641],[1646,1747],[1749,1756],[1759,1768],[1770,1788],[1791,1791],[1808,1866],[1869,1969],[1984,2037],[2042,2042],[2045,2045],[2048,2093],[2112,2139],[2144,2154],[2160,2183],[2185,2191],[2199,2273],[2275,2403],[2406,2415],[2417,2435],[2437,2444],[2447,2448],[2451,2472],[2474,2480],[2482,2482],[2486,2489],[2492,2500],[2503,2504],[2507,2510],[2519,2519],[2524,2525],[2527,2531],[2534,2545],[2556,2556],[2558,2558],[2561,2563],[2565,2570],[2575,2576],[2579,2600],[2602,2608],[2610,2611],[2613,2614],[2616,2617],[2620,2620],[2622,2626],[2631,2632],[2635,2637],[2641,2641],[2649,2652],[2654,2654],[2662,2677],[2689,2691],[2693,2701],[2703,2705],[2707,2728],[2730,2736],[2738,2739],[2741,2745],[2748,2757],[2759,2761],[2763,2765],[2768,2768],[2784,2787],[2790,2799],[2809,2815],[2817,2819],[2821,2828],[2831,2832],[2835,2856],[2858,2864],[2866,2867],[2869,2873],[2876,2884],[2887,2888],[2891,2893],[2901,2903],[2908,2909],[2911,2915],[2918,2927],[2929,2929],[2946,2947],[2949,2954],[2958,2960],[2962,2965],[2969,2970],[2972,2972],[2974,2975],[2979,2980],[2984,2986],[2990,3001],[3006,3010],[3014,3016],[3018,3021],[3024,3024],[3031,3031],[3046,3055],[3072,3084],[3086,3088],[3090,3112],[3114,3129],[3132,3140],[3142,3144],[3146,3149],[3157,3158],[3160,3162],[3164,3165],[3168,3171],[3174,3183],[3200,3203],[3205,3212],[3214,3216],[3218,3240],[3242,3251],[3253,3257],[3260,3268],[3270,3272],[3274,3277],[3285,3286],[3292,3294],[3296,3299],[3302,3311],[3313,3315],[3328,3340],[3342,3344],[3346,3396],[3398,3400],[3402,3406],[3412,3415],[3423,3427],[3430,3439],[3450,3455],[3457,3459],[3461,3478],[3482,3505],[3507,3515],[3517,3517],[3520,3526],[3530,3530],[3535,3540],[3542,3542],[3544,3551],[3558,3567],[3570,3571],[3585,3642],[3648,3662],[3664,3673],[3713,3714],[3716,3716],[3718,3722],[3724,3747],[3749,3749],[3751,3773],[3776,3780],[3782,3782],[3784,3790],[3792,3801],[3804,3807],[3840,3840],[3864,3865],[3872,3881],[3893,3893],[3895,3895],[3897,3897],[3902,3911],[3913,3948],[3953,3972],[3974,3991],[3993,4028],[4038,4038],[4096,4169],[4176,4253],[4256,4293],[4295,4295],[4301,4301],[4304,4346],[4348,4680],[4682,4685],[4688,4694],[4696,4696],[4698,4701],[4704,4744],[4746,4749],[4752,4784],[4786,4789],[4792,4798],[4800,4800],[4802,4805],[4808,4822],[4824,4880],[4882,4885],[4888,4954],[4957,4959],[4969,4977],[4992,5007],[5024,5109],[5112,5117],[5121,5740],[5743,5759],[5761,5786],[5792,5866],[5870,5880],[5888,5909],[5919,5940],[5952,5971],[5984,5996],[5998,6000],[6002,6003],[6016,6099],[6103,6103],[6108,6109],[6112,6121],[6155,6157],[6159,6169],[6176,6264],[6272,6314],[6320,6389],[6400,6430],[6432,6443],[6448,6459],[6470,6509],[6512,6516],[6528,6571],[6576,6601],[6608,6618],[6656,6683],[6688,6750],[6752,6780],[6783,6793],[6800,6809],[6823,6823],[6832,6845],[6847,6877],[6880,6891],[6912,6988],[6992,7001],[7019,7027],[7040,7155],[7168,7223],[7232,7241],[7245,7293],[7296,7306],[7312,7354],[7357,7359],[7376,7378],[7380,7418],[7424,7957],[7960,7965],[7968,8005],[8008,8013],[8016,8023],[8025,8025],[8027,8027],[8029,8029],[8031,8061],[8064,8116],[8118,8124],[8126,8126],[8130,8132],[8134,8140],[8144,8147],[8150,8155],[8160,8172],[8178,8180],[8182,8188],[8204,8205],[8255,8256],[8276,8276],[8305,8305],[8319,8319],[8336,8348],[8400,8412],[8417,8417],[8421,8432],[8450,8450],[8455,8455],[8458,8467],[8469,8469],[8472,8477],[8484,8484],[8486,8486],[8488,8488],[8490,8505],[8508,8511],[8517,8521],[8526,8526],[8544,8584],[11264,11492],[11499,11507],[11520,11557],[11559,11559],[11565,11565],[11568,11623],[11631,11631],[11647,11670],[11680,11686],[11688,11694],[11696,11702],[11704,11710],[11712,11718],[11720,11726],[11728,11734],[11736,11742],[11744,11775],[12293,12295],[12321,12335],[12337,12341],[12344,12348],[12353,12438],[12441,12447],[12449,12543],[12549,12591],[12593,12686],[12704,12735],[12784,12799],[13312,19903],[19968,42124],[42192,42237],[42240,42508],[42512,42539],[42560,42607],[42612,42621],[42623,42737],[42775,42783],[42786,42888],[42891,42972],[42993,43047],[43052,43052],[43072,43123],[43136,43205],[43216,43225],[43232,43255],[43259,43259],[43261,43309],[43312,43347],[43360,43388],[43392,43456],[43471,43481],[43488,43518],[43520,43574],[43584,43597],[43600,43609],[43616,43638],[43642,43714],[43739,43741],[43744,43759],[43762,43766],[43777,43782],[43785,43790],[43793,43798],[43808,43814],[43816,43822],[43824,43866],[43868,43881],[43888,44010],[44012,44013],[44016,44025],[44032,55203],[55216,55238],[55243,55291],[63744,64109],[64112,64217],[64256,64262],[64275,64279],[64285,64296],[64298,64310],[64312,64316],[64318,64318],[64320,64321],[64323,64324],[64326,64433],[64467,64829],[64848,64911],[64914,64967],[65008,65019],[65024,65039],[65056,65071],[65075,65076],[65101,65103],[65136,65140],[65142,65276],[65296,65305],[65313,65338],[65343,65343],[65345,65370],[65381,65470],[65474,65479],[65482,65487],[65490,65495],[65498,65500],[65536,65547],[65549,65574],[65576,65594],[65596,65597],[65599,65613],[65616,65629],[65664,65786],[65856,65908],[66045,66045],[66176,66204],[66208,66256],[66272,66272],[66304,66335],[66349,66378],[66384,66426],[66432,66461],[66464,66499],[66504,66511],[66513,66517],[66560,66717],[66720,66729],[66736,66771],[66776,66811],[66816,66855],[66864,66915],[66928,66938],[66940,66954],[66956,66962],[66964,66965],[66967,66977],[66979,66993],[66995,67001],[67003,67004],[67008,67059],[67072,67382],[67392,67413],[67424,67431],[67456,67461],[67463,67504],[67506,67514],[67584,67589],[67592,67592],[67594,67637],[67639,67640],[67644,67644],[67647,67669],[67680,67702],[67712,67742],[67808,67826],[67828,67829],[67840,67861],[67872,67897],[67904,67929],[67968,68023],[68030,68031],[68096,68099],[68101,68102],[68108,68115],[68117,68119],[68121,68149],[68152,68154],[68159,68159],[68192,68220],[68224,68252],[68288,68295],[68297,68326],[68352,68405],[68416,68437],[68448,68466],[68480,68497],[68608,68680],[68736,68786],[68800,68850],[68864,68903],[68912,68921],[68928,68965],[68969,68973],[68975,68997],[69248,69289],[69291,69292],[69296,69297],[69314,69319],[69370,69404],[69415,69415],[69424,69456],[69488,69509],[69552,69572],[69600,69622],[69632,69702],[69734,69749],[69759,69818],[69826,69826],[69840,69864],[69872,69881],[69888,69940],[69942,69951],[69956,69959],[69968,70003],[70006,70006],[70016,70084],[70089,70092],[70094,70106],[70108,70108],[70144,70161],[70163,70199],[70206,70209],[70272,70278],[70280,70280],[70282,70285],[70287,70301],[70303,70312],[70320,70378],[70384,70393],[70400,70403],[70405,70412],[70415,70416],[70419,70440],[70442,70448],[70450,70451],[70453,70457],[70459,70468],[70471,70472],[70475,70477],[70480,70480],[70487,70487],[70493,70499],[70502,70508],[70512,70516],[70528,70537],[70539,70539],[70542,70542],[70544,70581],[70583,70592],[70594,70594],[70597,70597],[70599,70602],[70604,70611],[70625,70626],[70656,70730],[70736,70745],[70750,70753],[70784,70853],[70855,70855],[70864,70873],[71040,71093],[71096,71104],[71128,71133],[71168,71232],[71236,71236],[71248,71257],[71296,71352],[71360,71369],[71376,71395],[71424,71450],[71453,71467],[71472,71481],[71488,71494],[71680,71738],[71840,71913],[71935,71942],[71945,71945],[71948,71955],[71957,71958],[71960,71989],[71991,71992],[71995,72003],[72016,72025],[72096,72103],[72106,72151],[72154,72161],[72163,72164],[72192,72254],[72263,72263],[72272,72345],[72349,72349],[72368,72440],[72544,72551],[72640,72672],[72688,72697],[72704,72712],[72714,72758],[72760,72768],[72784,72793],[72818,72847],[72850,72871],[72873,72886],[72960,72966],[72968,72969],[72971,73014],[73018,73018],[73020,73021],[73023,73031],[73040,73049],[73056,73061],[73063,73064],[73066,73102],[73104,73105],[73107,73112],[73120,73129],[73136,73179],[73184,73193],[73440,73462],[73472,73488],[73490,73530],[73534,73538],[73552,73562],[73648,73648],[73728,74649],[74752,74862],[74880,75075],[77712,77808],[77824,78895],[78912,78933],[78944,82938],[82944,83526],[90368,90425],[92160,92728],[92736,92766],[92768,92777],[92784,92862],[92864,92873],[92880,92909],[92912,92916],[92928,92982],[92992,92995],[93008,93017],[93027,93047],[93053,93071],[93504,93548],[93552,93561],[93760,93823],[93856,93880],[93883,93907],[93952,94026],[94031,94087],[94095,94111],[94176,94177],[94179,94180],[94192,94198],[94208,101589],[101631,101662],[101760,101874],[110576,110579],[110581,110587],[110589,110590],[110592,110882],[110898,110898],[110928,110930],[110933,110933],[110948,110951],[110960,111355],[113664,113770],[113776,113788],[113792,113800],[113808,113817],[113821,113822],[118000,118009],[118528,118573],[118576,118598],[119141,119145],[119149,119154],[119163,119170],[119173,119179],[119210,119213],[119362,119364],[119808,119892],[119894,119964],[119966,119967],[119970,119970],[119973,119974],[119977,119980],[119982,119993],[119995,119995],[119997,120003],[120005,120069],[120071,120074],[120077,120084],[120086,120092],[120094,120121],[120123,120126],[120128,120132],[120134,120134],[120138,120144],[120146,120485],[120488,120512],[120514,120538],[120540,120570],[120572,120596],[120598,120628],[120630,120654],[120656,120686],[120688,120712],[120714,120744],[120746,120770],[120772,120779],[120782,120831],[121344,121398],[121403,121452],[121461,121461],[121476,121476],[121499,121503],[121505,121519],[122624,122654],[122661,122666],[122880,122886],[122888,122904],[122907,122913],[122915,122916],[122918,122922],[122928,122989],[123023,123023],[123136,123180],[123184,123197],[123200,123209],[123214,123214],[123536,123566],[123584,123641],[124112,124153],[124368,124410],[124608,124638],[124640,124661],[124670,124671],[124896,124902],[124904,124907],[124909,124910],[124912,124926],[124928,125124],[125136,125142],[125184,125259],[125264,125273],[126464,126467],[126469,126495],[126497,126498],[126500,126500],[126503,126503],[126505,126514],[126516,126519],[126521,126521],[126523,126523],[126530,126530],[126535,126535],[126537,126537],[126539,126539],[126541,126543],[126545,126546],[126548,126548],[126551,126551],[126553,126553],[126555,126555],[126557,126557],[126559,126559],[126561,126562],[126564,126564],[126567,126570],[126572,126578],[126580,126583],[126585,126588],[126590,126590],[126592,126601],[126603,126619],[126625,126627],[126629,126633],[126635,126651],[130032,130041],[131072,173791],[173824,178205],[178208,183981],[183984,191456],[191472,192093],[194560,195101],[196608,201546],[201552,210041],[917760,917999]]")
    return t1


def _regex_clear_capture(caps: Any, key: Any) -> Any:
    _core_coverage_mark("_regex_clear_capture")
    t1 = _core_none()
    caps[key] = t1
    return None


def _regex_copy_map(value: Any) -> Any:
    _core_coverage_mark("_regex_copy_map")
    key = _core_none()
    out = _core_none()
    t1 = {}
    out = t1
    t2 = _core_map_keys(value)
    for iter_3 in t2:
        key = iter_3
        t4 = _core_get(value, key, None)
        out[key] = t4
    return out

# END AXIR CORE EMITTED FUNCTIONS
