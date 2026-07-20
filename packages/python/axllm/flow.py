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
from .signature import (
    _signature_input_fields,
    _signature_output_fields,
    parse_signature,
    signature_to_string,
)


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


# BEGIN AXIR CORE EMITTED FUNCTIONS
def _flow_factory(options: Any) -> Any:
    _core_coverage_mark("_flow_factory")
    empty_map = {}
    empty_list = []
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    steps = []
    traces = []
    chat_log = []
    usage = {}
    demos = {}
    state = {}
    id = _core_get(opts, "id", "root.flow")
    state["program_kind"] = "axflow"
    state["program_id"] = id
    state["options"] = opts
    state["steps"] = steps
    state["returns"] = empty_map
    state["demos"] = demos
    state["traces"] = traces
    state["chat_log"] = chat_log
    state["usage"] = usage
    return state


def _program_descriptor(kind: str, id: str, metadata: Any) -> Any:
    _core_coverage_mark("_program_descriptor")
    empty_map = {}
    meta_missing = _core_is_none(metadata)
    meta = metadata
    if meta_missing:
        meta = empty_map
    else:
        pass
    out = {}
    out["kind"] = kind
    out["id"] = id
    out["metadata"] = meta
    return out


def _program_trace_event(program_id: str, kind: str, payload: Any) -> Any:
    _core_coverage_mark("_program_trace_event")
    empty_map = {}
    payload_missing = _core_is_none(payload)
    data = payload
    if payload_missing:
        data = empty_map
    else:
        pass
    event = {}
    event["programId"] = program_id
    event["kind"] = kind
    event["payload"] = data
    return event


def _flow_step(kind: str, name: str, program: Any, options: Any) -> Any:
    _core_coverage_mark("_flow_step")
    trimmed = str(name).strip()
    missing_name = _core_eq(trimmed, "")
    if missing_name:
        err = _core_runtime_error("flow step name is required")
        raise err
    else:
        pass
    empty_map = {}
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    step = {}
    step["kind"] = kind
    step["name"] = trimmed
    step["nodeName"] = trimmed
    step["program"] = program
    step["options"] = opts
    reads_empty = []
    reads = _core_get(opts, "reads", reads_empty)
    writes_default = []
    is_execute = _core_eq(kind, "execute")
    is_derive = _core_eq(kind, "derive")
    is_parallel = _core_eq(kind, "parallel")
    is_parallel_merge = _core_eq(kind, "parallelMerge")
    if is_execute:
        execute_write = _core_string_format("{}Result", trimmed)
        writes_default.append(execute_write)
    else:
        pass
    if is_derive:
        writes_default.append(trimmed)
    else:
        pass
    if is_parallel:
        writes_default.append("_parallelResults")
    else:
        pass
    if is_parallel_merge:
        writes_default.append(trimmed)
    else:
        pass
    writes = _core_get(opts, "writes", writes_default)
    default_barrier = True
    may_parallel = _core_or(is_execute, is_derive)
    if may_parallel:
        default_barrier = False
    else:
        pass
    barrier_from_snake = _core_get(opts, "is_barrier", default_barrier)
    barrier_from_camel = _core_get(opts, "isBarrier", barrier_from_snake)
    barrier = _core_get(opts, "barrier", barrier_from_camel)
    step["reads"] = reads
    step["writes"] = writes
    step["isBarrier"] = barrier
    return step


def _program_child_component_prefix(owner: str, node: str) -> str:
    _core_coverage_mark("_program_child_component_prefix")
    path = _core_string_format("{}.{}::", owner, node)
    return path


def _program_prefix_component(component: Any, owner: str, node: str) -> Any:
    _core_coverage_mark("_program_prefix_component")
    empty_map = {}
    child = _core_map_merge(empty_map, component)
    child_owner = _core_string_format("{}.{}", owner, node)
    child_id = _core_get(component, "id", "")
    prefixed_id = _core_string_format("{}::{}", child_owner, child_id)
    child["owner"] = child_owner
    child["id"] = prefixed_id
    return child


def _program_slice_component_map(component_map: Any, prefix: str) -> Any:
    _core_coverage_mark("_program_slice_component_map")
    out = {}
    keys = _core_map_keys(component_map)
    for key in keys:
        matches = _core_string_starts_with(key, prefix)
        if matches:
            prefix_len = _core_len(prefix)
            short_key = _core_string_slice(key, prefix_len)
            value = _core_get(component_map, key, None)
            out[short_key] = value
        else:
            pass
    return out


def _flow_add_step(flow: Any, step: Any) -> Any:
    _core_coverage_mark("_flow_add_step")
    steps = _core_get(flow, "steps", None)
    name = _core_get(step, "name", "")
    for existing in steps:
        existing_name = _core_get(existing, "name", "")
        duplicate = _core_eq(existing_name, name)
        if duplicate:
            message = _core_string_format("duplicate flow step: {}", name)
            err = _core_runtime_error(message)
            raise err
        else:
            pass
    steps.append(step)
    flow["steps"] = steps
    return flow


def _flow_set_returns(flow: Any, returns: Any) -> Any:
    _core_coverage_mark("_flow_set_returns")
    empty_map = {}
    missing = _core_is_none(returns)
    spec = returns
    if missing:
        spec = empty_map
    else:
        pass
    flow["returns"] = spec
    return flow


def _flow_plan_entry(step: Any, step_index: int) -> Any:
    _core_coverage_mark("_flow_plan_entry")
    empty_list = []
    kind = _core_get(step, "kind", "execute")
    name = _core_get(step, "name", "")
    reads = _core_get(step, "reads", empty_list)
    writes = _core_get(step, "writes", empty_list)
    barrier_snake = _core_get(step, "is_barrier", False)
    barrier_camel = _core_get(step, "isBarrier", barrier_snake)
    barrier = _core_get(step, "barrier", barrier_camel)
    entry = {}
    entry["name"] = name
    entry["kind"] = kind
    entry["reads"] = reads
    entry["writes"] = writes
    entry["barrier"] = barrier
    entry["stepIndex"] = step_index
    return entry


def _flow_plan_can_share_group(group: Any, candidate: Any) -> bool:
    _core_coverage_mark("_flow_plan_can_share_group")
    empty_list = []
    candidate_barrier = _core_get(candidate, "barrier", True)
    candidate_writes = _core_get(candidate, "writes", empty_list)
    candidate_reads = _core_get(candidate, "reads", empty_list)
    write_count = _core_len(candidate_writes)
    no_writes = _core_eq(write_count, 0)
    can_share = True
    if candidate_barrier:
        can_share = False
    else:
        pass
    if no_writes:
        can_share = False
    else:
        pass
    for existing in group:
        existing_barrier = _core_get(existing, "barrier", True)
        if existing_barrier:
            can_share = False
        else:
            pass
        existing_writes = _core_get(existing, "writes", empty_list)
        existing_reads = _core_get(existing, "reads", empty_list)
        for read in candidate_reads:
            read_conflict = _core_contains(existing_writes, read)
            if read_conflict:
                can_share = False
            else:
                pass
        for existing_read in existing_reads:
            reverse_read_conflict = _core_contains(candidate_writes, existing_read)
            if reverse_read_conflict:
                can_share = False
            else:
                pass
        for write in candidate_writes:
            write_conflict = _core_contains(existing_writes, write)
            if write_conflict:
                can_share = False
            else:
                pass
    return can_share


def _flow_plan(flow: Any) -> Any:
    _core_coverage_mark("_flow_plan")
    steps = _core_get(flow, "steps", None)
    plan_steps = []
    step_index = 0
    for step in steps:
        entry = _flow_plan_entry(step, step_index)
        plan_steps.append(entry)
        next_step_index = _core_add(step_index, 1)
        step_index = next_step_index
    empty_map = {}
    returns = _core_get(flow, "returns", empty_map)
    has_returns = _core_truthy(returns)
    if has_returns:
        return_reads = []
        return_writes = []
        returns_entry = {}
        returns_entry["name"] = "returns"
        returns_entry["kind"] = "returns"
        returns_entry["reads"] = return_reads
        returns_entry["writes"] = return_writes
        returns_entry["barrier"] = True
        returns_entry["stepIndex"] = step_index
        plan_steps.append(returns_entry)
        return_next_step_index = _core_add(step_index, 1)
        step_index = return_next_step_index
    else:
        pass
    groups = []
    current_group = []
    for plan_step in plan_steps:
        barrier = _core_get(plan_step, "barrier", True)
        current_count = _core_len(current_group)
        has_current = _core_gt(current_count, 0)
        if barrier:
            if has_current:
                group = {}
                level = _core_len(groups)
                group["level"] = level
                group["steps"] = current_group
                groups.append(group)
                current_group = []
            else:
                pass
            single_steps = []
            single_steps.append(plan_step)
            single_group = {}
            single_level = _core_len(groups)
            single_group["level"] = single_level
            single_group["steps"] = single_steps
            groups.append(single_group)
        else:
            can_add = True
            if has_current:
                can_add = _flow_plan_can_share_group(current_group, plan_step)
            else:
                pass
            if can_add:
                current_group.append(plan_step)
            else:
                group = {}
                level = _core_len(groups)
                group["level"] = level
                group["steps"] = current_group
                groups.append(group)
                current_group = []
                current_group.append(plan_step)
    remaining_count = _core_len(current_group)
    has_remaining = _core_gt(remaining_count, 0)
    if has_remaining:
        group = {}
        level = _core_len(groups)
        group["level"] = level
        group["steps"] = current_group
        groups.append(group)
    else:
        pass
    max_parallelism = 1
    for group in groups:
        group_steps = _core_get(group, "steps", None)
        group_count = _core_len(group_steps)
        bigger = _core_gt(group_count, max_parallelism)
        if bigger:
            max_parallelism = group_count
        else:
            pass
    plan = {}
    total_steps = _core_len(plan_steps)
    parallel_groups = _core_len(groups)
    plan["totalSteps"] = total_steps
    plan["parallelGroups"] = parallel_groups
    plan["maxParallelism"] = max_parallelism
    plan["steps"] = plan_steps
    plan["groups"] = groups
    return plan


