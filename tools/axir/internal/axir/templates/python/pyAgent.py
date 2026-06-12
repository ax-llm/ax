from __future__ import annotations

from abc import ABC, abstractmethod
import copy
import json
import math
import re
from typing import Any

from .gen import (
    AxGen,
    _adjust_optimization_score_for_actions,
    _build_optimization_eval_result,
    _build_optimization_eval_row,
    _deserialize_optimized_artifact,
    _normalize_optimization_dataset,
    _normalize_optimization_metric_scores,
    _normalize_optimizer_engine_response,
    _optimization_component_current_map,
    _prepare_optimizer_run,
    _scalarize_optimization_scores,
    _validate_optimization_component_map,
    _validate_optimized_artifact,
)
from .signature import AxSignature, parse_signature
# AXIR_CORE_IMPORTS


class AxAgentClarificationError(RuntimeError):
    def __init__(self, clarification: Any, *, state: Any = None, payload: Any = None):
        if isinstance(clarification, dict):
            message = str(clarification.get("question") or clarification.get("message") or clarification)
        else:
            message = str(clarification)
        super().__init__(message)
        self.clarification = clarification
        self.state = state
        self.payload = payload


class AxCodeSession(ABC):
    @abstractmethod
    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        ...

    def inspect_globals(self, options: dict[str, Any] | None = None) -> Any:
        return "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]"

    def snapshot_globals(self, options: dict[str, Any] | None = None) -> Any:
        raise RuntimeError("AxCodeSession.snapshot_globals() is required to export AxAgent state")

    def patch_globals(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> Any:
        raise RuntimeError("AxCodeSession.patch_globals() is required to restore AxAgent state")

    def export_state(self, options: dict[str, Any] | None = None) -> Any:
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        return self.patch_globals(snapshot or {}, options or {})

    def close(self) -> Any:
        return {"closed": True}


class AxCodeRuntime(ABC):
    language = "JavaScript"

    def get_usage_instructions(self) -> str:
        return ""

    @abstractmethod
    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> AxCodeSession:
        ...


class OptimizerEngine(ABC):
    name = "host"
    version = "host"

    @abstractmethod
    def optimize(self, request: dict[str, Any], evaluator: "OptimizerEvaluator | None" = None) -> dict[str, Any]:
        ...


class OptimizerEvaluator(ABC):
    @abstractmethod
    def evaluate(self, candidate_map: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
        ...


def _call_optimizer_engine(engine: OptimizerEngine, request: dict[str, Any], evaluator: OptimizerEvaluator | None):
    try:
        return engine.optimize(request, evaluator)
    except TypeError as exc:
        if evaluator is None:
            raise
        try:
            return engine.optimize(request)
        except TypeError:
            raise exc


def _gepa_num(value, default=0.0):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(float(value)) else float(default)


def _gepa_int(value, default=0, minimum=None, maximum=None):
    out = int(math.floor(_gepa_num(value, default)))
    if minimum is not None:
        out = max(int(minimum), out)
    if maximum is not None:
        out = min(int(maximum), out)
    return out


def _gepa_current_map(components):
    return {
        str(component.get("id")): str(component.get("current", ""))
        for component in (components or [])
        if isinstance(component, dict) and component.get("id") is not None and isinstance(component.get("current", ""), str)
    }


def _gepa_avg_vec(rows):
    sums, counts = {}, {}
    for row in rows or []:
        for key, value in (row.get("scores") or {}).items():
            if isinstance(value, (int, float)) and math.isfinite(float(value)):
                sums[key] = sums.get(key, 0.0) + float(value)
                counts[key] = counts.get(key, 0) + 1
    return {key: sums[key] / max(counts.get(key, 1), 1) for key in sorted(sums)}


def _gepa_scalar(scores, options):
    key = (options or {}).get("paretoMetricKey") or (options or {}).get("pareto_metric_key")
    if key and isinstance(scores, dict):
        return _gepa_num(scores.get(key), 0)
    vals = [float(v) for v in (scores or {}).values() if isinstance(v, (int, float)) and math.isfinite(float(v))]
    return sum(vals) / len(vals) if vals else 0.0


def _gepa_dominates(a, b, eps=0.0):
    keys = set((a or {}).keys()) | set((b or {}).keys())
    at_least = True
    strict = False
    for key in keys:
        av = _gepa_num((a or {}).get(key), 0)
        bv = _gepa_num((b or {}).get(key), 0)
        if av + eps < bv:
            at_least = False
            break
        if av > bv + eps:
            strict = True
    return at_least and strict


def _gepa_pareto_front(candidates, eps=0.0):
    front = []
    for i, item in enumerate(candidates):
        dominated = False
        dominated_count = 0
        for j, other in enumerate(candidates):
            if i == j:
                continue
            if _gepa_dominates(other.get("scores") or {}, item.get("scores") or {}, eps):
                dominated = True
                break
            if _gepa_dominates(item.get("scores") or {}, other.get("scores") or {}, eps):
                dominated_count += 1
        if not dominated:
            front.append({"idx": i, "scores": copy.deepcopy(item.get("scores") or {}), "dominated": dominated_count})
    return front


def _gepa_hypervolume_2d(front_scores):
    if not front_scores:
        return None
    keys = list((front_scores[0] or {}).keys())
    if len(keys) != 2:
        return None
    k1, k2 = keys
    hv = 0.0
    prev_y = 0.0
    for point in sorted(front_scores, key=lambda item: _gepa_num(item.get(k1), 0), reverse=True):
        x = _gepa_num(point.get(k1), 0)
        y = _gepa_num(point.get(k2), 0)
        dy = max(y - prev_y, 0)
        hv += x * dy
        prev_y = max(prev_y, y)
    return hv


def _gepa_extract_text(response):
    if isinstance(response, dict):
        results = response.get("results") or []
        if results and isinstance(results[0], dict):
            content = results[0].get("content")
            if isinstance(content, str):
                text = content.strip()
                if text.startswith("New Value:"):
                    return text.split(":", 1)[1].strip()
                fence = "\x60\x60\x60"
                start = text.find(fence)
                end = text.rfind(fence)
                if start >= 0 and end > start:
                    inner = text[start + 3 : end].strip()
                    if "\n" in inner and inner.split("\n", 1)[0].strip().isidentifier():
                        inner = inner.split("\n", 1)[1]
                    return inner.strip()
                return text
    return ""


def _gepa_validate_component_value(component, value):
    if not isinstance(value, str) or not value.strip():
        return "component value must be a non-empty string"
    fmt = (component or {}).get("format")
    if fmt == "snake_case":
        import re

        if not re.match(r"^[a-z_][a-z0-9_]*$", value):
            return "must be snake_case"
    max_len = (component or {}).get("maxLength")
    if isinstance(max_len, (int, float)) and len(value) > int(max_len):
        return f"must be at most {int(max_len)} characters"
    for literal in (component or {}).get("preserve") or []:
        if str(literal) not in value:
            return f"must preserve {literal}"
    return True


def _gepa_option(options, *keys, default=None):
    for key in keys:
        if key in options and options.get(key) is not None:
            return options.get(key)
    return default


class AxBootstrapFewShot(OptimizerEngine):
    name = "BootstrapFewShot"
    version = "axir-bootstrap-fewshot-v1"

    def __init__(self, **options):
        self.options = dict(options or {})

    def optimize(self, request: dict[str, Any], evaluator: OptimizerEvaluator | None = None) -> dict[str, Any]:
        if evaluator is None:
            raise RuntimeError("AxBootstrapFewShot requires an OptimizerEvaluator")
        options = {**self.options, **((request or {}).get("options") or {})}
        components = [copy.deepcopy(c) for c in ((request or {}).get("components") or []) if isinstance(c, dict) and isinstance(c.get("current", ""), str)]
        dataset = (request or {}).get("dataset") or {}
        train = list(dataset.get("train") or [])
        threshold = _gepa_num(_gepa_option(options, "qualityThreshold", "quality_threshold", default=0.5), 0.5)
        max_rounds = _gepa_int(_gepa_option(options, "maxRounds", "max_rounds", default=3), 3, 1)
        max_examples = _gepa_int(_gepa_option(options, "maxExamples", "max_examples", default=16), 16, 1)
        max_demos = _gepa_int(_gepa_option(options, "maxDemos", "max_demos", default=4), 4, 1)
        batch_size = _gepa_int(_gepa_option(options, "batchSize", "batch_size", default=1), 1, 1)
        base_cfg = _gepa_current_map(components)
        demos = []
        accepted = set()
        total_calls = 0
        sampled = train[:max_examples]
        for round_index in range(max_rounds):
            if len(demos) >= max_demos:
                break
            for offset in range(0, len(sampled), batch_size):
                if len(demos) >= max_demos:
                    break
                for example in sampled[offset : offset + batch_size]:
                    if len(demos) >= max_demos:
                        break
                    example_key = json.dumps(example, sort_keys=True, default=str)
                    if example_key in accepted:
                        continue
                    result = evaluator.evaluate(dict(base_cfg), {"dataset": {"train": [example], "validation": []}, "phase": "bootstrap", "round": round_index})
                    rows = list((result or {}).get("rows") or [])
                    total_calls += int((result or {}).get("count", len(rows) or 1))
                    if not rows:
                        continue
                    row = rows[0]
                    if _gepa_num(row.get("scalar"), 0) >= threshold:
                        accepted.add(example_key)
                        demos.append({"programId": "root", "traces": [copy.deepcopy(row.get("prediction", row.get("input", {})))]})
        return {
            "artifactVersion": "axir-optimized-artifact-v1",
            "optimizerName": self.name,
            "optimizerVersion": self.version,
            "componentMap": {},
            "demos": demos,
            "metadata": {
                "optimizer": self.name,
                "qualityThreshold": threshold,
                "totalMetricCalls": total_calls,
                "demosGenerated": len(demos),
            },
            "evidence": {"count": total_calls},
            "provenance": {"sourceProgramKind": (request or {}).get("programKind", "unknown")},
        }


class AxGEPA(OptimizerEngine):
    name = "GEPA"
    version = "axir-gepa-v1"

    def __init__(self, reflection_client=None, **options):
        self.reflection_client = reflection_client
        self.options = dict(options or {})
        self.rng_state = _gepa_int(self.options.get("seed"), 123456789) or 123456789
        self.selector_state = {}
        self.feedback_memory = []

    def _rand(self):
        self.rng_state ^= (self.rng_state << 13) & 0xFFFFFFFF
        self.rng_state ^= (self.rng_state >> 17) & 0xFFFFFFFF
        self.rng_state ^= (self.rng_state << 5) & 0xFFFFFFFF
        self.rng_state &= 0xFFFFFFFF
        return self.rng_state / 4294967296.0

    def _selector_init(self, components, initial=None):
        self.selector_state = {}
        initial = initial or {}
        for component in components:
            cid = component.get("id")
            old = initial.get(cid) if isinstance(initial, dict) else {}
            self.selector_state[cid] = {
                "proposals": max(0, int(old.get("proposals", 0) if isinstance(old, dict) else 0)),
                "accepts": max(0, int(old.get("accepts", 0) if isinstance(old, dict) else 0)),
                "lastAcceptIter": int(old.get("lastAcceptIter", -1) if isinstance(old, dict) else -1),
                "stagnation": max(0, int(old.get("stagnation", 0) if isinstance(old, dict) else 0)),
            }

    def _pick_component(self, components, iteration):
        if len(components) == 1:
            return components[0]
        if self._rand() < 0.1:
            return components[min(len(components) - 1, int(self._rand() * len(components)))]
        total_props = max(1, sum(state["proposals"] for state in self.selector_state.values()))
        weights = []
        for component in components:
            state = self.selector_state[component["id"]]
            accept_rate = 0 if state["proposals"] == 0 else state["accepts"] / state["proposals"]
            pressure = state["proposals"] / total_props
            stale = min(iteration + 1, 10) if state["lastAcceptIter"] < 0 else min(iteration - state["lastAcceptIter"], 10)
            weights.append(1.4 * (1 - accept_rate) + 0.8 * state["stagnation"] + 0.2 * stale - 0.7 * pressure)
        max_w = max(weights)
        exp = [math.exp(w - max_w) for w in weights]
        threshold = self._rand() * sum(exp)
        for component, weight in zip(components, exp):
            threshold -= weight
            if threshold <= 0:
                return component
        return components[-1]

    def _record_proposal(self, cid):
        if cid in self.selector_state:
            self.selector_state[cid]["proposals"] += 1

    def _record_result(self, cid, accepted, iteration):
        if cid not in self.selector_state:
            return
        state = self.selector_state[cid]
        if accepted:
            state["accepts"] += 1
            state["lastAcceptIter"] = iteration
            state["stagnation"] = 0
        else:
            state["stagnation"] += 1

    def _component_group(self, component, components):
        by_id = {item.get("id"): item for item in components}
        out = []
        seen = set()

        def visit(cid):
            if cid in seen or cid not in by_id:
                return
            seen.add(cid)
            item = by_id[cid]
            out.append(item)
            for dep in item.get("dependsOn") or item.get("depends_on") or []:
                visit(dep)

        visit(component.get("id"))
        return out

    def _dataset_for(self, examples):
        return {"train": list(examples or []), "validation": []}

    def _evaluate(self, evaluator, cfg, examples, phase, max_calls, total_calls, throw=False, capture_traces=False):
        needed = len(examples or [])
        if total_calls + needed > max_calls:
            if throw:
                raise RuntimeError(f"AxGEPA: options.maxMetricCalls={max_calls} is too small to evaluate the initial Pareto set; need at least {needed} metric calls")
            return None, total_calls
        result = evaluator.evaluate(dict(cfg), {"dataset": self._dataset_for(examples), "phase": phase, "captureTraces": capture_traces})
        rows = list((result or {}).get("rows") or [])
        scalars = [_gepa_num(row.get("scalar"), 0) for row in rows]
        out = {
            "rows": rows,
            "avgScores": _gepa_avg_vec(rows),
            "avg": _gepa_num((result or {}).get("avg"), sum(scalars) / len(scalars) if scalars else 0),
            "sum": _gepa_num((result or {}).get("sum"), sum(scalars)),
            "count": int((result or {}).get("count", len(rows))),
            "scalars": scalars,
            "candidateMap": dict(cfg),
        }
        return out, total_calls + out["count"]

    def _reflect(self, component, current, tuples, trace_dataset, options):
        if self.reflection_client is None:
            raise RuntimeError("AxGEPA requires a reflection_client for reflective trials")
        attempts = max(1, _gepa_int(_gepa_option(options, "maxReflectionAttempts", "max_reflection_attempts", default=2), 2))
        previous_error = None
        for _ in range(attempts):
            prompt = {
                "chatPrompt": [
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "componentKey": component.get("id"),
                                "componentKind": component.get("kind"),
                                "currentValue": current,
                                "previousValidationError": previous_error,
                                "minibatch": tuples,
                                "traceDataset": trace_dataset,
                            },
                            sort_keys=True,
                        ),
                    }
                ],
                "model": _gepa_option(options, "reflectionModel", "reflection_model"),
            }
            response = self.reflection_client.chat(prompt, {"stream": False})
            candidate = _gepa_extract_text(response).strip()
            validation = _gepa_validate_component_value(component, candidate)
            if validation is True:
                return candidate
            previous_error = validation
        return current

    def _next_minibatch(self, train, iteration, size):
        if not train:
            return []
        if size <= 0 or size >= len(train):
            return list(train)
        start = (iteration * size) % len(train)
        out = []
        for i in range(size):
            out.append(train[(start + i) % len(train)])
        return out

    def _bootstrap(self, evaluator, base_cfg, train, options, total_calls, max_calls):
        raw = options.get("bootstrap")
        if not raw:
            return [], total_calls
        opts = raw if isinstance(raw, dict) else {}
        threshold = _gepa_num(_gepa_option(opts, "scoreThreshold", "score_threshold", default=0.8), 0.8)
        max_demos = _gepa_int(_gepa_option(opts, "maxBootstrapDemos", "max_bootstrap_demos", default=4), 4, 1)
        max_boot_calls = _gepa_int(_gepa_option(opts, "maxBootstrapMetricCalls", "max_bootstrap_metric_calls", default=min(len(train), 8) or 1), min(len(train), 8) or 1, 1)
        demos = []
        calls = 0
        for example in train:
            if calls >= max_boot_calls or len(demos) >= max_demos:
                break
            result, total_calls = self._evaluate(evaluator, base_cfg, [example], "bootstrap", max_calls, total_calls)
            calls += 1
            if not result or not result["rows"]:
                continue
            row = result["rows"][0]
            if _gepa_num(row.get("scalar"), 0) >= threshold:
                demos.append({"programId": "root", "traces": [copy.deepcopy(row.get("prediction", row.get("input", {})))]})
        return demos, total_calls

    def optimize(self, request: dict[str, Any], evaluator: OptimizerEvaluator | None = None) -> dict[str, Any]:
        if evaluator is None:
            raise RuntimeError("AxGEPA requires an OptimizerEvaluator")
        options = {**self.options, **((request or {}).get("options") or {})}
        components = [copy.deepcopy(c) for c in ((request or {}).get("components") or []) if isinstance(c, dict) and isinstance(c.get("current", ""), str)]
        if not components:
            raise RuntimeError("AxGEPA: program exposes no optimizable components")
        dataset = (request or {}).get("dataset") or {}
        train = list(dataset.get("train") or [])
        validation = list(dataset.get("validation") or []) or train
        max_calls = _gepa_int(_gepa_option(options, "maxMetricCalls", "max_metric_calls", default=0), 0)
        if max_calls <= 0:
            raise RuntimeError("AxGEPA: options.maxMetricCalls must be set to a positive integer")
        num_trials = _gepa_int(_gepa_option(options, "numTrials", "num_trials", default=30), 30, 0)
        minibatch = options.get("minibatch", True) is not False
        minibatch_size = _gepa_int(_gepa_option(options, "minibatchSize", "minibatch_size", default=20), 20, 1)
        early_stop = _gepa_int(_gepa_option(options, "earlyStoppingTrials", "early_stopping_trials", default=5), 5, 1)
        min_improvement = _gepa_num(_gepa_option(options, "minImprovementThreshold", "min_improvement_threshold", default=0), 0)
        pareto_size = _gepa_int(_gepa_option(options, "paretoSetSize", "pareto_set_size", default=max(10, min(200, minibatch_size * 3))), max(10, min(200, minibatch_size * 3)), 1, 1000)
        tie_eps = _gepa_num(_gepa_option(options, "tieEpsilon", "tie_epsilon", default=0), 0)
        base_cfg = _gepa_current_map(components)
        pareto_set = validation[:pareto_size]
        self._selector_init(components, _gepa_option(options, "selectorState", "selector_state"))
        total_calls = 0
        demos, total_calls = self._bootstrap(evaluator, base_cfg, train, options, total_calls, max_calls)
        base_eval, total_calls = self._evaluate(evaluator, base_cfg, pareto_set, "initial Pareto evaluation", max_calls, total_calls, True)
        candidates = [{"cfg": dict(base_cfg), "scores": base_eval["avgScores"] or {"score": base_eval["avg"]}, "parent": None}]
        per_instance = [base_eval["scalars"]]
        stagnation = 0
        for iteration in range(num_trials):
            if total_calls >= max_calls:
                break
            parent_idx = max(range(len(candidates)), key=lambda idx: sum(per_instance[idx]) / max(len(per_instance[idx]), 1))
            mini = self._next_minibatch(train, iteration, minibatch_size) if minibatch else train
            parent_eval, total_calls = self._evaluate(evaluator, candidates[parent_idx]["cfg"], mini, "parent minibatch", max_calls, total_calls, False, True)
            if parent_eval is None:
                break
            perfect = _gepa_num(_gepa_option(options, "perfectScore", "perfect_score", default=1), 1)
            if _gepa_option(options, "skipPerfectScore", "skip_perfect_score", default=True) is not False and parent_eval["scalars"] and all(score >= perfect for score in parent_eval["scalars"]):
                continue
            target = self._pick_component(components, iteration)
            group = self._component_group(target, components)
            proposed = dict(candidates[parent_idx]["cfg"])
            rows = parent_eval["rows"]
            tuples = [{"input": row.get("input"), "prediction": row.get("prediction"), "score": row.get("scalar", 0)} for row in rows]
            for component in group:
                self._record_proposal(component["id"])
                current = proposed.get(component["id"], "")
                trace_dataset = [{"score": row.get("scalar", 0), "trace": row.get("trace"), "output": row.get("prediction")} for row in rows]
                proposed[component["id"]] = self._reflect(component, current, tuples, trace_dataset, options)
            child_mini, total_calls = self._evaluate(evaluator, proposed, mini, "child minibatch", max_calls, total_calls)
            if child_mini is None:
                break
            accepted = child_mini["sum"] > parent_eval["sum"] + min_improvement
            for component in group:
                self._record_result(component["id"], accepted, iteration)
            if not accepted:
                stagnation += 1
                if stagnation >= early_stop:
                    break
                continue
            child_eval, total_calls = self._evaluate(evaluator, proposed, pareto_set, "validation evaluation", max_calls, total_calls)
            if child_eval is None:
                break
            candidates.append({"cfg": dict(proposed), "scores": child_eval["avgScores"] or {"score": child_eval["avg"]}, "parent": parent_idx})
            per_instance.append(child_eval["scalars"])
            stagnation = 0
        front = _gepa_pareto_front(candidates, tie_eps)
        best_idx = front[0]["idx"] if front else 0
        best_score = -1e100
        for item in front:
            score = _gepa_scalar(item["scores"], options)
            if score > best_score:
                best_score = score
                best_idx = item["idx"]
        best_cfg = dict(candidates[best_idx]["cfg"])
        owners = {component["id"]: component.get("owner", component.get("id", "").split("::", 1)[0]) for component in components}
        pareto_meta = [
            {"candidate": item["idx"], "scores": item["scores"], "dominatedSolutions": item["dominated"], "componentMap": candidates[item["idx"]]["cfg"]}
            for item in front
        ]
        hv = _gepa_hypervolume_2d([item["scores"] for item in front])
        return {
            "artifactVersion": "axir-optimized-artifact-v1",
            "optimizerName": "GEPA",
            "optimizerVersion": self.version,
            "componentMap": best_cfg,
            "demos": demos,
            "metadata": {
                "optimizer": "GEPA",
                "selectorState": copy.deepcopy(self.selector_state),
                "paretoFront": pareto_meta,
                "bestScore": 0 if best_score == -1e100 else best_score,
                "totalMetricCalls": total_calls,
                "candidatesExplored": len(candidates),
                "report": {
                    "summary": "GEPA Multi-Objective Optimization Complete",
                    "statistics": {"totalEvaluations": total_calls, "candidatesExplored": len(candidates), "converged": True},
                    "paretoFrontier": {"solutionCount": len(front), "hypervolume": hv or 0},
                },
            },
            "evidence": {"avg": 0 if best_score == -1e100 else best_score, "count": len(pareto_set), "totalMetricCalls": total_calls},
            "provenance": {"sourceProgramKind": (request or {}).get("programKind", "unknown"), "componentOwners": owners},
        }


