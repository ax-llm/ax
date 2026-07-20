from __future__ import annotations
import os

from abc import ABC, abstractmethod
import copy
import json
from typing import Any, Callable

from .ai import AIClient
from .gen import (
    AxGen,
    ax,
    _core_exception_message,
    _core_eq,
    _core_gte,
    _core_json_parse,
    _core_lt,
    _core_lte,
    _core_ne,
    _core_regex_match,
    _core_get,
    _core_is_none,
    _core_json_stringify,
    _core_map_merge,
    _core_object_call_method,
    _core_or,
    _core_runtime_error,
    _core_string_format,
    _core_string_ends_with,
    _core_string_join,
    _core_string_lower,
    _core_truthy,
    _filter_optimization_components,
    _adjust_optimization_score_for_actions,
    _build_optimization_eval_result,
    _build_optimization_eval_row,
    _build_optimizer_request,
    _deserialize_optimized_artifact,
    _normalize_optimization_dataset,
    _normalize_optimization_metric_scores,
    _normalize_optimizer_engine_response,
    _optimization_changed_components,
    _optimization_component_current_map,
    _prepare_optimizer_run,
    _scalarize_optimization_scores,
    _validate_optimization_component_map,
    _validate_optimized_artifact,
)
from .signature import (
    _core_string_extract_leading_group,
    _core_string_find_outside_quotes,
    _core_string_split_once,
    _core_string_split_top_level,
)
from .agent import (
    OptimizerEngine,
    OptimizerEvaluator,
    _build_agent_eval_prediction,
    _call_optimizer_engine,
    _core_agent_stage_chat_log,
    _core_agent_stage_forward,
    _core_agent_stage_traces,
    _core_agent_stage_usage,
    _optimization_component,
)
from .mcp import resolve_execution_context
# AXIR_CORE_IMPORTS


_CORE_COVERAGE_SEEN: set[str] = set()


def _core_string_words(value):
    return str(value).split()


def _core_string_title_from_camel(value):
    import re
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value).replace("_", " ")).lower()
    return text[:1].upper() + text[1:]


def _core_coverage_mark(name):
    path = os.environ.get("AXIR_COVERAGE_FILE")
    if not path or name in _CORE_COVERAGE_SEEN:
        return
    _CORE_COVERAGE_SEEN.add(name)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(name + "\n")


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
        elif op == "upper":
            out[spec.get("to", "__derived")] = str(_flow_get_state_value(out, spec.get("from", "__item"), "") or "").upper()
        return out
    return _FlowCallable(_mapper)


class AxProgram(ABC):
    @abstractmethod
    def forward(self, client, values, options=None):
        ...

    def get_optimizable_components(self):
        return []

    def apply_optimized_components(self, component_map):
        return self


class AxFlow(AxProgram):
    def __init__(self, options: dict[str, Any] | str | None = None, bindings: dict[str, Any] | None = None):
        if isinstance(options, str):
            normalized = _normalize_mermaid_bindings(bindings)
            self.options = dict(normalized.get("options") or {})
            self.execution_context = resolve_execution_context(self.options)
            self.state = _flow_from_mermaid(options, normalized)
            self.state["mermaidPercent"] = "%"
            self.state["mermaidOpenBrace"] = "{"
            self.state["mermaidCloseBrace"] = "}"
            _hydrate_mermaid_steps(self.state.get("steps") or [], normalized)
            return
        self.options = dict(options or {})
        self.execution_context = resolve_execution_context(self.options)
        self.state = _flow_factory(self.options)
        self.state["mermaidPercent"] = "%"
        self.state["mermaidOpenBrace"] = "{"
        self.state["mermaidCloseBrace"] = "}"

    def execute(self, name: str, program, options: dict[str, Any] | None = None):
        opts = dict(options or {})
        if isinstance(program, AxGen):
            opts.setdefault("signatureText", str(program.signature))
        return self._add_step("execute", name, program, opts)

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
            self.get_optimizable_components(),
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

    def forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        call_options = dict(options or {})
        call_context = resolve_execution_context(call_options, self.execution_context)
        if call_context:
            call_options["executionContext"] = call_context
            call_options["mcp"] = call_context.mcp
            call_options["ucp"] = call_context.ucp
        return _flow_forward(self.state, client, values or {}, call_options)

    def streaming_forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        yield {"version": 1, "index": 0, "delta": self.forward(client, values or {}, options or {})}

    def to_string(self, options: dict[str, Any] | None = None) -> str:
        return _flow_to_mermaid(self.state, options or {})

    def __str__(self) -> str:
        return self.to_string()

    def _add_step(self, kind, name, program, options):
        _flow_add_step(self.state, _flow_step(kind, name, program, options or {}))
        return self


def _normalize_mermaid_bindings(bindings):
    resolved = dict(bindings or {})
    nodes = {}
    for name, value in dict(resolved.get("nodes") or {}).items():
        nodes[name] = _FlowCallable(value) if callable(value) and not hasattr(value, "forward") else value
    conditions = {}
    for name, value in dict(resolved.get("conditions") or {}).items():
        conditions[name] = _FlowCallable(value) if callable(value) and not hasattr(value, "call") else value
    resolved["nodes"] = nodes
    resolved["conditions"] = conditions
    return resolved


def _hydrate_mermaid_steps(steps, bindings):
    nodes = dict((bindings or {}).get("nodes") or {})
    for step in steps or []:
        name = step.get("name")
        binding = nodes.get(name)
        if isinstance(binding, _FlowCallable):
            step["kind"] = "map"
            step["program"] = binding
        elif binding is not None:
            step["program"] = ax(binding) if isinstance(binding, str) else binding
        elif step.get("kind") == "execute" and isinstance(step.get("program"), str):
            step["program"] = ax(step["program"], step.get("options") or {})
        nested = (step.get("options") or {}).get("steps")
        if isinstance(nested, list):
            _hydrate_mermaid_steps(nested, bindings)


def flow(options: dict[str, Any] | str | None = None, bindings: dict[str, Any] | None = None) -> AxFlow:
    return AxFlow(options, bindings)


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