def _flow_cache_key(values: Any) -> str:
    _core_coverage_mark("_flow_cache_key")
    key = _core_json_stable_stringify(values)
    return key


def _flow_cache_read_write(flow: Any, values: Any, options: Any, mode: str, cached_value: Any) -> Any:
    _core_coverage_mark("_flow_cache_read_write")
    empty_map = {}
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    key = _flow_cache_key(values)
    store_snake = _core_get(opts, "cache_store", None)
    store = _core_get(opts, "cacheStore", store_snake)
    has_store = _core_is_not_none(store)
    read_error_snake = _core_get(opts, "cache_read_error", False)
    read_error = _core_get(opts, "cacheReadError", read_error_snake)
    write_error_snake = _core_get(opts, "cache_write_error", False)
    write_error = _core_get(opts, "cacheWriteError", write_error_snake)
    is_read = _core_eq(mode, "read")
    is_write = _core_eq(mode, "write")
    none = _core_none()
    result = {}
    result["key"] = key
    result["hit"] = False
    result["value"] = none
    if is_read:
        can_read_store = _core_and(has_store, read_error)
        skip_read = _core_truthy(can_read_store)
        if skip_read:
            pass
        else:
            if has_store:
                cached = _core_get(store, key, None)
                hit = _core_is_not_none(cached)
                if hit:
                    result["hit"] = True
                    result["value"] = cached
                else:
                    pass
            else:
                pass
    else:
        pass
    if is_write:
        can_write_store = _core_and(has_store, write_error)
        skip_write = _core_truthy(can_write_store)
        if skip_write:
            pass
        else:
            if has_store:
                store[key] = cached_value
                result["value"] = cached_value
            else:
                pass
    else:
        pass
    return result


def _flow_check_abort(options: Any, location: str) -> None:
    _core_coverage_mark("_flow_check_abort")
    none = _core_none()
    abort_snake = _core_get(options, "abort_before_step", False)
    abort_camel = _core_get(options, "abortBeforeStep", abort_snake)
    aborted = _core_get(options, "aborted", abort_camel)
    abort = _core_get(options, "abort", aborted)
    if abort:
        message = _core_string_format("Flow aborted at {}", location)
        err = _core_runtime_error(message)
        raise err
    else:
        pass
    return none


def _flow_project_returns(state: Any, returns: Any) -> Any:
    _core_coverage_mark("_flow_project_returns")
    empty_map = {}
    spec = returns
    missing = _core_is_none(returns)
    if missing:
        spec = empty_map
    else:
        pass
    has_returns = _core_truthy(spec)
    output = state
    if has_returns:
        projected = {}
        keys = _core_map_keys(spec)
        for key in keys:
            path = _core_get(spec, key, None)
            value = _flow_get_path(state, path)
            projected[key] = value
        output = projected
    else:
        pass
    return output


def _flow_get_path(state: Any, path: Any) -> Any:
    _core_coverage_mark("_flow_get_path")
    none = _core_none()
    path_text = _core_string_str(path)
    parts = _core_string_split(path_text, ".")
    current = state
    for part in parts:
        is_object = _core_type_is(current, "object")
        if is_object:
            current = _core_get(current, part, none)
        else:
            current = none
    return current


def _flow_record_child_chat_log(flow: Any, node: str, program: Any) -> Any:
    _core_coverage_mark("_flow_record_child_chat_log")
    empty_list = []
    chat_log = _core_get(flow, "chat_log", empty_list)
    child_log = _core_agent_stage_chat_log(program)
    for entry in child_log:
        entry_name = _core_get(entry, "name", "")
        has_entry_name = _core_truthy(entry_name)
        if has_entry_name:
            prefixed_entry_name = _core_string_format("{}.{}", node, entry_name)
            entry["name"] = prefixed_entry_name
        else:
            entry["name"] = node
        chat_log.append(entry)
    flow["chat_log"] = chat_log
    return chat_log


def _flow_record_child_usage(flow: Any, node: str, program: Any) -> Any:
    _core_coverage_mark("_flow_record_child_usage")
    empty_map = {}
    usage = _core_get(flow, "usage", empty_map)
    child_usage = _core_agent_stage_usage(program)
    has_usage = _core_truthy(child_usage)
    if has_usage:
        usage[node] = child_usage
    else:
        pass
    flow["usage"] = usage
    return usage


def _flow_record_child_traces(flow: Any, node: str, program: Any) -> Any:
    _core_coverage_mark("_flow_record_child_traces")
    empty_list = []
    traces = _core_get(flow, "traces", empty_list)
    child_traces = _core_agent_stage_traces(program)
    for trace in child_traces:
        entry = {}
        entry["kind"] = "flow_child_trace"
        entry["name"] = node
        entry["trace"] = trace
        traces.append(entry)
    flow["traces"] = traces
    return traces


def _flow_execute_program_node(flow: Any, step: Any, client: Any, state: Any, options: Any) -> Any:
    _core_coverage_mark("_flow_execute_program_node")
    empty_map = {}
    name = _core_get(step, "name", "")
    kind = _core_get(step, "kind", "execute")
    program = _core_get(step, "program", None)
    step_options = _core_get(step, "options", empty_map)
    base_options = _core_get(flow, "options", empty_map)
    runtime_base = _core_map_merge(base_options, options)
    runtime_options = _core_map_merge(runtime_base, step_options)
    trace_label_in = _core_get(options, "traceLabel", "")
    has_trace_label = _core_truthy(trace_label_in)
    trace_label = _core_string_format("Node:{}", name)
    if has_trace_label:
        trace_label = _core_string_format("Node:{} ({})", name, trace_label_in)
    else:
        pass
    runtime_options["traceLabel"] = trace_label
    abort_during_snake = _core_get(options, "abort_during_step", False)
    abort_during = _core_get(options, "abortDuringStep", abort_during_snake)
    abort_node_snake = _core_get(options, "abort_during_node", "")
    abort_node = _core_get(options, "abortDuringNode", abort_node_snake)
    abort_named = _core_eq(abort_node, name)
    abort_no_name = _core_eq(abort_node, "")
    abort_this_node = _core_and(abort_during, abort_named)
    abort_any_node = _core_and(abort_during, abort_no_name)
    abort_now = _core_or(abort_this_node, abort_any_node)
    if abort_now:
        abort_message = _core_string_format("Flow aborted at flow-node-{}", name)
        abort_error = _core_runtime_error(abort_message)
        raise abort_error
    else:
        pass
    result = _core_agent_stage_forward(program, client, state, runtime_options)
    out = _core_map_merge(state, empty_map)
    result_key = _core_string_format("{}Result", name)
    out[result_key] = result
    out = _core_map_update(out, result)
    _flow_record_child_chat_log(flow, name, program)
    _flow_record_child_usage(flow, name, program)
    _flow_record_child_traces(flow, name, program)
    return out