def _optimize_option(options, *keys, default=None):
    for key in keys:
        if key in options and options.get(key) is not None:
            return options.get(key)
    return default


def optimize(program, examples, options: dict[str, Any] | None = None):
    opts = dict(options or {})
    student = _optimize_option(opts, "studentAI", "student_ai", "student", "client", "ai")
    if student is None:
        raise ValueError("optimize() requires studentAI or client")
    teacher = _optimize_option(opts, "teacherAI", "teacher_ai", "teacher", "reflectionAI", "reflection_ai", "reflection_client", default=student)
    max_metric_calls = _gepa_int(_optimize_option(opts, "maxMetricCalls", "max_metric_calls", default=100), 100, 1)
    bootstrap_setting = opts.get("bootstrap") if "bootstrap" in opts else (len(examples or []) <= 8)
    demos = []
    if bootstrap_setting is not False:
        bootstrap_options = dict(opts)
        if isinstance(bootstrap_setting, dict):
            bootstrap_options.update(bootstrap_setting)
        bootstrap_options["client"] = teacher or student
        bootstrap_options["apply"] = False
        bootstrap = AxBootstrapFewShot(**bootstrap_options)
        bootstrap_artifact = program.optimize_with(bootstrap, examples or [], bootstrap_options)
        demos = list((bootstrap_artifact or {}).get("demos") or [])
        if demos and hasattr(program, "set_demos"):
            program.set_demos(demos)
    gepa_options = dict(opts)
    gepa_options["bootstrap"] = False
    gepa_options["maxMetricCalls"] = max_metric_calls
    gepa_options["client"] = student
    gepa_options["apply"] = False
    engine = AxGEPA(teacher, **gepa_options)
    artifact = program.optimize_with(engine, examples or [], gepa_options)
    if demos:
        artifact["demos"] = demos
    return artifact


