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
    _schema_to_json_schema_impl,
)
from .signature import (
    _signature_output_value_descriptions_impl,
)


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
        the model instead (see add_field_processor(..., feedback=True)).
        """
        self.field_processors.append({"field": field, "processor": processor})
        return self

    def add_field_processor(self, field, processor, *, feedback=False):
        """Add a field processor.

        With ``feedback=True`` it follows TypeScript: ``processor(value,
        {"values", "done"})`` runs on the field's final value, and a non-empty
        result is sent to the model as a user message for another step. The
        default still rewrites the field like add_field_transform(), and is
        deprecated: it becomes the feedback behavior in the next major
        version.
        """
        if feedback:
            self.feedback_processors.append({"field": field, "processor": processor})
            return self
        warnings.warn(
            "add_field_processor() without feedback=True rewrites the field value; "
            "use add_field_transform() for that. In the next major version "
            "add_field_processor() will follow TypeScript and feed its result back "
            "to the model.",
            DeprecationWarning,
            stacklevel=2,
        )
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
        """Stream a forward.

        With ``{"deltas": True}`` this yields TypeScript's ``{"version",
        "index", "delta"}`` deltas: merge each index's deltas (strings and
        lists append, other values replace) and start over when the version
        changes. Without the flag it still yields raw provider events, which
        is deprecated: deltas become the default in the next major version,
        and stream_raw() keeps the raw events.
        """
        run_options = dict(options or {})
        if run_options.pop("deltas", False):
            return self._streaming_deltas(client, values, run_options, hooks)
        warnings.warn(
            "streaming_forward() without {'deltas': True} yields raw provider events; "
            "TypeScript's {version, index, delta} deltas become the default in the next "
            "major version. Pass {'deltas': True} now, or use stream_raw() to keep raw events.",
            DeprecationWarning,
            stacklevel=2,
        )
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
            output = _parse_output_fields_impl(content, self.signature.get_output_fields())
            validate_output(self.signature.get_output_fields(), output)

    def _request(self, messages, options, client=None):
        request_options = options or {}
        features = _core_ai_client_features(client, request_options.get("model")) if client is not None else {}
        selection = _select_structured_output_rung(self.signature, features, request_options)
        return _build_gen_chat_request(self, messages, request_options, selection, 0)

    def _execute_tool(self, call):
        return _execute_tool_call(self.functions, call)


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


def _date_datetime_format_error_impl() -> Any:
    _core_coverage_mark("_date_datetime_format_error_impl")
    error = _core_runtime_error("Invalid date and time format. Use ISO 8601 like \"YYYY-MM-DDTHH:mm:ssZ\" or \"YYYY-MM-DDTHH:mm:ss+05:30\". Legacy \"YYYY-MM-DD HH:mm Timezone\" values are also accepted.")
    return error


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


def _parse_sample_outputs(gen: AxGen, output_fields: list[Any], response: Any, validate_exact_json: bool, thought_field: str, thought_prefix: str, text_contract: bool, strict_mode: bool) -> Any:
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
            if text_contract:
                _stream_text_required_check_impl(validated, output_fields)
            else:
                pass
        else:
            pass
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
    messages = _core_object_call_method(prompt_template, "render", values, render_options)
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
        request = _build_gen_chat_request(gen, messages, runtime_options, selection, step)
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
                    structured_retry_messages = _append_structured_output_retry_messages_impl(messages, response, structured_call, structured_validation_error, structured_stage)
                    messages = structured_retry_messages
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
            try:
                parsed = _parse_sample_outputs(gen, output_fields, response, validate_exact_json, thought_field, thought_prefix, text_contract, strict_mode)
                parsed_bundle = parsed
            except Exception as validation_error:
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
                retry_messages = _append_assertion_retry_messages(messages, response, validation_error)
                messages = retry_messages
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


def chat_session_target_matches(target: str, path: str) -> bool:
    _core_coverage_mark("chat_session_target_matches")
    exact = _core_eq(target, path)
    prefix = _core_string_format("{}/", target)
    descendant = _core_string_starts_with(path, prefix)
    matches = _core_or(exact, descendant)
    return matches


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


def _date_zone_offset_millis_impl(zone: Any, millis: Any) -> Any:
    _core_coverage_mark("_date_zone_offset_millis_impl")
    parts = _date_parts_in_zone_impl(zone, millis)
    local = _date_utc_ms_impl(parts)
    negated = _core_mul(millis, -1)
    offset = _core_add(local, negated)
    return offset


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


def chat_session_final_result(state: Any, response: Any) -> Any:
    _core_coverage_mark("chat_session_final_result")
    id = _core_get(state, "response_id", "")
    result = chat_session_result(response, id)
    empty_turns = []
    turns = _core_get(state, "turns", empty_turns)
    result["__session_turns"] = turns
    return result


def _stream_field_flag_impl(target: Any, snake: str, camel: str) -> bool:
    _core_coverage_mark("_stream_field_flag_impl")
    snake_value = _core_get(target, snake, False)
    value = _core_get(target, camel, snake_value)
    flag = _core_truthy(value)
    return flag


def chat_session_completion(response: Any, id: str) -> Any:
    _core_coverage_mark("chat_session_completion")
    completion = chat_response_to_completion(response)
    completion["remote_id"] = id
    return completion


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


def chat_session_has_continuation_work(state: Any) -> bool:
    _core_coverage_mark("chat_session_has_continuation_work")
    pending = chat_session_unresolved(state)
    pending = _core_truthy(pending)
    native_wait = chat_session_native_wait(state)
    continuation = _core_get(state, "needs_continuation", False)
    work = _core_or(pending, native_wait)
    work = _core_or(work, continuation)
    return work


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


def _stream_required_missing_error_impl(field: Any) -> error:
    _core_coverage_mark("_stream_required_missing_error_impl")
    title = _stream_field_title_impl(field)
    label = _stream_field_type_label_impl(field)
    message = _core_string_format("Required field is missing: '{}'. After the \"{}:\" label, provide a non-empty {}. Do not use null, undefined, or leave it blank.", title, title, label)
    error = _core_validation_error(message)
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


def _set_examples(gen: AxGen, examples: list[Any]) -> AxGen:
    _core_coverage_mark("_set_examples")
    gen["examples"] = examples
    return gen


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


def _set_demos(gen: AxGen, demos: list[Any]) -> AxGen:
    _core_coverage_mark("_set_demos")
    gen["demos"] = demos
    return gen


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


def _render_examples(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_examples")
    messages = _core_axgen_render_examples(gen)
    return messages


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


def _render_demos(gen: AxGen) -> list[Any]:
    _core_coverage_mark("_render_demos")
    messages = _core_axgen_render_demos(gen)
    return messages


def _apply_field_processors(gen: AxGen, output: Any) -> Any:
    _core_coverage_mark("_apply_field_processors")
    processed = _core_axgen_apply_field_processors(gen, output)
    return processed


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


def _append_assertion_retry_messages(messages: list[Any], response: Any, error: error) -> list[Any]:
    _core_coverage_mark("_append_assertion_retry_messages")
    updated_messages = _append_validation_retry_messages_impl(messages, response, error)
    return updated_messages


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


def _record_trace(gen: AxGen, input: Any, output: Any, status: str) -> None:
    _core_coverage_mark("_record_trace")
    _core_axgen_record_trace(gen, input, output, status)
    return None


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


def _should_continue_steps(gen: AxGen, calls: list[Any]) -> bool:
    _core_coverage_mark("_should_continue_steps")
    should_continue = _core_axgen_should_continue_steps(gen, calls)
    return should_continue


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


def _parse_output_impl(content: str) -> Any:
    _core_coverage_mark("_parse_output_impl")
    text = str(content).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    output = _core_json_parse_strict(text)
    return output


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


def chat_session_close_state(state: Any) -> list[Any]:
    _core_coverage_mark("chat_session_close_state")
    state["terminal"] = True
    unresolved = chat_session_unresolved(state)
    return unresolved


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


def _response_function_calls_impl(response: Any) -> list[Any]:
    _core_coverage_mark("_response_function_calls_impl")
    empty = []
    calls = _core_get(response, "function_calls", empty)
    return calls


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


def _function_call_forces_tool_impl(choice: Any) -> bool:
    _core_coverage_mark("_function_call_forces_tool_impl")
    is_required = _core_eq(choice, "required")
    if is_required:
        return True
    else:
        pass
    is_named = _core_type_is(choice, "object")
    return is_named


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


def _with_output_thought_impl(output: Any, field: str, prefix: str, thought: str) -> Any:
    _core_coverage_mark("_with_output_thought_impl")
    joined = _core_add(prefix, thought)
    has_thought = _core_truthy(joined)
    if has_thought:
        output[field] = joined
    else:
        pass
    return output


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
    messages = _core_object_call_method(prompt_template, "render", values, render_options)
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
    cleaned = []
    clean_length = _core_len(result)
    clean_cursor = 0
    while True:
        clean_done = _core_gte(clean_cursor, clean_length)
        if clean_done:
            break
        else:
            pass
        clean_next = _core_add(clean_cursor, 1)
        clean_ch = _core_string_slice(result, clean_cursor, clean_next)
        is_comma = _core_eq(clean_ch, ",")
        if is_comma:
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
    result = _stream_json_complete_literal_impl(result, "true")
    result = _stream_json_complete_literal_impl(result, "false")
    result = _stream_json_complete_literal_impl(result, "null")
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


def _parse_text_contract_output_impl(content: str, output_fields: list[Any], strict_mode: bool) -> Any:
    _core_coverage_mark("_parse_text_contract_output_impl")
    out = {}
    trimmed = str(content).strip("\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
    opens_object = _core_string_starts_with(trimmed, "{")
    lenient = _core_not(strict_mode)
    looks_json = _core_and(opens_object, lenient)
    if looks_json:
        candidate = _core_none()
        try:
            candidate = _core_json_parse_strict(trimmed)
        except Exception as not_json:
            pass
        is_object = _core_type_is(candidate, "object")
        if is_object:
            declared_only = True
            keys = _core_map_keys(candidate)
            for key in keys:
                declared = False
                for field in output_fields:
                    field_name = _core_get(field, "name", "")
                    same = _core_eq(field_name, key)
                    if same:
                        declared = True
                    else:
                        pass
                undeclared = _core_not(declared)
                if undeclared:
                    declared_only = False
                else:
                    pass
            if declared_only:
                _core_axgen_deprecation("json-text-contract", "A text-contract answer that is one JSON object of output fields is parsed as those fields for compatibility; TypeScript Ax reads it as text. This fallback is deprecated and will be removed in the next major version: answer with `Label: value` lines.")
                out["values"] = candidate
                out["extracted"] = False
                return out
            else:
                pass
        else:
            pass
    else:
        pass
    values = _stream_text_extract_values_impl(content, output_fields, strict_mode)
    out["values"] = values
    out["extracted"] = True
    return out


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


def _generate_failed_impl(error: error) -> error:
    _core_coverage_mark("_generate_failed_impl")
    aborted = _core_exception_is_aborted(error)
    if aborted:
        return error
    else:
        pass
    text = _core_exception_message(error)
    message = _core_add("Generate failed: ", text)
    wrapped = _core_exception_rewrap(error, message)
    return wrapped


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


def _cache_key_impl(gen: AxGen, values: Any) -> str:
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
    inputs_json = _core_json_stable_stringify(inputs)
    lines.append(inputs_json)
    text = _core_string_join("\n", lines)
    key = _core_crypto_sha256_hex(text)
    return key


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
        cache_key = _cache_key_impl(gen, values)
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


def _cache_lookup_option_impl(options: Any) -> Any:
    _core_coverage_mark("_cache_lookup_option_impl")
    empty = {}
    call_options = _core_map_merge(empty, options)
    lookup = _core_get(call_options, "_ax_cache_lookup", None)
    return lookup


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


def _run_tool_calls_impl(gen: AxGen, functions: list[Any], messages: list[Any], calls: list[Any], options: Any) -> list[Any]:
    _core_coverage_mark("_run_tool_calls_impl")
    for call in calls:
        tool_ok = False
        tool_result = _core_none()
        try:
            executed = _execute_tool_call(functions, call)
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


def _stream_run_new_version_impl(run: Any, version: int) -> None:
    _core_coverage_mark("_stream_run_new_version_impl")
    run["current_version"] = version
    cleared_thought = []
    run["emitted_thought"] = cleared_thought
    run["output_emitted"] = False
    cleared_buffer = []
    run["buffer"] = cleared_buffer
    return None


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