def _flow_execute_step(flow: Any, step: Any, plan_step: Any, client: Any, state: Any, options: Any) -> Any:
    _core_coverage_mark("_flow_execute_step")
    empty_map = {}
    missing_step = _core_is_none(step)
    if missing_step:
        return state
    else:
        pass
    kind = _core_get(step, "kind", "execute")
    name = _core_get(step, "name", "")
    step_options_for_guard = _core_get(step, "options", empty_map)
    guard = _core_get(step_options_for_guard, "guard", None)
    has_guard = _core_is_not_none(guard)
    if has_guard:
        guard_matches = _flow_evaluate_data_predicate(guard, state, False)
        skip_guarded_step = _core_not(guard_matches)
        if skip_guarded_step:
            return state
        else:
            pass
    else:
        pass
    location = _core_string_format("flow-step-{}", name)
    _flow_check_abort(options, location)
    traces = _core_get(flow, "traces", None)
    program_id = _core_get(flow, "program_id", "root.flow")
    event_payload = {}
    event_payload["name"] = name
    event_payload["kind"] = kind
    step_index = _core_get(plan_step, "stepIndex", 0)
    event_payload["stepIndex"] = step_index
    step_event = _program_trace_event(program_id, "flow_step", event_payload)
    traces.append(step_event)
    is_map = _core_eq(kind, "map")
    if is_map:
        program = _core_get(step, "program", None)
        mapped = _core_object_call_method(program, "call", state)
        out = _core_map_merge(state, empty_map)
        result_key = _core_string_format("{}Result", name)
        out[result_key] = mapped
        out = _core_map_update(out, mapped)
        return out
    else:
        pass
    is_branch = _core_eq(kind, "branch")
    if is_branch:
        step_options = _core_get(step, "options", empty_map)
        predicate = _core_get(step_options, "predicate", None)
        has_predicate = _core_is_not_none(predicate)
        branch_value_default = _core_get(step_options, "value", False)
        branch_value = _core_get(step_options, "branchValue", branch_value_default)
        if has_predicate:
            branch_value = _flow_evaluate_data_predicate(predicate, state, branch_value)
        else:
            pass
        default_branches = []
        branches = _core_get(step_options, "branches", default_branches)
        current = state
        matched = False
        for branch in branches:
            when = _core_get(branch, "when", None)
            matches = _core_eq(when, branch_value)
            if matches:
                branch_steps = _core_get(branch, "steps", default_branches)
                current = _flow_execute_nested_steps(flow, client, branch_steps, current, options)
                matched = True
            else:
                pass
        return current
    else:
        pass
    is_while = _core_eq(kind, "while")
    if is_while:
        step_options = _core_get(step, "options", empty_map)
        condition = _core_get(step_options, "condition", None)
        has_condition = _core_is_not_none(condition)
        default_body = []
        body_steps = _core_get(step_options, "steps", default_body)
        max_iterations_snake = _core_get(step_options, "max_iterations", 100)
        max_iterations = _core_get(step_options, "maxIterations", max_iterations_snake)
        current = state
        iterations = 0
        while True:
            condition_result = _core_get(step_options, "conditionResult", False)
            if has_condition:
                condition_result = _flow_evaluate_data_predicate(condition, current, condition_result)
            else:
                pass
            should_continue = _core_truthy(condition_result)
            done = _core_not(should_continue)
            if done:
                break
            else:
                pass
            too_many = _core_gte(iterations, max_iterations)
            if too_many:
                message = _core_string_format("While loop exceeded maximum iterations ({})", max_iterations)
                err = _core_runtime_error(message)
                raise err
            else:
                pass
            _flow_check_abort(options, "flow-while")
            current = _flow_execute_nested_steps(flow, client, body_steps, current, options)
            iterations = _core_add(iterations, 1)
        return current
    else:
        pass
    is_feedback = _core_eq(kind, "feedback")
    if is_feedback:
        step_options = _core_get(step, "options", empty_map)
        condition = _core_get(step_options, "condition", None)
        has_condition = _core_is_not_none(condition)
        default_body = []
        body_steps = _core_get(step_options, "steps", default_body)
        max_iterations_snake = _core_get(step_options, "max_iterations", 10)
        max_iterations = _core_get(step_options, "maxIterations", max_iterations_snake)
        label = _core_get(step_options, "label", name)
        iteration_key = _core_string_format("_feedback_{}_iterations", label)
        current = _core_map_merge(state, empty_map)
        existing_iterations = _core_get(current, iteration_key, None)
        missing_iterations = _core_is_none(existing_iterations)
        if missing_iterations:
            current[iteration_key] = 1
        else:
            pass
        iterations = 1
        while True:
            condition_result = _core_get(step_options, "conditionResult", False)
            if has_condition:
                condition_result = _flow_evaluate_data_predicate(condition, current, condition_result)
            else:
                pass
            should_continue = _core_truthy(condition_result)
            done = _core_not(should_continue)
            if done:
                break
            else:
                pass
            too_many = _core_gte(iterations, max_iterations)
            if too_many:
                break
            else:
                pass
            location = _core_string_format("flow-feedback-{}", label)
            _flow_check_abort(options, location)
            iterations = _core_add(iterations, 1)
            current[iteration_key] = iterations
            current = _flow_execute_nested_steps(flow, client, body_steps, current, options)
        return current
    else:
        pass
    is_parallel = _core_eq(kind, "parallel")
    if is_parallel:
        step_options = _core_get(step, "options", empty_map)
        default_results = []
        parallel_results_snake = _core_get(step_options, "parallel_results", default_results)
        parallel_results = _core_get(step_options, "parallelResults", parallel_results_snake)
        out = _core_map_merge(state, empty_map)
        out["_parallelResults"] = parallel_results
        return out
    else:
        pass
    is_parallel_merge = _core_eq(kind, "parallelMerge")
    if is_parallel_merge:
        step_options = _core_get(step, "options", empty_map)
        results = _core_get(state, "_parallelResults", None)
        results_is_list = _core_type_is(results, "list")
        bad_results = _core_not(results_is_list)
        if bad_results:
            err = _core_runtime_error("No parallel results found for merge")
            raise err
        else:
            pass
        merge_output_snake = _core_get(step_options, "merge_output", results)
        merge_output = _core_get(step_options, "mergeOutput", merge_output_snake)
        out = _core_map_merge(state, empty_map)
        none = _core_none()
        out["_parallelResults"] = none
        out[name] = merge_output
        return out
    else:
        pass
    is_derive = _core_eq(kind, "derive")
    if is_derive:
        empty_list = []
        program = _core_get(step, "program", None)
        reads = _core_get(step, "reads", empty_list)
        writes = _core_get(step, "writes", empty_list)
        input_field = _core_list_get(reads, 0, "")
        output_field = _core_list_get(writes, 0, name)
        input_value = _core_get(state, input_field, None)
        out = _core_map_merge(state, empty_map)
        input_is_list = _core_type_is(input_value, "list")
        if input_is_list:
            results = []
            for item in input_value:
                item_state = _core_map_merge(state, empty_map)
                item_state["__item"] = item
                res_state = _core_object_call_method(program, "call", item_state)
                derived = _core_get(res_state, "__derived", None)
                results.append(derived)
            out[output_field] = results
        else:
            item_state = _core_map_merge(state, empty_map)
            item_state["__item"] = input_value
            res_state = _core_object_call_method(program, "call", item_state)
            derived = _core_get(res_state, "__derived", None)
            out[output_field] = derived
        return out
    else:
        pass
    program_out = _flow_execute_program_node(flow, step, client, state, options)
    return program_out


def _flow_merge_parallel_results(state: Any, result: Any) -> Any:
    _core_coverage_mark("_flow_merge_parallel_results")
    merged = _core_map_merge(state, result)
    return merged


def _flow_execute_nested_steps(flow: Any, client: Any, steps: Any, state: Any, options: Any) -> Any:
    _core_coverage_mark("_flow_execute_nested_steps")
    empty_map = {}
    nested = _core_map_merge(flow, empty_map)
    traces = _core_get(flow, "traces", None)
    chat_log = _core_get(flow, "chat_log", None)
    usage = _core_get(flow, "usage", None)
    nested["steps"] = steps
    nested["returns"] = empty_map
    nested["traces"] = traces
    nested["chat_log"] = chat_log
    nested["usage"] = usage
    out = _flow_execute_steps(nested, client, state, options)
    nested_traces = _core_get(nested, "traces", None)
    nested_chat_log = _core_get(nested, "chat_log", None)
    nested_usage = _core_get(nested, "usage", None)
    flow["traces"] = nested_traces
    flow["chat_log"] = nested_chat_log
    flow["usage"] = nested_usage
    return out


def _flow_execute_steps(flow: Any, client: Any, state: Any, options: Any) -> Any:
    _core_coverage_mark("_flow_execute_steps")
    empty_map = {}
    empty_list = []
    steps = _core_get(flow, "steps", empty_list)
    plan = _flow_plan(flow)
    plan_steps = _core_get(plan, "steps", empty_list)
    planned_groups = _core_get(plan, "groups", empty_list)
    flow_options = _core_get(flow, "options", empty_map)
    flow_auto_camel = _core_get(flow_options, "autoParallel", True)
    flow_auto = _core_get(flow_options, "auto_parallel", flow_auto_camel)
    option_auto_camel = _core_get(options, "autoParallel", True)
    option_auto = _core_get(options, "auto_parallel", option_auto_camel)
    auto_parallel = _core_and(flow_auto, option_auto)
    groups = planned_groups
    if auto_parallel:
        pass
    else:
        sequential_groups = []
        for plan_step in plan_steps:
            single = []
            single.append(plan_step)
            group = {}
            level = _core_len(sequential_groups)
            group["level"] = level
            group["steps"] = single
            sequential_groups.append(group)
        groups = sequential_groups
    current = state
    for group in groups:
        level = _core_get(group, "level", 0)
        location = _core_string_format("flow-parallel-group-{}", level)
        _flow_check_abort(options, location)
        group_steps = _core_get(group, "steps", empty_list)
        group_count = _core_len(group_steps)
        record_groups_snake = _core_get(options, "record_flow_groups", False)
        record_groups = _core_get(options, "recordFlowGroups", record_groups_snake)
        if record_groups:
            traces = _core_get(flow, "traces", empty_list)
            program_id = _core_get(flow, "program_id", "root.flow")
            group_payload = {}
            group_payload["level"] = level
            group_payload["stepCount"] = group_count
            group_payload["steps"] = group_steps
            group_event = _program_trace_event(program_id, "flow_group", group_payload)
            traces.append(group_event)
        else:
            pass
        is_parallel_group = _core_gt(group_count, 1)
        if is_parallel_group:
            group_start = _core_map_merge(current, empty_map)
            for plan_step in group_steps:
                index = _core_get(plan_step, "stepIndex", 0)
                step = _core_list_get(steps, index, None)
                result_state = _flow_execute_step(flow, step, plan_step, client, group_start, options)
                current = _flow_merge_parallel_results(current, result_state)
        else:
            for plan_step in group_steps:
                index = _core_get(plan_step, "stepIndex", 0)
                step = _core_list_get(steps, index, None)
                current = _flow_execute_step(flow, step, plan_step, client, current, options)
    return current