def _score_optimization_prediction(task, prediction, options):
    opts = options or {}
    if "metric_score" in task:
        raw_scores = task.get("metric_score")
    elif "scores" in task:
        raw_scores = task.get("scores")
    elif "score" in task:
        raw_scores = task.get("score")
    elif _core_get(prediction, "completionType") == "error":
        raw_scores = 0
    else:
        raw_scores = 1
    scores = _normalize_optimization_metric_scores(raw_scores)
    scalar = _scalarize_optimization_scores(scores, opts)
    scalar = _adjust_optimization_score_for_actions(scalar, task or {}, prediction or {})
    return scores, scalar


class AxAgent:
    def __init__(self, signature, options: dict[str, Any] | None = None):
        self.options = dict(options or {})
        self.state = _agent_factory(signature, self.options)
        self.signature = _core_get(self.state, "signature")
        self.distiller = AxGen(_core_get(self.state, "distiller_signature"), {"validation_retries": 0, "id": "ctx.root.actor"})
        self.executor = AxGen(_core_get(self.state, "executor_signature"), {"validation_retries": 0, "id": "task.root.actor"})
        self.responder = AxGen(self.signature, {"validation_retries": self.options.get("validation_retries", 2), "id": "task.root.responder"})

    def forward(self, client, values: dict[str, Any], options: dict[str, Any] | None = None):
        return _agent_forward(
            self.state,
            self.distiller,
            self.executor,
            self.responder,
            client,
            values or {},
            options or {},
        )

    def test(self, runtime: AxCodeRuntime, code: str, context_field_values: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        return _agent_runtime_test(
            self.state,
            runtime,
            code,
            context_field_values or {},
            options or {},
        )

    def execute_actor_step(self, runtime: AxCodeRuntime, code: str, values: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        _agent_runtime_build_globals(self.state, values or {})
        session = _core_get(self.state, "runtime_session")
        return _agent_runtime_execute_step(self.state, runtime, session, code, options or {})

    def inspect_runtime(self, options: dict[str, Any] | None = None):
        return _agent_runtime_inspect_state(self.state, _core_get(self.state, "runtime_session"), options or {})

    def export_session_state(self, options: dict[str, Any] | None = None):
        return _agent_runtime_export_session_state(self.state, _core_get(self.state, "runtime_session"), options or {})

    def restore_session_state(self, snapshot: Any, options: dict[str, Any] | None = None):
        return _agent_runtime_restore_session_state(self.state, _core_get(self.state, "runtime_session"), snapshot or {}, options or {})

    def close_runtime_session(self):
        return _agent_runtime_close_session(self.state, _core_get(self.state, "runtime_session"))

    def get_state(self):
        return _agent_get_state(self.state)

    def set_state(self, state):
        return _agent_set_state(self.state, state or {})

    def get_chat_log(self):
        return list(_core_get(self.state, "chat_log", []) or [])

    def get_action_log(self):
        return list(_core_get(self.state, "action_log", []) or [])

    def get_trace(self):
        return _agent_export_trace(self.state)

    def export_trace(self):
        return _agent_export_trace(self.state)

    def replay_trace(self, trace, fixtures: dict[str, Any] | None = None):
        return _agent_replay_trace(trace or {}, fixtures or {})

    def get_usage(self):
        return dict(_core_get(self.state, "usage", {}) or {})

    def get_runtime_contract(self):
        return dict(_core_get(self.state, "runtime_contract", {}) or {})

    def get_policy(self):
        return dict(_core_get(self.state, "policy", {}) or {})

    def get_policy_registry(self):
        return dict(_core_get(self.state, "policy_registry", {}) or {})

    def get_callable_inventory(self):
        return list(_core_get(self.state, "callable_inventory", []) or [])

    def get_discovery_catalog(self):
        return list(_core_get(self.state, "discovery_catalog", []) or [])

    def discover(self, request):
        return _agent_discover(self.state, request or {})

    def recall(self, request):
        return _agent_recall(self.state, request or [])

    def used(self, id, reason: str | None = None, stage: str = "executor"):
        return _agent_used(self.state, {"id": id, "reason": reason or "", "stage": stage}, stage)

    def invoke_callable(self, qualified_name: str, args: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        return _agent_execute_callable(self.state, {"qualified_name": qualified_name, "args": args or {}}, options or {})

    def export_runtime_state(self):
        return _agent_export_runtime_state(self.state)

    def restore_runtime_state(self, snapshot):
        return _agent_restore_runtime_state(self.state, snapshot or {})

    def get_optimizer_metadata(self):
        return _agent_optimizer_metadata(self.state)

    def get_optimizable_components(self):
        components = []
        components.extend(self.distiller.get_optimizable_components())
        components.extend(self.executor.get_optimizable_components())
        components.extend(self.responder.get_optimizable_components())
        runtime = self.get_runtime_contract()
        policy = self.get_policy()
        components.append(_optimization_component(
            "root.agent.runtime",
            "root.agent",
            "runtime-policy",
            runtime,
            "Agent runtime-language metadata and code-field policy.",
            ["Keep code field names aligned with the selected runtime language."],
            [],
            True,
            "json",
            {"component": "runtime_contract"},
        ))
        components.append(_optimization_component(
            "root.agent.policy",
            "root.agent",
            "agent-policy",
            policy,
            "Actor primitive, discovery, delegation, and prompt placement policy.",
            ["Do not expose protocol-only actions as actor primitives."],
            ["root.agent.runtime"],
            True,
            "json",
            {"component": "policy_registry"},
        ))
        return components

    def apply_optimized_components(self, component_map: dict[str, Any]):
        updates = dict(component_map or {})
        _validate_optimization_component_map(self.get_optimizable_components(), updates)
        self.distiller.apply_optimized_components(updates)
        self.executor.apply_optimized_components(updates)
        self.responder.apply_optimized_components(updates)
        if "root.agent.runtime" in updates and isinstance(updates["root.agent.runtime"], dict):
            self.state["runtime_contract"] = updates["root.agent.runtime"]
        if "root.agent.policy" in updates and isinstance(updates["root.agent.policy"], dict):
            self.state["policy"] = updates["root.agent.policy"]
        self.state["optimizer_metadata"] = _agent_optimizer_metadata(self.state)
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

    def evaluate_optimization_task(self, client, task: dict[str, Any], options: dict[str, Any] | None = None):
        opts = options or {}
        try:
            output = self.forward(client, task.get("input") or task, opts.get("forward_options") or {})
            return _build_agent_eval_prediction(output, self.get_action_log(), self.get_usage(), self.export_trace())
        except AxAgentClarificationError as exc:
            return {
                "completionType": "askClarification",
                "clarification": exc.clarification,
                "actionLog": self.get_action_log(),
                "functionCalls": _core_get(self.state, "function_call_traces", []) or [],
                "toolErrors": [],
                "turnCount": 0,
                "usage": self.get_usage(),
                "trace": self.export_trace(),
            }
        except Exception as exc:
            return {
                "completionType": "error",
                "error": {"message": str(exc)},
                "actionLog": self.get_action_log(),
                "functionCalls": _core_get(self.state, "function_call_traces", []) or [],
                "toolErrors": [str(exc)],
                "turnCount": 0,
                "usage": self.get_usage(),
                "trace": self.export_trace(),
            }

    def evaluate_optimization(self, client, dataset, candidate_map: dict[str, Any] | None = None, options: dict[str, Any] | None = None):
        opts = options or {}
        normalized = _normalize_optimization_dataset(dataset or [])
        rows = []
        original = _optimization_component_current_map(self.get_optimizable_components())
        candidate = dict(candidate_map or {})
        phase = opts.get("phase", "train")
        max_metric_calls = int(opts.get("maxMetricCalls", opts.get("max_metric_calls", 10**9)))
        calls = 0
        try:
            if candidate:
                self.apply_optimized_components(candidate)
            for task in normalized.get("train", []) or []:
                if calls >= max_metric_calls:
                    raise RuntimeError(f"max metric calls exceeded: {max_metric_calls}")
                calls += 1
                prediction = self.evaluate_optimization_task(client, task if isinstance(task, dict) else {"input": task}, opts)
                error = prediction.get("error") if isinstance(prediction, dict) else None
                scores, scalar = _score_optimization_prediction(task if isinstance(task, dict) else {}, prediction, opts)
                rows.append(_build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), error))
            return _build_optimization_eval_result(rows, candidate, phase)
        finally:
            self.apply_optimized_components(original)

    def optimize_with(self, engine: OptimizerEngine, dataset, options: dict[str, Any] | None = None):
        opts = options or {}
        components = self.get_optimizable_components()
        client = opts.get("client") or opts.get("ai")
        run = _prepare_optimizer_run("axagent", components, dataset or [], opts, self.export_trace(), client is not None)
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


def agent(signature, config: dict[str, Any] | None = None) -> AxAgent:
    return AxAgent(signature, config)


def _parse_signature(signature):
    return AxSignature(signature)


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_truthy(value): return bool(value)
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_lt(left, right): return left < right
def _core_lte(left, right): return left <= right
def _core_gt(left, right): return left > right
def _core_gte(left, right): return left >= right
def _core_add(left, right): return left + right
def _core_mul(left, right): return float(left or 0) * float(right or 0)
def _core_div(left, right): return float(left or 0) / float(right or 1)
def _core_len(value): return len(value or [])
def _core_contains(container, item): return False if container is None else item in container
def _core_is_none(value): return value is None
def _core_is_not_none(value): return value is not None
def _core_none(): return None


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


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
    out = dict(left or {})
    out.update(right or {})
    return out


def _core_map_delete(target, key):
    if isinstance(target, dict):
        target.pop(key, None)
    return target


def _core_map_contains(target, key):
    return isinstance(target, dict) and key in target


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
    return []


def _core_list_get(values, index, default=None):
    return values[index] if isinstance(values, list) and 0 <= int(index) < len(values) else default


def _core_json_stringify(value):
    import json
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _core_json_stable_stringify(value):
    import json
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _core_json_parse(value):
    return json.loads(value)


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_slice(value, start, end=None):
    text = str(value)
    s = max(0, min(len(text), int(start)))
    if end is None:
        return text[s:]
    e = max(s, min(len(text), int(end)))
    return text[s:e]


def _core_regex_replace(pattern, repl, value):
    return re.sub(str(pattern), str(repl), str(value))


def _core_regex_match(pattern, value):
    return isinstance(value, str) and re.search(str(pattern), value) is not None


def _core_string_words(value):
    return str(value).split()


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in (values or []))


