from __future__ import annotations

import copy
import json
from typing import Any, Callable

from .ai import AIClient
from .gen import (
    AxGen,
    _core_exception_message,
    _core_eq,
    _core_gte,
    _core_get,
    _core_is_none,
    _core_json_stringify,
    _core_map_merge,
    _core_object_call_method,
    _core_or,
    _core_runtime_error,
    _core_string_format,
    _core_truthy,
    _filter_optimization_components,
)
from .agent import (
    OptimizerEngine,
    OptimizerEvaluator,
    _adjust_optimization_score_for_actions,
    _build_optimization_eval_result,
    _build_optimization_eval_row,
    _build_agent_eval_prediction,
    _build_optimizer_request,
    _call_optimizer_engine,
    _core_agent_stage_chat_log,
    _core_agent_stage_forward,
    _core_agent_stage_traces,
    _core_agent_stage_usage,
    _normalize_optimization_dataset,
    _normalize_optimization_metric_scores,
    _optimization_component,
    _optimization_changed_components,
    _optimization_component_current_map,
    _normalize_optimizer_engine_response,
    _prepare_optimizer_run,
    _scalarize_optimization_scores,
    _deserialize_optimized_artifact,
    _validate_optimized_artifact,
    _validate_optimization_component_map,
)


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
        return out
    return _FlowCallable(_mapper)


class AxProgram:
    def forward(self, client, values, options=None):
        raise NotImplementedError

    def get_optimizable_components(self):
        return []

    def apply_optimized_components(self, component_map):
        return self


class AxFlow(AxProgram):
    def __init__(self, options: dict[str, Any] | None = None):
        self.state = _flow_factory(options or {})

    def execute(self, name: str, program, options: dict[str, Any] | None = None):
        return self._add_step("execute", name, program, options)

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

            class _Evaluator(OptimizerEvaluator):
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
            raise NotImplementedError("AxIR generated runtimes require an OptimizerEngine for optimize()")
        return self.optimize_with(engine, dataset or [], opts)

    def forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        return _flow_forward(self.state, client, values or {}, options or {})

    def streaming_forward(self, client: AIClient, values: dict[str, Any], options: dict[str, Any] | None = None):
        yield {"version": 1, "index": 0, "delta": self.forward(client, values or {}, options or {})}

    def _add_step(self, kind, name, program, options):
        _flow_add_step(self.state, _flow_step(kind, name, program, options or {}))
        return self


def flow(options: dict[str, Any] | None = None) -> AxFlow:
    return AxFlow(options)


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
def _program_descriptor(kind: str, id: str, metadata: Any) -> Any:
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


def _program_child_component_prefix(owner: str, node: str) -> str:
    path = _core_string_format("{}.{}::", owner, node)
    return path


def _program_prefix_component(component: Any, owner: str, node: str) -> Any:
    empty_map = {}
    child = _core_map_merge(empty_map, component)
    child_owner = _core_string_format("{}.{}", owner, node)
    child_id = _core_get(component, "id", "")
    prefixed_id = _core_string_format("{}::{}", child_owner, child_id)
    child["owner"] = child_owner
    child["id"] = prefixed_id
    return child


def _program_slice_component_map(component_map: Any, prefix: str) -> Any:
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


def _flow_factory(options: Any) -> Any:
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


def _flow_step(kind: str, name: str, program: Any, options: Any) -> Any:
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


def _flow_add_step(flow: Any, step: Any) -> Any:
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
    key = _core_json_stable_stringify(values)
    return key


def _flow_get_optimizable_components(flow: Any) -> list[Any]:
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
    components = _flow_get_optimizable_components(flow)
    snapshot = _optimization_component_current_map(components)
    return snapshot


def _flow_restore_components(flow: Any, snapshot: Any) -> Any:
    restored = _flow_apply_optimized_components(flow, snapshot)
    return restored


def _flow_evaluate_optimization(flow: Any, client: Any, dataset: Any, candidate_map: Any, options: Any) -> Any:
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


def _flow_cache_read_write(flow: Any, values: Any, options: Any, mode: str, cached_value: Any) -> Any:
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
    is_derive = _core_eq(kind, "derive")
    if is_derive:
        out[name] = result
    else:
        pass
    out = _core_map_update(out, result)
    _flow_record_child_chat_log(flow, name, program)
    _flow_record_child_usage(flow, name, program)
    _flow_record_child_traces(flow, name, program)
    return out


def _flow_execute_step(flow: Any, step: Any, plan_step: Any, client: Any, state: Any, options: Any) -> Any:
    empty_map = {}
    missing_step = _core_is_none(step)
    if missing_step:
        return state
    else:
        pass
    kind = _core_get(step, "kind", "execute")
    name = _core_get(step, "name", "")
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
            branch_value = _core_object_call_method(predicate, "call", state)
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
                condition_result = _core_object_call_method(condition, "call", current)
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
                condition_result = _core_object_call_method(condition, "call", current)
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
    program_out = _flow_execute_program_node(flow, step, client, state, options)
    return program_out


def _flow_merge_parallel_results(state: Any, result: Any) -> Any:
    merged = _core_map_merge(state, result)
    return merged


def _flow_execute_nested_steps(flow: Any, client: Any, steps: Any, state: Any, options: Any) -> Any:
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

# END AXIR CORE EMITTED FUNCTIONS