def _flow_forward(flow: Any, client: Any, values: Any, options: Any) -> Any:
    _core_coverage_mark("_flow_forward")
    empty_map = {}
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    cache_read = _flow_cache_read_write(flow, values, opts, "read", None)
    cache_hit = _core_get(cache_read, "hit", False)
    if cache_hit:
        cached_value = _core_get(cache_read, "value", None)
        return cached_value
    else:
        pass
    fresh_traces = []
    fresh_chat_log = []
    fresh_usage = {}
    flow["traces"] = fresh_traces
    flow["chat_log"] = fresh_chat_log
    flow["usage"] = fresh_usage
    state = _core_map_merge(empty_map, values)
    traces = _core_get(flow, "traces", None)
    program_id = _core_get(flow, "program_id", "root.flow")
    cache_key = _flow_cache_key(values)
    begin = _program_trace_event(program_id, "flow_start", state)
    traces.append(begin)
    state = _flow_execute_steps(flow, client, state, opts)
    returns = _core_get(flow, "returns", empty_map)
    output = _flow_project_returns(state, returns)
    _flow_cache_read_write(flow, values, opts, "write", output)
    done_payload = {}
    done_payload["cache_key"] = cache_key
    done_payload["output"] = output
    done = _program_trace_event(program_id, "flow_done", done_payload)
    traces.append(done)
    return output


def _flow_get_optimizable_components(flow: Any) -> list[Any]:
    _core_coverage_mark("_flow_get_optimizable_components")
    empty_list = []
    empty_map = {}
    owner = _core_get(flow, "program_id", "root.flow")
    plan = _flow_plan(flow)
    current_plan = _core_get(flow, "optimized_graph_plan", plan)
    components = []
    graph_id = _core_string_format("{}::graph-plan", owner)
    constraints = []
    constraints.append("Preserve node names, dependencies, and return contract.")
    validation = {}
    validation["schema"] = "axflow-plan-v1"
    graph = _optimization_component(graph_id, owner, "flow-graph", current_plan, "AxFlow execution graph and planner barrier metadata.", constraints, empty_list, False, "json", validation)
    components.append(graph)
    steps = _core_get(flow, "steps", empty_list)
    for step in steps:
        program = _core_get(step, "program", None)
        name = _core_get(step, "name", "")
        child_components = _core_program_components(program)
        for component in child_components:
            child = _program_prefix_component(component, owner, name)
            components.append(child)
    return components


def _flow_apply_optimized_components(flow: Any, component_map: Any) -> Any:
    _core_coverage_mark("_flow_apply_optimized_components")
    empty_map = {}
    empty_list = []
    updates_missing = _core_is_none(component_map)
    updates = component_map
    if updates_missing:
        updates = empty_map
    else:
        pass
    components = _flow_get_optimizable_components(flow)
    _validate_optimization_component_map(components, updates)
    owner = _core_get(flow, "program_id", "root.flow")
    graph_id = _core_string_format("{}::graph-plan", owner)
    graph_update = _core_get(updates, graph_id, None)
    has_graph_update = _core_is_not_none(graph_update)
    if has_graph_update:
        graph_is_object = _core_type_is(graph_update, "object")
        bad_graph = _core_not(graph_is_object)
        if bad_graph:
            err = _core_runtime_error("optimized flow graph-plan component must be an object")
            raise err
        else:
            pass
        flow["optimized_graph_plan"] = graph_update
    else:
        pass
    steps = _core_get(flow, "steps", empty_list)
    for step in steps:
        program = _core_get(step, "program", None)
        name = _core_get(step, "name", "")
        prefix = _program_child_component_prefix(owner, name)
        child_updates = _program_slice_component_map(updates, prefix)
        has_child_updates = _core_truthy(child_updates)
        if has_child_updates:
            _core_program_apply_components(program, child_updates)
        else:
            pass
    return flow


def _flow_snapshot_components(flow: Any) -> Any:
    _core_coverage_mark("_flow_snapshot_components")
    components = _flow_get_optimizable_components(flow)
    snapshot = _optimization_component_current_map(components)
    return snapshot


def _flow_restore_components(flow: Any, snapshot: Any) -> Any:
    _core_coverage_mark("_flow_restore_components")
    restored = _flow_apply_optimized_components(flow, snapshot)
    return restored


def _flow_evaluate_optimization(flow: Any, client: Any, dataset: Any, candidate_map: Any, options: Any) -> Any:
    _core_coverage_mark("_flow_evaluate_optimization")
    empty_map = {}
    empty_list = []
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    candidate_missing = _core_is_none(candidate_map)
    candidate = candidate_map
    if candidate_missing:
        candidate = empty_map
    else:
        pass
    normalized = _normalize_optimization_dataset(dataset)
    train = _core_get(normalized, "train", empty_list)
    phase = _core_get(opts, "phase", "train")
    max_calls_snake = _core_get(opts, "max_metric_calls", 2147483647)
    max_calls = _core_get(opts, "maxMetricCalls", max_calls_snake)
    forward_options = _core_get(opts, "forward_options", empty_map)
    original = _flow_snapshot_components(flow)
    rows = []
    calls = 0
    result = {}
    try:
        has_candidate = _core_truthy(candidate)
        if has_candidate:
            _flow_apply_optimized_components(flow, candidate)
        else:
            pass
        for task in train:
            too_many = _core_gte(calls, max_calls)
            if too_many:
                message = _core_string_format("max metric calls exceeded: {}", max_calls)
                err = _core_runtime_error(message)
                raise err
            else:
                pass
            next_calls = _core_add(calls, 1)
            calls = next_calls
            error = _core_none()
            prediction = {}
            try:
                input = _core_get(task, "input", task)
                output = _flow_forward(flow, client, input, forward_options)
                trace = {}
                traces = _core_get(flow, "traces", empty_list)
                chat_log = _core_get(flow, "chat_log", empty_list)
                usage = _core_get(flow, "usage", empty_map)
                trace["traces"] = traces
                trace["chat_log"] = chat_log
                prediction = _build_agent_eval_prediction(output, chat_log, usage, trace)
            except Exception as forward_error:
                error_message = _core_exception_message(forward_error)
                error = {}
                error["message"] = error_message
                trace = {}
                traces = _core_get(flow, "traces", empty_list)
                chat_log = _core_get(flow, "chat_log", empty_list)
                usage = _core_get(flow, "usage", empty_map)
                trace["traces"] = traces
                trace["chat_log"] = chat_log
                prediction["completionType"] = "error"
                prediction["error"] = error
                prediction["functionCalls"] = empty_list
                prediction["actionLog"] = chat_log
                prediction["usage"] = usage
                prediction["trace"] = trace
                prediction["turnCount"] = 0
            completion_type = _core_get(prediction, "completionType", "final")
            is_error = _core_eq(completion_type, "error")
            default_score = 1
            if is_error:
                default_score = 0
            else:
                pass
            score_from_score = _core_get(task, "score", default_score)
            score_from_scores = _core_get(task, "scores", score_from_score)
            raw_scores = _core_get(task, "metric_score", score_from_scores)
            scores = _normalize_optimization_metric_scores(raw_scores)
            scalar_base = _scalarize_optimization_scores(scores, opts)
            scalar = _adjust_optimization_score_for_actions(scalar_base, task, prediction)
            trace_for_row = _core_get(prediction, "trace", None)
            row = _build_optimization_eval_row(task, prediction, scores, scalar, trace_for_row, error)
            rows.append(row)
        result = _build_optimization_eval_result(rows, candidate, phase)
        _flow_restore_components(flow, original)
    except Exception as outer_error:
        _flow_restore_components(flow, original)
        raise outer_error
    return result


def _flow_optimize_with(flow: Any, dataset: Any, options: Any, evaluator_available: bool) -> Any:
    _core_coverage_mark("_flow_optimize_with")
    empty_map = {}
    empty_list = []
    components = _flow_get_optimizable_components(flow)
    trace = {}
    traces = _core_get(flow, "traces", empty_list)
    chat_log = _core_get(flow, "chat_log", empty_list)
    trace["traces"] = traces
    trace["chat_log"] = chat_log
    run = _prepare_optimizer_run("axflow", components, dataset, options, trace, evaluator_available)
    request = _core_get(run, "request", empty_map)
    return request


def _flow_evaluate_data_predicate(predicate: Any, state: Any, fallback: Any) -> Any:
    _core_coverage_mark("_flow_evaluate_data_predicate")
    missing = _core_is_none(predicate)
    if missing:
        return fallback
    else:
        pass
    has_node = _core_map_contains(predicate, "nodeName")
    has_field = _core_map_contains(predicate, "field")
    is_data = _core_and(has_node, has_field)
    if is_data:
        node = _core_get(predicate, "nodeName", "")
        field = _core_get(predicate, "field", "")
        result_key = _core_string_format("{}Result", node)
        empty = {}
        result = _core_get(state, result_key, empty)
        value = _core_get(result, field, None)
        missing_nested = _core_is_none(value)
        if missing_nested:
            value = _core_get(state, field, None)
        else:
            pass
        has_expected = _core_map_contains(predicate, "value")
        if has_expected:
            expected = _core_get(predicate, "value", None)
            expected_text = _core_string_lower(expected)
            is_true = _core_eq(expected_text, "true")
            is_false = _core_eq(expected_text, "false")
            if is_true:
                actual = _core_truthy(value)
                return actual
            else:
                pass
            if is_false:
                actual = _core_truthy(value)
                actual = _core_not(actual)
                return actual
            else:
                pass
            matches = _core_eq(value, expected)
            return matches
        else:
            pass
        truthy = _core_truthy(value)
        return truthy
    else:
        pass
    called = _core_object_call_method(predicate, "call", state)
    return called


def _flow_mermaid_fail(message: str, line: int) -> None:
    _core_coverage_mark("_flow_mermaid_fail")
    with_line = _core_string_format("{} (line {})", message, line)
    err = _core_runtime_error(with_line)
    raise err