def _core_string_split_trim_nonempty(value, sep):
    return [part.strip() for part in str(value).split(str(sep)) if part.strip()]


def _core_string_starts_with(value, prefix):
    return str(value).startswith(str(prefix))


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_lower(value):
    return str(value).lower()


def _core_string_lower_camel(words):
    items = [str(item) for item in (words or []) if str(item)]
    if not items:
        return ""
    first, rest = items[0].lower(), items[1:]
    return first + "".join(item.lower().capitalize() for item in rest)


def _core_string_title_from_camel(value):
    text = re.sub(r"Code$", " Code", str(value))
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text).strip()
    return text[:1].upper() + text[1:]


def _core_runtime_error(message):
    return RuntimeError(str(message))


def _core_json_pretty(value):
    return json.dumps(value, indent=2)


def _core_agent_stage_forward(stage, client, values, options):
    return stage.forward(client, values or {}, options or {})


def _core_agent_stage_chat_log(stage):
    if hasattr(stage, "get_chat_log"):
        return stage.get_chat_log()
    return []


def _core_agent_stage_usage(stage):
    if hasattr(stage, "get_usage"):
        usage = stage.get_usage()
        if usage:
            return usage
    if hasattr(stage, "get_chat_log"):
        items = []
        for entry in stage.get_chat_log() or []:
            usage = _core_get(entry, "usage")
            if usage:
                items.append(usage)
        return items
    return []


