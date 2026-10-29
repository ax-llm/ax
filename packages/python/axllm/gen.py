from __future__ import annotations
import os

import copy
import hashlib
import inspect
import math
import json
import re
import time
import warnings
from typing import Any

from .ai import (
    _core_axgen_deprecation,
    _core_math_floor,
    AIClient,
    AxAIRefusalError,
    AxAIServiceAbortedError,
    AxAIServiceNetworkError,
    AxAIServiceStatusError,
    AxAIServiceStreamTerminatedError,
    AxAIServiceTimeoutError,
    AxCancellationToken,
    AxMeter,
    AxRateLimiter,
    AxRuntimeHooks,
    AxTracer,
    _coerce_runtime_hooks,
    _merge_runtime_hooks,
    _runtime_hook_scope,
    _gen_metric_labels,
    _runtime_hooks_from_options,
    _strip_runtime_hooks,
    _snapshot_global_caching_function,
    _snapshot_global_function_result_formatter,
    chat_response_to_completion,
    ai_merge_replay_metadata,
    fold_chat_response_stream,
)
from .prompt import AxPromptTemplate, _core_json_pretty, _core_string_split
from .schema import AxValidationError, _core_field_item, _core_url_valid, strip_internal, validate_fields, validate_output
from .signature import AxSignature, _core_string_replace, _js_date_prompt_text, _js_json_dumps, _js_number_text, _js_format, _js_text
from .mcp import resolve_execution_context
from .ai import (
    _chat_result_function_call_problems,
)
from .schema import (
    _evidence_probability_impl,
    _schema_to_json_schema_impl,
)
from .signature import (
    _box_validate_impl,
    _evidence_is_type_impl,
    _evidence_request_fields_impl,
    _signature_output_value_descriptions_impl,
    signature_to_string,
)
from .signature import _evidence_has_fields_impl, _evidence_example_values_impl


class _StreamingConsumerStopped(AxAIServiceAbortedError):
    """The streaming_forward consumer stopped the run early."""


def _core_json_stable_stringify(value):
    return _js_json_dumps(value or {}, sort_keys=True)


def _core_crypto_sha256_hex(text):
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()


def _core_axgen_function_result_formatter():
    # The process-wide tool result formatter (set_function_result_formatter),
    # or None.
    return _snapshot_global_function_result_formatter()


def _core_axgen_caching_function(gen, options):
    # The forward call's caching function, else the constructor's, else the
    # process-wide one (set_caching_function).
    for source in (options, getattr(gen, "options", None)):
        if isinstance(source, dict):
            caching_function = source.get("caching_function", source.get("cachingFunction"))
            if caching_function is not None:
                return caching_function
    return _snapshot_global_caching_function()


def _core_axgen_cache_read(caching_function, key):
    # fn(key) returns the stored output, or None for a miss.
    return caching_function(key)


def _core_axgen_cache_write(caching_function, key, value):
    caching_function(key, value)
    return None


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
        self.feedback_processors = list(self.options.get("feedback_processors") or self.options.get("feedbackProcessors") or [])
        self.streaming_field_processors = list(self.options.get("streaming_field_processors") or self.options.get("streamingFieldProcessors") or [])
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
            include_optional_input_fields_in_system_prompt=self._include_optional_input_fields(),
        )
        if self.instruction:
            self.prompt_template.set_instruction(self.instruction)

    def _include_optional_input_fields(self) -> bool:
        # TS includeOptionalInputFieldsInSystemPrompt: the system prompt lists
        # every input field, provided or not. Off by default.
        return bool(self.options.get("include_optional_input_fields_in_system_prompt", self.options.get("includeOptionalInputFieldsInSystemPrompt", False)))

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

    def set_function_result_formatter(self, formatter):
        """Write each tool result for the model as TS's functionResultFormatter
        option does: formatter(result) -> text. Without one, a string goes as it
        is, None as "done", and any other value as pretty JSON. A forward
        call's function_result_formatter option wins over this one, and this
        one over the process-wide axllm.set_function_result_formatter. A
        formatter that raises fails the forward ("Generate failed: ..."), as
        in TS."""
        self.options["function_result_formatter"] = formatter
        return self

    def add_assert(self, assertion, message=None):
        """Add an assertion: a declarative spec or a callable over the outputs.

        A callable returns None or True to pass, a string to fail with that
        message, or False to fail with ``message``. As in TypeScript, a failure
        with a message is retried with a correction, while a failure without
        one, or an error the callable raises, surfaces at once.
        """
        if message is not None and callable(assertion):
            assertion = _MessageAssertion(assertion, message)
        elif message is not None and isinstance(assertion, dict):
            assertion = {**assertion, "message": message}
        self.assertions.append(assertion)
        return self

    def add_streaming_assert(self, field, not_contains=None, message=None):
        """Add a streaming assertion on a string or code output field.

        ``not_contains`` is text the field must not contain, or a callable
        ``check(text, done)`` over the field's text so far that returns None or
        True to pass, a message string, or False. As in TypeScript, a failure
        stops the attempt and retries it with a correction.
        """
        if isinstance(field, dict):
            spec = dict(field)
        elif callable(not_contains):
            spec = {"field": field, "fn": not_contains}
        else:
            spec = {"field": field, "not_contains": not_contains}
        if message is not None:
            spec["message"] = message
        self.streaming_assertions.append(spec)
        return self

    def add_field_transform(self, field, processor):
        """Rewrite an output field's final value: an op name ("uppercase",
        "lowercase", "trim", "prefix:...", "suffix:...") or a callable.

        This is a port extension; TypeScript field processors feed back to
        the model instead (see add_field_processor(...)).
        """
        self.field_processors.append({"field": field, "processor": processor})
        return self

    def add_field_processor(self, field, processor, *, feedback=True):
        """Send processor(value, {"values", "done"}) feedback to the model.

        A non-empty result requests another step. Use add_field_transform()
        to rewrite the field locally; feedback=False retains that behavior.
        """
        if feedback:
            self.feedback_processors.append({"field": field, "processor": processor})
            return self
        return self.add_field_transform(field, processor)

    def add_streaming_field_processor(self, field, processor):
        """Run ``processor(text, {"values", "done"})`` on each streamed chunk of
        a string or code output field; a non-empty result is sent to the
        model as a user message for another step, as in TypeScript."""
        output = next((item for item in self.signature.get_output_fields() if item.name == field), None)
        if output is None:
            raise ValueError(f"addFieldProcessor: field {field} not found")
        type_name = getattr(getattr(output, "type", None), "name", "string") or "string"
        if type_name not in ("string", "code"):
            raise ValueError(f"addFieldProcessor: field {field} must be a text field")
        self.streaming_field_processors.append({"field": field, "processor": processor})
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
        if opts.get("demos"):
            self.set_demos(opts["demos"])
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
        # As in TS, the cache is read before the run's span and metrics, so a
        # stored output records neither.
        run_options = _strip_runtime_hooks(options) or {}
        run_options["_evidence_cache_identity"] = {"instance": id(client), "provider": getattr(client, "name", type(client).__name__), "model": getattr(client, "model", None), "config": getattr(client, "model_config", None)}
        lookup = _cache_lookup_impl(self, values, run_options, False)
        if lookup.get("hit"):
            # A stored output's audio outputs are rendered, as TS does.
            return _render_audio_outputs_impl(self, client, lookup.get("value"), run_options)
        call_hooks = _merge_runtime_hooks(_coerce_runtime_hooks(hooks), _runtime_hooks_from_options(options))
        with _runtime_hook_scope(
            call_hooks,
            self.runtime_hooks,
            span_name="ax_gen_forward",
            attributes={"ax.program.id": self.program_id, "ax.program.type": "AxGen"},
            metric_labels=_gen_metric_labels(client, self.options, run_options),
        ):
            return self._forward_unscoped(client, values, {**run_options, "_ax_cache_lookup": lookup})

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
                include_optional_input_fields_in_system_prompt=self._include_optional_input_fields(),
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
        """Yield {"version", "index", "delta"} field deltas by default.

        Merge strings and lists within an index and start over when the
        version changes. Use stream_raw() for provider response events.
        """
        run_options = dict(options or {})
        if run_options.pop("deltas", True):
            return self._streaming_deltas(client, values, run_options, hooks)
        return self.stream_raw(client, values, run_options, hooks)

    def stream_raw(
        self,
        client: AIClient,
        values: dict[str, Any],
        options: dict[str, Any] | None = None,
        hooks: AxRuntimeHooks | None = None,
    ):
        """Yield the raw provider events of one streamed request."""
        call_hooks = _merge_runtime_hooks(_coerce_runtime_hooks(hooks), _runtime_hooks_from_options(options))
        with _runtime_hook_scope(
            call_hooks,
            self.runtime_hooks,
            span_name="ax_gen_forward",
            attributes={"ax.program.id": self.program_id, "ax.program.type": "AxGen", "ax.streaming": True},
            metric_labels=_gen_metric_labels(client, self.options, options),
        ):
            yield from self._streaming_forward_unscoped(client, values, _strip_runtime_hooks(options))

    def _streaming_deltas(self, client, values, options, hooks):
        # The forward runs in a worker thread and hands each delta to this
        # generator, then waits until the consumer asks for the next one, as
        # TypeScript's async generator does. Closing the generator stops the
        # run at that delta; with a run control it ends as aborted.
        import contextvars
        import queue
        import threading

        deliveries = queue.Queue()
        resume = threading.Semaphore(0)
        stopped = threading.Event()

        def sink(envelope):
            if stopped.is_set():
                raise _StreamingConsumerStopped("streaming consumer closed")
            deliveries.put(("delta", copy.deepcopy(envelope)))
            resume.acquire()
            if stopped.is_set():
                raise _StreamingConsumerStopped("streaming consumer closed")

        def run():
            try:
                self._streaming_forward_with(client, values, options, sink, hooks)
                deliveries.put(("done", None))
            except BaseException as error:  # noqa: BLE001 - re-raised in the consumer
                deliveries.put(("error", error))

        context = contextvars.copy_context()
        worker = threading.Thread(target=context.run, args=(run,), daemon=True)
        worker.start()
        try:
            while True:
                kind, item = deliveries.get()
                if kind == "error":
                    raise item
                if kind == "done":
                    return
                yield item
                resume.release()
        finally:
            stopped.set()
            resume.release()
            worker.join()

    def _streaming_forward_with(self, client, values, options, sink, hooks=None):
        # Runs the streaming forward, sending each {version, index, delta} to
        # sink, and returns the merged output of the picked sample. As in TS,
        # the cache is read before the run's span and metrics, a read error
        # is ignored, and a stored output arrives as one delta.
        run_options = _strip_runtime_hooks(options) or {}
        run_options["_evidence_cache_identity"] = {"instance": id(client), "provider": getattr(client, "name", type(client).__name__), "model": getattr(client, "model", None), "config": getattr(client, "model_config", None)}
        lookup = _cache_lookup_impl(self, values, run_options, True)
        if lookup.get("hit"):
            # A stored output's audio outputs are rendered, as TS does.
            cached = _render_audio_outputs_impl(self, client, lookup.get("value"), run_options)
            sink({"version": 0, "index": 0, "delta": cached})
            return cached
        call_hooks = _merge_runtime_hooks(_coerce_runtime_hooks(hooks), _runtime_hooks_from_options(options))
        with _runtime_hook_scope(
            call_hooks,
            self.runtime_hooks,
            span_name="ax_gen_forward",
            attributes={"ax.program.id": self.program_id, "ax.program.type": "AxGen", "ax.streaming": True},
            metric_labels=_gen_metric_labels(client, self.options, run_options),
        ):
            return self._streaming_forward_unscoped_with(client, values, {**run_options, "_ax_cache_lookup": lookup}, sink)

    def _streaming_forward_unscoped_with(self, client, values, options, sink):
        run_options = {**self.options, **(options or {})}
        session_enabled = (chat_session_mode_enabled(run_options)
            and (callable(getattr(client, "_pin_chat_run", None)) or
                 (callable(getattr(client, "open_chat_session", None)) and
                  bool(getattr(client, "get_features", lambda model=None: {})(str(run_options.get("model") or getattr(client, "model", "")) or None).get("asyncTools"))))
            and (run_options.get("control") is not None or any(getattr(tool, "execution", "blocking") == "background" for tool in self.functions)))
        from .session import _BoundaryClient, _SessionClient
        if session_enabled and not isinstance(client, (_BoundaryClient, _SessionClient)):
            # As in forward, a session-capable client pins the run; each
            # request streams its own native session's items.
            pinned = _SessionClient(self, client, run_options)
            try:
                result = self._streaming_forward_unscoped_with(pinned, values, {**(options or {}), "asyncMode": "off", "async_mode": "off", "infraRetries": 0, "infra_retries": 0}, sink)
            except BaseException as error:
                pinned.close(error)
                raise
            pinned.close()
            return result
        if run_options.get("control") is not None and not isinstance(client, (_BoundaryClient, _SessionClient)):
            bounded = _BoundaryClient(client, run_options)
            try:
                result = self._streaming_forward_unscoped_with(bounded, values, options, sink)
            except BaseException as error:
                bounded.close(error)
                raise
            bounded.close()
            return result
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
                include_optional_input_fields_in_system_prompt=self._include_optional_input_fields(),
            )
            if self.instruction:
                call_gen.prompt_template.set_instruction(self.instruction)
            return _streaming_forward_impl(call_gen, client, values, options, sink)
        return _streaming_forward_impl(self, client, values, options, sink)

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
            call_gen.prompt_template = AxPromptTemplate(self.signature, functions=call_gen.functions, include_optional_input_fields_in_system_prompt=self._include_optional_input_fields())
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
            output = _parse_output_fields_impl(content, self.signature.get_output_fields())
            validate_output(self.signature.get_output_fields(), output)

    def _request(self, messages, options, client=None):
        request_options = options or {}
        features = _core_ai_client_features(client, request_options.get("model")) if client is not None else {}
        selection = _select_structured_output_rung(self.signature, features, request_options)
        return _build_gen_chat_request(self, messages, request_options, selection, 0)

    def _execute_tool(self, call):
        return _execute_tool_call(self.functions, call, self.options)


def ax(
    signature,
    options: dict[str, Any] | None = None,
    *,
    sample_count: int | None = None,
    result_picker=None,
    function_result_formatter=None,
    hooks: AxRuntimeHooks | None = None,
) -> AxGen:
    normalized = dict(options or {})
    if sample_count is not None:
        normalized["sample_count"] = int(sample_count)
    if result_picker is not None:
        normalized["result_picker"] = result_picker
    if function_result_formatter is not None:
        normalized["function_result_formatter"] = function_result_formatter
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


def _core_string_concat_stream_text(left, right):
    # Streamed text appends chunk by chunk; a surrogate pair split across two
    # chunks joins back into one character, as it does in a UTF-16 string.
    left, right = str(left), str(right)
    if left and right and "\ud800" <= left[-1] <= "\udbff" and "\udc00" <= right[0] <= "\udfff":
        joined = chr(0x10000 + ((ord(left[-1]) - 0xD800) << 10) + (ord(right[0]) - 0xDC00))
        return left[:-1] + joined + right[1:]
    return left + right


def _core_string_drop_trailing_high_surrogate(value):
    # A str can end in half of a surrogate pair when a provider split the
    # pair across stream events.
    text = str(value)
    if text and "\ud800" <= text[-1] <= "\udbff":
        return text[:-1]
    return text


_DATE_ZONES: dict[str, Any] = {}
# datetime covers years 1-9999. Offsets are constant before a zone's first
# transition and follow its rule after the last, so an instant a day past
# either end reads the same offset as the clamped one.
_DATE_MIN_SECONDS = -62135510400  # 0001-01-02T00:00:00Z
_DATE_MAX_SECONDS = 253402128000  # 9999-12-30T00:00:00Z


def _core_date_zone_offset(name, epoch_ms):
    """UTC offset in seconds of the IANA zone `name` at an instant (epoch
    milliseconds), from the platform tz database through zoneinfo. Raises
    for a zone the database does not have."""
    import datetime as _datetime
    import zoneinfo as _zoneinfo

    key = str(name)
    zone = _DATE_ZONES.get(key)
    if zone is None:
        try:
            zone = _zoneinfo.ZoneInfo(key)
        except (ValueError, OSError, _zoneinfo.ZoneInfoNotFoundError) as exc:
            raise ValueError(f"unknown time zone {key}") from exc
        _DATE_ZONES[key] = zone
    seconds = math.floor(float(epoch_ms) / 1000)
    seconds = min(max(seconds, _DATE_MIN_SECONDS), _DATE_MAX_SECONDS)
    instant = _datetime.datetime(1970, 1, 1, tzinfo=_datetime.timezone.utc) + _datetime.timedelta(seconds=seconds)
    return int(instant.astimezone(zone).utcoffset().total_seconds())

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
    if str(method_name) == "format_result" and callable(target):
        # A function result formatter: formatter(result) -> text.
        return target(args[0] if args else None)
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
    # TS JSON.stringify(value): keys in insertion order, null as null.
    return _js_json_dumps(value)


def _core_json_pretty(value):
    # TS JSON.stringify(value, null, 2).
    return _js_json_dumps(value, indent=2)


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
            value_descriptions=item.get("valueDescriptions", item.get("value_descriptions")),
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
    return _js_format(template, args)


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


def _core_accepts_options(method):
    try:
        parameters = inspect.signature(method).parameters.values()
        return len(inspect.signature(method).parameters) >= 2 or any(
            parameter.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
            for parameter in parameters
        )
    except (TypeError, ValueError):
        return False


def _core_ai_control_take_pending(client):
    # The run control updates queued for this run, which the forward applies
    # when a step starts, as TS does. Only a request boundary tracks them; a
    # chat session applies its controls itself.
    take = getattr(client, "_take_control_updates", None)
    return take() if callable(take) else []


def _core_ai_control_pending_count(client):
    count = getattr(client, "_pending_control_count", None)
    return int(count()) if callable(count) else 0


def _core_ai_complete_once(client, request, options):
    # As in TS, a streamed forward folds the stream's chunks into one response.
    streaming = bool(((request or {}).get("model_config") or {}).get("stream"))
    stream = getattr(client, "stream", None)
    if streaming and callable(stream):
        events = stream(request, options or {}) if _core_accepts_options(stream) else stream(request)
        return chat_response_to_completion(fold_chat_response_stream(list(events)))
    chat = getattr(client, "chat", None)
    if callable(chat):
        accepts_options = _core_accepts_options(chat)
        response = chat(request, options or {}) if accepts_options else chat(request)
        if response is not None and not isinstance(response, dict):
            response = fold_chat_response_stream(list(response))
        return chat_response_to_completion(response)
    complete = getattr(client, "complete", None)
    if callable(complete):
        return complete(request)
    raise TypeError("AI client must implement chat() or complete()")


def _core_coalesce(value, fallback):
    return fallback if value is None else value


def _core_string_index_of(value, needle, start=0):
    return str(value).find(str(needle), max(0, int(start)))


class _CoreChatStream:
    """Pull handle over a client stream: next() returns the next chunk or None."""

    def __init__(self, events):
        self._events = events
        self._iterator = iter(events)

    def next(self):
        return next(self._iterator, None)

    def close(self):
        close = getattr(self._events, "close", None)
        if callable(close):
            close()


def _core_completion_chat_chunk(completion):
    # A complete()-only client answers in the completion shape; stream it as
    # one chat response chunk.
    if not isinstance(completion, dict) or "results" in completion:
        return completion
    result = {"index": 0, "content": completion.get("content") or ""}
    calls = [
        {"id": call.get("id"), "type": "function", "function": {"name": call.get("name"), "params": call.get("params")}}
        for call in completion.get("function_calls") or []
    ]
    if calls:
        result["function_calls"] = calls
    for key in ("thought", "thought_blocks"):
        if completion.get(key):
            result[key] = completion[key]
    result["finish_reason"] = completion.get("finish_reason", "function_call" if calls else "stop")
    return {"results": [result]}


def _core_ai_stream_open(client, request, options):
    # streaming_forward reads the provider stream chunk by chunk; a client
    # without stream() answers with one chat (or completion) response.
    stream = getattr(client, "stream", None)
    if callable(stream):
        events = stream(request, options or {}) if _core_accepts_options(stream) else stream(request)
        return _CoreChatStream(events)
    chat = getattr(client, "chat", None)
    if callable(chat):
        response = chat(request, options or {}) if _core_accepts_options(chat) else chat(request)
        return _CoreChatStream([response] if response is None or isinstance(response, dict) else response)
    complete = getattr(client, "complete", None)
    if callable(complete):
        return _CoreChatStream([_core_completion_chat_chunk(complete(request))])
    raise TypeError("AI client must implement stream(), chat() or complete()")


def _core_ai_stream_next(handle):
    return handle.next()


def _core_ai_stream_close(handle):
    try:
        handle.close()
    except Exception:  # noqa: BLE001 - closing an abandoned stream is best effort
        pass
    return None


# _core_axgen_deprecation (warn once per process) comes from the ai module,
# which shares it with the provider functions.


def _core_axgen_emit_delta(sink, envelope):
    sink(envelope)
    return None


def _core_axgen_speak(client, request, options):
    # Backs intrinsic.axgen.speak: the AxGen audio output renderer calls the
    # client's speak(), as TS calls ai.speak().
    speak = getattr(client, "speak", None)
    if not callable(speak):
        raise RuntimeError("Audio speech not supported by this AI client")
    return speak(request, options or {})


def _core_axgen_call_processor(spec, value, context):
    # TS field processors take (value, {values, sessionId, done}); a
    # one-argument callable gets the value alone.
    processor = spec.get("processor", spec.get("fn")) if isinstance(spec, dict) else spec
    if not callable(processor):
        raise TypeError("field processor must be callable")
    ctx = {"values": dict((context or {}).get("values") or {}), "done": bool((context or {}).get("done"))}
    return processor(value, ctx) if _core_accepts_options(processor) else processor(value)


def _core_axgen_check_streaming_assertion(spec, value, done):
    # A callable returns None or True to pass, a message string, or False; a
    # {"not_contains": ...} spec fails when the field text contains it.
    check = spec.get("fn", spec.get("assert")) if isinstance(spec, dict) else spec
    if callable(check):
        result = check(value, done) if _core_accepts_options(check) else check(value)
        if result is None or result is True:
            return {"status": "pass"}
        if isinstance(result, str):
            return {"status": "fail", "message": result}
        return {"status": "fail"}
    needle = spec.get("not_contains", spec.get("notContains")) if isinstance(spec, dict) else None
    if needle is not None and str(needle) in str(value):
        return {"status": "fail"}
    return {"status": "pass"}


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


# The same error with a new message and the original as its cause. It keeps
# its class, so existing handlers still catch it (TS wraps it in
# AxGenerateError, which the ports adopt at the next major).
class AxGenerateError(RuntimeError):
    """Generation failed; the original failure is available as __cause__."""
    def __init__(self, message, cause=None):
        super().__init__(message)
        self.__cause__ = cause


def _core_exception_generate(error, message):
    return AxGenerateError(message, error)


def _core_exception_rewrap(error, message):
    try:
        wrapped = copy.copy(error)
        wrapped.args = (message,)
    except Exception:
        wrapped = RuntimeError(message)
    wrapped.__cause__ = error
    return wrapped


def _core_exception_is_aborted(error):
    return isinstance(error, AxAIServiceAbortedError)


def _core_exception_is_infrastructure(error):
    # TS AxGen retries only 5xx status, network, timeout and stream-termination errors.
    if isinstance(error, AxAIServiceStatusError):
        status = getattr(error, "status", None)
        return isinstance(status, int) and 500 <= status < 600
    return isinstance(error, (AxAIServiceNetworkError, AxAIServiceTimeoutError, AxAIServiceStreamTerminatedError))


# TS AxGen retries a model refusal inside its validation loop.
def _core_exception_is_refusal(error):
    return isinstance(error, AxAIRefusalError)


def _core_exception_is_validation(error):
    return isinstance(error, AxValidationError)


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(pattern, value) is not None


def _core_runtime_error(message):
    return RuntimeError(str(message))


def _core_validation_error(message):
    return AxValidationError(str(message))


_TOOL_EXTRA_KEYS = {"sessionId": "session_id", "executionPath": "execution_path", "eventContext": "event_context"}


def _core_tool_context(context):
    # A context handler's context: the run's extras (TS's sessionId,
    # executionPath and eventContext, as session_id, execution_path and
    # event_context, each when set) and a cancellation signal.
    if context is None:
        return None
    out = {_TOOL_EXTRA_KEYS.get(key, key): value for key, value in context.items()}
    if "signal" not in out:
        import threading
        out["signal"] = threading.Event()
    return out


def _core_tool_invoke(fn, params, context=None):
    context = _core_tool_context(context)
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
    return _js_text(value)


def _core_axgen_value_text(value, type_name=None):
    # A native date in a date-typed field reads as TS renders a Date.
    dated = _js_date_prompt_text(type_name, value) if type_name else None
    if dated is not None:
        return dated
    if isinstance(value, str):
        return value
    return _js_json_dumps(value, sort_keys=True, separators=(", ", ": "))


def _core_axgen_fields_for(gen, kind):
    sig = _core_get(gen, "signature")
    return list(_core_get(sig, f"{kind}_fields", []) or [])


def _core_axgen_format_values(gen, values, kind):
    values = values or {}
    fields = _core_axgen_fields_for(gen, kind)
    if kind == 'output' and _evidence_has_fields_impl(fields):
        return _js_json_dumps(_evidence_example_values_impl(fields, values))
    lines = []
    for field in fields:
        name = _core_get(field, "name")
        if name in values:
            title = _core_get(field, "title", name)
            field_type = _core_get(field, "type")
            lines.append(f"{title}: {_core_axgen_value_text(values[name], _core_get(field_type, 'name', None))}")
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


class _MessageAssertion:
    """A callable assertion with the message TypeScript addAssert(fn, message) takes."""

    def __init__(self, fn, message):
        self.fn = fn
        self.message = message

    def __call__(self, output):
        return self.fn(output)


def _core_axgen_run_assertions(gen, output):
    # Evaluate the assertions in order and report the first failure as
    # {status: "pass"}, {status: "fail", message?} or {status: "error", error};
    # gen.axir decides what each outcome raises, as TS assertAssertions does.
    for assertion in _core_get(gen, "assertions", []) or []:
        if callable(assertion):
            try:
                result = assertion(output)
            except Exception as error:  # noqa: BLE001 - gen.axir surfaces it
                return {"status": "error", "error": error}
            if isinstance(result, str):
                return {"status": "fail", "message": result}
            if result is False:
                return {"status": "fail", "message": getattr(assertion, "message", None) or None}
            continue
        if "throw" in assertion:
            return {"status": "error", "error": RuntimeError(str(assertion["throw"]))}
        field = assertion.get("field")
        value = output.get(field) if field else output
        message = str(assertion["message"]) if assertion.get("message") else None
        if "return" in assertion:
            returned = assertion.get("return")
            if returned is None:
                continue
            if returned is False:
                return {"status": "fail", "message": message}
            if isinstance(returned, str):
                return {"status": "fail", "message": returned}
        if "contains" in assertion and str(assertion["contains"]) not in str(value):
            return {"status": "fail", "message": message}
        if "equals" in assertion and value != assertion["equals"]:
            return {"status": "fail", "message": message}
    return {"status": "pass"}


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


def _core_axgen_memory_add_function_result(gen, call, result, ok, result_text=None):
    # `result` and `result_text` both keep the text the model got.
    memory = _core_get(gen, "memory")
    if memory is not None and hasattr(memory, "add_function_results"):
        entry = {"call": call, "result": result, "ok": bool(ok)}
        if result_text is not None:
            entry["result_text"] = result_text
        memory.add_function_results(entry)
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


def _eval_codepoints_impl(text: str) -> Any:
    _core_coverage_mark("_eval_codepoints_impl")
    units = _core_string_utf16_units(text)
    out = []
    i = 0
    count = _core_len(units)
    while True:
        done = _core_gte(i, count)
        if done:
            break
        else:
            pass
        unit = _core_get(units, i, None)
        i = _core_add(i, 1)
        next = _core_get(units, i, 0)
        high = _core_gte(unit, 55296)
        high_end = _core_lte(unit, 56319)
        low = _core_gte(next, 56320)
        low_end = _core_lte(next, 57343)
        pair = _core_and(high, high_end)
        pair = _core_and(pair, low)
        pair = _core_and(pair, low_end)
        if pair:
            unit = _core_add(unit, -55296)
            unit = _core_mul(unit, 1024)
            unit = _core_add(unit, next)
            unit = _core_add(unit, 9216)
            i = _core_add(i, 1)
        else:
            pass
        out.append(unit)
    return out


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


def _render_audio_outputs_impl(gen: AxGen, client: AIClient, values: Any, options: Any) -> Any:
    _core_coverage_mark("_render_audio_outputs_impl")
    base_options = _core_get(gen, "options", None)
    runtime_options = _core_map_merge(base_options, options)
    gen_snake = _core_get(base_options, "render_audio", True)
    gen_render = _core_get(base_options, "renderAudio", gen_snake)
    call_snake = _core_get(options, "render_audio", gen_render)
    render = _core_get(options, "renderAudio", call_snake)
    render_on = _core_truthy(render)
    no_speech = {}
    speech = _core_get(runtime_options, "speech", no_speech)
    no_speak_defaults = {}
    speak_defaults = _core_get(speech, "speak", no_speak_defaults)
    no_field_speech = {}
    field_speech = _core_get(speech, "fields", no_field_speech)
    signature = _core_get(gen, "signature", None)
    output_fields = _core_get(signature, "output_fields", None)
    out_base = {}
    out = _core_map_merge(out_base, values)
    for field in output_fields:
        no_type = {}
        typ = _core_get(field, "type", no_type)
        type_name = _core_get(typ, "name", "")
        is_audio = _core_eq(type_name, "audio")
        is_array = _core_get(typ, "is_array", False)
        single = _core_not(is_array)
        audio_field = _core_and(is_audio, single)
        if audio_field:
            name = _core_get(field, "name", "")
            value = _core_get(out, name, None)
            is_text = _core_type_is(value, "string")
            if is_text:
                if render_on:
                    request_base = {}
                    request = _core_map_merge(request_base, speak_defaults)
                    no_field_defaults = {}
                    field_defaults = _core_get(field_speech, name, no_field_defaults)
                    request = _core_map_merge(request, field_defaults)
                    request["text"] = value
                    audio = _core_axgen_speak(client, request, runtime_options)
                    artifact_base = {}
                    artifact = _core_map_merge(artifact_base, audio)
                    transcript = _core_get(artifact, "transcript", None)
                    no_transcript = _core_is_none(transcript)
                    if no_transcript:
                        artifact["transcript"] = value
                    else:
                        pass
                    out[name] = artifact
                else:
                    pass
            else:
                pass
        else:
            pass
    return out


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
    requires_schema_snake = _core_get(features, "requires_structured_output", False)
    requires_schema = _core_get(features, "requiresStructuredOutput", requires_schema_snake)
    if requires_schema:
        selection["requires_schema"] = True
    else:
        pass
    complex = _signature_has_complex_fields(signature, options)
    simple = _core_not(complex)
    not_required = _core_not(requires_schema)
    no_rung = _core_and(simple, not_required)
    if no_rung:
        return selection
    else:
        pass
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
        pass
    no_advertised_modes = _core_not(has_modes)
    native_default = _core_and(no_advertised_modes, supports_native)
    if native_default:
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
    errors = _chat_session_argument_errors(schema, schema, arguments, "", 0)
    count = _core_len(errors)
    invalid = _core_gt(count, 0)
    if invalid:
        lines = []
        for failure in errors:
            failure_field = _core_get(failure, "field", "arguments")
            failure_message = _core_get(failure, "message", "")
            line = _core_string_format("{}: {}", failure_field, failure_message)
            lines.append(line)
        joined = _core_string_join("; ", lines)
        message = _core_string_format("{}: {}", path, joined)
        error = _core_validation_error(message)
        raise error
    else:
        pass
    return None


def _execute_tool_call(functions: list[Any], call: Any, options: Any) -> Any:
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
            extras = tool_call_extras(options, name)
            result = _core_tool_invoke(fn, params, extras)
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


def _date_parse_dates_option_impl(base_options: Any, options: Any) -> bool:
    _core_coverage_mark("_date_parse_dates_option_impl")
    empty = {}
    call_options = _core_map_merge(empty, options)
    gen_options = _core_map_merge(empty, base_options)
    gen_snake = _core_get(gen_options, "parse_dates", True)
    gen_parse = _core_get(gen_options, "parseDates", gen_snake)
    call_snake = _core_get(call_options, "parse_dates", gen_parse)
    parse = _core_get(call_options, "parseDates", call_snake)
    parse_dates = _core_truthy(parse)
    return parse_dates


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


def _eval_codepoint_text_impl(units: Any) -> str:
    _core_coverage_mark("_eval_codepoint_text_impl")
    out = "\""
    for unit in units:
        astral = _core_gte(unit, 65536)
        if astral:
            rest = _core_add(unit, -65536)
            high = _date_floor_div_impl(rest, 1024)
            base = _core_mul(high, -1024)
            low = _core_add(rest, base)
            low = _core_add(low, 56320)
            high = _core_add(high, 55296)
            h = _date_js_hex4_impl(high)
            l = _date_js_hex4_impl(low)
            escape = _core_string_format("\\u{}\\u{}", h, l)
            out = _core_add(out, escape)
        else:
            hex = _date_js_hex4_impl(unit)
            escape = _core_string_format("\\u{}", hex)
            out = _core_add(out, escape)
    out = _core_add(out, "\"")
    text = _core_json_parse(out)
    return text


def _date_is_date_type_impl(name: Any) -> bool:
    _core_coverage_mark("_date_is_date_type_impl")
    is_date = _core_eq(name, "date")
    if is_date:
        return True
    else:
        pass
    is_datetime = _core_eq(name, "datetime")
    if is_datetime:
        return True
    else:
        pass
    is_date_range = _core_eq(name, "dateRange")
    if is_date_range:
        return True
    else:
        pass
    is_datetime_range = _core_eq(name, "datetimeRange")
    return is_datetime_range


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


def _date_parse_fields_impl(fields: Any, base_options: Any, options: Any) -> Any:
    _core_coverage_mark("_date_parse_fields_impl")
    parse_dates = _date_parse_dates_option_impl(base_options, options)
    off = _core_not(parse_dates)
    if off:
        return fields
    else:
        pass
    out = []
    for field in fields:
        typ = _core_get(field, "type", None)
        type_name = _core_get(typ, "name", "string")
        dated = _date_is_date_type_impl(type_name)
        plain = _core_not(dated)
        if plain:
            out.append(field)
            continue
        else:
            pass
        field_copy = {}
        name = _core_get(field, "name", None)
        field_copy["name"] = name
        title = _stream_field_title_impl(field)
        field_copy["title"] = title
        description = _core_get(field, "description", None)
        field_copy["description"] = description
        field_copy["type"] = typ
        optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
        field_copy["is_optional"] = optional
        internal = _stream_field_flag_impl(field, "is_internal", "isInternal")
        field_copy["is_internal"] = internal
        cached = _stream_field_flag_impl(field, "is_cached", "isCached")
        field_copy["is_cached"] = cached
        field_copy["parse_dates"] = True
        out.append(field_copy)
    return out


def _eval_normalize_impl(text: str, tables: Any) -> str:
    _core_coverage_mark("_eval_normalize_impl")
    decompositions = _core_get(tables, "nfd", None)
    ccc = _core_get(tables, "ccc", None)
    lower = _core_get(tables, "lower", None)
    cased = _core_get(tables, "cased", None)
    ignorable = _core_get(tables, "case_ignorable", None)
    source = _eval_codepoints_impl(text)
    decomposed = []
    for cp in source:
        key = _core_string_format("{}", cp)
        fallback = []
        fallback.append(cp)
        parts = _core_get(decompositions, key, fallback)
        hangul_low = _core_gte(cp, 44032)
        hangul_high = _core_lte(cp, 55203)
        hangul = _core_and(hangul_low, hangul_high)
        if hangul:
            syllable = _core_add(cp, -44032)
            leading = _date_floor_div_impl(syllable, 588)
            negative_leading = _core_mul(leading, -588)
            remainder = _core_add(syllable, negative_leading)
            vowel = _date_floor_div_impl(remainder, 28)
            negative_vowel = _core_mul(vowel, -28)
            trailing = _core_add(remainder, negative_vowel)
            leading = _core_add(leading, 4352)
            vowel = _core_add(vowel, 4449)
            parts = []
            parts.append(leading)
            parts.append(vowel)
            has_trailing = _core_gt(trailing, 0)
            if has_trailing:
                trailing = _core_add(trailing, 4519)
                parts.append(trailing)
            else:
                pass
        else:
            pass
        for part in parts:
            decomposed.append(part)
    ordered = decomposed
    changed = True
    while True:
        if changed:
            pass
        else:
            break
        changed = False
        next = []
        pending = -1
        for cp in ordered:
            key = _core_string_format("{}", cp)
            rank = _core_get(ccc, key, 0)
            pk = _core_string_format("{}", pending)
            pr = _core_get(ccc, pk, 0)
            swap = _core_gt(pr, rank)
            mark = _core_gt(rank, 0)
            swap = _core_and(swap, mark)
            if swap:
                next.append(cp)
                changed = True
            else:
                has_pending = _core_gte(pending, 0)
                if has_pending:
                    next.append(pending)
                else:
                    pass
                pending = cp
        has_pending = _core_gte(pending, 0)
        if has_pending:
            next.append(pending)
        else:
            pass
        ordered = next
    article_free = []
    index = 0
    length = _core_len(ordered)
    while True:
        end = _core_gte(index, length)
        if end:
            break
        else:
            pass
        cp = _core_get(ordered, index, None)
        previous_index = _core_add(index, -1)
        previous = _core_get(ordered, previous_index, 0)
        left_word = _eval_ascii_word_impl(previous)
        left_boundary = _core_not(left_word)
        width = 0
        if left_boundary:
            a = _core_eq(cp, 97)
            t = _core_eq(cp, 116)
            next_index = _core_add(index, 1)
            next = _core_get(ordered, next_index, 0)
            if a:
                n = _core_eq(next, 110)
                width = 1
                if n:
                    width = 2
                else:
                    pass
            else:
                pass
            if t:
                h = _core_eq(next, 104)
                third_index = _core_add(index, 2)
                third = _core_get(ordered, third_index, 0)
                e = _core_eq(third, 101)
                the = _core_and(h, e)
                if the:
                    width = 3
                else:
                    pass
            else:
                pass
            after_index = _core_add(index, width)
            after = _core_get(ordered, after_index, 0)
            right_word = _eval_ascii_word_impl(after)
            if right_word:
                width = 0
            else:
                pass
        else:
            pass
        article = _core_gt(width, 0)
        if article:
            article_free.append(32)
            index = _core_add(index, width)
        else:
            article_free.append(cp)
            index = _core_add(index, 1)
    spaces = _core_get(tables, "whitespace", None)
    punctuation = _core_get(tables, "punctuation", None)
    units = []
    was_space = False
    for cp in article_free:
        key = _core_string_format("{}", cp)
        space = _core_get(spaces, key, False)
        if space:
            if was_space:
                pass
            else:
                units.append(32)
        else:
            punct = _core_get(punctuation, key, False)
            if punct:
                pass
            else:
                units.append(cp)
        was_space = space
    folded = []
    before_cased = False
    index = 0
    length = _core_len(units)
    for cp in units:
        key = _core_string_format("{}", cp)
        single = []
        single.append(cp)
        parts = _core_get(lower, key, single)
        sigma = _core_eq(cp, 931)
        is_final_sigma = _core_and(sigma, before_cased)
        if is_final_sigma:
            ahead = _core_add(index, 1)
            while True:
                end = _core_gte(ahead, length)
                if end:
                    break
                else:
                    pass
                following = _core_get(units, ahead, None)
                fk = _core_string_format("{}", following)
                skip = _core_get(ignorable, fk, False)
                if skip:
                    ahead = _core_add(ahead, 1)
                    continue
                else:
                    pass
                next_cased = _core_get(cased, fk, False)
                is_final_sigma = _core_not(next_cased)
                break
            if is_final_sigma:
                parts = []
                parts.append(962)
            else:
                pass
        else:
            pass
        for part in parts:
            folded.append(part)
        skip = _core_get(ignorable, key, False)
        if skip:
            pass
        else:
            before_cased = _core_get(cased, key, False)
        index = _core_add(index, 1)
    out = _eval_codepoint_text_impl(folded)
    return out


def tool_call_extras(options: Any, name: str) -> Any:
    _core_coverage_mark("tool_call_extras")
    extras = {}
    options_map = _core_type_is(options, "object")
    if options_map:
        pass
    else:
        return extras
    session_snake = _core_get(options, "session_id", None)
    session = _core_get(options, "sessionId", session_snake)
    has_session = _core_is_not_none(session)
    if has_session:
        extras["sessionId"] = session
    else:
        pass
    control = _core_get(options, "control", None)
    controlled = _core_is_not_none(control)
    if controlled:
        path_snake = _core_get(options, "execution_path", "root")
        path = _core_get(options, "executionPath", path_snake)
        tool_path = _core_string_format("{}/{}", path, name)
        extras["executionPath"] = tool_path
    else:
        pass
    event_snake = _core_get(options, "event_context", None)
    event_context = _core_get(options, "eventContext", event_snake)
    has_event_context = _core_is_not_none(event_context)
    if has_event_context:
        extras["eventContext"] = event_context
    else:
        pass
    return extras


def _render_stream_result_impl(run: Any, output: Any) -> Any:
    _core_coverage_mark("_render_stream_result_impl")
    render = _core_get(run, "render_audio", None)
    no_render = _core_is_none(render)
    if no_render:
        return output
    else:
        pass
    buffered = _core_get(run, "buffered", False)
    sink = _core_get(run, "sink", None)
    no_sink = _core_is_none(sink)
    renders = _core_or(buffered, no_sink)
    if renders:
        gen = _core_get(render, "gen", None)
        client = _core_get(render, "client", None)
        options = _core_get(render, "options", None)
        rendered = _render_audio_outputs_impl(gen, client, output, options)
        return rendered
    else:
        pass
    return output


def _regex_node(k: Any) -> Any:
    _core_coverage_mark("_regex_node")
    t1 = {}
    t1["k"] = k
    return t1


def _date_convert_field_value_impl(field: Any, type_name: Any, value: Any, may_skip: bool) -> Any:
    _core_coverage_mark("_date_convert_field_value_impl")
    out = {}
    out["has"] = True
    title = _stream_field_title_impl(field)
    is_date = _core_eq(type_name, "date")
    is_datetime = _core_eq(type_name, "datetime")
    is_date_range = _core_eq(type_name, "dateRange")
    single = _core_or(is_date, is_datetime)
    if single:
        text = _stream_js_string_impl(value)
        millis = 0
        try:
            if is_date:
                millis = _date_parse_date_impl(text)
            else:
                millis = _date_parse_datetime_impl(text)
        except Exception as single_error:
            if may_skip:
                out["has"] = False
                return out
            else:
                pass
            single_detail = _core_exception_message(single_error)
            single_message = _date_error_message_impl(type_name, title, single_detail, text)
            single_invalid = _core_runtime_error(single_message)
            raise single_invalid
        iso = _date_iso_impl(millis)
        out["value"] = iso
        return out
    else:
        pass
    kind = "datetime"
    if is_date_range:
        kind = "date"
    else:
        pass
    range_millis = {}
    try:
        range_millis = _date_parse_range_impl(value, kind)
    except Exception as range_error:
        if may_skip:
            out["has"] = False
            return out
        else:
            pass
        range_detail = _core_exception_message(range_error)
        range_text = ""
        range_is_text = _core_type_is(value, "string")
        if range_is_text:
            range_text = value
        else:
            range_text = _date_js_json_impl(value)
        range_message = _date_error_message_impl(type_name, title, range_detail, range_text)
        range_invalid = _core_runtime_error(range_message)
        raise range_invalid
    start_millis = _core_get(range_millis, "start", None)
    end_millis = _core_get(range_millis, "end", None)
    range_value = {}
    start_iso = _date_iso_impl(start_millis)
    range_value["start"] = start_iso
    end_iso = _date_iso_impl(end_millis)
    range_value["end"] = end_iso
    out["value"] = range_value
    return out


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


def _chat_session_argument_errors(root: Any, schema: Any, arguments: Any, path: str, depth: int) -> Any:
    _core_coverage_mark("_chat_session_argument_errors")
    errors = []
    empty = {}
    empty_list = []
    field = path
    at_root = _core_eq(path, "")
    if at_root:
        field = "arguments"
    else:
        pass
    too_deep = _core_gt(depth, 64)
    if too_deep:
        deep = {}
        deep["field"] = field
        deep["message"] = "Arguments exceed schema nesting limit"
        errors.append(deep)
        return errors
    else:
        pass
    resolved_depth = depth
    reference = _core_get(schema, "$ref", "")
    while True:
        no_reference = _core_not(reference)
        if no_reference:
            break
        else:
            pass
        reference_text = _core_string_str(reference)
        local = _core_string_starts_with(reference_text, "#/")
        if local:
            tail = _core_string_slice(reference_text, 2)
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
                    target_map = _core_type_is(target, "object")
                    if target_map:
                        target = _core_get(target, key, None)
                    else:
                        target = _core_none()
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
                unresolved = {}
                unresolved["field"] = field
                unresolved["message"] = "Unresolved schema reference"
                errors.append(unresolved)
                return errors
            else:
                pass
            resolved_depth = _core_add(resolved_depth, 1)
            reference_limit = _core_gt(resolved_depth, 64)
            if reference_limit:
                deep = {}
                deep["field"] = field
                deep["message"] = "Arguments exceed schema nesting limit"
                errors.append(deep)
                return errors
            else:
                pass
            schema = target
            reference = _core_get(schema, "$ref", "")
        else:
            external = {}
            external["field"] = field
            external["message"] = "External schema references are unsupported"
            errors.append(external)
            return errors
    next_depth = _core_add(resolved_depth, 1)
    all = _core_get(schema, "allOf", empty_list)
    all_is_list = _core_type_is(all, "list")
    if all_is_list:
        for branch in all:
            branch_errors = _chat_session_argument_errors(root, branch, arguments, path, next_depth)
            for error in branch_errors:
                errors.append(error)
    else:
        pass
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
            not_one = _core_ne(matches, 1)
            too_many = _core_and(one, not_one)
            invalid_union = _core_or(no_match, too_many)
            if invalid_union:
                union_message = _core_string_format("Arguments do not match {}", keyword)
                union_error = {}
                union_error["field"] = field
                union_error["message"] = union_message
                errors.append(union_error)
            else:
                pass
        else:
            pass
    value_errors = _chat_session_argument_value_errors(root, schema, arguments, path, next_depth)
    for value_error in value_errors:
        errors.append(value_error)
    return errors


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


def _stream_event_content_parts_impl(event: Any) -> list[Any]:
    _core_coverage_mark("_stream_event_content_parts_impl")
    parts = _core_stream_event_content_parts(event)
    return parts


def _stream_substring_impl(text: str, start: int, end: int) -> str:
    _core_coverage_mark("_stream_substring_impl")
    length = _core_len(text)
    low = start
    low_negative = _core_lt(low, 0)
    if low_negative:
        low = 0
    else:
        pass
    low_past = _core_gt(low, length)
    if low_past:
        low = length
    else:
        pass
    high = end
    high_negative = _core_lt(high, 0)
    if high_negative:
        high = 0
    else:
        pass
    high_past = _core_gt(high, length)
    if high_past:
        high = length
    else:
        pass
    swapped = _core_gt(low, high)
    if swapped:
        first = high
        high = low
        low = first
    else:
        pass
    out = _core_string_slice(text, low, high)
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


def _date_error_message_impl(type_name: Any, title: Any, detail: Any, provided: Any) -> Any:
    _core_coverage_mark("_date_error_message_impl")
    lead = "Invalid date/time range for '"
    advice = ". Prefer JSON like {\"start\":\"2024-05-09T14:30:00Z\",\"end\":\"2024-05-09T15:30:00Z\"} or an ISO interval like 2024-05-09T14:30:00Z/2024-05-09T15:30:00Z. You provided: "
    is_date = _core_eq(type_name, "date")
    if is_date:
        lead = "Invalid date for '"
        advice = ". Use the exact format YYYY-MM-DD (e.g., 2024-05-09). You provided: "
    else:
        pass
    is_datetime = _core_eq(type_name, "datetime")
    if is_datetime:
        lead = "Invalid date/time for '"
        advice = ". Prefer ISO 8601 with an explicit timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00. Legacy values like \"2024-05-09 14:30 America/New_York\" are also accepted. You provided: "
    else:
        pass
    is_date_range = _core_eq(type_name, "dateRange")
    if is_date_range:
        lead = "Invalid date range for '"
        advice = ". Prefer JSON like {\"start\":\"2024-05-09\",\"end\":\"2024-05-12\"} or an interval like 2024-05-09/2024-05-12. You provided: "
    else:
        pass
    pieces = []
    pieces.append(lead)
    pieces.append(title)
    pieces.append("': ")
    pieces.append(detail)
    pieces.append(advice)
    pieces.append(provided)
    pieces.append(".")
    message = _core_string_join("", pieces)
    return message


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


def _stream_trim_end_impl(text: str) -> str:
    _core_coverage_mark("_stream_trim_end_impl")
    trimmed = str(text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    blank = _core_eq(trimmed, "")
    if blank:
        return ""
    else:
        pass
    lead = _core_string_index_of(text, trimmed, 0)
    trimmed_length = _core_len(trimmed)
    end = _core_add(lead, trimmed_length)
    out = _core_string_slice(text, 0, end)
    return out


def _apply_model_config_option_impl(runtime_options: Any, base_options: Any, options: Any) -> None:
    _core_coverage_mark("_apply_model_config_option_impl")
    empty = {}
    gen_options = _core_map_merge(empty, base_options)
    call_options = _core_map_merge(empty, options)
    gen_snake = _core_get(gen_options, "model_config", empty)
    gen_camel = _core_get(gen_options, "modelConfig", empty)
    call_snake = _core_get(call_options, "model_config", empty)
    call_camel = _core_get(call_options, "modelConfig", empty)
    gen_config = _core_map_merge(gen_snake, gen_camel)
    call_config = _core_map_merge(call_snake, call_camel)
    merged = _core_map_merge(gen_config, call_config)
    merged_count = _core_len(merged)
    has_config = _core_gt(merged_count, 0)
    if has_config:
        _core_map_delete(runtime_options, "model_config")
        runtime_options["modelConfig"] = merged
    else:
        pass
    gen_labels_snake = _core_get(gen_options, "custom_labels", empty)
    gen_labels_camel = _core_get(gen_options, "customLabels", empty)
    call_labels_snake = _core_get(call_options, "custom_labels", empty)
    call_labels_camel = _core_get(call_options, "customLabels", empty)
    gen_labels = _core_map_merge(gen_labels_snake, gen_labels_camel)
    call_labels = _core_map_merge(call_labels_snake, call_labels_camel)
    labels = _core_map_merge(gen_labels, call_labels)
    labels_count = _core_len(labels)
    has_labels = _core_gt(labels_count, 0)
    if has_labels:
        _core_map_delete(runtime_options, "custom_labels")
        runtime_options["customLabels"] = labels
    else:
        pass
    return None


def _date_parse_date_impl(text: Any) -> Any:
    _core_coverage_mark("_date_parse_date_impl")
    format_error = "Invalid date format. Please provide the date in \"YYYY-MM-DD\" format."
    units = _core_string_utf16_units(text)
    count = _core_len(units)
    bounds = _date_trim_bounds_impl(units, 0, count)
    start = _core_get(bounds, "start", None)
    end = _core_get(bounds, "end", None)
    length = _core_add(end, 0)
    negative_start = _core_mul(start, -1)
    length = _core_add(length, negative_start)
    wrong_length = _core_ne(length, 10)
    if wrong_length:
        length_error = _core_runtime_error(format_error)
        raise length_error
    else:
        pass
    parts = _date_scan_date_impl(units, start)
    no_parts = _core_is_none(parts)
    if no_parts:
        shape_error = _core_runtime_error(format_error)
        raise shape_error
    else:
        pass
    millis = _date_utc_ms_impl(parts)
    round = _date_parts_of_ms_impl(millis)
    same = _date_same_day_impl(round, parts)
    different = _core_not(same)
    if different:
        value_error = _core_runtime_error(format_error)
        raise value_error
    else:
        pass
    return millis


def _stream_trim_start_impl(text: str) -> str:
    _core_coverage_mark("_stream_trim_start_impl")
    trimmed = str(text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    blank = _core_eq(trimmed, "")
    if blank:
        return ""
    else:
        pass
    lead = _core_string_index_of(text, trimmed, 0)
    out = _core_string_slice(text, lead)
    return out


def eval_novel_f1(history: str, prediction: str, ground_truth: str, return_recall: bool) -> number:
    _core_coverage_mark("eval_novel_f1")
    tables = _core_json_parse("{\"unicode_version\":\"17.0.0\",\"license\":\"UNICODE LICENSE V3\\n\\nCOPYRIGHT AND PERMISSION NOTICE\\n\\nCopyright © 1991-2026 Unicode, Inc.\\n\\nNOTICE TO USER: Carefully read the following legal agreement. BY\\nDOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR\\nSOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE\\nTERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT\\nDOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.\\n\\nPermission is hereby granted, free of charge, to any person obtaining a\\ncopy of data files and any associated documentation (the \\\"Data Files\\\") or\\nsoftware and any associated documentation (the \\\"Software\\\") to deal in the\\nData Files or Software without restriction, including without limitation\\nthe rights to use, copy, modify, merge, publish, distribute, and/or sell\\ncopies of the Data Files or Software, and to permit persons to whom the\\nData Files or Software are furnished to do so, provided that either (a)\\nthis copyright and permission notice appear with all copies of the Data\\nFiles or Software, or (b) this copyright and permission notice appear in\\nassociated Documentation.\\n\\nTHE DATA FILES AND SOFTWARE ARE PROVIDED \\\"AS IS\\\", WITHOUT WARRANTY OF ANY\\nKIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF\\nTHIRD PARTY RIGHTS.\\n\\nIN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE\\nBE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,\\nOR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,\\nWHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,\\nARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA\\nFILES OR SOFTWARE.\\n\\nExcept as contained in this notice, the name of a copyright holder shall\\nnot be used in advertising or otherwise to promote the sale, use or other\\ndealings in these Data Files or Software without prior written\\nauthorization of the copyright holder.\\n\",\"source\":\"https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt\",\"nfd\":{\"192\":[65,768],\"193\":[65,769],\"194\":[65,770],\"195\":[65,771],\"196\":[65,776],\"197\":[65,778],\"199\":[67,807],\"200\":[69,768],\"201\":[69,769],\"202\":[69,770],\"203\":[69,776],\"204\":[73,768],\"205\":[73,769],\"206\":[73,770],\"207\":[73,776],\"209\":[78,771],\"210\":[79,768],\"211\":[79,769],\"212\":[79,770],\"213\":[79,771],\"214\":[79,776],\"217\":[85,768],\"218\":[85,769],\"219\":[85,770],\"220\":[85,776],\"221\":[89,769],\"224\":[97,768],\"225\":[97,769],\"226\":[97,770],\"227\":[97,771],\"228\":[97,776],\"229\":[97,778],\"231\":[99,807],\"232\":[101,768],\"233\":[101,769],\"234\":[101,770],\"235\":[101,776],\"236\":[105,768],\"237\":[105,769],\"238\":[105,770],\"239\":[105,776],\"241\":[110,771],\"242\":[111,768],\"243\":[111,769],\"244\":[111,770],\"245\":[111,771],\"246\":[111,776],\"249\":[117,768],\"250\":[117,769],\"251\":[117,770],\"252\":[117,776],\"253\":[121,769],\"255\":[121,776],\"256\":[65,772],\"257\":[97,772],\"258\":[65,774],\"259\":[97,774],\"260\":[65,808],\"261\":[97,808],\"262\":[67,769],\"263\":[99,769],\"264\":[67,770],\"265\":[99,770],\"266\":[67,775],\"267\":[99,775],\"268\":[67,780],\"269\":[99,780],\"270\":[68,780],\"271\":[100,780],\"274\":[69,772],\"275\":[101,772],\"276\":[69,774],\"277\":[101,774],\"278\":[69,775],\"279\":[101,775],\"280\":[69,808],\"281\":[101,808],\"282\":[69,780],\"283\":[101,780],\"284\":[71,770],\"285\":[103,770],\"286\":[71,774],\"287\":[103,774],\"288\":[71,775],\"289\":[103,775],\"290\":[71,807],\"291\":[103,807],\"292\":[72,770],\"293\":[104,770],\"296\":[73,771],\"297\":[105,771],\"298\":[73,772],\"299\":[105,772],\"300\":[73,774],\"301\":[105,774],\"302\":[73,808],\"303\":[105,808],\"304\":[73,775],\"308\":[74,770],\"309\":[106,770],\"310\":[75,807],\"311\":[107,807],\"313\":[76,769],\"314\":[108,769],\"315\":[76,807],\"316\":[108,807],\"317\":[76,780],\"318\":[108,780],\"323\":[78,769],\"324\":[110,769],\"325\":[78,807],\"326\":[110,807],\"327\":[78,780],\"328\":[110,780],\"332\":[79,772],\"333\":[111,772],\"334\":[79,774],\"335\":[111,774],\"336\":[79,779],\"337\":[111,779],\"340\":[82,769],\"341\":[114,769],\"342\":[82,807],\"343\":[114,807],\"344\":[82,780],\"345\":[114,780],\"346\":[83,769],\"347\":[115,769],\"348\":[83,770],\"349\":[115,770],\"350\":[83,807],\"351\":[115,807],\"352\":[83,780],\"353\":[115,780],\"354\":[84,807],\"355\":[116,807],\"356\":[84,780],\"357\":[116,780],\"360\":[85,771],\"361\":[117,771],\"362\":[85,772],\"363\":[117,772],\"364\":[85,774],\"365\":[117,774],\"366\":[85,778],\"367\":[117,778],\"368\":[85,779],\"369\":[117,779],\"370\":[85,808],\"371\":[117,808],\"372\":[87,770],\"373\":[119,770],\"374\":[89,770],\"375\":[121,770],\"376\":[89,776],\"377\":[90,769],\"378\":[122,769],\"379\":[90,775],\"380\":[122,775],\"381\":[90,780],\"382\":[122,780],\"416\":[79,795],\"417\":[111,795],\"431\":[85,795],\"432\":[117,795],\"461\":[65,780],\"462\":[97,780],\"463\":[73,780],\"464\":[105,780],\"465\":[79,780],\"466\":[111,780],\"467\":[85,780],\"468\":[117,780],\"469\":[85,776,772],\"470\":[117,776,772],\"471\":[85,776,769],\"472\":[117,776,769],\"473\":[85,776,780],\"474\":[117,776,780],\"475\":[85,776,768],\"476\":[117,776,768],\"478\":[65,776,772],\"479\":[97,776,772],\"480\":[65,775,772],\"481\":[97,775,772],\"482\":[198,772],\"483\":[230,772],\"486\":[71,780],\"487\":[103,780],\"488\":[75,780],\"489\":[107,780],\"490\":[79,808],\"491\":[111,808],\"492\":[79,808,772],\"493\":[111,808,772],\"494\":[439,780],\"495\":[658,780],\"496\":[106,780],\"500\":[71,769],\"501\":[103,769],\"504\":[78,768],\"505\":[110,768],\"506\":[65,778,769],\"507\":[97,778,769],\"508\":[198,769],\"509\":[230,769],\"510\":[216,769],\"511\":[248,769],\"512\":[65,783],\"513\":[97,783],\"514\":[65,785],\"515\":[97,785],\"516\":[69,783],\"517\":[101,783],\"518\":[69,785],\"519\":[101,785],\"520\":[73,783],\"521\":[105,783],\"522\":[73,785],\"523\":[105,785],\"524\":[79,783],\"525\":[111,783],\"526\":[79,785],\"527\":[111,785],\"528\":[82,783],\"529\":[114,783],\"530\":[82,785],\"531\":[114,785],\"532\":[85,783],\"533\":[117,783],\"534\":[85,785],\"535\":[117,785],\"536\":[83,806],\"537\":[115,806],\"538\":[84,806],\"539\":[116,806],\"542\":[72,780],\"543\":[104,780],\"550\":[65,775],\"551\":[97,775],\"552\":[69,807],\"553\":[101,807],\"554\":[79,776,772],\"555\":[111,776,772],\"556\":[79,771,772],\"557\":[111,771,772],\"558\":[79,775],\"559\":[111,775],\"560\":[79,775,772],\"561\":[111,775,772],\"562\":[89,772],\"563\":[121,772],\"832\":[768],\"833\":[769],\"835\":[787],\"836\":[776,769],\"884\":[697],\"894\":[59],\"901\":[168,769],\"902\":[913,769],\"903\":[183],\"904\":[917,769],\"905\":[919,769],\"906\":[921,769],\"908\":[927,769],\"910\":[933,769],\"911\":[937,769],\"912\":[953,776,769],\"938\":[921,776],\"939\":[933,776],\"940\":[945,769],\"941\":[949,769],\"942\":[951,769],\"943\":[953,769],\"944\":[965,776,769],\"970\":[953,776],\"971\":[965,776],\"972\":[959,769],\"973\":[965,769],\"974\":[969,769],\"979\":[978,769],\"980\":[978,776],\"1024\":[1045,768],\"1025\":[1045,776],\"1027\":[1043,769],\"1031\":[1030,776],\"1036\":[1050,769],\"1037\":[1048,768],\"1038\":[1059,774],\"1049\":[1048,774],\"1081\":[1080,774],\"1104\":[1077,768],\"1105\":[1077,776],\"1107\":[1075,769],\"1111\":[1110,776],\"1116\":[1082,769],\"1117\":[1080,768],\"1118\":[1091,774],\"1142\":[1140,783],\"1143\":[1141,783],\"1217\":[1046,774],\"1218\":[1078,774],\"1232\":[1040,774],\"1233\":[1072,774],\"1234\":[1040,776],\"1235\":[1072,776],\"1238\":[1045,774],\"1239\":[1077,774],\"1242\":[1240,776],\"1243\":[1241,776],\"1244\":[1046,776],\"1245\":[1078,776],\"1246\":[1047,776],\"1247\":[1079,776],\"1250\":[1048,772],\"1251\":[1080,772],\"1252\":[1048,776],\"1253\":[1080,776],\"1254\":[1054,776],\"1255\":[1086,776],\"1258\":[1256,776],\"1259\":[1257,776],\"1260\":[1069,776],\"1261\":[1101,776],\"1262\":[1059,772],\"1263\":[1091,772],\"1264\":[1059,776],\"1265\":[1091,776],\"1266\":[1059,779],\"1267\":[1091,779],\"1268\":[1063,776],\"1269\":[1095,776],\"1272\":[1067,776],\"1273\":[1099,776],\"1570\":[1575,1619],\"1571\":[1575,1620],\"1572\":[1608,1620],\"1573\":[1575,1621],\"1574\":[1610,1620],\"1728\":[1749,1620],\"1730\":[1729,1620],\"1747\":[1746,1620],\"2345\":[2344,2364],\"2353\":[2352,2364],\"2356\":[2355,2364],\"2392\":[2325,2364],\"2393\":[2326,2364],\"2394\":[2327,2364],\"2395\":[2332,2364],\"2396\":[2337,2364],\"2397\":[2338,2364],\"2398\":[2347,2364],\"2399\":[2351,2364],\"2507\":[2503,2494],\"2508\":[2503,2519],\"2524\":[2465,2492],\"2525\":[2466,2492],\"2527\":[2479,2492],\"2611\":[2610,2620],\"2614\":[2616,2620],\"2649\":[2582,2620],\"2650\":[2583,2620],\"2651\":[2588,2620],\"2654\":[2603,2620],\"2888\":[2887,2902],\"2891\":[2887,2878],\"2892\":[2887,2903],\"2908\":[2849,2876],\"2909\":[2850,2876],\"2964\":[2962,3031],\"3018\":[3014,3006],\"3019\":[3015,3006],\"3020\":[3014,3031],\"3144\":[3142,3158],\"3264\":[3263,3285],\"3271\":[3270,3285],\"3272\":[3270,3286],\"3274\":[3270,3266],\"3275\":[3270,3266,3285],\"3402\":[3398,3390],\"3403\":[3399,3390],\"3404\":[3398,3415],\"3546\":[3545,3530],\"3548\":[3545,3535],\"3549\":[3545,3535,3530],\"3550\":[3545,3551],\"3907\":[3906,4023],\"3917\":[3916,4023],\"3922\":[3921,4023],\"3927\":[3926,4023],\"3932\":[3931,4023],\"3945\":[3904,4021],\"3955\":[3953,3954],\"3957\":[3953,3956],\"3958\":[4018,3968],\"3960\":[4019,3968],\"3969\":[3953,3968],\"3987\":[3986,4023],\"3997\":[3996,4023],\"4002\":[4001,4023],\"4007\":[4006,4023],\"4012\":[4011,4023],\"4025\":[3984,4021],\"4134\":[4133,4142],\"6918\":[6917,6965],\"6920\":[6919,6965],\"6922\":[6921,6965],\"6924\":[6923,6965],\"6926\":[6925,6965],\"6930\":[6929,6965],\"6971\":[6970,6965],\"6973\":[6972,6965],\"6976\":[6974,6965],\"6977\":[6975,6965],\"6979\":[6978,6965],\"7680\":[65,805],\"7681\":[97,805],\"7682\":[66,775],\"7683\":[98,775],\"7684\":[66,803],\"7685\":[98,803],\"7686\":[66,817],\"7687\":[98,817],\"7688\":[67,807,769],\"7689\":[99,807,769],\"7690\":[68,775],\"7691\":[100,775],\"7692\":[68,803],\"7693\":[100,803],\"7694\":[68,817],\"7695\":[100,817],\"7696\":[68,807],\"7697\":[100,807],\"7698\":[68,813],\"7699\":[100,813],\"7700\":[69,772,768],\"7701\":[101,772,768],\"7702\":[69,772,769],\"7703\":[101,772,769],\"7704\":[69,813],\"7705\":[101,813],\"7706\":[69,816],\"7707\":[101,816],\"7708\":[69,807,774],\"7709\":[101,807,774],\"7710\":[70,775],\"7711\":[102,775],\"7712\":[71,772],\"7713\":[103,772],\"7714\":[72,775],\"7715\":[104,775],\"7716\":[72,803],\"7717\":[104,803],\"7718\":[72,776],\"7719\":[104,776],\"7720\":[72,807],\"7721\":[104,807],\"7722\":[72,814],\"7723\":[104,814],\"7724\":[73,816],\"7725\":[105,816],\"7726\":[73,776,769],\"7727\":[105,776,769],\"7728\":[75,769],\"7729\":[107,769],\"7730\":[75,803],\"7731\":[107,803],\"7732\":[75,817],\"7733\":[107,817],\"7734\":[76,803],\"7735\":[108,803],\"7736\":[76,803,772],\"7737\":[108,803,772],\"7738\":[76,817],\"7739\":[108,817],\"7740\":[76,813],\"7741\":[108,813],\"7742\":[77,769],\"7743\":[109,769],\"7744\":[77,775],\"7745\":[109,775],\"7746\":[77,803],\"7747\":[109,803],\"7748\":[78,775],\"7749\":[110,775],\"7750\":[78,803],\"7751\":[110,803],\"7752\":[78,817],\"7753\":[110,817],\"7754\":[78,813],\"7755\":[110,813],\"7756\":[79,771,769],\"7757\":[111,771,769],\"7758\":[79,771,776],\"7759\":[111,771,776],\"7760\":[79,772,768],\"7761\":[111,772,768],\"7762\":[79,772,769],\"7763\":[111,772,769],\"7764\":[80,769],\"7765\":[112,769],\"7766\":[80,775],\"7767\":[112,775],\"7768\":[82,775],\"7769\":[114,775],\"7770\":[82,803],\"7771\":[114,803],\"7772\":[82,803,772],\"7773\":[114,803,772],\"7774\":[82,817],\"7775\":[114,817],\"7776\":[83,775],\"7777\":[115,775],\"7778\":[83,803],\"7779\":[115,803],\"7780\":[83,769,775],\"7781\":[115,769,775],\"7782\":[83,780,775],\"7783\":[115,780,775],\"7784\":[83,803,775],\"7785\":[115,803,775],\"7786\":[84,775],\"7787\":[116,775],\"7788\":[84,803],\"7789\":[116,803],\"7790\":[84,817],\"7791\":[116,817],\"7792\":[84,813],\"7793\":[116,813],\"7794\":[85,804],\"7795\":[117,804],\"7796\":[85,816],\"7797\":[117,816],\"7798\":[85,813],\"7799\":[117,813],\"7800\":[85,771,769],\"7801\":[117,771,769],\"7802\":[85,772,776],\"7803\":[117,772,776],\"7804\":[86,771],\"7805\":[118,771],\"7806\":[86,803],\"7807\":[118,803],\"7808\":[87,768],\"7809\":[119,768],\"7810\":[87,769],\"7811\":[119,769],\"7812\":[87,776],\"7813\":[119,776],\"7814\":[87,775],\"7815\":[119,775],\"7816\":[87,803],\"7817\":[119,803],\"7818\":[88,775],\"7819\":[120,775],\"7820\":[88,776],\"7821\":[120,776],\"7822\":[89,775],\"7823\":[121,775],\"7824\":[90,770],\"7825\":[122,770],\"7826\":[90,803],\"7827\":[122,803],\"7828\":[90,817],\"7829\":[122,817],\"7830\":[104,817],\"7831\":[116,776],\"7832\":[119,778],\"7833\":[121,778],\"7835\":[383,775],\"7840\":[65,803],\"7841\":[97,803],\"7842\":[65,777],\"7843\":[97,777],\"7844\":[65,770,769],\"7845\":[97,770,769],\"7846\":[65,770,768],\"7847\":[97,770,768],\"7848\":[65,770,777],\"7849\":[97,770,777],\"7850\":[65,770,771],\"7851\":[97,770,771],\"7852\":[65,803,770],\"7853\":[97,803,770],\"7854\":[65,774,769],\"7855\":[97,774,769],\"7856\":[65,774,768],\"7857\":[97,774,768],\"7858\":[65,774,777],\"7859\":[97,774,777],\"7860\":[65,774,771],\"7861\":[97,774,771],\"7862\":[65,803,774],\"7863\":[97,803,774],\"7864\":[69,803],\"7865\":[101,803],\"7866\":[69,777],\"7867\":[101,777],\"7868\":[69,771],\"7869\":[101,771],\"7870\":[69,770,769],\"7871\":[101,770,769],\"7872\":[69,770,768],\"7873\":[101,770,768],\"7874\":[69,770,777],\"7875\":[101,770,777],\"7876\":[69,770,771],\"7877\":[101,770,771],\"7878\":[69,803,770],\"7879\":[101,803,770],\"7880\":[73,777],\"7881\":[105,777],\"7882\":[73,803],\"7883\":[105,803],\"7884\":[79,803],\"7885\":[111,803],\"7886\":[79,777],\"7887\":[111,777],\"7888\":[79,770,769],\"7889\":[111,770,769],\"7890\":[79,770,768],\"7891\":[111,770,768],\"7892\":[79,770,777],\"7893\":[111,770,777],\"7894\":[79,770,771],\"7895\":[111,770,771],\"7896\":[79,803,770],\"7897\":[111,803,770],\"7898\":[79,795,769],\"7899\":[111,795,769],\"7900\":[79,795,768],\"7901\":[111,795,768],\"7902\":[79,795,777],\"7903\":[111,795,777],\"7904\":[79,795,771],\"7905\":[111,795,771],\"7906\":[79,795,803],\"7907\":[111,795,803],\"7908\":[85,803],\"7909\":[117,803],\"7910\":[85,777],\"7911\":[117,777],\"7912\":[85,795,769],\"7913\":[117,795,769],\"7914\":[85,795,768],\"7915\":[117,795,768],\"7916\":[85,795,777],\"7917\":[117,795,777],\"7918\":[85,795,771],\"7919\":[117,795,771],\"7920\":[85,795,803],\"7921\":[117,795,803],\"7922\":[89,768],\"7923\":[121,768],\"7924\":[89,803],\"7925\":[121,803],\"7926\":[89,777],\"7927\":[121,777],\"7928\":[89,771],\"7929\":[121,771],\"7936\":[945,787],\"7937\":[945,788],\"7938\":[945,787,768],\"7939\":[945,788,768],\"7940\":[945,787,769],\"7941\":[945,788,769],\"7942\":[945,787,834],\"7943\":[945,788,834],\"7944\":[913,787],\"7945\":[913,788],\"7946\":[913,787,768],\"7947\":[913,788,768],\"7948\":[913,787,769],\"7949\":[913,788,769],\"7950\":[913,787,834],\"7951\":[913,788,834],\"7952\":[949,787],\"7953\":[949,788],\"7954\":[949,787,768],\"7955\":[949,788,768],\"7956\":[949,787,769],\"7957\":[949,788,769],\"7960\":[917,787],\"7961\":[917,788],\"7962\":[917,787,768],\"7963\":[917,788,768],\"7964\":[917,787,769],\"7965\":[917,788,769],\"7968\":[951,787],\"7969\":[951,788],\"7970\":[951,787,768],\"7971\":[951,788,768],\"7972\":[951,787,769],\"7973\":[951,788,769],\"7974\":[951,787,834],\"7975\":[951,788,834],\"7976\":[919,787],\"7977\":[919,788],\"7978\":[919,787,768],\"7979\":[919,788,768],\"7980\":[919,787,769],\"7981\":[919,788,769],\"7982\":[919,787,834],\"7983\":[919,788,834],\"7984\":[953,787],\"7985\":[953,788],\"7986\":[953,787,768],\"7987\":[953,788,768],\"7988\":[953,787,769],\"7989\":[953,788,769],\"7990\":[953,787,834],\"7991\":[953,788,834],\"7992\":[921,787],\"7993\":[921,788],\"7994\":[921,787,768],\"7995\":[921,788,768],\"7996\":[921,787,769],\"7997\":[921,788,769],\"7998\":[921,787,834],\"7999\":[921,788,834],\"8000\":[959,787],\"8001\":[959,788],\"8002\":[959,787,768],\"8003\":[959,788,768],\"8004\":[959,787,769],\"8005\":[959,788,769],\"8008\":[927,787],\"8009\":[927,788],\"8010\":[927,787,768],\"8011\":[927,788,768],\"8012\":[927,787,769],\"8013\":[927,788,769],\"8016\":[965,787],\"8017\":[965,788],\"8018\":[965,787,768],\"8019\":[965,788,768],\"8020\":[965,787,769],\"8021\":[965,788,769],\"8022\":[965,787,834],\"8023\":[965,788,834],\"8025\":[933,788],\"8027\":[933,788,768],\"8029\":[933,788,769],\"8031\":[933,788,834],\"8032\":[969,787],\"8033\":[969,788],\"8034\":[969,787,768],\"8035\":[969,788,768],\"8036\":[969,787,769],\"8037\":[969,788,769],\"8038\":[969,787,834],\"8039\":[969,788,834],\"8040\":[937,787],\"8041\":[937,788],\"8042\":[937,787,768],\"8043\":[937,788,768],\"8044\":[937,787,769],\"8045\":[937,788,769],\"8046\":[937,787,834],\"8047\":[937,788,834],\"8048\":[945,768],\"8049\":[945,769],\"8050\":[949,768],\"8051\":[949,769],\"8052\":[951,768],\"8053\":[951,769],\"8054\":[953,768],\"8055\":[953,769],\"8056\":[959,768],\"8057\":[959,769],\"8058\":[965,768],\"8059\":[965,769],\"8060\":[969,768],\"8061\":[969,769],\"8064\":[945,787,837],\"8065\":[945,788,837],\"8066\":[945,787,768,837],\"8067\":[945,788,768,837],\"8068\":[945,787,769,837],\"8069\":[945,788,769,837],\"8070\":[945,787,834,837],\"8071\":[945,788,834,837],\"8072\":[913,787,837],\"8073\":[913,788,837],\"8074\":[913,787,768,837],\"8075\":[913,788,768,837],\"8076\":[913,787,769,837],\"8077\":[913,788,769,837],\"8078\":[913,787,834,837],\"8079\":[913,788,834,837],\"8080\":[951,787,837],\"8081\":[951,788,837],\"8082\":[951,787,768,837],\"8083\":[951,788,768,837],\"8084\":[951,787,769,837],\"8085\":[951,788,769,837],\"8086\":[951,787,834,837],\"8087\":[951,788,834,837],\"8088\":[919,787,837],\"8089\":[919,788,837],\"8090\":[919,787,768,837],\"8091\":[919,788,768,837],\"8092\":[919,787,769,837],\"8093\":[919,788,769,837],\"8094\":[919,787,834,837],\"8095\":[919,788,834,837],\"8096\":[969,787,837],\"8097\":[969,788,837],\"8098\":[969,787,768,837],\"8099\":[969,788,768,837],\"8100\":[969,787,769,837],\"8101\":[969,788,769,837],\"8102\":[969,787,834,837],\"8103\":[969,788,834,837],\"8104\":[937,787,837],\"8105\":[937,788,837],\"8106\":[937,787,768,837],\"8107\":[937,788,768,837],\"8108\":[937,787,769,837],\"8109\":[937,788,769,837],\"8110\":[937,787,834,837],\"8111\":[937,788,834,837],\"8112\":[945,774],\"8113\":[945,772],\"8114\":[945,768,837],\"8115\":[945,837],\"8116\":[945,769,837],\"8118\":[945,834],\"8119\":[945,834,837],\"8120\":[913,774],\"8121\":[913,772],\"8122\":[913,768],\"8123\":[913,769],\"8124\":[913,837],\"8126\":[953],\"8129\":[168,834],\"8130\":[951,768,837],\"8131\":[951,837],\"8132\":[951,769,837],\"8134\":[951,834],\"8135\":[951,834,837],\"8136\":[917,768],\"8137\":[917,769],\"8138\":[919,768],\"8139\":[919,769],\"8140\":[919,837],\"8141\":[8127,768],\"8142\":[8127,769],\"8143\":[8127,834],\"8144\":[953,774],\"8145\":[953,772],\"8146\":[953,776,768],\"8147\":[953,776,769],\"8150\":[953,834],\"8151\":[953,776,834],\"8152\":[921,774],\"8153\":[921,772],\"8154\":[921,768],\"8155\":[921,769],\"8157\":[8190,768],\"8158\":[8190,769],\"8159\":[8190,834],\"8160\":[965,774],\"8161\":[965,772],\"8162\":[965,776,768],\"8163\":[965,776,769],\"8164\":[961,787],\"8165\":[961,788],\"8166\":[965,834],\"8167\":[965,776,834],\"8168\":[933,774],\"8169\":[933,772],\"8170\":[933,768],\"8171\":[933,769],\"8172\":[929,788],\"8173\":[168,768],\"8174\":[168,769],\"8175\":[96],\"8178\":[969,768,837],\"8179\":[969,837],\"8180\":[969,769,837],\"8182\":[969,834],\"8183\":[969,834,837],\"8184\":[927,768],\"8185\":[927,769],\"8186\":[937,768],\"8187\":[937,769],\"8188\":[937,837],\"8189\":[180],\"8192\":[8194],\"8193\":[8195],\"8486\":[937],\"8490\":[75],\"8491\":[65,778],\"8602\":[8592,824],\"8603\":[8594,824],\"8622\":[8596,824],\"8653\":[8656,824],\"8654\":[8660,824],\"8655\":[8658,824],\"8708\":[8707,824],\"8713\":[8712,824],\"8716\":[8715,824],\"8740\":[8739,824],\"8742\":[8741,824],\"8769\":[8764,824],\"8772\":[8771,824],\"8775\":[8773,824],\"8777\":[8776,824],\"8800\":[61,824],\"8802\":[8801,824],\"8813\":[8781,824],\"8814\":[60,824],\"8815\":[62,824],\"8816\":[8804,824],\"8817\":[8805,824],\"8820\":[8818,824],\"8821\":[8819,824],\"8824\":[8822,824],\"8825\":[8823,824],\"8832\":[8826,824],\"8833\":[8827,824],\"8836\":[8834,824],\"8837\":[8835,824],\"8840\":[8838,824],\"8841\":[8839,824],\"8876\":[8866,824],\"8877\":[8872,824],\"8878\":[8873,824],\"8879\":[8875,824],\"8928\":[8828,824],\"8929\":[8829,824],\"8930\":[8849,824],\"8931\":[8850,824],\"8938\":[8882,824],\"8939\":[8883,824],\"8940\":[8884,824],\"8941\":[8885,824],\"9001\":[12296],\"9002\":[12297],\"10972\":[10973,824],\"12364\":[12363,12441],\"12366\":[12365,12441],\"12368\":[12367,12441],\"12370\":[12369,12441],\"12372\":[12371,12441],\"12374\":[12373,12441],\"12376\":[12375,12441],\"12378\":[12377,12441],\"12380\":[12379,12441],\"12382\":[12381,12441],\"12384\":[12383,12441],\"12386\":[12385,12441],\"12389\":[12388,12441],\"12391\":[12390,12441],\"12393\":[12392,12441],\"12400\":[12399,12441],\"12401\":[12399,12442],\"12403\":[12402,12441],\"12404\":[12402,12442],\"12406\":[12405,12441],\"12407\":[12405,12442],\"12409\":[12408,12441],\"12410\":[12408,12442],\"12412\":[12411,12441],\"12413\":[12411,12442],\"12436\":[12358,12441],\"12446\":[12445,12441],\"12460\":[12459,12441],\"12462\":[12461,12441],\"12464\":[12463,12441],\"12466\":[12465,12441],\"12468\":[12467,12441],\"12470\":[12469,12441],\"12472\":[12471,12441],\"12474\":[12473,12441],\"12476\":[12475,12441],\"12478\":[12477,12441],\"12480\":[12479,12441],\"12482\":[12481,12441],\"12485\":[12484,12441],\"12487\":[12486,12441],\"12489\":[12488,12441],\"12496\":[12495,12441],\"12497\":[12495,12442],\"12499\":[12498,12441],\"12500\":[12498,12442],\"12502\":[12501,12441],\"12503\":[12501,12442],\"12505\":[12504,12441],\"12506\":[12504,12442],\"12508\":[12507,12441],\"12509\":[12507,12442],\"12532\":[12454,12441],\"12535\":[12527,12441],\"12536\":[12528,12441],\"12537\":[12529,12441],\"12538\":[12530,12441],\"12542\":[12541,12441],\"63744\":[35912],\"63745\":[26356],\"63746\":[36554],\"63747\":[36040],\"63748\":[28369],\"63749\":[20018],\"63750\":[21477],\"63751\":[40860],\"63752\":[40860],\"63753\":[22865],\"63754\":[37329],\"63755\":[21895],\"63756\":[22856],\"63757\":[25078],\"63758\":[30313],\"63759\":[32645],\"63760\":[34367],\"63761\":[34746],\"63762\":[35064],\"63763\":[37007],\"63764\":[27138],\"63765\":[27931],\"63766\":[28889],\"63767\":[29662],\"63768\":[33853],\"63769\":[37226],\"63770\":[39409],\"63771\":[20098],\"63772\":[21365],\"63773\":[27396],\"63774\":[29211],\"63775\":[34349],\"63776\":[40478],\"63777\":[23888],\"63778\":[28651],\"63779\":[34253],\"63780\":[35172],\"63781\":[25289],\"63782\":[33240],\"63783\":[34847],\"63784\":[24266],\"63785\":[26391],\"63786\":[28010],\"63787\":[29436],\"63788\":[37070],\"63789\":[20358],\"63790\":[20919],\"63791\":[21214],\"63792\":[25796],\"63793\":[27347],\"63794\":[29200],\"63795\":[30439],\"63796\":[32769],\"63797\":[34310],\"63798\":[34396],\"63799\":[36335],\"63800\":[38706],\"63801\":[39791],\"63802\":[40442],\"63803\":[30860],\"63804\":[31103],\"63805\":[32160],\"63806\":[33737],\"63807\":[37636],\"63808\":[40575],\"63809\":[35542],\"63810\":[22751],\"63811\":[24324],\"63812\":[31840],\"63813\":[32894],\"63814\":[29282],\"63815\":[30922],\"63816\":[36034],\"63817\":[38647],\"63818\":[22744],\"63819\":[23650],\"63820\":[27155],\"63821\":[28122],\"63822\":[28431],\"63823\":[32047],\"63824\":[32311],\"63825\":[38475],\"63826\":[21202],\"63827\":[32907],\"63828\":[20956],\"63829\":[20940],\"63830\":[31260],\"63831\":[32190],\"63832\":[33777],\"63833\":[38517],\"63834\":[35712],\"63835\":[25295],\"63836\":[27138],\"63837\":[35582],\"63838\":[20025],\"63839\":[23527],\"63840\":[24594],\"63841\":[29575],\"63842\":[30064],\"63843\":[21271],\"63844\":[30971],\"63845\":[20415],\"63846\":[24489],\"63847\":[19981],\"63848\":[27852],\"63849\":[25976],\"63850\":[32034],\"63851\":[21443],\"63852\":[22622],\"63853\":[30465],\"63854\":[33865],\"63855\":[35498],\"63856\":[27578],\"63857\":[36784],\"63858\":[27784],\"63859\":[25342],\"63860\":[33509],\"63861\":[25504],\"63862\":[30053],\"63863\":[20142],\"63864\":[20841],\"63865\":[20937],\"63866\":[26753],\"63867\":[31975],\"63868\":[33391],\"63869\":[35538],\"63870\":[37327],\"63871\":[21237],\"63872\":[21570],\"63873\":[22899],\"63874\":[24300],\"63875\":[26053],\"63876\":[28670],\"63877\":[31018],\"63878\":[38317],\"63879\":[39530],\"63880\":[40599],\"63881\":[40654],\"63882\":[21147],\"63883\":[26310],\"63884\":[27511],\"63885\":[36706],\"63886\":[24180],\"63887\":[24976],\"63888\":[25088],\"63889\":[25754],\"63890\":[28451],\"63891\":[29001],\"63892\":[29833],\"63893\":[31178],\"63894\":[32244],\"63895\":[32879],\"63896\":[36646],\"63897\":[34030],\"63898\":[36899],\"63899\":[37706],\"63900\":[21015],\"63901\":[21155],\"63902\":[21693],\"63903\":[28872],\"63904\":[35010],\"63905\":[35498],\"63906\":[24265],\"63907\":[24565],\"63908\":[25467],\"63909\":[27566],\"63910\":[31806],\"63911\":[29557],\"63912\":[20196],\"63913\":[22265],\"63914\":[23527],\"63915\":[23994],\"63916\":[24604],\"63917\":[29618],\"63918\":[29801],\"63919\":[32666],\"63920\":[32838],\"63921\":[37428],\"63922\":[38646],\"63923\":[38728],\"63924\":[38936],\"63925\":[20363],\"63926\":[31150],\"63927\":[37300],\"63928\":[38584],\"63929\":[24801],\"63930\":[20102],\"63931\":[20698],\"63932\":[23534],\"63933\":[23615],\"63934\":[26009],\"63935\":[27138],\"63936\":[29134],\"63937\":[30274],\"63938\":[34044],\"63939\":[36988],\"63940\":[40845],\"63941\":[26248],\"63942\":[38446],\"63943\":[21129],\"63944\":[26491],\"63945\":[26611],\"63946\":[27969],\"63947\":[28316],\"63948\":[29705],\"63949\":[30041],\"63950\":[30827],\"63951\":[32016],\"63952\":[39006],\"63953\":[20845],\"63954\":[25134],\"63955\":[38520],\"63956\":[20523],\"63957\":[23833],\"63958\":[28138],\"63959\":[36650],\"63960\":[24459],\"63961\":[24900],\"63962\":[26647],\"63963\":[29575],\"63964\":[38534],\"63965\":[21033],\"63966\":[21519],\"63967\":[23653],\"63968\":[26131],\"63969\":[26446],\"63970\":[26792],\"63971\":[27877],\"63972\":[29702],\"63973\":[30178],\"63974\":[32633],\"63975\":[35023],\"63976\":[35041],\"63977\":[37324],\"63978\":[38626],\"63979\":[21311],\"63980\":[28346],\"63981\":[21533],\"63982\":[29136],\"63983\":[29848],\"63984\":[34298],\"63985\":[38563],\"63986\":[40023],\"63987\":[40607],\"63988\":[26519],\"63989\":[28107],\"63990\":[33256],\"63991\":[31435],\"63992\":[31520],\"63993\":[31890],\"63994\":[29376],\"63995\":[28825],\"63996\":[35672],\"63997\":[20160],\"63998\":[33590],\"63999\":[21050],\"64000\":[20999],\"64001\":[24230],\"64002\":[25299],\"64003\":[31958],\"64004\":[23429],\"64005\":[27934],\"64006\":[26292],\"64007\":[36667],\"64008\":[34892],\"64009\":[38477],\"64010\":[35211],\"64011\":[24275],\"64012\":[20800],\"64013\":[21952],\"64016\":[22618],\"64018\":[26228],\"64021\":[20958],\"64022\":[29482],\"64023\":[30410],\"64024\":[31036],\"64025\":[31070],\"64026\":[31077],\"64027\":[31119],\"64028\":[38742],\"64029\":[31934],\"64030\":[32701],\"64032\":[34322],\"64034\":[35576],\"64037\":[36920],\"64038\":[37117],\"64042\":[39151],\"64043\":[39164],\"64044\":[39208],\"64045\":[40372],\"64046\":[37086],\"64047\":[38583],\"64048\":[20398],\"64049\":[20711],\"64050\":[20813],\"64051\":[21193],\"64052\":[21220],\"64053\":[21329],\"64054\":[21917],\"64055\":[22022],\"64056\":[22120],\"64057\":[22592],\"64058\":[22696],\"64059\":[23652],\"64060\":[23662],\"64061\":[24724],\"64062\":[24936],\"64063\":[24974],\"64064\":[25074],\"64065\":[25935],\"64066\":[26082],\"64067\":[26257],\"64068\":[26757],\"64069\":[28023],\"64070\":[28186],\"64071\":[28450],\"64072\":[29038],\"64073\":[29227],\"64074\":[29730],\"64075\":[30865],\"64076\":[31038],\"64077\":[31049],\"64078\":[31048],\"64079\":[31056],\"64080\":[31062],\"64081\":[31069],\"64082\":[31117],\"64083\":[31118],\"64084\":[31296],\"64085\":[31361],\"64086\":[31680],\"64087\":[32244],\"64088\":[32265],\"64089\":[32321],\"64090\":[32626],\"64091\":[32773],\"64092\":[33261],\"64093\":[33401],\"64094\":[33401],\"64095\":[33879],\"64096\":[35088],\"64097\":[35222],\"64098\":[35585],\"64099\":[35641],\"64100\":[36051],\"64101\":[36104],\"64102\":[36790],\"64103\":[36920],\"64104\":[38627],\"64105\":[38911],\"64106\":[38971],\"64107\":[24693],\"64108\":[148206],\"64109\":[33304],\"64112\":[20006],\"64113\":[20917],\"64114\":[20840],\"64115\":[20352],\"64116\":[20805],\"64117\":[20864],\"64118\":[21191],\"64119\":[21242],\"64120\":[21917],\"64121\":[21845],\"64122\":[21913],\"64123\":[21986],\"64124\":[22618],\"64125\":[22707],\"64126\":[22852],\"64127\":[22868],\"64128\":[23138],\"64129\":[23336],\"64130\":[24274],\"64131\":[24281],\"64132\":[24425],\"64133\":[24493],\"64134\":[24792],\"64135\":[24910],\"64136\":[24840],\"64137\":[24974],\"64138\":[24928],\"64139\":[25074],\"64140\":[25140],\"64141\":[25540],\"64142\":[25628],\"64143\":[25682],\"64144\":[25942],\"64145\":[26228],\"64146\":[26391],\"64147\":[26395],\"64148\":[26454],\"64149\":[27513],\"64150\":[27578],\"64151\":[27969],\"64152\":[28379],\"64153\":[28363],\"64154\":[28450],\"64155\":[28702],\"64156\":[29038],\"64157\":[30631],\"64158\":[29237],\"64159\":[29359],\"64160\":[29482],\"64161\":[29809],\"64162\":[29958],\"64163\":[30011],\"64164\":[30237],\"64165\":[30239],\"64166\":[30410],\"64167\":[30427],\"64168\":[30452],\"64169\":[30538],\"64170\":[30528],\"64171\":[30924],\"64172\":[31409],\"64173\":[31680],\"64174\":[31867],\"64175\":[32091],\"64176\":[32244],\"64177\":[32574],\"64178\":[32773],\"64179\":[33618],\"64180\":[33775],\"64181\":[34681],\"64182\":[35137],\"64183\":[35206],\"64184\":[35222],\"64185\":[35519],\"64186\":[35576],\"64187\":[35531],\"64188\":[35585],\"64189\":[35582],\"64190\":[35565],\"64191\":[35641],\"64192\":[35722],\"64193\":[36104],\"64194\":[36664],\"64195\":[36978],\"64196\":[37273],\"64197\":[37494],\"64198\":[38524],\"64199\":[38627],\"64200\":[38742],\"64201\":[38875],\"64202\":[38911],\"64203\":[38923],\"64204\":[38971],\"64205\":[39698],\"64206\":[40860],\"64207\":[141386],\"64208\":[141380],\"64209\":[144341],\"64210\":[15261],\"64211\":[16408],\"64212\":[16441],\"64213\":[152137],\"64214\":[154832],\"64215\":[163539],\"64216\":[40771],\"64217\":[40846],\"64285\":[1497,1460],\"64287\":[1522,1463],\"64298\":[1513,1473],\"64299\":[1513,1474],\"64300\":[1513,1468,1473],\"64301\":[1513,1468,1474],\"64302\":[1488,1463],\"64303\":[1488,1464],\"64304\":[1488,1468],\"64305\":[1489,1468],\"64306\":[1490,1468],\"64307\":[1491,1468],\"64308\":[1492,1468],\"64309\":[1493,1468],\"64310\":[1494,1468],\"64312\":[1496,1468],\"64313\":[1497,1468],\"64314\":[1498,1468],\"64315\":[1499,1468],\"64316\":[1500,1468],\"64318\":[1502,1468],\"64320\":[1504,1468],\"64321\":[1505,1468],\"64323\":[1507,1468],\"64324\":[1508,1468],\"64326\":[1510,1468],\"64327\":[1511,1468],\"64328\":[1512,1468],\"64329\":[1513,1468],\"64330\":[1514,1468],\"64331\":[1493,1465],\"64332\":[1489,1471],\"64333\":[1499,1471],\"64334\":[1508,1471],\"67017\":[67026,775],\"67044\":[67034,775],\"69786\":[69785,69818],\"69788\":[69787,69818],\"69803\":[69797,69818],\"69934\":[69937,69927],\"69935\":[69938,69927],\"70475\":[70471,70462],\"70476\":[70471,70487],\"70531\":[70530,70601],\"70533\":[70532,70587],\"70542\":[70539,70594],\"70545\":[70544,70601],\"70597\":[70594,70594],\"70599\":[70594,70584],\"70600\":[70594,70601],\"70843\":[70841,70842],\"70844\":[70841,70832],\"70846\":[70841,70845],\"71098\":[71096,71087],\"71099\":[71097,71087],\"71992\":[71989,71984],\"90401\":[90398,90398],\"90402\":[90398,90409],\"90403\":[90398,90399],\"90404\":[90409,90399],\"90405\":[90398,90400],\"90406\":[90398,90398,90399],\"90407\":[90398,90409,90399],\"90408\":[90398,90398,90400],\"93544\":[93543,93543],\"93545\":[93539,93543],\"93546\":[93539,93543,93543],\"119134\":[119127,119141],\"119135\":[119128,119141],\"119136\":[119128,119141,119150],\"119137\":[119128,119141,119151],\"119138\":[119128,119141,119152],\"119139\":[119128,119141,119153],\"119140\":[119128,119141,119154],\"119227\":[119225,119141],\"119228\":[119226,119141],\"119229\":[119225,119141,119150],\"119230\":[119226,119141,119150],\"119231\":[119225,119141,119151],\"119232\":[119226,119141,119151],\"194560\":[20029],\"194561\":[20024],\"194562\":[20033],\"194563\":[131362],\"194564\":[20320],\"194565\":[20398],\"194566\":[20411],\"194567\":[20482],\"194568\":[20602],\"194569\":[20633],\"194570\":[20711],\"194571\":[20687],\"194572\":[13470],\"194573\":[132666],\"194574\":[20813],\"194575\":[20820],\"194576\":[20836],\"194577\":[20855],\"194578\":[132380],\"194579\":[13497],\"194580\":[20839],\"194581\":[20877],\"194582\":[132427],\"194583\":[20887],\"194584\":[20900],\"194585\":[20172],\"194586\":[20908],\"194587\":[20917],\"194588\":[168415],\"194589\":[20981],\"194590\":[20995],\"194591\":[13535],\"194592\":[21051],\"194593\":[21062],\"194594\":[21106],\"194595\":[21111],\"194596\":[13589],\"194597\":[21191],\"194598\":[21193],\"194599\":[21220],\"194600\":[21242],\"194601\":[21253],\"194602\":[21254],\"194603\":[21271],\"194604\":[21321],\"194605\":[21329],\"194606\":[21338],\"194607\":[21363],\"194608\":[21373],\"194609\":[21375],\"194610\":[21375],\"194611\":[21375],\"194612\":[133676],\"194613\":[28784],\"194614\":[21450],\"194615\":[21471],\"194616\":[133987],\"194617\":[21483],\"194618\":[21489],\"194619\":[21510],\"194620\":[21662],\"194621\":[21560],\"194622\":[21576],\"194623\":[21608],\"194624\":[21666],\"194625\":[21750],\"194626\":[21776],\"194627\":[21843],\"194628\":[21859],\"194629\":[21892],\"194630\":[21892],\"194631\":[21913],\"194632\":[21931],\"194633\":[21939],\"194634\":[21954],\"194635\":[22294],\"194636\":[22022],\"194637\":[22295],\"194638\":[22097],\"194639\":[22132],\"194640\":[20999],\"194641\":[22766],\"194642\":[22478],\"194643\":[22516],\"194644\":[22541],\"194645\":[22411],\"194646\":[22578],\"194647\":[22577],\"194648\":[22700],\"194649\":[136420],\"194650\":[22770],\"194651\":[22775],\"194652\":[22790],\"194653\":[22810],\"194654\":[22818],\"194655\":[22882],\"194656\":[136872],\"194657\":[136938],\"194658\":[23020],\"194659\":[23067],\"194660\":[23079],\"194661\":[23000],\"194662\":[23142],\"194663\":[14062],\"194664\":[14076],\"194665\":[23304],\"194666\":[23358],\"194667\":[23358],\"194668\":[137672],\"194669\":[23491],\"194670\":[23512],\"194671\":[23527],\"194672\":[23539],\"194673\":[138008],\"194674\":[23551],\"194675\":[23558],\"194676\":[24403],\"194677\":[23586],\"194678\":[14209],\"194679\":[23648],\"194680\":[23662],\"194681\":[23744],\"194682\":[23693],\"194683\":[138724],\"194684\":[23875],\"194685\":[138726],\"194686\":[23918],\"194687\":[23915],\"194688\":[23932],\"194689\":[24033],\"194690\":[24034],\"194691\":[14383],\"194692\":[24061],\"194693\":[24104],\"194694\":[24125],\"194695\":[24169],\"194696\":[14434],\"194697\":[139651],\"194698\":[14460],\"194699\":[24240],\"194700\":[24243],\"194701\":[24246],\"194702\":[24266],\"194703\":[172946],\"194704\":[24318],\"194705\":[140081],\"194706\":[140081],\"194707\":[33281],\"194708\":[24354],\"194709\":[24354],\"194710\":[14535],\"194711\":[144056],\"194712\":[156122],\"194713\":[24418],\"194714\":[24427],\"194715\":[14563],\"194716\":[24474],\"194717\":[24525],\"194718\":[24535],\"194719\":[24569],\"194720\":[24705],\"194721\":[14650],\"194722\":[14620],\"194723\":[24724],\"194724\":[141012],\"194725\":[24775],\"194726\":[24904],\"194727\":[24908],\"194728\":[24910],\"194729\":[24908],\"194730\":[24954],\"194731\":[24974],\"194732\":[25010],\"194733\":[24996],\"194734\":[25007],\"194735\":[25054],\"194736\":[25074],\"194737\":[25078],\"194738\":[25104],\"194739\":[25115],\"194740\":[25181],\"194741\":[25265],\"194742\":[25300],\"194743\":[25424],\"194744\":[142092],\"194745\":[25405],\"194746\":[25340],\"194747\":[25448],\"194748\":[25475],\"194749\":[25572],\"194750\":[142321],\"194751\":[25634],\"194752\":[25541],\"194753\":[25513],\"194754\":[14894],\"194755\":[25705],\"194756\":[25726],\"194757\":[25757],\"194758\":[25719],\"194759\":[14956],\"194760\":[25935],\"194761\":[25964],\"194762\":[143370],\"194763\":[26083],\"194764\":[26360],\"194765\":[26185],\"194766\":[15129],\"194767\":[26257],\"194768\":[15112],\"194769\":[15076],\"194770\":[20882],\"194771\":[20885],\"194772\":[26368],\"194773\":[26268],\"194774\":[32941],\"194775\":[17369],\"194776\":[26391],\"194777\":[26395],\"194778\":[26401],\"194779\":[26462],\"194780\":[26451],\"194781\":[144323],\"194782\":[15177],\"194783\":[26618],\"194784\":[26501],\"194785\":[26706],\"194786\":[26757],\"194787\":[144493],\"194788\":[26766],\"194789\":[26655],\"194790\":[26900],\"194791\":[15261],\"194792\":[26946],\"194793\":[27043],\"194794\":[27114],\"194795\":[27304],\"194796\":[145059],\"194797\":[27355],\"194798\":[15384],\"194799\":[27425],\"194800\":[145575],\"194801\":[27476],\"194802\":[15438],\"194803\":[27506],\"194804\":[27551],\"194805\":[27578],\"194806\":[27579],\"194807\":[146061],\"194808\":[138507],\"194809\":[146170],\"194810\":[27726],\"194811\":[146620],\"194812\":[27839],\"194813\":[27853],\"194814\":[27751],\"194815\":[27926],\"194816\":[27966],\"194817\":[28023],\"194818\":[27969],\"194819\":[28009],\"194820\":[28024],\"194821\":[28037],\"194822\":[146718],\"194823\":[27956],\"194824\":[28207],\"194825\":[28270],\"194826\":[15667],\"194827\":[28363],\"194828\":[28359],\"194829\":[147153],\"194830\":[28153],\"194831\":[28526],\"194832\":[147294],\"194833\":[147342],\"194834\":[28614],\"194835\":[28729],\"194836\":[28702],\"194837\":[28699],\"194838\":[15766],\"194839\":[28746],\"194840\":[28797],\"194841\":[28791],\"194842\":[28845],\"194843\":[132389],\"194844\":[28997],\"194845\":[148067],\"194846\":[29084],\"194847\":[148395],\"194848\":[29224],\"194849\":[29237],\"194850\":[29264],\"194851\":[149000],\"194852\":[29312],\"194853\":[29333],\"194854\":[149301],\"194855\":[149524],\"194856\":[29562],\"194857\":[29579],\"194858\":[16044],\"194859\":[29605],\"194860\":[16056],\"194861\":[16056],\"194862\":[29767],\"194863\":[29788],\"194864\":[29809],\"194865\":[29829],\"194866\":[29898],\"194867\":[16155],\"194868\":[29988],\"194869\":[150582],\"194870\":[30014],\"194871\":[150674],\"194872\":[30064],\"194873\":[139679],\"194874\":[30224],\"194875\":[151457],\"194876\":[151480],\"194877\":[151620],\"194878\":[16380],\"194879\":[16392],\"194880\":[30452],\"194881\":[151795],\"194882\":[151794],\"194883\":[151833],\"194884\":[151859],\"194885\":[30494],\"194886\":[30495],\"194887\":[30495],\"194888\":[30538],\"194889\":[16441],\"194890\":[30603],\"194891\":[16454],\"194892\":[16534],\"194893\":[152605],\"194894\":[30798],\"194895\":[30860],\"194896\":[30924],\"194897\":[16611],\"194898\":[153126],\"194899\":[31062],\"194900\":[153242],\"194901\":[153285],\"194902\":[31119],\"194903\":[31211],\"194904\":[16687],\"194905\":[31296],\"194906\":[31306],\"194907\":[31311],\"194908\":[153980],\"194909\":[154279],\"194910\":[154279],\"194911\":[31470],\"194912\":[16898],\"194913\":[154539],\"194914\":[31686],\"194915\":[31689],\"194916\":[16935],\"194917\":[154752],\"194918\":[31954],\"194919\":[17056],\"194920\":[31976],\"194921\":[31971],\"194922\":[32000],\"194923\":[155526],\"194924\":[32099],\"194925\":[17153],\"194926\":[32199],\"194927\":[32258],\"194928\":[32325],\"194929\":[17204],\"194930\":[156200],\"194931\":[156231],\"194932\":[17241],\"194933\":[156377],\"194934\":[32634],\"194935\":[156478],\"194936\":[32661],\"194937\":[32762],\"194938\":[32773],\"194939\":[156890],\"194940\":[156963],\"194941\":[32864],\"194942\":[157096],\"194943\":[32880],\"194944\":[144223],\"194945\":[17365],\"194946\":[32946],\"194947\":[33027],\"194948\":[17419],\"194949\":[33086],\"194950\":[23221],\"194951\":[157607],\"194952\":[157621],\"194953\":[144275],\"194954\":[144284],\"194955\":[33281],\"194956\":[33284],\"194957\":[36766],\"194958\":[17515],\"194959\":[33425],\"194960\":[33419],\"194961\":[33437],\"194962\":[21171],\"194963\":[33457],\"194964\":[33459],\"194965\":[33469],\"194966\":[33510],\"194967\":[158524],\"194968\":[33509],\"194969\":[33565],\"194970\":[33635],\"194971\":[33709],\"194972\":[33571],\"194973\":[33725],\"194974\":[33767],\"194975\":[33879],\"194976\":[33619],\"194977\":[33738],\"194978\":[33740],\"194979\":[33756],\"194980\":[158774],\"194981\":[159083],\"194982\":[158933],\"194983\":[17707],\"194984\":[34033],\"194985\":[34035],\"194986\":[34070],\"194987\":[160714],\"194988\":[34148],\"194989\":[159532],\"194990\":[17757],\"194991\":[17761],\"194992\":[159665],\"194993\":[159954],\"194994\":[17771],\"194995\":[34384],\"194996\":[34396],\"194997\":[34407],\"194998\":[34409],\"194999\":[34473],\"195000\":[34440],\"195001\":[34574],\"195002\":[34530],\"195003\":[34681],\"195004\":[34600],\"195005\":[34667],\"195006\":[34694],\"195007\":[17879],\"195008\":[34785],\"195009\":[34817],\"195010\":[17913],\"195011\":[34912],\"195012\":[34915],\"195013\":[161383],\"195014\":[35031],\"195015\":[35038],\"195016\":[17973],\"195017\":[35066],\"195018\":[13499],\"195019\":[161966],\"195020\":[162150],\"195021\":[18110],\"195022\":[18119],\"195023\":[35488],\"195024\":[35565],\"195025\":[35722],\"195026\":[35925],\"195027\":[162984],\"195028\":[36011],\"195029\":[36033],\"195030\":[36123],\"195031\":[36215],\"195032\":[163631],\"195033\":[133124],\"195034\":[36299],\"195035\":[36284],\"195036\":[36336],\"195037\":[133342],\"195038\":[36564],\"195039\":[36664],\"195040\":[165330],\"195041\":[165357],\"195042\":[37012],\"195043\":[37105],\"195044\":[37137],\"195045\":[165678],\"195046\":[37147],\"195047\":[37432],\"195048\":[37591],\"195049\":[37592],\"195050\":[37500],\"195051\":[37881],\"195052\":[37909],\"195053\":[166906],\"195054\":[38283],\"195055\":[18837],\"195056\":[38327],\"195057\":[167287],\"195058\":[18918],\"195059\":[38595],\"195060\":[23986],\"195061\":[38691],\"195062\":[168261],\"195063\":[168474],\"195064\":[19054],\"195065\":[19062],\"195066\":[38880],\"195067\":[168970],\"195068\":[19122],\"195069\":[169110],\"195070\":[38923],\"195071\":[38923],\"195072\":[38953],\"195073\":[169398],\"195074\":[39138],\"195075\":[19251],\"195076\":[39209],\"195077\":[39335],\"195078\":[39362],\"195079\":[39422],\"195080\":[19406],\"195081\":[170800],\"195082\":[39698],\"195083\":[40000],\"195084\":[40189],\"195085\":[19662],\"195086\":[19693],\"195087\":[40295],\"195088\":[172238],\"195089\":[19704],\"195090\":[172293],\"195091\":[172558],\"195092\":[172689],\"195093\":[40635],\"195094\":[19798],\"195095\":[40697],\"195096\":[40702],\"195097\":[40709],\"195098\":[40719],\"195099\":[40726],\"195100\":[40763],\"195101\":[173568]},\"ccc\":{\"768\":230,\"769\":230,\"770\":230,\"771\":230,\"772\":230,\"773\":230,\"774\":230,\"775\":230,\"776\":230,\"777\":230,\"778\":230,\"779\":230,\"780\":230,\"781\":230,\"782\":230,\"783\":230,\"784\":230,\"785\":230,\"786\":230,\"787\":230,\"788\":230,\"789\":232,\"790\":220,\"791\":220,\"792\":220,\"793\":220,\"794\":232,\"795\":216,\"796\":220,\"797\":220,\"798\":220,\"799\":220,\"800\":220,\"801\":202,\"802\":202,\"803\":220,\"804\":220,\"805\":220,\"806\":220,\"807\":202,\"808\":202,\"809\":220,\"810\":220,\"811\":220,\"812\":220,\"813\":220,\"814\":220,\"815\":220,\"816\":220,\"817\":220,\"818\":220,\"819\":220,\"820\":1,\"821\":1,\"822\":1,\"823\":1,\"824\":1,\"825\":220,\"826\":220,\"827\":220,\"828\":220,\"829\":230,\"830\":230,\"831\":230,\"832\":230,\"833\":230,\"834\":230,\"835\":230,\"836\":230,\"837\":240,\"838\":230,\"839\":220,\"840\":220,\"841\":220,\"842\":230,\"843\":230,\"844\":230,\"845\":220,\"846\":220,\"848\":230,\"849\":230,\"850\":230,\"851\":220,\"852\":220,\"853\":220,\"854\":220,\"855\":230,\"856\":232,\"857\":220,\"858\":220,\"859\":230,\"860\":233,\"861\":234,\"862\":234,\"863\":233,\"864\":234,\"865\":234,\"866\":233,\"867\":230,\"868\":230,\"869\":230,\"870\":230,\"871\":230,\"872\":230,\"873\":230,\"874\":230,\"875\":230,\"876\":230,\"877\":230,\"878\":230,\"879\":230,\"1155\":230,\"1156\":230,\"1157\":230,\"1158\":230,\"1159\":230,\"1425\":220,\"1426\":230,\"1427\":230,\"1428\":230,\"1429\":230,\"1430\":220,\"1431\":230,\"1432\":230,\"1433\":230,\"1434\":222,\"1435\":220,\"1436\":230,\"1437\":230,\"1438\":230,\"1439\":230,\"1440\":230,\"1441\":230,\"1442\":220,\"1443\":220,\"1444\":220,\"1445\":220,\"1446\":220,\"1447\":220,\"1448\":230,\"1449\":230,\"1450\":220,\"1451\":230,\"1452\":230,\"1453\":222,\"1454\":228,\"1455\":230,\"1456\":10,\"1457\":11,\"1458\":12,\"1459\":13,\"1460\":14,\"1461\":15,\"1462\":16,\"1463\":17,\"1464\":18,\"1465\":19,\"1466\":19,\"1467\":20,\"1468\":21,\"1469\":22,\"1471\":23,\"1473\":24,\"1474\":25,\"1476\":230,\"1477\":220,\"1479\":18,\"1552\":230,\"1553\":230,\"1554\":230,\"1555\":230,\"1556\":230,\"1557\":230,\"1558\":230,\"1559\":230,\"1560\":30,\"1561\":31,\"1562\":32,\"1611\":27,\"1612\":28,\"1613\":29,\"1614\":30,\"1615\":31,\"1616\":32,\"1617\":33,\"1618\":34,\"1619\":230,\"1620\":230,\"1621\":220,\"1622\":220,\"1623\":230,\"1624\":230,\"1625\":230,\"1626\":230,\"1627\":230,\"1628\":220,\"1629\":230,\"1630\":230,\"1631\":220,\"1648\":35,\"1750\":230,\"1751\":230,\"1752\":230,\"1753\":230,\"1754\":230,\"1755\":230,\"1756\":230,\"1759\":230,\"1760\":230,\"1761\":230,\"1762\":230,\"1763\":220,\"1764\":230,\"1767\":230,\"1768\":230,\"1770\":220,\"1771\":230,\"1772\":230,\"1773\":220,\"1809\":36,\"1840\":230,\"1841\":220,\"1842\":230,\"1843\":230,\"1844\":220,\"1845\":230,\"1846\":230,\"1847\":220,\"1848\":220,\"1849\":220,\"1850\":230,\"1851\":220,\"1852\":220,\"1853\":230,\"1854\":220,\"1855\":230,\"1856\":230,\"1857\":230,\"1858\":220,\"1859\":230,\"1860\":220,\"1861\":230,\"1862\":220,\"1863\":230,\"1864\":220,\"1865\":230,\"1866\":230,\"2027\":230,\"2028\":230,\"2029\":230,\"2030\":230,\"2031\":230,\"2032\":230,\"2033\":230,\"2034\":220,\"2035\":230,\"2045\":220,\"2070\":230,\"2071\":230,\"2072\":230,\"2073\":230,\"2075\":230,\"2076\":230,\"2077\":230,\"2078\":230,\"2079\":230,\"2080\":230,\"2081\":230,\"2082\":230,\"2083\":230,\"2085\":230,\"2086\":230,\"2087\":230,\"2089\":230,\"2090\":230,\"2091\":230,\"2092\":230,\"2093\":230,\"2137\":220,\"2138\":220,\"2139\":220,\"2199\":230,\"2200\":230,\"2201\":220,\"2202\":220,\"2203\":220,\"2204\":230,\"2205\":230,\"2206\":230,\"2207\":230,\"2250\":230,\"2251\":230,\"2252\":230,\"2253\":230,\"2254\":230,\"2255\":220,\"2256\":220,\"2257\":220,\"2258\":220,\"2259\":220,\"2260\":230,\"2261\":230,\"2262\":230,\"2263\":230,\"2264\":230,\"2265\":230,\"2266\":230,\"2267\":230,\"2268\":230,\"2269\":230,\"2270\":230,\"2271\":230,\"2272\":230,\"2273\":230,\"2275\":220,\"2276\":230,\"2277\":230,\"2278\":220,\"2279\":230,\"2280\":230,\"2281\":220,\"2282\":230,\"2283\":230,\"2284\":230,\"2285\":220,\"2286\":220,\"2287\":220,\"2288\":27,\"2289\":28,\"2290\":29,\"2291\":230,\"2292\":230,\"2293\":230,\"2294\":220,\"2295\":230,\"2296\":230,\"2297\":220,\"2298\":220,\"2299\":230,\"2300\":230,\"2301\":230,\"2302\":230,\"2303\":230,\"2364\":7,\"2381\":9,\"2385\":230,\"2386\":220,\"2387\":230,\"2388\":230,\"2492\":7,\"2509\":9,\"2558\":230,\"2620\":7,\"2637\":9,\"2748\":7,\"2765\":9,\"2876\":7,\"2893\":9,\"3021\":9,\"3132\":7,\"3149\":9,\"3157\":84,\"3158\":91,\"3260\":7,\"3277\":9,\"3387\":9,\"3388\":9,\"3405\":9,\"3530\":9,\"3640\":103,\"3641\":103,\"3642\":9,\"3656\":107,\"3657\":107,\"3658\":107,\"3659\":107,\"3768\":118,\"3769\":118,\"3770\":9,\"3784\":122,\"3785\":122,\"3786\":122,\"3787\":122,\"3864\":220,\"3865\":220,\"3893\":220,\"3895\":220,\"3897\":216,\"3953\":129,\"3954\":130,\"3956\":132,\"3962\":130,\"3963\":130,\"3964\":130,\"3965\":130,\"3968\":130,\"3970\":230,\"3971\":230,\"3972\":9,\"3974\":230,\"3975\":230,\"4038\":220,\"4151\":7,\"4153\":9,\"4154\":9,\"4237\":220,\"4957\":230,\"4958\":230,\"4959\":230,\"5908\":9,\"5909\":9,\"5940\":9,\"6098\":9,\"6109\":230,\"6313\":228,\"6457\":222,\"6458\":230,\"6459\":220,\"6679\":230,\"6680\":220,\"6752\":9,\"6773\":230,\"6774\":230,\"6775\":230,\"6776\":230,\"6777\":230,\"6778\":230,\"6779\":230,\"6780\":230,\"6783\":220,\"6832\":230,\"6833\":230,\"6834\":230,\"6835\":230,\"6836\":230,\"6837\":220,\"6838\":220,\"6839\":220,\"6840\":220,\"6841\":220,\"6842\":220,\"6843\":230,\"6844\":230,\"6845\":220,\"6847\":220,\"6848\":220,\"6849\":230,\"6850\":230,\"6851\":220,\"6852\":220,\"6853\":230,\"6854\":230,\"6855\":230,\"6856\":230,\"6857\":230,\"6858\":220,\"6859\":230,\"6860\":230,\"6861\":230,\"6862\":230,\"6863\":230,\"6864\":230,\"6865\":230,\"6866\":230,\"6867\":230,\"6868\":230,\"6869\":230,\"6870\":230,\"6871\":230,\"6872\":230,\"6873\":230,\"6874\":230,\"6875\":230,\"6876\":230,\"6877\":220,\"6880\":230,\"6881\":230,\"6882\":230,\"6883\":230,\"6884\":230,\"6885\":230,\"6886\":220,\"6887\":230,\"6888\":230,\"6889\":230,\"6890\":230,\"6891\":234,\"6964\":7,\"6980\":9,\"7019\":230,\"7020\":220,\"7021\":230,\"7022\":230,\"7023\":230,\"7024\":230,\"7025\":230,\"7026\":230,\"7027\":230,\"7082\":9,\"7083\":9,\"7142\":7,\"7154\":9,\"7155\":9,\"7223\":7,\"7376\":230,\"7377\":230,\"7378\":230,\"7380\":1,\"7381\":220,\"7382\":220,\"7383\":220,\"7384\":220,\"7385\":220,\"7386\":230,\"7387\":230,\"7388\":220,\"7389\":220,\"7390\":220,\"7391\":220,\"7392\":230,\"7394\":1,\"7395\":1,\"7396\":1,\"7397\":1,\"7398\":1,\"7399\":1,\"7400\":1,\"7405\":220,\"7412\":230,\"7416\":230,\"7417\":230,\"7616\":230,\"7617\":230,\"7618\":220,\"7619\":230,\"7620\":230,\"7621\":230,\"7622\":230,\"7623\":230,\"7624\":230,\"7625\":230,\"7626\":220,\"7627\":230,\"7628\":230,\"7629\":234,\"7630\":214,\"7631\":220,\"7632\":202,\"7633\":230,\"7634\":230,\"7635\":230,\"7636\":230,\"7637\":230,\"7638\":230,\"7639\":230,\"7640\":230,\"7641\":230,\"7642\":230,\"7643\":230,\"7644\":230,\"7645\":230,\"7646\":230,\"7647\":230,\"7648\":230,\"7649\":230,\"7650\":230,\"7651\":230,\"7652\":230,\"7653\":230,\"7654\":230,\"7655\":230,\"7656\":230,\"7657\":230,\"7658\":230,\"7659\":230,\"7660\":230,\"7661\":230,\"7662\":230,\"7663\":230,\"7664\":230,\"7665\":230,\"7666\":230,\"7667\":230,\"7668\":230,\"7669\":230,\"7670\":232,\"7671\":228,\"7672\":228,\"7673\":220,\"7674\":218,\"7675\":230,\"7676\":233,\"7677\":220,\"7678\":230,\"7679\":220,\"8400\":230,\"8401\":230,\"8402\":1,\"8403\":1,\"8404\":230,\"8405\":230,\"8406\":230,\"8407\":230,\"8408\":1,\"8409\":1,\"8410\":1,\"8411\":230,\"8412\":230,\"8417\":230,\"8421\":1,\"8422\":1,\"8423\":230,\"8424\":220,\"8425\":230,\"8426\":1,\"8427\":1,\"8428\":220,\"8429\":220,\"8430\":220,\"8431\":220,\"8432\":230,\"11503\":230,\"11504\":230,\"11505\":230,\"11647\":9,\"11744\":230,\"11745\":230,\"11746\":230,\"11747\":230,\"11748\":230,\"11749\":230,\"11750\":230,\"11751\":230,\"11752\":230,\"11753\":230,\"11754\":230,\"11755\":230,\"11756\":230,\"11757\":230,\"11758\":230,\"11759\":230,\"11760\":230,\"11761\":230,\"11762\":230,\"11763\":230,\"11764\":230,\"11765\":230,\"11766\":230,\"11767\":230,\"11768\":230,\"11769\":230,\"11770\":230,\"11771\":230,\"11772\":230,\"11773\":230,\"11774\":230,\"11775\":230,\"12330\":218,\"12331\":228,\"12332\":232,\"12333\":222,\"12334\":224,\"12335\":224,\"12441\":8,\"12442\":8,\"42607\":230,\"42612\":230,\"42613\":230,\"42614\":230,\"42615\":230,\"42616\":230,\"42617\":230,\"42618\":230,\"42619\":230,\"42620\":230,\"42621\":230,\"42654\":230,\"42655\":230,\"42736\":230,\"42737\":230,\"43014\":9,\"43052\":9,\"43204\":9,\"43232\":230,\"43233\":230,\"43234\":230,\"43235\":230,\"43236\":230,\"43237\":230,\"43238\":230,\"43239\":230,\"43240\":230,\"43241\":230,\"43242\":230,\"43243\":230,\"43244\":230,\"43245\":230,\"43246\":230,\"43247\":230,\"43248\":230,\"43249\":230,\"43307\":220,\"43308\":220,\"43309\":220,\"43347\":9,\"43443\":7,\"43456\":9,\"43696\":230,\"43698\":230,\"43699\":230,\"43700\":220,\"43703\":230,\"43704\":230,\"43710\":230,\"43711\":230,\"43713\":230,\"43766\":9,\"44013\":9,\"64286\":26,\"65056\":230,\"65057\":230,\"65058\":230,\"65059\":230,\"65060\":230,\"65061\":230,\"65062\":230,\"65063\":220,\"65064\":220,\"65065\":220,\"65066\":220,\"65067\":220,\"65068\":220,\"65069\":220,\"65070\":230,\"65071\":230,\"66045\":220,\"66272\":220,\"66422\":230,\"66423\":230,\"66424\":230,\"66425\":230,\"66426\":230,\"68109\":220,\"68111\":230,\"68152\":230,\"68153\":1,\"68154\":220,\"68159\":9,\"68325\":230,\"68326\":220,\"68900\":230,\"68901\":230,\"68902\":230,\"68903\":230,\"68969\":230,\"68970\":230,\"68971\":230,\"68972\":230,\"68973\":230,\"69291\":230,\"69292\":230,\"69370\":220,\"69371\":220,\"69373\":220,\"69374\":220,\"69375\":220,\"69446\":220,\"69447\":220,\"69448\":230,\"69449\":230,\"69450\":230,\"69451\":220,\"69452\":230,\"69453\":220,\"69454\":220,\"69455\":220,\"69456\":220,\"69506\":230,\"69507\":220,\"69508\":230,\"69509\":220,\"69702\":9,\"69744\":9,\"69759\":9,\"69817\":9,\"69818\":7,\"69888\":230,\"69889\":230,\"69890\":230,\"69939\":9,\"69940\":9,\"70003\":7,\"70080\":9,\"70090\":7,\"70197\":9,\"70198\":7,\"70377\":7,\"70378\":9,\"70459\":7,\"70460\":7,\"70477\":9,\"70502\":230,\"70503\":230,\"70504\":230,\"70505\":230,\"70506\":230,\"70507\":230,\"70508\":230,\"70512\":230,\"70513\":230,\"70514\":230,\"70515\":230,\"70516\":230,\"70606\":9,\"70607\":9,\"70608\":9,\"70722\":9,\"70726\":7,\"70750\":230,\"70850\":9,\"70851\":7,\"71103\":9,\"71104\":7,\"71231\":9,\"71350\":9,\"71351\":7,\"71467\":9,\"71737\":9,\"71738\":7,\"71997\":9,\"71998\":9,\"72003\":7,\"72160\":9,\"72244\":9,\"72263\":9,\"72345\":9,\"72767\":9,\"73026\":7,\"73028\":9,\"73029\":9,\"73111\":9,\"73537\":9,\"73538\":9,\"90415\":9,\"92912\":1,\"92913\":1,\"92914\":1,\"92915\":1,\"92916\":1,\"92976\":230,\"92977\":230,\"92978\":230,\"92979\":230,\"92980\":230,\"92981\":230,\"92982\":230,\"94192\":6,\"94193\":6,\"113822\":1,\"119141\":216,\"119142\":216,\"119143\":1,\"119144\":1,\"119145\":1,\"119149\":226,\"119150\":216,\"119151\":216,\"119152\":216,\"119153\":216,\"119154\":216,\"119163\":220,\"119164\":220,\"119165\":220,\"119166\":220,\"119167\":220,\"119168\":220,\"119169\":220,\"119170\":220,\"119173\":230,\"119174\":230,\"119175\":230,\"119176\":230,\"119177\":230,\"119178\":220,\"119179\":220,\"119210\":230,\"119211\":230,\"119212\":230,\"119213\":230,\"119362\":230,\"119363\":230,\"119364\":230,\"122880\":230,\"122881\":230,\"122882\":230,\"122883\":230,\"122884\":230,\"122885\":230,\"122886\":230,\"122888\":230,\"122889\":230,\"122890\":230,\"122891\":230,\"122892\":230,\"122893\":230,\"122894\":230,\"122895\":230,\"122896\":230,\"122897\":230,\"122898\":230,\"122899\":230,\"122900\":230,\"122901\":230,\"122902\":230,\"122903\":230,\"122904\":230,\"122907\":230,\"122908\":230,\"122909\":230,\"122910\":230,\"122911\":230,\"122912\":230,\"122913\":230,\"122915\":230,\"122916\":230,\"122918\":230,\"122919\":230,\"122920\":230,\"122921\":230,\"122922\":230,\"123023\":230,\"123184\":230,\"123185\":230,\"123186\":230,\"123187\":230,\"123188\":230,\"123189\":230,\"123190\":230,\"123566\":230,\"123628\":230,\"123629\":230,\"123630\":230,\"123631\":230,\"124140\":232,\"124141\":232,\"124142\":220,\"124143\":230,\"124398\":230,\"124399\":220,\"124643\":230,\"124646\":230,\"124654\":230,\"124655\":230,\"124661\":230,\"125136\":220,\"125137\":220,\"125138\":220,\"125139\":220,\"125140\":220,\"125141\":220,\"125142\":220,\"125252\":230,\"125253\":230,\"125254\":230,\"125255\":230,\"125256\":230,\"125257\":230,\"125258\":7},\"lower\":{\"65\":[97],\"66\":[98],\"67\":[99],\"68\":[100],\"69\":[101],\"70\":[102],\"71\":[103],\"72\":[104],\"73\":[105],\"74\":[106],\"75\":[107],\"76\":[108],\"77\":[109],\"78\":[110],\"79\":[111],\"80\":[112],\"81\":[113],\"82\":[114],\"83\":[115],\"84\":[116],\"85\":[117],\"86\":[118],\"87\":[119],\"88\":[120],\"89\":[121],\"90\":[122],\"192\":[224],\"193\":[225],\"194\":[226],\"195\":[227],\"196\":[228],\"197\":[229],\"198\":[230],\"199\":[231],\"200\":[232],\"201\":[233],\"202\":[234],\"203\":[235],\"204\":[236],\"205\":[237],\"206\":[238],\"207\":[239],\"208\":[240],\"209\":[241],\"210\":[242],\"211\":[243],\"212\":[244],\"213\":[245],\"214\":[246],\"216\":[248],\"217\":[249],\"218\":[250],\"219\":[251],\"220\":[252],\"221\":[253],\"222\":[254],\"256\":[257],\"258\":[259],\"260\":[261],\"262\":[263],\"264\":[265],\"266\":[267],\"268\":[269],\"270\":[271],\"272\":[273],\"274\":[275],\"276\":[277],\"278\":[279],\"280\":[281],\"282\":[283],\"284\":[285],\"286\":[287],\"288\":[289],\"290\":[291],\"292\":[293],\"294\":[295],\"296\":[297],\"298\":[299],\"300\":[301],\"302\":[303],\"304\":[105,775],\"306\":[307],\"308\":[309],\"310\":[311],\"313\":[314],\"315\":[316],\"317\":[318],\"319\":[320],\"321\":[322],\"323\":[324],\"325\":[326],\"327\":[328],\"330\":[331],\"332\":[333],\"334\":[335],\"336\":[337],\"338\":[339],\"340\":[341],\"342\":[343],\"344\":[345],\"346\":[347],\"348\":[349],\"350\":[351],\"352\":[353],\"354\":[355],\"356\":[357],\"358\":[359],\"360\":[361],\"362\":[363],\"364\":[365],\"366\":[367],\"368\":[369],\"370\":[371],\"372\":[373],\"374\":[375],\"376\":[255],\"377\":[378],\"379\":[380],\"381\":[382],\"385\":[595],\"386\":[387],\"388\":[389],\"390\":[596],\"391\":[392],\"393\":[598],\"394\":[599],\"395\":[396],\"398\":[477],\"399\":[601],\"400\":[603],\"401\":[402],\"403\":[608],\"404\":[611],\"406\":[617],\"407\":[616],\"408\":[409],\"412\":[623],\"413\":[626],\"415\":[629],\"416\":[417],\"418\":[419],\"420\":[421],\"422\":[640],\"423\":[424],\"425\":[643],\"428\":[429],\"430\":[648],\"431\":[432],\"433\":[650],\"434\":[651],\"435\":[436],\"437\":[438],\"439\":[658],\"440\":[441],\"444\":[445],\"452\":[454],\"453\":[454],\"455\":[457],\"456\":[457],\"458\":[460],\"459\":[460],\"461\":[462],\"463\":[464],\"465\":[466],\"467\":[468],\"469\":[470],\"471\":[472],\"473\":[474],\"475\":[476],\"478\":[479],\"480\":[481],\"482\":[483],\"484\":[485],\"486\":[487],\"488\":[489],\"490\":[491],\"492\":[493],\"494\":[495],\"497\":[499],\"498\":[499],\"500\":[501],\"502\":[405],\"503\":[447],\"504\":[505],\"506\":[507],\"508\":[509],\"510\":[511],\"512\":[513],\"514\":[515],\"516\":[517],\"518\":[519],\"520\":[521],\"522\":[523],\"524\":[525],\"526\":[527],\"528\":[529],\"530\":[531],\"532\":[533],\"534\":[535],\"536\":[537],\"538\":[539],\"540\":[541],\"542\":[543],\"544\":[414],\"546\":[547],\"548\":[549],\"550\":[551],\"552\":[553],\"554\":[555],\"556\":[557],\"558\":[559],\"560\":[561],\"562\":[563],\"570\":[11365],\"571\":[572],\"573\":[410],\"574\":[11366],\"577\":[578],\"579\":[384],\"580\":[649],\"581\":[652],\"582\":[583],\"584\":[585],\"586\":[587],\"588\":[589],\"590\":[591],\"880\":[881],\"882\":[883],\"886\":[887],\"895\":[1011],\"902\":[940],\"904\":[941],\"905\":[942],\"906\":[943],\"908\":[972],\"910\":[973],\"911\":[974],\"913\":[945],\"914\":[946],\"915\":[947],\"916\":[948],\"917\":[949],\"918\":[950],\"919\":[951],\"920\":[952],\"921\":[953],\"922\":[954],\"923\":[955],\"924\":[956],\"925\":[957],\"926\":[958],\"927\":[959],\"928\":[960],\"929\":[961],\"931\":[963],\"932\":[964],\"933\":[965],\"934\":[966],\"935\":[967],\"936\":[968],\"937\":[969],\"938\":[970],\"939\":[971],\"975\":[983],\"984\":[985],\"986\":[987],\"988\":[989],\"990\":[991],\"992\":[993],\"994\":[995],\"996\":[997],\"998\":[999],\"1000\":[1001],\"1002\":[1003],\"1004\":[1005],\"1006\":[1007],\"1012\":[952],\"1015\":[1016],\"1017\":[1010],\"1018\":[1019],\"1021\":[891],\"1022\":[892],\"1023\":[893],\"1024\":[1104],\"1025\":[1105],\"1026\":[1106],\"1027\":[1107],\"1028\":[1108],\"1029\":[1109],\"1030\":[1110],\"1031\":[1111],\"1032\":[1112],\"1033\":[1113],\"1034\":[1114],\"1035\":[1115],\"1036\":[1116],\"1037\":[1117],\"1038\":[1118],\"1039\":[1119],\"1040\":[1072],\"1041\":[1073],\"1042\":[1074],\"1043\":[1075],\"1044\":[1076],\"1045\":[1077],\"1046\":[1078],\"1047\":[1079],\"1048\":[1080],\"1049\":[1081],\"1050\":[1082],\"1051\":[1083],\"1052\":[1084],\"1053\":[1085],\"1054\":[1086],\"1055\":[1087],\"1056\":[1088],\"1057\":[1089],\"1058\":[1090],\"1059\":[1091],\"1060\":[1092],\"1061\":[1093],\"1062\":[1094],\"1063\":[1095],\"1064\":[1096],\"1065\":[1097],\"1066\":[1098],\"1067\":[1099],\"1068\":[1100],\"1069\":[1101],\"1070\":[1102],\"1071\":[1103],\"1120\":[1121],\"1122\":[1123],\"1124\":[1125],\"1126\":[1127],\"1128\":[1129],\"1130\":[1131],\"1132\":[1133],\"1134\":[1135],\"1136\":[1137],\"1138\":[1139],\"1140\":[1141],\"1142\":[1143],\"1144\":[1145],\"1146\":[1147],\"1148\":[1149],\"1150\":[1151],\"1152\":[1153],\"1162\":[1163],\"1164\":[1165],\"1166\":[1167],\"1168\":[1169],\"1170\":[1171],\"1172\":[1173],\"1174\":[1175],\"1176\":[1177],\"1178\":[1179],\"1180\":[1181],\"1182\":[1183],\"1184\":[1185],\"1186\":[1187],\"1188\":[1189],\"1190\":[1191],\"1192\":[1193],\"1194\":[1195],\"1196\":[1197],\"1198\":[1199],\"1200\":[1201],\"1202\":[1203],\"1204\":[1205],\"1206\":[1207],\"1208\":[1209],\"1210\":[1211],\"1212\":[1213],\"1214\":[1215],\"1216\":[1231],\"1217\":[1218],\"1219\":[1220],\"1221\":[1222],\"1223\":[1224],\"1225\":[1226],\"1227\":[1228],\"1229\":[1230],\"1232\":[1233],\"1234\":[1235],\"1236\":[1237],\"1238\":[1239],\"1240\":[1241],\"1242\":[1243],\"1244\":[1245],\"1246\":[1247],\"1248\":[1249],\"1250\":[1251],\"1252\":[1253],\"1254\":[1255],\"1256\":[1257],\"1258\":[1259],\"1260\":[1261],\"1262\":[1263],\"1264\":[1265],\"1266\":[1267],\"1268\":[1269],\"1270\":[1271],\"1272\":[1273],\"1274\":[1275],\"1276\":[1277],\"1278\":[1279],\"1280\":[1281],\"1282\":[1283],\"1284\":[1285],\"1286\":[1287],\"1288\":[1289],\"1290\":[1291],\"1292\":[1293],\"1294\":[1295],\"1296\":[1297],\"1298\":[1299],\"1300\":[1301],\"1302\":[1303],\"1304\":[1305],\"1306\":[1307],\"1308\":[1309],\"1310\":[1311],\"1312\":[1313],\"1314\":[1315],\"1316\":[1317],\"1318\":[1319],\"1320\":[1321],\"1322\":[1323],\"1324\":[1325],\"1326\":[1327],\"1329\":[1377],\"1330\":[1378],\"1331\":[1379],\"1332\":[1380],\"1333\":[1381],\"1334\":[1382],\"1335\":[1383],\"1336\":[1384],\"1337\":[1385],\"1338\":[1386],\"1339\":[1387],\"1340\":[1388],\"1341\":[1389],\"1342\":[1390],\"1343\":[1391],\"1344\":[1392],\"1345\":[1393],\"1346\":[1394],\"1347\":[1395],\"1348\":[1396],\"1349\":[1397],\"1350\":[1398],\"1351\":[1399],\"1352\":[1400],\"1353\":[1401],\"1354\":[1402],\"1355\":[1403],\"1356\":[1404],\"1357\":[1405],\"1358\":[1406],\"1359\":[1407],\"1360\":[1408],\"1361\":[1409],\"1362\":[1410],\"1363\":[1411],\"1364\":[1412],\"1365\":[1413],\"1366\":[1414],\"4256\":[11520],\"4257\":[11521],\"4258\":[11522],\"4259\":[11523],\"4260\":[11524],\"4261\":[11525],\"4262\":[11526],\"4263\":[11527],\"4264\":[11528],\"4265\":[11529],\"4266\":[11530],\"4267\":[11531],\"4268\":[11532],\"4269\":[11533],\"4270\":[11534],\"4271\":[11535],\"4272\":[11536],\"4273\":[11537],\"4274\":[11538],\"4275\":[11539],\"4276\":[11540],\"4277\":[11541],\"4278\":[11542],\"4279\":[11543],\"4280\":[11544],\"4281\":[11545],\"4282\":[11546],\"4283\":[11547],\"4284\":[11548],\"4285\":[11549],\"4286\":[11550],\"4287\":[11551],\"4288\":[11552],\"4289\":[11553],\"4290\":[11554],\"4291\":[11555],\"4292\":[11556],\"4293\":[11557],\"4295\":[11559],\"4301\":[11565],\"5024\":[43888],\"5025\":[43889],\"5026\":[43890],\"5027\":[43891],\"5028\":[43892],\"5029\":[43893],\"5030\":[43894],\"5031\":[43895],\"5032\":[43896],\"5033\":[43897],\"5034\":[43898],\"5035\":[43899],\"5036\":[43900],\"5037\":[43901],\"5038\":[43902],\"5039\":[43903],\"5040\":[43904],\"5041\":[43905],\"5042\":[43906],\"5043\":[43907],\"5044\":[43908],\"5045\":[43909],\"5046\":[43910],\"5047\":[43911],\"5048\":[43912],\"5049\":[43913],\"5050\":[43914],\"5051\":[43915],\"5052\":[43916],\"5053\":[43917],\"5054\":[43918],\"5055\":[43919],\"5056\":[43920],\"5057\":[43921],\"5058\":[43922],\"5059\":[43923],\"5060\":[43924],\"5061\":[43925],\"5062\":[43926],\"5063\":[43927],\"5064\":[43928],\"5065\":[43929],\"5066\":[43930],\"5067\":[43931],\"5068\":[43932],\"5069\":[43933],\"5070\":[43934],\"5071\":[43935],\"5072\":[43936],\"5073\":[43937],\"5074\":[43938],\"5075\":[43939],\"5076\":[43940],\"5077\":[43941],\"5078\":[43942],\"5079\":[43943],\"5080\":[43944],\"5081\":[43945],\"5082\":[43946],\"5083\":[43947],\"5084\":[43948],\"5085\":[43949],\"5086\":[43950],\"5087\":[43951],\"5088\":[43952],\"5089\":[43953],\"5090\":[43954],\"5091\":[43955],\"5092\":[43956],\"5093\":[43957],\"5094\":[43958],\"5095\":[43959],\"5096\":[43960],\"5097\":[43961],\"5098\":[43962],\"5099\":[43963],\"5100\":[43964],\"5101\":[43965],\"5102\":[43966],\"5103\":[43967],\"5104\":[5112],\"5105\":[5113],\"5106\":[5114],\"5107\":[5115],\"5108\":[5116],\"5109\":[5117],\"7305\":[7306],\"7312\":[4304],\"7313\":[4305],\"7314\":[4306],\"7315\":[4307],\"7316\":[4308],\"7317\":[4309],\"7318\":[4310],\"7319\":[4311],\"7320\":[4312],\"7321\":[4313],\"7322\":[4314],\"7323\":[4315],\"7324\":[4316],\"7325\":[4317],\"7326\":[4318],\"7327\":[4319],\"7328\":[4320],\"7329\":[4321],\"7330\":[4322],\"7331\":[4323],\"7332\":[4324],\"7333\":[4325],\"7334\":[4326],\"7335\":[4327],\"7336\":[4328],\"7337\":[4329],\"7338\":[4330],\"7339\":[4331],\"7340\":[4332],\"7341\":[4333],\"7342\":[4334],\"7343\":[4335],\"7344\":[4336],\"7345\":[4337],\"7346\":[4338],\"7347\":[4339],\"7348\":[4340],\"7349\":[4341],\"7350\":[4342],\"7351\":[4343],\"7352\":[4344],\"7353\":[4345],\"7354\":[4346],\"7357\":[4349],\"7358\":[4350],\"7359\":[4351],\"7680\":[7681],\"7682\":[7683],\"7684\":[7685],\"7686\":[7687],\"7688\":[7689],\"7690\":[7691],\"7692\":[7693],\"7694\":[7695],\"7696\":[7697],\"7698\":[7699],\"7700\":[7701],\"7702\":[7703],\"7704\":[7705],\"7706\":[7707],\"7708\":[7709],\"7710\":[7711],\"7712\":[7713],\"7714\":[7715],\"7716\":[7717],\"7718\":[7719],\"7720\":[7721],\"7722\":[7723],\"7724\":[7725],\"7726\":[7727],\"7728\":[7729],\"7730\":[7731],\"7732\":[7733],\"7734\":[7735],\"7736\":[7737],\"7738\":[7739],\"7740\":[7741],\"7742\":[7743],\"7744\":[7745],\"7746\":[7747],\"7748\":[7749],\"7750\":[7751],\"7752\":[7753],\"7754\":[7755],\"7756\":[7757],\"7758\":[7759],\"7760\":[7761],\"7762\":[7763],\"7764\":[7765],\"7766\":[7767],\"7768\":[7769],\"7770\":[7771],\"7772\":[7773],\"7774\":[7775],\"7776\":[7777],\"7778\":[7779],\"7780\":[7781],\"7782\":[7783],\"7784\":[7785],\"7786\":[7787],\"7788\":[7789],\"7790\":[7791],\"7792\":[7793],\"7794\":[7795],\"7796\":[7797],\"7798\":[7799],\"7800\":[7801],\"7802\":[7803],\"7804\":[7805],\"7806\":[7807],\"7808\":[7809],\"7810\":[7811],\"7812\":[7813],\"7814\":[7815],\"7816\":[7817],\"7818\":[7819],\"7820\":[7821],\"7822\":[7823],\"7824\":[7825],\"7826\":[7827],\"7828\":[7829],\"7838\":[223],\"7840\":[7841],\"7842\":[7843],\"7844\":[7845],\"7846\":[7847],\"7848\":[7849],\"7850\":[7851],\"7852\":[7853],\"7854\":[7855],\"7856\":[7857],\"7858\":[7859],\"7860\":[7861],\"7862\":[7863],\"7864\":[7865],\"7866\":[7867],\"7868\":[7869],\"7870\":[7871],\"7872\":[7873],\"7874\":[7875],\"7876\":[7877],\"7878\":[7879],\"7880\":[7881],\"7882\":[7883],\"7884\":[7885],\"7886\":[7887],\"7888\":[7889],\"7890\":[7891],\"7892\":[7893],\"7894\":[7895],\"7896\":[7897],\"7898\":[7899],\"7900\":[7901],\"7902\":[7903],\"7904\":[7905],\"7906\":[7907],\"7908\":[7909],\"7910\":[7911],\"7912\":[7913],\"7914\":[7915],\"7916\":[7917],\"7918\":[7919],\"7920\":[7921],\"7922\":[7923],\"7924\":[7925],\"7926\":[7927],\"7928\":[7929],\"7930\":[7931],\"7932\":[7933],\"7934\":[7935],\"7944\":[7936],\"7945\":[7937],\"7946\":[7938],\"7947\":[7939],\"7948\":[7940],\"7949\":[7941],\"7950\":[7942],\"7951\":[7943],\"7960\":[7952],\"7961\":[7953],\"7962\":[7954],\"7963\":[7955],\"7964\":[7956],\"7965\":[7957],\"7976\":[7968],\"7977\":[7969],\"7978\":[7970],\"7979\":[7971],\"7980\":[7972],\"7981\":[7973],\"7982\":[7974],\"7983\":[7975],\"7992\":[7984],\"7993\":[7985],\"7994\":[7986],\"7995\":[7987],\"7996\":[7988],\"7997\":[7989],\"7998\":[7990],\"7999\":[7991],\"8008\":[8000],\"8009\":[8001],\"8010\":[8002],\"8011\":[8003],\"8012\":[8004],\"8013\":[8005],\"8025\":[8017],\"8027\":[8019],\"8029\":[8021],\"8031\":[8023],\"8040\":[8032],\"8041\":[8033],\"8042\":[8034],\"8043\":[8035],\"8044\":[8036],\"8045\":[8037],\"8046\":[8038],\"8047\":[8039],\"8072\":[8064],\"8073\":[8065],\"8074\":[8066],\"8075\":[8067],\"8076\":[8068],\"8077\":[8069],\"8078\":[8070],\"8079\":[8071],\"8088\":[8080],\"8089\":[8081],\"8090\":[8082],\"8091\":[8083],\"8092\":[8084],\"8093\":[8085],\"8094\":[8086],\"8095\":[8087],\"8104\":[8096],\"8105\":[8097],\"8106\":[8098],\"8107\":[8099],\"8108\":[8100],\"8109\":[8101],\"8110\":[8102],\"8111\":[8103],\"8120\":[8112],\"8121\":[8113],\"8122\":[8048],\"8123\":[8049],\"8124\":[8115],\"8136\":[8050],\"8137\":[8051],\"8138\":[8052],\"8139\":[8053],\"8140\":[8131],\"8152\":[8144],\"8153\":[8145],\"8154\":[8054],\"8155\":[8055],\"8168\":[8160],\"8169\":[8161],\"8170\":[8058],\"8171\":[8059],\"8172\":[8165],\"8184\":[8056],\"8185\":[8057],\"8186\":[8060],\"8187\":[8061],\"8188\":[8179],\"8486\":[969],\"8490\":[107],\"8491\":[229],\"8498\":[8526],\"8544\":[8560],\"8545\":[8561],\"8546\":[8562],\"8547\":[8563],\"8548\":[8564],\"8549\":[8565],\"8550\":[8566],\"8551\":[8567],\"8552\":[8568],\"8553\":[8569],\"8554\":[8570],\"8555\":[8571],\"8556\":[8572],\"8557\":[8573],\"8558\":[8574],\"8559\":[8575],\"8579\":[8580],\"9398\":[9424],\"9399\":[9425],\"9400\":[9426],\"9401\":[9427],\"9402\":[9428],\"9403\":[9429],\"9404\":[9430],\"9405\":[9431],\"9406\":[9432],\"9407\":[9433],\"9408\":[9434],\"9409\":[9435],\"9410\":[9436],\"9411\":[9437],\"9412\":[9438],\"9413\":[9439],\"9414\":[9440],\"9415\":[9441],\"9416\":[9442],\"9417\":[9443],\"9418\":[9444],\"9419\":[9445],\"9420\":[9446],\"9421\":[9447],\"9422\":[9448],\"9423\":[9449],\"11264\":[11312],\"11265\":[11313],\"11266\":[11314],\"11267\":[11315],\"11268\":[11316],\"11269\":[11317],\"11270\":[11318],\"11271\":[11319],\"11272\":[11320],\"11273\":[11321],\"11274\":[11322],\"11275\":[11323],\"11276\":[11324],\"11277\":[11325],\"11278\":[11326],\"11279\":[11327],\"11280\":[11328],\"11281\":[11329],\"11282\":[11330],\"11283\":[11331],\"11284\":[11332],\"11285\":[11333],\"11286\":[11334],\"11287\":[11335],\"11288\":[11336],\"11289\":[11337],\"11290\":[11338],\"11291\":[11339],\"11292\":[11340],\"11293\":[11341],\"11294\":[11342],\"11295\":[11343],\"11296\":[11344],\"11297\":[11345],\"11298\":[11346],\"11299\":[11347],\"11300\":[11348],\"11301\":[11349],\"11302\":[11350],\"11303\":[11351],\"11304\":[11352],\"11305\":[11353],\"11306\":[11354],\"11307\":[11355],\"11308\":[11356],\"11309\":[11357],\"11310\":[11358],\"11311\":[11359],\"11360\":[11361],\"11362\":[619],\"11363\":[7549],\"11364\":[637],\"11367\":[11368],\"11369\":[11370],\"11371\":[11372],\"11373\":[593],\"11374\":[625],\"11375\":[592],\"11376\":[594],\"11378\":[11379],\"11381\":[11382],\"11390\":[575],\"11391\":[576],\"11392\":[11393],\"11394\":[11395],\"11396\":[11397],\"11398\":[11399],\"11400\":[11401],\"11402\":[11403],\"11404\":[11405],\"11406\":[11407],\"11408\":[11409],\"11410\":[11411],\"11412\":[11413],\"11414\":[11415],\"11416\":[11417],\"11418\":[11419],\"11420\":[11421],\"11422\":[11423],\"11424\":[11425],\"11426\":[11427],\"11428\":[11429],\"11430\":[11431],\"11432\":[11433],\"11434\":[11435],\"11436\":[11437],\"11438\":[11439],\"11440\":[11441],\"11442\":[11443],\"11444\":[11445],\"11446\":[11447],\"11448\":[11449],\"11450\":[11451],\"11452\":[11453],\"11454\":[11455],\"11456\":[11457],\"11458\":[11459],\"11460\":[11461],\"11462\":[11463],\"11464\":[11465],\"11466\":[11467],\"11468\":[11469],\"11470\":[11471],\"11472\":[11473],\"11474\":[11475],\"11476\":[11477],\"11478\":[11479],\"11480\":[11481],\"11482\":[11483],\"11484\":[11485],\"11486\":[11487],\"11488\":[11489],\"11490\":[11491],\"11499\":[11500],\"11501\":[11502],\"11506\":[11507],\"42560\":[42561],\"42562\":[42563],\"42564\":[42565],\"42566\":[42567],\"42568\":[42569],\"42570\":[42571],\"42572\":[42573],\"42574\":[42575],\"42576\":[42577],\"42578\":[42579],\"42580\":[42581],\"42582\":[42583],\"42584\":[42585],\"42586\":[42587],\"42588\":[42589],\"42590\":[42591],\"42592\":[42593],\"42594\":[42595],\"42596\":[42597],\"42598\":[42599],\"42600\":[42601],\"42602\":[42603],\"42604\":[42605],\"42624\":[42625],\"42626\":[42627],\"42628\":[42629],\"42630\":[42631],\"42632\":[42633],\"42634\":[42635],\"42636\":[42637],\"42638\":[42639],\"42640\":[42641],\"42642\":[42643],\"42644\":[42645],\"42646\":[42647],\"42648\":[42649],\"42650\":[42651],\"42786\":[42787],\"42788\":[42789],\"42790\":[42791],\"42792\":[42793],\"42794\":[42795],\"42796\":[42797],\"42798\":[42799],\"42802\":[42803],\"42804\":[42805],\"42806\":[42807],\"42808\":[42809],\"42810\":[42811],\"42812\":[42813],\"42814\":[42815],\"42816\":[42817],\"42818\":[42819],\"42820\":[42821],\"42822\":[42823],\"42824\":[42825],\"42826\":[42827],\"42828\":[42829],\"42830\":[42831],\"42832\":[42833],\"42834\":[42835],\"42836\":[42837],\"42838\":[42839],\"42840\":[42841],\"42842\":[42843],\"42844\":[42845],\"42846\":[42847],\"42848\":[42849],\"42850\":[42851],\"42852\":[42853],\"42854\":[42855],\"42856\":[42857],\"42858\":[42859],\"42860\":[42861],\"42862\":[42863],\"42873\":[42874],\"42875\":[42876],\"42877\":[7545],\"42878\":[42879],\"42880\":[42881],\"42882\":[42883],\"42884\":[42885],\"42886\":[42887],\"42891\":[42892],\"42893\":[613],\"42896\":[42897],\"42898\":[42899],\"42902\":[42903],\"42904\":[42905],\"42906\":[42907],\"42908\":[42909],\"42910\":[42911],\"42912\":[42913],\"42914\":[42915],\"42916\":[42917],\"42918\":[42919],\"42920\":[42921],\"42922\":[614],\"42923\":[604],\"42924\":[609],\"42925\":[620],\"42926\":[618],\"42928\":[670],\"42929\":[647],\"42930\":[669],\"42931\":[43859],\"42932\":[42933],\"42934\":[42935],\"42936\":[42937],\"42938\":[42939],\"42940\":[42941],\"42942\":[42943],\"42944\":[42945],\"42946\":[42947],\"42948\":[42900],\"42949\":[642],\"42950\":[7566],\"42951\":[42952],\"42953\":[42954],\"42955\":[612],\"42956\":[42957],\"42958\":[42959],\"42960\":[42961],\"42962\":[42963],\"42964\":[42965],\"42966\":[42967],\"42968\":[42969],\"42970\":[42971],\"42972\":[411],\"42997\":[42998],\"65313\":[65345],\"65314\":[65346],\"65315\":[65347],\"65316\":[65348],\"65317\":[65349],\"65318\":[65350],\"65319\":[65351],\"65320\":[65352],\"65321\":[65353],\"65322\":[65354],\"65323\":[65355],\"65324\":[65356],\"65325\":[65357],\"65326\":[65358],\"65327\":[65359],\"65328\":[65360],\"65329\":[65361],\"65330\":[65362],\"65331\":[65363],\"65332\":[65364],\"65333\":[65365],\"65334\":[65366],\"65335\":[65367],\"65336\":[65368],\"65337\":[65369],\"65338\":[65370],\"66560\":[66600],\"66561\":[66601],\"66562\":[66602],\"66563\":[66603],\"66564\":[66604],\"66565\":[66605],\"66566\":[66606],\"66567\":[66607],\"66568\":[66608],\"66569\":[66609],\"66570\":[66610],\"66571\":[66611],\"66572\":[66612],\"66573\":[66613],\"66574\":[66614],\"66575\":[66615],\"66576\":[66616],\"66577\":[66617],\"66578\":[66618],\"66579\":[66619],\"66580\":[66620],\"66581\":[66621],\"66582\":[66622],\"66583\":[66623],\"66584\":[66624],\"66585\":[66625],\"66586\":[66626],\"66587\":[66627],\"66588\":[66628],\"66589\":[66629],\"66590\":[66630],\"66591\":[66631],\"66592\":[66632],\"66593\":[66633],\"66594\":[66634],\"66595\":[66635],\"66596\":[66636],\"66597\":[66637],\"66598\":[66638],\"66599\":[66639],\"66736\":[66776],\"66737\":[66777],\"66738\":[66778],\"66739\":[66779],\"66740\":[66780],\"66741\":[66781],\"66742\":[66782],\"66743\":[66783],\"66744\":[66784],\"66745\":[66785],\"66746\":[66786],\"66747\":[66787],\"66748\":[66788],\"66749\":[66789],\"66750\":[66790],\"66751\":[66791],\"66752\":[66792],\"66753\":[66793],\"66754\":[66794],\"66755\":[66795],\"66756\":[66796],\"66757\":[66797],\"66758\":[66798],\"66759\":[66799],\"66760\":[66800],\"66761\":[66801],\"66762\":[66802],\"66763\":[66803],\"66764\":[66804],\"66765\":[66805],\"66766\":[66806],\"66767\":[66807],\"66768\":[66808],\"66769\":[66809],\"66770\":[66810],\"66771\":[66811],\"66928\":[66967],\"66929\":[66968],\"66930\":[66969],\"66931\":[66970],\"66932\":[66971],\"66933\":[66972],\"66934\":[66973],\"66935\":[66974],\"66936\":[66975],\"66937\":[66976],\"66938\":[66977],\"66940\":[66979],\"66941\":[66980],\"66942\":[66981],\"66943\":[66982],\"66944\":[66983],\"66945\":[66984],\"66946\":[66985],\"66947\":[66986],\"66948\":[66987],\"66949\":[66988],\"66950\":[66989],\"66951\":[66990],\"66952\":[66991],\"66953\":[66992],\"66954\":[66993],\"66956\":[66995],\"66957\":[66996],\"66958\":[66997],\"66959\":[66998],\"66960\":[66999],\"66961\":[67000],\"66962\":[67001],\"66964\":[67003],\"66965\":[67004],\"68736\":[68800],\"68737\":[68801],\"68738\":[68802],\"68739\":[68803],\"68740\":[68804],\"68741\":[68805],\"68742\":[68806],\"68743\":[68807],\"68744\":[68808],\"68745\":[68809],\"68746\":[68810],\"68747\":[68811],\"68748\":[68812],\"68749\":[68813],\"68750\":[68814],\"68751\":[68815],\"68752\":[68816],\"68753\":[68817],\"68754\":[68818],\"68755\":[68819],\"68756\":[68820],\"68757\":[68821],\"68758\":[68822],\"68759\":[68823],\"68760\":[68824],\"68761\":[68825],\"68762\":[68826],\"68763\":[68827],\"68764\":[68828],\"68765\":[68829],\"68766\":[68830],\"68767\":[68831],\"68768\":[68832],\"68769\":[68833],\"68770\":[68834],\"68771\":[68835],\"68772\":[68836],\"68773\":[68837],\"68774\":[68838],\"68775\":[68839],\"68776\":[68840],\"68777\":[68841],\"68778\":[68842],\"68779\":[68843],\"68780\":[68844],\"68781\":[68845],\"68782\":[68846],\"68783\":[68847],\"68784\":[68848],\"68785\":[68849],\"68786\":[68850],\"68944\":[68976],\"68945\":[68977],\"68946\":[68978],\"68947\":[68979],\"68948\":[68980],\"68949\":[68981],\"68950\":[68982],\"68951\":[68983],\"68952\":[68984],\"68953\":[68985],\"68954\":[68986],\"68955\":[68987],\"68956\":[68988],\"68957\":[68989],\"68958\":[68990],\"68959\":[68991],\"68960\":[68992],\"68961\":[68993],\"68962\":[68994],\"68963\":[68995],\"68964\":[68996],\"68965\":[68997],\"71840\":[71872],\"71841\":[71873],\"71842\":[71874],\"71843\":[71875],\"71844\":[71876],\"71845\":[71877],\"71846\":[71878],\"71847\":[71879],\"71848\":[71880],\"71849\":[71881],\"71850\":[71882],\"71851\":[71883],\"71852\":[71884],\"71853\":[71885],\"71854\":[71886],\"71855\":[71887],\"71856\":[71888],\"71857\":[71889],\"71858\":[71890],\"71859\":[71891],\"71860\":[71892],\"71861\":[71893],\"71862\":[71894],\"71863\":[71895],\"71864\":[71896],\"71865\":[71897],\"71866\":[71898],\"71867\":[71899],\"71868\":[71900],\"71869\":[71901],\"71870\":[71902],\"71871\":[71903],\"93760\":[93792],\"93761\":[93793],\"93762\":[93794],\"93763\":[93795],\"93764\":[93796],\"93765\":[93797],\"93766\":[93798],\"93767\":[93799],\"93768\":[93800],\"93769\":[93801],\"93770\":[93802],\"93771\":[93803],\"93772\":[93804],\"93773\":[93805],\"93774\":[93806],\"93775\":[93807],\"93776\":[93808],\"93777\":[93809],\"93778\":[93810],\"93779\":[93811],\"93780\":[93812],\"93781\":[93813],\"93782\":[93814],\"93783\":[93815],\"93784\":[93816],\"93785\":[93817],\"93786\":[93818],\"93787\":[93819],\"93788\":[93820],\"93789\":[93821],\"93790\":[93822],\"93791\":[93823],\"93856\":[93883],\"93857\":[93884],\"93858\":[93885],\"93859\":[93886],\"93860\":[93887],\"93861\":[93888],\"93862\":[93889],\"93863\":[93890],\"93864\":[93891],\"93865\":[93892],\"93866\":[93893],\"93867\":[93894],\"93868\":[93895],\"93869\":[93896],\"93870\":[93897],\"93871\":[93898],\"93872\":[93899],\"93873\":[93900],\"93874\":[93901],\"93875\":[93902],\"93876\":[93903],\"93877\":[93904],\"93878\":[93905],\"93879\":[93906],\"93880\":[93907],\"125184\":[125218],\"125185\":[125219],\"125186\":[125220],\"125187\":[125221],\"125188\":[125222],\"125189\":[125223],\"125190\":[125224],\"125191\":[125225],\"125192\":[125226],\"125193\":[125227],\"125194\":[125228],\"125195\":[125229],\"125196\":[125230],\"125197\":[125231],\"125198\":[125232],\"125199\":[125233],\"125200\":[125234],\"125201\":[125235],\"125202\":[125236],\"125203\":[125237],\"125204\":[125238],\"125205\":[125239],\"125206\":[125240],\"125207\":[125241],\"125208\":[125242],\"125209\":[125243],\"125210\":[125244],\"125211\":[125245],\"125212\":[125246],\"125213\":[125247],\"125214\":[125248],\"125215\":[125249],\"125216\":[125250],\"125217\":[125251]},\"cased\":{\"65\":true,\"66\":true,\"67\":true,\"68\":true,\"69\":true,\"70\":true,\"71\":true,\"72\":true,\"73\":true,\"74\":true,\"75\":true,\"76\":true,\"77\":true,\"78\":true,\"79\":true,\"80\":true,\"81\":true,\"82\":true,\"83\":true,\"84\":true,\"85\":true,\"86\":true,\"87\":true,\"88\":true,\"89\":true,\"90\":true,\"97\":true,\"98\":true,\"99\":true,\"100\":true,\"101\":true,\"102\":true,\"103\":true,\"104\":true,\"105\":true,\"106\":true,\"107\":true,\"108\":true,\"109\":true,\"110\":true,\"111\":true,\"112\":true,\"113\":true,\"114\":true,\"115\":true,\"116\":true,\"117\":true,\"118\":true,\"119\":true,\"120\":true,\"121\":true,\"122\":true,\"170\":true,\"181\":true,\"186\":true,\"192\":true,\"193\":true,\"194\":true,\"195\":true,\"196\":true,\"197\":true,\"198\":true,\"199\":true,\"200\":true,\"201\":true,\"202\":true,\"203\":true,\"204\":true,\"205\":true,\"206\":true,\"207\":true,\"208\":true,\"209\":true,\"210\":true,\"211\":true,\"212\":true,\"213\":true,\"214\":true,\"216\":true,\"217\":true,\"218\":true,\"219\":true,\"220\":true,\"221\":true,\"222\":true,\"223\":true,\"224\":true,\"225\":true,\"226\":true,\"227\":true,\"228\":true,\"229\":true,\"230\":true,\"231\":true,\"232\":true,\"233\":true,\"234\":true,\"235\":true,\"236\":true,\"237\":true,\"238\":true,\"239\":true,\"240\":true,\"241\":true,\"242\":true,\"243\":true,\"244\":true,\"245\":true,\"246\":true,\"248\":true,\"249\":true,\"250\":true,\"251\":true,\"252\":true,\"253\":true,\"254\":true,\"255\":true,\"256\":true,\"257\":true,\"258\":true,\"259\":true,\"260\":true,\"261\":true,\"262\":true,\"263\":true,\"264\":true,\"265\":true,\"266\":true,\"267\":true,\"268\":true,\"269\":true,\"270\":true,\"271\":true,\"272\":true,\"273\":true,\"274\":true,\"275\":true,\"276\":true,\"277\":true,\"278\":true,\"279\":true,\"280\":true,\"281\":true,\"282\":true,\"283\":true,\"284\":true,\"285\":true,\"286\":true,\"287\":true,\"288\":true,\"289\":true,\"290\":true,\"291\":true,\"292\":true,\"293\":true,\"294\":true,\"295\":true,\"296\":true,\"297\":true,\"298\":true,\"299\":true,\"300\":true,\"301\":true,\"302\":true,\"303\":true,\"304\":true,\"305\":true,\"306\":true,\"307\":true,\"308\":true,\"309\":true,\"310\":true,\"311\":true,\"312\":true,\"313\":true,\"314\":true,\"315\":true,\"316\":true,\"317\":true,\"318\":true,\"319\":true,\"320\":true,\"321\":true,\"322\":true,\"323\":true,\"324\":true,\"325\":true,\"326\":true,\"327\":true,\"328\":true,\"329\":true,\"330\":true,\"331\":true,\"332\":true,\"333\":true,\"334\":true,\"335\":true,\"336\":true,\"337\":true,\"338\":true,\"339\":true,\"340\":true,\"341\":true,\"342\":true,\"343\":true,\"344\":true,\"345\":true,\"346\":true,\"347\":true,\"348\":true,\"349\":true,\"350\":true,\"351\":true,\"352\":true,\"353\":true,\"354\":true,\"355\":true,\"356\":true,\"357\":true,\"358\":true,\"359\":true,\"360\":true,\"361\":true,\"362\":true,\"363\":true,\"364\":true,\"365\":true,\"366\":true,\"367\":true,\"368\":true,\"369\":true,\"370\":true,\"371\":true,\"372\":true,\"373\":true,\"374\":true,\"375\":true,\"376\":true,\"377\":true,\"378\":true,\"379\":true,\"380\":true,\"381\":true,\"382\":true,\"383\":true,\"384\":true,\"385\":true,\"386\":true,\"387\":true,\"388\":true,\"389\":true,\"390\":true,\"391\":true,\"392\":true,\"393\":true,\"394\":true,\"395\":true,\"396\":true,\"397\":true,\"398\":true,\"399\":true,\"400\":true,\"401\":true,\"402\":true,\"403\":true,\"404\":true,\"405\":true,\"406\":true,\"407\":true,\"408\":true,\"409\":true,\"410\":true,\"411\":true,\"412\":true,\"413\":true,\"414\":true,\"415\":true,\"416\":true,\"417\":true,\"418\":true,\"419\":true,\"420\":true,\"421\":true,\"422\":true,\"423\":true,\"424\":true,\"425\":true,\"426\":true,\"427\":true,\"428\":true,\"429\":true,\"430\":true,\"431\":true,\"432\":true,\"433\":true,\"434\":true,\"435\":true,\"436\":true,\"437\":true,\"438\":true,\"439\":true,\"440\":true,\"441\":true,\"442\":true,\"444\":true,\"445\":true,\"446\":true,\"447\":true,\"452\":true,\"453\":true,\"454\":true,\"455\":true,\"456\":true,\"457\":true,\"458\":true,\"459\":true,\"460\":true,\"461\":true,\"462\":true,\"463\":true,\"464\":true,\"465\":true,\"466\":true,\"467\":true,\"468\":true,\"469\":true,\"470\":true,\"471\":true,\"472\":true,\"473\":true,\"474\":true,\"475\":true,\"476\":true,\"477\":true,\"478\":true,\"479\":true,\"480\":true,\"481\":true,\"482\":true,\"483\":true,\"484\":true,\"485\":true,\"486\":true,\"487\":true,\"488\":true,\"489\":true,\"490\":true,\"491\":true,\"492\":true,\"493\":true,\"494\":true,\"495\":true,\"496\":true,\"497\":true,\"498\":true,\"499\":true,\"500\":true,\"501\":true,\"502\":true,\"503\":true,\"504\":true,\"505\":true,\"506\":true,\"507\":true,\"508\":true,\"509\":true,\"510\":true,\"511\":true,\"512\":true,\"513\":true,\"514\":true,\"515\":true,\"516\":true,\"517\":true,\"518\":true,\"519\":true,\"520\":true,\"521\":true,\"522\":true,\"523\":true,\"524\":true,\"525\":true,\"526\":true,\"527\":true,\"528\":true,\"529\":true,\"530\":true,\"531\":true,\"532\":true,\"533\":true,\"534\":true,\"535\":true,\"536\":true,\"537\":true,\"538\":true,\"539\":true,\"540\":true,\"541\":true,\"542\":true,\"543\":true,\"544\":true,\"545\":true,\"546\":true,\"547\":true,\"548\":true,\"549\":true,\"550\":true,\"551\":true,\"552\":true,\"553\":true,\"554\":true,\"555\":true,\"556\":true,\"557\":true,\"558\":true,\"559\":true,\"560\":true,\"561\":true,\"562\":true,\"563\":true,\"564\":true,\"565\":true,\"566\":true,\"567\":true,\"568\":true,\"569\":true,\"570\":true,\"571\":true,\"572\":true,\"573\":true,\"574\":true,\"575\":true,\"576\":true,\"577\":true,\"578\":true,\"579\":true,\"580\":true,\"581\":true,\"582\":true,\"583\":true,\"584\":true,\"585\":true,\"586\":true,\"587\":true,\"588\":true,\"589\":true,\"590\":true,\"591\":true,\"592\":true,\"593\":true,\"594\":true,\"595\":true,\"596\":true,\"597\":true,\"598\":true,\"599\":true,\"600\":true,\"601\":true,\"602\":true,\"603\":true,\"604\":true,\"605\":true,\"606\":true,\"607\":true,\"608\":true,\"609\":true,\"610\":true,\"611\":true,\"612\":true,\"613\":true,\"614\":true,\"615\":true,\"616\":true,\"617\":true,\"618\":true,\"619\":true,\"620\":true,\"621\":true,\"622\":true,\"623\":true,\"624\":true,\"625\":true,\"626\":true,\"627\":true,\"628\":true,\"629\":true,\"630\":true,\"631\":true,\"632\":true,\"633\":true,\"634\":true,\"635\":true,\"636\":true,\"637\":true,\"638\":true,\"639\":true,\"640\":true,\"641\":true,\"642\":true,\"643\":true,\"644\":true,\"645\":true,\"646\":true,\"647\":true,\"648\":true,\"649\":true,\"650\":true,\"651\":true,\"652\":true,\"653\":true,\"654\":true,\"655\":true,\"656\":true,\"657\":true,\"658\":true,\"659\":true,\"662\":true,\"663\":true,\"664\":true,\"665\":true,\"666\":true,\"667\":true,\"668\":true,\"669\":true,\"670\":true,\"671\":true,\"672\":true,\"673\":true,\"674\":true,\"675\":true,\"676\":true,\"677\":true,\"678\":true,\"679\":true,\"680\":true,\"681\":true,\"682\":true,\"683\":true,\"684\":true,\"685\":true,\"686\":true,\"687\":true,\"688\":true,\"689\":true,\"690\":true,\"691\":true,\"692\":true,\"693\":true,\"694\":true,\"695\":true,\"696\":true,\"704\":true,\"705\":true,\"736\":true,\"737\":true,\"738\":true,\"739\":true,\"740\":true,\"837\":true,\"880\":true,\"881\":true,\"882\":true,\"883\":true,\"886\":true,\"887\":true,\"890\":true,\"891\":true,\"892\":true,\"893\":true,\"895\":true,\"902\":true,\"904\":true,\"905\":true,\"906\":true,\"908\":true,\"910\":true,\"911\":true,\"912\":true,\"913\":true,\"914\":true,\"915\":true,\"916\":true,\"917\":true,\"918\":true,\"919\":true,\"920\":true,\"921\":true,\"922\":true,\"923\":true,\"924\":true,\"925\":true,\"926\":true,\"927\":true,\"928\":true,\"929\":true,\"931\":true,\"932\":true,\"933\":true,\"934\":true,\"935\":true,\"936\":true,\"937\":true,\"938\":true,\"939\":true,\"940\":true,\"941\":true,\"942\":true,\"943\":true,\"944\":true,\"945\":true,\"946\":true,\"947\":true,\"948\":true,\"949\":true,\"950\":true,\"951\":true,\"952\":true,\"953\":true,\"954\":true,\"955\":true,\"956\":true,\"957\":true,\"958\":true,\"959\":true,\"960\":true,\"961\":true,\"962\":true,\"963\":true,\"964\":true,\"965\":true,\"966\":true,\"967\":true,\"968\":true,\"969\":true,\"970\":true,\"971\":true,\"972\":true,\"973\":true,\"974\":true,\"975\":true,\"976\":true,\"977\":true,\"978\":true,\"979\":true,\"980\":true,\"981\":true,\"982\":true,\"983\":true,\"984\":true,\"985\":true,\"986\":true,\"987\":true,\"988\":true,\"989\":true,\"990\":true,\"991\":true,\"992\":true,\"993\":true,\"994\":true,\"995\":true,\"996\":true,\"997\":true,\"998\":true,\"999\":true,\"1000\":true,\"1001\":true,\"1002\":true,\"1003\":true,\"1004\":true,\"1005\":true,\"1006\":true,\"1007\":true,\"1008\":true,\"1009\":true,\"1010\":true,\"1011\":true,\"1012\":true,\"1013\":true,\"1015\":true,\"1016\":true,\"1017\":true,\"1018\":true,\"1019\":true,\"1020\":true,\"1021\":true,\"1022\":true,\"1023\":true,\"1024\":true,\"1025\":true,\"1026\":true,\"1027\":true,\"1028\":true,\"1029\":true,\"1030\":true,\"1031\":true,\"1032\":true,\"1033\":true,\"1034\":true,\"1035\":true,\"1036\":true,\"1037\":true,\"1038\":true,\"1039\":true,\"1040\":true,\"1041\":true,\"1042\":true,\"1043\":true,\"1044\":true,\"1045\":true,\"1046\":true,\"1047\":true,\"1048\":true,\"1049\":true,\"1050\":true,\"1051\":true,\"1052\":true,\"1053\":true,\"1054\":true,\"1055\":true,\"1056\":true,\"1057\":true,\"1058\":true,\"1059\":true,\"1060\":true,\"1061\":true,\"1062\":true,\"1063\":true,\"1064\":true,\"1065\":true,\"1066\":true,\"1067\":true,\"1068\":true,\"1069\":true,\"1070\":true,\"1071\":true,\"1072\":true,\"1073\":true,\"1074\":true,\"1075\":true,\"1076\":true,\"1077\":true,\"1078\":true,\"1079\":true,\"1080\":true,\"1081\":true,\"1082\":true,\"1083\":true,\"1084\":true,\"1085\":true,\"1086\":true,\"1087\":true,\"1088\":true,\"1089\":true,\"1090\":true,\"1091\":true,\"1092\":true,\"1093\":true,\"1094\":true,\"1095\":true,\"1096\":true,\"1097\":true,\"1098\":true,\"1099\":true,\"1100\":true,\"1101\":true,\"1102\":true,\"1103\":true,\"1104\":true,\"1105\":true,\"1106\":true,\"1107\":true,\"1108\":true,\"1109\":true,\"1110\":true,\"1111\":true,\"1112\":true,\"1113\":true,\"1114\":true,\"1115\":true,\"1116\":true,\"1117\":true,\"1118\":true,\"1119\":true,\"1120\":true,\"1121\":true,\"1122\":true,\"1123\":true,\"1124\":true,\"1125\":true,\"1126\":true,\"1127\":true,\"1128\":true,\"1129\":true,\"1130\":true,\"1131\":true,\"1132\":true,\"1133\":true,\"1134\":true,\"1135\":true,\"1136\":true,\"1137\":true,\"1138\":true,\"1139\":true,\"1140\":true,\"1141\":true,\"1142\":true,\"1143\":true,\"1144\":true,\"1145\":true,\"1146\":true,\"1147\":true,\"1148\":true,\"1149\":true,\"1150\":true,\"1151\":true,\"1152\":true,\"1153\":true,\"1162\":true,\"1163\":true,\"1164\":true,\"1165\":true,\"1166\":true,\"1167\":true,\"1168\":true,\"1169\":true,\"1170\":true,\"1171\":true,\"1172\":true,\"1173\":true,\"1174\":true,\"1175\":true,\"1176\":true,\"1177\":true,\"1178\":true,\"1179\":true,\"1180\":true,\"1181\":true,\"1182\":true,\"1183\":true,\"1184\":true,\"1185\":true,\"1186\":true,\"1187\":true,\"1188\":true,\"1189\":true,\"1190\":true,\"1191\":true,\"1192\":true,\"1193\":true,\"1194\":true,\"1195\":true,\"1196\":true,\"1197\":true,\"1198\":true,\"1199\":true,\"1200\":true,\"1201\":true,\"1202\":true,\"1203\":true,\"1204\":true,\"1205\":true,\"1206\":true,\"1207\":true,\"1208\":true,\"1209\":true,\"1210\":true,\"1211\":true,\"1212\":true,\"1213\":true,\"1214\":true,\"1215\":true,\"1216\":true,\"1217\":true,\"1218\":true,\"1219\":true,\"1220\":true,\"1221\":true,\"1222\":true,\"1223\":true,\"1224\":true,\"1225\":true,\"1226\":true,\"1227\":true,\"1228\":true,\"1229\":true,\"1230\":true,\"1231\":true,\"1232\":true,\"1233\":true,\"1234\":true,\"1235\":true,\"1236\":true,\"1237\":true,\"1238\":true,\"1239\":true,\"1240\":true,\"1241\":true,\"1242\":true,\"1243\":true,\"1244\":true,\"1245\":true,\"1246\":true,\"1247\":true,\"1248\":true,\"1249\":true,\"1250\":true,\"1251\":true,\"1252\":true,\"1253\":true,\"1254\":true,\"1255\":true,\"1256\":true,\"1257\":true,\"1258\":true,\"1259\":true,\"1260\":true,\"1261\":true,\"1262\":true,\"1263\":true,\"1264\":true,\"1265\":true,\"1266\":true,\"1267\":true,\"1268\":true,\"1269\":true,\"1270\":true,\"1271\":true,\"1272\":true,\"1273\":true,\"1274\":true,\"1275\":true,\"1276\":true,\"1277\":true,\"1278\":true,\"1279\":true,\"1280\":true,\"1281\":true,\"1282\":true,\"1283\":true,\"1284\":true,\"1285\":true,\"1286\":true,\"1287\":true,\"1288\":true,\"1289\":true,\"1290\":true,\"1291\":true,\"1292\":true,\"1293\":true,\"1294\":true,\"1295\":true,\"1296\":true,\"1297\":true,\"1298\":true,\"1299\":true,\"1300\":true,\"1301\":true,\"1302\":true,\"1303\":true,\"1304\":true,\"1305\":true,\"1306\":true,\"1307\":true,\"1308\":true,\"1309\":true,\"1310\":true,\"1311\":true,\"1312\":true,\"1313\":true,\"1314\":true,\"1315\":true,\"1316\":true,\"1317\":true,\"1318\":true,\"1319\":true,\"1320\":true,\"1321\":true,\"1322\":true,\"1323\":true,\"1324\":true,\"1325\":true,\"1326\":true,\"1327\":true,\"1329\":true,\"1330\":true,\"1331\":true,\"1332\":true,\"1333\":true,\"1334\":true,\"1335\":true,\"1336\":true,\"1337\":true,\"1338\":true,\"1339\":true,\"1340\":true,\"1341\":true,\"1342\":true,\"1343\":true,\"1344\":true,\"1345\":true,\"1346\":true,\"1347\":true,\"1348\":true,\"1349\":true,\"1350\":true,\"1351\":true,\"1352\":true,\"1353\":true,\"1354\":true,\"1355\":true,\"1356\":true,\"1357\":true,\"1358\":true,\"1359\":true,\"1360\":true,\"1361\":true,\"1362\":true,\"1363\":true,\"1364\":true,\"1365\":true,\"1366\":true,\"1376\":true,\"1377\":true,\"1378\":true,\"1379\":true,\"1380\":true,\"1381\":true,\"1382\":true,\"1383\":true,\"1384\":true,\"1385\":true,\"1386\":true,\"1387\":true,\"1388\":true,\"1389\":true,\"1390\":true,\"1391\":true,\"1392\":true,\"1393\":true,\"1394\":true,\"1395\":true,\"1396\":true,\"1397\":true,\"1398\":true,\"1399\":true,\"1400\":true,\"1401\":true,\"1402\":true,\"1403\":true,\"1404\":true,\"1405\":true,\"1406\":true,\"1407\":true,\"1408\":true,\"1409\":true,\"1410\":true,\"1411\":true,\"1412\":true,\"1413\":true,\"1414\":true,\"1415\":true,\"1416\":true,\"4256\":true,\"4257\":true,\"4258\":true,\"4259\":true,\"4260\":true,\"4261\":true,\"4262\":true,\"4263\":true,\"4264\":true,\"4265\":true,\"4266\":true,\"4267\":true,\"4268\":true,\"4269\":true,\"4270\":true,\"4271\":true,\"4272\":true,\"4273\":true,\"4274\":true,\"4275\":true,\"4276\":true,\"4277\":true,\"4278\":true,\"4279\":true,\"4280\":true,\"4281\":true,\"4282\":true,\"4283\":true,\"4284\":true,\"4285\":true,\"4286\":true,\"4287\":true,\"4288\":true,\"4289\":true,\"4290\":true,\"4291\":true,\"4292\":true,\"4293\":true,\"4295\":true,\"4301\":true,\"4304\":true,\"4305\":true,\"4306\":true,\"4307\":true,\"4308\":true,\"4309\":true,\"4310\":true,\"4311\":true,\"4312\":true,\"4313\":true,\"4314\":true,\"4315\":true,\"4316\":true,\"4317\":true,\"4318\":true,\"4319\":true,\"4320\":true,\"4321\":true,\"4322\":true,\"4323\":true,\"4324\":true,\"4325\":true,\"4326\":true,\"4327\":true,\"4328\":true,\"4329\":true,\"4330\":true,\"4331\":true,\"4332\":true,\"4333\":true,\"4334\":true,\"4335\":true,\"4336\":true,\"4337\":true,\"4338\":true,\"4339\":true,\"4340\":true,\"4341\":true,\"4342\":true,\"4343\":true,\"4344\":true,\"4345\":true,\"4346\":true,\"4348\":true,\"4349\":true,\"4350\":true,\"4351\":true,\"5024\":true,\"5025\":true,\"5026\":true,\"5027\":true,\"5028\":true,\"5029\":true,\"5030\":true,\"5031\":true,\"5032\":true,\"5033\":true,\"5034\":true,\"5035\":true,\"5036\":true,\"5037\":true,\"5038\":true,\"5039\":true,\"5040\":true,\"5041\":true,\"5042\":true,\"5043\":true,\"5044\":true,\"5045\":true,\"5046\":true,\"5047\":true,\"5048\":true,\"5049\":true,\"5050\":true,\"5051\":true,\"5052\":true,\"5053\":true,\"5054\":true,\"5055\":true,\"5056\":true,\"5057\":true,\"5058\":true,\"5059\":true,\"5060\":true,\"5061\":true,\"5062\":true,\"5063\":true,\"5064\":true,\"5065\":true,\"5066\":true,\"5067\":true,\"5068\":true,\"5069\":true,\"5070\":true,\"5071\":true,\"5072\":true,\"5073\":true,\"5074\":true,\"5075\":true,\"5076\":true,\"5077\":true,\"5078\":true,\"5079\":true,\"5080\":true,\"5081\":true,\"5082\":true,\"5083\":true,\"5084\":true,\"5085\":true,\"5086\":true,\"5087\":true,\"5088\":true,\"5089\":true,\"5090\":true,\"5091\":true,\"5092\":true,\"5093\":true,\"5094\":true,\"5095\":true,\"5096\":true,\"5097\":true,\"5098\":true,\"5099\":true,\"5100\":true,\"5101\":true,\"5102\":true,\"5103\":true,\"5104\":true,\"5105\":true,\"5106\":true,\"5107\":true,\"5108\":true,\"5109\":true,\"5112\":true,\"5113\":true,\"5114\":true,\"5115\":true,\"5116\":true,\"5117\":true,\"7296\":true,\"7297\":true,\"7298\":true,\"7299\":true,\"7300\":true,\"7301\":true,\"7302\":true,\"7303\":true,\"7304\":true,\"7305\":true,\"7306\":true,\"7312\":true,\"7313\":true,\"7314\":true,\"7315\":true,\"7316\":true,\"7317\":true,\"7318\":true,\"7319\":true,\"7320\":true,\"7321\":true,\"7322\":true,\"7323\":true,\"7324\":true,\"7325\":true,\"7326\":true,\"7327\":true,\"7328\":true,\"7329\":true,\"7330\":true,\"7331\":true,\"7332\":true,\"7333\":true,\"7334\":true,\"7335\":true,\"7336\":true,\"7337\":true,\"7338\":true,\"7339\":true,\"7340\":true,\"7341\":true,\"7342\":true,\"7343\":true,\"7344\":true,\"7345\":true,\"7346\":true,\"7347\":true,\"7348\":true,\"7349\":true,\"7350\":true,\"7351\":true,\"7352\":true,\"7353\":true,\"7354\":true,\"7357\":true,\"7358\":true,\"7359\":true,\"7424\":true,\"7425\":true,\"7426\":true,\"7427\":true,\"7428\":true,\"7429\":true,\"7430\":true,\"7431\":true,\"7432\":true,\"7433\":true,\"7434\":true,\"7435\":true,\"7436\":true,\"7437\":true,\"7438\":true,\"7439\":true,\"7440\":true,\"7441\":true,\"7442\":true,\"7443\":true,\"7444\":true,\"7445\":true,\"7446\":true,\"7447\":true,\"7448\":true,\"7449\":true,\"7450\":true,\"7451\":true,\"7452\":true,\"7453\":true,\"7454\":true,\"7455\":true,\"7456\":true,\"7457\":true,\"7458\":true,\"7459\":true,\"7460\":true,\"7461\":true,\"7462\":true,\"7463\":true,\"7464\":true,\"7465\":true,\"7466\":true,\"7467\":true,\"7468\":true,\"7469\":true,\"7470\":true,\"7471\":true,\"7472\":true,\"7473\":true,\"7474\":true,\"7475\":true,\"7476\":true,\"7477\":true,\"7478\":true,\"7479\":true,\"7480\":true,\"7481\":true,\"7482\":true,\"7483\":true,\"7484\":true,\"7485\":true,\"7486\":true,\"7487\":true,\"7488\":true,\"7489\":true,\"7490\":true,\"7491\":true,\"7492\":true,\"7493\":true,\"7494\":true,\"7495\":true,\"7496\":true,\"7497\":true,\"7498\":true,\"7499\":true,\"7500\":true,\"7501\":true,\"7502\":true,\"7503\":true,\"7504\":true,\"7505\":true,\"7506\":true,\"7507\":true,\"7508\":true,\"7509\":true,\"7510\":true,\"7511\":true,\"7512\":true,\"7513\":true,\"7514\":true,\"7515\":true,\"7516\":true,\"7517\":true,\"7518\":true,\"7519\":true,\"7520\":true,\"7521\":true,\"7522\":true,\"7523\":true,\"7524\":true,\"7525\":true,\"7526\":true,\"7527\":true,\"7528\":true,\"7529\":true,\"7530\":true,\"7531\":true,\"7532\":true,\"7533\":true,\"7534\":true,\"7535\":true,\"7536\":true,\"7537\":true,\"7538\":true,\"7539\":true,\"7540\":true,\"7541\":true,\"7542\":true,\"7543\":true,\"7544\":true,\"7545\":true,\"7546\":true,\"7547\":true,\"7548\":true,\"7549\":true,\"7550\":true,\"7551\":true,\"7552\":true,\"7553\":true,\"7554\":true,\"7555\":true,\"7556\":true,\"7557\":true,\"7558\":true,\"7559\":true,\"7560\":true,\"7561\":true,\"7562\":true,\"7563\":true,\"7564\":true,\"7565\":true,\"7566\":true,\"7567\":true,\"7568\":true,\"7569\":true,\"7570\":true,\"7571\":true,\"7572\":true,\"7573\":true,\"7574\":true,\"7575\":true,\"7576\":true,\"7577\":true,\"7578\":true,\"7579\":true,\"7580\":true,\"7581\":true,\"7582\":true,\"7583\":true,\"7584\":true,\"7585\":true,\"7586\":true,\"7587\":true,\"7588\":true,\"7589\":true,\"7590\":true,\"7591\":true,\"7592\":true,\"7593\":true,\"7594\":true,\"7595\":true,\"7596\":true,\"7597\":true,\"7598\":true,\"7599\":true,\"7600\":true,\"7601\":true,\"7602\":true,\"7603\":true,\"7604\":true,\"7605\":true,\"7606\":true,\"7607\":true,\"7608\":true,\"7609\":true,\"7610\":true,\"7611\":true,\"7612\":true,\"7613\":true,\"7614\":true,\"7615\":true,\"7680\":true,\"7681\":true,\"7682\":true,\"7683\":true,\"7684\":true,\"7685\":true,\"7686\":true,\"7687\":true,\"7688\":true,\"7689\":true,\"7690\":true,\"7691\":true,\"7692\":true,\"7693\":true,\"7694\":true,\"7695\":true,\"7696\":true,\"7697\":true,\"7698\":true,\"7699\":true,\"7700\":true,\"7701\":true,\"7702\":true,\"7703\":true,\"7704\":true,\"7705\":true,\"7706\":true,\"7707\":true,\"7708\":true,\"7709\":true,\"7710\":true,\"7711\":true,\"7712\":true,\"7713\":true,\"7714\":true,\"7715\":true,\"7716\":true,\"7717\":true,\"7718\":true,\"7719\":true,\"7720\":true,\"7721\":true,\"7722\":true,\"7723\":true,\"7724\":true,\"7725\":true,\"7726\":true,\"7727\":true,\"7728\":true,\"7729\":true,\"7730\":true,\"7731\":true,\"7732\":true,\"7733\":true,\"7734\":true,\"7735\":true,\"7736\":true,\"7737\":true,\"7738\":true,\"7739\":true,\"7740\":true,\"7741\":true,\"7742\":true,\"7743\":true,\"7744\":true,\"7745\":true,\"7746\":true,\"7747\":true,\"7748\":true,\"7749\":true,\"7750\":true,\"7751\":true,\"7752\":true,\"7753\":true,\"7754\":true,\"7755\":true,\"7756\":true,\"7757\":true,\"7758\":true,\"7759\":true,\"7760\":true,\"7761\":true,\"7762\":true,\"7763\":true,\"7764\":true,\"7765\":true,\"7766\":true,\"7767\":true,\"7768\":true,\"7769\":true,\"7770\":true,\"7771\":true,\"7772\":true,\"7773\":true,\"7774\":true,\"7775\":true,\"7776\":true,\"7777\":true,\"7778\":true,\"7779\":true,\"7780\":true,\"7781\":true,\"7782\":true,\"7783\":true,\"7784\":true,\"7785\":true,\"7786\":true,\"7787\":true,\"7788\":true,\"7789\":true,\"7790\":true,\"7791\":true,\"7792\":true,\"7793\":true,\"7794\":true,\"7795\":true,\"7796\":true,\"7797\":true,\"7798\":true,\"7799\":true,\"7800\":true,\"7801\":true,\"7802\":true,\"7803\":true,\"7804\":true,\"7805\":true,\"7806\":true,\"7807\":true,\"7808\":true,\"7809\":true,\"7810\":true,\"7811\":true,\"7812\":true,\"7813\":true,\"7814\":true,\"7815\":true,\"7816\":true,\"7817\":true,\"7818\":true,\"7819\":true,\"7820\":true,\"7821\":true,\"7822\":true,\"7823\":true,\"7824\":true,\"7825\":true,\"7826\":true,\"7827\":true,\"7828\":true,\"7829\":true,\"7830\":true,\"7831\":true,\"7832\":true,\"7833\":true,\"7834\":true,\"7835\":true,\"7836\":true,\"7837\":true,\"7838\":true,\"7839\":true,\"7840\":true,\"7841\":true,\"7842\":true,\"7843\":true,\"7844\":true,\"7845\":true,\"7846\":true,\"7847\":true,\"7848\":true,\"7849\":true,\"7850\":true,\"7851\":true,\"7852\":true,\"7853\":true,\"7854\":true,\"7855\":true,\"7856\":true,\"7857\":true,\"7858\":true,\"7859\":true,\"7860\":true,\"7861\":true,\"7862\":true,\"7863\":true,\"7864\":true,\"7865\":true,\"7866\":true,\"7867\":true,\"7868\":true,\"7869\":true,\"7870\":true,\"7871\":true,\"7872\":true,\"7873\":true,\"7874\":true,\"7875\":true,\"7876\":true,\"7877\":true,\"7878\":true,\"7879\":true,\"7880\":true,\"7881\":true,\"7882\":true,\"7883\":true,\"7884\":true,\"7885\":true,\"7886\":true,\"7887\":true,\"7888\":true,\"7889\":true,\"7890\":true,\"7891\":true,\"7892\":true,\"7893\":true,\"7894\":true,\"7895\":true,\"7896\":true,\"7897\":true,\"7898\":true,\"7899\":true,\"7900\":true,\"7901\":true,\"7902\":true,\"7903\":true,\"7904\":true,\"7905\":true,\"7906\":true,\"7907\":true,\"7908\":true,\"7909\":true,\"7910\":true,\"7911\":true,\"7912\":true,\"7913\":true,\"7914\":true,\"7915\":true,\"7916\":true,\"7917\":true,\"7918\":true,\"7919\":true,\"7920\":true,\"7921\":true,\"7922\":true,\"7923\":true,\"7924\":true,\"7925\":true,\"7926\":true,\"7927\":true,\"7928\":true,\"7929\":true,\"7930\":true,\"7931\":true,\"7932\":true,\"7933\":true,\"7934\":true,\"7935\":true,\"7936\":true,\"7937\":true,\"7938\":true,\"7939\":true,\"7940\":true,\"7941\":true,\"7942\":true,\"7943\":true,\"7944\":true,\"7945\":true,\"7946\":true,\"7947\":true,\"7948\":true,\"7949\":true,\"7950\":true,\"7951\":true,\"7952\":true,\"7953\":true,\"7954\":true,\"7955\":true,\"7956\":true,\"7957\":true,\"7960\":true,\"7961\":true,\"7962\":true,\"7963\":true,\"7964\":true,\"7965\":true,\"7968\":true,\"7969\":true,\"7970\":true,\"7971\":true,\"7972\":true,\"7973\":true,\"7974\":true,\"7975\":true,\"7976\":true,\"7977\":true,\"7978\":true,\"7979\":true,\"7980\":true,\"7981\":true,\"7982\":true,\"7983\":true,\"7984\":true,\"7985\":true,\"7986\":true,\"7987\":true,\"7988\":true,\"7989\":true,\"7990\":true,\"7991\":true,\"7992\":true,\"7993\":true,\"7994\":true,\"7995\":true,\"7996\":true,\"7997\":true,\"7998\":true,\"7999\":true,\"8000\":true,\"8001\":true,\"8002\":true,\"8003\":true,\"8004\":true,\"8005\":true,\"8008\":true,\"8009\":true,\"8010\":true,\"8011\":true,\"8012\":true,\"8013\":true,\"8016\":true,\"8017\":true,\"8018\":true,\"8019\":true,\"8020\":true,\"8021\":true,\"8022\":true,\"8023\":true,\"8025\":true,\"8027\":true,\"8029\":true,\"8031\":true,\"8032\":true,\"8033\":true,\"8034\":true,\"8035\":true,\"8036\":true,\"8037\":true,\"8038\":true,\"8039\":true,\"8040\":true,\"8041\":true,\"8042\":true,\"8043\":true,\"8044\":true,\"8045\":true,\"8046\":true,\"8047\":true,\"8048\":true,\"8049\":true,\"8050\":true,\"8051\":true,\"8052\":true,\"8053\":true,\"8054\":true,\"8055\":true,\"8056\":true,\"8057\":true,\"8058\":true,\"8059\":true,\"8060\":true,\"8061\":true,\"8064\":true,\"8065\":true,\"8066\":true,\"8067\":true,\"8068\":true,\"8069\":true,\"8070\":true,\"8071\":true,\"8072\":true,\"8073\":true,\"8074\":true,\"8075\":true,\"8076\":true,\"8077\":true,\"8078\":true,\"8079\":true,\"8080\":true,\"8081\":true,\"8082\":true,\"8083\":true,\"8084\":true,\"8085\":true,\"8086\":true,\"8087\":true,\"8088\":true,\"8089\":true,\"8090\":true,\"8091\":true,\"8092\":true,\"8093\":true,\"8094\":true,\"8095\":true,\"8096\":true,\"8097\":true,\"8098\":true,\"8099\":true,\"8100\":true,\"8101\":true,\"8102\":true,\"8103\":true,\"8104\":true,\"8105\":true,\"8106\":true,\"8107\":true,\"8108\":true,\"8109\":true,\"8110\":true,\"8111\":true,\"8112\":true,\"8113\":true,\"8114\":true,\"8115\":true,\"8116\":true,\"8118\":true,\"8119\":true,\"8120\":true,\"8121\":true,\"8122\":true,\"8123\":true,\"8124\":true,\"8126\":true,\"8130\":true,\"8131\":true,\"8132\":true,\"8134\":true,\"8135\":true,\"8136\":true,\"8137\":true,\"8138\":true,\"8139\":true,\"8140\":true,\"8144\":true,\"8145\":true,\"8146\":true,\"8147\":true,\"8150\":true,\"8151\":true,\"8152\":true,\"8153\":true,\"8154\":true,\"8155\":true,\"8160\":true,\"8161\":true,\"8162\":true,\"8163\":true,\"8164\":true,\"8165\":true,\"8166\":true,\"8167\":true,\"8168\":true,\"8169\":true,\"8170\":true,\"8171\":true,\"8172\":true,\"8178\":true,\"8179\":true,\"8180\":true,\"8182\":true,\"8183\":true,\"8184\":true,\"8185\":true,\"8186\":true,\"8187\":true,\"8188\":true,\"8305\":true,\"8319\":true,\"8336\":true,\"8337\":true,\"8338\":true,\"8339\":true,\"8340\":true,\"8341\":true,\"8342\":true,\"8343\":true,\"8344\":true,\"8345\":true,\"8346\":true,\"8347\":true,\"8348\":true,\"8450\":true,\"8455\":true,\"8458\":true,\"8459\":true,\"8460\":true,\"8461\":true,\"8462\":true,\"8463\":true,\"8464\":true,\"8465\":true,\"8466\":true,\"8467\":true,\"8469\":true,\"8473\":true,\"8474\":true,\"8475\":true,\"8476\":true,\"8477\":true,\"8484\":true,\"8486\":true,\"8488\":true,\"8490\":true,\"8491\":true,\"8492\":true,\"8493\":true,\"8495\":true,\"8496\":true,\"8497\":true,\"8498\":true,\"8499\":true,\"8500\":true,\"8505\":true,\"8508\":true,\"8509\":true,\"8510\":true,\"8511\":true,\"8517\":true,\"8518\":true,\"8519\":true,\"8520\":true,\"8521\":true,\"8526\":true,\"8544\":true,\"8545\":true,\"8546\":true,\"8547\":true,\"8548\":true,\"8549\":true,\"8550\":true,\"8551\":true,\"8552\":true,\"8553\":true,\"8554\":true,\"8555\":true,\"8556\":true,\"8557\":true,\"8558\":true,\"8559\":true,\"8560\":true,\"8561\":true,\"8562\":true,\"8563\":true,\"8564\":true,\"8565\":true,\"8566\":true,\"8567\":true,\"8568\":true,\"8569\":true,\"8570\":true,\"8571\":true,\"8572\":true,\"8573\":true,\"8574\":true,\"8575\":true,\"8579\":true,\"8580\":true,\"9398\":true,\"9399\":true,\"9400\":true,\"9401\":true,\"9402\":true,\"9403\":true,\"9404\":true,\"9405\":true,\"9406\":true,\"9407\":true,\"9408\":true,\"9409\":true,\"9410\":true,\"9411\":true,\"9412\":true,\"9413\":true,\"9414\":true,\"9415\":true,\"9416\":true,\"9417\":true,\"9418\":true,\"9419\":true,\"9420\":true,\"9421\":true,\"9422\":true,\"9423\":true,\"9424\":true,\"9425\":true,\"9426\":true,\"9427\":true,\"9428\":true,\"9429\":true,\"9430\":true,\"9431\":true,\"9432\":true,\"9433\":true,\"9434\":true,\"9435\":true,\"9436\":true,\"9437\":true,\"9438\":true,\"9439\":true,\"9440\":true,\"9441\":true,\"9442\":true,\"9443\":true,\"9444\":true,\"9445\":true,\"9446\":true,\"9447\":true,\"9448\":true,\"9449\":true,\"11264\":true,\"11265\":true,\"11266\":true,\"11267\":true,\"11268\":true,\"11269\":true,\"11270\":true,\"11271\":true,\"11272\":true,\"11273\":true,\"11274\":true,\"11275\":true,\"11276\":true,\"11277\":true,\"11278\":true,\"11279\":true,\"11280\":true,\"11281\":true,\"11282\":true,\"11283\":true,\"11284\":true,\"11285\":true,\"11286\":true,\"11287\":true,\"11288\":true,\"11289\":true,\"11290\":true,\"11291\":true,\"11292\":true,\"11293\":true,\"11294\":true,\"11295\":true,\"11296\":true,\"11297\":true,\"11298\":true,\"11299\":true,\"11300\":true,\"11301\":true,\"11302\":true,\"11303\":true,\"11304\":true,\"11305\":true,\"11306\":true,\"11307\":true,\"11308\":true,\"11309\":true,\"11310\":true,\"11311\":true,\"11312\":true,\"11313\":true,\"11314\":true,\"11315\":true,\"11316\":true,\"11317\":true,\"11318\":true,\"11319\":true,\"11320\":true,\"11321\":true,\"11322\":true,\"11323\":true,\"11324\":true,\"11325\":true,\"11326\":true,\"11327\":true,\"11328\":true,\"11329\":true,\"11330\":true,\"11331\":true,\"11332\":true,\"11333\":true,\"11334\":true,\"11335\":true,\"11336\":true,\"11337\":true,\"11338\":true,\"11339\":true,\"11340\":true,\"11341\":true,\"11342\":true,\"11343\":true,\"11344\":true,\"11345\":true,\"11346\":true,\"11347\":true,\"11348\":true,\"11349\":true,\"11350\":true,\"11351\":true,\"11352\":true,\"11353\":true,\"11354\":true,\"11355\":true,\"11356\":true,\"11357\":true,\"11358\":true,\"11359\":true,\"11360\":true,\"11361\":true,\"11362\":true,\"11363\":true,\"11364\":true,\"11365\":true,\"11366\":true,\"11367\":true,\"11368\":true,\"11369\":true,\"11370\":true,\"11371\":true,\"11372\":true,\"11373\":true,\"11374\":true,\"11375\":true,\"11376\":true,\"11377\":true,\"11378\":true,\"11379\":true,\"11380\":true,\"11381\":true,\"11382\":true,\"11383\":true,\"11384\":true,\"11385\":true,\"11386\":true,\"11387\":true,\"11388\":true,\"11389\":true,\"11390\":true,\"11391\":true,\"11392\":true,\"11393\":true,\"11394\":true,\"11395\":true,\"11396\":true,\"11397\":true,\"11398\":true,\"11399\":true,\"11400\":true,\"11401\":true,\"11402\":true,\"11403\":true,\"11404\":true,\"11405\":true,\"11406\":true,\"11407\":true,\"11408\":true,\"11409\":true,\"11410\":true,\"11411\":true,\"11412\":true,\"11413\":true,\"11414\":true,\"11415\":true,\"11416\":true,\"11417\":true,\"11418\":true,\"11419\":true,\"11420\":true,\"11421\":true,\"11422\":true,\"11423\":true,\"11424\":true,\"11425\":true,\"11426\":true,\"11427\":true,\"11428\":true,\"11429\":true,\"11430\":true,\"11431\":true,\"11432\":true,\"11433\":true,\"11434\":true,\"11435\":true,\"11436\":true,\"11437\":true,\"11438\":true,\"11439\":true,\"11440\":true,\"11441\":true,\"11442\":true,\"11443\":true,\"11444\":true,\"11445\":true,\"11446\":true,\"11447\":true,\"11448\":true,\"11449\":true,\"11450\":true,\"11451\":true,\"11452\":true,\"11453\":true,\"11454\":true,\"11455\":true,\"11456\":true,\"11457\":true,\"11458\":true,\"11459\":true,\"11460\":true,\"11461\":true,\"11462\":true,\"11463\":true,\"11464\":true,\"11465\":true,\"11466\":true,\"11467\":true,\"11468\":true,\"11469\":true,\"11470\":true,\"11471\":true,\"11472\":true,\"11473\":true,\"11474\":true,\"11475\":true,\"11476\":true,\"11477\":true,\"11478\":true,\"11479\":true,\"11480\":true,\"11481\":true,\"11482\":true,\"11483\":true,\"11484\":true,\"11485\":true,\"11486\":true,\"11487\":true,\"11488\":true,\"11489\":true,\"11490\":true,\"11491\":true,\"11492\":true,\"11499\":true,\"11500\":true,\"11501\":true,\"11502\":true,\"11506\":true,\"11507\":true,\"11520\":true,\"11521\":true,\"11522\":true,\"11523\":true,\"11524\":true,\"11525\":true,\"11526\":true,\"11527\":true,\"11528\":true,\"11529\":true,\"11530\":true,\"11531\":true,\"11532\":true,\"11533\":true,\"11534\":true,\"11535\":true,\"11536\":true,\"11537\":true,\"11538\":true,\"11539\":true,\"11540\":true,\"11541\":true,\"11542\":true,\"11543\":true,\"11544\":true,\"11545\":true,\"11546\":true,\"11547\":true,\"11548\":true,\"11549\":true,\"11550\":true,\"11551\":true,\"11552\":true,\"11553\":true,\"11554\":true,\"11555\":true,\"11556\":true,\"11557\":true,\"11559\":true,\"11565\":true,\"42560\":true,\"42561\":true,\"42562\":true,\"42563\":true,\"42564\":true,\"42565\":true,\"42566\":true,\"42567\":true,\"42568\":true,\"42569\":true,\"42570\":true,\"42571\":true,\"42572\":true,\"42573\":true,\"42574\":true,\"42575\":true,\"42576\":true,\"42577\":true,\"42578\":true,\"42579\":true,\"42580\":true,\"42581\":true,\"42582\":true,\"42583\":true,\"42584\":true,\"42585\":true,\"42586\":true,\"42587\":true,\"42588\":true,\"42589\":true,\"42590\":true,\"42591\":true,\"42592\":true,\"42593\":true,\"42594\":true,\"42595\":true,\"42596\":true,\"42597\":true,\"42598\":true,\"42599\":true,\"42600\":true,\"42601\":true,\"42602\":true,\"42603\":true,\"42604\":true,\"42605\":true,\"42624\":true,\"42625\":true,\"42626\":true,\"42627\":true,\"42628\":true,\"42629\":true,\"42630\":true,\"42631\":true,\"42632\":true,\"42633\":true,\"42634\":true,\"42635\":true,\"42636\":true,\"42637\":true,\"42638\":true,\"42639\":true,\"42640\":true,\"42641\":true,\"42642\":true,\"42643\":true,\"42644\":true,\"42645\":true,\"42646\":true,\"42647\":true,\"42648\":true,\"42649\":true,\"42650\":true,\"42651\":true,\"42652\":true,\"42653\":true,\"42786\":true,\"42787\":true,\"42788\":true,\"42789\":true,\"42790\":true,\"42791\":true,\"42792\":true,\"42793\":true,\"42794\":true,\"42795\":true,\"42796\":true,\"42797\":true,\"42798\":true,\"42799\":true,\"42800\":true,\"42801\":true,\"42802\":true,\"42803\":true,\"42804\":true,\"42805\":true,\"42806\":true,\"42807\":true,\"42808\":true,\"42809\":true,\"42810\":true,\"42811\":true,\"42812\":true,\"42813\":true,\"42814\":true,\"42815\":true,\"42816\":true,\"42817\":true,\"42818\":true,\"42819\":true,\"42820\":true,\"42821\":true,\"42822\":true,\"42823\":true,\"42824\":true,\"42825\":true,\"42826\":true,\"42827\":true,\"42828\":true,\"42829\":true,\"42830\":true,\"42831\":true,\"42832\":true,\"42833\":true,\"42834\":true,\"42835\":true,\"42836\":true,\"42837\":true,\"42838\":true,\"42839\":true,\"42840\":true,\"42841\":true,\"42842\":true,\"42843\":true,\"42844\":true,\"42845\":true,\"42846\":true,\"42847\":true,\"42848\":true,\"42849\":true,\"42850\":true,\"42851\":true,\"42852\":true,\"42853\":true,\"42854\":true,\"42855\":true,\"42856\":true,\"42857\":true,\"42858\":true,\"42859\":true,\"42860\":true,\"42861\":true,\"42862\":true,\"42863\":true,\"42864\":true,\"42865\":true,\"42866\":true,\"42867\":true,\"42868\":true,\"42869\":true,\"42870\":true,\"42871\":true,\"42872\":true,\"42873\":true,\"42874\":true,\"42875\":true,\"42876\":true,\"42877\":true,\"42878\":true,\"42879\":true,\"42880\":true,\"42881\":true,\"42882\":true,\"42883\":true,\"42884\":true,\"42885\":true,\"42886\":true,\"42887\":true,\"42891\":true,\"42892\":true,\"42893\":true,\"42894\":true,\"42896\":true,\"42897\":true,\"42898\":true,\"42899\":true,\"42900\":true,\"42901\":true,\"42902\":true,\"42903\":true,\"42904\":true,\"42905\":true,\"42906\":true,\"42907\":true,\"42908\":true,\"42909\":true,\"42910\":true,\"42911\":true,\"42912\":true,\"42913\":true,\"42914\":true,\"42915\":true,\"42916\":true,\"42917\":true,\"42918\":true,\"42919\":true,\"42920\":true,\"42921\":true,\"42922\":true,\"42923\":true,\"42924\":true,\"42925\":true,\"42926\":true,\"42927\":true,\"42928\":true,\"42929\":true,\"42930\":true,\"42931\":true,\"42932\":true,\"42933\":true,\"42934\":true,\"42935\":true,\"42936\":true,\"42937\":true,\"42938\":true,\"42939\":true,\"42940\":true,\"42941\":true,\"42942\":true,\"42943\":true,\"42944\":true,\"42945\":true,\"42946\":true,\"42947\":true,\"42948\":true,\"42949\":true,\"42950\":true,\"42951\":true,\"42952\":true,\"42953\":true,\"42954\":true,\"42955\":true,\"42956\":true,\"42957\":true,\"42958\":true,\"42959\":true,\"42960\":true,\"42961\":true,\"42962\":true,\"42963\":true,\"42964\":true,\"42965\":true,\"42966\":true,\"42967\":true,\"42968\":true,\"42969\":true,\"42970\":true,\"42971\":true,\"42972\":true,\"42993\":true,\"42994\":true,\"42995\":true,\"42996\":true,\"42997\":true,\"42998\":true,\"43000\":true,\"43001\":true,\"43002\":true,\"43824\":true,\"43825\":true,\"43826\":true,\"43827\":true,\"43828\":true,\"43829\":true,\"43830\":true,\"43831\":true,\"43832\":true,\"43833\":true,\"43834\":true,\"43835\":true,\"43836\":true,\"43837\":true,\"43838\":true,\"43839\":true,\"43840\":true,\"43841\":true,\"43842\":true,\"43843\":true,\"43844\":true,\"43845\":true,\"43846\":true,\"43847\":true,\"43848\":true,\"43849\":true,\"43850\":true,\"43851\":true,\"43852\":true,\"43853\":true,\"43854\":true,\"43855\":true,\"43856\":true,\"43857\":true,\"43858\":true,\"43859\":true,\"43860\":true,\"43861\":true,\"43862\":true,\"43863\":true,\"43864\":true,\"43865\":true,\"43866\":true,\"43868\":true,\"43869\":true,\"43870\":true,\"43871\":true,\"43872\":true,\"43873\":true,\"43874\":true,\"43875\":true,\"43876\":true,\"43877\":true,\"43878\":true,\"43879\":true,\"43880\":true,\"43881\":true,\"43888\":true,\"43889\":true,\"43890\":true,\"43891\":true,\"43892\":true,\"43893\":true,\"43894\":true,\"43895\":true,\"43896\":true,\"43897\":true,\"43898\":true,\"43899\":true,\"43900\":true,\"43901\":true,\"43902\":true,\"43903\":true,\"43904\":true,\"43905\":true,\"43906\":true,\"43907\":true,\"43908\":true,\"43909\":true,\"43910\":true,\"43911\":true,\"43912\":true,\"43913\":true,\"43914\":true,\"43915\":true,\"43916\":true,\"43917\":true,\"43918\":true,\"43919\":true,\"43920\":true,\"43921\":true,\"43922\":true,\"43923\":true,\"43924\":true,\"43925\":true,\"43926\":true,\"43927\":true,\"43928\":true,\"43929\":true,\"43930\":true,\"43931\":true,\"43932\":true,\"43933\":true,\"43934\":true,\"43935\":true,\"43936\":true,\"43937\":true,\"43938\":true,\"43939\":true,\"43940\":true,\"43941\":true,\"43942\":true,\"43943\":true,\"43944\":true,\"43945\":true,\"43946\":true,\"43947\":true,\"43948\":true,\"43949\":true,\"43950\":true,\"43951\":true,\"43952\":true,\"43953\":true,\"43954\":true,\"43955\":true,\"43956\":true,\"43957\":true,\"43958\":true,\"43959\":true,\"43960\":true,\"43961\":true,\"43962\":true,\"43963\":true,\"43964\":true,\"43965\":true,\"43966\":true,\"43967\":true,\"64256\":true,\"64257\":true,\"64258\":true,\"64259\":true,\"64260\":true,\"64261\":true,\"64262\":true,\"64275\":true,\"64276\":true,\"64277\":true,\"64278\":true,\"64279\":true,\"65313\":true,\"65314\":true,\"65315\":true,\"65316\":true,\"65317\":true,\"65318\":true,\"65319\":true,\"65320\":true,\"65321\":true,\"65322\":true,\"65323\":true,\"65324\":true,\"65325\":true,\"65326\":true,\"65327\":true,\"65328\":true,\"65329\":true,\"65330\":true,\"65331\":true,\"65332\":true,\"65333\":true,\"65334\":true,\"65335\":true,\"65336\":true,\"65337\":true,\"65338\":true,\"65345\":true,\"65346\":true,\"65347\":true,\"65348\":true,\"65349\":true,\"65350\":true,\"65351\":true,\"65352\":true,\"65353\":true,\"65354\":true,\"65355\":true,\"65356\":true,\"65357\":true,\"65358\":true,\"65359\":true,\"65360\":true,\"65361\":true,\"65362\":true,\"65363\":true,\"65364\":true,\"65365\":true,\"65366\":true,\"65367\":true,\"65368\":true,\"65369\":true,\"65370\":true,\"66560\":true,\"66561\":true,\"66562\":true,\"66563\":true,\"66564\":true,\"66565\":true,\"66566\":true,\"66567\":true,\"66568\":true,\"66569\":true,\"66570\":true,\"66571\":true,\"66572\":true,\"66573\":true,\"66574\":true,\"66575\":true,\"66576\":true,\"66577\":true,\"66578\":true,\"66579\":true,\"66580\":true,\"66581\":true,\"66582\":true,\"66583\":true,\"66584\":true,\"66585\":true,\"66586\":true,\"66587\":true,\"66588\":true,\"66589\":true,\"66590\":true,\"66591\":true,\"66592\":true,\"66593\":true,\"66594\":true,\"66595\":true,\"66596\":true,\"66597\":true,\"66598\":true,\"66599\":true,\"66600\":true,\"66601\":true,\"66602\":true,\"66603\":true,\"66604\":true,\"66605\":true,\"66606\":true,\"66607\":true,\"66608\":true,\"66609\":true,\"66610\":true,\"66611\":true,\"66612\":true,\"66613\":true,\"66614\":true,\"66615\":true,\"66616\":true,\"66617\":true,\"66618\":true,\"66619\":true,\"66620\":true,\"66621\":true,\"66622\":true,\"66623\":true,\"66624\":true,\"66625\":true,\"66626\":true,\"66627\":true,\"66628\":true,\"66629\":true,\"66630\":true,\"66631\":true,\"66632\":true,\"66633\":true,\"66634\":true,\"66635\":true,\"66636\":true,\"66637\":true,\"66638\":true,\"66639\":true,\"66736\":true,\"66737\":true,\"66738\":true,\"66739\":true,\"66740\":true,\"66741\":true,\"66742\":true,\"66743\":true,\"66744\":true,\"66745\":true,\"66746\":true,\"66747\":true,\"66748\":true,\"66749\":true,\"66750\":true,\"66751\":true,\"66752\":true,\"66753\":true,\"66754\":true,\"66755\":true,\"66756\":true,\"66757\":true,\"66758\":true,\"66759\":true,\"66760\":true,\"66761\":true,\"66762\":true,\"66763\":true,\"66764\":true,\"66765\":true,\"66766\":true,\"66767\":true,\"66768\":true,\"66769\":true,\"66770\":true,\"66771\":true,\"66776\":true,\"66777\":true,\"66778\":true,\"66779\":true,\"66780\":true,\"66781\":true,\"66782\":true,\"66783\":true,\"66784\":true,\"66785\":true,\"66786\":true,\"66787\":true,\"66788\":true,\"66789\":true,\"66790\":true,\"66791\":true,\"66792\":true,\"66793\":true,\"66794\":true,\"66795\":true,\"66796\":true,\"66797\":true,\"66798\":true,\"66799\":true,\"66800\":true,\"66801\":true,\"66802\":true,\"66803\":true,\"66804\":true,\"66805\":true,\"66806\":true,\"66807\":true,\"66808\":true,\"66809\":true,\"66810\":true,\"66811\":true,\"66928\":true,\"66929\":true,\"66930\":true,\"66931\":true,\"66932\":true,\"66933\":true,\"66934\":true,\"66935\":true,\"66936\":true,\"66937\":true,\"66938\":true,\"66940\":true,\"66941\":true,\"66942\":true,\"66943\":true,\"66944\":true,\"66945\":true,\"66946\":true,\"66947\":true,\"66948\":true,\"66949\":true,\"66950\":true,\"66951\":true,\"66952\":true,\"66953\":true,\"66954\":true,\"66956\":true,\"66957\":true,\"66958\":true,\"66959\":true,\"66960\":true,\"66961\":true,\"66962\":true,\"66964\":true,\"66965\":true,\"66967\":true,\"66968\":true,\"66969\":true,\"66970\":true,\"66971\":true,\"66972\":true,\"66973\":true,\"66974\":true,\"66975\":true,\"66976\":true,\"66977\":true,\"66979\":true,\"66980\":true,\"66981\":true,\"66982\":true,\"66983\":true,\"66984\":true,\"66985\":true,\"66986\":true,\"66987\":true,\"66988\":true,\"66989\":true,\"66990\":true,\"66991\":true,\"66992\":true,\"66993\":true,\"66995\":true,\"66996\":true,\"66997\":true,\"66998\":true,\"66999\":true,\"67000\":true,\"67001\":true,\"67003\":true,\"67004\":true,\"67456\":true,\"67459\":true,\"67460\":true,\"67461\":true,\"67463\":true,\"67464\":true,\"67465\":true,\"67466\":true,\"67467\":true,\"67468\":true,\"67469\":true,\"67470\":true,\"67471\":true,\"67472\":true,\"67473\":true,\"67474\":true,\"67475\":true,\"67476\":true,\"67477\":true,\"67478\":true,\"67479\":true,\"67480\":true,\"67481\":true,\"67482\":true,\"67483\":true,\"67484\":true,\"67485\":true,\"67486\":true,\"67487\":true,\"67488\":true,\"67489\":true,\"67490\":true,\"67491\":true,\"67492\":true,\"67493\":true,\"67494\":true,\"67495\":true,\"67496\":true,\"67497\":true,\"67498\":true,\"67499\":true,\"67500\":true,\"67501\":true,\"67502\":true,\"67503\":true,\"67504\":true,\"67506\":true,\"67507\":true,\"67508\":true,\"67509\":true,\"67510\":true,\"67511\":true,\"67512\":true,\"67513\":true,\"67514\":true,\"68736\":true,\"68737\":true,\"68738\":true,\"68739\":true,\"68740\":true,\"68741\":true,\"68742\":true,\"68743\":true,\"68744\":true,\"68745\":true,\"68746\":true,\"68747\":true,\"68748\":true,\"68749\":true,\"68750\":true,\"68751\":true,\"68752\":true,\"68753\":true,\"68754\":true,\"68755\":true,\"68756\":true,\"68757\":true,\"68758\":true,\"68759\":true,\"68760\":true,\"68761\":true,\"68762\":true,\"68763\":true,\"68764\":true,\"68765\":true,\"68766\":true,\"68767\":true,\"68768\":true,\"68769\":true,\"68770\":true,\"68771\":true,\"68772\":true,\"68773\":true,\"68774\":true,\"68775\":true,\"68776\":true,\"68777\":true,\"68778\":true,\"68779\":true,\"68780\":true,\"68781\":true,\"68782\":true,\"68783\":true,\"68784\":true,\"68785\":true,\"68786\":true,\"68800\":true,\"68801\":true,\"68802\":true,\"68803\":true,\"68804\":true,\"68805\":true,\"68806\":true,\"68807\":true,\"68808\":true,\"68809\":true,\"68810\":true,\"68811\":true,\"68812\":true,\"68813\":true,\"68814\":true,\"68815\":true,\"68816\":true,\"68817\":true,\"68818\":true,\"68819\":true,\"68820\":true,\"68821\":true,\"68822\":true,\"68823\":true,\"68824\":true,\"68825\":true,\"68826\":true,\"68827\":true,\"68828\":true,\"68829\":true,\"68830\":true,\"68831\":true,\"68832\":true,\"68833\":true,\"68834\":true,\"68835\":true,\"68836\":true,\"68837\":true,\"68838\":true,\"68839\":true,\"68840\":true,\"68841\":true,\"68842\":true,\"68843\":true,\"68844\":true,\"68845\":true,\"68846\":true,\"68847\":true,\"68848\":true,\"68849\":true,\"68850\":true,\"68944\":true,\"68945\":true,\"68946\":true,\"68947\":true,\"68948\":true,\"68949\":true,\"68950\":true,\"68951\":true,\"68952\":true,\"68953\":true,\"68954\":true,\"68955\":true,\"68956\":true,\"68957\":true,\"68958\":true,\"68959\":true,\"68960\":true,\"68961\":true,\"68962\":true,\"68963\":true,\"68964\":true,\"68965\":true,\"68976\":true,\"68977\":true,\"68978\":true,\"68979\":true,\"68980\":true,\"68981\":true,\"68982\":true,\"68983\":true,\"68984\":true,\"68985\":true,\"68986\":true,\"68987\":true,\"68988\":true,\"68989\":true,\"68990\":true,\"68991\":true,\"68992\":true,\"68993\":true,\"68994\":true,\"68995\":true,\"68996\":true,\"68997\":true,\"71840\":true,\"71841\":true,\"71842\":true,\"71843\":true,\"71844\":true,\"71845\":true,\"71846\":true,\"71847\":true,\"71848\":true,\"71849\":true,\"71850\":true,\"71851\":true,\"71852\":true,\"71853\":true,\"71854\":true,\"71855\":true,\"71856\":true,\"71857\":true,\"71858\":true,\"71859\":true,\"71860\":true,\"71861\":true,\"71862\":true,\"71863\":true,\"71864\":true,\"71865\":true,\"71866\":true,\"71867\":true,\"71868\":true,\"71869\":true,\"71870\":true,\"71871\":true,\"71872\":true,\"71873\":true,\"71874\":true,\"71875\":true,\"71876\":true,\"71877\":true,\"71878\":true,\"71879\":true,\"71880\":true,\"71881\":true,\"71882\":true,\"71883\":true,\"71884\":true,\"71885\":true,\"71886\":true,\"71887\":true,\"71888\":true,\"71889\":true,\"71890\":true,\"71891\":true,\"71892\":true,\"71893\":true,\"71894\":true,\"71895\":true,\"71896\":true,\"71897\":true,\"71898\":true,\"71899\":true,\"71900\":true,\"71901\":true,\"71902\":true,\"71903\":true,\"93760\":true,\"93761\":true,\"93762\":true,\"93763\":true,\"93764\":true,\"93765\":true,\"93766\":true,\"93767\":true,\"93768\":true,\"93769\":true,\"93770\":true,\"93771\":true,\"93772\":true,\"93773\":true,\"93774\":true,\"93775\":true,\"93776\":true,\"93777\":true,\"93778\":true,\"93779\":true,\"93780\":true,\"93781\":true,\"93782\":true,\"93783\":true,\"93784\":true,\"93785\":true,\"93786\":true,\"93787\":true,\"93788\":true,\"93789\":true,\"93790\":true,\"93791\":true,\"93792\":true,\"93793\":true,\"93794\":true,\"93795\":true,\"93796\":true,\"93797\":true,\"93798\":true,\"93799\":true,\"93800\":true,\"93801\":true,\"93802\":true,\"93803\":true,\"93804\":true,\"93805\":true,\"93806\":true,\"93807\":true,\"93808\":true,\"93809\":true,\"93810\":true,\"93811\":true,\"93812\":true,\"93813\":true,\"93814\":true,\"93815\":true,\"93816\":true,\"93817\":true,\"93818\":true,\"93819\":true,\"93820\":true,\"93821\":true,\"93822\":true,\"93823\":true,\"93856\":true,\"93857\":true,\"93858\":true,\"93859\":true,\"93860\":true,\"93861\":true,\"93862\":true,\"93863\":true,\"93864\":true,\"93865\":true,\"93866\":true,\"93867\":true,\"93868\":true,\"93869\":true,\"93870\":true,\"93871\":true,\"93872\":true,\"93873\":true,\"93874\":true,\"93875\":true,\"93876\":true,\"93877\":true,\"93878\":true,\"93879\":true,\"93880\":true,\"93883\":true,\"93884\":true,\"93885\":true,\"93886\":true,\"93887\":true,\"93888\":true,\"93889\":true,\"93890\":true,\"93891\":true,\"93892\":true,\"93893\":true,\"93894\":true,\"93895\":true,\"93896\":true,\"93897\":true,\"93898\":true,\"93899\":true,\"93900\":true,\"93901\":true,\"93902\":true,\"93903\":true,\"93904\":true,\"93905\":true,\"93906\":true,\"93907\":true,\"119808\":true,\"119809\":true,\"119810\":true,\"119811\":true,\"119812\":true,\"119813\":true,\"119814\":true,\"119815\":true,\"119816\":true,\"119817\":true,\"119818\":true,\"119819\":true,\"119820\":true,\"119821\":true,\"119822\":true,\"119823\":true,\"119824\":true,\"119825\":true,\"119826\":true,\"119827\":true,\"119828\":true,\"119829\":true,\"119830\":true,\"119831\":true,\"119832\":true,\"119833\":true,\"119834\":true,\"119835\":true,\"119836\":true,\"119837\":true,\"119838\":true,\"119839\":true,\"119840\":true,\"119841\":true,\"119842\":true,\"119843\":true,\"119844\":true,\"119845\":true,\"119846\":true,\"119847\":true,\"119848\":true,\"119849\":true,\"119850\":true,\"119851\":true,\"119852\":true,\"119853\":true,\"119854\":true,\"119855\":true,\"119856\":true,\"119857\":true,\"119858\":true,\"119859\":true,\"119860\":true,\"119861\":true,\"119862\":true,\"119863\":true,\"119864\":true,\"119865\":true,\"119866\":true,\"119867\":true,\"119868\":true,\"119869\":true,\"119870\":true,\"119871\":true,\"119872\":true,\"119873\":true,\"119874\":true,\"119875\":true,\"119876\":true,\"119877\":true,\"119878\":true,\"119879\":true,\"119880\":true,\"119881\":true,\"119882\":true,\"119883\":true,\"119884\":true,\"119885\":true,\"119886\":true,\"119887\":true,\"119888\":true,\"119889\":true,\"119890\":true,\"119891\":true,\"119892\":true,\"119894\":true,\"119895\":true,\"119896\":true,\"119897\":true,\"119898\":true,\"119899\":true,\"119900\":true,\"119901\":true,\"119902\":true,\"119903\":true,\"119904\":true,\"119905\":true,\"119906\":true,\"119907\":true,\"119908\":true,\"119909\":true,\"119910\":true,\"119911\":true,\"119912\":true,\"119913\":true,\"119914\":true,\"119915\":true,\"119916\":true,\"119917\":true,\"119918\":true,\"119919\":true,\"119920\":true,\"119921\":true,\"119922\":true,\"119923\":true,\"119924\":true,\"119925\":true,\"119926\":true,\"119927\":true,\"119928\":true,\"119929\":true,\"119930\":true,\"119931\":true,\"119932\":true,\"119933\":true,\"119934\":true,\"119935\":true,\"119936\":true,\"119937\":true,\"119938\":true,\"119939\":true,\"119940\":true,\"119941\":true,\"119942\":true,\"119943\":true,\"119944\":true,\"119945\":true,\"119946\":true,\"119947\":true,\"119948\":true,\"119949\":true,\"119950\":true,\"119951\":true,\"119952\":true,\"119953\":true,\"119954\":true,\"119955\":true,\"119956\":true,\"119957\":true,\"119958\":true,\"119959\":true,\"119960\":true,\"119961\":true,\"119962\":true,\"119963\":true,\"119964\":true,\"119966\":true,\"119967\":true,\"119970\":true,\"119973\":true,\"119974\":true,\"119977\":true,\"119978\":true,\"119979\":true,\"119980\":true,\"119982\":true,\"119983\":true,\"119984\":true,\"119985\":true,\"119986\":true,\"119987\":true,\"119988\":true,\"119989\":true,\"119990\":true,\"119991\":true,\"119992\":true,\"119993\":true,\"119995\":true,\"119997\":true,\"119998\":true,\"119999\":true,\"120000\":true,\"120001\":true,\"120002\":true,\"120003\":true,\"120005\":true,\"120006\":true,\"120007\":true,\"120008\":true,\"120009\":true,\"120010\":true,\"120011\":true,\"120012\":true,\"120013\":true,\"120014\":true,\"120015\":true,\"120016\":true,\"120017\":true,\"120018\":true,\"120019\":true,\"120020\":true,\"120021\":true,\"120022\":true,\"120023\":true,\"120024\":true,\"120025\":true,\"120026\":true,\"120027\":true,\"120028\":true,\"120029\":true,\"120030\":true,\"120031\":true,\"120032\":true,\"120033\":true,\"120034\":true,\"120035\":true,\"120036\":true,\"120037\":true,\"120038\":true,\"120039\":true,\"120040\":true,\"120041\":true,\"120042\":true,\"120043\":true,\"120044\":true,\"120045\":true,\"120046\":true,\"120047\":true,\"120048\":true,\"120049\":true,\"120050\":true,\"120051\":true,\"120052\":true,\"120053\":true,\"120054\":true,\"120055\":true,\"120056\":true,\"120057\":true,\"120058\":true,\"120059\":true,\"120060\":true,\"120061\":true,\"120062\":true,\"120063\":true,\"120064\":true,\"120065\":true,\"120066\":true,\"120067\":true,\"120068\":true,\"120069\":true,\"120071\":true,\"120072\":true,\"120073\":true,\"120074\":true,\"120077\":true,\"120078\":true,\"120079\":true,\"120080\":true,\"120081\":true,\"120082\":true,\"120083\":true,\"120084\":true,\"120086\":true,\"120087\":true,\"120088\":true,\"120089\":true,\"120090\":true,\"120091\":true,\"120092\":true,\"120094\":true,\"120095\":true,\"120096\":true,\"120097\":true,\"120098\":true,\"120099\":true,\"120100\":true,\"120101\":true,\"120102\":true,\"120103\":true,\"120104\":true,\"120105\":true,\"120106\":true,\"120107\":true,\"120108\":true,\"120109\":true,\"120110\":true,\"120111\":true,\"120112\":true,\"120113\":true,\"120114\":true,\"120115\":true,\"120116\":true,\"120117\":true,\"120118\":true,\"120119\":true,\"120120\":true,\"120121\":true,\"120123\":true,\"120124\":true,\"120125\":true,\"120126\":true,\"120128\":true,\"120129\":true,\"120130\":true,\"120131\":true,\"120132\":true,\"120134\":true,\"120138\":true,\"120139\":true,\"120140\":true,\"120141\":true,\"120142\":true,\"120143\":true,\"120144\":true,\"120146\":true,\"120147\":true,\"120148\":true,\"120149\":true,\"120150\":true,\"120151\":true,\"120152\":true,\"120153\":true,\"120154\":true,\"120155\":true,\"120156\":true,\"120157\":true,\"120158\":true,\"120159\":true,\"120160\":true,\"120161\":true,\"120162\":true,\"120163\":true,\"120164\":true,\"120165\":true,\"120166\":true,\"120167\":true,\"120168\":true,\"120169\":true,\"120170\":true,\"120171\":true,\"120172\":true,\"120173\":true,\"120174\":true,\"120175\":true,\"120176\":true,\"120177\":true,\"120178\":true,\"120179\":true,\"120180\":true,\"120181\":true,\"120182\":true,\"120183\":true,\"120184\":true,\"120185\":true,\"120186\":true,\"120187\":true,\"120188\":true,\"120189\":true,\"120190\":true,\"120191\":true,\"120192\":true,\"120193\":true,\"120194\":true,\"120195\":true,\"120196\":true,\"120197\":true,\"120198\":true,\"120199\":true,\"120200\":true,\"120201\":true,\"120202\":true,\"120203\":true,\"120204\":true,\"120205\":true,\"120206\":true,\"120207\":true,\"120208\":true,\"120209\":true,\"120210\":true,\"120211\":true,\"120212\":true,\"120213\":true,\"120214\":true,\"120215\":true,\"120216\":true,\"120217\":true,\"120218\":true,\"120219\":true,\"120220\":true,\"120221\":true,\"120222\":true,\"120223\":true,\"120224\":true,\"120225\":true,\"120226\":true,\"120227\":true,\"120228\":true,\"120229\":true,\"120230\":true,\"120231\":true,\"120232\":true,\"120233\":true,\"120234\":true,\"120235\":true,\"120236\":true,\"120237\":true,\"120238\":true,\"120239\":true,\"120240\":true,\"120241\":true,\"120242\":true,\"120243\":true,\"120244\":true,\"120245\":true,\"120246\":true,\"120247\":true,\"120248\":true,\"120249\":true,\"120250\":true,\"120251\":true,\"120252\":true,\"120253\":true,\"120254\":true,\"120255\":true,\"120256\":true,\"120257\":true,\"120258\":true,\"120259\":true,\"120260\":true,\"120261\":true,\"120262\":true,\"120263\":true,\"120264\":true,\"120265\":true,\"120266\":true,\"120267\":true,\"120268\":true,\"120269\":true,\"120270\":true,\"120271\":true,\"120272\":true,\"120273\":true,\"120274\":true,\"120275\":true,\"120276\":true,\"120277\":true,\"120278\":true,\"120279\":true,\"120280\":true,\"120281\":true,\"120282\":true,\"120283\":true,\"120284\":true,\"120285\":true,\"120286\":true,\"120287\":true,\"120288\":true,\"120289\":true,\"120290\":true,\"120291\":true,\"120292\":true,\"120293\":true,\"120294\":true,\"120295\":true,\"120296\":true,\"120297\":true,\"120298\":true,\"120299\":true,\"120300\":true,\"120301\":true,\"120302\":true,\"120303\":true,\"120304\":true,\"120305\":true,\"120306\":true,\"120307\":true,\"120308\":true,\"120309\":true,\"120310\":true,\"120311\":true,\"120312\":true,\"120313\":true,\"120314\":true,\"120315\":true,\"120316\":true,\"120317\":true,\"120318\":true,\"120319\":true,\"120320\":true,\"120321\":true,\"120322\":true,\"120323\":true,\"120324\":true,\"120325\":true,\"120326\":true,\"120327\":true,\"120328\":true,\"120329\":true,\"120330\":true,\"120331\":true,\"120332\":true,\"120333\":true,\"120334\":true,\"120335\":true,\"120336\":true,\"120337\":true,\"120338\":true,\"120339\":true,\"120340\":true,\"120341\":true,\"120342\":true,\"120343\":true,\"120344\":true,\"120345\":true,\"120346\":true,\"120347\":true,\"120348\":true,\"120349\":true,\"120350\":true,\"120351\":true,\"120352\":true,\"120353\":true,\"120354\":true,\"120355\":true,\"120356\":true,\"120357\":true,\"120358\":true,\"120359\":true,\"120360\":true,\"120361\":true,\"120362\":true,\"120363\":true,\"120364\":true,\"120365\":true,\"120366\":true,\"120367\":true,\"120368\":true,\"120369\":true,\"120370\":true,\"120371\":true,\"120372\":true,\"120373\":true,\"120374\":true,\"120375\":true,\"120376\":true,\"120377\":true,\"120378\":true,\"120379\":true,\"120380\":true,\"120381\":true,\"120382\":true,\"120383\":true,\"120384\":true,\"120385\":true,\"120386\":true,\"120387\":true,\"120388\":true,\"120389\":true,\"120390\":true,\"120391\":true,\"120392\":true,\"120393\":true,\"120394\":true,\"120395\":true,\"120396\":true,\"120397\":true,\"120398\":true,\"120399\":true,\"120400\":true,\"120401\":true,\"120402\":true,\"120403\":true,\"120404\":true,\"120405\":true,\"120406\":true,\"120407\":true,\"120408\":true,\"120409\":true,\"120410\":true,\"120411\":true,\"120412\":true,\"120413\":true,\"120414\":true,\"120415\":true,\"120416\":true,\"120417\":true,\"120418\":true,\"120419\":true,\"120420\":true,\"120421\":true,\"120422\":true,\"120423\":true,\"120424\":true,\"120425\":true,\"120426\":true,\"120427\":true,\"120428\":true,\"120429\":true,\"120430\":true,\"120431\":true,\"120432\":true,\"120433\":true,\"120434\":true,\"120435\":true,\"120436\":true,\"120437\":true,\"120438\":true,\"120439\":true,\"120440\":true,\"120441\":true,\"120442\":true,\"120443\":true,\"120444\":true,\"120445\":true,\"120446\":true,\"120447\":true,\"120448\":true,\"120449\":true,\"120450\":true,\"120451\":true,\"120452\":true,\"120453\":true,\"120454\":true,\"120455\":true,\"120456\":true,\"120457\":true,\"120458\":true,\"120459\":true,\"120460\":true,\"120461\":true,\"120462\":true,\"120463\":true,\"120464\":true,\"120465\":true,\"120466\":true,\"120467\":true,\"120468\":true,\"120469\":true,\"120470\":true,\"120471\":true,\"120472\":true,\"120473\":true,\"120474\":true,\"120475\":true,\"120476\":true,\"120477\":true,\"120478\":true,\"120479\":true,\"120480\":true,\"120481\":true,\"120482\":true,\"120483\":true,\"120484\":true,\"120485\":true,\"120488\":true,\"120489\":true,\"120490\":true,\"120491\":true,\"120492\":true,\"120493\":true,\"120494\":true,\"120495\":true,\"120496\":true,\"120497\":true,\"120498\":true,\"120499\":true,\"120500\":true,\"120501\":true,\"120502\":true,\"120503\":true,\"120504\":true,\"120505\":true,\"120506\":true,\"120507\":true,\"120508\":true,\"120509\":true,\"120510\":true,\"120511\":true,\"120512\":true,\"120514\":true,\"120515\":true,\"120516\":true,\"120517\":true,\"120518\":true,\"120519\":true,\"120520\":true,\"120521\":true,\"120522\":true,\"120523\":true,\"120524\":true,\"120525\":true,\"120526\":true,\"120527\":true,\"120528\":true,\"120529\":true,\"120530\":true,\"120531\":true,\"120532\":true,\"120533\":true,\"120534\":true,\"120535\":true,\"120536\":true,\"120537\":true,\"120538\":true,\"120540\":true,\"120541\":true,\"120542\":true,\"120543\":true,\"120544\":true,\"120545\":true,\"120546\":true,\"120547\":true,\"120548\":true,\"120549\":true,\"120550\":true,\"120551\":true,\"120552\":true,\"120553\":true,\"120554\":true,\"120555\":true,\"120556\":true,\"120557\":true,\"120558\":true,\"120559\":true,\"120560\":true,\"120561\":true,\"120562\":true,\"120563\":true,\"120564\":true,\"120565\":true,\"120566\":true,\"120567\":true,\"120568\":true,\"120569\":true,\"120570\":true,\"120572\":true,\"120573\":true,\"120574\":true,\"120575\":true,\"120576\":true,\"120577\":true,\"120578\":true,\"120579\":true,\"120580\":true,\"120581\":true,\"120582\":true,\"120583\":true,\"120584\":true,\"120585\":true,\"120586\":true,\"120587\":true,\"120588\":true,\"120589\":true,\"120590\":true,\"120591\":true,\"120592\":true,\"120593\":true,\"120594\":true,\"120595\":true,\"120596\":true,\"120598\":true,\"120599\":true,\"120600\":true,\"120601\":true,\"120602\":true,\"120603\":true,\"120604\":true,\"120605\":true,\"120606\":true,\"120607\":true,\"120608\":true,\"120609\":true,\"120610\":true,\"120611\":true,\"120612\":true,\"120613\":true,\"120614\":true,\"120615\":true,\"120616\":true,\"120617\":true,\"120618\":true,\"120619\":true,\"120620\":true,\"120621\":true,\"120622\":true,\"120623\":true,\"120624\":true,\"120625\":true,\"120626\":true,\"120627\":true,\"120628\":true,\"120630\":true,\"120631\":true,\"120632\":true,\"120633\":true,\"120634\":true,\"120635\":true,\"120636\":true,\"120637\":true,\"120638\":true,\"120639\":true,\"120640\":true,\"120641\":true,\"120642\":true,\"120643\":true,\"120644\":true,\"120645\":true,\"120646\":true,\"120647\":true,\"120648\":true,\"120649\":true,\"120650\":true,\"120651\":true,\"120652\":true,\"120653\":true,\"120654\":true,\"120656\":true,\"120657\":true,\"120658\":true,\"120659\":true,\"120660\":true,\"120661\":true,\"120662\":true,\"120663\":true,\"120664\":true,\"120665\":true,\"120666\":true,\"120667\":true,\"120668\":true,\"120669\":true,\"120670\":true,\"120671\":true,\"120672\":true,\"120673\":true,\"120674\":true,\"120675\":true,\"120676\":true,\"120677\":true,\"120678\":true,\"120679\":true,\"120680\":true,\"120681\":true,\"120682\":true,\"120683\":true,\"120684\":true,\"120685\":true,\"120686\":true,\"120688\":true,\"120689\":true,\"120690\":true,\"120691\":true,\"120692\":true,\"120693\":true,\"120694\":true,\"120695\":true,\"120696\":true,\"120697\":true,\"120698\":true,\"120699\":true,\"120700\":true,\"120701\":true,\"120702\":true,\"120703\":true,\"120704\":true,\"120705\":true,\"120706\":true,\"120707\":true,\"120708\":true,\"120709\":true,\"120710\":true,\"120711\":true,\"120712\":true,\"120714\":true,\"120715\":true,\"120716\":true,\"120717\":true,\"120718\":true,\"120719\":true,\"120720\":true,\"120721\":true,\"120722\":true,\"120723\":true,\"120724\":true,\"120725\":true,\"120726\":true,\"120727\":true,\"120728\":true,\"120729\":true,\"120730\":true,\"120731\":true,\"120732\":true,\"120733\":true,\"120734\":true,\"120735\":true,\"120736\":true,\"120737\":true,\"120738\":true,\"120739\":true,\"120740\":true,\"120741\":true,\"120742\":true,\"120743\":true,\"120744\":true,\"120746\":true,\"120747\":true,\"120748\":true,\"120749\":true,\"120750\":true,\"120751\":true,\"120752\":true,\"120753\":true,\"120754\":true,\"120755\":true,\"120756\":true,\"120757\":true,\"120758\":true,\"120759\":true,\"120760\":true,\"120761\":true,\"120762\":true,\"120763\":true,\"120764\":true,\"120765\":true,\"120766\":true,\"120767\":true,\"120768\":true,\"120769\":true,\"120770\":true,\"120772\":true,\"120773\":true,\"120774\":true,\"120775\":true,\"120776\":true,\"120777\":true,\"120778\":true,\"120779\":true,\"122624\":true,\"122625\":true,\"122626\":true,\"122627\":true,\"122628\":true,\"122629\":true,\"122630\":true,\"122631\":true,\"122632\":true,\"122633\":true,\"122635\":true,\"122636\":true,\"122637\":true,\"122638\":true,\"122639\":true,\"122640\":true,\"122641\":true,\"122642\":true,\"122643\":true,\"122644\":true,\"122645\":true,\"122646\":true,\"122647\":true,\"122648\":true,\"122649\":true,\"122650\":true,\"122651\":true,\"122652\":true,\"122653\":true,\"122654\":true,\"122661\":true,\"122662\":true,\"122663\":true,\"122664\":true,\"122665\":true,\"122666\":true,\"122928\":true,\"122929\":true,\"122930\":true,\"122931\":true,\"122932\":true,\"122933\":true,\"122934\":true,\"122935\":true,\"122936\":true,\"122937\":true,\"122938\":true,\"122939\":true,\"122940\":true,\"122941\":true,\"122942\":true,\"122943\":true,\"122944\":true,\"122945\":true,\"122946\":true,\"122947\":true,\"122948\":true,\"122949\":true,\"122950\":true,\"122951\":true,\"122952\":true,\"122953\":true,\"122954\":true,\"122955\":true,\"122956\":true,\"122957\":true,\"122958\":true,\"122959\":true,\"122960\":true,\"122961\":true,\"122962\":true,\"122963\":true,\"122964\":true,\"122965\":true,\"122966\":true,\"122967\":true,\"122968\":true,\"122969\":true,\"122970\":true,\"122971\":true,\"122972\":true,\"122973\":true,\"122974\":true,\"122975\":true,\"122976\":true,\"122977\":true,\"122978\":true,\"122979\":true,\"122980\":true,\"122981\":true,\"122982\":true,\"122983\":true,\"122984\":true,\"122985\":true,\"122986\":true,\"122987\":true,\"122988\":true,\"122989\":true,\"125184\":true,\"125185\":true,\"125186\":true,\"125187\":true,\"125188\":true,\"125189\":true,\"125190\":true,\"125191\":true,\"125192\":true,\"125193\":true,\"125194\":true,\"125195\":true,\"125196\":true,\"125197\":true,\"125198\":true,\"125199\":true,\"125200\":true,\"125201\":true,\"125202\":true,\"125203\":true,\"125204\":true,\"125205\":true,\"125206\":true,\"125207\":true,\"125208\":true,\"125209\":true,\"125210\":true,\"125211\":true,\"125212\":true,\"125213\":true,\"125214\":true,\"125215\":true,\"125216\":true,\"125217\":true,\"125218\":true,\"125219\":true,\"125220\":true,\"125221\":true,\"125222\":true,\"125223\":true,\"125224\":true,\"125225\":true,\"125226\":true,\"125227\":true,\"125228\":true,\"125229\":true,\"125230\":true,\"125231\":true,\"125232\":true,\"125233\":true,\"125234\":true,\"125235\":true,\"125236\":true,\"125237\":true,\"125238\":true,\"125239\":true,\"125240\":true,\"125241\":true,\"125242\":true,\"125243\":true,\"125244\":true,\"125245\":true,\"125246\":true,\"125247\":true,\"125248\":true,\"125249\":true,\"125250\":true,\"125251\":true,\"127280\":true,\"127281\":true,\"127282\":true,\"127283\":true,\"127284\":true,\"127285\":true,\"127286\":true,\"127287\":true,\"127288\":true,\"127289\":true,\"127290\":true,\"127291\":true,\"127292\":true,\"127293\":true,\"127294\":true,\"127295\":true,\"127296\":true,\"127297\":true,\"127298\":true,\"127299\":true,\"127300\":true,\"127301\":true,\"127302\":true,\"127303\":true,\"127304\":true,\"127305\":true,\"127312\":true,\"127313\":true,\"127314\":true,\"127315\":true,\"127316\":true,\"127317\":true,\"127318\":true,\"127319\":true,\"127320\":true,\"127321\":true,\"127322\":true,\"127323\":true,\"127324\":true,\"127325\":true,\"127326\":true,\"127327\":true,\"127328\":true,\"127329\":true,\"127330\":true,\"127331\":true,\"127332\":true,\"127333\":true,\"127334\":true,\"127335\":true,\"127336\":true,\"127337\":true,\"127344\":true,\"127345\":true,\"127346\":true,\"127347\":true,\"127348\":true,\"127349\":true,\"127350\":true,\"127351\":true,\"127352\":true,\"127353\":true,\"127354\":true,\"127355\":true,\"127356\":true,\"127357\":true,\"127358\":true,\"127359\":true,\"127360\":true,\"127361\":true,\"127362\":true,\"127363\":true,\"127364\":true,\"127365\":true,\"127366\":true,\"127367\":true,\"127368\":true,\"127369\":true},\"case_ignorable\":{\"39\":true,\"46\":true,\"58\":true,\"94\":true,\"96\":true,\"168\":true,\"173\":true,\"175\":true,\"180\":true,\"183\":true,\"184\":true,\"688\":true,\"689\":true,\"690\":true,\"691\":true,\"692\":true,\"693\":true,\"694\":true,\"695\":true,\"696\":true,\"697\":true,\"698\":true,\"699\":true,\"700\":true,\"701\":true,\"702\":true,\"703\":true,\"704\":true,\"705\":true,\"706\":true,\"707\":true,\"708\":true,\"709\":true,\"710\":true,\"711\":true,\"712\":true,\"713\":true,\"714\":true,\"715\":true,\"716\":true,\"717\":true,\"718\":true,\"719\":true,\"720\":true,\"721\":true,\"722\":true,\"723\":true,\"724\":true,\"725\":true,\"726\":true,\"727\":true,\"728\":true,\"729\":true,\"730\":true,\"731\":true,\"732\":true,\"733\":true,\"734\":true,\"735\":true,\"736\":true,\"737\":true,\"738\":true,\"739\":true,\"740\":true,\"741\":true,\"742\":true,\"743\":true,\"744\":true,\"745\":true,\"746\":true,\"747\":true,\"748\":true,\"749\":true,\"750\":true,\"751\":true,\"752\":true,\"753\":true,\"754\":true,\"755\":true,\"756\":true,\"757\":true,\"758\":true,\"759\":true,\"760\":true,\"761\":true,\"762\":true,\"763\":true,\"764\":true,\"765\":true,\"766\":true,\"767\":true,\"768\":true,\"769\":true,\"770\":true,\"771\":true,\"772\":true,\"773\":true,\"774\":true,\"775\":true,\"776\":true,\"777\":true,\"778\":true,\"779\":true,\"780\":true,\"781\":true,\"782\":true,\"783\":true,\"784\":true,\"785\":true,\"786\":true,\"787\":true,\"788\":true,\"789\":true,\"790\":true,\"791\":true,\"792\":true,\"793\":true,\"794\":true,\"795\":true,\"796\":true,\"797\":true,\"798\":true,\"799\":true,\"800\":true,\"801\":true,\"802\":true,\"803\":true,\"804\":true,\"805\":true,\"806\":true,\"807\":true,\"808\":true,\"809\":true,\"810\":true,\"811\":true,\"812\":true,\"813\":true,\"814\":true,\"815\":true,\"816\":true,\"817\":true,\"818\":true,\"819\":true,\"820\":true,\"821\":true,\"822\":true,\"823\":true,\"824\":true,\"825\":true,\"826\":true,\"827\":true,\"828\":true,\"829\":true,\"830\":true,\"831\":true,\"832\":true,\"833\":true,\"834\":true,\"835\":true,\"836\":true,\"837\":true,\"838\":true,\"839\":true,\"840\":true,\"841\":true,\"842\":true,\"843\":true,\"844\":true,\"845\":true,\"846\":true,\"847\":true,\"848\":true,\"849\":true,\"850\":true,\"851\":true,\"852\":true,\"853\":true,\"854\":true,\"855\":true,\"856\":true,\"857\":true,\"858\":true,\"859\":true,\"860\":true,\"861\":true,\"862\":true,\"863\":true,\"864\":true,\"865\":true,\"866\":true,\"867\":true,\"868\":true,\"869\":true,\"870\":true,\"871\":true,\"872\":true,\"873\":true,\"874\":true,\"875\":true,\"876\":true,\"877\":true,\"878\":true,\"879\":true,\"884\":true,\"885\":true,\"890\":true,\"900\":true,\"901\":true,\"903\":true,\"1155\":true,\"1156\":true,\"1157\":true,\"1158\":true,\"1159\":true,\"1160\":true,\"1161\":true,\"1369\":true,\"1375\":true,\"1425\":true,\"1426\":true,\"1427\":true,\"1428\":true,\"1429\":true,\"1430\":true,\"1431\":true,\"1432\":true,\"1433\":true,\"1434\":true,\"1435\":true,\"1436\":true,\"1437\":true,\"1438\":true,\"1439\":true,\"1440\":true,\"1441\":true,\"1442\":true,\"1443\":true,\"1444\":true,\"1445\":true,\"1446\":true,\"1447\":true,\"1448\":true,\"1449\":true,\"1450\":true,\"1451\":true,\"1452\":true,\"1453\":true,\"1454\":true,\"1455\":true,\"1456\":true,\"1457\":true,\"1458\":true,\"1459\":true,\"1460\":true,\"1461\":true,\"1462\":true,\"1463\":true,\"1464\":true,\"1465\":true,\"1466\":true,\"1467\":true,\"1468\":true,\"1469\":true,\"1471\":true,\"1473\":true,\"1474\":true,\"1476\":true,\"1477\":true,\"1479\":true,\"1524\":true,\"1536\":true,\"1537\":true,\"1538\":true,\"1539\":true,\"1540\":true,\"1541\":true,\"1552\":true,\"1553\":true,\"1554\":true,\"1555\":true,\"1556\":true,\"1557\":true,\"1558\":true,\"1559\":true,\"1560\":true,\"1561\":true,\"1562\":true,\"1564\":true,\"1600\":true,\"1611\":true,\"1612\":true,\"1613\":true,\"1614\":true,\"1615\":true,\"1616\":true,\"1617\":true,\"1618\":true,\"1619\":true,\"1620\":true,\"1621\":true,\"1622\":true,\"1623\":true,\"1624\":true,\"1625\":true,\"1626\":true,\"1627\":true,\"1628\":true,\"1629\":true,\"1630\":true,\"1631\":true,\"1648\":true,\"1750\":true,\"1751\":true,\"1752\":true,\"1753\":true,\"1754\":true,\"1755\":true,\"1756\":true,\"1757\":true,\"1759\":true,\"1760\":true,\"1761\":true,\"1762\":true,\"1763\":true,\"1764\":true,\"1765\":true,\"1766\":true,\"1767\":true,\"1768\":true,\"1770\":true,\"1771\":true,\"1772\":true,\"1773\":true,\"1807\":true,\"1809\":true,\"1840\":true,\"1841\":true,\"1842\":true,\"1843\":true,\"1844\":true,\"1845\":true,\"1846\":true,\"1847\":true,\"1848\":true,\"1849\":true,\"1850\":true,\"1851\":true,\"1852\":true,\"1853\":true,\"1854\":true,\"1855\":true,\"1856\":true,\"1857\":true,\"1858\":true,\"1859\":true,\"1860\":true,\"1861\":true,\"1862\":true,\"1863\":true,\"1864\":true,\"1865\":true,\"1866\":true,\"1958\":true,\"1959\":true,\"1960\":true,\"1961\":true,\"1962\":true,\"1963\":true,\"1964\":true,\"1965\":true,\"1966\":true,\"1967\":true,\"1968\":true,\"2027\":true,\"2028\":true,\"2029\":true,\"2030\":true,\"2031\":true,\"2032\":true,\"2033\":true,\"2034\":true,\"2035\":true,\"2036\":true,\"2037\":true,\"2042\":true,\"2045\":true,\"2070\":true,\"2071\":true,\"2072\":true,\"2073\":true,\"2074\":true,\"2075\":true,\"2076\":true,\"2077\":true,\"2078\":true,\"2079\":true,\"2080\":true,\"2081\":true,\"2082\":true,\"2083\":true,\"2084\":true,\"2085\":true,\"2086\":true,\"2087\":true,\"2088\":true,\"2089\":true,\"2090\":true,\"2091\":true,\"2092\":true,\"2093\":true,\"2137\":true,\"2138\":true,\"2139\":true,\"2184\":true,\"2192\":true,\"2193\":true,\"2199\":true,\"2200\":true,\"2201\":true,\"2202\":true,\"2203\":true,\"2204\":true,\"2205\":true,\"2206\":true,\"2207\":true,\"2249\":true,\"2250\":true,\"2251\":true,\"2252\":true,\"2253\":true,\"2254\":true,\"2255\":true,\"2256\":true,\"2257\":true,\"2258\":true,\"2259\":true,\"2260\":true,\"2261\":true,\"2262\":true,\"2263\":true,\"2264\":true,\"2265\":true,\"2266\":true,\"2267\":true,\"2268\":true,\"2269\":true,\"2270\":true,\"2271\":true,\"2272\":true,\"2273\":true,\"2274\":true,\"2275\":true,\"2276\":true,\"2277\":true,\"2278\":true,\"2279\":true,\"2280\":true,\"2281\":true,\"2282\":true,\"2283\":true,\"2284\":true,\"2285\":true,\"2286\":true,\"2287\":true,\"2288\":true,\"2289\":true,\"2290\":true,\"2291\":true,\"2292\":true,\"2293\":true,\"2294\":true,\"2295\":true,\"2296\":true,\"2297\":true,\"2298\":true,\"2299\":true,\"2300\":true,\"2301\":true,\"2302\":true,\"2303\":true,\"2304\":true,\"2305\":true,\"2306\":true,\"2362\":true,\"2364\":true,\"2369\":true,\"2370\":true,\"2371\":true,\"2372\":true,\"2373\":true,\"2374\":true,\"2375\":true,\"2376\":true,\"2381\":true,\"2385\":true,\"2386\":true,\"2387\":true,\"2388\":true,\"2389\":true,\"2390\":true,\"2391\":true,\"2402\":true,\"2403\":true,\"2417\":true,\"2433\":true,\"2492\":true,\"2497\":true,\"2498\":true,\"2499\":true,\"2500\":true,\"2509\":true,\"2530\":true,\"2531\":true,\"2558\":true,\"2561\":true,\"2562\":true,\"2620\":true,\"2625\":true,\"2626\":true,\"2631\":true,\"2632\":true,\"2635\":true,\"2636\":true,\"2637\":true,\"2641\":true,\"2672\":true,\"2673\":true,\"2677\":true,\"2689\":true,\"2690\":true,\"2748\":true,\"2753\":true,\"2754\":true,\"2755\":true,\"2756\":true,\"2757\":true,\"2759\":true,\"2760\":true,\"2765\":true,\"2786\":true,\"2787\":true,\"2810\":true,\"2811\":true,\"2812\":true,\"2813\":true,\"2814\":true,\"2815\":true,\"2817\":true,\"2876\":true,\"2879\":true,\"2881\":true,\"2882\":true,\"2883\":true,\"2884\":true,\"2893\":true,\"2901\":true,\"2902\":true,\"2914\":true,\"2915\":true,\"2946\":true,\"3008\":true,\"3021\":true,\"3072\":true,\"3076\":true,\"3132\":true,\"3134\":true,\"3135\":true,\"3136\":true,\"3142\":true,\"3143\":true,\"3144\":true,\"3146\":true,\"3147\":true,\"3148\":true,\"3149\":true,\"3157\":true,\"3158\":true,\"3170\":true,\"3171\":true,\"3201\":true,\"3260\":true,\"3263\":true,\"3270\":true,\"3276\":true,\"3277\":true,\"3298\":true,\"3299\":true,\"3328\":true,\"3329\":true,\"3387\":true,\"3388\":true,\"3393\":true,\"3394\":true,\"3395\":true,\"3396\":true,\"3405\":true,\"3426\":true,\"3427\":true,\"3457\":true,\"3530\":true,\"3538\":true,\"3539\":true,\"3540\":true,\"3542\":true,\"3633\":true,\"3636\":true,\"3637\":true,\"3638\":true,\"3639\":true,\"3640\":true,\"3641\":true,\"3642\":true,\"3654\":true,\"3655\":true,\"3656\":true,\"3657\":true,\"3658\":true,\"3659\":true,\"3660\":true,\"3661\":true,\"3662\":true,\"3761\":true,\"3764\":true,\"3765\":true,\"3766\":true,\"3767\":true,\"3768\":true,\"3769\":true,\"3770\":true,\"3771\":true,\"3772\":true,\"3782\":true,\"3784\":true,\"3785\":true,\"3786\":true,\"3787\":true,\"3788\":true,\"3789\":true,\"3790\":true,\"3864\":true,\"3865\":true,\"3893\":true,\"3895\":true,\"3897\":true,\"3953\":true,\"3954\":true,\"3955\":true,\"3956\":true,\"3957\":true,\"3958\":true,\"3959\":true,\"3960\":true,\"3961\":true,\"3962\":true,\"3963\":true,\"3964\":true,\"3965\":true,\"3966\":true,\"3968\":true,\"3969\":true,\"3970\":true,\"3971\":true,\"3972\":true,\"3974\":true,\"3975\":true,\"3981\":true,\"3982\":true,\"3983\":true,\"3984\":true,\"3985\":true,\"3986\":true,\"3987\":true,\"3988\":true,\"3989\":true,\"3990\":true,\"3991\":true,\"3993\":true,\"3994\":true,\"3995\":true,\"3996\":true,\"3997\":true,\"3998\":true,\"3999\":true,\"4000\":true,\"4001\":true,\"4002\":true,\"4003\":true,\"4004\":true,\"4005\":true,\"4006\":true,\"4007\":true,\"4008\":true,\"4009\":true,\"4010\":true,\"4011\":true,\"4012\":true,\"4013\":true,\"4014\":true,\"4015\":true,\"4016\":true,\"4017\":true,\"4018\":true,\"4019\":true,\"4020\":true,\"4021\":true,\"4022\":true,\"4023\":true,\"4024\":true,\"4025\":true,\"4026\":true,\"4027\":true,\"4028\":true,\"4038\":true,\"4141\":true,\"4142\":true,\"4143\":true,\"4144\":true,\"4146\":true,\"4147\":true,\"4148\":true,\"4149\":true,\"4150\":true,\"4151\":true,\"4153\":true,\"4154\":true,\"4157\":true,\"4158\":true,\"4184\":true,\"4185\":true,\"4190\":true,\"4191\":true,\"4192\":true,\"4209\":true,\"4210\":true,\"4211\":true,\"4212\":true,\"4226\":true,\"4229\":true,\"4230\":true,\"4237\":true,\"4253\":true,\"4348\":true,\"4957\":true,\"4958\":true,\"4959\":true,\"5906\":true,\"5907\":true,\"5908\":true,\"5938\":true,\"5939\":true,\"5970\":true,\"5971\":true,\"6002\":true,\"6003\":true,\"6068\":true,\"6069\":true,\"6071\":true,\"6072\":true,\"6073\":true,\"6074\":true,\"6075\":true,\"6076\":true,\"6077\":true,\"6086\":true,\"6089\":true,\"6090\":true,\"6091\":true,\"6092\":true,\"6093\":true,\"6094\":true,\"6095\":true,\"6096\":true,\"6097\":true,\"6098\":true,\"6099\":true,\"6103\":true,\"6109\":true,\"6155\":true,\"6156\":true,\"6157\":true,\"6158\":true,\"6159\":true,\"6211\":true,\"6277\":true,\"6278\":true,\"6313\":true,\"6432\":true,\"6433\":true,\"6434\":true,\"6439\":true,\"6440\":true,\"6450\":true,\"6457\":true,\"6458\":true,\"6459\":true,\"6679\":true,\"6680\":true,\"6683\":true,\"6742\":true,\"6744\":true,\"6745\":true,\"6746\":true,\"6747\":true,\"6748\":true,\"6749\":true,\"6750\":true,\"6752\":true,\"6754\":true,\"6757\":true,\"6758\":true,\"6759\":true,\"6760\":true,\"6761\":true,\"6762\":true,\"6763\":true,\"6764\":true,\"6771\":true,\"6772\":true,\"6773\":true,\"6774\":true,\"6775\":true,\"6776\":true,\"6777\":true,\"6778\":true,\"6779\":true,\"6780\":true,\"6783\":true,\"6823\":true,\"6832\":true,\"6833\":true,\"6834\":true,\"6835\":true,\"6836\":true,\"6837\":true,\"6838\":true,\"6839\":true,\"6840\":true,\"6841\":true,\"6842\":true,\"6843\":true,\"6844\":true,\"6845\":true,\"6846\":true,\"6847\":true,\"6848\":true,\"6849\":true,\"6850\":true,\"6851\":true,\"6852\":true,\"6853\":true,\"6854\":true,\"6855\":true,\"6856\":true,\"6857\":true,\"6858\":true,\"6859\":true,\"6860\":true,\"6861\":true,\"6862\":true,\"6863\":true,\"6864\":true,\"6865\":true,\"6866\":true,\"6867\":true,\"6868\":true,\"6869\":true,\"6870\":true,\"6871\":true,\"6872\":true,\"6873\":true,\"6874\":true,\"6875\":true,\"6876\":true,\"6877\":true,\"6880\":true,\"6881\":true,\"6882\":true,\"6883\":true,\"6884\":true,\"6885\":true,\"6886\":true,\"6887\":true,\"6888\":true,\"6889\":true,\"6890\":true,\"6891\":true,\"6912\":true,\"6913\":true,\"6914\":true,\"6915\":true,\"6964\":true,\"6966\":true,\"6967\":true,\"6968\":true,\"6969\":true,\"6970\":true,\"6972\":true,\"6978\":true,\"7019\":true,\"7020\":true,\"7021\":true,\"7022\":true,\"7023\":true,\"7024\":true,\"7025\":true,\"7026\":true,\"7027\":true,\"7040\":true,\"7041\":true,\"7074\":true,\"7075\":true,\"7076\":true,\"7077\":true,\"7080\":true,\"7081\":true,\"7083\":true,\"7084\":true,\"7085\":true,\"7142\":true,\"7144\":true,\"7145\":true,\"7149\":true,\"7151\":true,\"7152\":true,\"7153\":true,\"7212\":true,\"7213\":true,\"7214\":true,\"7215\":true,\"7216\":true,\"7217\":true,\"7218\":true,\"7219\":true,\"7222\":true,\"7223\":true,\"7288\":true,\"7289\":true,\"7290\":true,\"7291\":true,\"7292\":true,\"7293\":true,\"7376\":true,\"7377\":true,\"7378\":true,\"7380\":true,\"7381\":true,\"7382\":true,\"7383\":true,\"7384\":true,\"7385\":true,\"7386\":true,\"7387\":true,\"7388\":true,\"7389\":true,\"7390\":true,\"7391\":true,\"7392\":true,\"7394\":true,\"7395\":true,\"7396\":true,\"7397\":true,\"7398\":true,\"7399\":true,\"7400\":true,\"7405\":true,\"7412\":true,\"7416\":true,\"7417\":true,\"7468\":true,\"7469\":true,\"7470\":true,\"7471\":true,\"7472\":true,\"7473\":true,\"7474\":true,\"7475\":true,\"7476\":true,\"7477\":true,\"7478\":true,\"7479\":true,\"7480\":true,\"7481\":true,\"7482\":true,\"7483\":true,\"7484\":true,\"7485\":true,\"7486\":true,\"7487\":true,\"7488\":true,\"7489\":true,\"7490\":true,\"7491\":true,\"7492\":true,\"7493\":true,\"7494\":true,\"7495\":true,\"7496\":true,\"7497\":true,\"7498\":true,\"7499\":true,\"7500\":true,\"7501\":true,\"7502\":true,\"7503\":true,\"7504\":true,\"7505\":true,\"7506\":true,\"7507\":true,\"7508\":true,\"7509\":true,\"7510\":true,\"7511\":true,\"7512\":true,\"7513\":true,\"7514\":true,\"7515\":true,\"7516\":true,\"7517\":true,\"7518\":true,\"7519\":true,\"7520\":true,\"7521\":true,\"7522\":true,\"7523\":true,\"7524\":true,\"7525\":true,\"7526\":true,\"7527\":true,\"7528\":true,\"7529\":true,\"7530\":true,\"7544\":true,\"7579\":true,\"7580\":true,\"7581\":true,\"7582\":true,\"7583\":true,\"7584\":true,\"7585\":true,\"7586\":true,\"7587\":true,\"7588\":true,\"7589\":true,\"7590\":true,\"7591\":true,\"7592\":true,\"7593\":true,\"7594\":true,\"7595\":true,\"7596\":true,\"7597\":true,\"7598\":true,\"7599\":true,\"7600\":true,\"7601\":true,\"7602\":true,\"7603\":true,\"7604\":true,\"7605\":true,\"7606\":true,\"7607\":true,\"7608\":true,\"7609\":true,\"7610\":true,\"7611\":true,\"7612\":true,\"7613\":true,\"7614\":true,\"7615\":true,\"7616\":true,\"7617\":true,\"7618\":true,\"7619\":true,\"7620\":true,\"7621\":true,\"7622\":true,\"7623\":true,\"7624\":true,\"7625\":true,\"7626\":true,\"7627\":true,\"7628\":true,\"7629\":true,\"7630\":true,\"7631\":true,\"7632\":true,\"7633\":true,\"7634\":true,\"7635\":true,\"7636\":true,\"7637\":true,\"7638\":true,\"7639\":true,\"7640\":true,\"7641\":true,\"7642\":true,\"7643\":true,\"7644\":true,\"7645\":true,\"7646\":true,\"7647\":true,\"7648\":true,\"7649\":true,\"7650\":true,\"7651\":true,\"7652\":true,\"7653\":true,\"7654\":true,\"7655\":true,\"7656\":true,\"7657\":true,\"7658\":true,\"7659\":true,\"7660\":true,\"7661\":true,\"7662\":true,\"7663\":true,\"7664\":true,\"7665\":true,\"7666\":true,\"7667\":true,\"7668\":true,\"7669\":true,\"7670\":true,\"7671\":true,\"7672\":true,\"7673\":true,\"7674\":true,\"7675\":true,\"7676\":true,\"7677\":true,\"7678\":true,\"7679\":true,\"8125\":true,\"8127\":true,\"8128\":true,\"8129\":true,\"8141\":true,\"8142\":true,\"8143\":true,\"8157\":true,\"8158\":true,\"8159\":true,\"8173\":true,\"8174\":true,\"8175\":true,\"8189\":true,\"8190\":true,\"8203\":true,\"8204\":true,\"8205\":true,\"8206\":true,\"8207\":true,\"8216\":true,\"8217\":true,\"8228\":true,\"8231\":true,\"8234\":true,\"8235\":true,\"8236\":true,\"8237\":true,\"8238\":true,\"8288\":true,\"8289\":true,\"8290\":true,\"8291\":true,\"8292\":true,\"8294\":true,\"8295\":true,\"8296\":true,\"8297\":true,\"8298\":true,\"8299\":true,\"8300\":true,\"8301\":true,\"8302\":true,\"8303\":true,\"8305\":true,\"8319\":true,\"8336\":true,\"8337\":true,\"8338\":true,\"8339\":true,\"8340\":true,\"8341\":true,\"8342\":true,\"8343\":true,\"8344\":true,\"8345\":true,\"8346\":true,\"8347\":true,\"8348\":true,\"8400\":true,\"8401\":true,\"8402\":true,\"8403\":true,\"8404\":true,\"8405\":true,\"8406\":true,\"8407\":true,\"8408\":true,\"8409\":true,\"8410\":true,\"8411\":true,\"8412\":true,\"8413\":true,\"8414\":true,\"8415\":true,\"8416\":true,\"8417\":true,\"8418\":true,\"8419\":true,\"8420\":true,\"8421\":true,\"8422\":true,\"8423\":true,\"8424\":true,\"8425\":true,\"8426\":true,\"8427\":true,\"8428\":true,\"8429\":true,\"8430\":true,\"8431\":true,\"8432\":true,\"11388\":true,\"11389\":true,\"11503\":true,\"11504\":true,\"11505\":true,\"11631\":true,\"11647\":true,\"11744\":true,\"11745\":true,\"11746\":true,\"11747\":true,\"11748\":true,\"11749\":true,\"11750\":true,\"11751\":true,\"11752\":true,\"11753\":true,\"11754\":true,\"11755\":true,\"11756\":true,\"11757\":true,\"11758\":true,\"11759\":true,\"11760\":true,\"11761\":true,\"11762\":true,\"11763\":true,\"11764\":true,\"11765\":true,\"11766\":true,\"11767\":true,\"11768\":true,\"11769\":true,\"11770\":true,\"11771\":true,\"11772\":true,\"11773\":true,\"11774\":true,\"11775\":true,\"11823\":true,\"12293\":true,\"12330\":true,\"12331\":true,\"12332\":true,\"12333\":true,\"12337\":true,\"12338\":true,\"12339\":true,\"12340\":true,\"12341\":true,\"12347\":true,\"12441\":true,\"12442\":true,\"12443\":true,\"12444\":true,\"12445\":true,\"12446\":true,\"12540\":true,\"12541\":true,\"12542\":true,\"40981\":true,\"42232\":true,\"42233\":true,\"42234\":true,\"42235\":true,\"42236\":true,\"42237\":true,\"42508\":true,\"42607\":true,\"42608\":true,\"42609\":true,\"42610\":true,\"42612\":true,\"42613\":true,\"42614\":true,\"42615\":true,\"42616\":true,\"42617\":true,\"42618\":true,\"42619\":true,\"42620\":true,\"42621\":true,\"42623\":true,\"42652\":true,\"42653\":true,\"42654\":true,\"42655\":true,\"42736\":true,\"42737\":true,\"42752\":true,\"42753\":true,\"42754\":true,\"42755\":true,\"42756\":true,\"42757\":true,\"42758\":true,\"42759\":true,\"42760\":true,\"42761\":true,\"42762\":true,\"42763\":true,\"42764\":true,\"42765\":true,\"42766\":true,\"42767\":true,\"42768\":true,\"42769\":true,\"42770\":true,\"42771\":true,\"42772\":true,\"42773\":true,\"42774\":true,\"42775\":true,\"42776\":true,\"42777\":true,\"42778\":true,\"42779\":true,\"42780\":true,\"42781\":true,\"42782\":true,\"42783\":true,\"42784\":true,\"42785\":true,\"42864\":true,\"42888\":true,\"42889\":true,\"42890\":true,\"42993\":true,\"42994\":true,\"42995\":true,\"42996\":true,\"43000\":true,\"43001\":true,\"43010\":true,\"43014\":true,\"43019\":true,\"43045\":true,\"43046\":true,\"43052\":true,\"43204\":true,\"43205\":true,\"43232\":true,\"43233\":true,\"43234\":true,\"43235\":true,\"43236\":true,\"43237\":true,\"43238\":true,\"43239\":true,\"43240\":true,\"43241\":true,\"43242\":true,\"43243\":true,\"43244\":true,\"43245\":true,\"43246\":true,\"43247\":true,\"43248\":true,\"43249\":true,\"43263\":true,\"43302\":true,\"43303\":true,\"43304\":true,\"43305\":true,\"43306\":true,\"43307\":true,\"43308\":true,\"43309\":true,\"43335\":true,\"43336\":true,\"43337\":true,\"43338\":true,\"43339\":true,\"43340\":true,\"43341\":true,\"43342\":true,\"43343\":true,\"43344\":true,\"43345\":true,\"43392\":true,\"43393\":true,\"43394\":true,\"43443\":true,\"43446\":true,\"43447\":true,\"43448\":true,\"43449\":true,\"43452\":true,\"43453\":true,\"43471\":true,\"43493\":true,\"43494\":true,\"43561\":true,\"43562\":true,\"43563\":true,\"43564\":true,\"43565\":true,\"43566\":true,\"43569\":true,\"43570\":true,\"43573\":true,\"43574\":true,\"43587\":true,\"43596\":true,\"43632\":true,\"43644\":true,\"43696\":true,\"43698\":true,\"43699\":true,\"43700\":true,\"43703\":true,\"43704\":true,\"43710\":true,\"43711\":true,\"43713\":true,\"43741\":true,\"43756\":true,\"43757\":true,\"43763\":true,\"43764\":true,\"43766\":true,\"43867\":true,\"43868\":true,\"43869\":true,\"43870\":true,\"43871\":true,\"43881\":true,\"43882\":true,\"43883\":true,\"44005\":true,\"44008\":true,\"44013\":true,\"64286\":true,\"64434\":true,\"64435\":true,\"64436\":true,\"64437\":true,\"64438\":true,\"64439\":true,\"64440\":true,\"64441\":true,\"64442\":true,\"64443\":true,\"64444\":true,\"64445\":true,\"64446\":true,\"64447\":true,\"64448\":true,\"64449\":true,\"64450\":true,\"65024\":true,\"65025\":true,\"65026\":true,\"65027\":true,\"65028\":true,\"65029\":true,\"65030\":true,\"65031\":true,\"65032\":true,\"65033\":true,\"65034\":true,\"65035\":true,\"65036\":true,\"65037\":true,\"65038\":true,\"65039\":true,\"65043\":true,\"65056\":true,\"65057\":true,\"65058\":true,\"65059\":true,\"65060\":true,\"65061\":true,\"65062\":true,\"65063\":true,\"65064\":true,\"65065\":true,\"65066\":true,\"65067\":true,\"65068\":true,\"65069\":true,\"65070\":true,\"65071\":true,\"65106\":true,\"65109\":true,\"65279\":true,\"65287\":true,\"65294\":true,\"65306\":true,\"65342\":true,\"65344\":true,\"65392\":true,\"65438\":true,\"65439\":true,\"65507\":true,\"65529\":true,\"65530\":true,\"65531\":true,\"66045\":true,\"66272\":true,\"66422\":true,\"66423\":true,\"66424\":true,\"66425\":true,\"66426\":true,\"67456\":true,\"67457\":true,\"67458\":true,\"67459\":true,\"67460\":true,\"67461\":true,\"67463\":true,\"67464\":true,\"67465\":true,\"67466\":true,\"67467\":true,\"67468\":true,\"67469\":true,\"67470\":true,\"67471\":true,\"67472\":true,\"67473\":true,\"67474\":true,\"67475\":true,\"67476\":true,\"67477\":true,\"67478\":true,\"67479\":true,\"67480\":true,\"67481\":true,\"67482\":true,\"67483\":true,\"67484\":true,\"67485\":true,\"67486\":true,\"67487\":true,\"67488\":true,\"67489\":true,\"67490\":true,\"67491\":true,\"67492\":true,\"67493\":true,\"67494\":true,\"67495\":true,\"67496\":true,\"67497\":true,\"67498\":true,\"67499\":true,\"67500\":true,\"67501\":true,\"67502\":true,\"67503\":true,\"67504\":true,\"67506\":true,\"67507\":true,\"67508\":true,\"67509\":true,\"67510\":true,\"67511\":true,\"67512\":true,\"67513\":true,\"67514\":true,\"68097\":true,\"68098\":true,\"68099\":true,\"68101\":true,\"68102\":true,\"68108\":true,\"68109\":true,\"68110\":true,\"68111\":true,\"68152\":true,\"68153\":true,\"68154\":true,\"68159\":true,\"68325\":true,\"68326\":true,\"68900\":true,\"68901\":true,\"68902\":true,\"68903\":true,\"68942\":true,\"68969\":true,\"68970\":true,\"68971\":true,\"68972\":true,\"68973\":true,\"68975\":true,\"69291\":true,\"69292\":true,\"69317\":true,\"69370\":true,\"69371\":true,\"69372\":true,\"69373\":true,\"69374\":true,\"69375\":true,\"69446\":true,\"69447\":true,\"69448\":true,\"69449\":true,\"69450\":true,\"69451\":true,\"69452\":true,\"69453\":true,\"69454\":true,\"69455\":true,\"69456\":true,\"69506\":true,\"69507\":true,\"69508\":true,\"69509\":true,\"69633\":true,\"69688\":true,\"69689\":true,\"69690\":true,\"69691\":true,\"69692\":true,\"69693\":true,\"69694\":true,\"69695\":true,\"69696\":true,\"69697\":true,\"69698\":true,\"69699\":true,\"69700\":true,\"69701\":true,\"69702\":true,\"69744\":true,\"69747\":true,\"69748\":true,\"69759\":true,\"69760\":true,\"69761\":true,\"69811\":true,\"69812\":true,\"69813\":true,\"69814\":true,\"69817\":true,\"69818\":true,\"69821\":true,\"69826\":true,\"69837\":true,\"69888\":true,\"69889\":true,\"69890\":true,\"69927\":true,\"69928\":true,\"69929\":true,\"69930\":true,\"69931\":true,\"69933\":true,\"69934\":true,\"69935\":true,\"69936\":true,\"69937\":true,\"69938\":true,\"69939\":true,\"69940\":true,\"70003\":true,\"70016\":true,\"70017\":true,\"70070\":true,\"70071\":true,\"70072\":true,\"70073\":true,\"70074\":true,\"70075\":true,\"70076\":true,\"70077\":true,\"70078\":true,\"70089\":true,\"70090\":true,\"70091\":true,\"70092\":true,\"70095\":true,\"70191\":true,\"70192\":true,\"70193\":true,\"70196\":true,\"70198\":true,\"70199\":true,\"70206\":true,\"70209\":true,\"70367\":true,\"70371\":true,\"70372\":true,\"70373\":true,\"70374\":true,\"70375\":true,\"70376\":true,\"70377\":true,\"70378\":true,\"70400\":true,\"70401\":true,\"70459\":true,\"70460\":true,\"70464\":true,\"70502\":true,\"70503\":true,\"70504\":true,\"70505\":true,\"70506\":true,\"70507\":true,\"70508\":true,\"70512\":true,\"70513\":true,\"70514\":true,\"70515\":true,\"70516\":true,\"70587\":true,\"70588\":true,\"70589\":true,\"70590\":true,\"70591\":true,\"70592\":true,\"70606\":true,\"70608\":true,\"70610\":true,\"70625\":true,\"70626\":true,\"70712\":true,\"70713\":true,\"70714\":true,\"70715\":true,\"70716\":true,\"70717\":true,\"70718\":true,\"70719\":true,\"70722\":true,\"70723\":true,\"70724\":true,\"70726\":true,\"70750\":true,\"70835\":true,\"70836\":true,\"70837\":true,\"70838\":true,\"70839\":true,\"70840\":true,\"70842\":true,\"70847\":true,\"70848\":true,\"70850\":true,\"70851\":true,\"71090\":true,\"71091\":true,\"71092\":true,\"71093\":true,\"71100\":true,\"71101\":true,\"71103\":true,\"71104\":true,\"71132\":true,\"71133\":true,\"71219\":true,\"71220\":true,\"71221\":true,\"71222\":true,\"71223\":true,\"71224\":true,\"71225\":true,\"71226\":true,\"71229\":true,\"71231\":true,\"71232\":true,\"71339\":true,\"71341\":true,\"71344\":true,\"71345\":true,\"71346\":true,\"71347\":true,\"71348\":true,\"71349\":true,\"71351\":true,\"71453\":true,\"71455\":true,\"71458\":true,\"71459\":true,\"71460\":true,\"71461\":true,\"71463\":true,\"71464\":true,\"71465\":true,\"71466\":true,\"71467\":true,\"71727\":true,\"71728\":true,\"71729\":true,\"71730\":true,\"71731\":true,\"71732\":true,\"71733\":true,\"71734\":true,\"71735\":true,\"71737\":true,\"71738\":true,\"71995\":true,\"71996\":true,\"71998\":true,\"72003\":true,\"72148\":true,\"72149\":true,\"72150\":true,\"72151\":true,\"72154\":true,\"72155\":true,\"72160\":true,\"72193\":true,\"72194\":true,\"72195\":true,\"72196\":true,\"72197\":true,\"72198\":true,\"72199\":true,\"72200\":true,\"72201\":true,\"72202\":true,\"72243\":true,\"72244\":true,\"72245\":true,\"72246\":true,\"72247\":true,\"72248\":true,\"72251\":true,\"72252\":true,\"72253\":true,\"72254\":true,\"72263\":true,\"72273\":true,\"72274\":true,\"72275\":true,\"72276\":true,\"72277\":true,\"72278\":true,\"72281\":true,\"72282\":true,\"72283\":true,\"72330\":true,\"72331\":true,\"72332\":true,\"72333\":true,\"72334\":true,\"72335\":true,\"72336\":true,\"72337\":true,\"72338\":true,\"72339\":true,\"72340\":true,\"72341\":true,\"72342\":true,\"72344\":true,\"72345\":true,\"72544\":true,\"72546\":true,\"72547\":true,\"72548\":true,\"72550\":true,\"72752\":true,\"72753\":true,\"72754\":true,\"72755\":true,\"72756\":true,\"72757\":true,\"72758\":true,\"72760\":true,\"72761\":true,\"72762\":true,\"72763\":true,\"72764\":true,\"72765\":true,\"72767\":true,\"72850\":true,\"72851\":true,\"72852\":true,\"72853\":true,\"72854\":true,\"72855\":true,\"72856\":true,\"72857\":true,\"72858\":true,\"72859\":true,\"72860\":true,\"72861\":true,\"72862\":true,\"72863\":true,\"72864\":true,\"72865\":true,\"72866\":true,\"72867\":true,\"72868\":true,\"72869\":true,\"72870\":true,\"72871\":true,\"72874\":true,\"72875\":true,\"72876\":true,\"72877\":true,\"72878\":true,\"72879\":true,\"72880\":true,\"72882\":true,\"72883\":true,\"72885\":true,\"72886\":true,\"73009\":true,\"73010\":true,\"73011\":true,\"73012\":true,\"73013\":true,\"73014\":true,\"73018\":true,\"73020\":true,\"73021\":true,\"73023\":true,\"73024\":true,\"73025\":true,\"73026\":true,\"73027\":true,\"73028\":true,\"73029\":true,\"73031\":true,\"73104\":true,\"73105\":true,\"73109\":true,\"73111\":true,\"73177\":true,\"73459\":true,\"73460\":true,\"73472\":true,\"73473\":true,\"73526\":true,\"73527\":true,\"73528\":true,\"73529\":true,\"73530\":true,\"73536\":true,\"73538\":true,\"73562\":true,\"78896\":true,\"78897\":true,\"78898\":true,\"78899\":true,\"78900\":true,\"78901\":true,\"78902\":true,\"78903\":true,\"78904\":true,\"78905\":true,\"78906\":true,\"78907\":true,\"78908\":true,\"78909\":true,\"78910\":true,\"78911\":true,\"78912\":true,\"78919\":true,\"78920\":true,\"78921\":true,\"78922\":true,\"78923\":true,\"78924\":true,\"78925\":true,\"78926\":true,\"78927\":true,\"78928\":true,\"78929\":true,\"78930\":true,\"78931\":true,\"78932\":true,\"78933\":true,\"90398\":true,\"90399\":true,\"90400\":true,\"90401\":true,\"90402\":true,\"90403\":true,\"90404\":true,\"90405\":true,\"90406\":true,\"90407\":true,\"90408\":true,\"90409\":true,\"90413\":true,\"90414\":true,\"90415\":true,\"92912\":true,\"92913\":true,\"92914\":true,\"92915\":true,\"92916\":true,\"92976\":true,\"92977\":true,\"92978\":true,\"92979\":true,\"92980\":true,\"92981\":true,\"92982\":true,\"92992\":true,\"92993\":true,\"92994\":true,\"92995\":true,\"93504\":true,\"93505\":true,\"93506\":true,\"93547\":true,\"93548\":true,\"94031\":true,\"94095\":true,\"94096\":true,\"94097\":true,\"94098\":true,\"94099\":true,\"94100\":true,\"94101\":true,\"94102\":true,\"94103\":true,\"94104\":true,\"94105\":true,\"94106\":true,\"94107\":true,\"94108\":true,\"94109\":true,\"94110\":true,\"94111\":true,\"94176\":true,\"94177\":true,\"94179\":true,\"94180\":true,\"94194\":true,\"94195\":true,\"110576\":true,\"110577\":true,\"110578\":true,\"110579\":true,\"110581\":true,\"110582\":true,\"110583\":true,\"110584\":true,\"110585\":true,\"110586\":true,\"110587\":true,\"110589\":true,\"110590\":true,\"113821\":true,\"113822\":true,\"113824\":true,\"113825\":true,\"113826\":true,\"113827\":true,\"118528\":true,\"118529\":true,\"118530\":true,\"118531\":true,\"118532\":true,\"118533\":true,\"118534\":true,\"118535\":true,\"118536\":true,\"118537\":true,\"118538\":true,\"118539\":true,\"118540\":true,\"118541\":true,\"118542\":true,\"118543\":true,\"118544\":true,\"118545\":true,\"118546\":true,\"118547\":true,\"118548\":true,\"118549\":true,\"118550\":true,\"118551\":true,\"118552\":true,\"118553\":true,\"118554\":true,\"118555\":true,\"118556\":true,\"118557\":true,\"118558\":true,\"118559\":true,\"118560\":true,\"118561\":true,\"118562\":true,\"118563\":true,\"118564\":true,\"118565\":true,\"118566\":true,\"118567\":true,\"118568\":true,\"118569\":true,\"118570\":true,\"118571\":true,\"118572\":true,\"118573\":true,\"118576\":true,\"118577\":true,\"118578\":true,\"118579\":true,\"118580\":true,\"118581\":true,\"118582\":true,\"118583\":true,\"118584\":true,\"118585\":true,\"118586\":true,\"118587\":true,\"118588\":true,\"118589\":true,\"118590\":true,\"118591\":true,\"118592\":true,\"118593\":true,\"118594\":true,\"118595\":true,\"118596\":true,\"118597\":true,\"118598\":true,\"119143\":true,\"119144\":true,\"119145\":true,\"119155\":true,\"119156\":true,\"119157\":true,\"119158\":true,\"119159\":true,\"119160\":true,\"119161\":true,\"119162\":true,\"119163\":true,\"119164\":true,\"119165\":true,\"119166\":true,\"119167\":true,\"119168\":true,\"119169\":true,\"119170\":true,\"119173\":true,\"119174\":true,\"119175\":true,\"119176\":true,\"119177\":true,\"119178\":true,\"119179\":true,\"119210\":true,\"119211\":true,\"119212\":true,\"119213\":true,\"119362\":true,\"119363\":true,\"119364\":true,\"121344\":true,\"121345\":true,\"121346\":true,\"121347\":true,\"121348\":true,\"121349\":true,\"121350\":true,\"121351\":true,\"121352\":true,\"121353\":true,\"121354\":true,\"121355\":true,\"121356\":true,\"121357\":true,\"121358\":true,\"121359\":true,\"121360\":true,\"121361\":true,\"121362\":true,\"121363\":true,\"121364\":true,\"121365\":true,\"121366\":true,\"121367\":true,\"121368\":true,\"121369\":true,\"121370\":true,\"121371\":true,\"121372\":true,\"121373\":true,\"121374\":true,\"121375\":true,\"121376\":true,\"121377\":true,\"121378\":true,\"121379\":true,\"121380\":true,\"121381\":true,\"121382\":true,\"121383\":true,\"121384\":true,\"121385\":true,\"121386\":true,\"121387\":true,\"121388\":true,\"121389\":true,\"121390\":true,\"121391\":true,\"121392\":true,\"121393\":true,\"121394\":true,\"121395\":true,\"121396\":true,\"121397\":true,\"121398\":true,\"121403\":true,\"121404\":true,\"121405\":true,\"121406\":true,\"121407\":true,\"121408\":true,\"121409\":true,\"121410\":true,\"121411\":true,\"121412\":true,\"121413\":true,\"121414\":true,\"121415\":true,\"121416\":true,\"121417\":true,\"121418\":true,\"121419\":true,\"121420\":true,\"121421\":true,\"121422\":true,\"121423\":true,\"121424\":true,\"121425\":true,\"121426\":true,\"121427\":true,\"121428\":true,\"121429\":true,\"121430\":true,\"121431\":true,\"121432\":true,\"121433\":true,\"121434\":true,\"121435\":true,\"121436\":true,\"121437\":true,\"121438\":true,\"121439\":true,\"121440\":true,\"121441\":true,\"121442\":true,\"121443\":true,\"121444\":true,\"121445\":true,\"121446\":true,\"121447\":true,\"121448\":true,\"121449\":true,\"121450\":true,\"121451\":true,\"121452\":true,\"121461\":true,\"121476\":true,\"121499\":true,\"121500\":true,\"121501\":true,\"121502\":true,\"121503\":true,\"121505\":true,\"121506\":true,\"121507\":true,\"121508\":true,\"121509\":true,\"121510\":true,\"121511\":true,\"121512\":true,\"121513\":true,\"121514\":true,\"121515\":true,\"121516\":true,\"121517\":true,\"121518\":true,\"121519\":true,\"122880\":true,\"122881\":true,\"122882\":true,\"122883\":true,\"122884\":true,\"122885\":true,\"122886\":true,\"122888\":true,\"122889\":true,\"122890\":true,\"122891\":true,\"122892\":true,\"122893\":true,\"122894\":true,\"122895\":true,\"122896\":true,\"122897\":true,\"122898\":true,\"122899\":true,\"122900\":true,\"122901\":true,\"122902\":true,\"122903\":true,\"122904\":true,\"122907\":true,\"122908\":true,\"122909\":true,\"122910\":true,\"122911\":true,\"122912\":true,\"122913\":true,\"122915\":true,\"122916\":true,\"122918\":true,\"122919\":true,\"122920\":true,\"122921\":true,\"122922\":true,\"122928\":true,\"122929\":true,\"122930\":true,\"122931\":true,\"122932\":true,\"122933\":true,\"122934\":true,\"122935\":true,\"122936\":true,\"122937\":true,\"122938\":true,\"122939\":true,\"122940\":true,\"122941\":true,\"122942\":true,\"122943\":true,\"122944\":true,\"122945\":true,\"122946\":true,\"122947\":true,\"122948\":true,\"122949\":true,\"122950\":true,\"122951\":true,\"122952\":true,\"122953\":true,\"122954\":true,\"122955\":true,\"122956\":true,\"122957\":true,\"122958\":true,\"122959\":true,\"122960\":true,\"122961\":true,\"122962\":true,\"122963\":true,\"122964\":true,\"122965\":true,\"122966\":true,\"122967\":true,\"122968\":true,\"122969\":true,\"122970\":true,\"122971\":true,\"122972\":true,\"122973\":true,\"122974\":true,\"122975\":true,\"122976\":true,\"122977\":true,\"122978\":true,\"122979\":true,\"122980\":true,\"122981\":true,\"122982\":true,\"122983\":true,\"122984\":true,\"122985\":true,\"122986\":true,\"122987\":true,\"122988\":true,\"122989\":true,\"123023\":true,\"123184\":true,\"123185\":true,\"123186\":true,\"123187\":true,\"123188\":true,\"123189\":true,\"123190\":true,\"123191\":true,\"123192\":true,\"123193\":true,\"123194\":true,\"123195\":true,\"123196\":true,\"123197\":true,\"123566\":true,\"123628\":true,\"123629\":true,\"123630\":true,\"123631\":true,\"124139\":true,\"124140\":true,\"124141\":true,\"124142\":true,\"124143\":true,\"124398\":true,\"124399\":true,\"124643\":true,\"124646\":true,\"124654\":true,\"124655\":true,\"124661\":true,\"124671\":true,\"125136\":true,\"125137\":true,\"125138\":true,\"125139\":true,\"125140\":true,\"125141\":true,\"125142\":true,\"125252\":true,\"125253\":true,\"125254\":true,\"125255\":true,\"125256\":true,\"125257\":true,\"125258\":true,\"125259\":true,\"127995\":true,\"127996\":true,\"127997\":true,\"127998\":true,\"127999\":true,\"917505\":true,\"917536\":true,\"917537\":true,\"917538\":true,\"917539\":true,\"917540\":true,\"917541\":true,\"917542\":true,\"917543\":true,\"917544\":true,\"917545\":true,\"917546\":true,\"917547\":true,\"917548\":true,\"917549\":true,\"917550\":true,\"917551\":true,\"917552\":true,\"917553\":true,\"917554\":true,\"917555\":true,\"917556\":true,\"917557\":true,\"917558\":true,\"917559\":true,\"917560\":true,\"917561\":true,\"917562\":true,\"917563\":true,\"917564\":true,\"917565\":true,\"917566\":true,\"917567\":true,\"917568\":true,\"917569\":true,\"917570\":true,\"917571\":true,\"917572\":true,\"917573\":true,\"917574\":true,\"917575\":true,\"917576\":true,\"917577\":true,\"917578\":true,\"917579\":true,\"917580\":true,\"917581\":true,\"917582\":true,\"917583\":true,\"917584\":true,\"917585\":true,\"917586\":true,\"917587\":true,\"917588\":true,\"917589\":true,\"917590\":true,\"917591\":true,\"917592\":true,\"917593\":true,\"917594\":true,\"917595\":true,\"917596\":true,\"917597\":true,\"917598\":true,\"917599\":true,\"917600\":true,\"917601\":true,\"917602\":true,\"917603\":true,\"917604\":true,\"917605\":true,\"917606\":true,\"917607\":true,\"917608\":true,\"917609\":true,\"917610\":true,\"917611\":true,\"917612\":true,\"917613\":true,\"917614\":true,\"917615\":true,\"917616\":true,\"917617\":true,\"917618\":true,\"917619\":true,\"917620\":true,\"917621\":true,\"917622\":true,\"917623\":true,\"917624\":true,\"917625\":true,\"917626\":true,\"917627\":true,\"917628\":true,\"917629\":true,\"917630\":true,\"917631\":true,\"917760\":true,\"917761\":true,\"917762\":true,\"917763\":true,\"917764\":true,\"917765\":true,\"917766\":true,\"917767\":true,\"917768\":true,\"917769\":true,\"917770\":true,\"917771\":true,\"917772\":true,\"917773\":true,\"917774\":true,\"917775\":true,\"917776\":true,\"917777\":true,\"917778\":true,\"917779\":true,\"917780\":true,\"917781\":true,\"917782\":true,\"917783\":true,\"917784\":true,\"917785\":true,\"917786\":true,\"917787\":true,\"917788\":true,\"917789\":true,\"917790\":true,\"917791\":true,\"917792\":true,\"917793\":true,\"917794\":true,\"917795\":true,\"917796\":true,\"917797\":true,\"917798\":true,\"917799\":true,\"917800\":true,\"917801\":true,\"917802\":true,\"917803\":true,\"917804\":true,\"917805\":true,\"917806\":true,\"917807\":true,\"917808\":true,\"917809\":true,\"917810\":true,\"917811\":true,\"917812\":true,\"917813\":true,\"917814\":true,\"917815\":true,\"917816\":true,\"917817\":true,\"917818\":true,\"917819\":true,\"917820\":true,\"917821\":true,\"917822\":true,\"917823\":true,\"917824\":true,\"917825\":true,\"917826\":true,\"917827\":true,\"917828\":true,\"917829\":true,\"917830\":true,\"917831\":true,\"917832\":true,\"917833\":true,\"917834\":true,\"917835\":true,\"917836\":true,\"917837\":true,\"917838\":true,\"917839\":true,\"917840\":true,\"917841\":true,\"917842\":true,\"917843\":true,\"917844\":true,\"917845\":true,\"917846\":true,\"917847\":true,\"917848\":true,\"917849\":true,\"917850\":true,\"917851\":true,\"917852\":true,\"917853\":true,\"917854\":true,\"917855\":true,\"917856\":true,\"917857\":true,\"917858\":true,\"917859\":true,\"917860\":true,\"917861\":true,\"917862\":true,\"917863\":true,\"917864\":true,\"917865\":true,\"917866\":true,\"917867\":true,\"917868\":true,\"917869\":true,\"917870\":true,\"917871\":true,\"917872\":true,\"917873\":true,\"917874\":true,\"917875\":true,\"917876\":true,\"917877\":true,\"917878\":true,\"917879\":true,\"917880\":true,\"917881\":true,\"917882\":true,\"917883\":true,\"917884\":true,\"917885\":true,\"917886\":true,\"917887\":true,\"917888\":true,\"917889\":true,\"917890\":true,\"917891\":true,\"917892\":true,\"917893\":true,\"917894\":true,\"917895\":true,\"917896\":true,\"917897\":true,\"917898\":true,\"917899\":true,\"917900\":true,\"917901\":true,\"917902\":true,\"917903\":true,\"917904\":true,\"917905\":true,\"917906\":true,\"917907\":true,\"917908\":true,\"917909\":true,\"917910\":true,\"917911\":true,\"917912\":true,\"917913\":true,\"917914\":true,\"917915\":true,\"917916\":true,\"917917\":true,\"917918\":true,\"917919\":true,\"917920\":true,\"917921\":true,\"917922\":true,\"917923\":true,\"917924\":true,\"917925\":true,\"917926\":true,\"917927\":true,\"917928\":true,\"917929\":true,\"917930\":true,\"917931\":true,\"917932\":true,\"917933\":true,\"917934\":true,\"917935\":true,\"917936\":true,\"917937\":true,\"917938\":true,\"917939\":true,\"917940\":true,\"917941\":true,\"917942\":true,\"917943\":true,\"917944\":true,\"917945\":true,\"917946\":true,\"917947\":true,\"917948\":true,\"917949\":true,\"917950\":true,\"917951\":true,\"917952\":true,\"917953\":true,\"917954\":true,\"917955\":true,\"917956\":true,\"917957\":true,\"917958\":true,\"917959\":true,\"917960\":true,\"917961\":true,\"917962\":true,\"917963\":true,\"917964\":true,\"917965\":true,\"917966\":true,\"917967\":true,\"917968\":true,\"917969\":true,\"917970\":true,\"917971\":true,\"917972\":true,\"917973\":true,\"917974\":true,\"917975\":true,\"917976\":true,\"917977\":true,\"917978\":true,\"917979\":true,\"917980\":true,\"917981\":true,\"917982\":true,\"917983\":true,\"917984\":true,\"917985\":true,\"917986\":true,\"917987\":true,\"917988\":true,\"917989\":true,\"917990\":true,\"917991\":true,\"917992\":true,\"917993\":true,\"917994\":true,\"917995\":true,\"917996\":true,\"917997\":true,\"917998\":true,\"917999\":true},\"punctuation\":{\"33\":true,\"34\":true,\"35\":true,\"36\":true,\"37\":true,\"38\":true,\"39\":true,\"40\":true,\"41\":true,\"42\":true,\"43\":true,\"44\":true,\"45\":true,\"46\":true,\"47\":true,\"58\":true,\"59\":true,\"60\":true,\"61\":true,\"62\":true,\"63\":true,\"64\":true,\"91\":true,\"93\":true,\"94\":true,\"95\":true,\"96\":true,\"123\":true,\"124\":true,\"125\":true,\"126\":true},\"whitespace\":{\"9\":true,\"10\":true,\"11\":true,\"12\":true,\"13\":true,\"32\":true,\"160\":true,\"5760\":true,\"8192\":true,\"8193\":true,\"8194\":true,\"8195\":true,\"8196\":true,\"8197\":true,\"8198\":true,\"8199\":true,\"8200\":true,\"8201\":true,\"8202\":true,\"8232\":true,\"8233\":true,\"8239\":true,\"8287\":true,\"12288\":true,\"65279\":true},\"stopwords\":[\"0o\",\"0s\",\"3a\",\"3b\",\"3d\",\"6b\",\"6o\",\"a\",\"a1\",\"a2\",\"a3\",\"a4\",\"ab\",\"able\",\"about\",\"above\",\"abst\",\"ac\",\"accordance\",\"according\",\"accordingly\",\"across\",\"act\",\"actually\",\"ad\",\"added\",\"adj\",\"ae\",\"af\",\"affected\",\"affecting\",\"affects\",\"after\",\"afterwards\",\"ag\",\"again\",\"against\",\"ah\",\"ain\",\"ain't\",\"aj\",\"al\",\"all\",\"allow\",\"allows\",\"almost\",\"alone\",\"along\",\"already\",\"also\",\"although\",\"always\",\"am\",\"among\",\"amongst\",\"amoungst\",\"amount\",\"an\",\"and\",\"announce\",\"another\",\"any\",\"anybody\",\"anyhow\",\"anymore\",\"anyone\",\"anything\",\"anyway\",\"anyways\",\"anywhere\",\"ao\",\"ap\",\"apart\",\"apparently\",\"appear\",\"appreciate\",\"appropriate\",\"approximately\",\"ar\",\"are\",\"aren\",\"arent\",\"aren't\",\"arise\",\"around\",\"as\",\"a's\",\"aside\",\"ask\",\"asking\",\"associated\",\"at\",\"au\",\"auth\",\"av\",\"available\",\"aw\",\"away\",\"awfully\",\"ax\",\"ay\",\"az\",\"b\",\"b1\",\"b2\",\"b3\",\"ba\",\"back\",\"bc\",\"bd\",\"be\",\"became\",\"because\",\"become\",\"becomes\",\"becoming\",\"been\",\"before\",\"beforehand\",\"begin\",\"beginning\",\"beginnings\",\"begins\",\"behind\",\"being\",\"believe\",\"below\",\"beside\",\"besides\",\"best\",\"better\",\"between\",\"beyond\",\"bi\",\"bill\",\"biol\",\"bj\",\"bk\",\"bl\",\"bn\",\"both\",\"bottom\",\"bp\",\"br\",\"brief\",\"briefly\",\"bs\",\"bt\",\"bu\",\"but\",\"bx\",\"by\",\"c\",\"c1\",\"c2\",\"c3\",\"ca\",\"call\",\"came\",\"can\",\"cannot\",\"cant\",\"can't\",\"cause\",\"causes\",\"cc\",\"cd\",\"ce\",\"certain\",\"certainly\",\"cf\",\"cg\",\"ch\",\"changes\",\"ci\",\"cit\",\"cj\",\"cl\",\"clearly\",\"cm\",\"c'mon\",\"cn\",\"co\",\"com\",\"come\",\"comes\",\"con\",\"concerning\",\"consequently\",\"consider\",\"considering\",\"contain\",\"containing\",\"contains\",\"corresponding\",\"could\",\"couldn\",\"couldnt\",\"couldn't\",\"course\",\"cp\",\"cq\",\"cr\",\"cry\",\"cs\",\"c's\",\"ct\",\"cu\",\"currently\",\"cv\",\"cx\",\"cy\",\"cz\",\"d\",\"d2\",\"da\",\"date\",\"dc\",\"dd\",\"de\",\"definitely\",\"describe\",\"described\",\"despite\",\"detail\",\"df\",\"di\",\"did\",\"didn\",\"didn't\",\"different\",\"dj\",\"dk\",\"dl\",\"do\",\"does\",\"doesn\",\"doesn't\",\"doing\",\"don\",\"done\",\"don't\",\"down\",\"downwards\",\"dp\",\"dr\",\"ds\",\"dt\",\"du\",\"due\",\"during\",\"dx\",\"dy\",\"e\",\"e2\",\"e3\",\"ea\",\"each\",\"ec\",\"ed\",\"edu\",\"ee\",\"ef\",\"effect\",\"eg\",\"ei\",\"eight\",\"eighty\",\"either\",\"ej\",\"el\",\"eleven\",\"else\",\"elsewhere\",\"em\",\"empty\",\"en\",\"end\",\"ending\",\"enough\",\"entirely\",\"eo\",\"ep\",\"eq\",\"er\",\"es\",\"especially\",\"est\",\"et\",\"et-al\",\"etc\",\"eu\",\"ev\",\"even\",\"ever\",\"every\",\"everybody\",\"everyone\",\"everything\",\"everywhere\",\"ex\",\"exactly\",\"example\",\"except\",\"ey\",\"f\",\"f2\",\"fa\",\"far\",\"fc\",\"few\",\"ff\",\"fi\",\"fifteen\",\"fifth\",\"fify\",\"fill\",\"find\",\"fire\",\"first\",\"five\",\"fix\",\"fj\",\"fl\",\"fn\",\"fo\",\"followed\",\"following\",\"follows\",\"for\",\"former\",\"formerly\",\"forth\",\"forty\",\"found\",\"four\",\"fr\",\"from\",\"front\",\"ft\",\"fu\",\"full\",\"further\",\"furthermore\",\"fy\",\"g\",\"ga\",\"gave\",\"ge\",\"get\",\"gets\",\"getting\",\"gi\",\"give\",\"given\",\"gives\",\"giving\",\"gj\",\"gl\",\"go\",\"goes\",\"going\",\"gone\",\"got\",\"gotten\",\"gr\",\"greetings\",\"gs\",\"gy\",\"h\",\"h2\",\"h3\",\"had\",\"hadn\",\"hadn't\",\"happens\",\"hardly\",\"has\",\"hasn\",\"hasnt\",\"hasn't\",\"have\",\"haven\",\"haven't\",\"having\",\"he\",\"hed\",\"he'd\",\"he'll\",\"hello\",\"help\",\"hence\",\"her\",\"here\",\"hereafter\",\"hereby\",\"herein\",\"heres\",\"here's\",\"hereupon\",\"hers\",\"herself\",\"hes\",\"he's\",\"hh\",\"hi\",\"hid\",\"him\",\"himself\",\"his\",\"hither\",\"hj\",\"ho\",\"home\",\"hopefully\",\"how\",\"howbeit\",\"however\",\"how's\",\"hr\",\"hs\",\"http\",\"hu\",\"hundred\",\"hy\",\"i\",\"i2\",\"i3\",\"i4\",\"i6\",\"i7\",\"i8\",\"ia\",\"ib\",\"ibid\",\"ic\",\"id\",\"i'd\",\"ie\",\"if\",\"ig\",\"ignored\",\"ih\",\"ii\",\"ij\",\"il\",\"i'll\",\"im\",\"i'm\",\"immediate\",\"immediately\",\"importance\",\"important\",\"in\",\"inasmuch\",\"inc\",\"indeed\",\"index\",\"indicate\",\"indicated\",\"indicates\",\"information\",\"inner\",\"insofar\",\"instead\",\"interest\",\"into\",\"invention\",\"inward\",\"io\",\"ip\",\"iq\",\"ir\",\"is\",\"isn\",\"isn't\",\"it\",\"itd\",\"it'd\",\"it'll\",\"its\",\"it's\",\"itself\",\"iv\",\"i've\",\"ix\",\"iy\",\"iz\",\"j\",\"jj\",\"jr\",\"js\",\"jt\",\"ju\",\"just\",\"k\",\"ke\",\"keep\",\"keeps\",\"kept\",\"kg\",\"kj\",\"km\",\"know\",\"known\",\"knows\",\"ko\",\"l\",\"l2\",\"la\",\"largely\",\"last\",\"lately\",\"later\",\"latter\",\"latterly\",\"lb\",\"lc\",\"le\",\"least\",\"les\",\"less\",\"lest\",\"let\",\"lets\",\"let's\",\"lf\",\"like\",\"liked\",\"likely\",\"line\",\"little\",\"lj\",\"ll\",\"ln\",\"lo\",\"look\",\"looking\",\"looks\",\"los\",\"lr\",\"ls\",\"lt\",\"ltd\",\"m\",\"m2\",\"ma\",\"made\",\"mainly\",\"make\",\"makes\",\"many\",\"may\",\"maybe\",\"me\",\"mean\",\"means\",\"meantime\",\"meanwhile\",\"merely\",\"mg\",\"might\",\"mightn\",\"mightn't\",\"mill\",\"million\",\"mine\",\"miss\",\"ml\",\"mn\",\"mo\",\"more\",\"moreover\",\"most\",\"mostly\",\"move\",\"mr\",\"mrs\",\"ms\",\"mt\",\"mu\",\"much\",\"mug\",\"must\",\"mustn\",\"mustn't\",\"my\",\"myself\",\"model\",\"n\",\"n2\",\"na\",\"name\",\"namely\",\"nay\",\"nc\",\"nd\",\"ne\",\"near\",\"nearly\",\"necessarily\",\"necessary\",\"need\",\"needn\",\"needn't\",\"needs\",\"neither\",\"never\",\"nevertheless\",\"new\",\"next\",\"ng\",\"ni\",\"nine\",\"ninety\",\"nj\",\"nl\",\"nn\",\"no\",\"nobody\",\"non\",\"none\",\"nonetheless\",\"noone\",\"nor\",\"normally\",\"nos\",\"not\",\"noted\",\"nothing\",\"novel\",\"now\",\"nowhere\",\"nr\",\"ns\",\"nt\",\"ny\",\"o\",\"oa\",\"ob\",\"obtain\",\"obtained\",\"obviously\",\"oc\",\"od\",\"of\",\"off\",\"often\",\"og\",\"oh\",\"oi\",\"oj\",\"ok\",\"okay\",\"ol\",\"old\",\"om\",\"omitted\",\"on\",\"once\",\"one\",\"ones\",\"only\",\"onto\",\"oo\",\"op\",\"oq\",\"or\",\"ord\",\"os\",\"ot\",\"other\",\"others\",\"otherwise\",\"ou\",\"ought\",\"our\",\"ours\",\"ourselves\",\"out\",\"outside\",\"over\",\"overall\",\"ow\",\"owing\",\"own\",\"ox\",\"oz\",\"p\",\"p1\",\"p2\",\"p3\",\"page\",\"pagecount\",\"pages\",\"par\",\"part\",\"particular\",\"particularly\",\"pas\",\"past\",\"pc\",\"pd\",\"pe\",\"per\",\"perhaps\",\"pf\",\"ph\",\"pi\",\"pj\",\"pk\",\"pl\",\"placed\",\"please\",\"plus\",\"pm\",\"pn\",\"po\",\"poorly\",\"possible\",\"possibly\",\"potentially\",\"pp\",\"pq\",\"pr\",\"predominantly\",\"present\",\"presumably\",\"previously\",\"primarily\",\"probably\",\"promptly\",\"proud\",\"provides\",\"ps\",\"pt\",\"pu\",\"put\",\"py\",\"q\",\"qj\",\"qu\",\"que\",\"quickly\",\"quite\",\"qv\",\"r\",\"r2\",\"ra\",\"ran\",\"rather\",\"rc\",\"rd\",\"re\",\"readily\",\"really\",\"reasonably\",\"recent\",\"recently\",\"ref\",\"refs\",\"regarding\",\"regardless\",\"regards\",\"related\",\"relatively\",\"research\",\"research-articl\",\"respectively\",\"resulted\",\"resulting\",\"results\",\"rf\",\"rh\",\"ri\",\"right\",\"rj\",\"rl\",\"rm\",\"rn\",\"ro\",\"rq\",\"rr\",\"rs\",\"rt\",\"ru\",\"run\",\"rv\",\"ry\",\"s\",\"s2\",\"sa\",\"said\",\"same\",\"saw\",\"say\",\"saying\",\"says\",\"sc\",\"sd\",\"se\",\"sec\",\"second\",\"secondly\",\"section\",\"see\",\"seeing\",\"seem\",\"seemed\",\"seeming\",\"seems\",\"seen\",\"self\",\"selves\",\"sensible\",\"sent\",\"serious\",\"seriously\",\"seven\",\"several\",\"sf\",\"shall\",\"shan\",\"shan't\",\"she\",\"shed\",\"she'd\",\"she'll\",\"shes\",\"she's\",\"should\",\"shouldn\",\"shouldn't\",\"should've\",\"show\",\"showed\",\"shown\",\"showns\",\"shows\",\"si\",\"side\",\"significant\",\"significantly\",\"similar\",\"similarly\",\"since\",\"sincere\",\"six\",\"sixty\",\"sj\",\"sl\",\"slightly\",\"sm\",\"sn\",\"so\",\"some\",\"somebody\",\"somehow\",\"someone\",\"somethan\",\"something\",\"sometime\",\"sometimes\",\"somewhat\",\"somewhere\",\"soon\",\"sorry\",\"sp\",\"specifically\",\"specified\",\"specify\",\"specifying\",\"sq\",\"sr\",\"ss\",\"st\",\"still\",\"stop\",\"strongly\",\"sub\",\"substantially\",\"successfully\",\"such\",\"sufficiently\",\"suggest\",\"sup\",\"sure\",\"sy\",\"system\",\"sz\",\"t\",\"t1\",\"t2\",\"t3\",\"take\",\"taken\",\"taking\",\"tb\",\"tc\",\"td\",\"te\",\"tell\",\"ten\",\"tends\",\"tf\",\"th\",\"than\",\"thank\",\"thanks\",\"thanx\",\"that\",\"that'll\",\"thats\",\"that's\",\"that've\",\"the\",\"their\",\"theirs\",\"them\",\"themselves\",\"then\",\"thence\",\"there\",\"thereafter\",\"thereby\",\"thered\",\"therefore\",\"therein\",\"there'll\",\"thereof\",\"therere\",\"theres\",\"there's\",\"thereto\",\"thereupon\",\"there've\",\"these\",\"they\",\"theyd\",\"they'd\",\"they'll\",\"theyre\",\"they're\",\"they've\",\"thickv\",\"thin\",\"think\",\"third\",\"this\",\"thorough\",\"thoroughly\",\"those\",\"thou\",\"though\",\"thoughh\",\"thousand\",\"three\",\"throug\",\"through\",\"throughout\",\"thru\",\"thus\",\"ti\",\"til\",\"tip\",\"tj\",\"tl\",\"tm\",\"tn\",\"to\",\"together\",\"too\",\"took\",\"top\",\"toward\",\"towards\",\"tp\",\"tq\",\"tr\",\"tried\",\"tries\",\"truly\",\"try\",\"trying\",\"ts\",\"t's\",\"tt\",\"tv\",\"twelve\",\"twenty\",\"twice\",\"two\",\"tx\",\"u\",\"u201d\",\"ue\",\"ui\",\"uj\",\"uk\",\"um\",\"un\",\"under\",\"unfortunately\",\"unless\",\"unlike\",\"unlikely\",\"until\",\"unto\",\"uo\",\"up\",\"upon\",\"ups\",\"ur\",\"us\",\"use\",\"used\",\"useful\",\"usefully\",\"usefulness\",\"uses\",\"using\",\"usually\",\"ut\",\"v\",\"va\",\"value\",\"various\",\"vd\",\"ve\",\"very\",\"via\",\"viz\",\"vj\",\"vo\",\"vol\",\"vols\",\"volumtype\",\"vq\",\"vs\",\"vt\",\"vu\",\"w\",\"wa\",\"want\",\"wants\",\"was\",\"wasn\",\"wasnt\",\"wasn't\",\"way\",\"we\",\"wed\",\"we'd\",\"welcome\",\"well\",\"we'll\",\"well-b\",\"went\",\"were\",\"we're\",\"weren\",\"werent\",\"weren't\",\"we've\",\"what\",\"whatever\",\"what'll\",\"whats\",\"what's\",\"when\",\"whence\",\"whenever\",\"when's\",\"where\",\"whereafter\",\"whereas\",\"whereby\",\"wherein\",\"wheres\",\"where's\",\"whereupon\",\"wherever\",\"whether\",\"which\",\"while\",\"whim\",\"whither\",\"who\",\"whod\",\"whoever\",\"whole\",\"who'll\",\"whom\",\"whomever\",\"whos\",\"who's\",\"whose\",\"why\",\"why's\",\"wi\",\"widely\",\"will\",\"willing\",\"wish\",\"with\",\"within\",\"without\",\"wo\",\"won\",\"wonder\",\"wont\",\"won't\",\"words\",\"world\",\"would\",\"wouldn\",\"wouldnt\",\"wouldn't\",\"www\",\"x\",\"x1\",\"x2\",\"x3\",\"xf\",\"xi\",\"xj\",\"xk\",\"xl\",\"xn\",\"xo\",\"xs\",\"xt\",\"xv\",\"xx\",\"y\",\"y2\",\"yes\",\"yet\",\"yj\",\"yl\",\"you\",\"youd\",\"you'd\",\"you'll\",\"your\",\"youre\",\"you're\",\"yours\",\"yourself\",\"yourselves\",\"you've\",\"yr\",\"ys\",\"yt\",\"z\",\"zero\",\"zi\",\"zz\",\"task\"]}\n")
    stopwords = _core_get(tables, "stopwords", None)
    exclusions = {}
    for word in stopwords:
        exclusions[word] = True
    empty_token = ""
    exclusions[empty_token] = True
    history_text = _eval_normalize_impl(history, tables)
    history_tokens = _core_string_split(history_text, " ")
    for token in history_tokens:
        exclusions[token] = True
    pred_text = _eval_normalize_impl(prediction, tables)
    truth_text = _eval_normalize_impl(ground_truth, tables)
    pred_tokens = _core_string_split(pred_text, " ")
    truth_tokens = _core_string_split(truth_text, " ")
    pred = {}
    truth = {}
    pred_length = 0
    truth_length = 0
    for token in pred_tokens:
        excluded = _core_get(exclusions, token, False)
        if excluded:
            pass
        else:
            count = _core_get(pred, token, 0)
            count = _core_add(count, 1)
            pred[token] = count
            pred_length = _core_add(pred_length, 1)
    for token in truth_tokens:
        excluded = _core_get(exclusions, token, False)
        if excluded:
            pass
        else:
            count = _core_get(truth, token, 0)
            count = _core_add(count, 1)
            truth[token] = count
            truth_length = _core_add(truth_length, 1)
    pred_empty = _core_eq(pred_length, 0)
    truth_empty = _core_eq(truth_length, 0)
    empty = _core_or(pred_empty, truth_empty)
    if empty:
        both = _core_and(pred_empty, truth_empty)
        if both:
            return 1
        else:
            pass
        return 0
    else:
        pass
    overlap = 0
    keys = _core_map_keys(pred)
    for token in keys:
        p = _core_get(pred, token, 0)
        t = _core_get(truth, token, 0)
        common = p
        smaller = _core_lt(t, p)
        if smaller:
            common = t
        else:
            pass
        overlap = _core_add(overlap, common)
    zero = _core_eq(overlap, 0)
    if zero:
        return 0
    else:
        pass
    recall = _core_div(overlap, truth_length)
    if return_recall:
        return recall
    else:
        pass
    precision = _core_div(overlap, pred_length)
    numerator = _core_mul(precision, recall)
    numerator = _core_mul(numerator, 2)
    denominator = _core_add(precision, recall)
    score = _core_div(numerator, denominator)
    return score


def _serialize_optimized_artifact(artifact: Any) -> str:
    _core_coverage_mark("_serialize_optimized_artifact")
    text = _core_json_stringify(artifact)
    return text


def _stream_is_space_impl(ch: str) -> bool:
    _core_coverage_mark("_stream_is_space_impl")
    empty = _core_eq(ch, "")
    if empty:
        return False
    else:
        pass
    trimmed = str(ch).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    space = _core_eq(trimmed, "")
    return space


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


def _deserialize_optimized_artifact(text: str, components: Any) -> Any:
    _core_coverage_mark("_deserialize_optimized_artifact")
    artifact = _core_json_parse(text)
    validated = _validate_optimized_artifact(artifact, components)
    return validated


def _build_gen_chat_request(gen: AxGen, messages: list[Any], options: Any, selection: Any, step: int) -> AxChatRequest:
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
    caller_choice = _caller_function_call_impl(options)
    forced = _function_call_forces_tool_impl(caller_choice)
    first_step = _core_eq(step, 0)
    later_step = _core_not(first_step)
    forcing_dropped = _core_and(forced, later_step)
    keep_caller_tools = _core_not(forcing_dropped)
    function_specs = []
    if keep_caller_tools:
        for fn in functions:
            spec = _tool_spec_impl(fn)
            function_specs.append(spec)
    else:
        pass
    mode_snake = _core_get(options, "function_call_mode", None)
    mode_raw = _core_get(options, "functionCallMode", mode_snake)
    mode = _function_call_mode_impl(mode_raw)
    request["function_call"] = mode
    has_caller_choice = _core_is_not_none(caller_choice)
    send_caller_choice = _core_and(has_caller_choice, keep_caller_tools)
    if send_caller_choice:
        request["function_call"] = caller_choice
        request["function_call_source"] = "caller"
    else:
        pass
    signature = _core_get(gen, "signature", None)
    output_fields = _core_get(signature, "output_fields", None)
    rung = _core_get(selection, "rung", None)
    fn_count = _core_len(function_specs)
    requires_schema = _core_get(selection, "requires_schema", False)
    no_functions = _core_eq(fn_count, 0)
    omit_function_call = _core_and(requires_schema, no_functions)
    if omit_function_call:
        _core_map_delete(request, "function_call")
    else:
        pass
    use_function = _core_eq(rung, "function")
    if use_function:
        schema_options = {}
        function_schema = _schema_to_json_schema_impl(output_fields, "output", schema_options)
        synthetic = {}
        synthetic["name"] = "__axOutput"
        synthetic["description"] = "Emit the complete structured program output using the declared argument shape."
        synthetic["parameters"] = function_schema
        forcing_now = _core_and(forced, first_step)
        forces_output = _function_call_names_output_impl(caller_choice)
        forces_other = _core_not(forces_output)
        forces_user_tool = _core_and(forcing_now, forces_other)
        has_user_specs = _core_gt(fn_count, 0)
        withhold_output = _core_and(forces_user_tool, has_user_specs)
        offer_output = _core_not(withhold_output)
        if offer_output:
            function_specs.append(synthetic)
        else:
            pass
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
        decisions = _evidence_request_fields_impl(output_fields)
        response_format["decisionFields"] = decisions
        annotations = _signature_output_value_descriptions_impl(output_fields)
        has_annotations = _core_truthy(annotations)
        if has_annotations:
            response_format["fieldDescriptions"] = annotations
        else:
            pass
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
    has_rung = _core_is_not_none(rung)
    if has_rung:
        ax_metadata = {}
        ax_metadata["structured_output_rung"] = rung
        provider_metadata = {}
        provider_metadata["ax"] = ax_metadata
        request["provider_metadata"] = provider_metadata
    else:
        pass
    request["model_config"] = model_config
    request["_ax_step_index"] = step
    return request


def _date_parse_datetime_impl(text: Any) -> Any:
    _core_coverage_mark("_date_parse_datetime_impl")
    units = _core_string_utf16_units(text)
    count = _core_len(units)
    bounds = _date_trim_bounds_impl(units, 0, count)
    start = _core_get(bounds, "start", None)
    end = _core_get(bounds, "end", None)
    offset_millis = _date_parse_offset_datetime_impl(units, start, end)
    matched = _core_is_not_none(offset_millis)
    if matched:
        return offset_millis
    else:
        pass
    named = _date_parse_named_datetime_impl(text, units, start, end)
    return named


def _stream_field_labels_impl(field: Any) -> list[Any]:
    _core_coverage_mark("_stream_field_labels_impl")
    labels = []
    name = _core_get(field, "name", "")
    title = _core_get(field, "title", "")
    has_title = _core_truthy(title)
    if has_title:
        labels.append(title)
    else:
        pass
    has_name = _core_truthy(name)
    same = _core_eq(name, title)
    distinct = _core_not(same)
    add_name = _core_and(has_name, distinct)
    if add_name:
        labels.append(name)
    else:
        pass
    return labels


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


def _chat_session_argument_value_errors(root: Any, schema: Any, arguments: Any, path: str, next_depth: int) -> Any:
    _core_coverage_mark("_chat_session_argument_value_errors")
    errors = []
    empty = {}
    empty_list = []
    field = path
    at_root = _core_eq(path, "")
    if at_root:
        field = "arguments"
    else:
        pass
    actual = "object"
    value_null = _core_is_none(arguments)
    value_list = _core_type_is(arguments, "list")
    value_string = _core_type_is(arguments, "string")
    value_number = _core_type_is(arguments, "number")
    value_boolean = _core_type_is(arguments, "boolean")
    if value_null:
        actual = "null"
    else:
        pass
    if value_list:
        actual = "array"
    else:
        pass
    if value_string:
        actual = "string"
    else:
        pass
    if value_number:
        actual = "number"
    else:
        pass
    if value_boolean:
        actual = "boolean"
    else:
        pass
    declared_type = _core_get(schema, "type", None)
    types = []
    is_union = _core_type_is(declared_type, "list")
    if is_union:
        types = declared_type
    else:
        type_given = _core_truthy(declared_type)
        if type_given:
            types.append(declared_type)
        else:
            pass
    type_count = _core_len(types)
    typed = _core_gt(type_count, 0)
    if typed:
        matches_type = False
        for type in types:
            same_type = _core_eq(type, actual)
            matches_type = _core_or(matches_type, same_type)
            wants_integer = _core_eq(type, "integer")
            integer_check = _core_and(wants_integer, value_number)
            if integer_check:
                finite = _core_math_is_finite(arguments)
                if finite:
                    whole = _core_math_floor(arguments)
                    is_integer = _core_eq(whole, arguments)
                    matches_type = _core_or(matches_type, is_integer)
                else:
                    pass
            else:
                pass
        if matches_type:
            pass
        else:
            type_names = []
            for type_name in types:
                type_text = _core_string_str(type_name)
                type_names.append(type_text)
            joined_types = _core_string_join(" or ", type_names)
            type_message = _core_string_format("Expected {}, received {}", joined_types, actual)
            type_error = {}
            type_error["field"] = field
            type_error["message"] = type_message
            errors.append(type_error)
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
            enum_error = {}
            enum_error["field"] = field
            enum_error["message"] = "Value is not in the allowed enum"
            errors.append(enum_error)
    else:
        pass
    has_const = _core_map_contains(schema, "const")
    if has_const:
        constant = _core_get(schema, "const", None)
        same_const = _chat_session_argument_equal(constant, arguments, 0)
        if same_const:
            pass
        else:
            const_error = {}
            const_error["field"] = field
            const_error["message"] = "Value does not match const"
            errors.append(const_error)
    else:
        pass
    if value_string:
        length = _core_string_codepoint_length(arguments)
        minimum = _core_get(schema, "minLength", 0)
        maximum = _core_get(schema, "maxLength", length)
        too_short = _core_lt(length, minimum)
        too_long = _core_gt(length, maximum)
        if too_short:
            short_error = {}
            short_error["field"] = field
            short_error["message"] = "String is too short"
            errors.append(short_error)
        else:
            pass
        if too_long:
            long_error = {}
            long_error["field"] = field
            long_error["message"] = "String is too long"
            errors.append(long_error)
        else:
            pass
        pattern = _core_get(schema, "pattern", "")
        if pattern:
            pattern_matches = _regex_test(pattern, arguments)
            if pattern_matches:
                pass
            else:
                pattern_error = {}
                pattern_error["field"] = field
                pattern_error["message"] = "String does not match pattern"
                errors.append(pattern_error)
        else:
            pass
    else:
        pass
    if value_number:
        number_finite = _core_math_is_finite(arguments)
        if number_finite:
            pass
        else:
            finite_error = {}
            finite_error["field"] = field
            finite_error["message"] = "Number must be finite"
            errors.append(finite_error)
        number_minimum = _core_get(schema, "minimum", arguments)
        number_maximum = _core_get(schema, "maximum", arguments)
        low = _core_lt(arguments, number_minimum)
        high = _core_gt(arguments, number_maximum)
        if low:
            low_error = {}
            low_error["field"] = field
            low_error["message"] = "Number is below minimum"
            errors.append(low_error)
        else:
            pass
        if high:
            high_error = {}
            high_error["field"] = field
            high_error["message"] = "Number is above maximum"
            errors.append(high_error)
        else:
            pass
    else:
        pass
    if value_list:
        item_count = _core_len(arguments)
        min_items = _core_get(schema, "minItems", 0)
        max_items = _core_get(schema, "maxItems", item_count)
        few = _core_lt(item_count, min_items)
        many = _core_gt(item_count, max_items)
        if few:
            few_error = {}
            few_error["field"] = field
            few_error["message"] = "Too few items"
            errors.append(few_error)
        else:
            pass
        if many:
            many_error = {}
            many_error["field"] = field
            many_error["message"] = "Too many items"
            errors.append(many_error)
        else:
            pass
        items = _core_get(schema, "items", None)
        items_map = _core_type_is(items, "object")
        items_true = _core_eq(items, True)
        has_items = _core_or(items_map, items_true)
        if has_items:
            item_index = 0
            for item in arguments:
                item_path = _core_string_format("{}[{}]", path, item_index)
                item_errors = _chat_session_argument_errors(root, items, item, item_path, next_depth)
                for error in item_errors:
                    errors.append(error)
                item_index = _core_add(item_index, 1)
        else:
            pass
    else:
        pass
    value_object = _core_type_is(arguments, "object")
    if value_object:
        required = _core_get(schema, "required", empty_list)
        required_is_list = _core_type_is(required, "list")
        if required_is_list:
            for name in required:
                present = _core_map_contains(arguments, name)
                if present:
                    pass
                else:
                    required_field = name
                    if at_root:
                        pass
                    else:
                        required_field = _core_string_format("{}.{}", path, name)
                    required_error = {}
                    required_error["field"] = required_field
                    required_error["message"] = "Required argument is missing"
                    errors.append(required_error)
        else:
            pass
        properties = _core_get(schema, "properties", empty)
        additional = _core_get(schema, "additionalProperties", None)
        forbidden = _core_eq(additional, False)
        additional_schema = _core_type_is(additional, "object")
        names = _core_map_keys(arguments)
        for name in names:
            child = _core_get(arguments, name, None)
            properties_map = _core_type_is(properties, "object")
            child_schema = _core_none()
            if properties_map:
                child_schema = _core_get(properties, name, None)
            else:
                pass
            child_map = _core_type_is(child_schema, "object")
            child_true = _core_eq(child_schema, True)
            known = _core_or(child_map, child_true)
            if known:
                child_path = name
                if at_root:
                    pass
                else:
                    child_path = _core_string_format("{}.{}", path, name)
                child_errors = _chat_session_argument_errors(root, child_schema, child, child_path, next_depth)
                for error in child_errors:
                    errors.append(error)
            else:
                if forbidden:
                    unexpected_message = _core_string_format("Unexpected property: {}", name)
                    unexpected = {}
                    unexpected["field"] = field
                    unexpected["message"] = unexpected_message
                    errors.append(unexpected)
                else:
                    if additional_schema:
                        extra_path = _core_string_format("{}.{}", path, name)
                        extra_errors = _chat_session_argument_errors(root, additional, child, extra_path, next_depth)
                        for error in extra_errors:
                            errors.append(error)
                    else:
                        pass
    else:
        pass
    return errors


def _date_parse_offset_datetime_impl(units: Any, start: Any, end: Any) -> Any:
    _core_coverage_mark("_date_parse_offset_datetime_impl")
    none = _core_none()
    prefix = _date_scan_datetime_impl(units, start, end)
    no_prefix = _core_is_none(prefix)
    if no_prefix:
        return none
    else:
        pass
    cursor = _core_get(prefix, "end", None)
    zone_start = _date_skip_space_impl(units, cursor, end)
    zone_ok = _date_offset_zone_matches_impl(units, zone_start, end)
    zone_bad = _core_not(zone_ok)
    if zone_bad:
        return none
    else:
        pass
    offset = _date_offset_minutes_impl(units, zone_start, end)
    no_offset = _core_is_none(offset)
    if no_offset:
        format_error = _date_datetime_format_error_impl()
        raise format_error
    else:
        pass
    parts = _date_datetime_parts_impl(prefix)
    local = _date_utc_ms_impl(parts)
    shift = _core_mul(offset, -60000)
    millis = _core_add(local, shift)
    return millis


def _stream_matches_content_impl(content: str, prefix: str, start: int) -> i64:
    _core_coverage_mark("_stream_matches_content_impl")
    fence = _core_regex_match("^```[a-zA-Z]*\\s*$", content)
    if fence:
        return -4
    else:
        pass
    blank = _core_regex_match("^[\\s`]*$", content)
    if blank:
        return -3
    else:
        pass
    exact = _core_string_index_of(content, prefix, start)
    found = _core_gte(exact, 0)
    if found:
        return exact
    else:
        pass
    size = _core_len(prefix)
    while True:
        exhausted = _core_lte(size, 0)
        if exhausted:
            break
        else:
            pass
        partial = _core_string_slice(prefix, 0, size)
        ends = _core_string_ends_with(content, partial)
        if ends:
            return -2
        else:
            pass
        size = _core_add(size, -1)
    return -1


def _optimization_component_current_map(components: Any) -> Any:
    _core_coverage_mark("_optimization_component_current_map")
    out = {}
    for component in components:
        id = _core_get(component, "id", "")
        current = _core_get(component, "current", None)
        out[id] = current
    return out


def _eval_ascii_word_impl(cp: Any) -> bool:
    _core_coverage_mark("_eval_ascii_word_impl")
    digit_low = _core_gte(cp, 48)
    digit_high = _core_lte(cp, 57)
    digit = _core_and(digit_low, digit_high)
    upper_low = _core_gte(cp, 65)
    upper_high = _core_lte(cp, 90)
    upper = _core_and(upper_low, upper_high)
    lower_low = _core_gte(cp, 97)
    lower_high = _core_lte(cp, 122)
    lower = _core_and(lower_low, lower_high)
    under = _core_eq(cp, 95)
    word = _core_or(digit, upper)
    word = _core_or(word, lower)
    word = _core_or(word, under)
    return word


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


def _date_parse_named_datetime_impl(text: Any, units: Any, start: Any, end: Any) -> Any:
    _core_coverage_mark("_date_parse_named_datetime_impl")
    format_error = _date_datetime_format_error_impl()
    prefix = _date_scan_datetime_impl(units, start, end)
    no_prefix = _core_is_none(prefix)
    if no_prefix:
        raise format_error
    else:
        pass
    cursor = _core_get(prefix, "end", None)
    zone_start = _date_skip_space_impl(units, cursor, end)
    no_space = _core_eq(zone_start, cursor)
    if no_space:
        raise format_error
    else:
        pass
    empty_zone = _core_gte(zone_start, end)
    if empty_zone:
        raise format_error
    else:
        pass
    scan = zone_start
    while True:
        scan_done = _core_gte(scan, end)
        if scan_done:
            break
        else:
            pass
        unit = _core_get(units, scan, 0)
        terminator = _date_is_line_terminator_impl(unit)
        if terminator:
            raise format_error
        else:
            pass
        scan = _core_add(scan, 1)
    mode = _date_string_mode_impl()
    zone_from = _date_native_offset_impl(units, zone_start, mode)
    zone_to = _date_native_offset_impl(units, end, mode)
    zone = _core_string_slice(text, zone_from, zone_to)
    offset = _date_offset_minutes_impl(units, zone_start, end)
    parts = _date_datetime_parts_impl(prefix)
    local = _date_utc_ms_impl(parts)
    has_offset = _core_is_not_none(offset)
    if has_offset:
        shift = _core_mul(offset, -60000)
        offset_millis = _core_add(local, shift)
        return offset_millis
    else:
        pass
    abbreviation = _date_abbreviation_offset_impl(units, zone_start, end, zone)
    has_abbreviation = _core_is_not_none(abbreviation)
    if has_abbreviation:
        abbreviation_shift = _core_mul(abbreviation, -60000)
        abbreviation_millis = _core_add(local, abbreviation_shift)
        return abbreviation_millis
    else:
        pass
    resolved = _date_zone_resolve_impl(units, zone_start, end, zone, local)
    millis = _date_named_timestamp_impl(parts, resolved)
    return millis


def _stream_extract_block_impl(input: str) -> str:
    _core_coverage_mark("_stream_extract_block_impl")
    open = _core_string_index_of(input, "```", 0)
    no_open = _core_lt(open, 0)
    if no_open:
        return input
    else:
        pass
    length = _core_len(input)
    cursor = _core_add(open, 3)
    while True:
        at_end = _core_gte(cursor, length)
        if at_end:
            break
        else:
            pass
        next = _core_add(cursor, 1)
        ch = _core_string_slice(input, cursor, next)
        letter = _core_regex_match("^[A-Za-z]$", ch)
        not_letter = _core_not(letter)
        if not_letter:
            break
        else:
            pass
        cursor = next
    while True:
        at_end = _core_gte(cursor, length)
        if at_end:
            break
        else:
            pass
        next = _core_add(cursor, 1)
        ch = _core_string_slice(input, cursor, next)
        space = _stream_is_space_impl(ch)
        not_space = _core_not(space)
        if not_space:
            break
        else:
            pass
        cursor = next
    close = _core_string_index_of(input, "```", cursor)
    no_close = _core_lt(close, 0)
    if no_close:
        return input
    else:
        pass
    inner = _core_string_slice(input, cursor, close)
    block = _stream_trim_end_impl(inner)
    return block


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


def _scalarize_optimization_scores(scores: Any, options: Any) -> f64:
    _core_coverage_mark("_scalarize_optimization_scores")
    metric_key_snake = _core_get(options, "pareto_metric_key", "")
    metric_key = _core_get(options, "paretoMetricKey", metric_key_snake)
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


def _stream_strip_leading_fence_impl(text: str) -> str:
    _core_coverage_mark("_stream_strip_leading_fence_impl")
    length = _core_len(text)
    cursor = 0
    while True:
        at_end = _core_gte(cursor, length)
        if at_end:
            break
        else:
            pass
        next = _core_add(cursor, 1)
        ch = _core_string_slice(text, cursor, next)
        is_blank = _core_eq(ch, " ")
        not_blank = _core_not(is_blank)
        if not_blank:
            break
        else:
            pass
        cursor = next
    rest = _core_string_slice(text, cursor)
    fenced = _core_string_starts_with(rest, "```")
    not_fenced = _core_not(fenced)
    if not_fenced:
        return text
    else:
        pass
    cursor = _core_add(cursor, 3)
    while True:
        at_end = _core_gte(cursor, length)
        if at_end:
            break
        else:
            pass
        next = _core_add(cursor, 1)
        ch = _core_string_slice(text, cursor, next)
        word = _core_regex_match("^[a-zA-Z0-9]$", ch)
        not_word = _core_not(word)
        if not_word:
            break
        else:
            pass
        cursor = next
    after = _core_add(cursor, 1)
    newline = _core_string_slice(text, cursor, after)
    has_newline = _core_eq(newline, "\n")
    no_newline = _core_not(has_newline)
    if no_newline:
        return text
    else:
        pass
    tail = _core_string_slice(text, after)
    stripped = _stream_trim_start_impl(tail)
    return stripped


def _gepa_baseline_report(evaluation: Any, options: Any) -> Any:
    _core_coverage_mark("_gepa_baseline_report")
    empty = []
    rows = _core_get(evaluation, "rows", empty)
    sums = {}
    counts = {}
    for row in rows:
        raw = _core_get(row, "scores", 0)
        scores = _normalize_optimization_metric_scores(raw)
        keys = _core_map_keys(scores)
        for key in keys:
            value = _core_get(scores, key, None)
            number = _core_type_is(value, "number")
            if number:
                sum = _core_get(sums, key, 0)
                count = _core_get(counts, key, 0)
                sum_next = _core_add(sum, value)
                count_next = _core_add(count, 1)
                sums[key] = sum_next
                counts[key] = count_next
            else:
                pass
    averages = {}
    objective_keys = _core_map_keys(sums)
    for objective in objective_keys:
        total = _core_get(sums, objective, None)
        n = _core_get(counts, objective, None)
        average = _core_div(total, n)
        averages[objective] = average
    scalar = _scalarize_optimization_scores(averages, options)
    out = {}
    out["baselineScores"] = averages
    out["baselineScore"] = scalar
    return out


def _date_datetime_format_error_impl() -> Any:
    _core_coverage_mark("_date_datetime_format_error_impl")
    error = _core_runtime_error("Invalid date and time format. Use ISO 8601 like \"YYYY-MM-DDTHH:mm:ssZ\" or \"YYYY-MM-DDTHH:mm:ss+05:30\". Legacy \"YYYY-MM-DD HH:mm Timezone\" values are also accepted.")
    return error


def _date_values_error_impl() -> Any:
    _core_coverage_mark("_date_values_error_impl")
    error = _core_runtime_error("Invalid date and time values. Please ensure all components are correct.")
    return error


def _date_datetime_parts_impl(prefix: Any) -> Any:
    _core_coverage_mark("_date_datetime_parts_impl")
    parts = {}
    year = _core_get(prefix, "year", None)
    parts["year"] = year
    month = _core_get(prefix, "month", None)
    parts["month"] = month
    day = _core_get(prefix, "day", None)
    parts["day"] = day
    hour = _core_get(prefix, "hour", None)
    parts["hour"] = hour
    minute = _core_get(prefix, "minute", None)
    parts["minute"] = minute
    second = _core_get(prefix, "second", None)
    parts["second"] = second
    millisecond = _core_get(prefix, "millisecond", None)
    parts["millisecond"] = millisecond
    bad_hour = _core_gt(hour, 23)
    bad_minute = _core_gt(minute, 59)
    bad_second = _core_gt(second, 59)
    bad_clock = _core_or(bad_hour, bad_minute)
    bad_clock = _core_or(bad_clock, bad_second)
    if bad_clock:
        clock_error = _date_values_error_impl()
        raise clock_error
    else:
        pass
    millis = _date_utc_ms_impl(parts)
    round = _date_parts_of_ms_impl(millis)
    same = _date_same_parts_impl(round, parts)
    different = _core_not(same)
    if different:
        calendar_error = _date_values_error_impl()
        raise calendar_error
    else:
        pass
    return parts


def _optimization_bootstrap_demo(row: Any) -> Any:
    _core_coverage_mark("_optimization_bootstrap_demo")
    empty = {}
    task = _core_get(row, "input", empty)
    input = _core_get(task, "input", task)
    prediction = _core_get(row, "prediction", empty)
    output_fallback = _core_get(prediction, "output", prediction)
    output = _core_get(prediction, "finalOutput", output_fallback)
    trace = _core_map_merge(input, output)
    traces = []
    traces.append(trace)
    demo = {}
    demo["programId"] = "root"
    demo["traces"] = traces
    return demo


def _evidence_decode_one_impl(typ: FieldType, raw: Any, context: Any, path: str) -> Any:
    _core_coverage_mark("_evidence_decode_one_impl")
    object = _core_type_is(raw, "object")
    invalid = _core_not(object)
    if invalid:
        error = _core_validation_error("Decision evidence must be an object")
        raise error
    else:
        pass
    name = _core_get(typ, "name", None)
    evidence = _core_get(typ, "evidence", None)
    box = _core_eq(name, "box")
    plain = _core_is_none(evidence)
    plain_box = _core_and(box, plain)
    if plain_box:
        value = _box_validate_impl(raw, path)
        return value
    else:
        pass
    provenance = _core_get(context, "provenance", None)
    source = _core_get(provenance, "source", "elicited")
    native_state = _core_eq(source, "native")
    native_answers = _core_get(context, "native", None)
    answer = _core_get(native_answers, path, None)
    status = _core_get(raw, "status", None)
    missing_native = _core_is_none(answer)
    missing_native = _core_and(native_state, missing_native)
    if missing_native:
        error = _core_validation_error("Missing native decision")
        raise error
    else:
        pass
    refused = _core_eq(status, "refused")
    if native_state:
        refused = _core_get(answer, "refused", False)
    else:
        pass
    policy = _core_get(evidence, "onRefusal", "throw")
    return_policy = _core_eq(policy, "return")
    keys = _core_map_keys(raw)
    if refused:
        key_count = _core_len(keys)
        valid_shape = _core_eq(key_count, 1)
        valid_status = _core_eq(status, "refused")
        valid_shape = _core_and(valid_shape, valid_status)
        invalid_shape = _core_not(valid_shape)
        if invalid_shape:
            error = _core_validation_error("Invalid refusal evidence shape")
            raise error
        else:
            pass
        throw_policy = _core_not(return_policy)
        if throw_policy:
            error = _core_decision_refusal_error(path, provenance)
            raise error
        else:
            pass
        out = {}
        out["status"] = "refused"
        out["provenance"] = provenance
        return out
    else:
        pass
    elicited = _core_not(native_state)
    require_status = _core_and(return_policy, elicited)
    answered_status = _core_eq(status, "answered")
    invalid_status = _core_not(answered_status)
    invalid_status = _core_and(require_status, invalid_status)
    if invalid_status:
        error = _core_validation_error("Invalid decision evidence status")
        raise error
    else:
        pass
    is_boolean = _core_eq(name, "boolean")
    score = _core_eq(name, "score")
    allowed = []
    if box:
        allowed.append("box")
    else:
        if is_boolean:
            allowed.append("probability")
        else:
            allowed.append("probabilities")
    if return_policy:
        allowed.append("status")
    else:
        pass
    for key in keys:
        known = _core_contains(allowed, key)
        unknown = _core_not(known)
        if unknown:
            error = _core_validation_error("Unexpected decision evidence key")
            raise error
        else:
            pass
    out = {}
    out["provenance"] = provenance
    if box:
        raw_box = _core_get(raw, "box", None)
        value = _box_validate_impl(raw_box, path)
        out["value"] = value
        confidence = _core_get(answer, "confidence", None)
        present = _core_is_not_none(confidence)
        copy = _core_and(native_state, present)
        if copy:
            confidence = _evidence_probability_impl(confidence, path)
            out["confidence"] = confidence
        else:
            pass
    else:
        if is_boolean:
            p = _core_get(raw, "probability", None)
            p = _evidence_probability_impl(p, path)
            threshold = _core_get(evidence, "threshold", 0.5)
            value = _core_gte(p, threshold)
            out["value"] = value
            out["probability"] = p
            out["threshold"] = threshold
        else:
            labels = _core_get(typ, "options", None)
            ps = _core_get(raw, "probabilities", None)
            valid_distribution = _core_type_is(ps, "object")
            if score:
                valid_distribution = _core_type_is(ps, "list")
            else:
                pass
            invalid_distribution = _core_not(valid_distribution)
            if invalid_distribution:
                error = _core_validation_error("Invalid decision distribution shape")
                raise error
            else:
                pass
            count = _core_len(labels)
            actual = _core_len(ps)
            wrong_count = _core_ne(count, actual)
            if wrong_count:
                error = _core_validation_error("Decision probabilities must cover exactly their declared options")
                raise error
            else:
                pass
            sum = 0
            mean = 0
            maximum = -1
            choice = ""
            index = 0
            for label in labels:
                p = _core_get(ps, label, None)
                if score:
                    p = _core_list_get(ps, index)
                else:
                    pass
                p = _evidence_probability_impl(p, path)
                sum = _core_add(sum, p)
                part = _core_mul(index, p)
                mean = _core_add(mean, part)
                larger = _core_gt(p, maximum)
                if larger:
                    choice = label
                    maximum = p
                else:
                    pass
                index = _core_add(index, 1)
            difference = _core_add(sum, -1)
            low = _core_lt(difference, -0.01000000000001)
            high = _core_gt(difference, 0.01000000000001)
            bad_sum = _core_or(low, high)
            if bad_sum:
                error = _core_validation_error("Decision probabilities must sum to one")
                raise error
            else:
                pass
            value = choice
            if score:
                value = _core_div(mean, sum)
            else:
                pass
            if native_state:
                value = _core_get(answer, "value", None)
            else:
                pass
            valid_value = _core_contains(labels, value)
            if score:
                valid_value = _core_type_is(value, "number")
                if valid_value:
                    finite = _core_math_is_finite(value)
                    low = _core_gte(value, 0)
                    maximum_score = _core_add(count, -1)
                    high = _core_lte(value, maximum_score)
                    valid_value = _core_and(low, high)
                    valid_value = _core_and(valid_value, finite)
                else:
                    pass
            else:
                pass
            invalid_value = _core_not(valid_value)
            if invalid_value:
                error = _core_validation_error("Invalid decision value")
                raise error
            else:
                pass
            has_evidence = _core_is_not_none(evidence)
            plain_score = _core_not(has_evidence)
            plain_score = _core_and(score, plain_score)
            if plain_score:
                return value
            else:
                pass
            out["value"] = value
            out["probabilities"] = ps
            if score:
                out["levels"] = labels
            else:
                pass
            confidence = _core_get(answer, "confidence", None)
            has_confidence = _core_is_not_none(confidence)
            copy_confidence = _core_and(native_state, has_confidence)
            if copy_confidence:
                confidence = _evidence_probability_impl(confidence, path)
                out["confidence"] = confidence
            else:
                pass
    if return_policy:
        out["status"] = "answered"
    else:
        pass
    return out


def _stream_strip_trailing_fence_impl(text: str) -> str:
    _core_coverage_mark("_stream_strip_trailing_fence_impl")
    trimmed = _stream_trim_end_impl(text)
    fenced = _core_string_ends_with(trimmed, "```")
    not_fenced = _core_not(fenced)
    if not_fenced:
        return text
    else:
        pass
    length = _core_len(trimmed)
    end = _core_add(length, -3)
    body = _core_string_slice(trimmed, 0, end)
    out = _stream_trim_end_impl(body)
    return out


def _parse_sample_outputs(gen: AxGen, output_fields: list[Any], response: Any, validate_exact_json: bool, thought_field: str, thought_prefix: str, text_contract: bool, strict_mode: bool, parse_state: Any) -> Any:
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
    feedback = []
    position = 0
    for completion in completions:
        content = _core_get(completion, "content", "")
        output = {}
        extracted = False
        if text_contract:
            text_parsed = _parse_text_contract_output_impl(content, output_fields, strict_mode)
            output = _core_get(text_parsed, "values", None)
            extracted = _core_get(text_parsed, "extracted", False)
        else:
            if validate_exact_json:
                strict_parsed = False
                try:
                    output = _parse_output_impl(content)
                    strict_parsed = True
                except Exception as strict_parse_error:
                    pass
                strict_failed = _core_not(strict_parsed)
                if strict_failed:
                    strict_error = _core_validation_error("Structured output must be one JSON object with no prose or Markdown fences.")
                    raise strict_error
                else:
                    pass
            else:
                output = _parse_output_fields_impl(content, output_fields)
        if validate_exact_json:
            _validate_exact_output_keys(output_fields, output, "output")
        else:
            pass
        validated = output
        not_extracted = _core_not(extracted)
        if not_extracted:
            recovered = _parse_json_string_fields(output_fields, output)
            validated = _stream_json_validate_output_impl(output_fields, recovered)
        else:
            pass
        decision_context = _evidence_context_impl(completion, gen)
        validated = _evidence_decode_values_impl(output_fields, validated, decision_context, "")
        parse_state["parsed"] = True
        processor_state = {}
        processor_state["values"] = validated
        sample_feedback = _stream_run_processors_impl(gen, "feedback", processor_state, content, True)
        processor_failure = _core_get(processor_state, "fatal_error", None)
        processor_failed = _core_is_not_none(processor_failure)
        if processor_failed:
            processor_bundle = {}
            processor_bundle["assertion_failure"] = processor_failure
            return processor_bundle
        else:
            pass
        for feedback_text in sample_feedback:
            feedback.append(feedback_text)
        processed = _apply_field_processors(gen, validated)
        assertion_failure = _run_assertions(gen, processed)
        assertion_failed = _core_is_not_none(assertion_failure)
        if assertion_failed:
            failure_bundle = {}
            failure_bundle["assertion_failure"] = assertion_failure
            return failure_bundle
        else:
            pass
        stripped_output = strip_internal(output_fields, processed)
        sample_thought = _core_get(completion, "thought", "")
        public_output = _with_output_thought_impl(stripped_output, thought_field, thought_prefix, sample_thought)
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
    bundle["feedback"] = feedback
    return bundle


def _gepa_pareto_set_size(options: Any) -> i64:
    _core_coverage_mark("_gepa_pareto_set_size")
    snake = _core_get(options, "pareto_set_size", 0)
    size = _core_get(options, "paretoSetSize", snake)
    explicit = _core_gt(size, 0)
    if explicit:
        rounded = _core_math_floor(size)
        small = _core_lt(rounded, 5)
        if small:
            return 5
        else:
            pass
        large = _core_gt(rounded, 1000)
        if large:
            return 1000
        else:
            pass
        return rounded
    else:
        pass
    mini_snake = _core_get(options, "minibatch_size", 20)
    mini = _core_get(options, "minibatchSize", mini_snake)
    default_size = _core_mul(mini, 3)
    too_small = _core_lt(default_size, 10)
    if too_small:
        return 10
    else:
        pass
    too_large = _core_gt(default_size, 200)
    if too_large:
        return 200
    else:
        pass
    return default_size


def _date_abbreviation_offset_impl(units: Any, start: Any, end: Any, zone: Any) -> Any:
    _core_coverage_mark("_date_abbreviation_offset_impl")
    none = _core_none()
    cursor = start
    while True:
        done = _core_gte(cursor, end)
        if done:
            break
        else:
            pass
        unit = _core_get(units, cursor, 0)
        letter = _date_ascii_letter_impl(unit)
        not_letter = _core_not(letter)
        if not_letter:
            return none
        else:
            pass
        cursor = _core_add(cursor, 1)
    key = _core_string_lower(zone)
    tables = _core_json_parse("{\n  \"generator\": \"tools/axir/extractors/date-goldens.ts\",\n  \"source\": \"src/ax/dsp/datetime.ts\",\n  \"offsets_minutes\": {\n    \"ACDT\": 630,\n    \"ACST\": 570,\n    \"ADT\": -180,\n    \"AEDT\": 660,\n    \"AEST\": 600,\n    \"AKDT\": -480,\n    \"AKST\": -540,\n    \"ART\": -180,\n    \"AWST\": 480,\n    \"BRT\": -180,\n    \"CAT\": 120,\n    \"CDT\": -300,\n    \"CEST\": 120,\n    \"CET\": 60,\n    \"EAT\": 180,\n    \"EDT\": -240,\n    \"EEST\": 180,\n    \"EET\": 120,\n    \"EST\": -300,\n    \"HDT\": -540,\n    \"HKT\": 480,\n    \"HST\": -600,\n    \"JST\": 540,\n    \"KST\": 540,\n    \"MDT\": -360,\n    \"MSK\": 180,\n    \"MST\": -420,\n    \"NDT\": -150,\n    \"NPT\": 345,\n    \"NZDT\": 780,\n    \"NZST\": 720,\n    \"PDT\": -420,\n    \"PKT\": 300,\n    \"PST\": -480,\n    \"SAST\": 120,\n    \"SGT\": 480,\n    \"WAT\": 60,\n    \"WEST\": 60,\n    \"WET\": 0,\n    \"WIB\": 420\n  },\n  \"rejected\": [\n    \"ACT\",\n    \"AET\",\n    \"AGT\",\n    \"AST\",\n    \"BET\",\n    \"BST\",\n    \"CNT\",\n    \"CST\",\n    \"CTT\",\n    \"ECT\",\n    \"GST\",\n    \"IET\",\n    \"IST\",\n    \"MIT\",\n    \"NET\",\n    \"NST\",\n    \"PLT\",\n    \"PNT\",\n    \"PRT\",\n    \"SST\",\n    \"VST\"\n  ]\n}\n")
    empty_offsets = {}
    offsets = _core_get(tables, "offsets_minutes", empty_offsets)
    abbreviations = _core_map_keys(offsets)
    for abbreviation in abbreviations:
        lowered = _core_string_lower(abbreviation)
        same = _core_eq(lowered, key)
        if same:
            minutes = _core_get(offsets, abbreviation, None)
            return minutes
        else:
            pass
    empty_rejected = []
    rejected = _core_get(tables, "rejected", empty_rejected)
    for rejected_abbreviation in rejected:
        rejected_lowered = _core_string_lower(rejected_abbreviation)
        is_rejected = _core_eq(rejected_lowered, key)
        if is_rejected:
            message_pieces = []
            message_pieces.append("Ambiguous or unsupported time zone abbreviation \"")
            message_pieces.append(zone)
            message_pieces.append("\". Please provide an IANA time zone name or a UTC offset. For example, \"Europe/London\" or \"+01:00\".")
            message = _core_string_join("", message_pieces)
            error = _core_runtime_error(message)
            raise error
        else:
            pass
    return none


def _stream_markdown_list_impl(input: str) -> list[Any]:
    _core_coverage_mark("_stream_markdown_list_impl")
    items = []
    blank = str(input).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    is_blank = _core_eq(blank, "")
    if is_blank:
        return items
    else:
        pass
    lines = _core_string_split(input, "\n")
    for line in lines:
        text = str(line).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        empty = _core_eq(text, "")
        if empty:
            continue
        else:
            pass
        first = _core_string_slice(text, 0, 1)
        bullet = _core_regex_match("^[-*+]$", first)
        if bullet:
            rest = _core_string_slice(text, 1)
            item = str(rest).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
            items.append(item)
            continue
        else:
            pass
        numbered = _core_regex_match("^[0-9]+\\s*[.)\\]]", text)
        if numbered:
            length = _core_len(text)
            cursor = 0
            while True:
                next = _core_add(cursor, 1)
                ch = _core_string_slice(text, cursor, next)
                digit = _core_regex_match("^[0-9]$", ch)
                not_digit = _core_not(digit)
                if not_digit:
                    break
                else:
                    pass
                cursor = next
            while True:
                next = _core_add(cursor, 1)
                ch = _core_string_slice(text, cursor, next)
                space = _stream_is_space_impl(ch)
                not_space = _core_not(space)
                if not_space:
                    break
                else:
                    pass
                cursor = next
            marker_end = _core_add(cursor, 1)
            rest = _core_string_slice(text, marker_end)
            item = str(rest).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
            items.append(item)
            continue
        else:
            pass
        count = _core_len(items)
        started = _core_gt(count, 0)
        if started:
            mixed = _core_runtime_error("Could not parse markdown list: mixed content detected")
            raise mixed
        else:
            pass
    found = _core_len(items)
    none_found = _core_eq(found, 0)
    if none_found:
        missing = _core_runtime_error("Could not parse markdown list: no valid list items found")
        raise missing
    else:
        pass
    return items


def _gepa_helper_metric_budget(options: Any, validation_count: int, bootstrap: bool) -> i64:
    _core_coverage_mark("_gepa_helper_metric_budget")
    none = _core_none()
    snake = _core_get(options, "max_metric_calls", none)
    explicit = _core_get(options, "maxMetricCalls", snake)
    supplied = _core_is_not_none(explicit)
    if supplied:
        return explicit
    else:
        pass
    cap = _gepa_pareto_set_size(options)
    count = validation_count
    capped = _core_gt(count, cap)
    if capped:
        count = cap
    else:
        pass
    if bootstrap:
        count = _core_mul(count, 2)
    else:
        pass
    minimum = _core_lt(count, 100)
    if minimum:
        return 100
    else:
        pass
    return count


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


def _date_zone_resolve_impl(units: Any, start: Any, end: Any, zone: Any, probe: Any) -> Any:
    _core_coverage_mark("_date_zone_resolve_impl")
    resolved = {}
    fixed = _date_offset_zone_minutes_impl(units, start, end)
    is_fixed = _core_is_not_none(fixed)
    if is_fixed:
        resolved["kind"] = "fixed"
        fixed_seconds = _core_mul(fixed, 60)
        resolved["offset_seconds"] = fixed_seconds
        return resolved
    else:
        pass
    unrecognized_pieces = []
    unrecognized_pieces.append("Unrecognized time zone ")
    unrecognized_pieces.append(zone)
    unrecognized_pieces.append(". Please provide a valid time zone name, abbreviation, or offset. For example, \"America/New_York\", \"EST\", or \"+05:30\".")
    unrecognized = _core_string_join("", unrecognized_pieces)
    cursor = start
    while True:
        done = _core_gte(cursor, end)
        if done:
            break
        else:
            pass
        unit = _core_get(units, cursor, 0)
        non_ascii = _core_gt(unit, 127)
        if non_ascii:
            non_ascii_error = _core_runtime_error(unrecognized)
            raise non_ascii_error
        else:
            pass
        cursor = _core_add(cursor, 1)
    key = _core_string_lower(zone)
    table = _core_json_parse("{\"generator\":\"tools/axir/extractors/date-goldens.ts\",\"source\":{\"node\":\"v26.7.0\",\"icu\":\"78.3\",\"tz\":\"2026a\",\"tzdata_candidates\":\"2026b-rearguard\"},\"keys\":{\"africa/abidjan\":0,\"africa/accra\":1,\"africa/addis_ababa\":2,\"africa/algiers\":3,\"africa/asmera\":4,\"africa/asmara\":4,\"africa/bamako\":5,\"africa/timbuktu\":5,\"africa/bangui\":6,\"africa/banjul\":7,\"africa/bissau\":8,\"africa/blantyre\":9,\"africa/brazzaville\":10,\"africa/bujumbura\":11,\"africa/cairo\":12,\"egypt\":12,\"africa/casablanca\":13,\"africa/ceuta\":14,\"africa/conakry\":15,\"africa/dakar\":16,\"africa/dar_es_salaam\":17,\"africa/djibouti\":18,\"africa/douala\":19,\"africa/el_aaiun\":20,\"africa/freetown\":21,\"africa/gaborone\":22,\"africa/harare\":23,\"africa/johannesburg\":24,\"africa/juba\":25,\"africa/kampala\":26,\"africa/khartoum\":27,\"africa/kigali\":28,\"africa/kinshasa\":29,\"africa/lagos\":30,\"africa/libreville\":31,\"africa/lome\":32,\"africa/luanda\":33,\"africa/lubumbashi\":34,\"africa/lusaka\":35,\"africa/malabo\":36,\"africa/maputo\":37,\"africa/maseru\":38,\"africa/mbabane\":39,\"africa/mogadishu\":40,\"africa/monrovia\":41,\"africa/nairobi\":42,\"africa/ndjamena\":43,\"africa/niamey\":44,\"africa/nouakchott\":45,\"africa/ouagadougou\":46,\"africa/porto-novo\":47,\"africa/sao_tome\":48,\"africa/tripoli\":49,\"libya\":49,\"africa/tunis\":50,\"africa/windhoek\":51,\"america/adak\":52,\"america/atka\":52,\"us/aleutian\":52,\"america/anchorage\":53,\"us/alaska\":53,\"america/anguilla\":54,\"america/antigua\":55,\"america/araguaina\":56,\"america/argentina/la_rioja\":57,\"america/argentina/rio_gallegos\":58,\"america/argentina/salta\":59,\"america/argentina/san_juan\":60,\"america/argentina/san_luis\":61,\"america/argentina/tucuman\":62,\"america/argentina/ushuaia\":63,\"america/aruba\":64,\"america/asuncion\":65,\"america/bahia\":66,\"america/bahia_banderas\":67,\"america/barbados\":68,\"america/belem\":69,\"america/belize\":70,\"america/blanc-sablon\":71,\"america/boa_vista\":72,\"america/bogota\":73,\"america/boise\":74,\"america/buenos_aires\":75,\"america/argentina/buenos_aires\":75,\"america/cambridge_bay\":76,\"america/campo_grande\":77,\"america/cancun\":78,\"america/caracas\":79,\"america/catamarca\":80,\"america/argentina/catamarca\":80,\"america/argentina/comodrivadavia\":80,\"america/cayenne\":81,\"america/cayman\":82,\"america/chicago\":83,\"cst6cdt\":83,\"us/central\":83,\"america/chihuahua\":84,\"america/ciudad_juarez\":85,\"america/coral_harbour\":86,\"america/atikokan\":86,\"america/cordoba\":87,\"america/argentina/cordoba\":87,\"america/rosario\":87,\"america/costa_rica\":88,\"america/coyhaique\":89,\"america/creston\":90,\"america/cuiaba\":91,\"america/curacao\":92,\"america/danmarkshavn\":93,\"america/dawson\":94,\"america/dawson_creek\":95,\"america/denver\":96,\"america/shiprock\":96,\"mst7mdt\":96,\"navajo\":96,\"us/mountain\":96,\"america/detroit\":97,\"us/michigan\":97,\"america/dominica\":98,\"america/edmonton\":99,\"america/yellowknife\":99,\"canada/mountain\":99,\"america/eirunepe\":100,\"america/el_salvador\":101,\"america/fort_nelson\":102,\"america/fortaleza\":103,\"america/glace_bay\":104,\"america/godthab\":105,\"america/nuuk\":105,\"america/goose_bay\":106,\"america/grand_turk\":107,\"america/grenada\":108,\"america/guadeloupe\":109,\"america/guatemala\":110,\"america/guayaquil\":111,\"america/guyana\":112,\"america/halifax\":113,\"canada/atlantic\":113,\"america/havana\":114,\"cuba\":114,\"america/hermosillo\":115,\"america/indiana/knox\":116,\"america/knox_in\":116,\"us/indiana-starke\":116,\"america/indiana/marengo\":117,\"america/indiana/petersburg\":118,\"america/indiana/tell_city\":119,\"america/indiana/vevay\":120,\"america/indiana/vincennes\":121,\"america/indiana/winamac\":122,\"america/indianapolis\":123,\"america/fort_wayne\":123,\"america/indiana/indianapolis\":123,\"us/east-indiana\":123,\"america/inuvik\":124,\"america/iqaluit\":125,\"america/pangnirtung\":125,\"america/jamaica\":126,\"jamaica\":126,\"america/jujuy\":127,\"america/argentina/jujuy\":127,\"america/juneau\":128,\"america/kentucky/monticello\":129,\"america/kralendijk\":130,\"america/la_paz\":131,\"america/lima\":132,\"america/los_angeles\":133,\"pst8pdt\":133,\"us/pacific\":133,\"us/pacific-new\":133,\"america/louisville\":134,\"america/kentucky/louisville\":134,\"america/lower_princes\":135,\"america/maceio\":136,\"america/managua\":137,\"america/manaus\":138,\"brazil/west\":138,\"america/marigot\":139,\"america/martinique\":140,\"america/matamoros\":141,\"america/mazatlan\":142,\"mexico/bajasur\":142,\"america/mendoza\":143,\"america/argentina/mendoza\":143,\"america/menominee\":144,\"america/merida\":145,\"america/metlakatla\":146,\"america/mexico_city\":147,\"mexico/general\":147,\"america/miquelon\":148,\"america/moncton\":149,\"america/monterrey\":150,\"america/montevideo\":151,\"america/montserrat\":152,\"america/nassau\":153,\"america/new_york\":154,\"est5edt\":154,\"us/eastern\":154,\"america/nome\":155,\"america/noronha\":156,\"brazil/denoronha\":156,\"america/north_dakota/beulah\":157,\"america/north_dakota/center\":158,\"america/north_dakota/new_salem\":159,\"america/ojinaga\":160,\"america/panama\":161,\"america/paramaribo\":162,\"america/phoenix\":163,\"us/arizona\":163,\"america/port-au-prince\":164,\"america/port_of_spain\":165,\"america/porto_velho\":166,\"america/puerto_rico\":167,\"america/punta_arenas\":168,\"america/rankin_inlet\":169,\"america/recife\":170,\"america/regina\":171,\"canada/east-saskatchewan\":171,\"canada/saskatchewan\":171,\"america/resolute\":172,\"america/rio_branco\":173,\"america/porto_acre\":173,\"brazil/acre\":173,\"america/santarem\":174,\"america/santiago\":175,\"chile/continental\":175,\"america/santo_domingo\":176,\"america/sao_paulo\":177,\"brazil/east\":177,\"america/scoresbysund\":178,\"america/sitka\":179,\"america/st_barthelemy\":180,\"america/st_johns\":181,\"canada/newfoundland\":181,\"america/st_kitts\":182,\"america/st_lucia\":183,\"america/st_thomas\":184,\"america/virgin\":184,\"america/st_vincent\":185,\"america/swift_current\":186,\"america/tegucigalpa\":187,\"america/thule\":188,\"america/tijuana\":189,\"america/ensenada\":189,\"america/santa_isabel\":189,\"mexico/bajanorte\":189,\"america/toronto\":190,\"america/montreal\":190,\"america/nipigon\":190,\"america/thunder_bay\":190,\"canada/eastern\":190,\"america/tortola\":191,\"america/vancouver\":192,\"canada/pacific\":192,\"america/whitehorse\":193,\"canada/yukon\":193,\"america/winnipeg\":194,\"america/rainy_river\":194,\"canada/central\":194,\"america/yakutat\":195,\"antarctica/casey\":196,\"antarctica/davis\":197,\"antarctica/dumontdurville\":198,\"antarctica/macquarie\":199,\"antarctica/mawson\":200,\"antarctica/mcmurdo\":201,\"antarctica/south_pole\":201,\"antarctica/palmer\":202,\"antarctica/rothera\":203,\"antarctica/syowa\":204,\"antarctica/troll\":205,\"antarctica/vostok\":206,\"arctic/longyearbyen\":207,\"atlantic/jan_mayen\":207,\"asia/aden\":208,\"asia/almaty\":209,\"asia/amman\":210,\"asia/anadyr\":211,\"asia/aqtau\":212,\"asia/aqtobe\":213,\"asia/ashgabat\":214,\"asia/ashkhabad\":214,\"asia/atyrau\":215,\"asia/baghdad\":216,\"asia/bahrain\":217,\"asia/baku\":218,\"asia/bangkok\":219,\"asia/barnaul\":220,\"asia/beirut\":221,\"asia/bishkek\":222,\"asia/brunei\":223,\"asia/calcutta\":224,\"asia/kolkata\":224,\"asia/chita\":225,\"asia/colombo\":226,\"asia/damascus\":227,\"asia/dhaka\":228,\"asia/dacca\":228,\"asia/dili\":229,\"asia/dubai\":230,\"asia/dushanbe\":231,\"asia/famagusta\":232,\"asia/gaza\":233,\"asia/hebron\":234,\"asia/hong_kong\":235,\"hongkong\":235,\"asia/hovd\":236,\"asia/irkutsk\":237,\"asia/jakarta\":238,\"asia/jayapura\":239,\"asia/jerusalem\":240,\"asia/tel_aviv\":240,\"israel\":240,\"asia/kabul\":241,\"asia/kamchatka\":242,\"asia/karachi\":243,\"asia/katmandu\":244,\"asia/kathmandu\":244,\"asia/khandyga\":245,\"asia/krasnoyarsk\":246,\"asia/kuala_lumpur\":247,\"asia/kuching\":248,\"asia/kuwait\":249,\"asia/macau\":250,\"asia/macao\":250,\"asia/magadan\":251,\"asia/makassar\":252,\"asia/ujung_pandang\":252,\"asia/manila\":253,\"asia/muscat\":254,\"asia/nicosia\":255,\"europe/nicosia\":255,\"asia/novokuznetsk\":256,\"asia/novosibirsk\":257,\"asia/omsk\":258,\"asia/oral\":259,\"asia/phnom_penh\":260,\"asia/pontianak\":261,\"asia/pyongyang\":262,\"asia/qatar\":263,\"asia/qostanay\":264,\"asia/qyzylorda\":265,\"asia/rangoon\":266,\"asia/yangon\":266,\"asia/riyadh\":267,\"asia/saigon\":268,\"asia/ho_chi_minh\":268,\"asia/sakhalin\":269,\"asia/samarkand\":270,\"asia/seoul\":271,\"rok\":271,\"asia/shanghai\":272,\"asia/chongqing\":272,\"asia/chungking\":272,\"asia/harbin\":272,\"prc\":272,\"asia/singapore\":273,\"singapore\":273,\"asia/srednekolymsk\":274,\"asia/taipei\":275,\"roc\":275,\"asia/tashkent\":276,\"asia/tbilisi\":277,\"asia/tehran\":278,\"iran\":278,\"asia/thimphu\":279,\"asia/thimbu\":279,\"asia/tokyo\":280,\"japan\":280,\"asia/tomsk\":281,\"asia/ulaanbaatar\":282,\"asia/choibalsan\":282,\"asia/ulan_bator\":282,\"asia/urumqi\":283,\"asia/kashgar\":283,\"asia/ust-nera\":284,\"asia/vientiane\":285,\"asia/vladivostok\":286,\"asia/yakutsk\":287,\"asia/yekaterinburg\":288,\"asia/yerevan\":289,\"atlantic/azores\":290,\"atlantic/bermuda\":291,\"atlantic/canary\":292,\"atlantic/cape_verde\":293,\"atlantic/faeroe\":294,\"atlantic/faroe\":294,\"atlantic/madeira\":295,\"atlantic/reykjavik\":296,\"iceland\":296,\"atlantic/south_georgia\":297,\"atlantic/st_helena\":298,\"atlantic/stanley\":299,\"australia/adelaide\":300,\"australia/south\":300,\"australia/brisbane\":301,\"australia/queensland\":301,\"australia/broken_hill\":302,\"australia/yancowinna\":302,\"australia/darwin\":303,\"australia/north\":303,\"australia/eucla\":304,\"australia/hobart\":305,\"australia/currie\":305,\"australia/tasmania\":305,\"australia/lindeman\":306,\"australia/lord_howe\":307,\"australia/lhi\":307,\"australia/melbourne\":308,\"australia/victoria\":308,\"australia/perth\":309,\"australia/west\":309,\"australia/sydney\":310,\"australia/act\":310,\"australia/canberra\":310,\"australia/nsw\":310,\"etc/gmt+1\":311,\"etc/gmt+10\":312,\"etc/gmt+11\":313,\"etc/gmt+12\":314,\"etc/gmt+2\":315,\"etc/gmt+3\":316,\"etc/gmt+4\":317,\"etc/gmt+5\":318,\"etc/gmt+6\":319,\"etc/gmt+7\":320,\"etc/gmt+8\":321,\"etc/gmt+9\":322,\"etc/gmt-1\":323,\"etc/gmt-10\":324,\"etc/gmt-11\":325,\"etc/gmt-12\":326,\"etc/gmt-13\":327,\"etc/gmt-14\":328,\"etc/gmt-2\":329,\"etc/gmt-3\":330,\"etc/gmt-4\":331,\"etc/gmt-5\":332,\"etc/gmt-6\":333,\"etc/gmt-7\":334,\"etc/gmt-8\":335,\"etc/gmt-9\":336,\"europe/amsterdam\":337,\"europe/andorra\":338,\"europe/astrakhan\":339,\"europe/athens\":340,\"europe/belgrade\":341,\"europe/berlin\":342,\"europe/bratislava\":343,\"europe/brussels\":344,\"met\":344,\"europe/bucharest\":345,\"europe/budapest\":346,\"europe/busingen\":347,\"europe/chisinau\":348,\"europe/tiraspol\":348,\"europe/copenhagen\":349,\"europe/dublin\":350,\"eire\":350,\"europe/gibraltar\":351,\"europe/guernsey\":352,\"europe/helsinki\":353,\"europe/isle_of_man\":354,\"europe/istanbul\":355,\"asia/istanbul\":355,\"turkey\":355,\"europe/jersey\":356,\"europe/kaliningrad\":357,\"europe/kiev\":358,\"europe/kyiv\":358,\"europe/uzhgorod\":358,\"europe/zaporozhye\":358,\"europe/kirov\":359,\"europe/lisbon\":360,\"portugal\":360,\"europe/ljubljana\":361,\"europe/london\":362,\"europe/belfast\":362,\"gb\":362,\"gb-eire\":362,\"europe/luxembourg\":363,\"europe/madrid\":364,\"europe/malta\":365,\"europe/mariehamn\":366,\"europe/minsk\":367,\"europe/monaco\":368,\"europe/moscow\":369,\"w-su\":369,\"europe/oslo\":370,\"europe/paris\":371,\"europe/podgorica\":372,\"europe/prague\":373,\"europe/riga\":374,\"europe/rome\":375,\"europe/samara\":376,\"europe/san_marino\":377,\"europe/sarajevo\":378,\"europe/saratov\":379,\"europe/simferopol\":380,\"europe/skopje\":381,\"europe/sofia\":382,\"europe/stockholm\":383,\"europe/tallinn\":384,\"europe/tirane\":385,\"europe/ulyanovsk\":386,\"europe/vaduz\":387,\"europe/vatican\":388,\"europe/vienna\":389,\"europe/vilnius\":390,\"europe/volgograd\":391,\"europe/warsaw\":392,\"poland\":392,\"europe/zagreb\":393,\"europe/zurich\":394,\"indian/antananarivo\":395,\"indian/chagos\":396,\"indian/christmas\":397,\"indian/cocos\":398,\"indian/comoro\":399,\"indian/kerguelen\":400,\"indian/mahe\":401,\"indian/maldives\":402,\"indian/mauritius\":403,\"indian/mayotte\":404,\"indian/reunion\":405,\"pacific/apia\":406,\"pacific/auckland\":407,\"nz\":407,\"pacific/bougainville\":408,\"pacific/chatham\":409,\"nz-chat\":409,\"pacific/easter\":410,\"chile/easterisland\":410,\"pacific/efate\":411,\"pacific/enderbury\":412,\"pacific/kanton\":412,\"pacific/fakaofo\":413,\"pacific/fiji\":414,\"pacific/funafuti\":415,\"pacific/galapagos\":416,\"pacific/gambier\":417,\"pacific/guadalcanal\":418,\"pacific/guam\":419,\"pacific/honolulu\":420,\"pacific/johnston\":420,\"us/hawaii\":420,\"pacific/kiritimati\":421,\"pacific/kosrae\":422,\"pacific/kwajalein\":423,\"kwajalein\":423,\"pacific/majuro\":424,\"pacific/marquesas\":425,\"pacific/midway\":426,\"pacific/nauru\":427,\"pacific/niue\":428,\"pacific/norfolk\":429,\"pacific/noumea\":430,\"pacific/pago_pago\":431,\"pacific/samoa\":431,\"us/samoa\":431,\"pacific/palau\":432,\"pacific/pitcairn\":433,\"pacific/ponape\":434,\"pacific/pohnpei\":434,\"pacific/port_moresby\":435,\"pacific/rarotonga\":436,\"pacific/saipan\":437,\"pacific/tahiti\":438,\"pacific/tarawa\":439,\"pacific/tongatapu\":440,\"pacific/truk\":441,\"pacific/chuuk\":441,\"pacific/yap\":441,\"pacific/wake\":442,\"pacific/wallis\":443,\"systemv/ast4\":444,\"systemv/ast4adt\":445,\"systemv/cst6\":446,\"systemv/cst6cdt\":447,\"systemv/est5\":448,\"systemv/est5edt\":449,\"systemv/hst10\":450,\"systemv/mst7\":451,\"systemv/mst7mdt\":452,\"systemv/pst8\":453,\"systemv/pst8pdt\":454,\"systemv/yst9\":455,\"systemv/yst9ydt\":456,\"utc\":457,\"etc/gmt\":457,\"etc/gmt+0\":457,\"etc/gmt-0\":457,\"etc/gmt0\":457,\"etc/greenwich\":457,\"etc/uct\":457,\"etc/utc\":457,\"etc/universal\":457,\"etc/zulu\":457,\"gmt\":457,\"gmt+0\":457,\"gmt-0\":457,\"gmt0\":457,\"greenwich\":457,\"uct\":457,\"universal\":457,\"zulu\":457},\"zones\":[[\"Africa/Abidjan\"],[\"Africa/Accra\"],[\"Africa/Addis_Ababa\"],[\"Africa/Algiers\"],[\"Africa/Asmera\",\"Africa/Asmara\"],[\"Africa/Bamako\",\"Africa/Timbuktu\"],[\"Africa/Bangui\"],[\"Africa/Banjul\"],[\"Africa/Bissau\"],[\"Africa/Blantyre\"],[\"Africa/Brazzaville\"],[\"Africa/Bujumbura\"],[\"Africa/Cairo\",\"Egypt\"],[\"Africa/Casablanca\"],[\"Africa/Ceuta\"],[\"Africa/Conakry\"],[\"Africa/Dakar\"],[\"Africa/Dar_es_Salaam\"],[\"Africa/Djibouti\"],[\"Africa/Douala\"],[\"Africa/El_Aaiun\"],[\"Africa/Freetown\"],[\"Africa/Gaborone\"],[\"Africa/Harare\"],[\"Africa/Johannesburg\"],[\"Africa/Juba\"],[\"Africa/Kampala\"],[\"Africa/Khartoum\"],[\"Africa/Kigali\"],[\"Africa/Kinshasa\"],[\"Africa/Lagos\"],[\"Africa/Libreville\"],[\"Africa/Lome\"],[\"Africa/Luanda\"],[\"Africa/Lubumbashi\"],[\"Africa/Lusaka\"],[\"Africa/Malabo\"],[\"Africa/Maputo\"],[\"Africa/Maseru\"],[\"Africa/Mbabane\"],[\"Africa/Mogadishu\"],[\"Africa/Monrovia\"],[\"Africa/Nairobi\"],[\"Africa/Ndjamena\"],[\"Africa/Niamey\"],[\"Africa/Nouakchott\"],[\"Africa/Ouagadougou\"],[\"Africa/Porto-Novo\"],[\"Africa/Sao_Tome\"],[\"Africa/Tripoli\",\"Libya\"],[\"Africa/Tunis\"],[\"Africa/Windhoek\"],[\"America/Adak\",\"America/Atka\",\"US/Aleutian\"],[\"America/Anchorage\",\"US/Alaska\"],[\"America/Anguilla\"],[\"America/Antigua\"],[\"America/Araguaina\"],[\"America/Argentina/La_Rioja\"],[\"America/Argentina/Rio_Gallegos\"],[\"America/Argentina/Salta\"],[\"America/Argentina/San_Juan\"],[\"America/Argentina/San_Luis\"],[\"America/Argentina/Tucuman\"],[\"America/Argentina/Ushuaia\"],[\"America/Aruba\"],[\"America/Asuncion\"],[\"America/Bahia\"],[\"America/Bahia_Banderas\"],[\"America/Barbados\"],[\"America/Belem\"],[\"America/Belize\"],[\"America/Blanc-Sablon\"],[\"America/Boa_Vista\"],[\"America/Bogota\"],[\"America/Boise\"],[\"America/Buenos_Aires\",\"America/Argentina/Buenos_Aires\"],[\"America/Cambridge_Bay\"],[\"America/Campo_Grande\"],[\"America/Cancun\"],[\"America/Caracas\"],[\"America/Catamarca\",\"America/Argentina/Catamarca\",\"America/Argentina/ComodRivadavia\"],[\"America/Cayenne\"],[\"America/Cayman\"],[\"America/Chicago\",\"CST6CDT\",\"US/Central\"],[\"America/Chihuahua\"],[\"America/Ciudad_Juarez\"],[\"America/Coral_Harbour\",\"America/Atikokan\"],[\"America/Cordoba\",\"America/Argentina/Cordoba\",\"America/Rosario\"],[\"America/Costa_Rica\"],[\"America/Coyhaique\"],[\"America/Creston\"],[\"America/Cuiaba\"],[\"America/Curacao\"],[\"America/Danmarkshavn\"],[\"America/Dawson\"],[\"America/Dawson_Creek\"],[\"America/Denver\",\"America/Shiprock\",\"MST7MDT\",\"Navajo\",\"US/Mountain\"],[\"America/Detroit\",\"US/Michigan\"],[\"America/Dominica\"],[\"America/Edmonton\",\"America/Yellowknife\",\"Canada/Mountain\"],[\"America/Eirunepe\"],[\"America/El_Salvador\"],[\"America/Fort_Nelson\"],[\"America/Fortaleza\"],[\"America/Glace_Bay\"],[\"America/Godthab\",\"America/Nuuk\"],[\"America/Goose_Bay\"],[\"America/Grand_Turk\"],[\"America/Grenada\"],[\"America/Guadeloupe\"],[\"America/Guatemala\"],[\"America/Guayaquil\"],[\"America/Guyana\"],[\"America/Halifax\",\"Canada/Atlantic\"],[\"America/Havana\",\"Cuba\"],[\"America/Hermosillo\"],[\"America/Indiana/Knox\",\"America/Knox_IN\",\"US/Indiana-Starke\"],[\"America/Indiana/Marengo\"],[\"America/Indiana/Petersburg\"],[\"America/Indiana/Tell_City\"],[\"America/Indiana/Vevay\"],[\"America/Indiana/Vincennes\"],[\"America/Indiana/Winamac\"],[\"America/Indianapolis\",\"America/Fort_Wayne\",\"America/Indiana/Indianapolis\",\"US/East-Indiana\"],[\"America/Inuvik\"],[\"America/Iqaluit\",\"America/Pangnirtung\"],[\"America/Jamaica\",\"Jamaica\"],[\"America/Jujuy\",\"America/Argentina/Jujuy\"],[\"America/Juneau\"],[\"America/Kentucky/Monticello\"],[\"America/Kralendijk\"],[\"America/La_Paz\"],[\"America/Lima\"],[\"America/Los_Angeles\",\"PST8PDT\",\"US/Pacific\",\"US/Pacific-New\"],[\"America/Louisville\",\"America/Kentucky/Louisville\"],[\"America/Lower_Princes\"],[\"America/Maceio\"],[\"America/Managua\"],[\"America/Manaus\",\"Brazil/West\"],[\"America/Marigot\"],[\"America/Martinique\"],[\"America/Matamoros\"],[\"America/Mazatlan\",\"Mexico/BajaSur\"],[\"America/Mendoza\",\"America/Argentina/Mendoza\"],[\"America/Menominee\"],[\"America/Merida\"],[\"America/Metlakatla\"],[\"America/Mexico_City\",\"Mexico/General\"],[\"America/Miquelon\"],[\"America/Moncton\"],[\"America/Monterrey\"],[\"America/Montevideo\"],[\"America/Montserrat\"],[\"America/Nassau\"],[\"America/New_York\",\"EST5EDT\",\"US/Eastern\"],[\"America/Nome\"],[\"America/Noronha\",\"Brazil/DeNoronha\"],[\"America/North_Dakota/Beulah\"],[\"America/North_Dakota/Center\"],[\"America/North_Dakota/New_Salem\"],[\"America/Ojinaga\"],[\"America/Panama\"],[\"America/Paramaribo\"],[\"America/Phoenix\",\"US/Arizona\"],[\"America/Port-au-Prince\"],[\"America/Port_of_Spain\"],[\"America/Porto_Velho\"],[\"America/Puerto_Rico\"],[\"America/Punta_Arenas\"],[\"America/Rankin_Inlet\"],[\"America/Recife\"],[\"America/Regina\",\"Canada/East-Saskatchewan\",\"Canada/Saskatchewan\"],[\"America/Resolute\"],[\"America/Rio_Branco\",\"America/Porto_Acre\",\"Brazil/Acre\"],[\"America/Santarem\"],[\"America/Santiago\",\"Chile/Continental\"],[\"America/Santo_Domingo\"],[\"America/Sao_Paulo\",\"Brazil/East\"],[\"America/Scoresbysund\"],[\"America/Sitka\"],[\"America/St_Barthelemy\"],[\"America/St_Johns\",\"Canada/Newfoundland\"],[\"America/St_Kitts\"],[\"America/St_Lucia\"],[\"America/St_Thomas\",\"America/Virgin\"],[\"America/St_Vincent\"],[\"America/Swift_Current\"],[\"America/Tegucigalpa\"],[\"America/Thule\"],[\"America/Tijuana\",\"America/Ensenada\",\"America/Santa_Isabel\",\"Mexico/BajaNorte\"],[\"America/Toronto\",\"America/Montreal\",\"America/Nipigon\",\"America/Thunder_Bay\",\"Canada/Eastern\"],[\"America/Tortola\"],[\"America/Vancouver\",\"Canada/Pacific\"],[\"America/Whitehorse\",\"Canada/Yukon\"],[\"America/Winnipeg\",\"America/Rainy_River\",\"Canada/Central\"],[\"America/Yakutat\"],[\"Antarctica/Casey\"],[\"Antarctica/Davis\"],[\"Antarctica/DumontDUrville\"],[\"Antarctica/Macquarie\"],[\"Antarctica/Mawson\"],[\"Antarctica/McMurdo\",\"Antarctica/South_Pole\"],[\"Antarctica/Palmer\"],[\"Antarctica/Rothera\"],[\"Antarctica/Syowa\"],[\"Antarctica/Troll\"],[\"Antarctica/Vostok\"],[\"Arctic/Longyearbyen\",\"Atlantic/Jan_Mayen\"],[\"Asia/Aden\"],[\"Asia/Almaty\"],[\"Asia/Amman\"],[\"Asia/Anadyr\"],[\"Asia/Aqtau\"],[\"Asia/Aqtobe\"],[\"Asia/Ashgabat\",\"Asia/Ashkhabad\"],[\"Asia/Atyrau\"],[\"Asia/Baghdad\"],[\"Asia/Bahrain\"],[\"Asia/Baku\"],[\"Asia/Bangkok\"],[\"Asia/Barnaul\"],[\"Asia/Beirut\"],[\"Asia/Bishkek\"],[\"Asia/Brunei\"],[\"Asia/Calcutta\",\"Asia/Kolkata\"],[\"Asia/Chita\"],[\"Asia/Colombo\"],[\"Asia/Damascus\"],[\"Asia/Dhaka\",\"Asia/Dacca\"],[\"Asia/Dili\"],[\"Asia/Dubai\"],[\"Asia/Dushanbe\"],[\"Asia/Famagusta\"],[\"Asia/Gaza\"],[\"Asia/Hebron\"],[\"Asia/Hong_Kong\",\"Hongkong\"],[\"Asia/Hovd\"],[\"Asia/Irkutsk\"],[\"Asia/Jakarta\"],[\"Asia/Jayapura\"],[\"Asia/Jerusalem\",\"Asia/Tel_Aviv\",\"Israel\"],[\"Asia/Kabul\"],[\"Asia/Kamchatka\"],[\"Asia/Karachi\"],[\"Asia/Katmandu\",\"Asia/Kathmandu\"],[\"Asia/Khandyga\"],[\"Asia/Krasnoyarsk\"],[\"Asia/Kuala_Lumpur\"],[\"Asia/Kuching\"],[\"Asia/Kuwait\"],[\"Asia/Macau\",\"Asia/Macao\"],[\"Asia/Magadan\"],[\"Asia/Makassar\",\"Asia/Ujung_Pandang\"],[\"Asia/Manila\"],[\"Asia/Muscat\"],[\"Asia/Nicosia\",\"Europe/Nicosia\"],[\"Asia/Novokuznetsk\"],[\"Asia/Novosibirsk\"],[\"Asia/Omsk\"],[\"Asia/Oral\"],[\"Asia/Phnom_Penh\"],[\"Asia/Pontianak\"],[\"Asia/Pyongyang\"],[\"Asia/Qatar\"],[\"Asia/Qostanay\"],[\"Asia/Qyzylorda\"],[\"Asia/Rangoon\",\"Asia/Yangon\"],[\"Asia/Riyadh\"],[\"Asia/Saigon\",\"Asia/Ho_Chi_Minh\"],[\"Asia/Sakhalin\"],[\"Asia/Samarkand\"],[\"Asia/Seoul\",\"ROK\"],[\"Asia/Shanghai\",\"Asia/Chongqing\",\"Asia/Chungking\",\"Asia/Harbin\",\"PRC\"],[\"Asia/Singapore\",\"Singapore\"],[\"Asia/Srednekolymsk\"],[\"Asia/Taipei\",\"ROC\"],[\"Asia/Tashkent\"],[\"Asia/Tbilisi\"],[\"Asia/Tehran\",\"Iran\"],[\"Asia/Thimphu\",\"Asia/Thimbu\"],[\"Asia/Tokyo\",\"Japan\"],[\"Asia/Tomsk\"],[\"Asia/Ulaanbaatar\",\"Asia/Choibalsan\",\"Asia/Ulan_Bator\"],[\"Asia/Urumqi\",\"Asia/Kashgar\"],[\"Asia/Ust-Nera\"],[\"Asia/Vientiane\"],[\"Asia/Vladivostok\"],[\"Asia/Yakutsk\"],[\"Asia/Yekaterinburg\"],[\"Asia/Yerevan\"],[\"Atlantic/Azores\"],[\"Atlantic/Bermuda\"],[\"Atlantic/Canary\"],[\"Atlantic/Cape_Verde\"],[\"Atlantic/Faeroe\",\"Atlantic/Faroe\"],[\"Atlantic/Madeira\"],[\"Atlantic/Reykjavik\",\"Iceland\"],[\"Atlantic/South_Georgia\"],[\"Atlantic/St_Helena\"],[\"Atlantic/Stanley\"],[\"Australia/Adelaide\",\"Australia/South\"],[\"Australia/Brisbane\",\"Australia/Queensland\"],[\"Australia/Broken_Hill\",\"Australia/Yancowinna\"],[\"Australia/Darwin\",\"Australia/North\"],[\"Australia/Eucla\"],[\"Australia/Hobart\",\"Australia/Currie\",\"Australia/Tasmania\"],[\"Australia/Lindeman\"],[\"Australia/Lord_Howe\",\"Australia/LHI\"],[\"Australia/Melbourne\",\"Australia/Victoria\"],[\"Australia/Perth\",\"Australia/West\"],[\"Australia/Sydney\",\"Australia/ACT\",\"Australia/Canberra\",\"Australia/NSW\"],[\"Etc/GMT+1\"],[\"Etc/GMT+10\"],[\"Etc/GMT+11\"],[\"Etc/GMT+12\"],[\"Etc/GMT+2\"],[\"Etc/GMT+3\"],[\"Etc/GMT+4\"],[\"Etc/GMT+5\"],[\"Etc/GMT+6\"],[\"Etc/GMT+7\"],[\"Etc/GMT+8\"],[\"Etc/GMT+9\"],[\"Etc/GMT-1\"],[\"Etc/GMT-10\"],[\"Etc/GMT-11\"],[\"Etc/GMT-12\"],[\"Etc/GMT-13\"],[\"Etc/GMT-14\"],[\"Etc/GMT-2\"],[\"Etc/GMT-3\"],[\"Etc/GMT-4\"],[\"Etc/GMT-5\"],[\"Etc/GMT-6\"],[\"Etc/GMT-7\"],[\"Etc/GMT-8\"],[\"Etc/GMT-9\"],[\"Europe/Amsterdam\"],[\"Europe/Andorra\"],[\"Europe/Astrakhan\"],[\"Europe/Athens\"],[\"Europe/Belgrade\"],[\"Europe/Berlin\"],[\"Europe/Bratislava\"],[\"Europe/Brussels\",\"MET\"],[\"Europe/Bucharest\"],[\"Europe/Budapest\"],[\"Europe/Busingen\"],[\"Europe/Chisinau\",\"Europe/Tiraspol\"],[\"Europe/Copenhagen\"],[\"Europe/Dublin\",\"Eire\"],[\"Europe/Gibraltar\"],[\"Europe/Guernsey\"],[\"Europe/Helsinki\"],[\"Europe/Isle_of_Man\"],[\"Europe/Istanbul\",\"Asia/Istanbul\",\"Turkey\"],[\"Europe/Jersey\"],[\"Europe/Kaliningrad\"],[\"Europe/Kiev\",\"Europe/Kyiv\",\"Europe/Uzhgorod\",\"Europe/Zaporozhye\"],[\"Europe/Kirov\"],[\"Europe/Lisbon\",\"Portugal\"],[\"Europe/Ljubljana\"],[\"Europe/London\",\"Europe/Belfast\",\"GB\",\"GB-Eire\"],[\"Europe/Luxembourg\"],[\"Europe/Madrid\"],[\"Europe/Malta\"],[\"Europe/Mariehamn\"],[\"Europe/Minsk\"],[\"Europe/Monaco\"],[\"Europe/Moscow\",\"W-SU\"],[\"Europe/Oslo\"],[\"Europe/Paris\"],[\"Europe/Podgorica\"],[\"Europe/Prague\"],[\"Europe/Riga\"],[\"Europe/Rome\"],[\"Europe/Samara\"],[\"Europe/San_Marino\"],[\"Europe/Sarajevo\"],[\"Europe/Saratov\"],[\"Europe/Simferopol\"],[\"Europe/Skopje\"],[\"Europe/Sofia\"],[\"Europe/Stockholm\"],[\"Europe/Tallinn\"],[\"Europe/Tirane\"],[\"Europe/Ulyanovsk\"],[\"Europe/Vaduz\"],[\"Europe/Vatican\"],[\"Europe/Vienna\"],[\"Europe/Vilnius\"],[\"Europe/Volgograd\"],[\"Europe/Warsaw\",\"Poland\"],[\"Europe/Zagreb\"],[\"Europe/Zurich\"],[\"Indian/Antananarivo\"],[\"Indian/Chagos\"],[\"Indian/Christmas\"],[\"Indian/Cocos\"],[\"Indian/Comoro\"],[\"Indian/Kerguelen\"],[\"Indian/Mahe\"],[\"Indian/Maldives\"],[\"Indian/Mauritius\"],[\"Indian/Mayotte\"],[\"Indian/Reunion\"],[\"Pacific/Apia\"],[\"Pacific/Auckland\",\"NZ\"],[\"Pacific/Bougainville\"],[\"Pacific/Chatham\",\"NZ-CHAT\"],[\"Pacific/Easter\",\"Chile/EasterIsland\"],[\"Pacific/Efate\"],[\"Pacific/Enderbury\",\"Pacific/Kanton\"],[\"Pacific/Fakaofo\"],[\"Pacific/Fiji\"],[\"Pacific/Funafuti\"],[\"Pacific/Galapagos\"],[\"Pacific/Gambier\"],[\"Pacific/Guadalcanal\"],[\"Pacific/Guam\"],[\"Pacific/Honolulu\",\"Pacific/Johnston\",\"US/Hawaii\"],[\"Pacific/Kiritimati\"],[\"Pacific/Kosrae\"],[\"Pacific/Kwajalein\",\"Kwajalein\"],[\"Pacific/Majuro\"],[\"Pacific/Marquesas\"],[\"Pacific/Midway\"],[\"Pacific/Nauru\"],[\"Pacific/Niue\"],[\"Pacific/Norfolk\"],[\"Pacific/Noumea\"],[\"Pacific/Pago_Pago\",\"Pacific/Samoa\",\"US/Samoa\"],[\"Pacific/Palau\"],[\"Pacific/Pitcairn\"],[\"Pacific/Ponape\",\"Pacific/Pohnpei\"],[\"Pacific/Port_Moresby\"],[\"Pacific/Rarotonga\"],[\"Pacific/Saipan\"],[\"Pacific/Tahiti\"],[\"Pacific/Tarawa\"],[\"Pacific/Tongatapu\"],[\"Pacific/Truk\",\"Pacific/Chuuk\",\"Pacific/Yap\"],[\"Pacific/Wake\"],[\"Pacific/Wallis\"],[\"SystemV/AST4\"],[\"SystemV/AST4ADT\"],[\"SystemV/CST6\"],[\"SystemV/CST6CDT\"],[\"SystemV/EST5\"],[\"SystemV/EST5EDT\"],[\"SystemV/HST10\"],[\"SystemV/MST7\"],[\"SystemV/MST7MDT\"],[\"SystemV/PST8\"],[\"SystemV/PST8PDT\"],[\"SystemV/YST9\"],[\"SystemV/YST9YDT\"],[\"UTC\",\"Etc/GMT\",\"Etc/GMT+0\",\"Etc/GMT-0\",\"Etc/GMT0\",\"Etc/Greenwich\",\"Etc/UCT\",\"Etc/UTC\",\"Etc/Universal\",\"Etc/Zulu\",\"GMT\",\"GMT+0\",\"GMT-0\",\"GMT0\",\"Greenwich\",\"UCT\",\"Universal\",\"Zulu\"]]}\n")
    empty_keys = {}
    keys = _core_get(table, "keys", empty_keys)
    group_index = _core_get(keys, key, None)
    unknown = _core_is_none(group_index)
    if unknown:
        unknown_error = _core_runtime_error(unrecognized)
        raise unknown_error
    else:
        pass
    empty_zones = []
    zones = _core_get(table, "zones", empty_zones)
    empty_group = []
    group = _core_get(zones, group_index, empty_group)
    for candidate in group:
        works = True
        try:
            _core_date_zone_offset(candidate, probe)
        except Exception as zone_error:
            works = False
        if works:
            resolved["kind"] = "named"
            resolved["name"] = candidate
            return resolved
        else:
            pass
    missing_error = _core_runtime_error(unrecognized)
    raise missing_error


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


def _stream_js_string_impl(value: Any) -> str:
    _core_coverage_mark("_stream_js_string_impl")
    is_string = _core_type_is(value, "string")
    if is_string:
        return value
    else:
        pass
    is_null = _core_is_none(value)
    if is_null:
        return "null"
    else:
        pass
    is_boolean = _core_type_is(value, "boolean")
    if is_boolean:
        if value:
            return "true"
        else:
            pass
        return "false"
    else:
        pass
    is_number = _core_type_is(value, "number")
    if is_number:
        whole = _core_math_floor(value)
        integral = _core_eq(whole, value)
        if integral:
            whole_text = _core_string_format("{}", whole)
            return whole_text
        else:
            pass
        number_text = _core_string_format("{}", value)
        return number_text
    else:
        pass
    is_list = _core_type_is(value, "list")
    if is_list:
        parts = []
        for item in value:
            item_null = _core_is_none(item)
            if item_null:
                parts.append("")
                continue
            else:
                pass
            part = _stream_js_string_impl(item)
            parts.append(part)
        joined = _core_string_join(",", parts)
        return joined
    else:
        pass
    return "[object Object]"


def chat_session_record_result(gen: Any, state: Any, call: Any, result: Any, ok: bool, options: Any) -> bool:
    _core_coverage_mark("chat_session_record_result")
    id = _core_get(call, "id", None)
    text = result
    if ok:
        try:
            formatted = _function_result_text_impl(result, options)
            text = formatted
        except Exception as formatter_error:
            _core_axgen_record_function_call(gen, call, formatter_error, "error")
            unresolved = []
            empty_pending = {}
            pending = _core_get(state, "pending", empty_pending)
            pending_ids = _core_map_keys(pending)
            for pending_id in pending_ids:
                other_call = _core_ne(pending_id, id)
                pending_call = _core_get(pending, pending_id, None)
                pending_status = _core_get(pending_call, "status", "")
                running = _core_eq(pending_status, "running")
                still_running = _core_and(other_call, running)
                if still_running:
                    unresolved.append(pending_id)
                else:
                    pass
            unresolved_text = _core_string_join(", ", unresolved)
            no_unresolved = _core_eq(unresolved_text, "")
            if no_unresolved:
                unresolved_text = "none"
            else:
                pass
            formatter_message = _core_exception_message(formatter_error)
            session_message = _core_string_format("Chat session failed: {}; unresolved calls: {}", formatter_message, unresolved_text)
            session_error = _core_exception_rewrap(formatter_error, session_message)
            raise session_error
    else:
        pass
    output = {}
    output["function_id"] = id
    output["result"] = text
    if ok:
        pass
    else:
        output["is_error"] = True
    changed = chat_session_complete_call(state, id, output)
    if changed:
        status = "error"
        if ok:
            status = "ok"
        else:
            pass
        _core_axgen_memory_add_function_result(gen, call, text, ok, text)
        _core_axgen_record_function_call(gen, call, result, status)
        empty_turns = []
        turns = _core_get(state, "turns", empty_turns)
        message = _tool_result_message_impl(call, text)
        failed = _core_not(ok)
        if failed:
            message["result"] = text
            message["is_error"] = True
        else:
            pass
        turns.append(message)
        state["turns"] = turns
    else:
        pass
    return changed


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


def _forward_impl(gen: AxGen, client: AIClient, values: Any, options: Any) -> Any:
    _core_coverage_mark("_forward_impl")
    base_options = _core_get(gen, "options", None)
    runtime_options = _core_map_merge(base_options, options)
    _apply_model_config_option_impl(runtime_options, base_options, options)
    cache_fn = _core_none()
    cache_key = ""
    lookup = _cache_lookup_option_impl(options)
    looked_up = _core_is_not_none(lookup)
    if looked_up:
        cache_fn = _core_get(lookup, "fn", None)
        cache_key = _core_get(lookup, "key", "")
    else:
        read = _cache_lookup_impl(gen, values, options, False)
        read_hit = _core_get(read, "hit", False)
        if read_hit:
            cached = _core_get(read, "value", None)
            rendered_cached = _render_audio_outputs_impl(gen, client, cached, options)
            return rendered_cached
        else:
            pass
        cache_fn = _core_get(read, "fn", None)
        cache_key = _core_get(read, "key", "")
    _core_map_delete(runtime_options, "_ax_cache_lookup")
    stream_option = _core_get(runtime_options, "stream", False)
    streamed = _core_truthy(stream_option)
    if streamed:
        no_sink = _core_none()
        merged = _streaming_forward_impl(gen, client, values, options, no_sink)
        _cache_store_impl(cache_fn, cache_key, merged)
        return merged
    else:
        pass
    signature = _core_get(gen, "signature", None)
    model = _core_get(runtime_options, "model", None)
    features = _core_ai_client_features(client, model)
    functions = _core_get(gen, "functions", None)
    selection = _select_structured_output_rung(signature, features, runtime_options)
    selected_rung = _core_get(selection, "rung", None)
    validate_exact_json = _core_eq(selected_rung, "json_object")
    text_contract = _core_is_none(selected_rung)
    strict_mode = _strict_mode_option_impl(base_options, options)
    input_fields = _core_get(signature, "input_fields", None)
    validate_fields(input_fields, values, "input")
    prompt_template = _core_get(gen, "prompt_template", None)
    render_options = _structured_output_render_options_impl(selection)
    _include_optional_render_option_impl(render_options, options)
    cache_snake = _core_get(runtime_options, "context_cache", None)
    cache = _core_get(runtime_options, "contextCache", cache_snake)
    render_options["contextCache"] = cache
    caching_features = _core_get(features, "caching", None)
    breakpoints = _core_get(caching_features, "cacheBreakpoints", True)
    ignore_breakpoints = _core_eq(breakpoints, False)
    render_options["ignoreBreakpoints"] = ignore_breakpoints
    messages = _core_object_call_method(prompt_template, "render", values, render_options)
    example_messages = _render_examples(gen)
    demo_messages = _render_demos(gen)
    system_message = _core_list_get(messages, 0, messages)
    ordered_messages = []
    ordered_messages.append(system_message)
    for example_message in example_messages:
        ordered_messages.append(example_message)
    for demo_message in demo_messages:
        ordered_messages.append(demo_message)
    message_index = 0
    for message in messages:
        after_system = _core_gt(message_index, 0)
        if after_system:
            ordered_messages.append(message)
        else:
            pass
        message_index = _core_add(message_index, 1)
    output_fields = _core_get(signature, "output_fields", None)
    output_fields = _date_parse_fields_impl(output_fields, base_options, options)
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
    max_retries_snake = _core_get(runtime_options, "max_retries", 3)
    max_retries = _core_get(runtime_options, "maxRetries", max_retries_snake)
    validation_retries_snake = _core_get(runtime_options, "validation_retries", max_retries)
    validation_retries = _core_get(runtime_options, "validationRetries", validation_retries_snake)
    infra_retries_snake = _core_get(runtime_options, "infra_retries", max_retries)
    infra_retries = _core_get(runtime_options, "infraRetries", infra_retries_snake)
    attempt = 0
    infra_attempt = 0
    thought_field_snake = _core_get(base_options, "thought_field_name", "thought")
    thought_field = _core_get(base_options, "thoughtFieldName", thought_field_snake)
    thought_prefix = ""
    max_steps_snake = _core_get(runtime_options, "max_steps", 25)
    max_steps = _core_get(runtime_options, "maxSteps", max_steps_snake)
    failed_messages = []
    memory_cleanup = _memory_cleanup_option_impl(runtime_options)
    step = 0
    control_step = -1
    while True:
        steps_exhausted = _core_gte(step, max_steps)
        if steps_exhausted:
            max_steps_message = _core_string_format("Max steps reached: {}", max_steps)
            max_steps_error = _core_runtime_error(max_steps_message)
            max_steps_failed = _generate_failed_impl(max_steps_error)
            raise max_steps_failed
        else:
            pass
        starts_step = _core_ne(step, control_step)
        if starts_step:
            control_step = step
            control_updates = _core_ai_control_take_pending(client)
            messages = _apply_control_updates_impl(gen, messages, runtime_options, control_updates)
        else:
            pass
        request_messages = _settle_failed_attempts_impl(messages, failed_messages, False)
        request = _build_gen_chat_request(gen, request_messages, runtime_options, selection, step)
        response = {}
        try:
            completed = _core_ai_complete_once(client, request, runtime_options)
            response = completed
        except Exception as completion_error:
            aborted = _core_exception_is_aborted(completion_error)
            if aborted:
                raise completion_error
            else:
                pass
            infrastructure = _core_exception_is_infrastructure(completion_error)
            if infrastructure:
                infra_exhausted = _core_gte(infra_attempt, infra_retries)
                if infra_exhausted:
                    raise completion_error
                else:
                    pass
                _core_retry_sleep(infra_attempt, client, runtime_options)
                next_infra_attempt = _core_add(infra_attempt, 1)
                infra_attempt = next_infra_attempt
                attempt = 0
            else:
                refused = _core_exception_is_refusal(completion_error)
                not_refused = _core_not(refused)
                if not_refused:
                    provider_failure = _generate_failed_impl(completion_error)
                    raise provider_failure
                else:
                    pass
                refusal_retries_exhausted = _core_gte(attempt, validation_retries)
                if refusal_retries_exhausted:
                    refusal_failure = _unable_to_fix_impl(completion_error, "")
                    raise refusal_failure
                else:
                    pass
                refusal_next_attempt = _core_add(attempt, 1)
                attempt = refusal_next_attempt
                thought_prefix = ""
            continue
        try:
            _check_completion_function_calls(response, runtime_options)
        except Exception as call_check_error:
            call_check_failure = _generate_failed_impl(call_check_error)
            raise call_check_failure
        session_turns = _core_get(response, "session_turns", None)
        has_session_turns = _core_is_not_none(session_turns)
        if has_session_turns:
            _core_map_delete(response, "session_turns")
            for session_turn in session_turns:
                messages.append(session_turn)
        else:
            pass
        _core_axgen_memory_add_response(gen, request, response)
        _core_axgen_record_chat_log(gen, request, response)
        calls = _response_function_calls_impl(response)
        call_count = _core_len(calls)
        has_calls = _core_gt(call_count, 0)
        if has_calls:
            structured_call = _find_structured_output_call(calls)
            has_structured_call = _core_is_not_none(structured_call)
            if has_structured_call:
                structured_failure = _core_none()
                structured_done = _core_none()
                structured_stage = "validation"
                try:
                    structured_args = _structured_output_call_args(structured_call)
                    _validate_exact_output_keys(output_fields, structured_args, "output")
                    structured_recovered = _parse_json_string_fields(output_fields, structured_args)
                    structured_validated = _stream_json_validate_output_impl(output_fields, structured_recovered)
                    decision_context = _evidence_context_impl(response, client)
                    structured_validated = _evidence_decode_values_impl(output_fields, structured_validated, decision_context, "")
                    structured_processed = _apply_field_processors(gen, structured_validated)
                    structured_stage = "assertion"
                    structured_assertion_failure = _run_assertions(gen, structured_processed)
                    structured_assertion_failed = _core_is_not_none(structured_assertion_failure)
                    if structured_assertion_failed:
                        structured_failure = structured_assertion_failure
                    else:
                        structured_stripped = strip_internal(output_fields, structured_processed)
                        structured_thought = _core_get(response, "thought", "")
                        structured_public = _with_output_thought_impl(structured_stripped, thought_field, thought_prefix, structured_thought)
                        _core_axgen_memory_cleanup_corrections(gen)
                        structured_done = structured_public
                except Exception as structured_validation_error:
                    refusal_message = _core_exception_message(structured_validation_error)
                    refusal = _core_string_starts_with(refusal_message, "Decision refused:")
                    if refusal:
                        raise structured_validation_error
                    else:
                        pass
                    structured_retries_exhausted = _core_gte(attempt, validation_retries)
                    if structured_retries_exhausted:
                        structured_output_text = _attempt_output_impl(response)
                        structured_exhausted = _unable_to_fix_impl(structured_validation_error, structured_output_text)
                        raise structured_exhausted
                    else:
                        pass
                    structured_next_attempt = _core_add(attempt, 1)
                    attempt = structured_next_attempt
                    thought_prefix = ""
                    structured_retry_messages = _append_structured_output_retry_messages_impl(failed_messages, response, structured_call, structured_validation_error, structured_stage)
                    failed_messages = structured_retry_messages
                    _core_axgen_memory_add_correction(gen, response, structured_validation_error)
                    continue
                structured_answered = _core_is_not_none(structured_done)
                if structured_answered:
                    structured_rendered = _render_audio_outputs_impl(gen, client, structured_done, options)
                    _record_trace(gen, values, structured_rendered, "ok")
                    _cache_store_impl(cache_fn, cache_key, structured_rendered)
                    return structured_rendered
                else:
                    pass
                structured_fatal = _generate_failed_impl(structured_failure)
                raise structured_fatal
            else:
                pass
            settled_for_tools = _settle_failed_attempts_impl(messages, failed_messages, memory_cleanup)
            messages = settled_for_tools
            failed_messages = []
            updated_messages = _append_tool_call_messages_impl(messages, response, calls)
            messages = updated_messages
            tool_messages = _run_tool_calls_impl(gen, functions, messages, calls, runtime_options)
            messages = tool_messages
            continue_after_tools = _should_continue_steps(gen, calls)
            if continue_after_tools:
                next_step = _core_add(step, 1)
                step = next_step
                attempt = 0
                infra_attempt = 0
                step_thought = _core_get(response, "thought", "")
                joined_thought = _core_add(thought_prefix, step_thought)
                thought_prefix = joined_thought
                continue
            else:
                stop_output = {}
                stop_thought = _core_get(response, "thought", "")
                stop_public = _with_output_thought_impl(stop_output, thought_field, thought_prefix, stop_thought)
                _core_axgen_memory_cleanup_corrections(gen)
                stop_rendered = _render_audio_outputs_impl(gen, client, stop_public, options)
                _record_trace(gen, values, stop_rendered, "ok")
                _cache_store_impl(cache_fn, cache_key, stop_rendered)
                return stop_rendered
        else:
            parsed_bundle = {}
            parse_state = {}
            try:
                parsed = _parse_sample_outputs(gen, output_fields, response, validate_exact_json, thought_field, thought_prefix, text_contract, strict_mode, parse_state)
                parsed_bundle = parsed
            except Exception as validation_error:
                refusal_message = _core_exception_message(validation_error)
                refusal = _core_string_starts_with(refusal_message, "Decision refused:")
                if refusal:
                    raise validation_error
                else:
                    pass
                retries_exhausted = _core_gte(attempt, validation_retries)
                if retries_exhausted:
                    output_text = _attempt_output_impl(response)
                    validation_exhausted = _unable_to_fix_impl(validation_error, output_text)
                    raise validation_exhausted
                else:
                    pass
                next_attempt = _core_add(attempt, 1)
                attempt = next_attempt
                thought_prefix = ""
                answer_parsed = _core_get(parse_state, "parsed", False)
                if answer_parsed:
                    settled_for_retry = _settle_failed_attempts_impl(messages, failed_messages, memory_cleanup)
                    messages = settled_for_retry
                    failed_messages = []
                else:
                    pass
                retry_messages = _append_assertion_retry_messages(failed_messages, response, validation_error)
                failed_messages = retry_messages
                _core_axgen_memory_add_correction(gen, response, validation_error)
                continue
            assertion_failure = _core_get(parsed_bundle, "assertion_failure", None)
            assertion_failed = _core_is_not_none(assertion_failure)
            if assertion_failed:
                assertion_fatal = _generate_failed_impl(assertion_failure)
                raise assertion_fatal
            else:
                pass
            length_failure = _max_tokens_error_impl(response)
            length_failed = _core_is_not_none(length_failure)
            if length_failed:
                length_fatal = _generate_failed_impl(length_failure)
                raise length_fatal
            else:
                pass
            empty_feedback = []
            feedback = _core_get(parsed_bundle, "feedback", empty_feedback)
            feedback_count = _core_len(feedback)
            fed_back = _core_gt(feedback_count, 0)
            if fed_back:
                settled_for_feedback = _settle_failed_attempts_impl(messages, failed_messages, memory_cleanup)
                messages = settled_for_feedback
                failed_messages = []
                answer_content = _core_get(response, "content", "")
                answer_message = {}
                answer_message["role"] = "assistant"
                answer_message["content"] = answer_content
                messages.append(answer_message)
                feedback_messages = []
                for feedback_text in feedback:
                    feedback_message = _feedback_message_impl(feedback_text)
                    messages.append(feedback_message)
                    feedback_messages.append(feedback_message)
                _core_axgen_memory_add_request(gen, feedback_messages)
                _core_axgen_memory_cleanup_corrections(gen)
                feedback_step = _core_add(step, 1)
                step = feedback_step
                attempt = 0
                infra_attempt = 0
                feedback_thought = _core_get(response, "thought", "")
                feedback_joined = _core_add(thought_prefix, feedback_thought)
                thought_prefix = feedback_joined
                continue
            else:
                pass
            control_pending = _core_ai_control_pending_count(client)
            steered = _core_gt(control_pending, 0)
            if steered:
                settled_for_steer = _settle_failed_attempts_impl(messages, failed_messages, memory_cleanup)
                messages = settled_for_steer
                failed_messages = []
                steered_content = _core_get(response, "content", "")
                steered_message = {}
                steered_message["role"] = "assistant"
                steered_message["content"] = steered_content
                messages.append(steered_message)
                _core_axgen_memory_cleanup_corrections(gen)
                steered_step = _core_add(step, 1)
                step = steered_step
                attempt = 0
                infra_attempt = 0
                steered_thought = _core_get(response, "thought", "")
                steered_joined = _core_add(thought_prefix, steered_thought)
                thought_prefix = steered_joined
                continue
            else:
                pass
            public_outputs = _core_get(parsed_bundle, "outputs", None)
            structured_samples = _core_get(parsed_bundle, "samples", None)
            selected_index = _select_sample_index(structured_samples, runtime_options)
            empty_public = {}
            public_output = _core_list_get(public_outputs, selected_index, empty_public)
            _core_axgen_memory_cleanup_corrections(gen)
            rendered_output = _render_audio_outputs_impl(gen, client, public_output, options)
            _record_trace(gen, values, rendered_output, "ok")
            _cache_store_impl(cache_fn, cache_key, rendered_output)
            return rendered_output
    raise RuntimeError("unreachable AxGen forward loop exit")


def _date_offset_zone_minutes_impl(units: Any, start: Any, end: Any) -> Any:
    _core_coverage_mark("_date_offset_zone_minutes_impl")
    none = _core_none()
    length = _core_mul(start, -1)
    length = _core_add(length, end)
    sign_unit = _core_get(units, start, 0)
    sign = 0
    plus = _core_eq(sign_unit, 43)
    if plus:
        sign = 1
    else:
        pass
    minus = _core_eq(sign_unit, 45)
    math_minus = _core_eq(sign_unit, 8722)
    negative = _core_or(minus, math_minus)
    if negative:
        sign = -1
    else:
        pass
    no_sign = _core_eq(sign, 0)
    if no_sign:
        return none
    else:
        pass
    hour_at = _core_add(start, 1)
    hours = _date_digits_impl(units, hour_at, 2, end)
    bad_hours = _core_lt(hours, 0)
    if bad_hours:
        return none
    else:
        pass
    minutes = 0
    short_form = _core_eq(length, 3)
    compact = _core_eq(length, 5)
    colon = _core_eq(length, 6)
    if compact:
        compact_at = _core_add(start, 3)
        minutes = _date_digits_impl(units, compact_at, 2, end)
    else:
        pass
    if colon:
        colon_at = _core_add(start, 3)
        colon_unit = _core_get(units, colon_at, 0)
        is_colon = _core_eq(colon_unit, 58)
        if is_colon:
            colon_minutes_at = _core_add(start, 4)
            minutes = _date_digits_impl(units, colon_minutes_at, 2, end)
        else:
            minutes = -1
    else:
        pass
    known_length = _core_or(short_form, compact)
    known_length = _core_or(known_length, colon)
    unknown_length = _core_not(known_length)
    if unknown_length:
        return none
    else:
        pass
    bad_minutes = _core_lt(minutes, 0)
    hours_range = _core_gt(hours, 23)
    minutes_range = _core_gt(minutes, 59)
    invalid = _core_or(bad_minutes, hours_range)
    invalid = _core_or(invalid, minutes_range)
    if invalid:
        return none
    else:
        pass
    total = _core_mul(hours, 60)
    total = _core_add(total, minutes)
    has_sign = _core_mul(total, sign)
    return has_sign


def _stream_js_number_impl(value: Any) -> Any:
    _core_coverage_mark("_stream_js_number_impl")
    is_number = _core_type_is(value, "number")
    if is_number:
        return value
    else:
        pass
    is_null = _core_is_none(value)
    if is_null:
        return 0
    else:
        pass
    is_boolean = _core_type_is(value, "boolean")
    if is_boolean:
        if value:
            return 1
        else:
            pass
        return 0
    else:
        pass
    is_string = _core_type_is(value, "string")
    is_list = _core_type_is(value, "list")
    text = ""
    if is_string:
        text = value
    else:
        if is_list:
            text = _stream_js_string_impl(value)
        else:
            nan = _core_none()
            return nan
    trimmed = str(text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    empty = _core_eq(trimmed, "")
    if empty:
        return 0
    else:
        pass
    base = 0
    digits = ""
    hex = _core_regex_match("^0[xX][0-9a-fA-F]+$", trimmed)
    if hex:
        base = 16
    else:
        pass
    octal = _core_regex_match("^0[oO][0-7]+$", trimmed)
    if octal:
        base = 8
    else:
        pass
    binary = _core_regex_match("^0[bB][01]+$", trimmed)
    if binary:
        base = 2
    else:
        pass
    radix = _core_gt(base, 0)
    if radix:
        digits = _core_string_slice(trimmed, 2)
        lower_digits = _core_string_lower(digits)
        alphabet = "0123456789abcdef"
        total = 0
        count = _core_len(lower_digits)
        cursor = 0
        while True:
            done = _core_gte(cursor, count)
            if done:
                break
            else:
                pass
            next = _core_add(cursor, 1)
            ch = _core_string_slice(lower_digits, cursor, next)
            digit = _core_string_index_of(alphabet, ch, 0)
            scaled = _core_mul(total, base)
            total = _core_add(scaled, digit)
            cursor = next
        return total
    else:
        pass
    decimal = _core_regex_match("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$", trimmed)
    not_decimal = _core_not(decimal)
    if not_decimal:
        nan = _core_none()
        return nan
    else:
        pass
    sign = ""
    magnitude = trimmed
    plus = _core_string_starts_with(trimmed, "+")
    minus = _core_string_starts_with(trimmed, "-")
    has_sign = _core_or(plus, minus)
    if has_sign:
        if minus:
            sign = "-"
        else:
            pass
        magnitude = _core_string_slice(trimmed, 1)
    else:
        pass
    mantissa = magnitude
    exponent = ""
    lower_unsigned = _core_string_lower(magnitude)
    e_at = _core_string_index_of(lower_unsigned, "e", 0)
    has_exponent = _core_gte(e_at, 0)
    if has_exponent:
        mantissa = _core_string_slice(magnitude, 0, e_at)
        exponent = _core_string_slice(magnitude, e_at)
    else:
        pass
    whole_part = mantissa
    fraction_part = ""
    dot_at = _core_string_index_of(mantissa, ".", 0)
    has_dot = _core_gte(dot_at, 0)
    if has_dot:
        whole_part = _core_string_slice(mantissa, 0, dot_at)
        after_dot = _core_add(dot_at, 1)
        fraction_part = _core_string_slice(mantissa, after_dot)
    else:
        pass
    while True:
        leading_zero = _core_string_starts_with(whole_part, "0")
        whole_length = _core_len(whole_part)
        more = _core_gt(whole_length, 1)
        strip = _core_and(leading_zero, more)
        keep = _core_not(strip)
        if keep:
            break
        else:
            pass
        whole_part = _core_string_slice(whole_part, 1)
    no_whole = _core_eq(whole_part, "")
    if no_whole:
        whole_part = "0"
    else:
        pass
    literal = _core_add(sign, whole_part)
    has_fraction = _core_ne(fraction_part, "")
    if has_fraction:
        with_dot = _core_add(literal, ".")
        literal = _core_add(with_dot, fraction_part)
    else:
        pass
    literal = _core_add(literal, exponent)
    parsed = _core_json_parse_strict(literal)
    return parsed


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


def _evidence_decode_values_impl(fields: list[Any], values: Any, context: Any, prefix: str) -> Any:
    _core_coverage_mark("_evidence_decode_values_impl")
    for field in fields:
        name = _core_get(field, "name", None)
        typ = _core_get(field, "type", None)
        value = _core_get(values, name, None)
        present = _core_is_not_none(value)
        if present:
            path = name
            qualified = _core_ne(prefix, "")
            if qualified:
                path = _core_string_format("{}.{}", prefix, name)
            else:
                pass
            decision = _evidence_is_type_impl(typ)
            children = _core_get(typ, "fields", None)
            has_children = _core_is_not_none(children)
            array = _core_get(typ, "is_array", False)
            items = []
            if array:
                items = value
            else:
                items.append(value)
            decoded = []
            index = 0
            for item in items:
                item_path = path
                if array:
                    item_path = _core_string_format("{}[{}]", path, index)
                else:
                    pass
                if decision:
                    item = _evidence_decode_one_impl(typ, item, context, item_path)
                else:
                    if has_children:
                        nested = _core_fields_from_map(children)
                        item = _evidence_decode_values_impl(nested, item, context, item_path)
                    else:
                        pass
                decoded.append(item)
                index = _core_add(index, 1)
            if array:
                values[name] = decoded
            else:
                single = _core_list_get(decoded, 0)
                values[name] = single
        else:
            pass
    return values


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
    version = _core_get(state, "version", 0)
    output = {}
    output["response_id"] = id
    output["text"] = text
    output["version"] = version
    return output


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


def _date_zone_offset_seconds_impl(zone: Any, millis: Any) -> Any:
    _core_coverage_mark("_date_zone_offset_seconds_impl")
    kind = _core_get(zone, "kind", None)
    fixed = _core_eq(kind, "fixed")
    if fixed:
        fixed_seconds = _core_get(zone, "offset_seconds", None)
        return fixed_seconds
    else:
        pass
    name = _core_get(zone, "name", None)
    seconds = _core_date_zone_offset(name, millis)
    return seconds


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


def _evidence_context_impl(response: Any, client: Any) -> Any:
    _core_coverage_mark("_evidence_context_impl")
    trusted = _core_get(response, "decisionContext", None)
    found = _core_is_not_none(trusted)
    if found:
        return trusted
    else:
        pass
    usage = _core_get(response, "modelUsage", None)
    provenance = {}
    provenance["source"] = "elicited"
    provider = _core_get(usage, "ai", "AI")
    model = _core_get(usage, "model", None)
    provenance["provider"] = provider
    found_model = _core_is_not_none(model)
    if found_model:
        provenance["model"] = model
    else:
        pass
    context = {}
    context["provenance"] = provenance
    return context


def _date_parts_in_zone_impl(zone: Any, millis: Any) -> Any:
    _core_coverage_mark("_date_parts_in_zone_impl")
    seconds = _date_zone_offset_seconds_impl(zone, millis)
    shift = _core_mul(seconds, 1000)
    local = _core_add(millis, shift)
    parts = _date_parts_of_ms_impl(local)
    year = _core_get(parts, "year", None)
    before_era = _core_lte(year, 0)
    if before_era:
        negated = _core_mul(year, -1)
        era_year = _core_add(negated, 1)
        parts["year"] = era_year
    else:
        pass
    return parts


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
    turns = []
    state["turns"] = turns
    return state


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


def _date_zone_offset_millis_impl(zone: Any, millis: Any) -> Any:
    _core_coverage_mark("_date_zone_offset_millis_impl")
    parts = _date_parts_in_zone_impl(zone, millis)
    local = _date_utc_ms_impl(parts)
    negated = _core_mul(millis, -1)
    offset = _core_add(local, negated)
    return offset


def chat_session_target_matches(target: str, path: str) -> bool:
    _core_coverage_mark("chat_session_target_matches")
    exact = _core_eq(target, path)
    prefix = _core_string_format("{}/", target)
    descendant = _core_string_starts_with(path, prefix)
    matches = _core_or(exact, descendant)
    return matches


def _date_named_timestamp_impl(parts: Any, zone: Any) -> Any:
    _core_coverage_mark("_date_named_timestamp_impl")
    utc = _date_utc_ms_impl(parts)
    offset = _date_zone_offset_millis_impl(zone, utc)
    negated = _core_mul(offset, -1)
    timestamp = _core_add(utc, negated)
    adjusted = _date_zone_offset_millis_impl(zone, timestamp)
    moved = _core_ne(adjusted, offset)
    if moved:
        adjusted_negated = _core_mul(adjusted, -1)
        timestamp = _core_add(utc, adjusted_negated)
    else:
        pass
    actual = _date_parts_in_zone_impl(zone, timestamp)
    same = _date_same_parts_impl(actual, parts)
    different = _core_not(same)
    if different:
        error = _date_values_error_impl()
        raise error
    else:
        pass
    return timestamp


def _stream_field_flag_impl(target: Any, snake: str, camel: str) -> bool:
    _core_coverage_mark("_stream_field_flag_impl")
    snake_value = _core_get(target, snake, False)
    value = _core_get(target, camel, snake_value)
    flag = _core_truthy(value)
    return flag


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


def _stream_field_type_label_impl(field: Any) -> str:
    _core_coverage_mark("_stream_field_type_label_impl")
    typ = _core_get(field, "type", None)
    name = _core_get(typ, "name", "string")
    base = "string"
    is_number = _core_eq(name, "number")
    if is_number:
        base = "number"
    else:
        pass
    is_boolean = _core_eq(name, "boolean")
    if is_boolean:
        base = "boolean"
    else:
        pass
    is_date = _core_eq(name, "date")
    if is_date:
        base = "date (YYYY-MM-DD, e.g. 2024-05-09)"
    else:
        pass
    is_datetime = _core_eq(name, "datetime")
    if is_datetime:
        base = "datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z)"
    else:
        pass
    is_date_range = _core_eq(name, "dateRange")
    if is_date_range:
        base = "date range ({ \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\" })"
    else:
        pass
    is_datetime_range = _core_eq(name, "datetimeRange")
    if is_datetime_range:
        base = "datetime range ({ \"start\": \"2024-05-09T14:30:00Z\", \"end\": \"2024-05-09T15:30:00Z\" })"
    else:
        pass
    is_json = _core_eq(name, "json")
    if is_json:
        base = "JSON object"
    else:
        pass
    is_class = _core_eq(name, "class")
    if is_class:
        base = "classification class"
    else:
        pass
    is_code = _core_eq(name, "code")
    if is_code:
        base = "code"
    else:
        pass
    is_object = _core_eq(name, "object")
    if is_object:
        base = "object"
    else:
        pass
    is_array = _stream_field_flag_impl(typ, "is_array", "isArray")
    if is_array:
        array_label = _core_string_format("array of {}s", base)
        return array_label
    else:
        pass
    return base


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


def _date_parse_range_impl(value: Any, kind: Any) -> Any:
    _core_coverage_mark("_date_parse_range_impl")
    endpoints = _date_range_endpoints_impl(value)
    range_millis = {}
    names = []
    names.append("start")
    names.append("end")
    for key in names:
        endpoint = _core_get(endpoints, key, None)
        is_text = _core_type_is(endpoint, "string")
        not_text = _core_not(is_text)
        if not_text:
            shape_error = _date_range_format_error_impl()
            raise shape_error
        else:
            pass
        is_date = _core_eq(kind, "date")
        if is_date:
            date_millis = _date_parse_date_impl(endpoint)
            range_millis[key] = date_millis
        else:
            datetime_millis = _date_parse_datetime_impl(endpoint)
            range_millis[key] = datetime_millis
    start = _core_get(range_millis, "start", None)
    end = _core_get(range_millis, "end", None)
    reversed = _core_lt(end, start)
    if reversed:
        order_error = _core_runtime_error("Invalid range. End must be greater than or equal to start.")
        raise order_error
    else:
        pass
    return range_millis


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


def chat_session_result(response: Any, id: str) -> Any:
    _core_coverage_mark("chat_session_result")
    empty = {}
    response = _core_map_merge(response, empty)
    response["__session_response_id"] = id
    return response


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
    validation_none = _core_none()
    validation_snake = _core_get(opts, "validation_examples", validation_none)
    validation_examples = _core_get(opts, "validationExamples", validation_snake)
    has_validation_examples = _core_is_not_none(validation_examples)
    if has_validation_examples:
        normalized["validation"] = validation_examples
    else:
        pass
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


def chat_session_record_response(gen: Any, state: Any, request: Any, completion: Any) -> None:
    _core_coverage_mark("chat_session_record_response")
    _core_axgen_memory_add_response(gen, request, completion)
    _core_axgen_record_chat_log(gen, request, completion)
    empty_turns = []
    turns = _core_get(state, "turns", empty_turns)
    calls = _response_function_calls_impl(completion)
    call_count = _core_len(calls)
    has_calls = _core_gt(call_count, 0)
    if has_calls:
        turns = _append_tool_call_messages_impl(turns, completion, calls)
    else:
        content = _core_get(completion, "content", "")
        has_content = _core_truthy(content)
        if has_content:
            message = {}
            message["role"] = "assistant"
            message["content"] = content
            turns.append(message)
        else:
            pass
    state["turns"] = turns
    return None


def _date_range_format_error_impl() -> Any:
    _core_coverage_mark("_date_range_format_error_impl")
    error = _core_runtime_error("Invalid range format. Provide a JSON object with \"start\" and \"end\", a two-item array, or an interval using start/end.")
    return error


def _stream_field_title_impl(field: Any) -> str:
    _core_coverage_mark("_stream_field_title_impl")
    name = _core_get(field, "name", "")
    title = _core_get(field, "title", name)
    has_title = _core_truthy(title)
    if has_title:
        return title
    else:
        pass
    return name


def _date_range_endpoints_impl(value: Any) -> Any:
    _core_coverage_mark("_date_range_endpoints_impl")
    is_text = _core_type_is(value, "string")
    if is_text:
        from_text = _date_range_string_impl(value)
        return from_text
    else:
        pass
    endpoints = {}
    is_list = _core_type_is(value, "list")
    if is_list:
        count = _core_len(value)
        pair = _core_eq(count, 2)
        if pair:
            first = _core_list_get(value, 0)
            endpoints["start"] = first
            second = _core_list_get(value, 1)
            endpoints["end"] = second
            return endpoints
        else:
            pass
        list_error = _date_range_format_error_impl()
        raise list_error
    else:
        pass
    is_object = _core_type_is(value, "object")
    if is_object:
        start = _core_get(value, "start", None)
        no_start = _core_is_none(start)
        if no_start:
            start = _core_get(value, "from", None)
        else:
            pass
        end = _core_get(value, "end", None)
        no_end = _core_is_none(end)
        if no_end:
            end = _core_get(value, "to", None)
        else:
            pass
        has_start = _core_is_not_none(start)
        has_end = _core_is_not_none(end)
        complete = _core_and(has_start, has_end)
        if complete:
            endpoints["start"] = start
            endpoints["end"] = end
            return endpoints
        else:
            pass
    else:
        pass
    error = _date_range_format_error_impl()
    raise error


def _stream_required_missing_error_impl(field: Any) -> error:
    _core_coverage_mark("_stream_required_missing_error_impl")
    title = _stream_field_title_impl(field)
    label = _stream_field_type_label_impl(field)
    message = _core_string_format("Required field is missing: '{}'. After the \"{}:\" label, provide a non-empty {}. Do not use null, undefined, or leave it blank.", title, title, label)
    error = _core_validation_error(message)
    return error


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


def chat_session_step_limit_error(state: Any) -> error:
    _core_coverage_mark("chat_session_step_limit_error")
    running = []
    empty_pending = {}
    pending = _core_get(state, "pending", empty_pending)
    pending_ids = _core_map_keys(pending)
    for pending_id in pending_ids:
        record = _core_get(pending, pending_id, None)
        status = _core_get(record, "status", None)
        is_running = _core_eq(status, "running")
        if is_running:
            running.append(pending_id)
        else:
            pass
    count = _core_len(running)
    ids = _core_string_join(", ", running)
    no_ids = _core_eq(ids, "")
    if no_ids:
        ids = "none"
    else:
        pass
    message = _core_string_format("Chat session failed: Maximum steps reached with unincorporated tool results ({}); unresolved calls: {}", count, ids)
    error = _core_runtime_error(message)
    return error


def _stream_url_error_impl(field: Any, value: Any) -> Any:
    _core_coverage_mark("_stream_url_error_impl")
    title = _stream_field_title_impl(field)
    is_string = _core_type_is(value, "string")
    not_string = _core_not(is_string)
    if not_string:
        shown = _stream_js_string_impl(value)
        type_message = _core_string_format("Invalid URL for '{}': URL must be a string. Use a valid URL format (e.g., https://example.com). You provided: {}.", title, shown)
        type_error = _core_validation_error(type_message)
        return type_error
    else:
        pass
    valid = _core_url_valid(value)
    if valid:
        none = _core_none()
        return none
    else:
        pass
    message = _core_string_format("Invalid URL for '{}': Invalid URL format. Expected a valid URL like https://example.com. Use a valid URL format (e.g., https://example.com). You provided: {}.", title, value)
    error = _core_validation_error(message)
    return error


def chat_session_final_result(state: Any, response: Any) -> Any:
    _core_coverage_mark("chat_session_final_result")
    id = _core_get(state, "response_id", "")
    result = chat_session_result(response, id)
    empty_turns = []
    turns = _core_get(state, "turns", empty_turns)
    result["__session_turns"] = turns
    return result


def _stream_validate_constraints_impl(field: Any, value: Any, kind: str) -> None:
    _core_coverage_mark("_stream_validate_constraints_impl")
    title = _stream_field_title_impl(field)
    typ = _core_get(field, "type", None)
    is_url = _core_eq(kind, "url")
    if is_url:
        url_error = _stream_url_error_impl(field, value)
        bad_url = _core_is_not_none(url_error)
        if bad_url:
            raise url_error
        else:
            pass
        return None
    else:
        pass
    is_number_kind = _core_eq(kind, "number")
    if is_number_kind:
        is_number = _core_type_is(value, "number")
        not_number = _core_not(is_number)
        if not_number:
            return None
        else:
            pass
        minimum = _core_get(typ, "minimum", None)
        has_minimum = _core_is_not_none(minimum)
        if has_minimum:
            too_small = _core_lt(value, minimum)
            if too_small:
                minimum_message = _core_string_format("Field '{}' failed validation: Number must be at least {}. You provided: {}.", title, minimum, value)
                minimum_error = _core_validation_error(minimum_message)
                raise minimum_error
            else:
                pass
        else:
            pass
        maximum = _core_get(typ, "maximum", None)
        has_maximum = _core_is_not_none(maximum)
        if has_maximum:
            too_large = _core_gt(value, maximum)
            if too_large:
                maximum_message = _core_string_format("Field '{}' failed validation: Number must be at most {}. You provided: {}.", title, maximum, value)
                maximum_error = _core_validation_error(maximum_message)
                raise maximum_error
            else:
                pass
        else:
            pass
        return None
    else:
        pass
    is_string = _core_type_is(value, "string")
    not_string = _core_not(is_string)
    if not_string:
        return None
    else:
        pass
    units = _core_string_utf16_units(value)
    length = _core_len(units)
    min_snake = _core_get(typ, "min_length", None)
    min_length = _core_get(typ, "minLength", min_snake)
    has_min = _core_is_not_none(min_length)
    if has_min:
        too_short = _core_lt(length, min_length)
        if too_short:
            short_message = _core_string_format("Field '{}' failed validation: String must be at least {} characters long. You provided: \"{}\" ({} characters).", title, min_length, value, length)
            short_error = _core_validation_error(short_message)
            raise short_error
        else:
            pass
    else:
        pass
    max_snake = _core_get(typ, "max_length", None)
    max_length = _core_get(typ, "maxLength", max_snake)
    has_max = _core_is_not_none(max_length)
    if has_max:
        too_long = _core_gt(length, max_length)
        if too_long:
            long_message = _core_string_format("Field '{}' failed validation: String must be at most {} characters long. You provided: \"{}\" ({} characters).", title, max_length, value, length)
            long_error = _core_validation_error(long_message)
            raise long_error
        else:
            pass
    else:
        pass
    pattern = _core_get(typ, "pattern", None)
    has_pattern = _core_is_not_none(pattern)
    if has_pattern:
        matches = _regex_test(pattern, value)
        no_match = _core_not(matches)
        if no_match:
            pattern_message = _core_string_format("Field '{}' failed validation: String must match pattern /{}/. You provided: \"{}\".", title, pattern, value)
            pattern_error = _core_validation_error(pattern_message)
            raise pattern_error
        else:
            pass
    else:
        pass
    format = _core_get(typ, "format", None)
    is_email = _core_eq(format, "email")
    if is_email:
        email_ok = _core_regex_match("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", value)
        email_bad = _core_not(email_ok)
        if email_bad:
            email_message = _core_string_format("Field '{}' failed validation: String must be a valid email address. You provided: \"{}\".", title, value)
            email_error = _core_validation_error(email_message)
            raise email_error
        else:
            pass
    else:
        pass
    is_uri = _core_eq(format, "uri")
    is_url_format = _core_eq(format, "url")
    url_format = _core_or(is_uri, is_url_format)
    if url_format:
        url_ok = _core_url_valid(value)
        url_bad = _core_not(url_ok)
        if url_bad:
            format_message = _core_string_format("Field '{}' failed validation: String must be a valid URL. You provided: \"{}\".", title, value)
            format_error = _core_validation_error(format_message)
            raise format_error
        else:
            pass
    else:
        pass
    return None


def _date_range_string_impl(value: Any) -> Any:
    _core_coverage_mark("_date_range_string_impl")
    text = _date_strip_code_fence_impl(value)
    opens_object = _core_string_starts_with(text, "{")
    opens_list = _core_string_starts_with(text, "[")
    is_json = _core_or(opens_object, opens_list)
    if is_json:
        from_json = {}
        try:
            parsed = _core_json_parse_strict(text)
            from_json = _date_range_endpoints_impl(parsed)
        except Exception as json_error:
            json_format_error = _date_range_format_error_impl()
            raise json_format_error
        return from_json
    else:
        pass
    endpoints = {}
    slash_parts = _core_string_split(text, "/")
    slash_count = _core_len(slash_parts)
    one_slash = _core_eq(slash_count, 2)
    if one_slash:
        slash_start = _core_list_get(slash_parts, 0)
        slash_start_trimmed = _date_js_trim_impl(slash_start)
        endpoints["start"] = slash_start_trimmed
        slash_end = _core_list_get(slash_parts, 1)
        slash_end_trimmed = _date_js_trim_impl(slash_end)
        endpoints["end"] = slash_end_trimmed
        return endpoints
    else:
        pass
    split = _date_delimiter_split_impl(text)
    no_split = _core_is_none(split)
    if no_split:
        error = _date_range_format_error_impl()
        raise error
    else:
        pass
    return split


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


def _date_delimiter_split_impl(text: Any) -> Any:
    _core_coverage_mark("_date_delimiter_split_impl")
    none = _core_none()
    units = _core_string_utf16_units(text)
    count = _core_len(units)
    first_terminator = count
    last_terminator = -1
    index = 0
    while True:
        scanned = _core_gte(index, count)
        if scanned:
            break
        else:
            pass
        unit = _core_get(units, index, 0)
        terminator = _date_is_line_terminator_impl(unit)
        if terminator:
            last_terminator = index
            before = _core_lt(index, first_terminator)
            if before:
                first_terminator = index
            else:
                pass
        else:
            pass
        index = _core_add(index, 1)
    cursor = 1
    while True:
        finished = _core_gte(cursor, count)
        if finished:
            break
        else:
            pass
        past_terminator = _core_gt(cursor, first_terminator)
        if past_terminator:
            break
        else:
            pass
        unit = _core_get(units, cursor, 0)
        space = _date_space_impl(unit)
        not_space = _core_not(space)
        if not_space:
            cursor = _core_add(cursor, 1)
            continue
        else:
            pass
        run_start = cursor
        keyword_at = _date_skip_space_impl(units, cursor, count)
        keyword_length = _date_range_keyword_impl(units, keyword_at, count)
        cursor = keyword_at
        no_keyword = _core_eq(keyword_length, 0)
        if no_keyword:
            continue
        else:
            pass
        after_keyword = _core_add(keyword_at, keyword_length)
        rest_at = _date_skip_space_impl(units, after_keyword, count)
        no_gap = _core_eq(rest_at, after_keyword)
        if no_gap:
            continue
        else:
            pass
        rest_empty = _core_gte(rest_at, count)
        rest_terminator = _core_gte(last_terminator, rest_at)
        rest_bad = _core_or(rest_empty, rest_terminator)
        if rest_bad:
            continue
        else:
            pass
        mode = _date_string_mode_impl()
        start_to = _date_native_offset_impl(units, run_start, mode)
        rest_from = _date_native_offset_impl(units, rest_at, mode)
        start_text = _core_string_slice(text, 0, start_to)
        rest_text = _core_string_slice(text, rest_from)
        split = {}
        start_trimmed = _date_js_trim_impl(start_text)
        split["start"] = start_trimmed
        rest_trimmed = _date_js_trim_impl(rest_text)
        split["end"] = rest_trimmed
        return split
    return none


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


def _stream_convert_value_impl(field: Any, value: Any, required: bool) -> Any:
    _core_coverage_mark("_stream_convert_value_impl")
    out = {}
    out["has"] = True
    out["value"] = value
    typ = _core_get(field, "type", None)
    name = _core_get(typ, "name", "string")
    optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
    lenient = _core_not(required)
    may_skip = _core_and(optional, lenient)
    is_code = _core_eq(name, "code")
    if is_code:
        code_text = _stream_js_string_impl(value)
        block = _stream_extract_block_impl(code_text)
        out["value"] = block
        return out
    else:
        pass
    is_string = _core_eq(name, "string")
    if is_string:
        text = _stream_js_string_impl(value)
        out["value"] = text
        return out
    else:
        pass
    is_number = _core_eq(name, "number")
    if is_number:
        number = _stream_js_number_impl(value)
        nan = _core_is_none(number)
        if nan:
            if may_skip:
                out["has"] = False
                return out
            else:
                pass
            number_error = _core_runtime_error("Invalid number")
            raise number_error
        else:
            pass
        out["value"] = number
        return out
    else:
        pass
    is_boolean = _core_eq(name, "boolean")
    if is_boolean:
        already = _core_type_is(value, "boolean")
        if already:
            return out
        else:
            pass
        bool_text = _stream_js_string_impl(value)
        lowered = _core_string_lower(bool_text)
        is_true = _core_eq(lowered, "true")
        if is_true:
            out["value"] = True
            return out
        else:
            pass
        is_false = _core_eq(lowered, "false")
        if is_false:
            out["value"] = False
            return out
        else:
            pass
        if may_skip:
            out["has"] = False
            return out
        else:
            pass
        boolean_error = _core_runtime_error("Invalid boolean")
        raise boolean_error
    else:
        pass
    is_class = _core_eq(name, "class")
    if is_class:
        class_name = _stream_js_string_impl(value)
        options = _core_get(typ, "options", None)
        has_options = _core_truthy(options)
        if has_options:
            known = _core_contains(options, class_name)
            unknown = _core_not(known)
            if unknown:
                if optional:
                    out["has"] = False
                    return out
                else:
                    pass
                option_list = _core_string_join(", ", options)
                class_message = _core_string_format("Invalid class '{}', expected one of the following: {}", class_name, option_list)
                class_error = _core_runtime_error(class_message)
                raise class_error
            else:
                pass
        else:
            pass
        out["value"] = class_name
        return out
    else:
        pass
    parse_dates = _core_get(field, "parse_dates", False)
    dated = _date_is_date_type_impl(name)
    parse = _core_and(parse_dates, dated)
    if parse:
        date_out = _date_convert_field_value_impl(field, name, value, may_skip)
        return date_out
    else:
        pass
    return out


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
        limit_error = chat_session_step_limit_error(state)
        raise limit_error
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


def _date_range_keyword_impl(units: Any, at: Any, end: Any) -> Any:
    _core_coverage_mark("_date_range_keyword_impl")
    unit = _core_get(units, at, 0)
    hyphen = _core_eq(unit, 45)
    en_dash = _core_eq(unit, 8211)
    em_dash = _core_eq(unit, 8212)
    is_dash = _core_or(hyphen, en_dash)
    is_dash = _core_or(is_dash, em_dash)
    dash_inside = _core_lt(at, end)
    is_dash = _core_and(is_dash, dash_inside)
    if is_dash:
        after_dash = _core_add(at, 1)
        dash_space = False
        dash_followed = _core_lt(after_dash, end)
        if dash_followed:
            dash_next = _core_get(units, after_dash, 0)
            dash_space = _date_space_impl(dash_next)
        else:
            pass
        if dash_space:
            return 1
        else:
            pass
        return 0
    else:
        pass
    letters = []
    letters.append("to")
    letters.append("through")
    letters.append("until")
    for word in letters:
        word_units = _core_string_utf16_units(word)
        length = _core_len(word_units)
        matched = _date_ascii_matches_impl(units, at, end, word_units)
        if matched:
            after_word = _core_add(at, length)
            word_inside = _core_lt(after_word, end)
            if word_inside:
                word_next = _core_get(units, after_word, 0)
                word_space = _date_space_impl(word_next)
                if word_space:
                    return length
                else:
                    pass
            else:
                pass
        else:
            pass
    return 0


def _set_examples(gen: AxGen, examples: list[Any]) -> AxGen:
    _core_coverage_mark("_set_examples")
    gen["examples"] = examples
    return gen


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


def _set_demos(gen: AxGen, demos: list[Any]) -> AxGen:
    _core_coverage_mark("_set_demos")
    gen["demos"] = demos
    return gen


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


def _render_examples(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_examples")
    messages = _core_axgen_render_examples(gen)
    return messages


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


def _date_strip_code_fence_impl(value: Any) -> Any:
    _core_coverage_mark("_date_strip_code_fence_impl")
    text = _date_js_trim_impl(value)
    units = _core_string_utf16_units(text)
    count = _core_len(units)
    too_short = _core_lt(count, 6)
    if too_short:
        return text
    else:
        pass
    opens = _core_string_starts_with(text, "```")
    closes = _core_string_ends_with(text, "```")
    fenced = _core_and(opens, closes)
    not_fenced = _core_not(fenced)
    if not_fenced:
        return text
    else:
        pass
    inner_start = 3
    inner_end = _core_add(count, -3)
    json_units = _core_string_utf16_units("json")
    tagged = _date_ascii_matches_impl(units, 3, inner_end, json_units)
    if tagged:
        inner_start = 7
    else:
        pass
    mode = _date_string_mode_impl()
    slice_from = _date_native_offset_impl(units, inner_start, mode)
    slice_to = _date_native_offset_impl(units, inner_end, mode)
    inner = _core_string_slice(text, slice_from, slice_to)
    stripped = _date_js_trim_impl(inner)
    return stripped


def _render_demos(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_demos")
    messages = _core_axgen_render_demos(gen)
    return messages


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


def _apply_field_processors(gen: AxGen, output: Any) -> Any:
    _core_coverage_mark("_apply_field_processors")
    processed = _core_axgen_apply_field_processors(gen, output)
    return processed


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


def _run_assertions(gen: AxGen, output: Any) -> Any:
    _core_coverage_mark("_run_assertions")
    result = _core_axgen_run_assertions(gen, output)
    status = _core_get(result, "status", "pass")
    threw = _core_eq(status, "error")
    if threw:
        thrown = _core_get(result, "error", None)
        return thrown
    else:
        pass
    failed = _core_eq(status, "fail")
    if failed:
        message = _core_get(result, "message", None)
        has_message = _core_is_not_none(message)
        if has_message:
            assertion_error = _core_runtime_error(message)
            raise assertion_error
        else:
            pass
        message_less = _core_runtime_error("Assertion failed without message")
        return message_less
    else:
        pass
    passed = _core_none()
    return passed


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
        trimmed_description = str(description).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
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
    result = str(combined).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    return result


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


def _stream_field_value_impl(field: Any, text: str) -> Any:
    _core_coverage_mark("_stream_field_value_impl")
    out = {}
    out["has"] = False
    none = _core_none()
    out["value"] = none
    optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
    title = _stream_field_title_impl(field)
    type_label = _stream_field_type_label_impl(field)
    empty = _core_eq(text, "")
    lowered = _core_string_lower(text)
    null_rest = "x"
    starts_null = _core_string_starts_with(lowered, "null")
    if starts_null:
        after_null = _core_string_slice(lowered, 4)
        null_rest = str(after_null).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    else:
        pass
    starts_undefined = _core_string_starts_with(lowered, "undefined")
    if starts_undefined:
        after_undefined = _core_string_slice(lowered, 9)
        null_rest = str(after_undefined).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    else:
        pass
    null_text = _core_eq(null_rest, "")
    missing = _core_or(empty, null_text)
    if missing:
        if optional:
            return out
        else:
            pass
        missing_error = _stream_required_missing_error_impl(field)
        raise missing_error
    else:
        pass
    typ = _core_get(field, "type", None)
    name = _core_get(typ, "name", "string")
    is_array = _stream_field_flag_impl(typ, "is_array", "isArray")
    is_json = _core_eq(name, "json")
    not_array = _core_not(is_array)
    json_scalar = _core_and(is_json, not_array)
    if json_scalar:
        try:
            json_text = _stream_extract_block_impl(text)
            json_value = _core_json_parse_strict(json_text)
            out["has"] = True
            out["value"] = json_value
        except Exception as json_error:
            json_detail = _core_exception_message(json_error)
            json_message = _core_string_format("Invalid JSON: {} in field '{}'. Return only valid JSON. Prefer a fenced code block containing a single JSON object or array with no trailing text.", json_detail, title)
            invalid_json = _core_validation_error(json_message)
            raise invalid_json
        return out
    else:
        pass
    value = _core_none()
    has_value = False
    if is_array:
        try:
            parsed_list = _core_none()
            try:
                parsed_list = _core_json_parse_strict(text)
            except Exception as not_json:
                parsed_list = _stream_markdown_list_impl(text)
            is_list = _core_type_is(parsed_list, "list")
            not_list = _core_not(is_list)
            if not_list:
                shape_error = _core_runtime_error("Expected an array")
                raise shape_error
            else:
                pass
            value = parsed_list
        except Exception as array_error:
            array_detail = _core_exception_message(array_error)
            no_items = _core_string_index_of(array_detail, "no valid list items found", 0)
            found_no_items = _core_gte(no_items, 0)
            expected_array = _core_eq(array_detail, "Expected an array")
            single_value = _core_or(found_no_items, expected_array)
            if single_value:
                single = []
                single.append(text)
                value = single
            else:
                array_message = _core_string_format("Invalid Array: {} for '{}'. Provide a JSON array of {} items (e.g., [ ... ]). Markdown lists are also accepted if each item is on its own line starting with a hyphen.", array_detail, title, type_label)
                invalid_array = _core_validation_error(array_message)
                raise invalid_array
        has_value = True
    else:
        pass
    try:
        if is_array:
            converted_items = []
            is_object_type = _core_eq(name, "object")
            json_items = _core_or(is_object_type, is_json)
            for item in value:
                item_value = item
                item_is_string = _core_type_is(item, "string")
                if item_is_string:
                    item_value = str(item).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
                    if json_items:
                        try:
                            item_block = _stream_extract_block_impl(item_value)
                            item_value = _core_json_parse_strict(item_block)
                        except Exception as item_json_error:
                            pass
                    else:
                        pass
                else:
                    pass
                converted = _stream_convert_value_impl(field, item_value, True)
                converted_has = _core_get(converted, "has", False)
                if converted_has:
                    converted_value = _core_get(converted, "value", None)
                    converted_items.append(converted_value)
                else:
                    undefined_item = _core_none()
                    converted_items.append(undefined_item)
            value = converted_items
        else:
            scalar = _stream_convert_value_impl(field, text, False)
            has_value = _core_get(scalar, "has", False)
            value = _core_get(scalar, "value", None)
    except Exception as convert_error:
        convert_detail = _core_exception_message(convert_error)
        convert_message = _core_string_format("Field '{}' has an invalid value '{}': {}. Provide a {}. Ensure formatting exactly matches the expected type.", title, text, convert_detail, type_label)
        invalid_value = _core_validation_error(convert_message)
        raise invalid_value
    not_has = _core_not(has_value)
    if not_has:
        return out
    else:
        pass
    value_is_string = _core_type_is(value, "string")
    if value_is_string:
        empty_value = _core_eq(value, "")
        if empty_value:
            return out
        else:
            pass
    else:
        pass
    is_url = _core_eq(name, "url")
    is_code = _core_eq(name, "code")
    is_string = _core_eq(name, "string")
    string_like = _core_or(is_string, is_code)
    is_number = _core_eq(name, "number")
    scalar_url = _core_and(is_url, not_array)
    if scalar_url:
        _stream_validate_constraints_impl(field, value, "url")
    else:
        pass
    if string_like:
        _stream_validate_constraints_impl(field, value, "string")
    else:
        pass
    if is_number:
        _stream_validate_constraints_impl(field, value, "number")
    else:
        pass
    value_is_list = _core_type_is(value, "list")
    check_items = _core_and(is_array, value_is_list)
    if check_items:
        for checked in value:
            checked_missing = _core_is_none(checked)
            if checked_missing:
                continue
            else:
                pass
            if is_url:
                _stream_validate_constraints_impl(field, checked, "url")
            else:
                if string_like:
                    _stream_validate_constraints_impl(field, checked, "string")
                else:
                    pass
                if is_number:
                    _stream_validate_constraints_impl(field, checked, "number")
                else:
                    pass
    else:
        pass
    out["has"] = True
    out["value"] = value
    return out


def _date_string_mode_impl() -> Any:
    _core_coverage_mark("_date_string_mode_impl")
    accented = _core_len("é")
    wide = _core_gt(accented, 1)
    if wide:
        return "utf8"
    else:
        pass
    astral = _core_len("😀")
    pair = _core_gt(astral, 1)
    if pair:
        return "utf16"
    else:
        pass
    return "codepoint"


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


def _append_assertion_retry_messages(messages: list[Any], response: Any, error: error) -> list[Any]:
    _core_coverage_mark("_append_assertion_retry_messages")
    updated_messages = _append_validation_retry_messages_impl(messages, response, error)
    return updated_messages


def _date_native_offset_impl(units: Any, index: Any, mode: Any) -> Any:
    _core_coverage_mark("_date_native_offset_impl")
    utf16 = _core_eq(mode, "utf16")
    if utf16:
        return index
    else:
        pass
    utf8 = _core_eq(mode, "utf8")
    offset = 0
    cursor = 0
    while True:
        done = _core_gte(cursor, index)
        if done:
            break
        else:
            pass
        unit = _core_get(units, cursor, 0)
        width = 1
        high = _core_gte(unit, 55296)
        high_end = _core_lte(unit, 56319)
        is_high = _core_and(high, high_end)
        next_at = _core_add(cursor, 1)
        following = _core_get(units, next_at, 0)
        low = _core_gte(following, 56320)
        low_end = _core_lte(following, 57343)
        is_low = _core_and(low, low_end)
        is_pair = _core_and(is_high, is_low)
        step = 1
        if is_pair:
            step = 2
            if utf8:
                width = 4
            else:
                pass
        else:
            if utf8:
                two = _core_gte(unit, 128)
                if two:
                    width = 2
                else:
                    pass
                three = _core_gte(unit, 2048)
                if three:
                    width = 3
                else:
                    pass
            else:
                pass
        offset = _core_add(offset, width)
        cursor = _core_add(cursor, step)
    return offset


def _record_trace(gen: AxGen, input: Any, output: Any, status: str) -> None:
    _core_coverage_mark("_record_trace")
    _core_axgen_record_trace(gen, input, output, status)
    return None


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


def _should_continue_steps(gen: AxGen, calls: list[Any]) -> bool:
    _core_coverage_mark("_should_continue_steps")
    should_continue = _core_axgen_should_continue_steps(gen, calls)
    return should_continue


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


def _parse_output_impl(content: str) -> Any:
    _core_coverage_mark("_parse_output_impl")
    text = str(content).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    output = _core_json_parse_strict(text)
    return output


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


def _date_js_trim_impl(text: Any) -> Any:
    _core_coverage_mark("_date_js_trim_impl")
    units = _core_string_utf16_units(text)
    count = _core_len(units)
    bounds = _date_trim_bounds_impl(units, 0, count)
    start = _core_get(bounds, "start", None)
    end = _core_get(bounds, "end", None)
    mode = _date_string_mode_impl()
    slice_from = _date_native_offset_impl(units, start, mode)
    slice_to = _date_native_offset_impl(units, end, mode)
    trimmed = _core_string_slice(text, slice_from, slice_to)
    return trimmed


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
            trimmed = str(content).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
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


def _date_trim_bounds_impl(units: Any, start: Any, end: Any) -> Any:
    _core_coverage_mark("_date_trim_bounds_impl")
    first = _date_skip_space_impl(units, start, end)
    last = end
    while True:
        empty = _core_lte(last, first)
        if empty:
            break
        else:
            pass
        before = _core_add(last, -1)
        unit = _core_get(units, before, 0)
        space = _date_space_impl(unit)
        kept = _core_not(space)
        if kept:
            break
        else:
            pass
        last = before
    bounds = {}
    bounds["start"] = first
    bounds["end"] = last
    return bounds


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


def _date_skip_space_impl(units: Any, start: Any, end: Any) -> Any:
    _core_coverage_mark("_date_skip_space_impl")
    cursor = start
    while True:
        done = _core_gte(cursor, end)
        if done:
            break
        else:
            pass
        unit = _core_get(units, cursor, 0)
        space = _date_space_impl(unit)
        not_space = _core_not(space)
        if not_space:
            break
        else:
            pass
        cursor = _core_add(cursor, 1)
    return cursor


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


def _date_space_impl(unit: Any) -> bool:
    _core_coverage_mark("_date_space_impl")
    tab_low = _core_gte(unit, 9)
    tab_high = _core_lte(unit, 13)
    control = _core_and(tab_low, tab_high)
    if control:
        return True
    else:
        pass
    space = _core_eq(unit, 32)
    no_break = _core_eq(unit, 160)
    ogham = _core_eq(unit, 5760)
    en_low = _core_gte(unit, 8192)
    en_high = _core_lte(unit, 8202)
    typographic = _core_and(en_low, en_high)
    line_separator = _core_eq(unit, 8232)
    paragraph_separator = _core_eq(unit, 8233)
    narrow = _core_eq(unit, 8239)
    math_space = _core_eq(unit, 8287)
    ideographic = _core_eq(unit, 12288)
    byte_order = _core_eq(unit, 65279)
    blank = _core_or(space, no_break)
    blank = _core_or(blank, ogham)
    blank = _core_or(blank, typographic)
    blank = _core_or(blank, line_separator)
    blank = _core_or(blank, paragraph_separator)
    blank = _core_or(blank, narrow)
    blank = _core_or(blank, math_space)
    blank = _core_or(blank, ideographic)
    blank = _core_or(blank, byte_order)
    return blank


def _stream_text_state_impl() -> Any:
    _core_coverage_mark("_stream_text_state_impl")
    xstate = {}
    prev_fields = []
    xstate["prev_fields"] = prev_fields
    none = _core_none()
    xstate["curr_field"] = none
    xstate["curr_field_index"] = none
    xstate["in_assumed_field"] = False
    extracted = []
    xstate["extracted_fields"] = extracted
    streamed = {}
    xstate["streamed_index"] = streamed
    xstate["s"] = -1
    return xstate


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


def _date_is_line_terminator_impl(unit: Any) -> bool:
    _core_coverage_mark("_date_is_line_terminator_impl")
    line_feed = _core_eq(unit, 10)
    carriage_return = _core_eq(unit, 13)
    line_separator = _core_eq(unit, 8232)
    paragraph_separator = _core_eq(unit, 8233)
    terminator = _core_or(line_feed, carriage_return)
    terminator = _core_or(terminator, line_separator)
    terminator = _core_or(terminator, paragraph_separator)
    return terminator


def _stream_text_note_field_impl(xstate: Any, field: Any, init_streamed: bool) -> None:
    _core_coverage_mark("_stream_text_note_field_impl")
    name = _core_get(field, "name", "")
    empty_extracted = []
    extracted = _core_get(xstate, "extracted_fields", empty_extracted)
    seen = _core_contains(extracted, name)
    unseen = _core_not(seen)
    if unseen:
        extracted.append(name)
        xstate["extracted_fields"] = extracted
    else:
        pass
    if init_streamed:
        empty_streamed = {}
        streamed = _core_get(xstate, "streamed_index", empty_streamed)
        has_index = _core_map_contains(streamed, name)
        missing_index = _core_not(has_index)
        if missing_index:
            streamed[name] = 0
        else:
            pass
        xstate["streamed_index"] = streamed
    else:
        pass
    return None


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


def _date_ascii_letter_impl(unit: Any) -> bool:
    _core_coverage_mark("_date_ascii_letter_impl")
    upper_low = _core_gte(unit, 65)
    upper_high = _core_lte(unit, 90)
    upper = _core_and(upper_low, upper_high)
    lower_low = _core_gte(unit, 97)
    lower_high = _core_lte(unit, 122)
    lower = _core_and(lower_low, lower_high)
    letter = _core_or(upper, lower)
    return letter


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
                    content = str(raw_content).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
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


def _stream_text_extract_impl(xstate: Any, values: Any, content: str, fields: list[Any], options: Any) -> bool:
    _core_coverage_mark("_stream_text_extract_impl")
    field_count = _core_len(fields)
    while True:
        exclude = -1
        curr_index = _core_get(xstate, "curr_field_index", None)
        assumed = _core_get(xstate, "in_assumed_field", False)
        has_index = _core_is_not_none(curr_index)
        not_assumed = _core_not(assumed)
        exclude_curr = _core_and(has_index, not_assumed)
        if exclude_curr:
            exclude = curr_index
        else:
            pass
        chosen_index = -1
        chosen_field = _core_none()
        end = -1
        prefix_length = 0
        partial_prefix = False
        empty_extracted = []
        extracted = _core_get(xstate, "extracted_fields", empty_extracted)
        extracted_count = _core_len(extracted)
        is_first = _core_eq(extracted_count, 0)
        start = _core_get(xstate, "s", -1)
        position = 0
        for field in fields:
            skip_field = _core_eq(position, exclude)
            try_field = _core_not(skip_field)
            if try_field:
                labels = _stream_field_labels_impl(field)
                for label in labels:
                    prefix = _core_string_format("\n{}:", label)
                    if is_first:
                        prefix = _core_string_format("{}:", label)
                    else:
                        pass
                    match_at = _stream_matches_content_impl(content, prefix, start)
                    partial = _core_lte(match_at, -2)
                    if partial:
                        partial_prefix = True
                    else:
                        pass
                    hit = _core_gte(match_at, 0)
                    if hit:
                        first_hit = _core_eq(end, -1)
                        earlier = _core_lt(match_at, end)
                        better = _core_or(first_hit, earlier)
                        if better:
                            end = match_at
                            prefix_length = _core_len(prefix)
                            chosen_index = position
                            chosen_field = field
                        else:
                            pass
                    else:
                        pass
            else:
                pass
            position = _core_add(position, 1)
        not_found = _core_eq(end, -1)
        if not_found:
            if partial_prefix:
                return True
            else:
                pass
            skip_early_fail = _core_get(options, "skip_early_fail", False)
            if skip_early_fail:
                return False
            else:
                pass
            strict_mode = _core_get(options, "strict_mode", False)
            lenient = _core_not(strict_mode)
            curr_field = _core_get(xstate, "curr_field", None)
            no_curr = _core_is_none(curr_field)
            nothing_extracted = _core_eq(extracted_count, 0)
            single = _core_eq(field_count, 1)
            assume_start = _core_and(no_curr, nothing_extracted)
            assume_single = _core_and(assume_start, single)
            assume = _core_and(assume_single, lenient)
            if assume:
                only = _core_list_get(fields, 0)
                xstate["in_assumed_field"] = True
                xstate["curr_field"] = only
                xstate["curr_field_index"] = 0
                xstate["s"] = 0
                _stream_text_note_field_impl(xstate, only, True)
                return False
            else:
                pass
            strict_start = _core_and(assume_start, strict_mode)
            if strict_start:
                _stream_text_expect_required_impl(fields)
            else:
                pass
            break
        else:
            pass
        curr = _core_get(xstate, "curr_field", None)
        has_curr = _core_is_not_none(curr)
        in_assumed = _core_get(xstate, "in_assumed_field", False)
        leave_assumed = _core_and(has_curr, in_assumed)
        if leave_assumed:
            xstate["in_assumed_field"] = False
            assumed_name = _core_get(curr, "name", "")
            empty_streamed = {}
            streamed = _core_get(xstate, "streamed_index", empty_streamed)
            streamed[assumed_name] = 0
            xstate["streamed_index"] = streamed
            cleared = _core_none()
            xstate["curr_field"] = cleared
            has_curr = False
        else:
            pass
        if has_curr:
            raw = _stream_substring_impl(content, start, end)
            text = str(raw).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
            parsed = _stream_field_value_impl(curr, text)
            parsed_has = _core_get(parsed, "has", False)
            if parsed_has:
                curr_name = _core_get(curr, "name", "")
                parsed_value = _core_get(parsed, "value", None)
                values[curr_name] = parsed_value
            else:
                pass
            entry = {}
            entry["field"] = curr
            entry["s"] = start
            entry["e"] = end
            empty_prev = []
            prev_fields = _core_get(xstate, "prev_fields", empty_prev)
            prev_fields.append(entry)
            xstate["prev_fields"] = prev_fields
        else:
            pass
        next_start = _core_add(end, prefix_length)
        xstate["s"] = next_start
        xstate["curr_field"] = chosen_field
        xstate["curr_field_index"] = chosen_index
        _stream_text_note_field_impl(xstate, chosen_field, True)
    return False


def _date_ascii_matches_impl(units: Any, at: Any, end: Any, word: Any) -> bool:
    _core_coverage_mark("_date_ascii_matches_impl")
    length = _core_len(word)
    last = _core_add(at, length)
    past = _core_gt(last, end)
    if past:
        return False
    else:
        pass
    index = 0
    while True:
        done = _core_gte(index, length)
        if done:
            break
        else:
            pass
        position = _core_add(at, index)
        unit = _core_get(units, position, 0)
        upper_low = _core_gte(unit, 65)
        upper_high = _core_lte(unit, 90)
        upper = _core_and(upper_low, upper_high)
        if upper:
            unit = _core_add(unit, 32)
        else:
            pass
        expected = _core_get(word, index, 0)
        same = _core_eq(unit, expected)
        different = _core_not(same)
        if different:
            return False
        else:
            pass
        index = _core_add(index, 1)
    return True


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


def chat_session_close_state(state: Any) -> list[Any]:
    _core_coverage_mark("chat_session_close_state")
    state["terminal"] = True
    unresolved = chat_session_unresolved(state)
    return unresolved


def _date_digits_impl(units: Any, at: Any, count: Any, end: Any) -> Any:
    _core_coverage_mark("_date_digits_impl")
    last = _core_add(at, count)
    past = _core_gt(last, end)
    if past:
        return -1
    else:
        pass
    value = 0
    index = at
    while True:
        done = _core_gte(index, last)
        if done:
            break
        else:
            pass
        unit = _core_get(units, index, 0)
        low = _core_gte(unit, 48)
        high = _core_lte(unit, 57)
        digit = _core_and(low, high)
        not_digit = _core_not(digit)
        if not_digit:
            return -1
        else:
            pass
        scaled = _core_mul(value, 10)
        digit_value = _core_add(unit, -48)
        value = _core_add(scaled, digit_value)
        index = _core_add(index, 1)
    return value


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


def _date_expect_unit_impl(units: Any, at: Any, end: Any, expected: Any) -> bool:
    _core_coverage_mark("_date_expect_unit_impl")
    inside = _core_lt(at, end)
    if inside:
        unit = _core_get(units, at, 0)
        same = _core_eq(unit, expected)
        return same
    else:
        pass
    return False


def _regex_push(stack: Any, top: Any, value: Any) -> Any:
    _core_coverage_mark("_regex_push")
    t1 = _core_string_format("{}", top)
    stack[t1] = value
    t2 = _core_add(top, 1)
    return t2


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
    return "auto"


def _date_scan_date_impl(units: Any, at: Any) -> Any:
    _core_coverage_mark("_date_scan_date_impl")
    none = _core_none()
    limit = _core_add(at, 10)
    year = _date_digits_impl(units, at, 4, limit)
    dash_at = _core_add(at, 4)
    dash = _date_expect_unit_impl(units, dash_at, limit, 45)
    month_at = _core_add(at, 5)
    month = _date_digits_impl(units, month_at, 2, limit)
    second_dash_at = _core_add(at, 7)
    second_dash = _date_expect_unit_impl(units, second_dash_at, limit, 45)
    day_at = _core_add(at, 8)
    day = _date_digits_impl(units, day_at, 2, limit)
    ok = _core_and(dash, second_dash)
    year_ok = _core_gte(year, 0)
    month_ok = _core_gte(month, 0)
    day_ok = _core_gte(day, 0)
    ok = _core_and(ok, year_ok)
    ok = _core_and(ok, month_ok)
    ok = _core_and(ok, day_ok)
    bad = _core_not(ok)
    if bad:
        return none
    else:
        pass
    parts = {}
    parts["year"] = year
    parts["month"] = month
    parts["day"] = day
    return parts


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


def _response_function_calls_impl(response: Any) -> list[Any]:
    _core_coverage_mark("_response_function_calls_impl")
    empty = []
    calls = _core_get(response, "function_calls", empty)
    return calls


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


def _date_scan_datetime_impl(units: Any, start: Any, end: Any) -> Any:
    _core_coverage_mark("_date_scan_datetime_impl")
    none = _core_none()
    date_end = _core_add(start, 10)
    too_short = _core_gt(date_end, end)
    if too_short:
        return none
    else:
        pass
    parts = _date_scan_date_impl(units, start)
    no_date = _core_is_none(parts)
    if no_date:
        return none
    else:
        pass
    separator = _core_get(units, date_end, 0)
    upper_t = _core_eq(separator, 84)
    lower_t = _core_eq(separator, 116)
    space = _core_eq(separator, 32)
    separated = _core_or(upper_t, lower_t)
    separated = _core_or(separated, space)
    inside = _core_lt(date_end, end)
    separated = _core_and(separated, inside)
    not_separated = _core_not(separated)
    if not_separated:
        return none
    else:
        pass
    hour_at = _core_add(start, 11)
    hour = _date_digits_impl(units, hour_at, 2, end)
    colon_at = _core_add(start, 13)
    colon = _date_expect_unit_impl(units, colon_at, end, 58)
    minute_at = _core_add(start, 14)
    minute = _date_digits_impl(units, minute_at, 2, end)
    hour_ok = _core_gte(hour, 0)
    minute_ok = _core_gte(minute, 0)
    clock_ok = _core_and(hour_ok, colon)
    clock_ok = _core_and(clock_ok, minute_ok)
    no_clock = _core_not(clock_ok)
    if no_clock:
        return none
    else:
        pass
    parts["hour"] = hour
    parts["minute"] = minute
    parts["second"] = 0
    parts["millisecond"] = 0
    cursor = _core_add(start, 16)
    second_colon = _date_expect_unit_impl(units, cursor, end, 58)
    if second_colon:
        second_at = _core_add(cursor, 1)
        second = _date_digits_impl(units, second_at, 2, end)
        has_second = _core_gte(second, 0)
        if has_second:
            parts["second"] = second
            cursor = _core_add(cursor, 3)
        else:
            pass
    else:
        pass
    dot = _date_expect_unit_impl(units, cursor, end, 46)
    if dot:
        fraction_at = _core_add(cursor, 1)
        digits = 0
        millisecond = 0
        while True:
            enough = _core_gte(digits, 9)
            if enough:
                break
            else:
                pass
            digit_at = _core_add(fraction_at, digits)
            digit = _date_digits_impl(units, digit_at, 1, end)
            not_digit = _core_lt(digit, 0)
            if not_digit:
                break
            else:
                pass
            counted = _core_lt(digits, 3)
            if counted:
                scaled = _core_mul(millisecond, 10)
                millisecond = _core_add(scaled, digit)
            else:
                pass
            digits = _core_add(digits, 1)
        has_fraction = _core_gt(digits, 0)
        if has_fraction:
            pad = digits
            while True:
                padded = _core_gte(pad, 3)
                if padded:
                    break
                else:
                    pass
                millisecond = _core_mul(millisecond, 10)
                pad = _core_add(pad, 1)
            parts["millisecond"] = millisecond
            fraction_end = _core_add(fraction_at, digits)
            cursor = fraction_end
        else:
            pass
    else:
        pass
    parts["end"] = cursor
    return parts


def _stream_text_required_check_impl(values: Any, fields: list[Any]) -> None:
    _core_coverage_mark("_stream_text_required_check_impl")
    parts = []
    first = _core_none()
    for field in fields:
        optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
        if optional:
            continue
        else:
            pass
        name = _core_get(field, "name", "")
        present = _core_map_contains(values, name)
        if present:
            continue
        else:
            pass
        no_first = _core_is_none(first)
        if no_first:
            first = field
        else:
            pass
        title = _stream_field_title_impl(field)
        label = _stream_field_type_label_impl(field)
        part = _core_string_format("'{}' ({})", title, label)
        parts.append(part)
    missing_count = _core_len(parts)
    none_missing = _core_eq(missing_count, 0)
    if none_missing:
        return None
    else:
        pass
    list = _core_string_join(", ", parts)
    first_title = _stream_field_title_impl(first)
    first_label = _stream_field_type_label_impl(first)
    message = _core_string_format("Required field not found: {}. Add a line starting with the exact label followed by a colon (e.g., \"{}:\") and then provide a valid {} value. Keep the output concise and avoid unrelated text.", list, first_title, first_label)
    error = _core_validation_error(message)
    raise error


def _ace_is_noop_acknowledgment(content: str) -> bool:
    _core_coverage_mark("_ace_is_noop_acknowledgment")
    lowered = _core_string_lower(content)
    c = str(lowered).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
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


def chat_session_tool_argument_errors(schema: Any, arguments: Any) -> Any:
    _core_coverage_mark("chat_session_tool_argument_errors")
    empty = []
    no_schema = _core_is_none(schema)
    if no_schema:
        return empty
    else:
        pass
    errors = _chat_session_argument_errors(schema, schema, arguments, "", 0)
    return errors


def chat_session_tool_argument_error(name: str, schema: Any, arguments: Any) -> Any:
    _core_coverage_mark("chat_session_tool_argument_error")
    errors = chat_session_tool_argument_errors(schema, arguments)
    count = _core_len(errors)
    valid = _core_eq(count, 0)
    if valid:
        nothing = _core_none()
        return nothing
    else:
        pass
    empty = {}
    properties = _core_get(schema, "properties", empty)
    properties_map = _core_type_is(properties, "object")
    if properties_map:
        pass
    else:
        properties = empty
    bullets = []
    for failure in errors:
        field = _core_get(failure, "field", "arguments")
        message = _core_get(failure, "message", "")
        description = ""
        property = _core_get(properties, field, None)
        property_map = _core_type_is(property, "object")
        if property_map:
            has_description = _core_map_contains(property, "description")
            property_description = _core_get(property, "description", "")
            description = _core_string_str(property_description)
            enum_values = _core_get(property, "enum", None)
            enum_list = _core_type_is(enum_values, "list")
            if enum_list:
                enum_count = _core_len(enum_values)
                has_enum = _core_gt(enum_count, 0)
                if has_enum:
                    if has_description:
                        pass
                    else:
                        description = "undefined"
                    enum_texts = []
                    for enum_value in enum_values:
                        enum_null = _core_is_none(enum_value)
                        enum_text = ""
                        if enum_null:
                            pass
                        else:
                            enum_text = _core_string_str(enum_value)
                        enum_texts.append(enum_text)
                    enum_joined = _core_string_join(", ", enum_texts)
                    description = _core_string_format("{} Allowed values are: {}", description, enum_joined)
                else:
                    pass
            else:
                pass
        else:
            pass
        bullet = _core_string_format("- `{}` - {} ({}).", field, message, description)
        bullets.append(bullet)
    joined = _core_string_join("\n", bullets)
    text = _core_string_format("Errors In Function Arguments: Fix the following invalid arguments to '{}'\n{}", name, joined)
    return text


def _tool_result_message_impl(call: Any, result_text: str) -> Any:
    _core_coverage_mark("_tool_result_message_impl")
    id = _core_get(call, "id", None)
    name = _core_get(call, "name", None)
    message = {}
    message["role"] = "function"
    message["function_id"] = id
    message["name"] = name
    message["result"] = result_text
    return message


def _stream_text_missed_fields_impl(values: Any, content: str, fields: list[Any]) -> None:
    _core_coverage_mark("_stream_text_missed_fields_impl")
    field_count = _core_len(fields)
    single = _core_eq(field_count, 1)
    if single:
        field = _core_list_get(fields, 0)
        labels = _stream_field_labels_impl(field)
        best_start = -1
        best_length = 0
        for label in labels:
            prefix = _core_string_format("{}:", label)
            at = _core_string_index_of(content, prefix, 0)
            found = _core_gte(at, 0)
            if found:
                first_found = _core_eq(best_start, -1)
                earlier = _core_lt(at, best_start)
                better = _core_or(first_found, earlier)
                if better:
                    best_start = at
                    best_length = _core_len(prefix)
                else:
                    pass
            else:
                pass
        labelled = _core_gte(best_start, 0)
        if labelled:
            value_start = _core_add(best_start, best_length)
            value_end = _core_len(content)
            for boundary_label in labels:
                boundary = _core_string_format("\n{}:", boundary_label)
                boundary_at = _core_string_index_of(content, boundary, value_start)
                boundary_found = _core_gte(boundary_at, 0)
                boundary_earlier = _core_lt(boundary_at, value_end)
                use_boundary = _core_and(boundary_found, boundary_earlier)
                if use_boundary:
                    value_end = boundary_at
                else:
                    pass
            raw = _stream_substring_impl(content, value_start, value_end)
            text = str(raw).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
            has_text = _core_ne(text, "")
            if has_text:
                done = False
                try:
                    parsed = _stream_field_value_impl(field, text)
                    parsed_has = _core_get(parsed, "has", False)
                    if parsed_has:
                        name = _core_get(field, "name", "")
                        parsed_value = _core_get(parsed, "value", None)
                        values[name] = parsed_value
                        done = True
                    else:
                        pass
                except Exception as single_error:
                    pass
                if done:
                    return None
                else:
                    pass
            else:
                pass
        else:
            pass
    else:
        pass
    lines = _core_string_split(content, "\n")
    for missed in fields:
        missed_name = _core_get(missed, "name", "")
        present = _core_map_contains(values, missed_name)
        if present:
            continue
        else:
            pass
        missed_labels = _stream_field_labels_impl(missed)
        optional = _stream_field_flag_impl(missed, "is_optional", "isOptional")
        for line in lines:
            trimmed_line = str(line).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
            matched = _core_none()
            for line_label in missed_labels:
                line_prefix = _core_string_format("{}:", line_label)
                starts = _core_string_starts_with(trimmed_line, line_prefix)
                if starts:
                    matched = line_prefix
                    break
                else:
                    pass
            no_match = _core_is_none(matched)
            if no_match:
                continue
            else:
                pass
            matched_length = _core_len(matched)
            after = _core_string_slice(trimmed_line, matched_length)
            line_value = str(after).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
            has_line_value = _core_ne(line_value, "")
            if has_line_value:
                try:
                    line_parsed = _stream_field_value_impl(missed, line_value)
                    line_has = _core_get(line_parsed, "has", False)
                    if line_has:
                        line_parsed_value = _core_get(line_parsed, "value", None)
                        values[missed_name] = line_parsed_value
                    else:
                        pass
                except Exception as line_error:
                    required = _core_not(optional)
                    if required:
                        raise line_error
                    else:
                        pass
            else:
                pass
            break
    return None


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


def _append_validation_retry_messages_impl(messages: list[Any], response: Any, error: error) -> list[Any]:
    _core_coverage_mark("_append_validation_retry_messages_impl")
    content = _core_get(response, "content", "")
    assistant_message = {}
    assistant_message["role"] = "assistant"
    assistant_message["content"] = content
    messages.append(assistant_message)
    error_text = _core_exception_message(error)
    is_validation = _core_exception_is_validation(error)
    retry_text = ""
    if is_validation:
        retry_text = _core_add("Invalid Field: ", error_text)
    else:
        instruction = str(error_text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        has_period = _core_string_ends_with(instruction, ".")
        no_period = _core_not(has_period)
        if no_period:
            instruction = _core_add(instruction, ".")
        else:
            pass
        retry_text = _core_add("Follow these instructions: ", instruction)
    retry_message = _feedback_message_impl(retry_text)
    messages.append(retry_message)
    return messages


def _date_offset_zone_matches_impl(units: Any, start: Any, end: Any) -> bool:
    _core_coverage_mark("_date_offset_zone_matches_impl")
    z_units = _core_string_utf16_units("z")
    one = _core_add(start, 1)
    single = _core_eq(one, end)
    is_z = _date_ascii_matches_impl(units, start, end, z_units)
    zulu = _core_and(single, is_z)
    if zulu:
        return True
    else:
        pass
    cursor = start
    utc_units = _core_string_utf16_units("utc")
    gmt_units = _core_string_utf16_units("gmt")
    utc = _date_ascii_matches_impl(units, start, end, utc_units)
    gmt = _date_ascii_matches_impl(units, start, end, gmt_units)
    named = _core_or(utc, gmt)
    if named:
        cursor = _core_add(start, 3)
    else:
        pass
    sign = _core_get(units, cursor, 0)
    plus = _core_eq(sign, 43)
    minus = _core_eq(sign, 45)
    has_sign = _core_or(plus, minus)
    sign_inside = _core_lt(cursor, end)
    has_sign = _core_and(has_sign, sign_inside)
    no_sign = _core_not(has_sign)
    if no_sign:
        return False
    else:
        pass
    hour_at = _core_add(cursor, 1)
    hours = _date_digits_impl(units, hour_at, 2, end)
    no_hours = _core_lt(hours, 0)
    if no_hours:
        return False
    else:
        pass
    rest = _core_add(cursor, 3)
    done = _core_eq(rest, end)
    if done:
        return True
    else:
        pass
    minute_at = rest
    colon = _date_expect_unit_impl(units, rest, end, 58)
    if colon:
        minute_at = _core_add(rest, 1)
    else:
        pass
    minutes = _date_digits_impl(units, minute_at, 2, end)
    has_minutes = _core_gte(minutes, 0)
    minutes_end = _core_add(minute_at, 2)
    at_end = _core_eq(minutes_end, end)
    matches = _core_and(has_minutes, at_end)
    return matches


def _parse_text_field_value_impl(field: Any, text: str) -> Any:
    _core_coverage_mark("_parse_text_field_value_impl")
    text = str(text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    typ = _core_get(field, "type", None)
    name = _core_get(typ, "name", None)
    array = _core_get(typ, "is_array", False)
    is_boolean = _core_eq(name, "boolean")
    numeric = _core_eq(name, "number")
    json = _core_eq(name, "json")
    parse = _core_or(is_boolean, numeric)
    parse = _core_or(parse, array)
    parse = _core_or(parse, json)
    if parse:
        value = _core_json_parse_strict(text)
        return value
    else:
        pass
    return text


def _parse_text_output_fields_impl(content: str, fields: Any, is_final: bool) -> Any:
    _core_coverage_mark("_parse_text_output_fields_impl")
    lines = _core_string_split(content, "\n")
    count = _core_len(lines)
    index = 0
    values = {}
    current = _core_none()
    current_name = ""
    parts = []
    for line in lines:
        index = _core_add(index, 1)
        line_trimmed = str(line).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        matched = _core_none()
        value = ""
        withhold = False
        for field in fields:
            name = _core_get(field, "name", None)
            title = _core_get(field, "title", name)
            labels = []
            labels.append(name)
            labels.append(title)
            for label in labels:
                prefix = _core_string_format("{}:", label)
                found = _core_string_starts_with(line_trimmed, prefix)
                if found:
                    matched = field
                    length = _core_len(prefix)
                    value = _core_string_slice(line_trimmed, length)
                    break
                else:
                    pass
                last = _core_eq(index, count)
                partial = _core_not(is_final)
                partial = _core_and(partial, last)
                if partial:
                    prefix_partial = _core_string_starts_with(prefix, line_trimmed)
                    withhold = _core_or(withhold, prefix_partial)
                else:
                    pass
            has_match = _core_is_not_none(matched)
            if has_match:
                break
            else:
                pass
        has_match = _core_is_not_none(matched)
        if has_match:
            has_current = _core_ne(current_name, "")
            if has_current:
                raw = _core_string_join("\n", parts)
                parsed = _parse_text_field_value_impl(current, raw)
                values[current_name] = parsed
            else:
                pass
            current = matched
            current_name = _core_get(matched, "name", None)
            parts = []
            parts.append(value)
        else:
            has_current = _core_ne(current_name, "")
            keep = _core_not(withhold)
            keep = _core_and(keep, has_current)
            if keep:
                parts.append(line)
            else:
                pass
    has_current = _core_ne(current_name, "")
    if has_current:
        raw = _core_string_join("\n", parts)
        try:
            parsed = _parse_text_field_value_impl(current, raw)
            values[current_name] = parsed
        except Exception as parse_error:
            if is_final:
                raise parse_error
            else:
                pass
    else:
        pass
    return values


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
                    section_trimmed = str(section_raw).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
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
                    content_trimmed = str(content_raw).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
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
                        bullet_id_trimmed = str(bullet_id_source).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
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


def _date_offset_minutes_impl(units: Any, start: Any, end: Any) -> Any:
    _core_coverage_mark("_date_offset_minutes_impl")
    none = _core_none()
    length = _core_mul(start, -1)
    length = _core_add(length, end)
    utc_units = _core_string_utf16_units("utc")
    gmt_units = _core_string_utf16_units("gmt")
    z_units = _core_string_utf16_units("z")
    utc = _date_ascii_matches_impl(units, start, end, utc_units)
    gmt = _date_ascii_matches_impl(units, start, end, gmt_units)
    named = _core_or(utc, gmt)
    three = _core_eq(length, 3)
    named_only = _core_and(named, three)
    if named_only:
        return 0
    else:
        pass
    one = _core_eq(length, 1)
    is_z = _date_ascii_matches_impl(units, start, end, z_units)
    zulu = _core_and(one, is_z)
    if zulu:
        return 0
    else:
        pass
    cursor = start
    if named:
        cursor = _core_add(start, 3)
    else:
        pass
    sign_unit = _core_get(units, cursor, 0)
    sign_inside = _core_lt(cursor, end)
    plus = _core_eq(sign_unit, 43)
    minus = _core_eq(sign_unit, 45)
    has_sign = _core_or(plus, minus)
    has_sign = _core_and(has_sign, sign_inside)
    no_sign = _core_not(has_sign)
    if no_sign:
        return none
    else:
        pass
    hour_at = _core_add(cursor, 1)
    hours = _date_digits_impl(units, hour_at, 2, end)
    no_hours = _core_lt(hours, 0)
    if no_hours:
        return none
    else:
        pass
    minutes = 0
    rest = _core_add(cursor, 3)
    more = _core_lt(rest, end)
    if more:
        minute_at = rest
        colon = _date_expect_unit_impl(units, rest, end, 58)
        if colon:
            minute_at = _core_add(rest, 1)
        else:
            pass
        minutes = _date_digits_impl(units, minute_at, 2, end)
        minutes_end = _core_add(minute_at, 2)
        at_end = _core_eq(minutes_end, end)
        minutes_ok = _core_gte(minutes, 0)
        ok = _core_and(at_end, minutes_ok)
        bad = _core_not(ok)
        if bad:
            return none
        else:
            pass
    else:
        pass
    hours_range = _core_gt(hours, 23)
    minutes_range = _core_gt(minutes, 59)
    out_of_range = _core_or(hours_range, minutes_range)
    if out_of_range:
        return none
    else:
        pass
    total = _core_mul(hours, 60)
    total = _core_add(total, minutes)
    if minus:
        total = _core_mul(total, -1)
    else:
        pass
    return total


def _stream_text_final_impl(xstate: Any, values: Any, content: str, fields: list[Any], options: Any) -> None:
    _core_coverage_mark("_stream_text_final_impl")
    strict_mode = _core_get(options, "strict_mode", False)
    lenient = _core_not(strict_mode)
    field_count = _core_len(fields)
    curr = _core_get(xstate, "curr_field", None)
    no_curr = _core_is_none(curr)
    single = _core_eq(field_count, 1)
    assume_single = _core_and(no_curr, single)
    assume = _core_and(assume_single, lenient)
    if assume:
        only = _core_list_get(fields, 0)
        xstate["curr_field"] = only
        xstate["curr_field_index"] = 0
        xstate["in_assumed_field"] = True
        xstate["s"] = 0
        _stream_text_note_field_impl(xstate, only, False)
        curr = only
    else:
        pass
    has_curr = _core_is_not_none(curr)
    if has_curr:
        curr_name = _core_get(curr, "name", "")
        start = _core_get(xstate, "s", 0)
        end = _core_len(content)
        for other in fields:
            other_name = _core_get(other, "name", "")
            same = _core_eq(other_name, curr_name)
            if same:
                continue
            else:
                pass
            other_labels = _stream_field_labels_impl(other)
            for label in other_labels:
                pattern = _core_string_format("\n{}:", label)
                at = _core_string_index_of(content, pattern, start)
                found = _core_gte(at, 0)
                earlier = _core_lt(at, end)
                closer = _core_and(found, earlier)
                if closer:
                    end = at
                else:
                    pass
        raw = _stream_substring_impl(content, start, end)
        text = str(raw).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        parsed = _stream_field_value_impl(curr, text)
        parsed_has = _core_get(parsed, "has", False)
        if parsed_has:
            parsed_value = _core_get(parsed, "value", None)
            values[curr_name] = parsed_value
        else:
            pass
    else:
        pass
    never_opened = _core_not(has_curr)
    strict_unopened = _core_and(strict_mode, never_opened)
    if strict_unopened:
        empty_extracted = []
        extracted = _core_get(xstate, "extracted_fields", empty_extracted)
        extracted_count = _core_len(extracted)
        nothing_extracted = _core_eq(extracted_count, 0)
        trimmed_content = str(content).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        text_length = _core_len(trimmed_content)
        has_text = _core_gt(text_length, 0)
        unlabeled_text = _core_and(nothing_extracted, has_text)
        if unlabeled_text:
            _stream_text_expect_required_impl(fields)
        else:
            pass
    else:
        pass
    _stream_text_missed_fields_impl(values, content, fields)
    _stream_text_required_check_impl(values, fields)
    return None


def _parse_output_fields_impl(content: str, fields: Any) -> Any:
    _core_coverage_mark("_parse_output_fields_impl")
    text = str(content).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    is_json = _core_string_starts_with(text, "{")
    if is_json:
        output = _parse_output_impl(text)
        return output
    else:
        pass
    output = _parse_text_output_fields_impl(text, fields, True)
    return output


def _date_js_json_impl(value: Any) -> Any:
    _core_coverage_mark("_date_js_json_impl")
    is_null = _core_is_none(value)
    if is_null:
        return "null"
    else:
        pass
    is_boolean = _core_type_is(value, "boolean")
    if is_boolean:
        if value:
            return "true"
        else:
            pass
        return "false"
    else:
        pass
    is_number = _core_type_is(value, "number")
    if is_number:
        number = _core_string_str(value)
        return number
    else:
        pass
    is_text = _core_type_is(value, "string")
    if is_text:
        quoted = _date_js_json_string_impl(value)
        return quoted
    else:
        pass
    parts = []
    is_list = _core_type_is(value, "list")
    if is_list:
        for item in value:
            item_json = _date_js_json_impl(item)
            parts.append(item_json)
        items = _core_string_join(",", parts)
        list_json = _core_add("[", items)
        list_json = _core_add(list_json, "]")
        return list_json
    else:
        pass
    keys = _core_map_keys(value)
    for key in keys:
        key_json = _date_js_json_string_impl(key)
        entry = _core_get(value, key, None)
        entry_json = _date_js_json_impl(entry)
        member = _core_add(key_json, ":")
        member = _core_add(member, entry_json)
        parts.append(member)
    members = _core_string_join(",", parts)
    object_json = _core_add("{", members)
    object_json = _core_add(object_json, "}")
    return object_json


def _stream_text_extract_values_impl(content: str, fields: list[Any], strict_mode: bool) -> Any:
    _core_coverage_mark("_stream_text_extract_values_impl")
    extract_options = {}
    extract_options["strict_mode"] = strict_mode
    values = {}
    xstate = _stream_text_state_impl()
    _stream_text_extract_impl(xstate, values, content, fields, extract_options)
    _stream_text_final_impl(xstate, values, content, fields, extract_options)
    for field in fields:
        internal = _stream_field_flag_impl(field, "is_internal", "isInternal")
        if internal:
            name = _core_get(field, "name", "")
            _core_map_delete(values, name)
        else:
            pass
    return values


def _signature_has_complex_fields(signature: AxSignature, options: Any) -> bool:
    _core_coverage_mark("_signature_has_complex_fields")
    option_forced_snake = _core_get(options, "force_structured", False)
    option_forced = _core_get(options, "forceStructured", option_forced_snake)
    signature_forced_snake = _core_get(signature, "force_structured", False)
    signature_forced = _core_get(signature, "forceStructured", signature_forced_snake)
    forced = _core_or(option_forced, signature_forced)
    if forced:
        return True
    else:
        pass
    output_fields = _core_get(signature, "output_fields", None)
    decisions = _evidence_has_fields_impl(output_fields)
    if decisions:
        return True
    else:
        pass
    for field in output_fields:
        field_type = _core_get(field, "type", None)
        type_name = _core_get(field_type, "name", None)
        is_object = _core_eq(type_name, "object")
        if is_object:
            return True
        else:
            pass
        is_array_snake = _core_get(field_type, "is_array", False)
        is_array = _core_get(field_type, "isArray", is_array_snake)
        nested_fields = _core_get(field_type, "fields", None)
        has_nested_fields = _core_truthy(nested_fields)
        object_array = _core_and(is_array, has_nested_fields)
        if object_array:
            return True
        else:
            pass
    return False


def _stream_text_yield_delta_impl(content: str, field: Any, start: int, end: int, xstate: Any, held: list[Any], complete: bool) -> Any:
    _core_coverage_mark("_stream_text_yield_delta_impl")
    none = _core_none()
    name = _core_get(field, "name", "")
    internal = _stream_field_flag_impl(field, "is_internal", "isInternal")
    typ = _core_get(field, "type", None)
    type_name = _core_get(typ, "name", "")
    is_array = _stream_field_flag_impl(typ, "is_array", "isArray")
    untyped = _core_eq(type_name, "")
    is_string = _core_eq(type_name, "string")
    is_code = _core_eq(type_name, "code")
    texty = _core_or(untyped, is_string)
    texty = _core_or(texty, is_code)
    not_texty = _core_not(texty)
    skip = _core_or(internal, is_array)
    skip = _core_or(skip, not_texty)
    is_held = _core_contains(held, name)
    skip = _core_or(skip, is_held)
    if skip:
        return none
    else:
        pass
    empty_streamed = {}
    streamed = _core_get(xstate, "streamed_index", empty_streamed)
    position = _core_get(streamed, name, 0)
    first_chunk = _core_eq(position, 0)
    base = start
    before_start = _core_lt(base, 0)
    if before_start:
        base = 0
    else:
        pass
    from_index = _core_add(base, position)
    d1 = _stream_substring_impl(content, from_index, end)
    d1_length = _core_len(d1)
    nothing = _core_eq(d1_length, 0)
    if nothing:
        return none
    else:
        pass
    open = _core_not(complete)
    whole = d1
    if open:
        whole = _core_string_drop_trailing_high_surrogate(d1)
    else:
        pass
    d2 = _stream_trim_end_impl(whole)
    if is_code:
        d2 = _stream_strip_trailing_fence_impl(d2)
        if open:
            d2 = _stream_strip_partial_closing_fence_impl(d2)
        else:
            pass
    else:
        pass
    d3 = d2
    if first_chunk:
        d3 = _stream_trim_start_impl(d2)
    else:
        pass
    if is_code:
        opening = _core_and(open, first_chunk)
        if opening:
            partial_opening = _stream_is_partial_opening_fence_impl(d3)
            if partial_opening:
                return none
            else:
                pass
        else:
            pass
        d3 = _stream_strip_leading_fence_impl(d3)
    else:
        pass
    d3_length = _core_len(d3)
    has_text = _core_gt(d3_length, 0)
    if has_text:
        d2_length = _core_len(d2)
        streamed_to = _core_add(position, d2_length)
        streamed[name] = streamed_to
        xstate["streamed_index"] = streamed
        delta = {}
        delta[name] = d3
        return delta
    else:
        pass
    return none


def _caller_function_call_impl(options: Any) -> Any:
    _core_coverage_mark("_caller_function_call_impl")
    requested_snake = _core_get(options, "function_call", None)
    requested = _core_get(options, "functionCall", requested_snake)
    has_requested = _core_is_not_none(requested)
    if has_requested:
        return requested
    else:
        pass
    mode_snake = _core_get(options, "function_call_mode", None)
    mode = _core_get(options, "functionCallMode", mode_snake)
    is_required = _core_eq(mode, "required")
    is_none = _core_eq(mode, "none")
    is_named = _core_type_is(mode, "object")
    required_or_none = _core_or(is_required, is_none)
    routed = _core_or(required_or_none, is_named)
    if routed:
        return mode
    else:
        pass
    none = _core_none()
    return none


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


def _date_js_json_string_impl(text: Any) -> Any:
    _core_coverage_mark("_date_js_json_string_impl")
    hex = "0123456789abcdef"
    units = _core_string_utf16_units(text)
    count = _core_len(units)
    mode = _date_string_mode_impl()
    utf8 = _core_eq(mode, "utf8")
    out = "\""
    copied = 0
    offset = 0
    index = 0
    while True:
        done = _core_gte(index, count)
        if done:
            break
        else:
            pass
        unit = _core_get(units, index, 0)
        following_at = _core_add(index, 1)
        following = _core_get(units, following_at, 0)
        high_low = _core_gte(unit, 55296)
        high_high = _core_lte(unit, 56319)
        is_high = _core_and(high_low, high_high)
        low_low = _core_gte(following, 56320)
        low_high = _core_lte(following, 57343)
        next_low = _core_and(low_low, low_high)
        next_inside = _core_lt(following_at, count)
        next_low = _core_and(next_low, next_inside)
        is_pair = _core_and(is_high, next_low)
        width = 1
        step = 1
        if is_pair:
            step = 2
            if utf8:
                width = 4
            else:
                pass
            utf16_pair = _core_eq(mode, "utf16")
            if utf16_pair:
                width = 2
            else:
                pass
        else:
            if utf8:
                two_bytes = _core_gte(unit, 128)
                if two_bytes:
                    width = 2
                else:
                    pass
                three_bytes = _core_gte(unit, 2048)
                if three_bytes:
                    width = 3
                else:
                    pass
            else:
                pass
        escape = ""
        quote = _core_eq(unit, 34)
        if quote:
            escape = "\\\""
        else:
            pass
        backslash = _core_eq(unit, 92)
        if backslash:
            escape = "\\\\"
        else:
            pass
        control = _core_lt(unit, 32)
        if control:
            high_digit = _date_floor_div_impl(unit, 16)
            low_digit_base = _core_mul(high_digit, -16)
            low_digit = _core_add(unit, low_digit_base)
            high_end = _core_add(high_digit, 1)
            high_char = _core_string_slice(hex, high_digit, high_end)
            low_end = _core_add(low_digit, 1)
            low_char = _core_string_slice(hex, low_digit, low_end)
            escape = _core_string_format("\\u00{}{}", high_char, low_char)
            backspace = _core_eq(unit, 8)
            if backspace:
                escape = "\\b"
            else:
                pass
            tab = _core_eq(unit, 9)
            if tab:
                escape = "\\t"
            else:
                pass
            line_feed = _core_eq(unit, 10)
            if line_feed:
                escape = "\\n"
            else:
                pass
            form_feed = _core_eq(unit, 12)
            if form_feed:
                escape = "\\f"
            else:
                pass
            carriage_return = _core_eq(unit, 13)
            if carriage_return:
                escape = "\\r"
            else:
                pass
        else:
            pass
        surrogate_low = _core_gte(unit, 55296)
        surrogate_high = _core_lte(unit, 57343)
        surrogate = _core_and(surrogate_low, surrogate_high)
        not_pair = _core_not(is_pair)
        lone = _core_and(surrogate, not_pair)
        if lone:
            lone_text = _date_js_hex4_impl(unit)
            escape = _core_string_format("\\u{}", lone_text)
            if utf8:
                width = 3
            else:
                pass
        else:
            pass
        escaped = _core_ne(escape, "")
        if escaped:
            kept = _core_string_slice(text, copied, offset)
            out = _core_add(out, kept)
            out = _core_add(out, escape)
            offset = _core_add(offset, width)
            copied = offset
        else:
            offset = _core_add(offset, width)
        index = _core_add(index, step)
    rest = _core_string_slice(text, copied, offset)
    out = _core_add(out, rest)
    out = _core_add(out, "\"")
    return out


def _function_call_forces_tool_impl(choice: Any) -> bool:
    _core_coverage_mark("_function_call_forces_tool_impl")
    is_required = _core_eq(choice, "required")
    if is_required:
        return True
    else:
        pass
    is_named = _core_type_is(choice, "object")
    return is_named


def _function_call_names_output_impl(choice: Any) -> bool:
    _core_coverage_mark("_function_call_names_output_impl")
    is_named = _core_type_is(choice, "object")
    not_named = _core_not(is_named)
    if not_named:
        return False
    else:
        pass
    empty_function = {}
    function = _core_get(choice, "function", empty_function)
    name = _core_get(function, "name", "")
    canonical = _core_eq(name, "__axOutput")
    legacy = _core_eq(name, "__finalResult")
    reserved = _core_or(canonical, legacy)
    return reserved


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


def _append_structured_output_retry_messages_impl(messages: list[Any], response: Any, call: Any, error: error, stage: str) -> list[Any]:
    _core_coverage_mark("_append_structured_output_retry_messages_impl")
    output_calls = []
    output_calls.append(call)
    with_call = _append_tool_call_messages_impl(messages, response, output_calls)
    id = _core_get(call, "id", None)
    direct_name = _core_get(call, "name", None)
    fn = _core_get(call, "function", None)
    name = _core_get(fn, "name", direct_name)
    result_message = {}
    result_message["role"] = "function"
    result_message["function_id"] = id
    result_message["name"] = name
    result_message["result"] = "done"
    with_call.append(result_message)
    notice = {}
    notice["role"] = "user"
    notice["content"] = "The previous tool call failed. Fix arguments and try again, ensuring required fields match schema."
    with_call.append(notice)
    error_text = _core_exception_message(error)
    error_text = str(error_text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    correction_text = _core_string_format("Invalid Field: {}", error_text)
    is_assertion = _core_eq(stage, "assertion")
    if is_assertion:
        has_period = _core_string_ends_with(error_text, ".")
        period = "."
        if has_period:
            period = ""
        else:
            pass
        correction_text = _core_string_format("Follow these instructions: {}{}", error_text, period)
    else:
        pass
    correction = {}
    correction["role"] = "user"
    correction["content"] = correction_text
    with_call.append(correction)
    return with_call


def _stream_text_values_impl(fields: list[Any], content: str, values: Any, xstate: Any, held: list[Any], complete: bool) -> list[Any]:
    _core_coverage_mark("_stream_text_values_impl")
    deltas = []
    empty_prev = []
    prev_fields = _core_get(xstate, "prev_fields", empty_prev)
    for entry in prev_fields:
        prev_field = _core_get(entry, "field", None)
        prev_start = _core_get(entry, "s", 0)
        prev_end = _core_get(entry, "e", 0)
        prev_delta = _stream_text_yield_delta_impl(content, prev_field, prev_start, prev_end, xstate, held, True)
        has_prev_delta = _core_is_not_none(prev_delta)
        if has_prev_delta:
            deltas.append(prev_delta)
        else:
            pass
    cleared = []
    xstate["prev_fields"] = cleared
    assumed = _core_get(xstate, "in_assumed_field", False)
    if assumed:
        visible_count = 0
        for candidate in fields:
            candidate_internal = _stream_field_flag_impl(candidate, "is_internal", "isInternal")
            candidate_visible = _core_not(candidate_internal)
            if candidate_visible:
                visible_count = _core_add(visible_count, 1)
            else:
                pass
        single_visible = _core_eq(visible_count, 1)
        several = _core_not(single_visible)
        if several:
            return deltas
        else:
            pass
    else:
        pass
    curr = _core_get(xstate, "curr_field", None)
    no_curr = _core_is_none(curr)
    if no_curr:
        return deltas
    else:
        pass
    curr_internal = _stream_field_flag_impl(curr, "is_internal", "isInternal")
    if curr_internal:
        return deltas
    else:
        pass
    curr_start = _core_get(xstate, "s", 0)
    content_length = _core_len(content)
    curr_delta = _stream_text_yield_delta_impl(content, curr, curr_start, content_length, xstate, held, complete)
    has_curr_delta = _core_is_not_none(curr_delta)
    if has_curr_delta:
        deltas.append(curr_delta)
    else:
        pass
    empty_streamed = {}
    streamed = _core_get(xstate, "streamed_index", empty_streamed)
    keys = _core_map_keys(values)
    for key in keys:
        field = _core_none()
        for candidate_field in fields:
            candidate_name = _core_get(candidate_field, "name", "")
            same = _core_eq(candidate_name, key)
            if same:
                field = candidate_field
                break
            else:
                pass
        unknown = _core_is_none(field)
        if unknown:
            continue
        else:
            pass
        internal = _stream_field_flag_impl(field, "is_internal", "isInternal")
        is_held = _core_contains(held, key)
        skip = _core_or(internal, is_held)
        if skip:
            continue
        else:
            pass
        value = _core_get(values, key, None)
        is_list = _core_type_is(value, "list")
        if is_list:
            sent = _core_get(streamed, key, 0)
            fresh = []
            cursor = 0
            for item in value:
                new_item = _core_gte(cursor, sent)
                if new_item:
                    fresh.append(item)
                else:
                    pass
                cursor = _core_add(cursor, 1)
            fresh_count = _core_len(fresh)
            has_fresh = _core_gt(fresh_count, 0)
            if has_fresh:
                list_delta = {}
                list_delta[key] = fresh
                deltas.append(list_delta)
                sent_to = _core_add(sent, fresh_count)
                streamed[key] = sent_to
            else:
                pass
            continue
        else:
            pass
        is_string = _core_type_is(value, "string")
        string_value = ""
        if is_string:
            string_value = value
        else:
            pass
        has_string = _core_ne(string_value, "")
        current = _core_get(streamed, key, 0)
        already = _core_truthy(current)
        not_yet = _core_not(already)
        if not_yet:
            value_delta = {}
            value_delta[key] = value
            deltas.append(value_delta)
            marker = 1
            if has_string:
                marker = _core_len(string_value)
            else:
                pass
            streamed[key] = marker
            continue
        else:
            pass
        if has_string:
            string_length = _core_len(string_value)
            grew = _core_gt(string_length, current)
            if grew:
                rest = _core_string_slice(string_value, current)
                rest_delta = {}
                rest_delta[key] = rest
                deltas.append(rest_delta)
                streamed[key] = string_length
            else:
                pass
        else:
            pass
    xstate["streamed_index"] = streamed
    return deltas


def _with_output_thought_impl(output: Any, field: str, prefix: str, thought: str) -> Any:
    _core_coverage_mark("_with_output_thought_impl")
    joined = _core_add(prefix, thought)
    has_thought = _core_truthy(joined)
    if has_thought:
        output[field] = joined
    else:
        pass
    return output


def _streaming_forward_impl(gen: AxGen, client: AIClient, values: Any, options: Any, sink: Any) -> Any:
    _core_coverage_mark("_streaming_forward_impl")
    base_options = _core_get(gen, "options", None)
    runtime_options = _core_map_merge(base_options, options)
    _apply_model_config_option_impl(runtime_options, base_options, options)
    runtime_options["stream"] = True
    cache_fn = _core_none()
    cache_key = ""
    has_sink = _core_is_not_none(sink)
    if has_sink:
        lookup = _cache_lookup_option_impl(options)
        looked_up = _core_is_not_none(lookup)
        if looked_up:
            cache_fn = _core_get(lookup, "fn", None)
            cache_key = _core_get(lookup, "key", "")
        else:
            read = _cache_lookup_impl(gen, values, options, True)
            cache_fn = _core_get(read, "fn", None)
            cache_key = _core_get(read, "key", "")
            read_hit = _core_get(read, "hit", False)
            if read_hit:
                cached = _core_get(read, "value", None)
                rendered_cached = _render_audio_outputs_impl(gen, client, cached, options)
                cached_envelope = {}
                cached_envelope["version"] = 0
                cached_envelope["index"] = 0
                cached_envelope["delta"] = rendered_cached
                _core_axgen_emit_delta(sink, cached_envelope)
                return rendered_cached
            else:
                pass
    else:
        pass
    _core_map_delete(runtime_options, "_ax_cache_lookup")
    signature = _core_get(gen, "signature", None)
    model = _core_get(runtime_options, "model", None)
    features = _core_ai_client_features(client, model)
    functions = _core_get(gen, "functions", None)
    selection = _select_structured_output_rung(signature, features, runtime_options)
    selected_rung = _core_get(selection, "rung", None)
    input_fields = _core_get(signature, "input_fields", None)
    validate_fields(input_fields, values, "input")
    prompt_template = _core_get(gen, "prompt_template", None)
    render_options = _structured_output_render_options_impl(selection)
    _include_optional_render_option_impl(render_options, options)
    cache_snake = _core_get(runtime_options, "context_cache", None)
    cache = _core_get(runtime_options, "contextCache", cache_snake)
    render_options["contextCache"] = cache
    caching_features = _core_get(features, "caching", None)
    breakpoints = _core_get(caching_features, "cacheBreakpoints", True)
    ignore_breakpoints = _core_eq(breakpoints, False)
    render_options["ignoreBreakpoints"] = ignore_breakpoints
    messages = _core_object_call_method(prompt_template, "render", values, render_options)
    example_messages = _render_examples(gen)
    demo_messages = _render_demos(gen)
    system_message = _core_list_get(messages, 0, messages)
    ordered_messages = []
    ordered_messages.append(system_message)
    for example_message in example_messages:
        ordered_messages.append(example_message)
    for demo_message in demo_messages:
        ordered_messages.append(demo_message)
    message_index = 0
    for message in messages:
        after_system = _core_gt(message_index, 0)
        if after_system:
            ordered_messages.append(message)
        else:
            pass
        message_index = _core_add(message_index, 1)
    output_fields = _core_get(signature, "output_fields", None)
    output_fields = _date_parse_fields_impl(output_fields, base_options, options)
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
    max_retries_snake = _core_get(runtime_options, "max_retries", 3)
    max_retries = _core_get(runtime_options, "maxRetries", max_retries_snake)
    validation_retries_snake = _core_get(runtime_options, "validation_retries", max_retries)
    validation_retries = _core_get(runtime_options, "validationRetries", validation_retries_snake)
    infra_retries_snake = _core_get(runtime_options, "infra_retries", max_retries)
    infra_retries = _core_get(runtime_options, "infraRetries", infra_retries_snake)
    thought_field_snake = _core_get(base_options, "thought_field_name", "thought")
    thought_field = _core_get(base_options, "thoughtFieldName", thought_field_snake)
    max_steps_snake = _core_get(runtime_options, "max_steps", 25)
    max_steps = _core_get(runtime_options, "maxSteps", max_steps_snake)
    complex = _signature_has_complex_fields(signature, runtime_options)
    is_native = _core_eq(selected_rung, "native")
    is_json_object = _core_eq(selected_rung, "json_object")
    is_function_rung = _core_eq(selected_rung, "function")
    structured = _core_or(complex, is_native)
    structured = _core_or(structured, is_json_object)
    simple = _core_not(complex)
    native_simple = _core_and(is_native, simple)
    strict_json = _core_or(is_json_object, native_simple)
    not_function_rung = _core_not(is_function_rung)
    parse_json_strings = _core_and(complex, not_function_rung)
    held = _stream_held_fields_impl(gen, output_fields)
    config = {}
    config["fields"] = output_fields
    config["held"] = held
    config["structured"] = structured
    config["strict_json"] = strict_json
    config["parse_json_strings"] = parse_json_strings
    config["thought_field"] = thought_field
    strict_mode = _strict_mode_option_impl(base_options, options)
    config["strict_mode"] = strict_mode
    function_cot_snake = _core_get(features, "function_cot", False)
    function_cot = _core_get(features, "functionCot", function_cot_snake)
    empty_functions = []
    function_list = _core_get(gen, "functions", empty_functions)
    function_count = _core_len(function_list)
    has_functions = _core_gt(function_count, 0)
    function_cot_on = _core_truthy(function_cot)
    skip_early_fail = _core_and(function_cot_on, has_functions)
    config["skip_early_fail"] = skip_early_fail
    sample_snake = _core_get(runtime_options, "sample_count", None)
    sample_camel = _core_get(runtime_options, "sampleCount", sample_snake)
    sample_count = _core_get(runtime_options, "n", sample_camel)
    no_sample_count = _core_is_none(sample_count)
    if no_sample_count:
        sample_count = 1
    else:
        pass
    picker_snake = _core_get(runtime_options, "result_picker", None)
    picker = _core_get(runtime_options, "resultPicker", picker_snake)
    buffered = _core_is_not_none(picker)
    run = _stream_run_state_impl(sink, buffered, thought_field)
    render_audio = {}
    render_audio["gen"] = gen
    render_audio["client"] = client
    render_audio["options"] = options
    run["render_audio"] = render_audio
    committed = {}
    control_version = 0
    step = 0
    while True:
        steps_exhausted = _core_gte(step, max_steps)
        if steps_exhausted:
            max_steps_message = _core_string_format("Max steps reached: {}", max_steps)
            max_steps_error = _core_runtime_error(max_steps_message)
            max_steps_failed = _generate_failed_impl(max_steps_error)
            raise max_steps_failed
        else:
            pass
        step_started = _core_gt(step, 0)
        output_emitted = _core_get(run, "output_emitted", False)
        replace_output = _core_and(step_started, output_emitted)
        if replace_output:
            held_version = _core_get(run, "current_version", 0)
            behind = _core_lt(control_version, held_version)
            if behind:
                control_version = held_version
            else:
                pass
            control_version = _core_add(control_version, 1)
            committed = {}
            empty_carried = []
            carried = _core_get(run, "emitted_thought", empty_carried)
            _stream_run_new_version_impl(run, control_version)
            for carried_entry in carried:
                carried_text = _core_get(carried_entry, "text", "")
                has_carried = _core_ne(carried_text, "")
                if has_carried:
                    carried_index = _core_get(carried_entry, "index", 0)
                    carried_delta = {}
                    carried_delta[thought_field] = carried_text
                    _stream_yield_impl(run, control_version, carried_index, carried_delta)
                else:
                    pass
        else:
            pass
        control_updates = _core_ai_control_take_pending(client)
        messages = _apply_control_updates_impl(gen, messages, runtime_options, control_updates)
        for control_update in control_updates:
            update_held_version = _core_get(run, "current_version", 0)
            update_behind = _core_lt(control_version, update_held_version)
            if update_behind:
                control_version = update_held_version
            else:
                pass
            control_version = _core_add(control_version, 1)
            committed = {}
        infra_attempt = 0
        infra_error = _core_none()
        while True:
            resume_version = _core_get(run, "current_version", 0)
            stale = _core_lt(control_version, resume_version)
            if stale:
                control_version = resume_version
            else:
                pass
            attempt = 0
            infra_retry = False
            next_step = False
            while True:
                version = _core_add(control_version, attempt)
                states = []
                state_index = 0
                while True:
                    enough = _core_gte(state_index, sample_count)
                    if enough:
                        break
                    else:
                        pass
                    state = _stream_state_impl(state_index)
                    states.append(state)
                    state_index = _core_add(state_index, 1)
                retrying = _core_gt(attempt, 0)
                if retrying:
                    committed = {}
                else:
                    pass
                current = {}
                ctx = {}
                ctx["run"] = run
                ctx["committed"] = committed
                ctx["current"] = current
                ctx["version"] = version
                ctx["control_version"] = control_version
                ctx["attempt"] = attempt
                session_stream = _stream_session_state_impl(output_fields, thought_field)
                ctx["session"] = session_stream
                request = _build_gen_chat_request(gen, messages, runtime_options, selection, step)
                events = []
                stage = "provider"
                handle = _core_none()
                recorded = False
                response = {}
                outcome = {}
                structured_call = _core_none()
                structured_stage = "validation"
                try:
                    handle = _core_ai_stream_open(client, request, runtime_options)
                    while True:
                        stage = "provider"
                        event = _core_ai_stream_next(handle)
                        exhausted = _core_is_none(event)
                        if exhausted:
                            break
                        else:
                            pass
                        session_item = _core_get(event, "session", None)
                        is_session_item = _core_is_not_none(session_item)
                        if is_session_item:
                            session_kind = _core_get(session_item, "type", "")
                            session_response_id = _core_get(session_item, "response_id", "")
                            empty_session_turns = []
                            item_turns = _core_get(session_item, "turns", empty_session_turns)
                            session_stream["turns"] = item_turns
                            new_session_response = _stream_session_select_impl(ctx, session_response_id)
                            if new_session_response:
                                events = []
                            else:
                                pass
                            is_session_partial = _core_eq(session_kind, "partial")
                            if is_session_partial:
                                events.append(event)
                                stage = "validation"
                                partial_outcome = _stream_session_partial_impl(gen, config, ctx, event)
                                partial_fatal = _core_get(partial_outcome, "fatal", None)
                                has_partial_fatal = _core_is_not_none(partial_fatal)
                                if has_partial_fatal:
                                    stage = "fatal"
                                    raise partial_fatal
                                else:
                                    pass
                                continue
                            else:
                                pass
                            is_session_final = _core_eq(session_kind, "final")
                            not_session_final = _core_not(is_session_final)
                            if not_session_final:
                                continue
                            else:
                                pass
                            events = []
                            session_stream["final"] = True
                        else:
                            pass
                        events.append(event)
                        stage = "validation"
                        chunk = event
                        has_routing = _core_map_contains(event, "routing")
                        has_wrapped = _core_map_contains(event, "response")
                        router_envelope = _core_and(has_routing, has_wrapped)
                        if router_envelope:
                            chunk = _core_get(event, "response", None)
                        else:
                            pass
                        empty_results = []
                        results = _core_get(chunk, "results", empty_results)
                        for result in results:
                            finish_snake = _core_get(result, "finish_reason", None)
                            finish = _core_get(result, "finishReason", finish_snake)
                            failed_stream = _core_eq(finish, "error")
                            if failed_stream:
                                stage = "fatal"
                                stream_error = _core_runtime_error("Streaming response failed")
                                raise stream_error
                            else:
                                pass
                            result_content = _core_get(result, "content", "")
                            result_thought = _core_get(result, "thought", "")
                            empty_blocks = []
                            blocks_snake = _core_get(result, "thought_blocks", empty_blocks)
                            blocks = _core_get(result, "thoughtBlocks", blocks_snake)
                            calls_snake = _core_get(result, "function_calls", empty_blocks)
                            result_calls = _core_get(result, "functionCalls", calls_snake)
                            phase = _core_get(result, "phase", None)
                            has_content = _core_truthy(result_content)
                            has_thought = _core_truthy(result_thought)
                            block_count = _core_len(blocks)
                            has_blocks = _core_gt(block_count, 0)
                            call_count = _core_len(result_calls)
                            has_result_calls = _core_gt(call_count, 0)
                            has_phase = _core_truthy(phase)
                            hit_length = _core_eq(finish, "length")
                            substantive = _core_or(has_content, has_thought)
                            substantive = _core_or(substantive, has_blocks)
                            substantive = _core_or(substantive, has_result_calls)
                            substantive = _core_or(substantive, has_phase)
                            substantive = _core_or(substantive, hit_length)
                            skip_result = _core_not(substantive)
                            if skip_result:
                                continue
                            else:
                                pass
                            index = _core_get(result, "index", 0)
                            no_state = _core_none()
                            state = _core_list_get(states, index, no_state)
                            missing_state = _core_is_none(state)
                            if missing_state:
                                stage = "fatal"
                                state_message = _core_string_format("No state found for result (index: {})", index)
                                state_error = _core_runtime_error(state_message)
                                raise state_error
                            else:
                                pass
                            thought_is_text = _core_type_is(result_thought, "string")
                            thought_chunk = _core_and(has_thought, thought_is_text)
                            if thought_chunk:
                                empty_values = {}
                                state_values = _core_get(state, "values", empty_values)
                                old_thought = _core_get(state_values, thought_field, "")
                                joined_thought = _core_add(old_thought, result_thought)
                                state_values[thought_field] = joined_thought
                                state["values"] = state_values
                                thought_delta = {}
                                thought_delta[thought_field] = result_thought
                                thought_deltas = []
                                thought_deltas.append(thought_delta)
                                stage = "fatal"
                                _stream_emit_deltas_impl(ctx, index, thought_deltas)
                                stage = "validation"
                            else:
                                pass
                            if hit_length:
                                stage = "fatal"
                                length_so_far = _core_get(state, "content", "")
                                length_content = _core_add(length_so_far, result_content)
                                length_message = _core_add("Max tokens reached before completion\nContent: ", length_content)
                                length_error = _core_runtime_error(length_message)
                                raise length_error
                            else:
                                pass
                            content_deltas = _stream_chunk_content_impl(gen, config, state, result)
                            stage = "fatal"
                            callback_failure = _core_get(state, "fatal_error", None)
                            callback_failed = _core_is_not_none(callback_failure)
                            if callback_failed:
                                raise callback_failure
                            else:
                                pass
                            _stream_emit_deltas_impl(ctx, index, content_deltas)
                            stage = "validation"
                    stage = "validation"
                    messages = _stream_session_add_turns_impl(messages, session_stream)
                    folded = fold_chat_response_stream(events)
                    response = chat_response_to_completion(folded)
                    stage = "fatal"
                    _check_completion_function_calls(response, runtime_options)
                    stage = "validation"
                    _core_axgen_memory_add_response(gen, request, response)
                    _core_axgen_record_chat_log(gen, request, response)
                    recorded = True
                    calls = _response_function_calls_impl(response)
                    response_call_count = _core_len(calls)
                    has_calls = _core_gt(response_call_count, 0)
                    if has_calls:
                        structured_call = _find_structured_output_call(calls)
                        has_structured_call = _core_is_not_none(structured_call)
                        if has_structured_call:
                            stage = "structured"
                            structured_stage = "validation"
                            structured_args = _structured_output_call_args(structured_call)
                            _validate_exact_output_keys(output_fields, structured_args, "output")
                            structured_recovered = _parse_json_string_fields(output_fields, structured_args)
                            structured_validated = _stream_json_validate_output_impl(output_fields, structured_recovered)
                            decision_context = _evidence_context_impl(response, client)
                            structured_validated = _evidence_decode_values_impl(output_fields, structured_validated, decision_context, "")
                            structured_processed = _apply_field_processors(gen, structured_validated)
                            structured_stage = "assertion"
                            structured_failure = _run_assertions(gen, structured_processed)
                            structured_failed = _core_is_not_none(structured_failure)
                            if structured_failed:
                                stage = "fatal"
                                raise structured_failure
                            else:
                                pass
                            structured_public = strip_internal(output_fields, structured_processed)
                            stage = "fatal"
                            for structured_state in states:
                                structured_index = _core_get(structured_state, "index", 0)
                                structured_delta = {}
                                public_keys = _core_map_keys(structured_public)
                                for public_key in public_keys:
                                    public_value = _core_get(structured_public, public_key, None)
                                    structured_delta[public_key] = public_value
                                index_key = _core_string_format("{}", structured_index)
                                empty_attempt = {}
                                attempt_values = _core_get(current, index_key, empty_attempt)
                                thought_yielded = _core_map_contains(attempt_values, thought_field)
                                thought_pending = _core_not(thought_yielded)
                                response_thought = _core_get(response, "thought", "")
                                has_response_thought = _core_truthy(response_thought)
                                add_thought = _core_and(thought_pending, has_response_thought)
                                if add_thought:
                                    structured_delta[thought_field] = response_thought
                                else:
                                    pass
                                structured_version = _core_get(ctx, "version", version)
                                _stream_yield_impl(run, structured_version, structured_index, structured_delta)
                            outcome["kind"] = "done"
                        else:
                            outcome["kind"] = "tools"
                            outcome["calls"] = calls
                    else:
                        feedback = []
                        for final_state in states:
                            decision_context = _evidence_context_impl(response, client)
                            config["decision_context"] = decision_context
                            finalized = _stream_finalize_impl(gen, config, ctx, final_state)
                            final_failure = _core_get(finalized, "failure", None)
                            has_final_failure = _core_is_not_none(final_failure)
                            if has_final_failure:
                                stage = "fatal"
                                raise final_failure
                            else:
                                pass
                            empty_final_feedback = []
                            final_feedback = _core_get(finalized, "feedback", empty_final_feedback)
                            for feedback_text in final_feedback:
                                feedback.append(feedback_text)
                        feedback_count = _core_len(feedback)
                        fed_back = _core_gt(feedback_count, 0)
                        if fed_back:
                            outcome["kind"] = "feedback"
                            outcome["feedback"] = feedback
                        else:
                            outcome["kind"] = "done"
                    open_handle = _core_is_not_none(handle)
                    if open_handle:
                        _core_ai_stream_close(handle)
                    else:
                        pass
                except Exception as attempt_error:
                    control_version = _core_get(ctx, "control_version", control_version)
                    close_handle = _core_is_not_none(handle)
                    if close_handle:
                        try:
                            _core_ai_stream_close(handle)
                        except Exception as close_error:
                            pass
                    else:
                        pass
                    is_fatal = _core_eq(stage, "fatal")
                    if is_fatal:
                        fatal_failure = _generate_failed_impl(attempt_error)
                        raise fatal_failure
                    else:
                        pass
                    refusal_message = _core_exception_message(attempt_error)
                    decision_refusal = _core_string_starts_with(refusal_message, "Decision refused:")
                    if decision_refusal:
                        raise attempt_error
                    else:
                        pass
                    aborted = _core_exception_is_aborted(attempt_error)
                    if aborted:
                        raise attempt_error
                    else:
                        pass
                    from_provider = _core_eq(stage, "provider")
                    if from_provider:
                        infrastructure = _core_exception_is_infrastructure(attempt_error)
                        if infrastructure:
                            infra_retry = True
                            infra_error = attempt_error
                            break
                        else:
                            pass
                        refused = _core_exception_is_refusal(attempt_error)
                        not_refused = _core_not(refused)
                        if not_refused:
                            stream_provider_failure = _generate_failed_impl(attempt_error)
                            raise stream_provider_failure
                        else:
                            pass
                        refusal_exhausted = _core_gte(attempt, validation_retries)
                        if refusal_exhausted:
                            stream_refusal_failure = _unable_to_fix_impl(attempt_error, "")
                            raise stream_refusal_failure
                        else:
                            pass
                        attempt = _core_add(attempt, 1)
                        continue
                    else:
                        pass
                    retries_exhausted = _core_gte(attempt, validation_retries)
                    if retries_exhausted:
                        streaming_assertion = False
                        stream_outputs = []
                        for exhausted_state in states:
                            empty_xstate = {}
                            exhausted_xstate = _core_get(exhausted_state, "xstate", empty_xstate)
                            flagged = _core_get(exhausted_xstate, "assertion_failed", False)
                            if flagged:
                                streaming_assertion = True
                            else:
                                pass
                            exhausted_content = _core_get(exhausted_state, "content", "")
                            stream_outputs.append(exhausted_content)
                        if streaming_assertion:
                            raise attempt_error
                        else:
                            pass
                        stream_output_text = _core_string_join("\n---\n", stream_outputs)
                        stream_exhausted = _unable_to_fix_impl(attempt_error, stream_output_text)
                        raise stream_exhausted
                    else:
                        pass
                    attempt = _core_add(attempt, 1)
                    messages = _stream_session_add_turns_impl(messages, session_stream)
                    not_recorded = _core_not(recorded)
                    if not_recorded:
                        partial_folded = fold_chat_response_stream(events)
                        response = chat_response_to_completion(partial_folded)
                        _core_axgen_memory_add_response(gen, request, response)
                        _core_axgen_record_chat_log(gen, request, response)
                    else:
                        pass
                    structured_retry = _core_eq(stage, "structured")
                    if structured_retry:
                        structured_retry_messages = _append_structured_output_retry_messages_impl(messages, response, structured_call, attempt_error, structured_stage)
                        messages = structured_retry_messages
                    else:
                        retry_messages = _append_assertion_retry_messages(messages, response, attempt_error)
                        messages = retry_messages
                    _core_axgen_memory_add_correction(gen, response, attempt_error)
                    continue
                control_version = _core_get(ctx, "control_version", control_version)
                kind = _core_get(outcome, "kind", "done")
                is_tools = _core_eq(kind, "tools")
                if is_tools:
                    empty_calls = []
                    tool_calls = _core_get(outcome, "calls", empty_calls)
                    updated_messages = _append_tool_call_messages_impl(messages, response, tool_calls)
                    messages = updated_messages
                    tool_messages = _run_tool_calls_impl(gen, functions, messages, tool_calls, runtime_options)
                    messages = tool_messages
                    continue_after_tools = _should_continue_steps(gen, tool_calls)
                    if continue_after_tools:
                        next_step = True
                        break
                    else:
                        pass
                    stop_output = _stream_result_impl(run, runtime_options)
                    _core_axgen_memory_cleanup_corrections(gen)
                    _record_trace(gen, values, stop_output, "ok")
                    _cache_store_streamed_impl(cache_fn, cache_key, stop_output)
                    return stop_output
                else:
                    pass
                is_feedback = _core_eq(kind, "feedback")
                if is_feedback:
                    assistant_content = _core_get(response, "content", "")
                    assistant_message = {}
                    assistant_message["role"] = "assistant"
                    assistant_message["content"] = assistant_content
                    messages.append(assistant_message)
                    empty_feedback_texts = []
                    feedback_texts = _core_get(outcome, "feedback", empty_feedback_texts)
                    feedback_messages = []
                    for feedback_text in feedback_texts:
                        feedback_message = _feedback_message_impl(feedback_text)
                        messages.append(feedback_message)
                        feedback_messages.append(feedback_message)
                    _core_axgen_memory_add_request(gen, feedback_messages)
                    next_step = True
                    break
                else:
                    pass
                control_pending = _core_ai_control_pending_count(client)
                steered = _core_gt(control_pending, 0)
                if steered:
                    steered_content = _core_get(response, "content", "")
                    steered_message = {}
                    steered_message["role"] = "assistant"
                    steered_message["content"] = steered_content
                    messages.append(steered_message)
                    next_step = True
                    break
                else:
                    pass
                final_output = _stream_result_impl(run, runtime_options)
                _core_axgen_memory_cleanup_corrections(gen)
                _record_trace(gen, values, final_output, "ok")
                _cache_store_streamed_impl(cache_fn, cache_key, final_output)
                return final_output
            if infra_retry:
                infra_exhausted = _core_gte(infra_attempt, infra_retries)
                if infra_exhausted:
                    raise infra_error
                else:
                    pass
                _core_retry_sleep(infra_attempt, client, runtime_options)
                infra_attempt = _core_add(infra_attempt, 1)
                continue
            else:
                pass
            if next_step:
                break
            else:
                pass
            raise RuntimeError("unreachable AxGen streaming attempt exit")
        step = _core_add(step, 1)
    raise RuntimeError("unreachable AxGen streaming loop exit")


def _date_js_hex4_impl(unit: Any) -> Any:
    _core_coverage_mark("_date_js_hex4_impl")
    hex = "0123456789abcdef"
    digits = []
    rest = unit
    position = 0
    while True:
        done = _core_gte(position, 4)
        if done:
            break
        else:
            pass
        quotient = _date_floor_div_impl(rest, 16)
        base = _core_mul(quotient, -16)
        digit = _core_add(rest, base)
        digit_end = _core_add(digit, 1)
        digit_char = _core_string_slice(hex, digit, digit_end)
        digits.append(digit_char)
        rest = quotient
        position = _core_add(position, 1)
    d0 = _core_list_get(digits, 3)
    d1 = _core_list_get(digits, 2)
    d2 = _core_list_get(digits, 1)
    d3 = _core_list_get(digits, 0)
    text = _core_string_format("{}{}{}{}", d0, d1, d2, d3)
    return text


def _date_floor_div_impl(dividend: Any, divisor: Any) -> Any:
    _core_coverage_mark("_date_floor_div_impl")
    ratio = _core_div(dividend, divisor)
    quotient = _core_math_floor(ratio)
    product = _core_mul(quotient, divisor)
    over = _core_gt(product, dividend)
    if over:
        quotient = _core_add(quotient, -1)
    else:
        pass
    following = _core_add(quotient, 1)
    next_product = _core_mul(following, divisor)
    under = _core_lte(next_product, dividend)
    if under:
        quotient = following
    else:
        pass
    return quotient


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


def _date_days_from_civil_impl(year: Any, month: Any, day: Any) -> Any:
    _core_coverage_mark("_date_days_from_civil_impl")
    year_of_era = year
    early = _core_lte(month, 2)
    if early:
        year_of_era = _core_add(year, -1)
    else:
        pass
    era = _date_floor_div_impl(year_of_era, 400)
    era_years = _core_mul(era, -400)
    yoe = _core_add(year_of_era, era_years)
    shifted = _core_add(month, 9)
    month_index = _date_floor_div_impl(shifted, 12)
    month_index = _core_mul(month_index, -12)
    month_index = _core_add(shifted, month_index)
    month_days = _core_mul(month_index, 153)
    month_days = _core_add(month_days, 2)
    month_days = _date_floor_div_impl(month_days, 5)
    doy = _core_add(month_days, day)
    doy = _core_add(doy, -1)
    doe = _core_mul(yoe, 365)
    leap4 = _date_floor_div_impl(yoe, 4)
    leap100 = _date_floor_div_impl(yoe, 100)
    doe = _core_add(doe, leap4)
    leap100_negated = _core_mul(leap100, -1)
    doe = _core_add(doe, leap100_negated)
    doe = _core_add(doe, doy)
    days = _core_mul(era, 146097)
    days = _core_add(days, doe)
    days = _core_add(days, -719468)
    return days


def _stream_json_context_impl(json_text: str) -> Any:
    _core_coverage_mark("_stream_json_context_impl")
    stack = []
    depth = 0
    in_string = False
    escaped = False
    length = _core_len(json_text)
    cursor = 0
    while True:
        done = _core_gte(cursor, length)
        if done:
            break
        else:
            pass
        next = _core_add(cursor, 1)
        ch = _core_string_slice(json_text, cursor, next)
        cursor = next
        if escaped:
            escaped = False
            continue
        else:
            pass
        backslash = _core_eq(ch, "\\")
        if backslash:
            escaped = True
            continue
        else:
            pass
        quote = _core_eq(ch, "\"")
        if quote:
            in_string = _core_not(in_string)
            continue
        else:
            pass
        if in_string:
            continue
        else:
            pass
        open_object = _core_eq(ch, "{")
        open_array = _core_eq(ch, "[")
        opens = _core_or(open_object, open_array)
        if opens:
            stack.append(ch)
            depth = _core_add(depth, 1)
            continue
        else:
            pass
        close_object = _core_eq(ch, "}")
        close_array = _core_eq(ch, "]")
        closes = _core_or(close_object, close_array)
        if closes:
            opener = "{"
            if close_array:
                opener = "["
            else:
                pass
            count = _core_len(stack)
            last_index = _core_add(count, -1)
            top = _core_list_get(stack, last_index, "")
            matches = _core_eq(top, opener)
            if matches:
                kept = []
                position = 0
                for item in stack:
                    keep = _core_lt(position, last_index)
                    if keep:
                        kept.append(item)
                    else:
                        pass
                    position = _core_add(position, 1)
                stack = kept
                depth = _core_add(depth, -1)
            else:
                pass
        else:
            pass
    marker = {}
    marker["nesting_level"] = depth
    marker["in_string"] = in_string
    stack_count = _core_len(stack)
    top_index = _core_add(stack_count, -1)
    innermost = _core_list_get(stack, top_index, "")
    in_array = _core_eq(innermost, "[")
    in_object = _core_eq(innermost, "{")
    marker["in_array"] = in_array
    marker["in_object"] = in_object
    return marker


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


def _date_civil_from_days_impl(days: Any) -> Any:
    _core_coverage_mark("_date_civil_from_days_impl")
    shifted = _core_add(days, 719468)
    era = _date_floor_div_impl(shifted, 146097)
    era_days = _core_mul(era, -146097)
    doe = _core_add(shifted, era_days)
    a = _date_floor_div_impl(doe, 1460)
    b = _date_floor_div_impl(doe, 36524)
    c = _date_floor_div_impl(doe, 146096)
    a_negated = _core_mul(a, -1)
    yoe = _core_add(doe, a_negated)
    yoe = _core_add(yoe, b)
    c_negated = _core_mul(c, -1)
    yoe = _core_add(yoe, c_negated)
    yoe = _date_floor_div_impl(yoe, 365)
    era_years = _core_mul(era, 400)
    year = _core_add(yoe, era_years)
    year_days = _core_mul(yoe, 365)
    leap4 = _date_floor_div_impl(yoe, 4)
    leap100 = _date_floor_div_impl(yoe, 100)
    year_days = _core_add(year_days, leap4)
    leap100_negated = _core_mul(leap100, -1)
    year_days = _core_add(year_days, leap100_negated)
    year_days_negated = _core_mul(year_days, -1)
    doy = _core_add(doe, year_days_negated)
    mp = _core_mul(doy, 5)
    mp = _core_add(mp, 2)
    mp = _date_floor_div_impl(mp, 153)
    month_days = _core_mul(mp, 153)
    month_days = _core_add(month_days, 2)
    month_days = _date_floor_div_impl(month_days, 5)
    month_days_negated = _core_mul(month_days, -1)
    day = _core_add(doy, month_days_negated)
    day = _core_add(day, 1)
    month = _core_add(mp, 3)
    late = _core_gte(mp, 10)
    if late:
        month = _core_add(mp, -9)
    else:
        pass
    early = _core_lte(month, 2)
    if early:
        year = _core_add(year, 1)
    else:
        pass
    civil = {}
    civil["year"] = year
    civil["month"] = month
    civil["day"] = day
    return civil


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


def _date_make_day_impl(year: Any, month_index: Any, date: Any) -> Any:
    _core_coverage_mark("_date_make_day_impl")
    carry = _date_floor_div_impl(month_index, 12)
    whole_year = _core_add(year, carry)
    carry_months = _core_mul(carry, -12)
    month = _core_add(month_index, carry_months)
    month = _core_add(month, 1)
    first = _date_days_from_civil_impl(whole_year, month, 1)
    day = _core_add(first, date)
    day = _core_add(day, -1)
    return day


def _stream_json_strip_dangling_key_impl(text: str, need_colon: bool, lead: str) -> Any:
    _core_coverage_mark("_stream_json_strip_dangling_key_impl")
    cursor = _core_len(text)
    while True:
        at_start = _core_lte(cursor, 0)
        if at_start:
            break
        else:
            pass
        before = _core_add(cursor, -1)
        ch = _core_string_slice(text, before, cursor)
        space = _stream_is_space_impl(ch)
        not_space = _core_not(space)
        if not_space:
            break
        else:
            pass
        cursor = before
    if need_colon:
        colon_at = _core_add(cursor, -1)
        colon = _core_string_slice(text, colon_at, cursor)
        is_colon = _core_eq(colon, ":")
        not_colon = _core_not(is_colon)
        if not_colon:
            return -1
        else:
            pass
        cursor = colon_at
        while True:
            at_start = _core_lte(cursor, 0)
            if at_start:
                break
            else:
                pass
            before = _core_add(cursor, -1)
            ch = _core_string_slice(text, before, cursor)
            space = _stream_is_space_impl(ch)
            not_space = _core_not(space)
            if not_space:
                break
            else:
                pass
            cursor = before
    else:
        pass
    close_at = _core_add(cursor, -1)
    close = _core_string_slice(text, close_at, cursor)
    is_close = _core_eq(close, "\"")
    not_close = _core_not(is_close)
    no_room = _core_lt(close_at, 0)
    bad_close = _core_or(not_close, no_room)
    if bad_close:
        return -1
    else:
        pass
    before_close = _core_string_slice(text, 0, close_at)
    open_at = -1
    search = 0
    while True:
        found = _core_string_index_of(before_close, "\"", search)
        missing = _core_lt(found, 0)
        if missing:
            break
        else:
            pass
        open_at = found
        search = _core_add(found, 1)
    no_open = _core_lt(open_at, 0)
    if no_open:
        return -1
    else:
        pass
    cursor = open_at
    while True:
        at_start = _core_lte(cursor, 0)
        if at_start:
            break
        else:
            pass
        before = _core_add(cursor, -1)
        ch = _core_string_slice(text, before, cursor)
        space = _stream_is_space_impl(ch)
        not_space = _core_not(space)
        if not_space:
            break
        else:
            pass
        cursor = before
    lead_at = _core_add(cursor, -1)
    lead_ch = _core_string_slice(text, lead_at, cursor)
    is_lead = _core_eq(lead_ch, lead)
    lead_room = _core_gte(lead_at, 0)
    found_lead = _core_and(is_lead, lead_room)
    if found_lead:
        result = {}
        result["lead_at"] = lead_at
        result["key_at"] = open_at
        return result
    else:
        pass
    return -1


def _date_utc_ms_impl(parts: Any) -> Any:
    _core_coverage_mark("_date_utc_ms_impl")
    year = _core_get(parts, "year", None)
    month = _core_get(parts, "month", None)
    day = _core_get(parts, "day", None)
    hour = _core_get(parts, "hour", 0)
    minute = _core_get(parts, "minute", 0)
    second = _core_get(parts, "second", 0)
    millisecond = _core_get(parts, "millisecond", 0)
    utc_year = year
    two_digit_low = _core_gte(year, 0)
    two_digit_high = _core_lte(year, 99)
    two_digit = _core_and(two_digit_low, two_digit_high)
    if two_digit:
        utc_year = _core_add(year, 1900)
    else:
        pass
    month_index = _core_add(month, -1)
    day_number = _date_make_day_impl(utc_year, month_index, day)
    time_ms = _core_mul(hour, 3600000)
    minute_ms = _core_mul(minute, 60000)
    time_ms = _core_add(time_ms, minute_ms)
    second_ms = _core_mul(second, 1000)
    time_ms = _core_add(time_ms, second_ms)
    time_ms = _core_add(time_ms, millisecond)
    day_ms = _core_mul(day_number, 86400000)
    millis = _core_add(day_ms, time_ms)
    whole_days = _date_floor_div_impl(millis, 86400000)
    whole_ms = _core_mul(whole_days, -86400000)
    within = _core_add(millis, whole_ms)
    civil = _date_civil_from_days_impl(whole_days)
    civil_month = _core_get(civil, "month", None)
    civil_month_index = _core_add(civil_month, -1)
    civil_day = _core_get(civil, "day", None)
    set_day = _date_make_day_impl(year, civil_month_index, civil_day)
    set_ms = _core_mul(set_day, 86400000)
    result = _core_add(set_ms, within)
    return result


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


def _date_parts_of_ms_impl(millis: Any) -> Any:
    _core_coverage_mark("_date_parts_of_ms_impl")
    days = _date_floor_div_impl(millis, 86400000)
    day_ms = _core_mul(days, -86400000)
    within = _core_add(millis, day_ms)
    parts = _date_civil_from_days_impl(days)
    hour = _date_floor_div_impl(within, 3600000)
    hour_ms = _core_mul(hour, -3600000)
    within = _core_add(within, hour_ms)
    minute = _date_floor_div_impl(within, 60000)
    minute_ms = _core_mul(minute, -60000)
    within = _core_add(within, minute_ms)
    second = _date_floor_div_impl(within, 1000)
    second_ms = _core_mul(second, -1000)
    millisecond = _core_add(within, second_ms)
    parts["hour"] = hour
    parts["minute"] = minute
    parts["second"] = second
    parts["millisecond"] = millisecond
    return parts


def _date_same_day_impl(left: Any, right: Any) -> bool:
    _core_coverage_mark("_date_same_day_impl")
    keys = []
    keys.append("year")
    keys.append("month")
    keys.append("day")
    for key in keys:
        left_value = _core_get(left, key, 0)
        right_value = _core_get(right, key, 0)
        same = _core_eq(left_value, right_value)
        different = _core_not(same)
        if different:
            return False
        else:
            pass
    return True


def _stream_json_complete_literal_impl(text: str, word: str) -> str:
    _core_coverage_mark("_stream_json_complete_literal_impl")
    whole = _core_string_ends_with(text, word)
    quoted = _core_string_ends_with(text, "\"")
    finished = _core_or(whole, quoted)
    if finished:
        return text
    else:
        pass
    word_length = _core_len(word)
    size = _core_add(word_length, -1)
    while True:
        exhausted = _core_lte(size, 0)
        if exhausted:
            break
        else:
            pass
        partial = _core_string_slice(word, 0, size)
        ends = _core_string_ends_with(text, partial)
        if ends:
            text_length = _core_len(text)
            partial_length = _core_len(partial)
            negative = _core_mul(partial_length, -1)
            keep_length = _core_add(text_length, negative)
            head = _core_string_slice(text, 0, keep_length)
            head_trimmed = _stream_trim_end_impl(head)
            after_colon = _core_string_ends_with(head_trimmed, ":")
            after_bracket = _core_string_ends_with(head_trimmed, "[")
            after_comma = _core_string_ends_with(head_trimmed, ",")
            allowed = _core_or(after_colon, after_bracket)
            allowed = _core_or(allowed, after_comma)
            if allowed:
                completed = _core_add(head, word)
                return completed
            else:
                pass
            return text
        else:
            pass
        size = _core_add(size, -1)
    return text


def _date_same_parts_impl(left: Any, right: Any) -> bool:
    _core_coverage_mark("_date_same_parts_impl")
    keys = []
    keys.append("year")
    keys.append("month")
    keys.append("day")
    keys.append("hour")
    keys.append("minute")
    keys.append("second")
    keys.append("millisecond")
    for key in keys:
        left_value = _core_get(left, key, 0)
        right_value = _core_get(right, key, 0)
        same = _core_eq(left_value, right_value)
        different = _core_not(same)
        if different:
            return False
        else:
            pass
    return True


def _stream_json_repair_impl(json_text: str) -> str:
    _core_coverage_mark("_stream_json_repair_impl")
    result = str(json_text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    context = _stream_json_context_impl(result)
    cut_inside_string = _core_get(context, "in_string", False)
    outside_string = _core_not(cut_inside_string)
    if outside_string:
        trailing_comma = _core_string_ends_with(result, ",")
        if trailing_comma:
            result_length = _core_len(result)
            without_comma = _core_add(result_length, -1)
            result = _core_string_slice(result, 0, without_comma)
        else:
            pass
        after_comma_key = _stream_json_strip_dangling_key_impl(result, True, ",")
        comma_key_is_map = _core_type_is(after_comma_key, "object")
        if comma_key_is_map:
            comma_at = _core_get(after_comma_key, "lead_at", 0)
            result = _core_string_slice(result, 0, comma_at)
        else:
            after_brace_key = _stream_json_strip_dangling_key_impl(result, True, "{")
            brace_key_is_map = _core_type_is(after_brace_key, "object")
            if brace_key_is_map:
                key_at = _core_get(after_brace_key, "key_at", 0)
                result = _core_string_slice(result, 0, key_at)
            else:
                pass
        while True:
            tail_length = _core_len(result)
            tail_from = _core_add(tail_length, -2)
            tail = _stream_substring_impl(result, tail_from, tail_length)
            number_tail = _core_regex_match("^[0-9][eE.+-]$", tail)
            exponent_tail = _core_regex_match("^[eE][+-]$", tail)
            strip = _core_or(number_tail, exponent_tail)
            keep = _core_not(strip)
            if keep:
                break
            else:
                pass
            shorter = _core_add(tail_length, -1)
            result = _core_string_slice(result, 0, shorter)
    else:
        pass
    cleaned = []
    clean_length = _core_len(result)
    clean_cursor = 0
    clean_in_string = False
    clean_escaped = False
    while True:
        clean_done = _core_gte(clean_cursor, clean_length)
        if clean_done:
            break
        else:
            pass
        clean_next = _core_add(clean_cursor, 1)
        clean_ch = _core_string_slice(result, clean_cursor, clean_next)
        clean_outside = _core_not(clean_in_string)
        is_quote = _core_eq(clean_ch, "\"")
        is_backslash = _core_eq(clean_ch, "\\")
        was_clean_escaped = clean_escaped
        if was_clean_escaped:
            clean_escaped = False
        else:
            if is_quote:
                clean_in_string = _core_not(clean_in_string)
            else:
                clean_escaped = _core_and(clean_in_string, is_backslash)
        is_comma = _core_eq(clean_ch, ",")
        structural_comma = _core_and(is_comma, clean_outside)
        if structural_comma:
            ahead = _core_string_slice(result, clean_next)
            ahead_trimmed = _stream_trim_start_impl(ahead)
            closes_object = _core_string_starts_with(ahead_trimmed, "}")
            closes_array = _core_string_starts_with(ahead_trimmed, "]")
            before_close = _core_or(closes_object, closes_array)
            if before_close:
                clean_cursor = clean_next
                continue
            else:
                pass
        else:
            pass
        cleaned.append(clean_ch)
        clean_cursor = clean_next
    result = _core_string_join("", cleaned)
    if outside_string:
        result = _stream_json_complete_literal_impl(result, "true")
        result = _stream_json_complete_literal_impl(result, "false")
        result = _stream_json_complete_literal_impl(result, "null")
    else:
        pass
    closers = []
    in_string = False
    escaped = False
    scan_length = _core_len(result)
    scan_cursor = 0
    while True:
        scan_done = _core_gte(scan_cursor, scan_length)
        if scan_done:
            break
        else:
            pass
        scan_next = _core_add(scan_cursor, 1)
        ch = _core_string_slice(result, scan_cursor, scan_next)
        scan_cursor = scan_next
        if escaped:
            escaped = False
            continue
        else:
            pass
        backslash = _core_eq(ch, "\\")
        if backslash:
            escaped = True
            continue
        else:
            pass
        quote = _core_eq(ch, "\"")
        if quote:
            in_string = _core_not(in_string)
            continue
        else:
            pass
        if in_string:
            continue
        else:
            pass
        open_object = _core_eq(ch, "{")
        if open_object:
            closers.append("}")
            continue
        else:
            pass
        open_array = _core_eq(ch, "[")
        if open_array:
            closers.append("]")
            continue
        else:
            pass
        close_object = _core_eq(ch, "}")
        close_array = _core_eq(ch, "]")
        closes = _core_or(close_object, close_array)
        if closes:
            closer_count = _core_len(closers)
            top_index = _core_add(closer_count, -1)
            top = _core_list_get(closers, top_index, "")
            matches = _core_eq(top, ch)
            if matches:
                kept = []
                position = 0
                for closer in closers:
                    keep_closer = _core_lt(position, top_index)
                    if keep_closer:
                        kept.append(closer)
                    else:
                        pass
                    position = _core_add(position, 1)
                closers = kept
            else:
                pass
        else:
            pass
    if escaped:
        escaped_length = _core_len(result)
        without_escape = _core_add(escaped_length, -1)
        result = _core_string_slice(result, 0, without_escape)
    else:
        pass
    if in_string:
        result = _core_add(result, "\"")
    else:
        pass
    closer_total = _core_len(closers)
    last_closer_index = _core_add(closer_total, -1)
    last_closer = _core_list_get(closers, last_closer_index, "")
    in_object = _core_eq(last_closer, "}")
    if in_object:
        dangling = _stream_json_strip_dangling_key_impl(result, False, ",")
        dangling_is_map = _core_type_is(dangling, "object")
        if dangling_is_map:
            dangling_at = _core_get(dangling, "lead_at", 0)
            result = _core_string_slice(result, 0, dangling_at)
        else:
            pass
    else:
        pass
    reversed = []
    closer_cursor = last_closer_index
    while True:
        closers_done = _core_lt(closer_cursor, 0)
        if closers_done:
            break
        else:
            pass
        closer_ch = _core_list_get(closers, closer_cursor, "")
        reversed.append(closer_ch)
        closer_cursor = _core_add(closer_cursor, -1)
    closing = _core_string_join("", reversed)
    repaired = _core_add(result, closing)
    return repaired


def _date_pad_impl(value: Any, width: Any) -> Any:
    _core_coverage_mark("_date_pad_impl")
    text = _core_string_str(value)
    while True:
        length = _core_len(text)
        wide = _core_gte(length, width)
        if wide:
            break
        else:
            pass
        text = _core_add("0", text)
    return text


def _date_iso_impl(millis: Any) -> Any:
    _core_coverage_mark("_date_iso_impl")
    parts = _date_parts_of_ms_impl(millis)
    year = _core_get(parts, "year", None)
    year_text = ""
    year_low = _core_gte(year, 0)
    year_high = _core_lte(year, 9999)
    four_digits = _core_and(year_low, year_high)
    if four_digits:
        year_text = _date_pad_impl(year, 4)
    else:
        negative = _core_lt(year, 0)
        magnitude = year
        sign = "+"
        if negative:
            magnitude = _core_mul(year, -1)
            sign = "-"
        else:
            pass
        six = _date_pad_impl(magnitude, 6)
        year_text = _core_add(sign, six)
    month = _core_get(parts, "month", None)
    month_text = _date_pad_impl(month, 2)
    day = _core_get(parts, "day", None)
    day_text = _date_pad_impl(day, 2)
    hour = _core_get(parts, "hour", None)
    hour_text = _date_pad_impl(hour, 2)
    minute = _core_get(parts, "minute", None)
    minute_text = _date_pad_impl(minute, 2)
    second = _core_get(parts, "second", None)
    second_text = _date_pad_impl(second, 2)
    millisecond = _core_get(parts, "millisecond", None)
    millisecond_text = _date_pad_impl(millisecond, 3)
    pieces = []
    pieces.append(year_text)
    pieces.append("-")
    pieces.append(month_text)
    pieces.append("-")
    pieces.append(day_text)
    pieces.append("T")
    pieces.append(hour_text)
    pieces.append(":")
    pieces.append(minute_text)
    pieces.append(":")
    pieces.append(second_text)
    pieces.append(".")
    pieces.append(millisecond_text)
    pieces.append("Z")
    iso = _core_string_join("", pieces)
    return iso


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


def _stream_json_parse_partial_impl(json_text: str) -> Any:
    _core_coverage_mark("_stream_json_parse_partial_impl")
    out = {}
    none = _core_none()
    out["parsed"] = none
    out["marker"] = none
    blank = str(json_text).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    is_blank = _core_eq(blank, "")
    if is_blank:
        return out
    else:
        pass
    complete = False
    try:
        parsed = _core_json_parse_strict(json_text)
        out["parsed"] = parsed
        complete = True
    except Exception as partial_error:
        pass
    if complete:
        return out
    else:
        pass
    marker = _stream_json_context_impl(json_text)
    out["marker"] = marker
    repaired = _stream_json_repair_impl(json_text)
    try:
        repaired_value = _core_json_parse_strict(repaired)
        out["parsed"] = repaired_value
    except Exception as repair_error:
        pass
    return out


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


def _stream_json_should_parse_impl(state: Any, content: str) -> bool:
    _core_coverage_mark("_stream_json_should_parse_impl")
    units = _core_string_utf16_units(content)
    length = _core_len(units)
    last = _core_get(state, "last_parse_length", 0)
    negative_last = _core_mul(last, -1)
    fresh = _core_add(length, negative_last)
    nothing_new = _core_lte(fresh, 0)
    if nothing_new:
        return False
    else:
        pass
    plenty = _core_gte(fresh, 160)
    if plenty:
        state["last_parse_length"] = length
        return True
    else:
        pass
    too_few = _core_lt(fresh, 80)
    if too_few:
        return False
    else:
        pass
    cursor = _core_len(content)
    last_ch = ""
    while True:
        at_start = _core_lte(cursor, 0)
        if at_start:
            break
        else:
            pass
        before = _core_add(cursor, -1)
        ch = _core_string_slice(content, before, cursor)
        space = _core_regex_match("^[ \\n\\r\\t]$", ch)
        not_space = _core_not(space)
        if not_space:
            last_ch = ch
            break
        else:
            pass
        cursor = before
    brace = _core_eq(last_ch, "}")
    bracket = _core_eq(last_ch, "]")
    comma = _core_eq(last_ch, ",")
    boundary = _core_or(brace, bracket)
    boundary = _core_or(boundary, comma)
    not_boundary = _core_not(boundary)
    if not_boundary:
        return False
    else:
        pass
    state["last_parse_length"] = length
    return True


def _stream_json_validate_impl(fields: list[Any], values: Any, allow_missing: bool, reject_unknown: bool) -> None:
    _core_coverage_mark("_stream_json_validate_impl")
    if reject_unknown:
        keys = _core_map_keys(values)
        for key in keys:
            known = False
            for declared in fields:
                declared_name = _core_get(declared, "name", "")
                same = _core_eq(declared_name, key)
                if same:
                    known = True
                else:
                    pass
            unknown = _core_not(known)
            if unknown:
                unknown_message = _core_string_format("Unexpected field '{}' in output. Use only the exact declared wire keys.", key)
                unknown_error = _core_validation_error(unknown_message)
                raise unknown_error
            else:
                pass
    else:
        pass
    for field in fields:
        internal = _stream_field_flag_impl(field, "is_internal", "isInternal")
        if internal:
            continue
        else:
            pass
        name = _core_get(field, "name", "")
        value = _core_get(values, name, None)
        missing = _core_is_none(value)
        if missing:
            optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
            required = _core_not(optional)
            not_allowed = _core_not(allow_missing)
            fail = _core_and(required, not_allowed)
            if fail:
                missing_error = _stream_required_missing_error_impl(field)
                raise missing_error
            else:
                pass
            continue
        else:
            pass
        typed = _stream_json_validate_value_impl(field, value, allow_missing)
        values[name] = typed
    return None


def _stream_json_validate_value_impl(field: Any, value: Any, allow_missing: bool) -> Any:
    _core_coverage_mark("_stream_json_validate_value_impl")
    typ = _core_get(field, "type", None)
    no_type = _core_is_none(typ)
    if no_type:
        return value
    else:
        pass
    name = _core_get(typ, "name", "string")
    is_array = _stream_field_flag_impl(typ, "is_array", "isArray")
    not_array = _core_not(is_array)
    if is_array:
        is_list_value = _core_type_is(value, "list")
        not_list_value = _core_not(is_list_value)
        if not_list_value:
            array_error = _stream_json_type_error_impl(field, value, "Expected an array")
            raise array_error
        else:
            pass
        item_field = _core_field_item(field)
        typed_items = []
        for raw_item in value:
            raw_missing = _core_is_none(raw_item)
            if raw_missing:
                typed_items.append(raw_item)
                continue
            else:
                pass
            typed_item = _stream_json_coerce_scalar_impl(item_field, raw_item)
            typed_items.append(typed_item)
        value = typed_items
    else:
        value = _stream_json_coerce_scalar_impl(field, value)
    is_url = _core_eq(name, "url")
    scalar_url = _core_and(is_url, not_array)
    if scalar_url:
        _stream_validate_constraints_impl(field, value, "url")
    else:
        pass
    is_string = _core_eq(name, "string")
    is_code = _core_eq(name, "code")
    string_like = _core_or(is_string, is_code)
    if string_like:
        _stream_validate_constraints_impl(field, value, "string")
    else:
        pass
    is_number = _core_eq(name, "number")
    if is_number:
        _stream_validate_constraints_impl(field, value, "number")
    else:
        pass
    value_is_list = _core_type_is(value, "list")
    check_items = _core_and(is_array, value_is_list)
    if check_items:
        for item in value:
            item_missing = _core_is_none(item)
            if item_missing:
                continue
            else:
                pass
            if is_url:
                _stream_validate_constraints_impl(field, item, "url")
            else:
                if string_like:
                    _stream_validate_constraints_impl(field, item, "string")
                else:
                    pass
                if is_number:
                    _stream_validate_constraints_impl(field, item, "number")
                else:
                    pass
    else:
        pass
    is_object = _core_eq(name, "object")
    nested = _core_get(typ, "fields", None)
    has_nested = _core_truthy(nested)
    object_fields = _core_and(is_object, has_nested)
    value_is_map = _core_type_is(value, "object")
    scalar_object = _core_and(object_fields, value_is_map)
    scalar_object = _core_and(scalar_object, not_array)
    if scalar_object:
        _stream_json_validate_nested_impl(field, value, allow_missing)
    else:
        pass
    object_items = _core_and(object_fields, check_items)
    if object_items:
        for element in value:
            element_is_map = _core_type_is(element, "object")
            if element_is_map:
                _stream_json_validate_nested_impl(field, element, allow_missing)
            else:
                pass
    else:
        pass
    return value


def _parse_text_contract_output_impl(content: str, output_fields: list[Any], strict_mode: bool) -> Any:
    _core_coverage_mark("_parse_text_contract_output_impl")
    out = {}
    values = _stream_text_extract_values_impl(content, output_fields, strict_mode)
    out["values"] = values
    out["extracted"] = True
    return out


def _generate_failed_impl(error: error) -> error:
    _core_coverage_mark("_generate_failed_impl")
    aborted = _core_exception_is_aborted(error)
    if aborted:
        return error
    else:
        pass
    text = _core_exception_message(error)
    decision_refusal = _core_string_starts_with(text, "Decision refused:")
    if decision_refusal:
        return error
    else:
        pass
    message = _core_add("Generate failed: ", text)
    wrapped = _core_exception_generate(error, message)
    return wrapped


def _unable_to_fix_impl(error: error, output: str) -> error:
    _core_coverage_mark("_unable_to_fix_impl")
    text = _core_exception_message(error)
    message = _core_add("Unable to fix validation error: ", text)
    message = _core_add(message, "\n\nLLM Output:\n")
    message = _core_add(message, output)
    unfixed = _core_exception_rewrap(error, message)
    wrapped = _generate_failed_impl(unfixed)
    return wrapped


def _attempt_output_impl(response: Any) -> str:
    _core_coverage_mark("_attempt_output_impl")
    empty_results = []
    completions = _core_get(response, "results", empty_results)
    count = _core_len(completions)
    single = _core_eq(count, 0)
    if single:
        completions = []
        completions.append(response)
    else:
        pass
    contents = []
    for completion in completions:
        content = _core_get(completion, "content", "")
        text = ""
        has_content = _core_is_not_none(content)
        if has_content:
            text = content
        else:
            pass
        contents.append(text)
    joined = _core_string_join("\n---\n", contents)
    return joined


def _max_tokens_error_impl(response: Any) -> Any:
    _core_coverage_mark("_max_tokens_error_impl")
    empty_results = []
    completions = _core_get(response, "results", empty_results)
    count = _core_len(completions)
    single = _core_eq(count, 0)
    if single:
        completions = []
        completions.append(response)
    else:
        pass
    for completion in completions:
        finish_snake = _core_get(completion, "finish_reason", None)
        finish = _core_get(completion, "finishReason", finish_snake)
        cut = _core_eq(finish, "length")
        if cut:
            content = _core_get(completion, "content", "")
            message = _core_add("Max tokens reached before completion\nContent: ", content)
            error = _core_runtime_error(message)
            return error
        else:
            pass
    none = _core_none()
    return none


def _stream_json_validate_nested_impl(parent: Any, object: Any, allow_missing: bool) -> None:
    _core_coverage_mark("_stream_json_validate_nested_impl")
    typ = _core_get(parent, "type", None)
    nested_map = _core_get(typ, "fields", None)
    nested_fields = _core_fields_from_map(nested_map)
    parent_name = _core_get(parent, "name", "")
    keys = _core_map_keys(object)
    for key in keys:
        visible = False
        for candidate in nested_fields:
            candidate_name = _core_get(candidate, "name", "")
            same = _core_eq(candidate_name, key)
            candidate_internal = _stream_field_flag_impl(candidate, "is_internal", "isInternal")
            candidate_visible = _core_not(candidate_internal)
            match_at = _core_and(same, candidate_visible)
            if match_at:
                visible = True
            else:
                pass
        hidden = _core_not(visible)
        if hidden:
            unexpected_message = _core_string_format("Unexpected field '{}' in '{}'. Use only the exact declared wire keys.", key, parent_name)
            unexpected_error = _core_validation_error(unexpected_message)
            raise unexpected_error
        else:
            pass
    for nested_field in nested_fields:
        nested_internal = _stream_field_flag_impl(nested_field, "is_internal", "isInternal")
        if nested_internal:
            continue
        else:
            pass
        nested_name = _core_get(nested_field, "name", "")
        titled = {}
        nested_type = _core_get(nested_field, "type", None)
        nested_optional = _stream_field_flag_impl(nested_field, "is_optional", "isOptional")
        titled["name"] = nested_name
        titled["title"] = nested_name
        titled["type"] = nested_type
        titled["is_optional"] = nested_optional
        nested_value = _core_get(object, nested_name, None)
        nested_missing = _core_is_none(nested_value)
        if nested_missing:
            nested_required = _core_not(nested_optional)
            not_allowed = _core_not(allow_missing)
            fail = _core_and(nested_required, not_allowed)
            if fail:
                nested_error = _stream_required_missing_error_impl(titled)
                raise nested_error
            else:
                pass
            continue
        else:
            pass
        typed_nested = _stream_json_validate_value_impl(titled, nested_value, allow_missing)
        object[nested_name] = typed_nested
    return None


def _strict_mode_option_impl(base_options: Any, options: Any) -> bool:
    _core_coverage_mark("_strict_mode_option_impl")
    empty = {}
    call_options = _core_map_merge(empty, options)
    gen_options = _core_map_merge(empty, base_options)
    gen_snake = _core_get(gen_options, "strict_mode", False)
    gen_strict = _core_get(gen_options, "strictMode", gen_snake)
    call_snake = _core_get(call_options, "strict_mode", gen_strict)
    strict = _core_get(call_options, "strictMode", call_snake)
    strict_mode = _core_truthy(strict)
    return strict_mode


def _feedback_message_impl(text: Any) -> Any:
    _core_coverage_mark("_feedback_message_impl")
    part = {}
    part["type"] = "text"
    part["text"] = text
    parts = []
    parts.append(part)
    message = {}
    message["role"] = "user"
    message["content"] = parts
    return message


def _stream_json_select_fields_impl(fields: list[Any], values: Any) -> Any:
    _core_coverage_mark("_stream_json_select_fields_impl")
    out = {}
    keys = _core_map_keys(values)
    for key in keys:
        declared = False
        for field in fields:
            name = _core_get(field, "name", "")
            same = _core_eq(name, key)
            if same:
                declared = True
            else:
                pass
        if declared:
            value = _core_get(values, key, None)
            out[key] = value
        else:
            pass
    return out


def _caching_function_option_impl(gen: AxGen, options: Any) -> Any:
    _core_coverage_mark("_caching_function_option_impl")
    empty = {}
    call_options = _core_map_merge(empty, options)
    base_options = _core_get(gen, "options", empty)
    run_options = _core_map_merge(base_options, call_options)
    control = _core_get(run_options, "control", None)
    controlled = _core_is_not_none(control)
    if controlled:
        no_cache = _core_none()
        return no_cache
    else:
        pass
    cache_fn = _core_axgen_caching_function(gen, call_options)
    return cache_fn


def _cache_key_impl(gen: AxGen, values: Any, options: Any) -> str:
    _core_coverage_mark("_cache_key_impl")
    signature = _core_get(gen, "signature", None)
    description = _core_get(signature, "description", "")
    lines = []
    description_line = _core_string_format("description {}", description)
    lines.append(description_line)
    inputs = []
    input_fields = _core_get(signature, "input_fields", None)
    for field in input_fields:
        input_name = _core_get(field, "name", "")
        input_label = _stream_field_type_label_impl(field)
        input_optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
        input_line = _core_string_format("input {} {} {}", input_name, input_label, input_optional)
        lines.append(input_line)
        input_value = _core_get(values, input_name, None)
        inputs.append(input_value)
    output_fields = _core_get(signature, "output_fields", None)
    for field in output_fields:
        output_name = _core_get(field, "name", "")
        output_label = _stream_field_type_label_impl(field)
        output_optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
        output_line = _core_string_format("output {} {} {}", output_name, output_label, output_optional)
        lines.append(output_line)
    decisions = _evidence_has_fields_impl(output_fields)
    if decisions:
        full_signature = signature_to_string(signature)
        lines.append(full_signature)
        identity = {}
        instruction = _core_get(gen, "instruction", None)
        examples = _core_get(gen, "examples", None)
        demos = _core_get(gen, "demos", None)
        service = _core_get(options, "_evidence_cache_identity", None)
        identity["instruction"] = instruction
        identity["examples"] = examples
        identity["demos"] = demos
        identity["service"] = service
        call = {}
        keys = []
        keys.append("model")
        keys.append("model_config")
        keys.append("modelConfig")
        keys.append("sampleCount")
        keys.append("sample_count")
        keys.append("thinkingTokenBudget")
        keys.append("showThoughts")
        keys.append("serviceTier")
        keys.append("structuredOutputMode")
        for key in keys:
            v = _core_get(options, key, None)
            call[key] = v
        identity["call"] = call
        identity_json = _core_json_stable_stringify(identity)
        lines.append(identity_json)
    else:
        pass
    inputs_json = _core_json_stable_stringify(inputs)
    lines.append(inputs_json)
    text = _core_string_join("\n", lines)
    key = _core_crypto_sha256_hex(text)
    return key


def _stream_json_nested_fields_impl(fields_map: Any) -> list[Any]:
    _core_coverage_mark("_stream_json_nested_fields_impl")
    out = []
    nested_fields = _core_fields_from_map(fields_map)
    for nested in nested_fields:
        name = _core_get(nested, "name", "")
        typ = _core_get(nested, "type", None)
        optional = _stream_field_flag_impl(nested, "is_optional", "isOptional")
        internal = _stream_field_flag_impl(nested, "is_internal", "isInternal")
        field = {}
        field["name"] = name
        field["title"] = name
        field["type"] = typ
        field["is_optional"] = optional
        field["is_internal"] = internal
        out.append(field)
    return out


def _stream_json_flexible_impl(field: Any) -> bool:
    _core_coverage_mark("_stream_json_flexible_impl")
    typ = _core_get(field, "type", None)
    name = _core_get(typ, "name", "")
    is_json = _core_eq(name, "json")
    if is_json:
        return True
    else:
        pass
    is_object = _core_eq(name, "object")
    nested = _core_get(typ, "fields", None)
    has_nested = _core_truthy(nested)
    open_object = _core_not(has_nested)
    flexible = _core_and(is_object, open_object)
    return flexible


def _stream_json_string_value_impl(field: Any, value: Any) -> Any:
    _core_coverage_mark("_stream_json_string_value_impl")
    is_string = _core_type_is(value, "string")
    not_string = _core_not(is_string)
    if not_string:
        return value
    else:
        pass
    parsed = _core_none()
    try:
        parsed = _core_json_parse_strict(value)
    except Exception as parse_error:
        title = _stream_field_title_impl(field)
        detail = _core_exception_message(parse_error)
        message = _core_string_format("Invalid JSON: {} in field '{}'. Return only valid JSON. Prefer a fenced code block containing a single JSON object or array with no trailing text.", detail, title)
        invalid = _core_validation_error(message)
        raise invalid
    return parsed


def _cache_store_impl(cache_fn: Any, key: str, output: Any) -> None:
    _core_coverage_mark("_cache_store_impl")
    no_cache = _core_is_none(cache_fn)
    if no_cache:
        return None
    else:
        pass
    try:
        _core_axgen_cache_write(cache_fn, key, output)
    except Exception as cache_write_error:
        pass
    return None


def _stream_json_strings_for_field_impl(field: Any, value: Any) -> Any:
    _core_coverage_mark("_stream_json_strings_for_field_impl")
    typ = _core_get(field, "type", None)
    no_type = _core_is_none(typ)
    no_value = _core_is_none(value)
    skip = _core_or(no_type, no_value)
    if skip:
        return value
    else:
        pass
    flexible = _stream_json_flexible_impl(field)
    nested = _core_get(typ, "fields", None)
    has_nested = _core_truthy(nested)
    is_array = _stream_field_flag_impl(typ, "is_array", "isArray")
    if is_array:
        is_list = _core_type_is(value, "list")
        not_list = _core_not(is_list)
        if not_list:
            return value
        else:
            pass
        if flexible:
            items = []
            for item in value:
                parsed_item = _stream_json_string_value_impl(field, item)
                items.append(parsed_item)
            return items
        else:
            pass
        if has_nested:
            for element in value:
                element_is_map = _core_type_is(element, "object")
                if element_is_map:
                    _stream_json_strings_for_fields_impl(nested, element)
                else:
                    pass
        else:
            pass
        return value
    else:
        pass
    if flexible:
        parsed = _stream_json_string_value_impl(field, value)
        return parsed
    else:
        pass
    name = _core_get(typ, "name", "")
    is_object = _core_eq(name, "object")
    value_is_map = _core_type_is(value, "object")
    object_fields = _core_and(is_object, has_nested)
    nested_object = _core_and(object_fields, value_is_map)
    if nested_object:
        _stream_json_strings_for_fields_impl(nested, value)
    else:
        pass
    return value


def _cache_store_streamed_impl(cache_fn: Any, key: str, output: Any) -> None:
    _core_coverage_mark("_cache_store_streamed_impl")
    output_count = _core_len(output)
    yielded = _core_gt(output_count, 0)
    if yielded:
        _cache_store_impl(cache_fn, key, output)
    else:
        pass
    return None


def _cache_lookup_impl(gen: AxGen, values: Any, options: Any, ignore_read_errors: bool) -> Any:
    _core_coverage_mark("_cache_lookup_impl")
    lookup = {}
    cache_fn = _caching_function_option_impl(gen, options)
    lookup["fn"] = cache_fn
    lookup["key"] = ""
    lookup["hit"] = False
    use_cache = _core_is_not_none(cache_fn)
    if use_cache:
        cache_key = _cache_key_impl(gen, values, options)
        lookup["key"] = cache_key
        cached = _core_none()
        if ignore_read_errors:
            try:
                cached = _core_axgen_cache_read(cache_fn, cache_key)
            except Exception as cache_read_error:
                pass
        else:
            cached = _core_axgen_cache_read(cache_fn, cache_key)
        cache_hit = _core_is_not_none(cached)
        if cache_hit:
            lookup["hit"] = True
            lookup["value"] = cached
        else:
            pass
    else:
        pass
    return lookup


def _stream_json_strings_for_fields_impl(fields_map: Any, values: Any) -> None:
    _core_coverage_mark("_stream_json_strings_for_fields_impl")
    nested_fields = _stream_json_nested_fields_impl(fields_map)
    for field in nested_fields:
        name = _core_get(field, "name", "")
        present = _core_map_contains(values, name)
        if present:
            value = _core_get(values, name, None)
            parsed = _stream_json_strings_for_field_impl(field, value)
            values[name] = parsed
        else:
            pass
    return None


def _cache_lookup_option_impl(options: Any) -> Any:
    _core_coverage_mark("_cache_lookup_option_impl")
    empty = {}
    call_options = _core_map_merge(empty, options)
    lookup = _core_get(call_options, "_ax_cache_lookup", None)
    return lookup


def _stream_json_strings_impl(fields: list[Any], values: Any, partial: bool) -> None:
    _core_coverage_mark("_stream_json_strings_impl")
    for field in fields:
        name = _core_get(field, "name", "")
        present = _core_map_contains(values, name)
        absent = _core_not(present)
        if absent:
            continue
        else:
            pass
        value = _core_get(values, name, None)
        try:
            parsed = _stream_json_strings_for_field_impl(field, value)
            values[name] = parsed
        except Exception as parse_error:
            flexible = _stream_json_flexible_impl(field)
            is_string = _core_type_is(value, "string")
            droppable = _core_and(flexible, is_string)
            drop = _core_and(droppable, partial)
            keep_error = _core_not(drop)
            if keep_error:
                raise parse_error
            else:
                pass
            _core_map_delete(values, name)
    return None


def _apply_control_updates_impl(gen: AxGen, messages: list[Any], runtime_options: Any, updates: Any) -> list[Any]:
    _core_coverage_mark("_apply_control_updates_impl")
    steers = []
    for update in updates:
        kind = _core_get(update, "type", "")
        is_steer = _core_eq(kind, "steer")
        if is_steer:
            text = _core_get(update, "text", "")
            message = {}
            message["role"] = "user"
            message["content"] = text
            messages.append(message)
            steers.append(message)
        else:
            level = _core_get(update, "level", None)
            runtime_options["thinkingTokenBudget"] = level
    steer_count = _core_len(steers)
    has_steers = _core_gt(steer_count, 0)
    if has_steers:
        _core_axgen_memory_add_request(gen, steers)
    else:
        pass
    return messages


def _stream_state_impl(index: int) -> Any:
    _core_coverage_mark("_stream_state_impl")
    state = {}
    state["index"] = index
    state["content"] = ""
    values = {}
    state["values"] = values
    xstate = _stream_text_state_impl()
    state["xstate"] = xstate
    state["last_parse_length"] = 0
    return state


def _structured_output_render_options_impl(selection: Any) -> Any:
    _core_coverage_mark("_structured_output_render_options_impl")
    render_options = {}
    rung = _core_get(selection, "rung", None)
    structured = _core_is_not_none(rung)
    render_options["structured_output"] = structured
    extra_functions = []
    function_rung = _core_eq(rung, "function")
    if function_rung:
        render_options["structured_output_function_name"] = "__axOutput"
        output_function = {}
        output_function["name"] = "__axOutput"
        output_function["description"] = "Emit the complete structured program output using the declared argument shape."
        extra_functions.append(output_function)
    else:
        pass
    render_options["extra_functions"] = extra_functions
    return render_options


def _stream_merge_value_impl(base: Any, has_base: bool, delta: Any) -> Any:
    _core_coverage_mark("_stream_merge_value_impl")
    delta_is_list = _core_type_is(delta, "list")
    base_is_list = _core_type_is(base, "list")
    missing = _core_not(has_base)
    both_lists = _core_and(base_is_list, delta_is_list)
    list_start = _core_and(missing, delta_is_list)
    join_lists = _core_or(both_lists, list_start)
    if join_lists:
        joined = []
        if both_lists:
            for old_item in base:
                joined.append(old_item)
        else:
            pass
        for new_item in delta:
            joined.append(new_item)
        return joined
    else:
        pass
    delta_is_string = _core_type_is(delta, "string")
    base_is_string = _core_type_is(base, "string")
    string_base = _core_or(missing, base_is_string)
    join_strings = _core_and(string_base, delta_is_string)
    if join_strings:
        prefix = ""
        if base_is_string:
            prefix = base
        else:
            pass
        text = _core_add(prefix, delta)
        return text
    else:
        pass
    return delta


def _completion_function_call_problems(response: Any) -> Any:
    _core_coverage_mark("_completion_function_call_problems")
    results = _core_get(response, "results", None)
    no_results = _core_is_none(results)
    if no_results:
        results = []
        results.append(response)
    else:
        pass
    first = _core_none()
    unnamed = _core_none()
    call_problem = _core_none()
    result_index = 0
    for result in results:
        result_is_map = _core_type_is(result, "object")
        if result_is_map:
            recorded = _core_map_contains(result, "function_call_problems")
            problems = _core_none()
            if recorded:
                problems = _core_get(result, "function_call_problems", None)
                _core_map_delete(result, "function_call_problems")
            else:
                problems = _chat_result_function_call_problems(result, result_index)
            has_problems = _core_is_not_none(problems)
            if has_problems:
                result_first = _core_get(problems, "first", None)
                result_unnamed = _core_get(problems, "unnamed", None)
                result_call = _core_get(problems, "call", None)
                first_unset = _core_is_none(first)
                if first_unset:
                    first = result_first
                else:
                    pass
                unnamed_unset = _core_is_none(unnamed)
                if unnamed_unset:
                    unnamed = result_unnamed
                else:
                    pass
                call_unset = _core_is_none(call_problem)
                if call_unset:
                    call_problem = result_call
                else:
                    pass
            else:
                pass
        else:
            pass
        next_result_index = _core_add(result_index, 1)
        result_index = next_result_index
    top_recorded = _core_map_contains(response, "function_call_problems")
    if top_recorded:
        _core_map_delete(response, "function_call_problems")
    else:
        pass
    none_failed = _core_is_none(first)
    if none_failed:
        nothing = _core_none()
        return nothing
    else:
        pass
    out = {}
    out["first"] = first
    out["unnamed"] = unnamed
    out["call"] = call_problem
    return out


def _stream_commit_delta_impl(committed: Any, current: Any, delta: Any) -> Any:
    _core_coverage_mark("_stream_commit_delta_impl")
    effective = {}
    keys = _core_map_keys(delta)
    for key in keys:
        value = _core_get(delta, key, None)
        has_current = _core_map_contains(current, key)
        current_value = _core_get(current, key, None)
        merged = _stream_merge_value_impl(current_value, has_current, value)
        current[key] = merged
        has_committed = _core_map_contains(committed, key)
        committed_value = _core_get(committed, key, None)
        merged_is_string = _core_type_is(merged, "string")
        committed_is_string = _core_type_is(committed_value, "string")
        both_strings = _core_and(merged_is_string, committed_is_string)
        if both_strings:
            extends_committed = _core_string_starts_with(merged, committed_value)
            if extends_committed:
                committed_length = _core_len(committed_value)
                diff = _core_string_slice(merged, committed_length)
                has_diff = _core_ne(diff, "")
                if has_diff:
                    effective[key] = diff
                    committed[key] = merged
                else:
                    pass
                continue
            else:
                pass
            replay = _core_string_starts_with(committed_value, merged)
            if replay:
                continue
            else:
                pass
            changed_text = _core_ne(merged, committed_value)
            if changed_text:
                effective[key] = merged
                committed[key] = merged
            else:
                pass
            continue
        else:
            pass
        merged_is_list = _core_type_is(merged, "list")
        committed_is_list = _core_type_is(committed_value, "list")
        both_lists = _core_and(merged_is_list, committed_is_list)
        if both_lists:
            merged_count = _core_len(merged)
            committed_count = _core_len(committed_value)
            grew = _core_gt(merged_count, committed_count)
            if grew:
                fresh = []
                position = 0
                for item in merged:
                    is_fresh = _core_gte(position, committed_count)
                    if is_fresh:
                        fresh.append(item)
                    else:
                        pass
                    position = _core_add(position, 1)
                effective[key] = fresh
                committed[key] = merged
            else:
                pass
            continue
        else:
            pass
        equal = _core_eq(merged, committed_value)
        same = _core_and(has_committed, equal)
        differs = _core_not(same)
        if differs:
            effective[key] = merged
            committed[key] = merged
        else:
            pass
    return effective


def _check_completion_function_calls(response: Any, options: Any) -> None:
    _core_coverage_mark("_check_completion_function_calls")
    mode_snake = _core_get(options, "function_call_validation", None)
    mode = _core_get(options, "functionCallValidation", mode_snake)
    mode_set = _core_is_not_none(mode)
    is_fail = True
    if mode_set:
        is_fail = _core_eq(mode, "fail")
        is_correct = _core_eq(mode, "correct")
        known = _core_or(is_fail, is_correct)
        unknown = _core_not(known)
        if unknown:
            mode_json = _core_json_pretty(mode)
            mode_message = _core_string_format("functionCallValidation must be 'correct' or 'fail', received: {}", mode_json)
            mode_error = _core_validation_error(mode_message)
            raise mode_error
        else:
            pass
    else:
        pass
    problems = _completion_function_call_problems(response)
    has_problems = _core_is_not_none(problems)
    if has_problems:
        if is_fail:
            message = _core_get(problems, "first", None)
            error = _core_runtime_error(message)
            raise error
        else:
            pass
    else:
        pass
    return None


def _stream_run_state_impl(sink: Any, buffered: bool, thought_field: str) -> Any:
    _core_coverage_mark("_stream_run_state_impl")
    run = {}
    run["sink"] = sink
    run["buffered"] = buffered
    run["thought_field"] = thought_field
    run["current_version"] = 0
    run["output_emitted"] = False
    emitted_thought = []
    run["emitted_thought"] = emitted_thought
    buffer = []
    run["buffer"] = buffer
    return run


def _include_optional_render_option_impl(render_options: Any, options: Any) -> None:
    _core_coverage_mark("_include_optional_render_option_impl")
    snake = _core_get(options, "include_optional_input_fields_in_system_prompt", None)
    value = _core_get(options, "includeOptionalInputFieldsInSystemPrompt", snake)
    given = _core_is_not_none(value)
    if given:
        flag = _core_truthy(value)
        render_options["include_optional_input_fields_in_system_prompt"] = flag
    else:
        pass
    return None


def _stream_run_new_version_impl(run: Any, version: int) -> None:
    _core_coverage_mark("_stream_run_new_version_impl")
    run["current_version"] = version
    cleared_thought = []
    run["emitted_thought"] = cleared_thought
    run["output_emitted"] = False
    cleared_buffer = []
    run["buffer"] = cleared_buffer
    return None


def _memory_cleanup_option_impl(options: Any) -> bool:
    _core_coverage_mark("_memory_cleanup_option_impl")
    disabled_snake = _core_get(options, "disable_memory_cleanup", False)
    disabled_value = _core_get(options, "disableMemoryCleanup", disabled_snake)
    disabled = _core_truthy(disabled_value)
    cleanup = _core_not(disabled)
    return cleanup


def _stream_yield_impl(run: Any, version: int, index: int, delta: Any) -> None:
    _core_coverage_mark("_stream_yield_impl")
    current_version = _core_get(run, "current_version", 0)
    new_version = _core_ne(version, current_version)
    if new_version:
        _stream_run_new_version_impl(run, version)
    else:
        pass
    thought_field = _core_get(run, "thought_field", "thought")
    empty_thought = []
    emitted_thought = _core_get(run, "emitted_thought", empty_thought)
    keys = _core_map_keys(delta)
    for key in keys:
        value = _core_get(delta, key, None)
        is_thought = _core_eq(key, thought_field)
        is_string = _core_type_is(value, "string")
        thought_text = _core_and(is_thought, is_string)
        if thought_text:
            thought_entry = _core_none()
            for candidate_thought in emitted_thought:
                thought_index = _core_get(candidate_thought, "index", None)
                same_thought_index = _core_eq(thought_index, index)
                if same_thought_index:
                    thought_entry = candidate_thought
                else:
                    pass
            no_thought_entry = _core_is_none(thought_entry)
            if no_thought_entry:
                thought_entry = {}
                thought_entry["index"] = index
                thought_entry["text"] = ""
                emitted_thought.append(thought_entry)
            else:
                pass
            so_far = _core_get(thought_entry, "text", "")
            joined = _core_add(so_far, value)
            thought_entry["text"] = joined
        else:
            run["output_emitted"] = True
    run["emitted_thought"] = emitted_thought
    empty_buffer = []
    buffer = _core_get(run, "buffer", empty_buffer)
    entry = _core_none()
    for candidate in buffer:
        candidate_index = _core_get(candidate, "index", None)
        same_index = _core_eq(candidate_index, index)
        if same_index:
            entry = candidate
        else:
            pass
    no_entry = _core_is_none(entry)
    if no_entry:
        entry = {}
        entry["index"] = index
        fresh_delta = {}
        entry["delta"] = fresh_delta
        buffer.append(entry)
        run["buffer"] = buffer
    else:
        pass
    empty_view = {}
    view = _core_get(entry, "delta", empty_view)
    for merge_key in keys:
        merge_value = _core_get(delta, merge_key, None)
        has_base = _core_map_contains(view, merge_key)
        base = _core_get(view, merge_key, None)
        merged = _stream_merge_value_impl(base, has_base, merge_value)
        view[merge_key] = merged
    entry["delta"] = view
    buffered = _core_get(run, "buffered", False)
    if buffered:
        return None
    else:
        pass
    sink = _core_get(run, "sink", None)
    no_sink = _core_is_none(sink)
    if no_sink:
        return None
    else:
        pass
    envelope = {}
    envelope["version"] = version
    envelope["index"] = index
    envelope["delta"] = delta
    _core_axgen_emit_delta(sink, envelope)
    return None


def _settle_failed_attempts_impl(messages: list[Any], failed: list[Any], cleanup: bool) -> list[Any]:
    _core_coverage_mark("_settle_failed_attempts_impl")
    failed_count = _core_len(failed)
    none_failed = _core_eq(failed_count, 0)
    if none_failed:
        return messages
    else:
        pass
    settled = []
    for message in messages:
        settled.append(message)
    for failed_message in failed:
        keep = _core_not(cleanup)
        role = _core_get(failed_message, "role", "")
        is_result = _core_eq(role, "function")
        keep = _core_or(keep, is_result)
        calls = _core_get(failed_message, "function_calls", None)
        has_calls = _core_truthy(calls)
        keep = _core_or(keep, has_calls)
        if keep:
            settled.append(failed_message)
        else:
            pass
    return settled


def _function_result_text_impl(result: Any, options: Any) -> str:
    _core_coverage_mark("_function_result_text_impl")
    empty_map = {}
    opts = _core_coalesce(options, empty_map)
    formatter_snake = _core_get(opts, "function_result_formatter", None)
    formatter = _core_get(opts, "functionResultFormatter", formatter_snake)
    has_local_formatter = _core_is_not_none(formatter)
    if has_local_formatter:
        pass
    else:
        global_formatter = _core_axgen_function_result_formatter()
        formatter = global_formatter
    has_formatter = _core_is_not_none(formatter)
    text = ""
    if has_formatter:
        formatted = _core_object_call_method(formatter, "format_result", result)
        text = _core_string_str(formatted)
    else:
        is_text = _core_type_is(result, "string")
        missing = _core_is_none(result)
        if is_text:
            text = result
        else:
            if missing:
                text = ""
            else:
                text = _core_json_pretty(result)
    empty = _core_eq(text, "")
    if empty:
        return "done"
    else:
        pass
    return text


def _stream_marker_incomplete_impl(marker: Any) -> bool:
    _core_coverage_mark("_stream_marker_incomplete_impl")
    no_marker = _core_is_none(marker)
    if no_marker:
        return False
    else:
        pass
    depth = _core_get(marker, "nesting_level", 0)
    nested = _core_gt(depth, 0)
    in_array = _core_get(marker, "in_array", False)
    in_object = _core_get(marker, "in_object", False)
    open = _core_or(nested, in_array)
    open = _core_or(open, in_object)
    return open


def _run_tool_calls_impl(gen: AxGen, functions: list[Any], messages: list[Any], calls: list[Any], options: Any) -> list[Any]:
    _core_coverage_mark("_run_tool_calls_impl")
    for call in calls:
        tool_ok = False
        tool_result = _core_none()
        try:
            executed = _execute_tool_call(functions, call, options)
            tool_result = executed
            tool_ok = True
        except Exception as tool_error:
            tool_error_message = _tool_error_message_impl(call, tool_error)
            messages.append(tool_error_message)
            tool_error_text = _core_get(tool_error_message, "result", "")
            _core_axgen_memory_add_function_result(gen, call, tool_error_text, False, tool_error_text)
            _core_axgen_record_function_call(gen, call, tool_error_message, "error")
        if tool_ok:
            tool_text = ""
            try:
                formatted_text = _function_result_text_impl(tool_result, options)
                tool_text = formatted_text
            except Exception as format_error:
                format_error_message = _tool_error_message_impl(call, format_error)
                _core_axgen_record_function_call(gen, call, format_error_message, "error")
                format_failure = _generate_failed_impl(format_error)
                raise format_failure
            tool_message = _tool_result_message_impl(call, tool_text)
            messages.append(tool_message)
            _core_axgen_memory_add_function_result(gen, call, tool_text, True, tool_text)
            _core_axgen_record_function_call(gen, call, tool_result, "ok")
        else:
            pass
    return messages


def _stream_apply_structured_impl(state: Any, fields: list[Any], parsed: Any, marker: Any, held: list[Any]) -> list[Any]:
    _core_coverage_mark("_stream_apply_structured_impl")
    deltas = []
    empty_values = {}
    values = _core_get(state, "values", empty_values)
    incomplete = _stream_marker_incomplete_impl(marker)
    result = stream_structured_delta(fields, parsed, values, incomplete)
    empty_full = {}
    full_values = _core_get(result, "full_values", empty_full)
    full_keys = _core_map_keys(full_values)
    for full_key in full_keys:
        full_value = _core_get(full_values, full_key, None)
        values[full_key] = full_value
    state["values"] = values
    empty_delta = {}
    delta = _core_get(result, "delta", empty_delta)
    visible = {}
    delta_keys = _core_map_keys(delta)
    for delta_key in delta_keys:
        is_held = _core_contains(held, delta_key)
        if is_held:
            continue
        else:
            pass
        delta_value = _core_get(delta, delta_key, None)
        visible[delta_key] = delta_value
    visible_count = _core_len(visible)
    has_delta = _core_gt(visible_count, 0)
    if has_delta:
        deltas.append(visible)
    else:
        pass
    return deltas


def _stream_feedback_text_impl(result: Any) -> Any:
    _core_coverage_mark("_stream_feedback_text_impl")
    none = _core_none()
    missing = _core_is_none(result)
    if missing:
        return none
    else:
        pass
    is_string = _core_type_is(result, "string")
    if is_string:
        empty = _core_eq(result, "")
        if empty:
            return none
        else:
            pass
        lowered = _core_string_lower(result)
        null_rest = "x"
        starts_null = _core_string_starts_with(lowered, "null")
        if starts_null:
            after_null = _core_string_slice(lowered, 4)
            null_rest = str(after_null).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        else:
            pass
        starts_undefined = _core_string_starts_with(lowered, "undefined")
        if starts_undefined:
            after_undefined = _core_string_slice(lowered, 9)
            null_rest = str(after_undefined).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        else:
            pass
        null_text = _core_eq(null_rest, "")
        if null_text:
            return none
        else:
            pass
        return result
    else:
        pass
    text = _stream_js_string_impl(result)
    return text


def _stream_run_processors_impl(gen: AxGen, kind: str, state: Any, content: str, done: bool) -> list[Any]:
    _core_coverage_mark("_stream_run_processors_impl")
    feedback = []
    empty_values = {}
    values = _core_get(state, "values", empty_values)
    empty_specs = []
    specs = _core_get(gen, "feedback_processors", empty_specs)
    streaming = _core_eq(kind, "streaming")
    curr_name = ""
    raw_value = ""
    if streaming:
        specs = _core_get(gen, "streaming_field_processors", empty_specs)
        empty_xstate = {}
        xstate = _core_get(state, "xstate", empty_xstate)
        curr = _core_get(xstate, "curr_field", None)
        no_curr = _core_is_none(curr)
        if no_curr:
            return feedback
        else:
            pass
        curr_name = _core_get(curr, "name", "")
        start = _core_get(xstate, "s", 0)
        raw_value = _core_string_slice(content, start)
        curr_type = _core_get(curr, "type", None)
        curr_type_name = _core_get(curr_type, "name", "")
        is_code = _core_eq(curr_type_name, "code")
        if is_code:
            raw_value = _stream_strip_leading_fence_impl(raw_value)
            raw_value = _stream_strip_trailing_fence_impl(raw_value)
        else:
            pass
    else:
        pass
    for spec in specs:
        field = _core_get(spec, "field", "")
        value = _core_none()
        if streaming:
            matches = _core_eq(field, curr_name)
            other = _core_not(matches)
            if other:
                continue
            else:
                pass
            value = raw_value
        else:
            present = _core_map_contains(values, field)
            absent = _core_not(present)
            if absent:
                continue
            else:
                pass
            value = _core_get(values, field, None)
        context = {}
        context["values"] = values
        context["done"] = done
        result = _core_none()
        try:
            result = _core_axgen_call_processor(spec, value, context)
        except Exception as processor_error:
            state["fatal_error"] = processor_error
            return feedback
        text = _stream_feedback_text_impl(result)
        has_text = _core_is_not_none(text)
        if has_text:
            feedback.append(text)
        else:
            pass
    return feedback


def _stream_check_assertions_impl(gen: AxGen, xstate: Any, content: str, done: bool) -> Any:
    _core_coverage_mark("_stream_check_assertions_impl")
    none = _core_none()
    curr = _core_get(xstate, "curr_field", None)
    no_curr = _core_is_none(curr)
    start = _core_get(xstate, "s", -1)
    unstarted = _core_eq(start, -1)
    skip = _core_or(no_curr, unstarted)
    if skip:
        return none
    else:
        pass
    curr_name = _core_get(curr, "name", "")
    value = _core_string_slice(content, start)
    empty_specs = []
    specs = _core_get(gen, "streaming_assertions", empty_specs)
    for spec in specs:
        field = _core_get(spec, "field", "")
        matches = _core_eq(field, curr_name)
        other = _core_not(matches)
        if other:
            continue
        else:
            pass
        outcome = {}
        try:
            outcome = _core_axgen_check_streaming_assertion(spec, value, done)
        except Exception as assertion_error:
            return assertion_error
        status = _core_get(outcome, "status", "pass")
        failed = _core_eq(status, "fail")
        if failed:
            returned = _core_get(outcome, "message", None)
            spec_message = _core_get(spec, "message", None)
            default_message = _core_string_format("Streaming assertion failed for field '{}'. Output was stopped.", field)
            message = _core_coalesce(spec_message, default_message)
            has_returned = _core_is_not_none(returned)
            if has_returned:
                message = returned
            else:
                pass
            xstate["assertion_failed"] = True
            error = _core_runtime_error(message)
            raise error
        else:
            pass
    return none


def _stream_emit_deltas_impl(ctx: Any, index: int, deltas: list[Any]) -> None:
    _core_coverage_mark("_stream_emit_deltas_impl")
    index_key = _core_string_format("{}", index)
    run = _core_get(ctx, "run", None)
    session = _core_get(ctx, "session", None)
    in_session = _core_is_not_none(session)
    final_pass = False
    session_started = False
    if in_session:
        final_pass = _core_get(session, "final", False)
        session_version = _core_get(session, "version", -1)
        session_started = _core_gte(session_version, 0)
    else:
        pass
    for delta in deltas:
        out_delta = delta
        if final_pass:
            out_delta = _stream_session_versioned_impl(ctx, delta)
        else:
            pass
        if session_started:
            _stream_session_sync_version_impl(ctx)
        else:
            pass
        empty_all = {}
        committed_all = _core_get(ctx, "committed", empty_all)
        current_all = _core_get(ctx, "current", empty_all)
        empty_committed = {}
        committed = _core_get(committed_all, index_key, empty_committed)
        committed_all[index_key] = committed
        empty_current = {}
        current = _core_get(current_all, index_key, empty_current)
        current_all[index_key] = current
        version = _core_get(ctx, "version", 0)
        effective = _stream_commit_delta_impl(committed, current, out_delta)
        count = _core_len(effective)
        has_effective = _core_gt(count, 0)
        if has_effective:
            _stream_yield_impl(run, version, index, effective)
        else:
            pass
    return None


def _stream_held_fields_impl(gen: AxGen, fields: list[Any]) -> list[Any]:
    _core_coverage_mark("_stream_held_fields_impl")
    held = []
    empty_specs = []
    specs = _core_get(gen, "field_processors", empty_specs)
    for spec in specs:
        is_spec_map = _core_type_is(spec, "object")
        if is_spec_map:
            name_alias = _core_get(spec, "name", "")
            name = _core_get(spec, "field", name_alias)
            has_name = _core_truthy(name)
            seen = _core_contains(held, name)
            unseen = _core_not(seen)
            add = _core_and(has_name, unseen)
            if add:
                held.append(name)
            else:
                pass
            continue
        else:
            pass
        for field in fields:
            field_name = _core_get(field, "name", "")
            field_seen = _core_contains(held, field_name)
            field_unseen = _core_not(field_seen)
            if field_unseen:
                held.append(field_name)
            else:
                pass
    return held


def _stream_chunk_content_impl(gen: AxGen, config: Any, state: Any, result: Any) -> list[Any]:
    _core_coverage_mark("_stream_chunk_content_impl")
    deltas = []
    empty_calls = []
    calls_snake = _core_get(result, "function_calls", empty_calls)
    calls = _core_get(result, "functionCalls", calls_snake)
    call_count = _core_len(calls)
    has_calls = _core_gt(call_count, 0)
    if has_calls:
        return deltas
    else:
        pass
    chunk_text = _core_get(result, "content", "")
    is_text = _core_type_is(chunk_text, "string")
    not_text = _core_not(is_text)
    if not_text:
        return deltas
    else:
        pass
    empty_chunk = _core_eq(chunk_text, "")
    if empty_chunk:
        return deltas
    else:
        pass
    old_content = _core_get(state, "content", "")
    content = _core_string_concat_stream_text(old_content, chunk_text)
    state["content"] = content
    empty_fields = []
    fields = _core_get(config, "fields", empty_fields)
    decisions = _evidence_has_fields_impl(fields)
    if decisions:
        return deltas
    else:
        pass
    empty_held = []
    held = _core_get(config, "held", empty_held)
    structured = _core_get(config, "structured", False)
    if structured:
        should_parse = _stream_json_should_parse_impl(state, content)
        skip_parse = _core_not(should_parse)
        if skip_parse:
            return deltas
        else:
            pass
        partial = _stream_json_parse_partial_impl(content)
        parsed = _core_get(partial, "parsed", None)
        marker = _core_get(partial, "marker", None)
        is_map = _core_type_is(parsed, "object")
        not_map = _core_not(is_map)
        if not_map:
            return deltas
        else:
            pass
        has_marker = _core_is_not_none(marker)
        prepared = {}
        parse_strings = _core_get(config, "parse_json_strings", False)
        try:
            prepared = _stream_json_select_fields_impl(fields, parsed)
            if parse_strings:
                _stream_json_strings_impl(fields, prepared, True)
            else:
                pass
        except Exception as prepare_error:
            if has_marker:
                return deltas
            else:
                pass
            raise prepare_error
        try:
            _stream_json_validate_impl(fields, prepared, True, False)
        except Exception as partial_error:
            complete = _core_not(has_marker)
            if complete:
                raise partial_error
            else:
                pass
        structured_deltas = _stream_apply_structured_impl(state, fields, prepared, marker, held)
        return structured_deltas
    else:
        pass
    empty_xstate = {}
    xstate = _core_get(state, "xstate", empty_xstate)
    empty_values = {}
    values = _core_get(state, "values", empty_values)
    skip = _stream_text_extract_impl(xstate, values, content, fields, config)
    if skip:
        return deltas
    else:
        pass
    assertion_thrown = _stream_check_assertions_impl(gen, xstate, content, False)
    assertion_threw = _core_is_not_none(assertion_thrown)
    if assertion_threw:
        state["fatal_error"] = assertion_thrown
        return deltas
    else:
        pass
    session_partial = _core_get(config, "session_partial", False)
    run_processors = _core_not(session_partial)
    feedback = []
    if run_processors:
        feedback = _stream_run_processors_impl(gen, "streaming", state, content, False)
    else:
        pass
    processor_failure = _core_get(state, "fatal_error", None)
    processor_failed = _core_is_not_none(processor_failure)
    if processor_failed:
        return deltas
    else:
        pass
    empty_feedback = []
    pending = _core_get(state, "feedback", empty_feedback)
    for text in feedback:
        pending.append(text)
    state["feedback"] = pending
    text_deltas = _stream_text_values_impl(fields, content, values, xstate, held, False)
    return text_deltas


def _stream_finalize_impl(gen: AxGen, config: Any, ctx: Any, state: Any) -> Any:
    _core_coverage_mark("_stream_finalize_impl")
    out = {}
    empty_fields = []
    fields = _core_get(config, "fields", empty_fields)
    empty_held = []
    held = _core_get(config, "held", empty_held)
    structured = _core_get(config, "structured", False)
    strict_json = _core_get(config, "strict_json", False)
    parse_strings = _core_get(config, "parse_json_strings", False)
    thought_field = _core_get(config, "thought_field", "thought")
    content = _core_get(state, "content", "")
    index = _core_get(state, "index", 0)
    empty_values = {}
    values = _core_get(state, "values", empty_values)
    empty_xstate = {}
    xstate = _core_get(state, "xstate", empty_xstate)
    json_parsed = False
    if structured:
        final_json = _core_none()
        syntax_error = False
        try:
            final_json = _core_json_parse_strict(content)
        except Exception as parse_error:
            syntax_error = True
        if syntax_error:
            if strict_json:
                strict_error = _core_validation_error("Structured output must be one JSON object with no prose or Markdown fences.")
                raise strict_error
            else:
                pass
        else:
            final_is_map = _core_type_is(final_json, "object")
            final_not_map = _core_not(final_is_map)
            if final_not_map:
                shape_error = _core_validation_error("Structured output must be a JSON object matching the output fields.")
                raise shape_error
            else:
                pass
            if parse_strings:
                _stream_json_strings_impl(fields, final_json, False)
            else:
                pass
            _stream_json_validate_impl(fields, final_json, False, strict_json)
            decision_context = _core_get(config, "decision_context", None)
            decisions = _evidence_has_fields_impl(fields)
            if decisions:
                final_json = _evidence_decode_values_impl(fields, final_json, decision_context, "")
            else:
                pass
            no_marker = _core_none()
            final_deltas = _stream_apply_structured_impl(state, fields, final_json, no_marker, held)
            _stream_emit_deltas_impl(ctx, index, final_deltas)
            json_parsed = True
    else:
        pass
    text_route = _core_not(json_parsed)
    if text_route:
        _stream_text_final_impl(xstate, values, content, fields, config)
    else:
        pass
    assertion_thrown = _stream_check_assertions_impl(gen, xstate, content, True)
    assertion_threw = _core_is_not_none(assertion_thrown)
    if assertion_threw:
        out["failure"] = assertion_thrown
        return out
    else:
        pass
    empty_feedback = []
    feedback = _core_get(state, "feedback", empty_feedback)
    processed = _stream_run_processors_impl(gen, "feedback", state, content, True)
    for processed_text in processed:
        feedback.append(processed_text)
    streamed = _stream_run_processors_impl(gen, "streaming", state, content, True)
    for streamed_text in streamed:
        feedback.append(streamed_text)
    processor_failure = _core_get(state, "fatal_error", None)
    processor_failed = _core_is_not_none(processor_failure)
    if processor_failed:
        out["failure"] = processor_failure
        return out
    else:
        pass
    output = {}
    value_keys = _core_map_keys(values)
    for value_key in value_keys:
        is_thought = _core_eq(value_key, thought_field)
        if is_thought:
            continue
        else:
            pass
        value = _core_get(values, value_key, None)
        output[value_key] = value
    transformed = _apply_field_processors(gen, output)
    failure = _run_assertions(gen, transformed)
    failed = _core_is_not_none(failure)
    if failed:
        out["failure"] = failure
        return out
    else:
        pass
    if text_route:
        text_deltas = _stream_text_values_impl(fields, content, values, xstate, held, True)
        _stream_emit_deltas_impl(ctx, index, text_deltas)
    else:
        pass
    held_deltas = []
    for held_name in held:
        has_held = _core_map_contains(transformed, held_name)
        internal = False
        for field in fields:
            field_name = _core_get(field, "name", "")
            same = _core_eq(field_name, held_name)
            if same:
                internal = _stream_field_flag_impl(field, "is_internal", "isInternal")
            else:
                pass
        visible = _core_not(internal)
        send = _core_and(has_held, visible)
        if send:
            held_value = _core_get(transformed, held_name, None)
            held_delta = {}
            held_delta[held_name] = held_value
            held_deltas.append(held_delta)
        else:
            pass
    _stream_emit_deltas_impl(ctx, index, held_deltas)
    out["feedback"] = feedback
    out["output"] = transformed
    return out


def _stream_result_impl(run: Any, options: Any) -> Any:
    _core_coverage_mark("_stream_result_impl")
    empty_buffer = []
    buffer = _core_get(run, "buffer", empty_buffer)
    buffered = _core_get(run, "buffered", False)
    selected = 0
    if buffered:
        samples = []
        position = 0
        for entry in buffer:
            sample = {}
            sample["index"] = position
            entry_delta = _core_get(entry, "delta", None)
            sample["sample"] = entry_delta
            samples.append(sample)
            position = _core_add(position, 1)
        selected = _select_sample_index(samples, options)
    else:
        pass
    none = _core_none()
    picked = _core_list_get(buffer, selected, none)
    missing = _core_is_none(picked)
    if missing:
        empty_output = {}
        return empty_output
    else:
        pass
    empty_delta = {}
    picked_delta = _core_get(picked, "delta", empty_delta)
    output = _render_stream_result_impl(run, picked_delta)
    sink = _core_get(run, "sink", None)
    has_sink = _core_is_not_none(sink)
    send_picked = _core_and(buffered, has_sink)
    if send_picked:
        envelope = {}
        version = _core_get(run, "current_version", 0)
        envelope["version"] = version
        envelope["index"] = selected
        envelope["delta"] = output
        _core_axgen_emit_delta(sink, envelope)
    else:
        pass
    return output


def _stream_strip_partial_closing_fence_impl(text: str) -> str:
    _core_coverage_mark("_stream_strip_partial_closing_fence_impl")
    length = _core_len(text)
    cursor = length
    run = 0
    while True:
        at_start = _core_lte(cursor, 0)
        if at_start:
            break
        else:
            pass
        before = _core_add(cursor, -1)
        ch = _core_string_slice(text, before, cursor)
        tick = _core_eq(ch, "`")
        not_tick = _core_not(tick)
        if not_tick:
            break
        else:
            pass
        run = _core_add(run, 1)
        cursor = before
    no_run = _core_eq(run, 0)
    if no_run:
        return text
    else:
        pass
    long_run = _core_gte(run, 3)
    if long_run:
        end = _core_add(length, -2)
        kept = _core_string_slice(text, 0, end)
        return kept
    else:
        pass
    body = _core_string_slice(text, 0, cursor)
    out = _stream_trim_end_impl(body)
    return out


def _stream_is_partial_opening_fence_impl(text: str) -> bool:
    _core_coverage_mark("_stream_is_partial_opening_fence_impl")
    one = _core_eq(text, "`")
    two = _core_eq(text, "``")
    short_run = _core_or(one, two)
    if short_run:
        return True
    else:
        pass
    fenced = _core_string_starts_with(text, "```")
    not_fenced = _core_not(fenced)
    if not_fenced:
        return False
    else:
        pass
    length = _core_len(text)
    cursor = 3
    while True:
        at_end = _core_gte(cursor, length)
        if at_end:
            break
        else:
            pass
        next = _core_add(cursor, 1)
        ch = _core_string_slice(text, cursor, next)
        word = _core_regex_match("^[a-zA-Z0-9]$", ch)
        not_word = _core_not(word)
        if not_word:
            return False
        else:
            pass
        cursor = next
    return True


def _stream_json_type_error_impl(field: Any, value: Any, detail: str) -> error:
    _core_coverage_mark("_stream_json_type_error_impl")
    title = _stream_field_title_impl(field)
    shown = ""
    is_text = _core_type_is(value, "string")
    if is_text:
        shown = value
    else:
        shown = _core_json_stringify(value)
    label = _stream_field_type_label_impl(field)
    message = _core_add("Field '", title)
    message = _core_add(message, "' has an invalid value '")
    message = _core_add(message, shown)
    message = _core_add(message, "': ")
    message = _core_add(message, detail)
    message = _core_add(message, ". Provide a ")
    message = _core_add(message, label)
    message = _core_add(message, ". Ensure formatting exactly matches the expected type.")
    error = _core_validation_error(message)
    return error


def _stream_json_coerce_scalar_impl(field: Any, value: Any) -> Any:
    _core_coverage_mark("_stream_json_coerce_scalar_impl")
    typ = _core_get(field, "type", None)
    decision = _evidence_is_type_impl(typ)
    if decision:
        return value
    else:
        pass
    name = _core_get(typ, "name", "string")
    is_boolean_value = _core_type_is(value, "boolean")
    is_number_type = _core_eq(name, "number")
    if is_number_type:
        is_number_value = _core_type_is(value, "number")
        plain_number = _core_not(is_boolean_value)
        number_ok = _core_and(is_number_value, plain_number)
        if number_ok:
            return value
        else:
            pass
        is_number_text = _core_type_is(value, "string")
        if is_number_text:
            number_trimmed = str(value).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
            number_blank = _core_eq(number_trimmed, "")
            number_filled = _core_not(number_blank)
            if number_filled:
                converted = _stream_js_number_impl(value)
                parsed = _core_is_not_none(converted)
                if parsed:
                    return converted
                else:
                    pass
            else:
                pass
        else:
            pass
        number_error = _stream_json_type_error_impl(field, value, "Invalid number")
        raise number_error
    else:
        pass
    is_boolean_type = _core_eq(name, "boolean")
    if is_boolean_type:
        if is_boolean_value:
            return value
        else:
            pass
        is_boolean_text = _core_type_is(value, "string")
        if is_boolean_text:
            lowered = _core_string_lower(value)
            said_true = _core_eq(lowered, "true")
            if said_true:
                return True
            else:
                pass
            said_false = _core_eq(lowered, "false")
            if said_false:
                return False
            else:
                pass
        else:
            pass
        boolean_error = _stream_json_type_error_impl(field, value, "Invalid boolean")
        raise boolean_error
    else:
        pass
    is_string_type = _core_eq(name, "string")
    is_code_type = _core_eq(name, "code")
    is_class_type = _core_eq(name, "class")
    needs_text = _core_or(is_string_type, is_code_type)
    needs_text = _core_or(needs_text, is_class_type)
    if needs_text:
        is_text_value = _core_type_is(value, "string")
        not_text_value = _core_not(is_text_value)
        if not_text_value:
            text_error = _stream_json_type_error_impl(field, value, "Expected a string")
            raise text_error
        else:
            pass
        if is_class_type:
            class_options = _core_get(typ, "options", None)
            has_options = _core_truthy(class_options)
            if has_options:
                known_class = _core_contains(class_options, value)
                unknown_class = _core_not(known_class)
                if unknown_class:
                    option_list = _core_string_join(", ", class_options)
                    class_detail = _core_add("Invalid class '", value)
                    class_detail = _core_add(class_detail, "', expected one of the following: ")
                    class_detail = _core_add(class_detail, option_list)
                    class_error = _stream_json_type_error_impl(field, value, class_detail)
                    raise class_error
                else:
                    pass
            else:
                pass
        else:
            pass
        return value
    else:
        pass
    is_object_type = _core_eq(name, "object")
    if is_object_type:
        is_object_value = _core_type_is(value, "object")
        not_object_value = _core_not(is_object_value)
        if not_object_value:
            object_error = _stream_json_type_error_impl(field, value, "Expected an object")
            raise object_error
        else:
            pass
    else:
        pass
    return value


def _stream_json_validate_output_impl(fields: list[Any], values: Any) -> Any:
    _core_coverage_mark("_stream_json_validate_output_impl")
    _stream_json_validate_impl(fields, values, False, False)
    return values


def _stream_text_expect_required_impl(fields: list[Any]) -> None:
    _core_coverage_mark("_stream_text_expect_required_impl")
    for field in fields:
        optional = _stream_field_flag_impl(field, "is_optional", "isOptional")
        if optional:
            continue
        else:
            pass
        title = _stream_field_title_impl(field)
        label = _stream_field_type_label_impl(field)
        message = _core_string_format("Expected (Required) field not found: '{}'. Begin a new section with \"{}:\" and then provide a valid {} value directly after.", title, title, label)
        error = _core_validation_error(message)
        raise error
    return None


def _stream_session_state_impl(fields: list[Any], thought_field: str) -> Any:
    _core_coverage_mark("_stream_session_state_impl")
    session = {}
    session["version"] = -1
    session["last_version"] = 0
    none = _core_none()
    session["response_id"] = none
    session["shadow"] = none
    provisional = {}
    session["provisional"] = provisional
    final_values = {}
    session["final_values"] = final_values
    session["final"] = False
    session["fields"] = fields
    session["thought_field"] = thought_field
    turns = []
    session["turns"] = turns
    session["turns_added"] = False
    return session


def _stream_session_select_impl(ctx: Any, response_id: Any) -> bool:
    _core_coverage_mark("_stream_session_select_impl")
    session = _core_get(ctx, "session", None)
    current = _core_get(session, "response_id", None)
    has_current = _core_is_not_none(current)
    same_id = _core_eq(current, response_id)
    same = _core_and(has_current, same_id)
    if same:
        return False
    else:
        pass
    session["response_id"] = response_id
    version = _core_get(session, "version", -1)
    next = _core_add(version, 1)
    session["version"] = next
    shadow = _stream_state_impl(0)
    session["shadow"] = shadow
    provisional = {}
    session["provisional"] = provisional
    return True


def _stream_session_sync_version_impl(ctx: Any) -> None:
    _core_coverage_mark("_stream_session_sync_version_impl")
    session = _core_get(ctx, "session", None)
    version = _core_get(session, "version", -1)
    last = _core_get(session, "last_version", 0)
    moved = _core_ne(version, last)
    not_moved = _core_not(moved)
    if not_moved:
        return None
    else:
        pass
    session["last_version"] = version
    control_version = _core_get(ctx, "control_version", 0)
    next_control = _core_add(control_version, 1)
    ctx["control_version"] = next_control
    attempt_version = _core_get(ctx, "version", 0)
    next_version = _core_add(attempt_version, 1)
    ctx["version"] = next_version
    empty_all = {}
    committed_all = _core_get(ctx, "committed", empty_all)
    committed_keys = _core_map_keys(committed_all)
    for committed_key in committed_keys:
        cleared_committed = {}
        committed_all[committed_key] = cleared_committed
    current_all = _core_get(ctx, "current", empty_all)
    current_keys = _core_map_keys(current_all)
    for current_key in current_keys:
        cleared_current = {}
        current_all[current_key] = cleared_current
    return None


def _stream_session_merge_impl(values: Any, delta: Any) -> None:
    _core_coverage_mark("_stream_session_merge_impl")
    keys = _core_map_keys(delta)
    for key in keys:
        value = _core_get(delta, key, None)
        has_base = _core_map_contains(values, key)
        base = _core_get(values, key, None)
        merged = _stream_merge_value_impl(base, has_base, value)
        values[key] = merged
    return None


def _stream_session_failure_impl(info: Any, error: error) -> error:
    _core_coverage_mark("_stream_session_failure_impl")
    message = _core_exception_message(error)
    empty_pending = []
    pending = _core_get(info, "pending_calls", empty_pending)
    unresolved = _core_string_join(", ", pending)
    none_pending = _core_eq(unresolved, "")
    if none_pending:
        unresolved = "none"
    else:
        pass
    text = _core_string_format("Chat session failed: {}; unresolved calls: {}", message, unresolved)
    failure = _core_runtime_error(text)
    return failure


def _stream_session_partial_impl(gen: AxGen, config: Any, ctx: Any, item: Any) -> Any:
    _core_coverage_mark("_stream_session_partial_impl")
    out = {}
    none = _core_none()
    out["fatal"] = none
    session = _core_get(ctx, "session", None)
    shadow = _core_get(session, "shadow", None)
    stopped = _core_is_none(shadow)
    if stopped:
        return out
    else:
        pass
    empty_info = {}
    info = _core_get(item, "session", empty_info)
    shadow_config = _core_map_merge(config, empty_info)
    shadow_config["session_partial"] = True
    thought_field = _core_get(config, "thought_field", "thought")
    provisional = _core_get(session, "provisional", None)
    empty_results = []
    results = _core_get(item, "results", empty_results)
    for result in results:
        index = _core_get(result, "index", 0)
        other_index = _core_ne(index, 0)
        if other_index:
            continue
        else:
            pass
        thought = _core_get(result, "thought", "")
        thought_is_text = _core_type_is(thought, "string")
        has_thought = _core_truthy(thought)
        thought_chunk = _core_and(thought_is_text, has_thought)
        if thought_chunk:
            thought_delta = {}
            thought_delta[thought_field] = thought
            _stream_session_merge_impl(provisional, thought_delta)
            thought_deltas = []
            thought_deltas.append(thought_delta)
            _stream_emit_deltas_impl(ctx, 0, thought_deltas)
        else:
            pass
        content_deltas = []
        try:
            content_deltas = _stream_chunk_content_impl(gen, shadow_config, shadow, result)
        except Exception as partial_error:
            empty_xstate = {}
            xstate = _core_get(shadow, "xstate", empty_xstate)
            assertion_failed = _core_get(xstate, "assertion_failed", False)
            if assertion_failed:
                calls_started = _core_get(info, "calls_started", False)
                if calls_started:
                    started_failure = _stream_session_failure_impl(info, partial_error)
                    out["fatal"] = started_failure
                    return out
                else:
                    pass
                raise partial_error
            else:
                pass
            session["shadow"] = none
            return out
        assertion_error = _core_get(shadow, "fatal_error", None)
        assertion_threw = _core_is_not_none(assertion_error)
        if assertion_threw:
            thrown_failure = _stream_session_failure_impl(info, assertion_error)
            out["fatal"] = thrown_failure
            return out
        else:
            pass
        for content_delta in content_deltas:
            _stream_session_merge_impl(provisional, content_delta)
        _stream_emit_deltas_impl(ctx, 0, content_deltas)
    return out


def _stream_session_versioned_impl(ctx: Any, delta: Any) -> Any:
    _core_coverage_mark("_stream_session_versioned_impl")
    session = _core_get(ctx, "session", None)
    final_values = _core_get(session, "final_values", None)
    _stream_session_merge_impl(final_values, delta)
    provisional = _core_get(session, "provisional", None)
    diverged = False
    final_keys = _core_map_keys(final_values)
    for final_key in final_keys:
        final_value = _core_get(final_values, final_key, None)
        sent = _core_get(provisional, final_key, None)
        final_is_text = _core_type_is(final_value, "string")
        sent_is_text = _core_type_is(sent, "string")
        both_text = _core_and(final_is_text, sent_is_text)
        if both_text:
            extends_sent = _core_string_starts_with(final_value, sent)
            taken_back = _core_not(extends_sent)
            if taken_back:
                diverged = True
            else:
                pass
        else:
            pass
    if diverged:
        version = _core_get(session, "version", 0)
        next = _core_add(version, 1)
        session["version"] = next
        provisional = {}
        session["provisional"] = provisional
    else:
        pass
    empty_fields = []
    fields = _core_get(session, "fields", empty_fields)
    result = stream_structured_delta(fields, final_values, provisional, False)
    empty_out = {}
    out = _core_get(result, "delta", empty_out)
    empty_full = {}
    full = _core_get(result, "full_values", empty_full)
    thought_field = _core_get(session, "thought_field", "thought")
    thought = _core_get(final_values, thought_field, None)
    thought_is_text = _core_type_is(thought, "string")
    if thought_is_text:
        sent_thought = _core_get(provisional, thought_field, None)
        sent_thought_is_text = _core_type_is(sent_thought, "string")
        sent_length = 0
        if sent_thought_is_text:
            sent_length = _core_len(sent_thought)
        else:
            pass
        rest = _core_string_slice(thought, sent_length)
        has_rest = _core_ne(rest, "")
        if has_rest:
            out[thought_field] = rest
        else:
            pass
        full[thought_field] = thought
    else:
        pass
    full_keys = _core_map_keys(full)
    for full_key in full_keys:
        full_value = _core_get(full, full_key, None)
        provisional[full_key] = full_value
    return out


def _stream_session_add_turns_impl(messages: list[Any], session: Any) -> list[Any]:
    _core_coverage_mark("_stream_session_add_turns_impl")
    added = _core_get(session, "turns_added", False)
    if added:
        return messages
    else:
        pass
    session["turns_added"] = True
    empty_turns = []
    turns = _core_get(session, "turns", empty_turns)
    for turn in turns:
        messages.append(turn)
    return messages

# END AXIR CORE EMITTED FUNCTIONS

class AxDecisionRefusalError(RuntimeError):
    """Terminal refusal of a signature decision field."""
    def __init__(self, field_path, provenance):
        self.field_path, self.provenance = field_path, provenance
        super().__init__(f"Decision refused: {field_path}")

def _core_decision_refusal_error(path, provenance):
    return AxDecisionRefusalError(path, provenance)


def novel_f1_score(history: str, prediction: str, ground_truth: str, return_recall: bool = False) -> float:
    """Score novel token overlap, excluding history and stopwords; two empty inputs score one."""
    return eval_novel_f1(history, prediction, ground_truth, return_recall)