def _flow_mermaid_register_node(ast: Any, id: str, shape: str, label: Any, line: int) -> Any:
    _core_coverage_mark("_flow_mermaid_register_node")
    valid = _core_regex_match("^[A-Za-z_][A-Za-z0-9_]*$", id)
    invalid = _core_not(valid)
    if invalid:
        _flow_mermaid_fail("Expected a node id", line)
    else:
        pass
    nodes = _core_get(ast, "nodes", None)
    known = _core_map_contains(nodes, id)
    if known:
        existing = _core_get(nodes, id, None)
        existing_label = _core_get(existing, "label", None)
        missing_existing_label = _core_is_none(existing_label)
        has_label = _core_is_not_none(label)
        replace = _core_and(missing_existing_label, has_label)
        if replace:
            existing["shape"] = shape
            existing["label"] = label
        else:
            pass
        return existing
    else:
        pass
    node = {}
    node["id"] = id
    node["shape"] = shape
    node["label"] = label
    node["line"] = line
    nodes[id] = node
    order = _core_get(ast, "order", None)
    index = _core_len(order)
    order.append(id)
    order_index = _core_get(ast, "orderIndex", None)
    order_index[id] = index
    return node


def _flow_mermaid_parse_node_ref(ast: Any, text: str, line: int) -> str:
    _core_coverage_mark("_flow_mermaid_parse_node_ref")
    source = str(text).strip()
    source_len = _core_len(source)
    empty = _core_eq(source_len, 0)
    if empty:
        _flow_mermaid_fail("Expected a node id", line)
    else:
        pass
    split_at = source_len
    delimiters = []
    delimiters.append("[")
    delimiters.append("(")
    delimiters.append("{")
    for delimiter in delimiters:
        candidate = _core_string_find_outside_quotes(source, delimiter)
        found = _core_gte(candidate, 0)
        earlier = _core_lt(candidate, split_at)
        use = _core_and(found, earlier)
        if use:
            split_at = candidate
        else:
            pass
    id_raw = _core_string_slice(source, 0, split_at)
    id = str(id_raw).strip()
    tail = _core_string_slice(source, split_at)
    tail = str(tail).strip()
    shape = "rect"
    label = _core_none()
    has_tail = _core_truthy(tail)
    if has_tail:
        starts_round_bracket = _core_string_starts_with(tail, "([")
        starts_double_round = _core_string_starts_with(tail, "((")
        starts_round = _core_string_starts_with(tail, "(")
        starts_rect = _core_string_starts_with(tail, "[")
        starts_diamond = _core_string_starts_with(tail, "{")
        group = {}
        if starts_round:
            group = _core_string_extract_leading_group(tail, "(", ")")
            shape = "round"
        else:
            if starts_rect:
                group = _core_string_extract_leading_group(tail, "[", "]")
                shape = "rect"
            else:
                if starts_diamond:
                    group = _core_string_extract_leading_group(tail, "{", "}")
                    shape = "diamond"
                else:
                    _flow_mermaid_fail("Unexpected content after node id", line)
        balanced = _core_get(group, "balanced", False)
        rest = _core_get(group, "rest", "")
        rest = str(rest).strip()
        trailing = _core_truthy(rest)
        bad = _core_not(balanced)
        bad = _core_or(bad, trailing)
        if bad:
            _flow_mermaid_fail("Unexpected content after node shape", line)
        else:
            pass
        label_text = _core_get(group, "group", "")
        if starts_round_bracket:
            shape = "round"
            inner_len = _core_len(label_text)
            inner_end = _core_add(inner_len, -1)
            label_text = _core_string_slice(label_text, 1, inner_end)
        else:
            pass
        if starts_double_round:
            shape = "rect"
            inner_len = _core_len(label_text)
            inner_end = _core_add(inner_len, -1)
            label_text = _core_string_slice(label_text, 1, inner_end)
        else:
            pass
        label_text = str(label_text).strip()
        quoted_double = _core_string_starts_with(label_text, "\"")
        quoted_single = _core_string_starts_with(label_text, "'")
        quoted = _core_or(quoted_double, quoted_single)
        if quoted:
            label_len = _core_len(label_text)
            label_end = _core_add(label_len, -1)
            label_text = _core_string_slice(label_text, 1, label_end)
        else:
            pass
        label = label_text
    else:
        pass
    node = _flow_mermaid_register_node(ast, id, shape, label, line)
    is_diamond = _core_eq(shape, "diamond")
    if is_diamond:
        tail_len = _core_len(tail)
        close_index = _core_add(tail_len, -1)
        open_brace = _core_string_slice(tail, 0, 1)
        close_brace = _core_string_slice(tail, close_index)
        node["open"] = open_brace
        node["close"] = close_brace
    else:
        pass
    return id


def _flow_mermaid_parse_group(ast: Any, text: str, line: int) -> list[Any]:
    _core_coverage_mark("_flow_mermaid_parse_group")
    parts = _core_string_split_top_level(text, "&")
    ids = []
    for part in parts:
        id = _flow_mermaid_parse_node_ref(ast, part, line)
        ids.append(id)
    return ids


def _flow_mermaid_parse(text: str) -> Any:
    _core_coverage_mark("_flow_mermaid_parse")
    ast = {}
    directives = {}
    directive_order = []
    nodes = {}
    order = []
    order_index = {}
    edges = []
    ast["direction"] = "TD"
    ast["directives"] = directives
    ast["directiveOrder"] = directive_order
    ast["nodes"] = nodes
    ast["order"] = order
    ast["orderIndex"] = order_index
    ast["edges"] = edges
    saw_header = False
    lines = _core_string_split(text, "\n")
    line_number = 0
    for raw in lines:
        line_number = _core_add(line_number, 1)
        line = str(raw).strip()
        is_empty = _core_eq(line, "")
        if is_empty:
            pass
        else:
            is_ax = _core_regex_match("^%%ax\\s+", line)
            is_comment = _core_regex_match("^%%", line)
            if is_ax:
                percent = _core_string_slice(line, 0, 1)
                ast["percent"] = percent
                directive_body = _core_string_slice(line, 5)
                parts = _core_string_split_once(directive_body, ":")
                found_colon = _core_get(parts, "found", False)
                if found_colon:
                    pass
                else:
                    _flow_mermaid_fail("Invalid Ax directive", line_number)
                id = _core_get(parts, "left", "")
                id = str(id).strip()
                sig = _core_get(parts, "right", "")
                sig = str(sig).strip()
                valid_id = _core_regex_match("^[A-Za-z_][A-Za-z0-9_]*$", id)
                invalid_id = _core_not(valid_id)
                if invalid_id:
                    _flow_mermaid_fail("Invalid Ax directive node id", line_number)
                else:
                    pass
                duplicate = _core_map_contains(directives, id)
                if duplicate:
                    message = _core_string_format("Duplicate Ax directive for node \"{}\"", id)
                    _flow_mermaid_fail(message, line_number)
                else:
                    pass
                directives[id] = sig
                directive_order.append(id)
            else:
                if is_comment:
                    pass
                else:
                    is_flowchart = _core_string_starts_with(line, "flowchart ")
                    is_graph = _core_string_starts_with(line, "graph ")
                    is_header = _core_or(is_flowchart, is_graph)
                    if is_header:
                        if saw_header:
                            _flow_mermaid_fail("Multiple flowchart headers", line_number)
                        else:
                            pass
                        words = _core_string_words(line)
                        direction = _core_list_get(words, 1, "")
                        is_td = _core_eq(direction, "TD")
                        is_lr = _core_eq(direction, "LR")
                        is_bt = _core_eq(direction, "BT")
                        is_rl = _core_eq(direction, "RL")
                        supported_a = _core_or(is_td, is_lr)
                        supported_b = _core_or(is_bt, is_rl)
                        supported = _core_or(supported_a, supported_b)
                        unsupported = _core_not(supported)
                        if unsupported:
                            _flow_mermaid_fail("Unsupported flowchart direction", line_number)
                        else:
                            pass
                        ast["direction"] = direction
                        saw_header = True
                    else:
                        if saw_header:
                            pass
                        else:
                            _flow_mermaid_fail("Missing flowchart header", line_number)
                        unsupported_construct = _core_regex_match("^(subgraph\\b|end\\b|style\\b|classDef\\b|class\\b|linkStyle\\b|click\\b|direction\\b)", line)
                        if unsupported_construct:
                            _flow_mermaid_fail("Unsupported mermaid construct", line_number)
                        else:
                            pass
                        unsupported_arrow = _core_regex_match("(-\\.+->|={2,}>|---|~~~)", line)
                        if unsupported_arrow:
                            _flow_mermaid_fail("Unsupported arrow syntax", line_number)
                        else:
                            pass
                        segments = _core_string_split_top_level(line, "-->")
                        segment_count = _core_len(segments)
                        from_text = _core_list_get(segments, 0, "")
                        from_ids = _flow_mermaid_parse_group(ast, from_text, line_number)
                        segment_index = 1
                        while True:
                            done = _core_gte(segment_index, segment_count)
                            if done:
                                break
                            else:
                                pass
                            segment = _core_list_get(segments, segment_index, "")
                            segment = str(segment).strip()
                            label = _core_none()
                            has_label = _core_string_starts_with(segment, "|")
                            if has_label:
                                after_bar = _core_string_slice(segment, 1)
                                label_parts = _core_string_split_once(after_bar, "|")
                                label_closed = _core_get(label_parts, "found", False)
                                if label_closed:
                                    pass
                                else:
                                    _flow_mermaid_fail("Unterminated edge label", line_number)
                                label = _core_get(label_parts, "left", "")
                                label = str(label).strip()
                                segment = _core_get(label_parts, "right", "")
                                segment = str(segment).strip()
                            else:
                                pass
                            to_ids = _flow_mermaid_parse_group(ast, segment, line_number)
                            for from_node in from_ids:
                                for to in to_ids:
                                    edge = {}
                                    edge["from"] = from_node
                                    edge["to"] = to
                                    edge["label"] = label
                                    edge["line"] = line_number
                                    edges.append(edge)
                            from_ids = to_ids
                            segment_index = _core_add(segment_index, 1)
    if saw_header:
        pass
    else:
        _flow_mermaid_fail("Missing flowchart header", 1)
    node_count = _core_len(order)
    no_nodes = _core_eq(node_count, 0)
    if no_nodes:
        _flow_mermaid_fail("No nodes found in the diagram", 1)
    else:
        pass
    return ast