def _core_agent_stage_traces(stage):
    if hasattr(stage, "get_traces"):
        return stage.get_traces()
    return []


def _core_agent_clarification_error(payload, state):
    args = _core_get(payload, "args", []) or []
    clarification = args[0] if args else payload
    return AxAgentClarificationError(
        clarification,
        state=_core_get(state, "runtime_state", {}),
        payload=payload,
    )


def _core_agent_runtime_create_session(runtime, globals_, options):
    if not hasattr(runtime, "create_session"):
        raise RuntimeError("agent runtime does not implement AxCodeRuntime")
    session = runtime.create_session(globals_ or {}, options or {})
    if session is None:
        raise RuntimeError("agent runtime returned no session")
    return session


def _core_agent_runtime_execute(session, code, options):
    if not hasattr(session, "execute"):
        raise RuntimeError("agent code session is not active")
    return session.execute(str(code), options or {})


def _core_agent_runtime_inspect(session, options):
    if hasattr(session, "inspect_globals"):
        return session.inspect_globals(options or {})
    if hasattr(session, "inspect"):
        return session.inspect(options or {})
    return "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]"


def _core_agent_runtime_export_state(session, options):
    if hasattr(session, "snapshot_globals") and type(session).snapshot_globals is not AxCodeSession.snapshot_globals:
        return session.snapshot_globals(options or {})
    if hasattr(session, "export_state") and type(session).export_state is not AxCodeSession.export_state:
        return session.export_state(options or {})
    raise RuntimeError("AxCodeSession.snapshot_globals() is required to export AxAgent state")