def _flow_mermaid_reachable(start: str, target: str, edges: Any) -> bool:
    _core_coverage_mark("_flow_mermaid_reachable")
    queue = []
    queue.append(start)
    seen = {}
    seen[start] = True
    index = 0
    while True:
        count = _core_len(queue)
        done = _core_gte(index, count)
        if done:
            break
        else:
            pass
        current = _core_list_get(queue, index, "")
        index = _core_add(index, 1)
        for edge in edges:
            from_node = _core_get(edge, "from", "")
            matches = _core_eq(from_node, current)
            if matches:
                to = _core_get(edge, "to", "")
                found = _core_eq(to, target)
                if found:
                    return True
                else:
                    pass
                known = _core_map_contains(seen, to)
                is_new = _core_not(known)
                if is_new:
                    seen[to] = True
                    queue.append(to)
                else:
                    pass
            else:
                pass
    return False


def _flow_mermaid_topological_order(document_order: Any, edges: Any) -> list[Any]:
    _core_coverage_mark("_flow_mermaid_topological_order")
    result = []
    processed = {}
    total = _core_len(document_order)
    while True:
        count = _core_len(result)
        done = _core_gte(count, total)
        if done:
            break
        else:
            pass
        progress = False
        for id in document_order:
            known = _core_map_contains(processed, id)
            if known:
                pass
            else:
                ready = True
                for edge in edges:
                    to = _core_get(edge, "to", "")
                    incoming = _core_eq(to, id)
                    if incoming:
                        parent = _core_get(edge, "from", "")
                        parent_done = _core_map_contains(processed, parent)
                        waiting = _core_not(parent_done)
                        if waiting:
                            ready = False
                        else:
                            pass
                    else:
                        pass
                if ready:
                    processed[id] = True
                    result.append(id)
                    progress = True
                else:
                    pass
        if progress:
            pass
        else:
            _flow_mermaid_fail("Cycle without a classified back-edge", 1)
    return result


def _flow_mermaid_decision(node: str, ast: Any, infos: Any) -> Any:
    _core_coverage_mark("_flow_mermaid_decision")
    empty = {}
    info = _core_get(infos, node, empty)
    signature = _core_get(info, "signature", None)
    missing_signature = _core_is_none(signature)
    if missing_signature:
        message = _core_string_format("Decision node \"{}\" needs an Ax signature directive", node)
        _flow_mermaid_fail(message, 1)
    else:
        pass
    outputs = _core_get(info, "outputs", None)
    nodes = _core_get(ast, "nodes", None)
    node_ast = _core_get(nodes, node, None)
    shape = _core_get(node_ast, "shape", "rect")
    is_diamond = _core_eq(shape, "diamond")
    field_name = ""
    if is_diamond:
        field_name = _core_get(node_ast, "label", "")
    else:
        candidate_count = 0
        for field in outputs:
            type = _core_get(field, "type", None)
            type_name = _core_get(type, "name", "")
            is_class = _core_eq(type_name, "class")
            is_boolean = _core_eq(type_name, "boolean")
            eligible = _core_or(is_class, is_boolean)
            if eligible:
                candidate_count = _core_add(candidate_count, 1)
                field_name = _core_get(field, "name", "")
            else:
                pass
        one = _core_eq(candidate_count, 1)
        if one:
            pass
        else:
            message = _core_string_format("Cannot infer decision field for node \"{}\"", node)
            _flow_mermaid_fail(message, 1)
    chosen = _core_none()
    for field in outputs:
        name = _core_get(field, "name", "")
        matches = _core_eq(name, field_name)
        if matches:
            chosen = field
        else:
            pass
    missing = _core_is_none(chosen)
    if missing:
        message = _core_string_format("Decision field \"{}\" is not an output of node \"{}\"", field_name, node)
        _flow_mermaid_fail(message, 1)
    else:
        pass
    type = _core_get(chosen, "type", None)
    decision = {}
    decision["nodeName"] = node
    decision["field"] = field_name
    decision_type = _core_get(type, "name", "")
    decision["type"] = decision_type
    empty_options = []
    decision_options = _core_get(type, "options", empty_options)
    decision["options"] = decision_options
    return decision


def _flow_mermaid_guards_compatible(nodes: Any, guards: Any) -> bool:
    _core_coverage_mark("_flow_mermaid_guards_compatible")
    count = _core_len(nodes)
    enough = _core_gt(count, 1)
    if enough:
        pass
    else:
        return False
    first_node = _core_list_get(nodes, 0, "")
    first = _core_get(guards, first_node, None)
    missing_first = _core_is_none(first)
    if missing_first:
        return False
    else:
        pass
    owner = _core_get(first, "nodeName", "")
    field = _core_get(first, "field", "")
    values = {}
    for node in nodes:
        guard = _core_get(guards, node, None)
        missing = _core_is_none(guard)
        if missing:
            return False
        else:
            pass
        guard_owner = _core_get(guard, "nodeName", "")
        guard_field = _core_get(guard, "field", "")
        same_owner = _core_eq(guard_owner, owner)
        same_field = _core_eq(guard_field, field)
        same = _core_and(same_owner, same_field)
        different = _core_not(same)
        if different:
            return False
        else:
            pass
        value = _core_get(guard, "value", None)
        value_key = _core_string_str(value)
        duplicate = _core_map_contains(values, value_key)
        if duplicate:
            return False
        else:
            pass
        values[value_key] = True
    return True


def _flow_mermaid_execute_step(info: Any, guard: Any) -> Any:
    _core_coverage_mark("_flow_mermaid_execute_step")
    name = _core_get(info, "id", "")
    program = _core_get(info, "program", None)
    kind = _core_get(info, "kind", "execute")
    options = {}
    reads = _core_get(info, "reads", None)
    resolved_reads = []
    for read in reads:
        resolved_reads.append(read)
    writes = []
    result_key = _core_string_format("{}Result", name)
    writes.append(result_key)
    options["writes"] = writes
    signature_text = _core_get(info, "signatureText", "")
    has_signature = _core_truthy(signature_text)
    if has_signature:
        options["signatureText"] = signature_text
    else:
        pass
    has_guard = _core_is_not_none(guard)
    if has_guard:
        options["guard"] = guard
        guard_node = _core_get(guard, "nodeName", "")
        guard_read = _core_string_format("{}Result", guard_node)
        has_guard_read = _core_contains(resolved_reads, guard_read)
        missing_guard_read = _core_not(has_guard_read)
        if missing_guard_read:
            resolved_reads.append(guard_read)
        else:
            pass
    else:
        pass
    options["reads"] = resolved_reads
    step = _flow_step(kind, name, program, options)
    meta = {}
    meta["kind"] = kind
    meta["nodeName"] = name
    step["meta"] = meta
    return step


def _flow_mermaid_parse_max(label: str, fallback: int) -> i64:
    _core_coverage_mark("_flow_mermaid_parse_max")
    parts = _core_string_split_trim_nonempty(label, ",")
    max = fallback
    for part in parts:
        starts = _core_string_starts_with(part, "max ")
        if starts:
            raw = _core_string_slice(part, 4)
            parsed = _core_json_parse(raw)
            max = parsed
        else:
            pass
    return max


def _flow_mermaid_compile(ast: Any, bindings: Any) -> Any:
    _core_coverage_mark("_flow_mermaid_compile")
    empty_map = {}
    empty_list = []
    opts = _core_get(bindings, "options", empty_map)
    flow = _flow_factory(opts)
    order = _core_get(ast, "order", None)
    order_index = _core_get(ast, "orderIndex", None)
    edges = _core_get(ast, "edges", None)
    directives = _core_get(ast, "directives", None)
    node_bindings = _core_get(bindings, "nodes", empty_map)
    conditions = _core_get(bindings, "conditions", empty_map)
    forward_edges = []
    back_edges = []
    for edge in edges:
        from_node = _core_get(edge, "from", None)
        to = _core_get(edge, "to", None)
        from_index = _core_get(order_index, from_node, None)
        to_index = _core_get(order_index, to, None)
        points_backward = _core_gte(from_index, to_index)
        closes_cycle = _flow_mermaid_reachable(to, from_node, edges)
        is_back = _core_and(points_backward, closes_cycle)
        if is_back:
            label = _core_get(edge, "label", None)
            missing_label = _core_is_none(label)
            if missing_label:
                message = _core_string_format("Back-edges need a label: {} --> {}", from_node, to)
                edge_line_number = _core_get(edge, "line", 1)
                _flow_mermaid_fail(message, edge_line_number)
            else:
                pass
            back_edges.append(edge)
        else:
            forward_edges.append(edge)
    compile_order = _flow_mermaid_topological_order(order, forward_edges)
    compile_order_index = {}
    compile_index = 0
    for compile_id in compile_order:
        compile_order_index[compile_id] = compile_index
        compile_index = _core_add(compile_index, 1)
    ast["compileOrder"] = compile_order
    infos = {}
    producers = {}
    missing_nodes = []
    for id in compile_order:
        has_directive = _core_map_contains(directives, id)
        has_binding = _core_map_contains(node_bindings, id)
        resolved = _core_or(has_directive, has_binding)
        if resolved:
            pass
        else:
            missing_nodes.append(id)
        info = {}
        info_reads = []
        info["id"] = id
        info["kind"] = "execute"
        info["reads"] = info_reads
        signature_text = _core_get(directives, id, "")
        info["signatureText"] = signature_text
        program = _core_get(node_bindings, id, signature_text)
        info["program"] = program
        missing_directive = _core_not(has_directive)
        binding_only = _core_and(has_binding, missing_directive)
        if binding_only:
            info["kind"] = "map"
        else:
            pass
        if has_directive:
            signature = parse_signature(signature_text)
            info["signature"] = signature
            inputs = _signature_input_fields(signature)
            outputs = _signature_output_fields(signature)
            info["inputs"] = inputs
            info["outputs"] = outputs
            for field in outputs:
                field_name = _core_get(field, "name", "")
                field_producers = _core_get(producers, field_name, None)
                missing_field_producers = _core_is_none(field_producers)
                if missing_field_producers:
                    field_producers = []
                    producers[field_name] = field_producers
                else:
                    pass
                field_producers.append(id)
        else:
            pass
        infos[id] = info
    missing_count = _core_len(missing_nodes)
    has_missing = _core_gt(missing_count, 0)
    if has_missing:
        joined = _core_string_join(", ", missing_nodes)
        message = _core_string_format("No signature for node(s): {}", joined)
        _flow_mermaid_fail(message, 1)
    else:
        pass
    guards = {}
    for edge in forward_edges:
        label = _core_get(edge, "label", None)
        has_label = _core_is_not_none(label)
        if has_label:
            starts_if = _core_string_starts_with(label, "if ")
            starts_while = _core_string_starts_with(label, "while ")
            reserved = _core_or(starts_if, starts_while)
            if reserved:
                edge_line_number = _core_get(edge, "line", 1)
                _flow_mermaid_fail("if/while labels are only valid on back-edges", edge_line_number)
            else:
                pass
            from_node = _core_get(edge, "from", None)
            decision = _flow_mermaid_decision(from_node, ast, infos)
            type = _core_get(decision, "type", "")
            is_class = _core_eq(type, "class")
            if is_class:
                options = _core_get(decision, "options", empty_list)
                valid_option = _core_contains(options, label)
                invalid_option = _core_not(valid_option)
                if invalid_option:
                    field = _core_get(decision, "field", "")
                    message = _core_string_format("\"{}\" is not an option of \"{}.{}\"", label, from_node, field)
                    edge_line_number = _core_get(edge, "line", 1)
                    _flow_mermaid_fail(message, edge_line_number)
                else:
                    pass
            else:
                pass
            decision["value"] = label
            to = _core_get(edge, "to", None)
            guards[to] = decision
        else:
            pass
    for id in compile_order:
        already_guarded = _core_map_contains(guards, id)
        if already_guarded:
            pass
        else:
            incoming = []
            for edge in forward_edges:
                to = _core_get(edge, "to", "")
                matches = _core_eq(to, id)
                if matches:
                    incoming_from = _core_get(edge, "from", "")
                    incoming.append(incoming_from)
                else:
                    pass
            incoming_count = _core_len(incoming)
            one_incoming = _core_eq(incoming_count, 1)
            if one_incoming:
                parent = _core_list_get(incoming, 0, "")
                parent_guard = _core_get(guards, parent, None)
                has_parent_guard = _core_is_not_none(parent_guard)
                if has_parent_guard:
                    guards[id] = parent_guard
                else:
                    pass
            else:
                pass
    natural_inputs = {}
    for id in compile_order:
        info = _core_get(infos, id, None)
        signature = _core_get(info, "signature", None)
        has_signature = _core_is_not_none(signature)
        if has_signature:
            inputs = _core_get(info, "inputs", empty_list)
            reads = []
            for field in inputs:
                field_name = _core_get(field, "name", "")
                all_producers = _core_get(producers, field_name, empty_list)
                upstream = []
                for producer in all_producers:
                    not_self = _core_ne(producer, id)
                    if not_self:
                        reachable = _flow_mermaid_reachable(producer, id, forward_edges)
                        if reachable:
                            upstream.append(producer)
                        else:
                            pass
                    else:
                        pass
                upstream_count = _core_len(upstream)
                ambiguous = _core_gt(upstream_count, 1)
                if ambiguous:
                    compatible = _flow_mermaid_guards_compatible(upstream, guards)
                    bad_ambiguity = _core_not(compatible)
                    if bad_ambiguity:
                        a = _core_list_get(upstream, 0, "")
                        b = _core_list_get(upstream, 1, "")
                        pair = _core_string_format("{} and {}", a, b)
                        message = _core_string_format("Input \"{}\" of node \"{}\" is produced by {} at the same distance", field_name, id, pair)
                        _flow_mermaid_fail(message, 1)
                    else:
                        pass
                else:
                    pass
                has_upstream = _core_gt(upstream_count, 0)
                if has_upstream:
                    for producer in upstream:
                        read = _core_string_format("{}Result", producer)
                        reads.append(read)
                else:
                    producer_count = _core_len(all_producers)
                    has_other_producer = _core_gt(producer_count, 0)
                    if has_other_producer:
                        producer = _core_list_get(all_producers, 0, "")
                        same_only = _core_eq(producer, id)
                        if same_only:
                            natural_inputs[field_name] = field
                        else:
                            message = _core_string_format("\"{}\" of node \"{}\" is produced by \"{}\" which is not upstream", field_name, id, producer)
                            _flow_mermaid_fail(message, 1)
                    else:
                        natural_inputs[field_name] = field
            info["reads"] = reads
        else:
            pass
    self_while = {}
    for edge in back_edges:
        from_node = _core_get(edge, "from", None)
        to = _core_get(edge, "to", None)
        label = _core_get(edge, "label", "")
        parts = _core_string_split_trim_nonempty(label, ",")
        main = _core_list_get(parts, 0, "")
        is_while = _core_string_starts_with(main, "while ")
        self = _core_eq(from_node, to)
        self_loop = _core_and(is_while, self)
        if self_loop:
            self_while[from_node] = edge
        else:
            pass
    steps = _core_get(flow, "steps", None)
    loop_index = 0
    for id in compile_order:
        info = _core_get(infos, id, None)
        guard = _core_get(guards, id, None)
        has_self_while = _core_map_contains(self_while, id)
        if has_self_while:
            pass
        else:
            step = _flow_mermaid_execute_step(info, guard)
            steps.append(step)
        for edge in back_edges:
            from_node = _core_get(edge, "from", None)
            matches_source = _core_eq(from_node, id)
            if matches_source:
                loop_index = _core_add(loop_index, 1)
                to = _core_get(edge, "to", None)
                label = _core_get(edge, "label", "")
                label_parts = _core_string_split_trim_nonempty(label, ",")
                main = _core_list_get(label_parts, 0, "")
                is_while = _core_string_starts_with(main, "while ")
                is_if = _core_string_starts_with(main, "if ")
                loop_kind = "feedback"
                fallback_max = 10
                if is_while:
                    loop_kind = "while"
                    fallback_max = 100
                else:
                    pass
                max = _flow_mermaid_parse_max(label, fallback_max)
                body = []
                to_index = _core_get(compile_order_index, to, None)
                from_index = _core_get(compile_order_index, from_node, None)
                for body_id in compile_order:
                    body_index = _core_get(compile_order_index, body_id, None)
                    after_start = _core_gte(body_index, to_index)
                    before_end = _core_lte(body_index, from_index)
                    in_body = _core_and(after_start, before_end)
                    if in_body:
                        body_info = _core_get(infos, body_id, None)
                        body_guard = _core_get(guards, body_id, None)
                        body_step = _flow_mermaid_execute_step(body_info, body_guard)
                        body.append(body_step)
                    else:
                        pass
                loop_options = {}
                loop_options["steps"] = body
                loop_options["maxIterations"] = max
                loop_options["label"] = to
                meta = {}
                meta["kind"] = loop_kind
                meta["maxIterations"] = max
                meta["target"] = to
                if is_while:
                    condition_name = _core_string_slice(main, 6)
                    condition_name = str(condition_name).strip()
                    condition = _core_get(conditions, condition_name, None)
                    missing_condition = _core_is_none(condition)
                    if missing_condition:
                        message = _core_string_format("Missing condition binding \"{}\"", condition_name)
                        edge_line_number = _core_get(edge, "line", 1)
                        _flow_mermaid_fail(message, edge_line_number)
                    else:
                        pass
                    loop_options["condition"] = condition
                    loop_options["conditionName"] = condition_name
                    meta["conditionName"] = condition_name
                else:
                    if is_if:
                        condition_name = _core_string_slice(main, 3)
                        condition_name = str(condition_name).strip()
                        condition = _core_get(conditions, condition_name, None)
                        missing_condition = _core_is_none(condition)
                        if missing_condition:
                            message = _core_string_format("Missing condition binding \"{}\"", condition_name)
                            edge_line_number = _core_get(edge, "line", 1)
                            _flow_mermaid_fail(message, edge_line_number)
                        else:
                            pass
                        loop_options["condition"] = condition
                        loop_options["conditionName"] = condition_name
                        meta["conditionName"] = condition_name
                    else:
                        decision = _flow_mermaid_decision(from_node, ast, infos)
                        decision["value"] = main
                        loop_options["condition"] = decision
                        loop_options["decision"] = decision
                        meta["decision"] = decision
                loop_name = _core_string_format("{}{}", loop_kind, loop_index)
                loop_step = _flow_step(loop_kind, loop_name, None, loop_options)
                loop_step["meta"] = meta
                steps.append(loop_step)
            else:
                pass
    terminal_fields = {}
    returns = {}
    for id in compile_order:
        has_outgoing = False
        for edge in forward_edges:
            from_node = _core_get(edge, "from", "")
            matches = _core_eq(from_node, id)
            if matches:
                has_outgoing = True
            else:
                pass
        if has_outgoing:
            pass
        else:
            info = _core_get(infos, id, None)
            signature = _core_get(info, "signature", None)
            has_signature = _core_is_not_none(signature)
            if has_signature:
                outputs = _core_get(info, "outputs", empty_list)
                for field in outputs:
                    name = _core_get(field, "name", "")
                    duplicate = _core_map_contains(terminal_fields, name)
                    if duplicate:
                        message = _core_string_format("Output field \"{}\" is produced by multiple terminal nodes", name)
                        _flow_mermaid_fail(message, 1)
                    else:
                        pass
                    terminal_fields[name] = field
                    path = _core_string_format("{}Result.{}", id, name)
                    returns[name] = path
            else:
                pass
    flow["returns"] = returns
    flow["mermaidAst"] = ast
    flow["mermaidBindings"] = bindings
    flow["mermaidInputFields"] = natural_inputs
    flow["mermaidOutputFields"] = terminal_fields
    return flow