def _core_agent_runtime_restore_state(session, snapshot, options):
    if hasattr(session, "patch_globals") and type(session).patch_globals is not AxCodeSession.patch_globals:
        return session.patch_globals(snapshot or {}, options or {})
    if hasattr(session, "restore_state") and type(session).restore_state is not AxCodeSession.restore_state:
        return session.restore_state(snapshot or {}, options or {})
    raise RuntimeError("AxCodeSession.patch_globals() is required to restore AxAgent state")


def _core_agent_runtime_close(session):
    if hasattr(session, "close"):
        result = session.close()
        return {"closed": True} if result is None else result
    return {"closed": True}


def _core_agent_memory_search(state, searches, already_loaded):
    options = _core_get(state, "options", {}) or {}
    callback = options.get("on_memories_search") or options.get("onMemoriesSearch")
    if callable(callback):
        return callback(list(searches or []), list(already_loaded or [])) or []
    scripted = options.get("memory_search_results") or options.get("memorySearchResults") or {}
    if isinstance(scripted, dict):
        joined = "|".join(str(item) for item in (searches or []))
        if joined in scripted:
            return copy.deepcopy(scripted[joined])
        for item in searches or []:
            if str(item) in scripted:
                return copy.deepcopy(scripted[str(item)])
        return copy.deepcopy(scripted.get("*", []))
    if isinstance(scripted, list):
        return copy.deepcopy(scripted)
    return []