def _flow_mermaid_render_ast(ast: Any, options: Any) -> str:
    _core_coverage_mark("_flow_mermaid_render_ast")
    empty_map = {}
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    direction = _core_get(opts, "direction", "TD")
    lines = []
    header = _core_string_format("flowchart {}", direction)
    lines.append(header)
    directives = _core_get(ast, "directives", None)
    directive_order = _core_get(ast, "directiveOrder", None)
    percent = _core_get(ast, "percent", "")
    for id in directive_order:
        signature_text = _core_get(directives, id, None)
        signature = parse_signature(signature_text)
        canonical = signature_to_string(signature)
        prefix = _core_string_format("{}{}ax", percent, percent)
        directive = _core_string_format("  {} {}: {}", prefix, id, canonical)
        lines.append(directive)
    lines.append("")
    nodes = _core_get(ast, "nodes", None)
    order = _core_get(ast, "order", None)
    compile_order = _core_get(ast, "compileOrder", order)
    order_index = _core_get(ast, "orderIndex", None)
    edges = _core_get(ast, "edges", None)
    for id in compile_order:
        node = _core_get(nodes, id, None)
        shape = _core_get(node, "shape", "rect")
        label = _core_get(node, "label", None)
        is_diamond = _core_eq(shape, "diamond")
        if is_diamond:
            pass
        else:
            spaced_title = _core_string_title_from_camel(id)
            lower_title = _core_string_lower(spaced_title)
            label = _core_string_title_from_camel(lower_title)
        statement = _core_string_format("  {}[{}]", id, label)
        if is_diamond:
            open_brace = _core_get(node, "open", "")
            close_brace = _core_get(node, "close", "")
            wrapped = _core_string_format("{}{}{}", open_brace, label, close_brace)
            statement = _core_string_format("  {}{}", id, wrapped)
        else:
            pass
        lines.append(statement)
        for edge in edges:
            to = _core_get(edge, "to", "")
            arrives = _core_eq(to, id)
            if arrives:
                from_node = _core_get(edge, "from", "")
                from_index = _core_get(order_index, from_node, None)
                to_index = _core_get(order_index, to, None)
                points_backward = _core_gte(from_index, to_index)
                closes_cycle = _flow_mermaid_reachable(to, from_node, edges)
                back = _core_and(points_backward, closes_cycle)
                forward = _core_not(back)
                if forward:
                    label = _core_get(edge, "label", None)
                    has_label = _core_is_not_none(label)
                    edge_line = _core_string_format("  {} --> {}", from_node, to)
                    if has_label:
                        edge_line = _core_string_format("  {} -->|{}| {}", from_node, label, to)
                    else:
                        pass
                    lines.append(edge_line)
                else:
                    pass
            else:
                pass
    for edge in edges:
        from_node = _core_get(edge, "from", "")
        to = _core_get(edge, "to", "")
        from_index = _core_get(order_index, from_node, None)
        to_index = _core_get(order_index, to, None)
        points_backward = _core_gte(from_index, to_index)
        closes_cycle = _flow_mermaid_reachable(to, from_node, edges)
        back = _core_and(points_backward, closes_cycle)
        if back:
            label = _core_get(edge, "label", None)
            has_label = _core_is_not_none(label)
            edge_line = _core_string_format("  {} --> {}", from_node, to)
            if has_label:
                edge_line = _core_string_format("  {} -->|{}| {}", from_node, label, to)
            else:
                pass
            lines.append(edge_line)
        else:
            pass
    lines.append("")
    rendered = _core_string_join("\n", lines)
    return rendered


def _flow_mermaid_render_flow(flow: Any, options: Any) -> str:
    _core_coverage_mark("_flow_mermaid_render_flow")
    empty_map = {}
    opts_missing = _core_is_none(options)
    opts = options
    if opts_missing:
        opts = empty_map
    else:
        pass
    direction = _core_get(opts, "direction", "TD")
    lines = []
    header = _core_string_format("flowchart {}", direction)
    lines.append(header)
    steps = _core_get(flow, "steps", None)
    percent = _core_get(flow, "mermaidPercent", "")
    for step in steps:
        kind = _core_get(step, "kind", "execute")
        is_execute = _core_eq(kind, "execute")
        if is_execute:
            step_options = _core_get(step, "options", empty_map)
            signature_text = _core_get(step_options, "signatureText", "")
            has_signature = _core_truthy(signature_text)
            if has_signature:
                signature = parse_signature(signature_text)
                canonical = signature_to_string(signature)
                name = _core_get(step, "name", "")
                prefix = _core_string_format("{}{}ax", percent, percent)
                directive = _core_string_format("  {} {}: {}", prefix, name, canonical)
                lines.append(directive)
            else:
                pass
        else:
            pass
    lines.append("")
    diamonds = {}
    for step in steps:
        meta = _core_get(step, "meta", empty_map)
        decision = _core_get(meta, "decision", None)
        has_decision = _core_is_not_none(decision)
        if has_decision:
            node = _core_get(decision, "nodeName", "")
            field = _core_get(decision, "field", "")
            diamonds[node] = field
        else:
            pass
    seen = {}
    for step in steps:
        kind = _core_get(step, "kind", "execute")
        is_execute = _core_eq(kind, "execute")
        is_map = _core_eq(kind, "map")
        material = _core_or(is_execute, is_map)
        if material:
            name = _core_get(step, "name", "")
            known = _core_map_contains(seen, name)
            if known:
                pass
            else:
                seen[name] = True
                spaced_title = _core_string_title_from_camel(name)
                lower_title = _core_string_lower(spaced_title)
                title = _core_string_title_from_camel(lower_title)
                diamond = _core_get(diamonds, name, None)
                has_diamond = _core_is_not_none(diamond)
                statement = _core_string_format("  {}[{}]", name, title)
                if has_diamond:
                    open_brace = _core_get(flow, "mermaidOpenBrace", "")
                    close_brace = _core_get(flow, "mermaidCloseBrace", "")
                    wrapped = _core_string_format("{}{}{}", open_brace, diamond, close_brace)
                    statement = _core_string_format("  {}{}", name, wrapped)
                else:
                    pass
                lines.append(statement)
                step_options = _core_get(step, "options", empty_map)
                empty_reads = []
                step_reads = _core_get(step, "reads", empty_reads)
                reads = _core_get(step_options, "reads", step_reads)
                for read in reads:
                    is_result = _core_string_ends_with(read, "Result")
                    if is_result:
                        read_len = _core_len(read)
                        producer_end = _core_add(read_len, -6)
                        producer = _core_string_slice(read, 0, producer_end)
                        edge_line = _core_string_format("  {} --> {}", producer, name)
                        lines.append(edge_line)
                    else:
                        pass
        else:
            pass
    lines.append("")
    rendered = _core_string_join("\n", lines)
    return rendered


def _flow_from_mermaid(text: str, bindings: Any) -> Any:
    _core_coverage_mark("_flow_from_mermaid")
    empty_map = {}
    missing = _core_is_none(bindings)
    resolved = bindings
    if missing:
        resolved = empty_map
    else:
        pass
    ast = _flow_mermaid_parse(text)
    flow = _flow_mermaid_compile(ast, resolved)
    return flow


def _flow_to_mermaid(flow: Any, options: Any) -> str:
    _core_coverage_mark("_flow_to_mermaid")
    ast = _core_get(flow, "mermaidAst", None)
    has_ast = _core_is_not_none(ast)
    if has_ast:
        rendered = _flow_mermaid_render_ast(ast, options)
        return rendered
    else:
        pass
    rendered = _flow_mermaid_render_flow(flow, options)
    return rendered

# END AXIR CORE EMITTED FUNCTIONS