def _core_agent_skill_search(state, searches):
    options = _core_get(state, "options", {}) or {}
    callback = options.get("on_skills_search") or options.get("onSkillsSearch")
    if callable(callback):
        return callback(list(searches or [])) or []
    scripted = options.get("skill_search_results") or options.get("skillSearchResults") or {}
    if isinstance(scripted, dict):
        joined = "|".join(str(item) for item in (searches or []))
        if joined in scripted:
            return copy.deepcopy(scripted[joined])
        out = []
        for item in searches or []:
            out.extend(copy.deepcopy(scripted.get(str(item), [])))
        if out:
            return out
        return copy.deepcopy(scripted.get("*", []))
    if isinstance(scripted, list):
        return copy.deepcopy(scripted)
    return []


def _core_agent_callable_invoke(state, request, options):
    agent_options = _core_get(state, "options", {}) or {}
    qualified = _core_get(request, "qualified_name", _core_get(request, "name", ""))
    args = _core_get(request, "args", {})
    for group in _core_get(state, "callable_inventory", []) or []:
        for callable_meta in _core_get(group, "callables", []) or []:
            if _core_get(callable_meta, "qualified_name") == qualified:
                handler = _core_get(callable_meta, "handler")
                if callable(handler):
                    return {"status": "ok", "value": handler(args)}
    scripted = agent_options.get("callable_results") or agent_options.get("callableResults") or {}
    if isinstance(scripted, dict):
        result = scripted.get(qualified, scripted.get(_core_get(request, "name", ""), scripted.get("*")))
        if result is not None:
            copied = copy.deepcopy(result)
            if isinstance(copied, dict) and copied.get("error"):
                return {"status": "error", "error": copied.get("error")}
            if isinstance(copied, dict):
                copied.setdefault("status", "ok")
                return copied
            return {"status": "ok", "value": copied}
    return {"status": "error", "error": f"unknown callable: {qualified}"}


# AXIR_CORE_AGENT_FUNCTIONS
