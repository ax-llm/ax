from __future__ import annotations
import os

from abc import ABC, abstractmethod
import copy
import json
import math
import re
from typing import Any

from .gen import (
    AxGen,
    _core_ai_complete_once,
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
from .prompt import (
    render_template_content,
)


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
        self.distiller = AxGen(_core_get(self.state, "distiller_signature"), {"validation_retries": 0, "id": "ctx.root.actor", "instruction": _core_get(self.state, "distiller_description", "")})
        self.executor = AxGen(_core_get(self.state, "executor_signature"), {"validation_retries": 0, "id": "task.root.actor", "instruction": _core_get(self.state, "executor_description", "")})
        self.responder = AxGen(_core_get(self.state, "responder_signature", self.signature), {"validation_retries": self.options.get("validation_retries", 2), "id": "task.root.responder", "instruction": _core_get(self.state, "responder_description", "")})
        self.llm_query = AxGen(_core_get(self.state, "llm_query_signature", "task:string, context:json -> answer:string"), {"validation_retries": 1, "id": "rlm.llmquery", "instruction": _core_get(self.state, "llm_query_description", "")})

    def forward(self, client, values: dict[str, Any], options: dict[str, Any] | None = None):
        options = options or {}
        runtime = options.get("runtime")
        if runtime is None:
            runtime = self.options.get("runtime")
        # Wire the built-in llmQuery primitive: a focused sub-query the model can
        # await inside the runtime. The logic lives in the AxIR-generated helper;
        # this wrapper only registers the host callable that closes over this client.
        if runtime is not None and hasattr(runtime, "register_callable"):
            runtime.register_callable("llmQuery", lambda params: _agent_run_llm_query(self.llm_query, client, params))
        return _agent_forward(
            self.state,
            self.distiller,
            self.executor,
            self.responder,
            client,
            values or {},
            options,
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


def _core_string_replace(value, old, new):
    return str(value).replace(str(old), str(new))


def _core_string_split_once(value, sep):
    text = str(value)
    if sep in text:
        left, right = text.split(sep, 1)
        return {"left": left, "right": right, "found": True}
    return {"left": text, "right": "", "found": False}


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


def _core_agent_transcribe(client, request, options):
    # Backs intrinsic.agent.transcribe: call the AI client's transcribe so audio inputs become
    # text before the agent loop. Any client exposing transcribe satisfies it (real providers +
    # the scripted conformance client), mirroring the other host AI boundary calls.
    if client is None or not hasattr(client, "transcribe"):
        return {"text": ""}
    return client.transcribe(request, options or {})


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


# BEGIN AXIR CORE EMITTED FUNCTIONS
def _agent_factory(signature: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_factory")
    empty_list = []
    empty_map = {}
    sig = signature
    is_string = _core_type_is(signature, "string")
    if is_string:
        parsed_sig = parse_signature(signature)
        sig = parsed_sig
    else:
        sig = signature
    context_camel = _core_get(options, "contextFields", empty_list)
    context_fields = _core_get(options, "context_fields", context_camel)
    executor_options = _core_get(options, "executor_options", empty_map)
    executor_options_camel = _core_get(options, "executorOptions", executor_options)
    responder_options = _core_get(options, "responder_options", empty_map)
    responder_options_camel = _core_get(options, "responderOptions", responder_options)
    executor_exclude_camel = _core_get(executor_options_camel, "excludeFields", empty_list)
    executor_exclude = _core_get(executor_options_camel, "exclude_fields", executor_exclude_camel)
    responder_exclude_camel = _core_get(responder_options_camel, "excludeFields", empty_list)
    responder_exclude = _core_get(responder_options_camel, "exclude_fields", responder_exclude_camel)
    input_fields = _core_get(sig, "input_fields", empty_list)
    for ctx in context_fields:
        found = False
        for field in input_fields:
            field_name = _core_get(field, "name", None)
            matches = _core_eq(field_name, ctx)
            if matches:
                found = True
            else:
                pass
        missing = _core_not(found)
        if missing:
            message = _core_string_format("context field not found: {}", ctx)
            error = _core_runtime_error(message)
            raise error
        else:
            pass
    chat_log = []
    usage = {}
    state_alpha = {}
    action_log = []
    status_log = []
    state = {}
    runtime_contract = _normalize_agent_runtime(options)
    has_runtime_direct = _core_map_contains(options, "runtime")
    has_runtime_config = _core_map_contains(options, "runtimeConfig")
    has_runtime_config_snake = _core_map_contains(options, "runtime_config")
    has_any_runtime_config = _core_or(has_runtime_config, has_runtime_config_snake)
    runtime_enabled = _core_or(has_runtime_direct, has_any_runtime_config)
    policy = _normalize_agent_policy(options)
    policy_flags = _agent_policy_flags(options)
    policy_registry = _agent_policy_registry(policy, policy_flags)
    context_policy = _resolve_agent_context_policy(options)
    executor_model_policy = _resolve_agent_executor_model_policy(options)
    callable_inventory = _normalize_agent_callable_inventory(options)
    callable_split = _split_agent_callable_inventory(callable_inventory)
    discovery_catalog = _render_agent_discovery_catalog(callable_split)
    discovered_tool_docs = []
    loaded_skill_docs = []
    loaded_memories = []
    used_memories = []
    used_skills = []
    guidance_log = []
    function_call_traces = []
    policy_trace = []
    context_events = []
    actor_model_state = {}
    trace_events = []
    trace = {}
    trace["schema_version"] = "axir-agent-trace-v1"
    trace["kind"] = "agent_run"
    trace["status"] = "idle"
    trace["events"] = trace_events
    state["signature"] = sig
    state["options"] = options
    state["context_fields"] = context_fields
    state["executor_exclude_fields"] = executor_exclude
    state["responder_exclude_fields"] = responder_exclude
    code_field_name = _core_get(runtime_contract, "code_field_name", "javascriptCode")
    runtime_distiller_signature = _core_string_format("input:json, context:json, summarizedActorLog?:string, guidanceLog?:string, actionLog:string, liveRuntimeState?:string, contextPressure?:string -> {}:code", code_field_name)
    distiller_signature = "input:json, context:json -> completion:json"
    if runtime_enabled:
        distiller_signature = runtime_distiller_signature
    else:
        pass
    state["distiller_signature"] = distiller_signature
    runtime_executor_signature = _core_string_format("input:json, executorRequest:string, distilledContext:json, memories?:json, discoveredToolDocs?:string, loadedSkills?:string, summarizedActorLog?:string, guidanceLog?:string, actionLog:string, liveRuntimeState?:string, contextPressure?:string -> {}:code", code_field_name)
    executor_signature = "input:json, executorRequest:string, distilledContext:json -> completion:json"
    if runtime_enabled:
        executor_signature = runtime_executor_signature
    else:
        pass
    state["executor_signature"] = executor_signature
    llm_query_signature = "task:string, context:json -> answer:string"
    state["llm_query_signature"] = llm_query_signature
    llm_query_description = "You answer ONE focused question using only the provided context object. Return just the answer text — concise, specific, and grounded in the context. Do not restate the question."
    state["llm_query_description"] = llm_query_description
    responder_signature = _build_responder_signature(sig, context_fields)
    state["responder_signature"] = responder_signature
    state["chat_log"] = chat_log
    state["usage"] = usage
    state["runtime_state"] = state_alpha
    state["action_log"] = action_log
    state["status_log"] = status_log
    state["runtime_contract"] = runtime_contract
    state["runtime_enabled"] = runtime_enabled
    state["policy"] = policy
    state["policy_flags"] = policy_flags
    state["policy_registry"] = policy_registry
    state["context_policy"] = context_policy
    context_map_config = _core_get(options, "contextMap", None)
    has_cm_config = _core_is_not_none(context_map_config)
    if has_cm_config:
        cm_initial = {}
        cm_map_value = _core_get(context_map_config, "map", None)
        cm_map_is_object = _core_type_is(cm_map_value, "object")
        if cm_map_is_object:
            cm_initial = _core_map_merge(cm_initial, cm_map_value)
        else:
            pass
        cm_map_is_string = _core_type_is(cm_map_value, "string")
        if cm_map_is_string:
            cm_initial["text"] = cm_map_value
        else:
            pass
        cm_text = _core_get(cm_initial, "text", "")
        cm_initial["text"] = cm_text
        cm_steps = _core_get(cm_initial, "steps", 0)
        cm_initial["steps"] = cm_steps
        cm_empty_scores = {}
        cm_scores = _core_get(cm_initial, "scores", cm_empty_scores)
        cm_initial["scores"] = cm_scores
        cm_cfg_max = _core_get(context_map_config, "maxChars", 4000)
        cm_max = _core_get(cm_initial, "maxChars", cm_cfg_max)
        cm_initial["maxChars"] = cm_max
        cm_cfg_infinite = _core_get(context_map_config, "infiniteEvolve", True)
        cm_infinite = _core_get(cm_initial, "infiniteEvolve", cm_cfg_infinite)
        cm_initial["infiniteEvolve"] = cm_infinite
        cm_cfg_steps = _core_get(context_map_config, "evolveSteps", 0)
        cm_evolve_steps = _core_get(cm_initial, "evolveSteps", cm_cfg_steps)
        cm_initial["evolveSteps"] = cm_evolve_steps
        cm_cfg_next = _core_get(context_map_config, "next_id", 1)
        cm_next = _core_get(cm_initial, "next_id", cm_cfg_next)
        cm_initial["next_id"] = cm_next
        state["context_map"] = cm_initial
    else:
        pass
    state["executor_model_policy"] = executor_model_policy
    state["context_events"] = context_events
    state["actor_model_state"] = actor_model_state
    state["callable_inventory"] = callable_inventory
    state["callable_split"] = callable_split
    state["discovery_catalog"] = discovery_catalog
    state["discovered_tool_docs"] = discovered_tool_docs
    state["loaded_skill_docs"] = loaded_skill_docs
    state["loaded_memories"] = loaded_memories
    state["used_memories"] = used_memories
    state["used_skills"] = used_skills
    state["guidance_log"] = guidance_log
    state["function_call_traces"] = function_call_traces
    state["policy_trace"] = policy_trace
    state["trace"] = trace
    optimizer_metadata = _agent_optimizer_metadata(state)
    state["optimizer_metadata"] = optimizer_metadata
    actor_prompt_policy = _build_agent_actor_prompt_policy(state)
    state["actor_prompt_policy"] = actor_prompt_policy
    if runtime_enabled:
        executor_description = _render_rlm_executor_description(state, options)
        state["executor_description"] = executor_description
        responder_description = _render_rlm_responder_description(state, options)
        state["responder_description"] = responder_description
        distiller_description = _render_rlm_distiller_description(state, options)
        state["distiller_description"] = distiller_description
    else:
        pass
    return state


def _optimization_component(id: str, owner: str, kind: str, current: Any, description: str, constraints: Any, depends_on: Any, preserve: bool, format: str, validation: Any) -> Any:
    _core_coverage_mark("_optimization_component")
    out = {}
    out["id"] = id
    out["owner"] = owner
    out["kind"] = kind
    out["current"] = current
    out["description"] = description
    out["constraints"] = constraints
    out["dependsOn"] = depends_on
    out["preserve"] = preserve
    out["format"] = format
    out["validation"] = validation
    return out


def _optimized_artifact(optimizer_name: str, optimizer_version: str, component_map: Any, metadata: Any) -> Any:
    _core_coverage_mark("_optimized_artifact")
    empty_map = {}
    out = {}
    out["artifactVersion"] = "axir-optimized-artifact-v1"
    out["optimizerName"] = optimizer_name
    out["optimizerVersion"] = optimizer_version
    out["componentMap"] = component_map
    meta = metadata
    meta_missing = _core_is_none(metadata)
    if meta_missing:
        meta = empty_map
    else:
        pass
    out["metadata"] = meta
    provenance = _core_get(meta, "provenance", empty_map)
    evidence = _core_get(meta, "evidence", empty_map)
    out["provenance"] = provenance
    out["evidence"] = evidence
    return out


def _agent_reserved_runtime_names() -> list[Any]:
    _core_coverage_mark("_agent_reserved_runtime_names")
    registry = _agent_policy_vocabulary_registry()
    names = _core_get(registry, "reserved_runtime_names", None)
    names_is_list = _core_type_is(names, "list")
    if names_is_list:
        pass
    else:
        names = []
    return names


def _agent_runtime_language_tokens(language: str) -> list[Any]:
    _core_coverage_mark("_agent_runtime_language_tokens")
    trimmed = str(language).strip()
    sharp_spaced = _core_regex_replace("#", " Sharp ", trimmed)
    plus_spaced = _core_regex_replace("\\+", " Plus ", sharp_spaced)
    word_spaced = _core_regex_replace("[^A-Za-z0-9]+", " ", plus_spaced)
    tokens = _core_string_words(word_spaced)
    return tokens


def _agent_runtime_language_alias_key(tokens: Any) -> str:
    _core_coverage_mark("_agent_runtime_language_alias_key")
    joined = _core_string_join("", tokens)
    alias_key = _core_string_lower(joined)
    return alias_key


def _agent_runtime_is_javascript_alias(alias_key: str) -> bool:
    _core_coverage_mark("_agent_runtime_is_javascript_alias")
    is_javascript = _core_eq(alias_key, "javascript")
    is_js = _core_eq(alias_key, "js")
    is_ecmascript = _core_eq(alias_key, "ecmascript")
    is_js_or_javascript = _core_or(is_javascript, is_js)
    out = _core_or(is_js_or_javascript, is_ecmascript)
    return out


def _agent_runtime_code_field_name(tokens: Any, is_javascript: bool) -> str:
    _core_coverage_mark("_agent_runtime_code_field_name")
    out = "javascriptCode"
    if is_javascript:
        out = "javascriptCode"
    else:
        count = _core_len(tokens)
        has_tokens = _core_gt(count, 0)
        if has_tokens:
            prefix = _core_string_lower_camel(tokens)
            out = _core_string_format("{}Code", prefix)
        else:
            out = "runtimeCode"
    return out


def _agent_runtime_code_fence_language(tokens: Any, alias_key: str, is_javascript: bool) -> str:
    _core_coverage_mark("_agent_runtime_code_fence_language")
    out = "js"
    if is_javascript:
        out = "js"
    else:
        count = _core_len(tokens)
        has_tokens = _core_gt(count, 0)
        if has_tokens:
            out = alias_key
        else:
            out = "text"
    return out


def _normalize_agent_runtime(options: Any) -> Any:
    _core_coverage_mark("_normalize_agent_runtime")
    empty_map = {}
    runtime_camel = _core_get(options, "runtimeConfig", empty_map)
    runtime = _core_get(options, "runtime", runtime_camel)
    raw_language = _core_get(runtime, "language", "JavaScript")
    trimmed_language = str(raw_language).strip()
    language_missing = _core_eq(trimmed_language, "")
    language = trimmed_language
    if language_missing:
        language = "JavaScript"
    else:
        pass
    language_tokens = _agent_runtime_language_tokens(language)
    alias_key = _agent_runtime_language_alias_key(language_tokens)
    is_js = _agent_runtime_is_javascript_alias(alias_key)
    code_field_camel = _core_get(runtime, "codeFieldName", "")
    code_field_name = _core_get(runtime, "code_field_name", code_field_camel)
    missing_code_field = _core_eq(code_field_name, "")
    if missing_code_field:
        code_field_name = _agent_runtime_code_field_name(language_tokens, is_js)
    else:
        pass
    code_title_camel = _core_get(runtime, "codeFieldTitle", "")
    code_field_title = _core_get(runtime, "code_field_title", code_title_camel)
    missing_title = _core_eq(code_field_title, "")
    if missing_title:
        code_field_title = _core_string_title_from_camel(code_field_name)
    else:
        pass
    code_fence_camel = _core_get(runtime, "codeFenceLanguage", "")
    code_fence_language = _core_get(runtime, "code_fence_language", code_fence_camel)
    missing_fence = _core_eq(code_fence_language, "")
    if missing_fence:
        code_fence_language = _agent_runtime_code_fence_language(language_tokens, alias_key, is_js)
    else:
        pass
    usage_camel = _core_get(runtime, "usageInstructions", "")
    usage_instructions = _core_get(runtime, "usage_instructions", usage_camel)
    missing_usage = _core_eq(usage_instructions, "")
    if missing_usage:
        usage_instructions = "Use the active runtime language. Read inputs, call namespaced tools or child agents, use discover(...) before unknown callables, final(...) when complete, and askClarification(...) when blocked."
    else:
        pass
    primitives = _agent_reserved_runtime_names()
    state_hooks = []
    state_hooks.append("create_session")
    state_hooks.append("execute_code")
    state_hooks.append("inspect_globals")
    state_hooks.append("export_state")
    state_hooks.append("restore_state")
    state_hooks.append("close_session")
    out = {}
    out["language"] = language
    out["code_field_name"] = code_field_name
    out["code_field_title"] = code_field_title
    out["code_fence_language"] = code_fence_language
    out["is_javascript"] = is_js
    out["usage_instructions"] = usage_instructions
    out["callable_format"] = "namespaced_runtime_call"
    out["primitives"] = primitives
    out["state_hooks"] = state_hooks
    return out


def _normalize_agent_policy(options: Any) -> Any:
    _core_coverage_mark("_normalize_agent_policy")
    empty_map = {}
    policy_camel = _core_get(options, "agentPolicy", empty_map)
    policy_in = _core_get(options, "agent_policy", policy_camel)
    discovery_default = _core_get(policy_in, "discovery_default", "compact_catalog_prompt_full_docs_runtime_discover")
    delegation_default = _core_get(policy_in, "delegation_default", "child_agents_as_namespaced_tools")
    skills_default = _core_get(policy_in, "skills_default", "host_callback_loads_skill_docs_next_executor_prompt")
    prompt_placement = _core_get(policy_in, "prompt_placement", "runtime_usage_catalog_in_actor_prompt_loaded_docs_next_turn")
    out = {}
    out["policy_version"] = "agent-runtime-decision-v1"
    out["policy_schema_version"] = "axir-agent-policy-v1"
    out["discovery_default"] = discovery_default
    out["delegation_default"] = delegation_default
    out["skills_default"] = skills_default
    out["prompt_placement"] = prompt_placement
    out["discover_returns"] = "void"
    return out


def _agent_policy_flags(options: Any) -> Any:
    _core_coverage_mark("_agent_policy_flags")
    function_discovery_camel = _core_get(options, "functionDiscovery", False)
    function_discovery = _core_get(options, "function_discovery", function_discovery_camel)
    skills_camel = _core_get(options, "skillsMode", False)
    skills_direct = _core_get(options, "skills_mode", skills_camel)
    has_skills_callback = _core_map_contains(options, "onSkillsSearch")
    skills_mode = _core_or(skills_direct, has_skills_callback)
    memories_camel = _core_get(options, "memoriesMode", False)
    memories_direct = _core_get(options, "memories_mode", memories_camel)
    has_memories_callback = _core_map_contains(options, "onMemoriesSearch")
    memories_mode = _core_or(memories_direct, has_memories_callback)
    usage_camel = _core_get(options, "usageTrackingMode", False)
    usage_enabled = _core_get(options, "usage_tracking_mode", usage_camel)
    status_camel = _core_get(options, "hasAgentStatusCallback", False)
    status_direct = _core_get(options, "has_agent_status_callback", status_camel)
    has_status_callback = _core_map_contains(options, "agentStatusCallback")
    status_mode = _core_or(status_direct, has_status_callback)
    inspect_camel = _core_get(options, "hasInspectRuntime", False)
    inspect_direct = _core_get(options, "has_inspect_runtime", inspect_camel)
    context_config = _core_get(options, "context", None)
    has_context_config = _core_type_is(context_config, "object")
    inspect_mode = _core_or(inspect_direct, has_context_config)
    out = {}
    out["discoveryMode"] = function_discovery
    out["skillsMode"] = skills_mode
    out["memoriesMode"] = memories_mode
    out["usageTrackingMode"] = usage_enabled
    out["hasAgentStatusCallback"] = status_mode
    out["hasInspectRuntime"] = inspect_mode
    return out


def _agent_policy_action(id: str, category: str, kind: str, stages: Any, availability: str, effect: str, host_boundary: str, actor_visible: bool) -> Any:
    _core_coverage_mark("_agent_policy_action")
    entry = {}
    entry["id"] = id
    entry["public_name"] = id
    entry["category"] = category
    entry["kind"] = kind
    entry["stages"] = stages
    entry["availability_condition"] = availability
    entry["effect"] = effect
    entry["host_boundary"] = host_boundary
    entry["actor_visible"] = actor_visible
    entry["trace_event"] = id
    return entry


def _agent_policy_vocabulary_registry() -> Any:
    _core_coverage_mark("_agent_policy_vocabulary_registry")
    registry = {}
    none_value = _core_none()
    registry["policy_schema_version"] = "axir-agent-policy-vocabulary-v1"
    registry["policy_version"] = "agent-runtime-decision-v1"
    primitive_names = {}
    primitive_names["llm_query"] = "llmQuery"
    primitive_names["final"] = "final"
    primitive_names["ask_clarification"] = "askClarification"
    primitive_names["report_success"] = "reportSuccess"
    primitive_names["report_failure"] = "reportFailure"
    primitive_names["inspect_runtime"] = "inspectRuntime"
    primitive_names["discover"] = "discover"
    primitive_names["recall"] = "recall"
    primitive_names["used"] = "used"
    primitive_names["guide_agent"] = "guideAgent"
    primitive_names["inputs"] = "inputs"
    registry["actor_primitive_names"] = primitive_names
    reserved = []
    reserved.append("inputs")
    reserved.append("final")
    reserved.append("askClarification")
    reserved.append("discover")
    reserved.append("recall")
    reserved.append("llmQuery")
    reserved.append("inspectRuntime")
    reserved.append("reportSuccess")
    reserved.append("reportFailure")
    registry["reserved_runtime_names"] = reserved
    effect_only = []
    effect_only.append("discover")
    effect_only.append("recall")
    effect_only.append("used")
    registry["effect_only_actions"] = effect_only
    context = {}
    context["default_preset"] = "checkpointed"
    context["default_budget"] = "balanced"
    context["full_preset"] = "full"
    context["default_max_runtime_chars"] = 3000
    context["state_summary_max_chars"] = 1200
    option_keys = {}
    option_keys["camel"] = "contextPolicy"
    option_keys["snake"] = "context_policy"
    option_keys["preset"] = "preset"
    option_keys["budget"] = "budget"
    option_keys["summarizer_camel"] = "summarizerOptions"
    option_keys["summarizer_snake"] = "summarizer_options"
    option_keys["max_runtime_camel"] = "maxRuntimeChars"
    option_keys["max_runtime_snake"] = "max_runtime_chars"
    context["option_keys"] = option_keys
    allowed_keys = []
    allowed_keys.append("preset")
    allowed_keys.append("budget")
    context["allowed_keys"] = allowed_keys
    migration_errors = {}
    migration_errors["state"] = "contextPolicy.state.* has been removed. Use contextPolicy.budget instead."
    migration_errors["checkpoints"] = "contextPolicy.checkpoints.* has been removed. Use contextPolicy.budget instead."
    migration_errors["summarizerOptions"] = "contextPolicy.summarizerOptions has moved to top-level summarizerOptions."
    migration_errors["default"] = "contextPolicy now only supports { preset?, budget? }. Use contextPolicy.budget instead of contextPolicy.state.*, contextPolicy.checkpoints.*, or other manual cutoff options."
    context["migration_errors"] = migration_errors
    budgets = {}
    budget_compact = {}
    budget_compact["id"] = "compact"
    budget_compact["targetPromptChars"] = 12000
    budget_compact["inspectThreshold"] = 10200
    budgets["compact"] = budget_compact
    budget_balanced = {}
    budget_balanced["id"] = "balanced"
    budget_balanced["targetPromptChars"] = 16000
    budget_balanced["inspectThreshold"] = 13600
    budgets["balanced"] = budget_balanced
    budget_expanded = {}
    budget_expanded["id"] = "expanded"
    budget_expanded["targetPromptChars"] = 20000
    budget_expanded["inspectThreshold"] = 17000
    budgets["expanded"] = budget_expanded
    context["budgets"] = budgets
    presets = {}
    preset_full = {}
    preset_full["id"] = "full"
    preset_full["actionReplay"] = "full"
    preset_full["recentFullActions"] = 1
    preset_full["errorPruning"] = False
    preset_full["hindsight"] = False
    preset_full["pruneRank"] = 2
    preset_full["stateSummary"] = False
    preset_full["inspect"] = False
    preset_full["maxEntries"] = none_value
    preset_full["defaultHygieneMode"] = "none"
    preset_full["pressureHygieneMode"] = none_value
    preset_full["checkpointsEnabled"] = False
    preset_full["checkpointTriggerRatio"] = none_value
    presets["full"] = preset_full
    preset_adaptive = {}
    adaptive_recent = {}
    adaptive_recent["compact"] = 1
    adaptive_recent["balanced"] = 2
    adaptive_recent["expanded"] = 3
    preset_adaptive["id"] = "adaptive"
    preset_adaptive["actionReplay"] = "adaptive"
    preset_adaptive["recentFullActionsByBudget"] = adaptive_recent
    preset_adaptive["recentFullActions"] = 1
    preset_adaptive["errorPruning"] = True
    preset_adaptive["hindsight"] = False
    preset_adaptive["pruneRank"] = 2
    preset_adaptive["stateSummary"] = True
    preset_adaptive["inspect"] = True
    preset_adaptive["maxEntries"] = 8
    preset_adaptive["defaultHygieneMode"] = "proactive"
    preset_adaptive["pressureHygieneMode"] = "proactive"
    preset_adaptive["checkpointsEnabled"] = True
    preset_adaptive["checkpointTriggerRatio"] = 0.75
    presets["adaptive"] = preset_adaptive
    preset_lean = {}
    lean_recent = {}
    lean_recent["compact"] = 1
    lean_recent["balanced"] = 1
    lean_recent["expanded"] = 2
    preset_lean["id"] = "lean"
    preset_lean["actionReplay"] = "minimal"
    preset_lean["recentFullActionsByBudget"] = lean_recent
    preset_lean["recentFullActions"] = 1
    preset_lean["errorPruning"] = True
    preset_lean["hindsight"] = False
    preset_lean["pruneRank"] = 2
    preset_lean["stateSummary"] = True
    preset_lean["inspect"] = True
    preset_lean["maxEntries"] = 4
    preset_lean["defaultHygieneMode"] = "aggressive"
    preset_lean["pressureHygieneMode"] = "aggressive"
    preset_lean["checkpointsEnabled"] = True
    preset_lean["checkpointTriggerRatio"] = 0.6
    presets["lean"] = preset_lean
    preset_checkpointed = {}
    checkpointed_recent = {}
    checkpointed_recent["compact"] = 2
    checkpointed_recent["balanced"] = 3
    checkpointed_recent["expanded"] = 4
    preset_checkpointed["id"] = "checkpointed"
    preset_checkpointed["actionReplay"] = "checkpointed"
    preset_checkpointed["recentFullActionsByBudget"] = checkpointed_recent
    preset_checkpointed["recentFullActions"] = 2
    preset_checkpointed["errorPruning"] = False
    preset_checkpointed["hindsight"] = False
    preset_checkpointed["pruneRank"] = 2
    preset_checkpointed["stateSummary"] = True
    preset_checkpointed["inspect"] = False
    preset_checkpointed["maxEntries"] = 8
    preset_checkpointed["defaultHygieneMode"] = "none"
    preset_checkpointed["pressureHygieneMode"] = "pressure"
    preset_checkpointed["checkpointsEnabled"] = True
    preset_checkpointed["checkpointTriggerRatio"] = 1
    presets["checkpointed"] = preset_checkpointed
    context["presets"] = presets
    budget_math = {}
    budget_math["maxSystemPromptChars"] = 30000
    budget_math["minEffectiveBudgetRatio"] = 0.25
    context["budget_math"] = budget_math
    runtime_output_budget = {}
    runtime_output_budget["floorRatio"] = 0.15
    runtime_output_budget["minRuntimeChars"] = 400
    context["runtime_output_budget"] = runtime_output_budget
    smart_stringify = {}
    smart_stringify["arrayThreshold"] = 10
    smart_stringify["arrayHeadItems"] = 3
    smart_stringify["arrayTailItems"] = 2
    context["smart_stringify"] = smart_stringify
    pressure_levels = {}
    pressure_ok = {}
    pressure_ok["id"] = "ok"
    pressure_ok["threshold"] = 0
    pressure_ok["text"] = "ok - normal context pressure; continue with focused, useful inspections."
    pressure_levels["ok"] = pressure_ok
    pressure_watch = {}
    pressure_watch["id"] = "watch"
    pressure_watch["threshold"] = 0.7
    pressure_watch["text"] = "watch - keep inspections compact and avoid logging large raw values."
    pressure_levels["watch"] = pressure_watch
    pressure_critical = {}
    pressure_critical["id"] = "critical"
    pressure_critical["threshold"] = 0.9
    pressure_critical["text"] = "critical - prefer compact inspections, avoid large logs, and rely on liveRuntimeState/checkpoints for older work."
    pressure_levels["critical"] = pressure_critical
    context["pressure_levels"] = pressure_levels
    event_names = {}
    event_names["budget_check"] = "budget_check"
    event_names["action_compacted"] = "action_compacted"
    event_names["checkpoint_created"] = "checkpoint_created"
    event_names["checkpoint_cleared"] = "checkpoint_cleared"
    event_names["tombstone_created"] = "tombstone_created"
    context["event_names"] = event_names
    event_reasons = {}
    event_reasons["over_budget"] = "over_budget"
    event_reasons["under_budget"] = "under_budget"
    event_reasons["disabled"] = "disabled"
    event_reasons["pressure"] = "pressure"
    event_reasons["proactive"] = "proactive"
    event_reasons["lean"] = "lean"
    context["event_reasons"] = event_reasons
    hygiene_modes = {}
    hygiene_modes["none"] = "none"
    hygiene_modes["proactive"] = "proactive"
    hygiene_modes["pressure"] = "pressure"
    hygiene_modes["aggressive"] = "aggressive"
    context["hygiene_modes"] = hygiene_modes
    executor_model = {}
    executor_model["migration_error"] = "executorModelPolicy now expects an ordered array of { model, namespaces?, aboveErrorTurns? } entries. Manage prompt pressure with contextPolicy.budget instead of abovePromptChars."
    legacy_keys = []
    legacy_keys.append("escalatedModel")
    legacy_keys.append("baseModel")
    legacy_keys.append("abovePromptChars")
    legacy_keys.append("escalateAtPromptChars")
    legacy_keys.append("escalateAtPromptCharsWhenCheckpointed")
    legacy_keys.append("recentErrorWindowTurns")
    legacy_keys.append("recentErrorThreshold")
    legacy_keys.append("discoveryStallTurns")
    legacy_keys.append("deescalateBelowPromptChars")
    legacy_keys.append("stableTurnsBeforeDeescalate")
    legacy_keys.append("minEscalatedTurns")
    executor_model["legacy_keys"] = legacy_keys
    context["executor_model_policy"] = executor_model
    registry["context_policy"] = context
    return registry


def _map_optimization_judge_quality_to_score(quality: str) -> f64:
    _core_coverage_mark("_map_optimization_judge_quality_to_score")
    normalized = _core_string_lower(quality)
    is_excellent = _core_eq(normalized, "excellent")
    if is_excellent:
        return 1
    else:
        pass
    is_good = _core_eq(normalized, "good")
    if is_good:
        return 0.8
    else:
        pass
    is_acceptable = _core_eq(normalized, "acceptable")
    if is_acceptable:
        return 0.5
    else:
        pass
    is_poor = _core_eq(normalized, "poor")
    if is_poor:
        return 0.2
    else:
        pass
    is_unacceptable = _core_eq(normalized, "unacceptable")
    if is_unacceptable:
        return 0
    else:
        pass
    return 0.5


def _build_optimization_judge_payload(task: Any, prediction: Any, criteria: str) -> Any:
    _core_coverage_mark("_build_optimization_judge_payload")
    empty_list = []
    out = {}
    task_input = _core_get(task, "input", task)
    out["taskInput"] = task_input
    task_criteria = _core_get(task, "criteria", criteria)
    out["criteria"] = task_criteria
    expected_output = _core_get(task, "expectedOutput", None)
    out["expectedOutput"] = expected_output
    expected_actions = _core_get(task, "expectedActions", empty_list)
    out["expectedActions"] = expected_actions
    forbidden_actions = _core_get(task, "forbiddenActions", empty_list)
    out["forbiddenActions"] = forbidden_actions
    metadata = _core_get(task, "metadata", None)
    out["metadata"] = metadata
    completion_type = _core_get(prediction, "completionType", "error")
    out["completionType"] = completion_type
    clarification = _core_get(prediction, "clarification", None)
    out["clarification"] = clarification
    final_output = _core_get(prediction, "output", prediction)
    out["finalOutput"] = final_output
    guidance_log = _core_get(prediction, "guidanceLog", "")
    out["guidanceLog"] = guidance_log
    action_log = _core_get(prediction, "actionLog", empty_list)
    out["actionLog"] = action_log
    function_calls = _core_get(prediction, "functionCalls", empty_list)
    out["functionCalls"] = function_calls
    tool_errors = _core_get(prediction, "toolErrors", empty_list)
    out["toolErrors"] = tool_errors
    turn_count = _core_get(prediction, "turnCount", 0)
    out["turnCount"] = turn_count
    usage = _core_get(prediction, "usage", empty_list)
    out["usage"] = usage
    trace = _core_get(prediction, "trace", None)
    out["trace"] = trace
    return out


def _agent_context_policy_registry() -> Any:
    _core_coverage_mark("_agent_context_policy_registry")
    registry = _agent_policy_vocabulary_registry()
    empty_map = {}
    context = _core_get(registry, "context_policy", empty_map)
    return context


def _agent_context_policy_migration_error(key: str) -> str:
    _core_coverage_mark("_agent_context_policy_migration_error")
    context = _agent_context_policy_registry()
    empty_map = {}
    errors = _core_get(context, "migration_errors", empty_map)
    default_message = _core_get(errors, "default", "contextPolicy now only supports { preset?, budget? }.")
    message = _core_get(errors, key, default_message)
    return message


def _agent_context_budget_profile(budget: str) -> Any:
    _core_coverage_mark("_agent_context_budget_profile")
    context = _agent_context_policy_registry()
    empty_map = {}
    budgets = _core_get(context, "budgets", empty_map)
    default_budget = _core_get(context, "default_budget", "balanced")
    fallback = _core_get(budgets, default_budget, empty_map)
    profile = _core_get(budgets, budget, fallback)
    is_map = _core_type_is(profile, "object")
    if is_map:
        pass
    else:
        profile = fallback
    return profile


def _agent_context_preset_profile(preset: str) -> Any:
    _core_coverage_mark("_agent_context_preset_profile")
    context = _agent_context_policy_registry()
    empty_map = {}
    presets = _core_get(context, "presets", empty_map)
    full_preset = _core_get(context, "full_preset", "full")
    fallback = _core_get(presets, full_preset, empty_map)
    profile = _core_get(presets, preset, fallback)
    is_map = _core_type_is(profile, "object")
    if is_map:
        pass
    else:
        profile = fallback
    return profile


def _agent_context_event_name(stable_id: str) -> str:
    _core_coverage_mark("_agent_context_event_name")
    context = _agent_context_policy_registry()
    empty_map = {}
    names = _core_get(context, "event_names", empty_map)
    name = _core_get(names, stable_id, stable_id)
    return name


def _agent_context_event_reason(stable_id: str) -> str:
    _core_coverage_mark("_agent_context_event_reason")
    context = _agent_context_policy_registry()
    empty_map = {}
    names = _core_get(context, "event_reasons", empty_map)
    name = _core_get(names, stable_id, stable_id)
    return name


def _agent_policy_registry(policy: Any, flags: Any) -> Any:
    _core_coverage_mark("_agent_policy_registry")
    vocabulary = _agent_policy_vocabulary_registry()
    empty_map = {}
    primitive_names = _core_get(vocabulary, "actor_primitive_names", empty_map)
    llm_query_name = _core_get(primitive_names, "llm_query", "llmQuery")
    final_name = _core_get(primitive_names, "final", "final")
    ask_clarification_name = _core_get(primitive_names, "ask_clarification", "askClarification")
    report_success_name = _core_get(primitive_names, "report_success", "reportSuccess")
    report_failure_name = _core_get(primitive_names, "report_failure", "reportFailure")
    inspect_runtime_name = _core_get(primitive_names, "inspect_runtime", "inspectRuntime")
    discover_name = _core_get(primitive_names, "discover", "discover")
    recall_name = _core_get(primitive_names, "recall", "recall")
    used_name = _core_get(primitive_names, "used", "used")
    guide_agent_name = _core_get(primitive_names, "guide_agent", "guideAgent")
    inputs_name = _core_get(primitive_names, "inputs", "inputs")
    distiller_executor = []
    distiller_executor.append("distiller")
    distiller_executor.append("executor")
    executor_only = []
    executor_only.append("executor")
    all_actor = []
    all_actor.append("distiller")
    all_actor.append("executor")
    actor_primitives = []
    llm = _agent_policy_action(llm_query_name, "actor_primitive", "sub_agent_query", distiller_executor, "always", "returns string or string[]", "sub_agent_llm_query", True)
    actor_primitives.append(llm)
    final_action = _agent_policy_action(final_name, "actor_primitive", "completion", distiller_executor, "always", "ends actor turn with final payload", "runtime_completion_signal", True)
    actor_primitives.append(final_action)
    clarify = _agent_policy_action(ask_clarification_name, "actor_primitive", "completion", distiller_executor, "always", "throws clarification payload", "runtime_completion_signal", True)
    actor_primitives.append(clarify)
    success = _agent_policy_action(report_success_name, "actor_primitive", "status", executor_only, "hasAgentStatusCallback", "records successful progress status", "status_callback", True)
    actor_primitives.append(success)
    failure = _agent_policy_action(report_failure_name, "actor_primitive", "status", executor_only, "hasAgentStatusCallback", "records failed progress status", "status_callback", True)
    actor_primitives.append(failure)
    inspect = _agent_policy_action(inspect_runtime_name, "actor_primitive", "runtime_inspection", distiller_executor, "hasInspectRuntime", "returns compact runtime state", "runtime_inspection", True)
    actor_primitives.append(inspect)
    discover = _agent_policy_action(discover_name, "actor_primitive", "discovery", executor_only, "discoveryMode|skillsMode", "loads tool docs or skill guides for next turn", "tool_or_skill_discovery", True)
    actor_primitives.append(discover)
    recall = _agent_policy_action(recall_name, "actor_primitive", "memory", distiller_executor, "memoriesMode", "loads memories for next turn", "memory_search", True)
    actor_primitives.append(recall)
    used = _agent_policy_action(used_name, "actor_primitive", "usage_tracking", distiller_executor, "usageTrackingMode", "records loaded memory or skill usage", "usage_tracking_callback", True)
    actor_primitives.append(used)
    protocol_actions = []
    protocol_final_action = _agent_policy_action(final_name, "protocol_action", "completion", all_actor, "always", "normalizes final protocol payload", "completion_protocol", False)
    protocol_actions.append(protocol_final_action)
    protocol_clarify = _agent_policy_action(ask_clarification_name, "protocol_action", "completion", all_actor, "always", "normalizes clarification protocol payload", "completion_protocol", False)
    protocol_actions.append(protocol_clarify)
    guide = _agent_policy_action(guide_agent_name, "protocol_action", "guidance", executor_only, "host_protocol_only", "adds trusted guidance and continues actor loop", "host_function_protocol", False)
    protocol_actions.append(guide)
    protocol_success = _agent_policy_action("success", "protocol_action", "status", executor_only, "hasAgentStatusCallback", "reports successful status", "status_callback", False)
    protocol_actions.append(protocol_success)
    protocol_failed = _agent_policy_action("failed", "protocol_action", "status", executor_only, "hasAgentStatusCallback", "reports failed status", "status_callback", False)
    protocol_actions.append(protocol_failed)
    runtime_globals = []
    inputs = _agent_policy_action(inputs_name, "runtime_global", "data", all_actor, "always", "contains current actor inputs", "runtime_global", False)
    runtime_globals.append(inputs)
    callables = _agent_policy_action("callable_namespaces", "runtime_global", "callable_namespace", executor_only, "has_callables", "namespaced tools and child agents", "tool_or_child_agent_handler", False)
    runtime_globals.append(callables)
    bootstrap = _agent_policy_action("safe_bootstrap_globals", "runtime_global", "bootstrap", all_actor, "has_bootstrap_context", "safe context aliases only", "runtime_session_bootstrap", False)
    runtime_globals.append(bootstrap)
    host_boundaries = []
    tool_boundary = _agent_policy_action("tool_handler", "host_boundary", "callback", executor_only, "has_callables", "invokes target-native tool handler", "tool_handler", False)
    host_boundaries.append(tool_boundary)
    child_boundary = _agent_policy_action("child_agent", "host_boundary", "callback", executor_only, "has_child_agents", "invokes child agent as callable", "child_agent_forward", False)
    host_boundaries.append(child_boundary)
    memory_boundary = _agent_policy_action("memory_search", "host_boundary", "callback", distiller_executor, "memoriesMode", "loads host memory results", "memory_search_callback", False)
    host_boundaries.append(memory_boundary)
    skill_boundary = _agent_policy_action("skill_search", "host_boundary", "callback", executor_only, "skillsMode", "loads host skill docs", "skill_search_callback", False)
    host_boundaries.append(skill_boundary)
    status_boundary = _agent_policy_action("status_callback", "host_boundary", "callback", executor_only, "hasAgentStatusCallback", "reports progress status", "status_callback", False)
    host_boundaries.append(status_boundary)
    runtime_boundary = _agent_policy_action("runtime_execution", "host_boundary", "runtime", all_actor, "has_runtime", "executes opaque runtime code", "code_runtime_session", False)
    host_boundaries.append(runtime_boundary)
    inspect_boundary = _agent_policy_action("runtime_inspection", "host_boundary", "runtime", all_actor, "hasInspectRuntime", "inspects runtime state", "code_runtime_inspection", False)
    host_boundaries.append(inspect_boundary)
    subquery_boundary = _agent_policy_action("sub_agent_llm_query", "host_boundary", "ai", distiller_executor, "always", "runs focused AxGen sub-query", "axgen_sub_agent", False)
    host_boundaries.append(subquery_boundary)
    out = {}
    policy_version = _core_get(policy, "policy_version", "agent-runtime-decision-v1")
    schema_version = _core_get(policy, "policy_schema_version", "axir-agent-policy-v1")
    out["policy_version"] = policy_version
    out["policy_schema_version"] = schema_version
    out["flags"] = flags
    out["actor_primitives"] = actor_primitives
    out["protocol_actions"] = protocol_actions
    out["runtime_globals"] = runtime_globals
    out["host_boundaries"] = host_boundaries
    out["vocabulary"] = vocabulary
    return out


def _policy_flag_enabled(flags: Any, condition: str) -> bool:
    _core_coverage_mark("_policy_flag_enabled")
    out = False
    always = _core_eq(condition, "always")
    if always:
        out = True
    else:
        discovery_or_skills = _core_eq(condition, "discoveryMode|skillsMode")
        if discovery_or_skills:
            discovery = _core_get(flags, "discoveryMode", False)
            skills = _core_get(flags, "skillsMode", False)
            out = _core_or(discovery, skills)
        else:
            host_only = _core_eq(condition, "host_protocol_only")
            if host_only:
                out = True
            else:
                value = _core_get(flags, condition, False)
                out = value
    return out


def _build_agent_eval_prediction(output: Any, action_log: Any, usage: Any, trace: Any) -> Any:
    _core_coverage_mark("_build_agent_eval_prediction")
    out = {}
    out["completionType"] = "final"
    out["output"] = output
    out["finalOutput"] = output
    out["actionLog"] = action_log
    out["usage"] = usage
    out["trace"] = trace
    empty_list = []
    out["functionCalls"] = empty_list
    out["toolErrors"] = empty_list
    out["turnCount"] = 0
    return out


def _select_actor_primitives(registry: Any, stage: str) -> Any:
    _core_coverage_mark("_select_actor_primitives")
    empty_list = []
    out = []
    flags = _core_get(registry, "flags", empty_list)
    primitives = _core_get(registry, "actor_primitives", empty_list)
    for primitive in primitives:
        stages = _core_get(primitive, "stages", empty_list)
        in_stage = _core_contains(stages, stage)
        condition = _core_get(primitive, "availability_condition", "always")
        enabled = _policy_flag_enabled(flags, condition)
        include = _core_and(in_stage, enabled)
        if include:
            out.append(primitive)
        else:
            pass
    return out


def _select_protocol_actions(registry: Any) -> Any:
    _core_coverage_mark("_select_protocol_actions")
    empty_list = []
    actions = _core_get(registry, "protocol_actions", empty_list)
    return actions


def _select_runtime_globals(registry: Any) -> Any:
    _core_coverage_mark("_select_runtime_globals")
    empty_list = []
    globals = _core_get(registry, "runtime_globals", empty_list)
    return globals


def _validate_policy_reserved_names(registry: Any, name: str) -> None:
    _core_coverage_mark("_validate_policy_reserved_names")
    reserved = _agent_reserved_runtime_names()
    conflicts = _core_contains(reserved, name)
    if conflicts:
        message = _core_string_format("agent callable namespace conflicts with reserved runtime name: {}", name)
        error = _core_runtime_error(message)
        raise error
    else:
        pass
    none = _core_none()
    return none


def _render_actor_primitive_guidance(registry: Any, stage: str) -> str:
    _core_coverage_mark("_render_actor_primitive_guidance")
    primitives = _select_actor_primitives(registry, stage)
    lines = []
    for primitive in primitives:
        id = _core_get(primitive, "id", None)
        effect = _core_get(primitive, "effect", "")
        line = _core_string_format("- {}: {}", id, effect)
        lines.append(line)
    out = _core_string_join("\n", lines)
    return out


def _rlm_flag_enabled(flags: Any, flag: str) -> bool:
    _core_coverage_mark("_rlm_flag_enabled")
    is_empty = _core_eq(flag, "")
    if is_empty:
        return True
    else:
        pass
    value = _core_get(flags, flag, False)
    out = _core_truthy(value)
    return out


def _rlm_any_flag_enabled(flags: Any, flag_names: Any) -> bool:
    _core_coverage_mark("_rlm_any_flag_enabled")
    count = _core_len(flag_names)
    is_empty = _core_eq(count, 0)
    if is_empty:
        return True
    else:
        pass
    out = False
    for name in flag_names:
        enabled = _rlm_flag_enabled(flags, name)
        out = _core_or(out, enabled)
    return out


def _rlm_entry_enabled(entry: Any, flags: Any) -> bool:
    _core_coverage_mark("_rlm_entry_enabled")
    enabled_by = _core_get(entry, "enabledBy", "")
    a = _rlm_flag_enabled(flags, enabled_by)
    empty_list = []
    enabled_by_any = _core_get(entry, "enabledByAny", empty_list)
    b = _rlm_any_flag_enabled(flags, enabled_by_any)
    ab = _core_and(a, b)
    disabled_by = _core_get(entry, "disabledBy", "")
    no_disabled = _core_eq(disabled_by, "")
    out = ab
    if no_disabled:
        out = ab
    else:
        disabled_active = _rlm_flag_enabled(flags, disabled_by)
        not_disabled = _core_not(disabled_active)
        out = _core_and(ab, not_disabled)
    return out


def _render_runtime_primitive(primitive: Any, flags: Any) -> str:
    _core_coverage_mark("_render_runtime_primitive")
    parts = []
    description = _core_get(primitive, "description", "")
    parts.append(description)
    empty_list = []
    signatures = _core_get(primitive, "signatures", empty_list)
    for signature in signatures:
        sig_ok = _rlm_entry_enabled(signature, flags)
        if sig_ok:
            code = _core_get(signature, "code", "")
            line = _core_string_format("`{}`", code)
            parts.append(line)
        else:
            pass
    examples = _core_get(primitive, "examples", empty_list)
    example_lines = []
    for example in examples:
        ex_ok = _rlm_entry_enabled(example, flags)
        if ex_ok:
            ex_code = _core_get(example, "code", "")
            example_lines.append(ex_code)
        else:
            pass
    example_count = _core_len(example_lines)
    has_examples = _core_gt(example_count, 0)
    if has_examples:
        joined_examples = _core_string_join("\n", example_lines)
        example_block = _core_string_format("Examples:\n```js\n{}\n```", joined_examples)
        parts.append(example_block)
    else:
        pass
    out = _core_string_join("\n", parts)
    return out


def _render_actor_primitives_list(stage: str, flags: Any) -> str:
    _core_coverage_mark("_render_actor_primitives_list")
    data = _core_json_parse("{\"schema_version\":\"axir-rlm-prompts-v1\",\"executor_template\":\"## Executor\\n\\nYou (`executor`) are the task-execution stage in a two-stage pipeline. Your ONLY job is to write {{ runtimeLanguageName }} code that runs in the {{ runtimeLanguageName }} runtime (REPL) to complete tasks using the tools available to you. A separate (`responder`) agent downstream synthesizes the final answer.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Executor Request & Distilled Context\\n\\nThe prior distiller stage produced two extra inputs:\\n\\n- `inputs.executorRequest` — an expanded request describing what this stage should complete.\\n- `inputs.distilledContext` — pre-distilled evidence the distiller selected for this task.\\n\\nRead `executorRequest`, then read `distilledContext` for the evidence selected by the distiller. Raw context fields are not available in this stage. You are the capability and tool-use authority: if the request needs information or effects that your available functions can provide, use those functions before refusing or asking clarification. If the distilled evidence is sufficient, finish directly with `final(...)`. Call `askClarification(...)` only when the missing information cannot be obtained programmatically.\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n\\n{{ functionsList }}\\n{{ if discoveryMode }}\\n\\n{{ if hasModules }}\\n### Available Modules\\n{{ modulesList }}\\n{{ /if }}\\n{{ if hasDiscoveredDocs }}\\n### Discovered Tool Docs\\n\\nWhen `inputs.discoveredToolDocs` is provided, it contains tool docs fetched this run. Use them directly. Only re-run discovery for modules/functions not listed there.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasSkills }}\\n### Loaded Skills\\n\\nWhen `inputs.loadedSkills` is provided, it contains skill guides loaded via the runtime-exposed `discover` primitive or forward-time skills. Apply relevant guides directly. Call `discover` with skills to load additional skills as needed.\\n{{ if skillUsageMode }}\\n\\nIf `used(...)` is available, call it once for each loaded skill that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the skill's rendered `ID:` value. Keep reasons short. Do not report skills that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded (including any the distiller forwarded). The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn.\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n\\n### How to Work\\n\\n- Start from `inputs.executorRequest`, `inputs.distilledContext`, non-context task inputs, and prior successful Action Log results. Don't repeat probes already in the Action Log.\\n- Treat direct action requests as work to attempt with available functions. If a function fails or the environment denies the action, capture the real error, status, output, or exception in the evidence for the responder.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret narrowed text — never pass raw `inputs.*` to it.\\n- Discovery calls (`discover`) can appear alongside other code — the runtime runs them first automatically.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible. If the task is complete, finish with `await final(\\\"...\\\", { result })` instead of logging.\\n{{ else }}\\n- Capture runtime results into variables when the language requires it; inspect intermediate values using the output/print mechanism described in the runtime usage instructions.\\n{{ /if }}\\n- Before calling `askClarification`, check whether any available function can resolve the need first.\\n{{ if hasAgentStatusCallback }}\\n- Keep the user updated: call the runtime-exposed `reportSuccess` primitive after completing sub-tasks and `reportFailure` when something goes wrong{{ if isJavaScriptRuntime }} (for example, `await reportSuccess(message)`){{ /if }}.\\n{{ /if }}\\n{{ if isJavaScriptRuntime }}\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst plan = await llmQuery([{\\n  query: 'Determine which messages require a refund response and draft a compact action plan.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(plan);\\n```\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n{{ /if }}\\n\\n{{ if isJavaScriptRuntime }}\\nWhen done, call `await final(task, evidence)`:\\n{{ else }}\\nWhen done, call the runtime-exposed `final(task, evidence)` primitive:\\n{{ /if }}\\n\\n- `task` — a one-line instruction the **responder** will follow when writing the user-facing output fields (e.g. \\\"Answer the user's question using the matched emails\\\").\\n- `evidence` — the curated data the responder will read to follow `task`. Pass narrowed runtime values with only the fields that matter, not raw `inputs.*`. Use plain keys (for example, `matchedEmails`) — don't wrap under the output field name.\\n\\nDo not pre-format the answer; the responder writes the output fields.\\n\\nValid completion turns:\\n\\n{{ if isJavaScriptRuntime }}\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Answer the user's question using the gathered evidence\\\", { evidence });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which file should I analyze?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"responder_template\":\"## Answer Synthesis Agent\\n\\nYou synthesize the final answer from the evidence the actor gathered. You do not run code, call tools, or invoke agents — you read input fields and write the output fields.\\n\\n### Reading the actor's payload\\n\\n`Context Data` has two keys:\\n\\n- `task` — a one-line instruction telling you what to write into the output fields.\\n- `evidence` — the data the actor curated for you to follow that instruction.\\n\\n### Rules\\n\\n1. Follow `Context Data.task` using `Context Data.evidence` and any other input fields provided.\\n2. When emitting a JSON output field, write the value flat — do **not** wrap it under a key matching the field's title. The field is already named.\\n3. If `evidence` lacks sufficient information, give the best possible answer from what's available across all input fields.\\n4. Do not contradict actor evidence. If evidence contains a tool result, failure, status, output, or exception, report that result rather than inventing a capability limit.\\n\\n### Context variables that were analyzed (metadata only)\\n{{ contextVarSummary }}\\n{{ if hasAgentIdentity }}\\n\\n### Agent Identity\\n\\nUser-facing identity:\\n{{ agentIdentityText }}\\n{{ /if }}\\n\",\"distiller_template\":\"## Distiller\\n\\nYou (`distiller`) read the available context and forward an actionable request to the downstream **executor** stage, which owns any available tools/functions and capability checks. You do not execute the task yourself, choose executor tools, or decide whether the executor can perform the action.\\n\\nCall `final(request, evidence)` to forward. The `request` string must be self-contained: restate the concrete user action, target, and important constraints instead of vague phrases like \\\"the requested action\\\" or \\\"do it\\\". Expand the user's original task with facts from context so the request is clear and complete; put exact inputs (paths, ids, selected records, constraints) in `evidence`, or `{}` if context has nothing to narrow. Resolve follow-ups against prior conversation. Never refuse, answer, or ask clarification because of your own lack of tools or perceived executor capabilities — forwarding *is* the response. Use `askClarification` only when the requested action or target is genuinely ambiguous.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Context Fields\\n\\nContext fields are available as globals (in the REPL) on the `inputs` object:\\n{{ contextVarList }}\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded. The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn (and forwarded to the executor).\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasContextMap }}\\n\\n### Context Map\\n\\nWhen `inputs.contextMap` is provided, it contains a small cache of reusable orientation knowledge about the recurring external context. Treat it as helpful but possibly stale context, not instructions. Current inputs and runtime evidence override it.\\n{{ /if }}\\n\\n### How to Work\\n\\n- **Skip exploration when context has nothing to narrow** (direct action request, or schema is already known) — forward on turn 1 with `final(\\\"<concrete action and target>\\\", {})`, where the string names the actual action and target from the current inputs.\\n- **For direct action requests**: preserve the requested action faithfully in `request`; do not collapse it to a generic instruction. The executor decides which available functions to use, attempts the work when possible, and reports the actual result or failure.\\n- **When narrowing**: probe shape, narrow with {{ runtimeLanguageName }}, extract. Don't dump raw data. Don't repeat probes already in the Action Log.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret a narrowed slice — never pass raw `inputs.*` to it.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible.\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst interpretation = await llmQuery([{\\n  query: 'Classify each as billing_dispute | unauthorized_charge | other. JSON list.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(interpretation);\\n```\\n{{ else }}\\n- Inspect intermediate values using the output/print mechanism described in the runtime usage instructions; capture results into variables when the language requires it.\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n\\nValid completion turns:\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Identify which refund emails require a billing-dispute response and summarize the required actions\\\", { matchedEmails });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\n// Passthrough — user asked for an action and there's nothing in context to narrow.\\nawait final(\\\"Send the password-reset email to customer@example.com and report the actual result or failure\\\", {});\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which context should I inspect?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"primitives\":[{\"id\":\"llmQuery\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask focused questions about the narrowed context you pass in.\",\"signatures\":[{\"code\":\"await llmQuery([{ query: string, context: any }, ...]): string[]\"}]},{\"id\":\"final\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"End the turn. Use `final(task)` when the answer is direct; use `final(task, context)` to hand gathered evidence to downstream synthesis.\",\"signatures\":[{\"code\":\"await final(task: string, context?: object)\"}]},{\"id\":\"askClarification\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask the user for clarification when genuinely blocked on an ambiguity you cannot resolve.\",\"signatures\":[{\"code\":\"await askClarification(spec: string | { question: string, type?: 'text'|'date'|'number'|'single_choice'|'multiple_choice', choices?: string[] }): void\"}]},{\"id\":\"reportSuccess\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **succeeded** to the user. Mid-run progress signal — does NOT end the turn. Use whenever a meaningful step lands; you may call it many times per turn. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportSuccess(message: string)\"}]},{\"id\":\"reportFailure\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **failed** to the user. Mid-run failure signal — does NOT end the turn; the actor continues and may retry. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportFailure(message: string)\"}]},{\"id\":\"inspectRuntime\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"hasInspectRuntime\",\"description\":\"Returns a compact snapshot of variables you've created in this session. Use to re-ground yourself when the conversation is long.\",\"signatures\":[{\"code\":\"await inspectRuntime(): string\"}]},{\"id\":\"discover\",\"stages\":[\"executor\"],\"enabledByAny\":[\"discoveryMode\",\"skillsMode\"],\"description\":\"Load tool docs and skill guides into the next turn. Use one batched call.\",\"signatures\":[{\"code\":\"await discover(item: string): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(items: string[]): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { skills: string | string[] }): void\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { tools?: string | string[], skills?: string | string[] }): void\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}],\"examples\":[{\"code\":\"await discover('db');\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(['db', 'db.search']);\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ skills: ['release checklist'] });\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ tools: ['db'], skills: ['release checklist'] });\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}]},{\"id\":\"recall\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"memoriesMode\",\"description\":\"Recall memories by description. Matched `{id, content}` entries land on `inputs.memories` next turn — read it to see what landed. Returns nothing.\",\"signatures\":[{\"code\":\"await recall(searches: string[]): void\"}]},{\"id\":\"used\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"usageTrackingMode\",\"description\":\"Declare a loaded memory id or skill id that actually influenced this turn. Loaded-but-unused entries must be omitted. Returns nothing.\",\"signatures\":[{\"code\":\"await used(id: string, reason?: string): void\"}]}]}")
    empty_list = []
    primitives = _core_get(data, "primitives", empty_list)
    blocks = []
    for primitive in primitives:
        stages = _core_get(primitive, "stages", empty_list)
        in_stage = _core_contains(stages, stage)
        if in_stage:
            enabled = _rlm_entry_enabled(primitive, flags)
            if enabled:
                block = _render_runtime_primitive(primitive, flags)
                blocks.append(block)
            else:
                pass
        else:
            pass
    out = _core_string_join("\n\n", blocks)
    return out


def _build_rlm_flags(options: Any) -> Any:
    _core_coverage_mark("_build_rlm_flags")
    flags = _agent_policy_flags(options)
    disc = _core_get(flags, "discoveryMode", False)
    skills = _core_get(flags, "skillsMode", False)
    combined = _core_and(disc, skills)
    flags["discoveryMode+skillsMode"] = combined
    return flags


def _rlm_context_var_list(context_fields: Any) -> str:
    _core_coverage_mark("_rlm_context_var_list")
    count = _core_len(context_fields)
    is_empty = _core_eq(count, 0)
    if is_empty:
        return "(none)"
    else:
        pass
    lines = []
    for field in context_fields:
        name = _core_get(field, "name", "")
        line = _core_string_format("- `{}` -> `inputs.{}`", name, name)
        lines.append(line)
    out = _core_string_join("\n", lines)
    return out


def _rlm_context_var_summary(context_fields: Any) -> str:
    _core_coverage_mark("_rlm_context_var_summary")
    count = _core_len(context_fields)
    is_empty = _core_eq(count, 0)
    if is_empty:
        return "(none)"
    else:
        pass
    lines = []
    for field in context_fields:
        name = _core_get(field, "name", "")
        line = _core_string_format("- `{}`", name)
        lines.append(line)
    out = _core_string_join("\n", lines)
    return out


def _rlm_render_template(template: str, vars: Any, context: str) -> str:
    _core_coverage_mark("_rlm_render_template")
    rendered = render_template_content(template, vars, context)
    collapsed = _core_regex_replace("\\n{3,}", "\n\n", rendered)
    trimmed = str(collapsed).strip()
    return trimmed


def _render_rlm_executor_description(state: Any, options: Any) -> str:
    _core_coverage_mark("_render_rlm_executor_description")
    empty_map = {}
    contract = _core_get(state, "runtime_contract", empty_map)
    flags = _build_rlm_flags(options)
    primitives_list = _render_actor_primitives_list("executor", flags)
    language = _core_get(contract, "language", "JavaScript")
    code_field_title = _core_get(contract, "code_field_title", "Javascript Code")
    code_fence_language = _core_get(contract, "code_fence_language", "js")
    is_javascript = _core_get(contract, "is_javascript", True)
    usage_instructions = _core_get(contract, "usage_instructions", "")
    discovery_mode = _core_get(flags, "discoveryMode", False)
    skills_mode = _core_get(flags, "skillsMode", False)
    memories_mode = _core_get(flags, "memoriesMode", False)
    status_callback = _core_get(flags, "hasAgentStatusCallback", False)
    memory_usage_camel = _core_get(options, "memoryUsageMode", False)
    memory_usage_mode = _core_get(options, "memory_usage_mode", memory_usage_camel)
    skill_usage_camel = _core_get(options, "skillUsageMode", False)
    skill_usage_mode = _core_get(options, "skill_usage_mode", skill_usage_camel)
    vars = {}
    vars["runtimeLanguageName"] = language
    vars["runtimeCodeFieldTitle"] = code_field_title
    vars["runtimeCodeFenceLanguage"] = code_fence_language
    vars["isJavaScriptRuntime"] = is_javascript
    vars["runtimeUsageInstructions"] = usage_instructions
    vars["primitivesList"] = primitives_list
    vars["functionsList"] = ""
    vars["modulesList"] = ""
    vars["discoveryMode"] = discovery_mode
    vars["hasModules"] = False
    vars["hasDiscoveredDocs"] = discovery_mode
    vars["hasSkills"] = skills_mode
    vars["skillUsageMode"] = skill_usage_mode
    vars["memoriesMode"] = memories_mode
    vars["memoryUsageMode"] = memory_usage_mode
    vars["hasAgentStatusCallback"] = status_callback
    data = _core_json_parse("{\"schema_version\":\"axir-rlm-prompts-v1\",\"executor_template\":\"## Executor\\n\\nYou (`executor`) are the task-execution stage in a two-stage pipeline. Your ONLY job is to write {{ runtimeLanguageName }} code that runs in the {{ runtimeLanguageName }} runtime (REPL) to complete tasks using the tools available to you. A separate (`responder`) agent downstream synthesizes the final answer.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Executor Request & Distilled Context\\n\\nThe prior distiller stage produced two extra inputs:\\n\\n- `inputs.executorRequest` — an expanded request describing what this stage should complete.\\n- `inputs.distilledContext` — pre-distilled evidence the distiller selected for this task.\\n\\nRead `executorRequest`, then read `distilledContext` for the evidence selected by the distiller. Raw context fields are not available in this stage. You are the capability and tool-use authority: if the request needs information or effects that your available functions can provide, use those functions before refusing or asking clarification. If the distilled evidence is sufficient, finish directly with `final(...)`. Call `askClarification(...)` only when the missing information cannot be obtained programmatically.\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n\\n{{ functionsList }}\\n{{ if discoveryMode }}\\n\\n{{ if hasModules }}\\n### Available Modules\\n{{ modulesList }}\\n{{ /if }}\\n{{ if hasDiscoveredDocs }}\\n### Discovered Tool Docs\\n\\nWhen `inputs.discoveredToolDocs` is provided, it contains tool docs fetched this run. Use them directly. Only re-run discovery for modules/functions not listed there.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasSkills }}\\n### Loaded Skills\\n\\nWhen `inputs.loadedSkills` is provided, it contains skill guides loaded via the runtime-exposed `discover` primitive or forward-time skills. Apply relevant guides directly. Call `discover` with skills to load additional skills as needed.\\n{{ if skillUsageMode }}\\n\\nIf `used(...)` is available, call it once for each loaded skill that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the skill's rendered `ID:` value. Keep reasons short. Do not report skills that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded (including any the distiller forwarded). The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn.\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n\\n### How to Work\\n\\n- Start from `inputs.executorRequest`, `inputs.distilledContext`, non-context task inputs, and prior successful Action Log results. Don't repeat probes already in the Action Log.\\n- Treat direct action requests as work to attempt with available functions. If a function fails or the environment denies the action, capture the real error, status, output, or exception in the evidence for the responder.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret narrowed text — never pass raw `inputs.*` to it.\\n- Discovery calls (`discover`) can appear alongside other code — the runtime runs them first automatically.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible. If the task is complete, finish with `await final(\\\"...\\\", { result })` instead of logging.\\n{{ else }}\\n- Capture runtime results into variables when the language requires it; inspect intermediate values using the output/print mechanism described in the runtime usage instructions.\\n{{ /if }}\\n- Before calling `askClarification`, check whether any available function can resolve the need first.\\n{{ if hasAgentStatusCallback }}\\n- Keep the user updated: call the runtime-exposed `reportSuccess` primitive after completing sub-tasks and `reportFailure` when something goes wrong{{ if isJavaScriptRuntime }} (for example, `await reportSuccess(message)`){{ /if }}.\\n{{ /if }}\\n{{ if isJavaScriptRuntime }}\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst plan = await llmQuery([{\\n  query: 'Determine which messages require a refund response and draft a compact action plan.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(plan);\\n```\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n{{ /if }}\\n\\n{{ if isJavaScriptRuntime }}\\nWhen done, call `await final(task, evidence)`:\\n{{ else }}\\nWhen done, call the runtime-exposed `final(task, evidence)` primitive:\\n{{ /if }}\\n\\n- `task` — a one-line instruction the **responder** will follow when writing the user-facing output fields (e.g. \\\"Answer the user's question using the matched emails\\\").\\n- `evidence` — the curated data the responder will read to follow `task`. Pass narrowed runtime values with only the fields that matter, not raw `inputs.*`. Use plain keys (for example, `matchedEmails`) — don't wrap under the output field name.\\n\\nDo not pre-format the answer; the responder writes the output fields.\\n\\nValid completion turns:\\n\\n{{ if isJavaScriptRuntime }}\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Answer the user's question using the gathered evidence\\\", { evidence });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which file should I analyze?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"responder_template\":\"## Answer Synthesis Agent\\n\\nYou synthesize the final answer from the evidence the actor gathered. You do not run code, call tools, or invoke agents — you read input fields and write the output fields.\\n\\n### Reading the actor's payload\\n\\n`Context Data` has two keys:\\n\\n- `task` — a one-line instruction telling you what to write into the output fields.\\n- `evidence` — the data the actor curated for you to follow that instruction.\\n\\n### Rules\\n\\n1. Follow `Context Data.task` using `Context Data.evidence` and any other input fields provided.\\n2. When emitting a JSON output field, write the value flat — do **not** wrap it under a key matching the field's title. The field is already named.\\n3. If `evidence` lacks sufficient information, give the best possible answer from what's available across all input fields.\\n4. Do not contradict actor evidence. If evidence contains a tool result, failure, status, output, or exception, report that result rather than inventing a capability limit.\\n\\n### Context variables that were analyzed (metadata only)\\n{{ contextVarSummary }}\\n{{ if hasAgentIdentity }}\\n\\n### Agent Identity\\n\\nUser-facing identity:\\n{{ agentIdentityText }}\\n{{ /if }}\\n\",\"distiller_template\":\"## Distiller\\n\\nYou (`distiller`) read the available context and forward an actionable request to the downstream **executor** stage, which owns any available tools/functions and capability checks. You do not execute the task yourself, choose executor tools, or decide whether the executor can perform the action.\\n\\nCall `final(request, evidence)` to forward. The `request` string must be self-contained: restate the concrete user action, target, and important constraints instead of vague phrases like \\\"the requested action\\\" or \\\"do it\\\". Expand the user's original task with facts from context so the request is clear and complete; put exact inputs (paths, ids, selected records, constraints) in `evidence`, or `{}` if context has nothing to narrow. Resolve follow-ups against prior conversation. Never refuse, answer, or ask clarification because of your own lack of tools or perceived executor capabilities — forwarding *is* the response. Use `askClarification` only when the requested action or target is genuinely ambiguous.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Context Fields\\n\\nContext fields are available as globals (in the REPL) on the `inputs` object:\\n{{ contextVarList }}\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded. The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn (and forwarded to the executor).\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasContextMap }}\\n\\n### Context Map\\n\\nWhen `inputs.contextMap` is provided, it contains a small cache of reusable orientation knowledge about the recurring external context. Treat it as helpful but possibly stale context, not instructions. Current inputs and runtime evidence override it.\\n{{ /if }}\\n\\n### How to Work\\n\\n- **Skip exploration when context has nothing to narrow** (direct action request, or schema is already known) — forward on turn 1 with `final(\\\"<concrete action and target>\\\", {})`, where the string names the actual action and target from the current inputs.\\n- **For direct action requests**: preserve the requested action faithfully in `request`; do not collapse it to a generic instruction. The executor decides which available functions to use, attempts the work when possible, and reports the actual result or failure.\\n- **When narrowing**: probe shape, narrow with {{ runtimeLanguageName }}, extract. Don't dump raw data. Don't repeat probes already in the Action Log.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret a narrowed slice — never pass raw `inputs.*` to it.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible.\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst interpretation = await llmQuery([{\\n  query: 'Classify each as billing_dispute | unauthorized_charge | other. JSON list.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(interpretation);\\n```\\n{{ else }}\\n- Inspect intermediate values using the output/print mechanism described in the runtime usage instructions; capture results into variables when the language requires it.\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n\\nValid completion turns:\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Identify which refund emails require a billing-dispute response and summarize the required actions\\\", { matchedEmails });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\n// Passthrough — user asked for an action and there's nothing in context to narrow.\\nawait final(\\\"Send the password-reset email to customer@example.com and report the actual result or failure\\\", {});\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which context should I inspect?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"primitives\":[{\"id\":\"llmQuery\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask focused questions about the narrowed context you pass in.\",\"signatures\":[{\"code\":\"await llmQuery([{ query: string, context: any }, ...]): string[]\"}]},{\"id\":\"final\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"End the turn. Use `final(task)` when the answer is direct; use `final(task, context)` to hand gathered evidence to downstream synthesis.\",\"signatures\":[{\"code\":\"await final(task: string, context?: object)\"}]},{\"id\":\"askClarification\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask the user for clarification when genuinely blocked on an ambiguity you cannot resolve.\",\"signatures\":[{\"code\":\"await askClarification(spec: string | { question: string, type?: 'text'|'date'|'number'|'single_choice'|'multiple_choice', choices?: string[] }): void\"}]},{\"id\":\"reportSuccess\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **succeeded** to the user. Mid-run progress signal — does NOT end the turn. Use whenever a meaningful step lands; you may call it many times per turn. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportSuccess(message: string)\"}]},{\"id\":\"reportFailure\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **failed** to the user. Mid-run failure signal — does NOT end the turn; the actor continues and may retry. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportFailure(message: string)\"}]},{\"id\":\"inspectRuntime\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"hasInspectRuntime\",\"description\":\"Returns a compact snapshot of variables you've created in this session. Use to re-ground yourself when the conversation is long.\",\"signatures\":[{\"code\":\"await inspectRuntime(): string\"}]},{\"id\":\"discover\",\"stages\":[\"executor\"],\"enabledByAny\":[\"discoveryMode\",\"skillsMode\"],\"description\":\"Load tool docs and skill guides into the next turn. Use one batched call.\",\"signatures\":[{\"code\":\"await discover(item: string): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(items: string[]): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { skills: string | string[] }): void\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { tools?: string | string[], skills?: string | string[] }): void\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}],\"examples\":[{\"code\":\"await discover('db');\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(['db', 'db.search']);\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ skills: ['release checklist'] });\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ tools: ['db'], skills: ['release checklist'] });\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}]},{\"id\":\"recall\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"memoriesMode\",\"description\":\"Recall memories by description. Matched `{id, content}` entries land on `inputs.memories` next turn — read it to see what landed. Returns nothing.\",\"signatures\":[{\"code\":\"await recall(searches: string[]): void\"}]},{\"id\":\"used\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"usageTrackingMode\",\"description\":\"Declare a loaded memory id or skill id that actually influenced this turn. Loaded-but-unused entries must be omitted. Returns nothing.\",\"signatures\":[{\"code\":\"await used(id: string, reason?: string): void\"}]}]}")
    template = _core_get(data, "executor_template", "")
    out = _rlm_render_template(template, vars, "rlm/executor.md")
    return out


def _render_rlm_responder_description(state: Any, options: Any) -> str:
    _core_coverage_mark("_render_rlm_responder_description")
    empty_list = []
    context_fields = _core_get(state, "context_fields", empty_list)
    summary = _rlm_context_var_summary(context_fields)
    vars = {}
    vars["contextVarSummary"] = summary
    vars["hasAgentIdentity"] = False
    vars["agentIdentityText"] = ""
    data = _core_json_parse("{\"schema_version\":\"axir-rlm-prompts-v1\",\"executor_template\":\"## Executor\\n\\nYou (`executor`) are the task-execution stage in a two-stage pipeline. Your ONLY job is to write {{ runtimeLanguageName }} code that runs in the {{ runtimeLanguageName }} runtime (REPL) to complete tasks using the tools available to you. A separate (`responder`) agent downstream synthesizes the final answer.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Executor Request & Distilled Context\\n\\nThe prior distiller stage produced two extra inputs:\\n\\n- `inputs.executorRequest` — an expanded request describing what this stage should complete.\\n- `inputs.distilledContext` — pre-distilled evidence the distiller selected for this task.\\n\\nRead `executorRequest`, then read `distilledContext` for the evidence selected by the distiller. Raw context fields are not available in this stage. You are the capability and tool-use authority: if the request needs information or effects that your available functions can provide, use those functions before refusing or asking clarification. If the distilled evidence is sufficient, finish directly with `final(...)`. Call `askClarification(...)` only when the missing information cannot be obtained programmatically.\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n\\n{{ functionsList }}\\n{{ if discoveryMode }}\\n\\n{{ if hasModules }}\\n### Available Modules\\n{{ modulesList }}\\n{{ /if }}\\n{{ if hasDiscoveredDocs }}\\n### Discovered Tool Docs\\n\\nWhen `inputs.discoveredToolDocs` is provided, it contains tool docs fetched this run. Use them directly. Only re-run discovery for modules/functions not listed there.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasSkills }}\\n### Loaded Skills\\n\\nWhen `inputs.loadedSkills` is provided, it contains skill guides loaded via the runtime-exposed `discover` primitive or forward-time skills. Apply relevant guides directly. Call `discover` with skills to load additional skills as needed.\\n{{ if skillUsageMode }}\\n\\nIf `used(...)` is available, call it once for each loaded skill that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the skill's rendered `ID:` value. Keep reasons short. Do not report skills that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded (including any the distiller forwarded). The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn.\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n\\n### How to Work\\n\\n- Start from `inputs.executorRequest`, `inputs.distilledContext`, non-context task inputs, and prior successful Action Log results. Don't repeat probes already in the Action Log.\\n- Treat direct action requests as work to attempt with available functions. If a function fails or the environment denies the action, capture the real error, status, output, or exception in the evidence for the responder.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret narrowed text — never pass raw `inputs.*` to it.\\n- Discovery calls (`discover`) can appear alongside other code — the runtime runs them first automatically.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible. If the task is complete, finish with `await final(\\\"...\\\", { result })` instead of logging.\\n{{ else }}\\n- Capture runtime results into variables when the language requires it; inspect intermediate values using the output/print mechanism described in the runtime usage instructions.\\n{{ /if }}\\n- Before calling `askClarification`, check whether any available function can resolve the need first.\\n{{ if hasAgentStatusCallback }}\\n- Keep the user updated: call the runtime-exposed `reportSuccess` primitive after completing sub-tasks and `reportFailure` when something goes wrong{{ if isJavaScriptRuntime }} (for example, `await reportSuccess(message)`){{ /if }}.\\n{{ /if }}\\n{{ if isJavaScriptRuntime }}\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst plan = await llmQuery([{\\n  query: 'Determine which messages require a refund response and draft a compact action plan.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(plan);\\n```\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n{{ /if }}\\n\\n{{ if isJavaScriptRuntime }}\\nWhen done, call `await final(task, evidence)`:\\n{{ else }}\\nWhen done, call the runtime-exposed `final(task, evidence)` primitive:\\n{{ /if }}\\n\\n- `task` — a one-line instruction the **responder** will follow when writing the user-facing output fields (e.g. \\\"Answer the user's question using the matched emails\\\").\\n- `evidence` — the curated data the responder will read to follow `task`. Pass narrowed runtime values with only the fields that matter, not raw `inputs.*`. Use plain keys (for example, `matchedEmails`) — don't wrap under the output field name.\\n\\nDo not pre-format the answer; the responder writes the output fields.\\n\\nValid completion turns:\\n\\n{{ if isJavaScriptRuntime }}\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Answer the user's question using the gathered evidence\\\", { evidence });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which file should I analyze?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"responder_template\":\"## Answer Synthesis Agent\\n\\nYou synthesize the final answer from the evidence the actor gathered. You do not run code, call tools, or invoke agents — you read input fields and write the output fields.\\n\\n### Reading the actor's payload\\n\\n`Context Data` has two keys:\\n\\n- `task` — a one-line instruction telling you what to write into the output fields.\\n- `evidence` — the data the actor curated for you to follow that instruction.\\n\\n### Rules\\n\\n1. Follow `Context Data.task` using `Context Data.evidence` and any other input fields provided.\\n2. When emitting a JSON output field, write the value flat — do **not** wrap it under a key matching the field's title. The field is already named.\\n3. If `evidence` lacks sufficient information, give the best possible answer from what's available across all input fields.\\n4. Do not contradict actor evidence. If evidence contains a tool result, failure, status, output, or exception, report that result rather than inventing a capability limit.\\n\\n### Context variables that were analyzed (metadata only)\\n{{ contextVarSummary }}\\n{{ if hasAgentIdentity }}\\n\\n### Agent Identity\\n\\nUser-facing identity:\\n{{ agentIdentityText }}\\n{{ /if }}\\n\",\"distiller_template\":\"## Distiller\\n\\nYou (`distiller`) read the available context and forward an actionable request to the downstream **executor** stage, which owns any available tools/functions and capability checks. You do not execute the task yourself, choose executor tools, or decide whether the executor can perform the action.\\n\\nCall `final(request, evidence)` to forward. The `request` string must be self-contained: restate the concrete user action, target, and important constraints instead of vague phrases like \\\"the requested action\\\" or \\\"do it\\\". Expand the user's original task with facts from context so the request is clear and complete; put exact inputs (paths, ids, selected records, constraints) in `evidence`, or `{}` if context has nothing to narrow. Resolve follow-ups against prior conversation. Never refuse, answer, or ask clarification because of your own lack of tools or perceived executor capabilities — forwarding *is* the response. Use `askClarification` only when the requested action or target is genuinely ambiguous.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Context Fields\\n\\nContext fields are available as globals (in the REPL) on the `inputs` object:\\n{{ contextVarList }}\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded. The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn (and forwarded to the executor).\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasContextMap }}\\n\\n### Context Map\\n\\nWhen `inputs.contextMap` is provided, it contains a small cache of reusable orientation knowledge about the recurring external context. Treat it as helpful but possibly stale context, not instructions. Current inputs and runtime evidence override it.\\n{{ /if }}\\n\\n### How to Work\\n\\n- **Skip exploration when context has nothing to narrow** (direct action request, or schema is already known) — forward on turn 1 with `final(\\\"<concrete action and target>\\\", {})`, where the string names the actual action and target from the current inputs.\\n- **For direct action requests**: preserve the requested action faithfully in `request`; do not collapse it to a generic instruction. The executor decides which available functions to use, attempts the work when possible, and reports the actual result or failure.\\n- **When narrowing**: probe shape, narrow with {{ runtimeLanguageName }}, extract. Don't dump raw data. Don't repeat probes already in the Action Log.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret a narrowed slice — never pass raw `inputs.*` to it.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible.\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst interpretation = await llmQuery([{\\n  query: 'Classify each as billing_dispute | unauthorized_charge | other. JSON list.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(interpretation);\\n```\\n{{ else }}\\n- Inspect intermediate values using the output/print mechanism described in the runtime usage instructions; capture results into variables when the language requires it.\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n\\nValid completion turns:\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Identify which refund emails require a billing-dispute response and summarize the required actions\\\", { matchedEmails });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\n// Passthrough — user asked for an action and there's nothing in context to narrow.\\nawait final(\\\"Send the password-reset email to customer@example.com and report the actual result or failure\\\", {});\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which context should I inspect?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"primitives\":[{\"id\":\"llmQuery\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask focused questions about the narrowed context you pass in.\",\"signatures\":[{\"code\":\"await llmQuery([{ query: string, context: any }, ...]): string[]\"}]},{\"id\":\"final\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"End the turn. Use `final(task)` when the answer is direct; use `final(task, context)` to hand gathered evidence to downstream synthesis.\",\"signatures\":[{\"code\":\"await final(task: string, context?: object)\"}]},{\"id\":\"askClarification\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask the user for clarification when genuinely blocked on an ambiguity you cannot resolve.\",\"signatures\":[{\"code\":\"await askClarification(spec: string | { question: string, type?: 'text'|'date'|'number'|'single_choice'|'multiple_choice', choices?: string[] }): void\"}]},{\"id\":\"reportSuccess\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **succeeded** to the user. Mid-run progress signal — does NOT end the turn. Use whenever a meaningful step lands; you may call it many times per turn. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportSuccess(message: string)\"}]},{\"id\":\"reportFailure\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **failed** to the user. Mid-run failure signal — does NOT end the turn; the actor continues and may retry. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportFailure(message: string)\"}]},{\"id\":\"inspectRuntime\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"hasInspectRuntime\",\"description\":\"Returns a compact snapshot of variables you've created in this session. Use to re-ground yourself when the conversation is long.\",\"signatures\":[{\"code\":\"await inspectRuntime(): string\"}]},{\"id\":\"discover\",\"stages\":[\"executor\"],\"enabledByAny\":[\"discoveryMode\",\"skillsMode\"],\"description\":\"Load tool docs and skill guides into the next turn. Use one batched call.\",\"signatures\":[{\"code\":\"await discover(item: string): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(items: string[]): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { skills: string | string[] }): void\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { tools?: string | string[], skills?: string | string[] }): void\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}],\"examples\":[{\"code\":\"await discover('db');\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(['db', 'db.search']);\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ skills: ['release checklist'] });\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ tools: ['db'], skills: ['release checklist'] });\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}]},{\"id\":\"recall\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"memoriesMode\",\"description\":\"Recall memories by description. Matched `{id, content}` entries land on `inputs.memories` next turn — read it to see what landed. Returns nothing.\",\"signatures\":[{\"code\":\"await recall(searches: string[]): void\"}]},{\"id\":\"used\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"usageTrackingMode\",\"description\":\"Declare a loaded memory id or skill id that actually influenced this turn. Loaded-but-unused entries must be omitted. Returns nothing.\",\"signatures\":[{\"code\":\"await used(id: string, reason?: string): void\"}]}]}")
    template = _core_get(data, "responder_template", "")
    out = _rlm_render_template(template, vars, "rlm/responder.md")
    return out


def _render_rlm_distiller_description(state: Any, options: Any) -> str:
    _core_coverage_mark("_render_rlm_distiller_description")
    empty_map = {}
    empty_list = []
    contract = _core_get(state, "runtime_contract", empty_map)
    flags = _build_rlm_flags(options)
    primitives_list = _render_actor_primitives_list("distiller", flags)
    context_fields = _core_get(state, "context_fields", empty_list)
    context_var_list = _rlm_context_var_list(context_fields)
    language = _core_get(contract, "language", "JavaScript")
    code_field_title = _core_get(contract, "code_field_title", "Javascript Code")
    code_fence_language = _core_get(contract, "code_fence_language", "js")
    is_javascript = _core_get(contract, "is_javascript", True)
    usage_instructions = _core_get(contract, "usage_instructions", "")
    memories_mode = _core_get(flags, "memoriesMode", False)
    memory_usage_camel = _core_get(options, "memoryUsageMode", False)
    memory_usage_mode = _core_get(options, "memory_usage_mode", memory_usage_camel)
    cm_state = _core_get(state, "context_map", None)
    cm_text = _core_get(cm_state, "text", "")
    cm_has = _core_ne(cm_text, "")
    vars = {}
    vars["contextVarList"] = context_var_list
    vars["hasContextMap"] = cm_has
    vars["contextMapText"] = cm_text
    vars["isJavaScriptRuntime"] = is_javascript
    vars["memoriesMode"] = memories_mode
    vars["memoryUsageMode"] = memory_usage_mode
    vars["primitivesList"] = primitives_list
    vars["runtimeCodeFenceLanguage"] = code_fence_language
    vars["runtimeCodeFieldTitle"] = code_field_title
    vars["runtimeLanguageName"] = language
    vars["runtimeUsageInstructions"] = usage_instructions
    data = _core_json_parse("{\"schema_version\":\"axir-rlm-prompts-v1\",\"executor_template\":\"## Executor\\n\\nYou (`executor`) are the task-execution stage in a two-stage pipeline. Your ONLY job is to write {{ runtimeLanguageName }} code that runs in the {{ runtimeLanguageName }} runtime (REPL) to complete tasks using the tools available to you. A separate (`responder`) agent downstream synthesizes the final answer.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Executor Request & Distilled Context\\n\\nThe prior distiller stage produced two extra inputs:\\n\\n- `inputs.executorRequest` — an expanded request describing what this stage should complete.\\n- `inputs.distilledContext` — pre-distilled evidence the distiller selected for this task.\\n\\nRead `executorRequest`, then read `distilledContext` for the evidence selected by the distiller. Raw context fields are not available in this stage. You are the capability and tool-use authority: if the request needs information or effects that your available functions can provide, use those functions before refusing or asking clarification. If the distilled evidence is sufficient, finish directly with `final(...)`. Call `askClarification(...)` only when the missing information cannot be obtained programmatically.\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n\\n{{ functionsList }}\\n{{ if discoveryMode }}\\n\\n{{ if hasModules }}\\n### Available Modules\\n{{ modulesList }}\\n{{ /if }}\\n{{ if hasDiscoveredDocs }}\\n### Discovered Tool Docs\\n\\nWhen `inputs.discoveredToolDocs` is provided, it contains tool docs fetched this run. Use them directly. Only re-run discovery for modules/functions not listed there.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasSkills }}\\n### Loaded Skills\\n\\nWhen `inputs.loadedSkills` is provided, it contains skill guides loaded via the runtime-exposed `discover` primitive or forward-time skills. Apply relevant guides directly. Call `discover` with skills to load additional skills as needed.\\n{{ if skillUsageMode }}\\n\\nIf `used(...)` is available, call it once for each loaded skill that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the skill's rendered `ID:` value. Keep reasons short. Do not report skills that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded (including any the distiller forwarded). The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn.\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n\\n### How to Work\\n\\n- Start from `inputs.executorRequest`, `inputs.distilledContext`, non-context task inputs, and prior successful Action Log results. Don't repeat probes already in the Action Log.\\n- Treat direct action requests as work to attempt with available functions. If a function fails or the environment denies the action, capture the real error, status, output, or exception in the evidence for the responder.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret narrowed text — never pass raw `inputs.*` to it.\\n- Discovery calls (`discover`) can appear alongside other code — the runtime runs them first automatically.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible. If the task is complete, finish with `await final(\\\"...\\\", { result })` instead of logging.\\n{{ else }}\\n- Capture runtime results into variables when the language requires it; inspect intermediate values using the output/print mechanism described in the runtime usage instructions.\\n{{ /if }}\\n- Before calling `askClarification`, check whether any available function can resolve the need first.\\n{{ if hasAgentStatusCallback }}\\n- Keep the user updated: call the runtime-exposed `reportSuccess` primitive after completing sub-tasks and `reportFailure` when something goes wrong{{ if isJavaScriptRuntime }} (for example, `await reportSuccess(message)`){{ /if }}.\\n{{ /if }}\\n{{ if isJavaScriptRuntime }}\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst plan = await llmQuery([{\\n  query: 'Determine which messages require a refund response and draft a compact action plan.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(plan);\\n```\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n{{ /if }}\\n\\n{{ if isJavaScriptRuntime }}\\nWhen done, call `await final(task, evidence)`:\\n{{ else }}\\nWhen done, call the runtime-exposed `final(task, evidence)` primitive:\\n{{ /if }}\\n\\n- `task` — a one-line instruction the **responder** will follow when writing the user-facing output fields (e.g. \\\"Answer the user's question using the matched emails\\\").\\n- `evidence` — the curated data the responder will read to follow `task`. Pass narrowed runtime values with only the fields that matter, not raw `inputs.*`. Use plain keys (for example, `matchedEmails`) — don't wrap under the output field name.\\n\\nDo not pre-format the answer; the responder writes the output fields.\\n\\nValid completion turns:\\n\\n{{ if isJavaScriptRuntime }}\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Answer the user's question using the gathered evidence\\\", { evidence });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which file should I analyze?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"responder_template\":\"## Answer Synthesis Agent\\n\\nYou synthesize the final answer from the evidence the actor gathered. You do not run code, call tools, or invoke agents — you read input fields and write the output fields.\\n\\n### Reading the actor's payload\\n\\n`Context Data` has two keys:\\n\\n- `task` — a one-line instruction telling you what to write into the output fields.\\n- `evidence` — the data the actor curated for you to follow that instruction.\\n\\n### Rules\\n\\n1. Follow `Context Data.task` using `Context Data.evidence` and any other input fields provided.\\n2. When emitting a JSON output field, write the value flat — do **not** wrap it under a key matching the field's title. The field is already named.\\n3. If `evidence` lacks sufficient information, give the best possible answer from what's available across all input fields.\\n4. Do not contradict actor evidence. If evidence contains a tool result, failure, status, output, or exception, report that result rather than inventing a capability limit.\\n\\n### Context variables that were analyzed (metadata only)\\n{{ contextVarSummary }}\\n{{ if hasAgentIdentity }}\\n\\n### Agent Identity\\n\\nUser-facing identity:\\n{{ agentIdentityText }}\\n{{ /if }}\\n\",\"distiller_template\":\"## Distiller\\n\\nYou (`distiller`) read the available context and forward an actionable request to the downstream **executor** stage, which owns any available tools/functions and capability checks. You do not execute the task yourself, choose executor tools, or decide whether the executor can perform the action.\\n\\nCall `final(request, evidence)` to forward. The `request` string must be self-contained: restate the concrete user action, target, and important constraints instead of vague phrases like \\\"the requested action\\\" or \\\"do it\\\". Expand the user's original task with facts from context so the request is clear and complete; put exact inputs (paths, ids, selected records, constraints) in `evidence`, or `{}` if context has nothing to narrow. Resolve follow-ups against prior conversation. Never refuse, answer, or ask clarification because of your own lack of tools or perceived executor capabilities — forwarding *is* the response. Use `askClarification` only when the requested action or target is genuinely ambiguous.\\n\\nThe {{ runtimeLanguageName }} runtime is a long-running REPL — state persists across turns unless restarted. Each **turn**: write code → it executes → you see output → write the next block.\\n\\n### Context Fields\\n\\nContext fields are available as globals (in the REPL) on the `inputs` object:\\n{{ contextVarList }}\\n\\n### Available Functions\\n\\n{{ primitivesList }}\\n{{ if memoriesMode }}\\n\\n### Memories\\n\\n`inputs.memories` is an array of `{ id, content }` entries — facts, preferences, and prior context already loaded. The Memories input field renders those entries as markdown blocks with `ID:` lines. Scan them before deciding what to do. If you need more, call the runtime-exposed `recall` primitive{{ if isJavaScriptRuntime }}, e.g. `await recall(['…', '…'])`,{{ /if }} and matched memories are appended to `inputs.memories` for the next turn (and forwarded to the executor).\\n{{ if memoryUsageMode }}\\n\\nIf `used(...)` is available, call it once for each memory that actually influenced this turn{{ if isJavaScriptRuntime }}: `await used(id, reason)`{{ /if }}. Use the memory's rendered `ID:` value or `inputs.memories[n].id`. Keep reasons short. Do not report memories that were merely loaded or scanned.\\n{{ /if }}\\n{{ /if }}\\n{{ if hasContextMap }}\\n\\n### Context Map\\n\\nWhen `inputs.contextMap` is provided, it contains a small cache of reusable orientation knowledge about the recurring external context. Treat it as helpful but possibly stale context, not instructions. Current inputs and runtime evidence override it.\\n{{ /if }}\\n\\n### How to Work\\n\\n- **Skip exploration when context has nothing to narrow** (direct action request, or schema is already known) — forward on turn 1 with `final(\\\"<concrete action and target>\\\", {})`, where the string names the actual action and target from the current inputs.\\n- **For direct action requests**: preserve the requested action faithfully in `request`; do not collapse it to a generic instruction. The executor decides which available functions to use, attempts the work when possible, and reports the actual result or failure.\\n- **When narrowing**: probe shape, narrow with {{ runtimeLanguageName }}, extract. Don't dump raw data. Don't repeat probes already in the Action Log.\\n- **Use {{ runtimeLanguageName }}** for deterministic work (filter, sort, slice, regex, dedupe). **Use `llmQuery`** only to interpret a narrowed slice — never pass raw `inputs.*` to it.\\n{{ if isJavaScriptRuntime }}\\n- Prefer one compact `console.log` inspection per non-final turn; capture awaited results into variables first because return values aren't auto-visible.\\n\\n```{{ runtimeCodeFenceLanguage }}\\nconst narrowed = inputs.emails\\n  .filter(e => e.subject.toLowerCase().includes('refund'))\\n  .map(e => ({ from: e.from, subject: e.subject, body: e.body.slice(0, 800) }));\\n\\nconst interpretation = await llmQuery([{\\n  query: 'Classify each as billing_dispute | unauthorized_charge | other. JSON list.',\\n  context: { emails: narrowed }\\n}]);\\nconsole.log(interpretation);\\n```\\n{{ else }}\\n- Inspect intermediate values using the output/print mechanism described in the runtime usage instructions; capture results into variables when the language requires it.\\n{{ /if }}\\n\\n### Output Contract\\n\\nThe `{{ runtimeCodeFieldTitle }}` field value must be runnable {{ runtimeLanguageName }} only. Do not put prose or plain labels like `task:` / `evidence:` inside the value.\\n{{ if isJavaScriptRuntime }}\\nNever combine `console.log` with `final()` or `askClarification()` in the same turn.\\n\\nValid completion turns:\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait final(\\\"Identify which refund emails require a billing-dispute response and summarize the required actions\\\", { matchedEmails });\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\n// Passthrough — user asked for an action and there's nothing in context to narrow.\\nawait final(\\\"Send the password-reset email to customer@example.com and report the actual result or failure\\\", {});\\n```\\n\\n```{{ runtimeCodeFenceLanguage }}\\nawait askClarification(\\\"Which context should I inspect?\\\");\\n```\\n{{ else }}\\nCompletion turns must call the runtime-exposed `final` or `askClarification` primitive using the syntax described in the runtime usage instructions.\\n{{ /if }}\\n\\n## {{ runtimeLanguageName }} Runtime Usage Instructions\\n{{ runtimeUsageInstructions }}\\n\",\"primitives\":[{\"id\":\"llmQuery\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask focused questions about the narrowed context you pass in.\",\"signatures\":[{\"code\":\"await llmQuery([{ query: string, context: any }, ...]): string[]\"}]},{\"id\":\"final\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"End the turn. Use `final(task)` when the answer is direct; use `final(task, context)` to hand gathered evidence to downstream synthesis.\",\"signatures\":[{\"code\":\"await final(task: string, context?: object)\"}]},{\"id\":\"askClarification\",\"stages\":[\"distiller\",\"executor\"],\"description\":\"Ask the user for clarification when genuinely blocked on an ambiguity you cannot resolve.\",\"signatures\":[{\"code\":\"await askClarification(spec: string | { question: string, type?: 'text'|'date'|'number'|'single_choice'|'multiple_choice', choices?: string[] }): void\"}]},{\"id\":\"reportSuccess\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **succeeded** to the user. Mid-run progress signal — does NOT end the turn. Use whenever a meaningful step lands; you may call it many times per turn. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportSuccess(message: string)\"}]},{\"id\":\"reportFailure\",\"stages\":[\"executor\"],\"enabledBy\":\"hasAgentStatusCallback\",\"description\":\"Report a sub-task as **failed** to the user. Mid-run failure signal — does NOT end the turn; the actor continues and may retry. Use `final(...)` to end the turn.\",\"signatures\":[{\"code\":\"await reportFailure(message: string)\"}]},{\"id\":\"inspectRuntime\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"hasInspectRuntime\",\"description\":\"Returns a compact snapshot of variables you've created in this session. Use to re-ground yourself when the conversation is long.\",\"signatures\":[{\"code\":\"await inspectRuntime(): string\"}]},{\"id\":\"discover\",\"stages\":[\"executor\"],\"enabledByAny\":[\"discoveryMode\",\"skillsMode\"],\"description\":\"Load tool docs and skill guides into the next turn. Use one batched call.\",\"signatures\":[{\"code\":\"await discover(item: string): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(items: string[]): void\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { skills: string | string[] }): void\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover(request: { tools?: string | string[], skills?: string | string[] }): void\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}],\"examples\":[{\"code\":\"await discover('db');\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover(['db', 'db.search']);\",\"enabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ skills: ['release checklist'] });\",\"enabledBy\":\"skillsMode\",\"disabledBy\":\"discoveryMode\"},{\"code\":\"await discover({ tools: ['db'], skills: ['release checklist'] });\",\"enabledByAny\":[\"discoveryMode+skillsMode\"]}]},{\"id\":\"recall\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"memoriesMode\",\"description\":\"Recall memories by description. Matched `{id, content}` entries land on `inputs.memories` next turn — read it to see what landed. Returns nothing.\",\"signatures\":[{\"code\":\"await recall(searches: string[]): void\"}]},{\"id\":\"used\",\"stages\":[\"distiller\",\"executor\"],\"enabledBy\":\"usageTrackingMode\",\"description\":\"Declare a loaded memory id or skill id that actually influenced this turn. Loaded-but-unused entries must be omitted. Returns nothing.\",\"signatures\":[{\"code\":\"await used(id: string, reason?: string): void\"}]}]}")
    template = _core_get(data, "distiller_template", "")
    out = _rlm_render_template(template, vars, "rlm/distiller.md")
    return out


def _record_policy_event(state: Any, action: str, payload: Any) -> None:
    _core_coverage_mark("_record_policy_event")
    empty_list = []
    trace = _core_get(state, "policy_trace", empty_list)
    event = {}
    event["type"] = "policy_event"
    event["action"] = action
    event["payload"] = payload
    trace.append(event)
    state["policy_trace"] = trace
    none = _core_none()
    return none


def _normalize_policy_action_result(action: str, payload: Any) -> Any:
    _core_coverage_mark("_normalize_policy_action_result")
    out = {}
    null_value = _core_none()
    vocabulary = _agent_policy_vocabulary_registry()
    empty_list = []
    effect_only_actions = _core_get(vocabulary, "effect_only_actions", empty_list)
    out["action"] = action
    out["payload"] = payload
    is_effect = _core_contains(effect_only_actions, action)
    if is_effect:
        out["returns"] = null_value
        out["effect_only"] = True
    else:
        out["returns"] = payload
        out["effect_only"] = False
    return out


def _build_agent_actor_prompt_policy(state: Any) -> Any:
    _core_coverage_mark("_build_agent_actor_prompt_policy")
    runtime_contract = _core_get(state, "runtime_contract", None)
    code_field_name = _core_get(runtime_contract, "code_field_name", "javascriptCode")
    code_field_title = _core_get(runtime_contract, "code_field_title", "Javascript Code")
    code_fence_language = _core_get(runtime_contract, "code_fence_language", "js")
    stable = []
    stable.append("input")
    stable.append("executorRequest")
    stable.append("distilledContext")
    stable.append("contextMetadata")
    stable.append("contextMap")
    stable.append("memories")
    stable.append("discoveredToolDocs")
    stable.append("loadedSkills")
    stable.append("summarizedActorLog")
    dynamic = []
    dynamic.append("guidanceLog")
    dynamic.append("actionLog")
    dynamic.append("liveRuntimeState")
    dynamic.append("contextPressure")
    out = {}
    out["stable_cached_fields"] = stable
    out["dynamic_uncached_fields"] = dynamic
    out["code_field_name"] = code_field_name
    out["code_field_title"] = code_field_title
    out["code_fence_language"] = code_fence_language
    out["cache_order"] = "stable_before_dynamic"
    return out


def _resolve_agent_context_policy(options: Any) -> Any:
    _core_coverage_mark("_resolve_agent_context_policy")
    empty_map = {}
    context_registry = _agent_context_policy_registry()
    option_keys = _core_get(context_registry, "option_keys", empty_map)
    policy_camel_key = _core_get(option_keys, "camel", "contextPolicy")
    policy_snake_key = _core_get(option_keys, "snake", "context_policy")
    preset_key = _core_get(option_keys, "preset", "preset")
    budget_key = _core_get(option_keys, "budget", "budget")
    summarizer_camel_key = _core_get(option_keys, "summarizer_camel", "summarizerOptions")
    summarizer_snake_key = _core_get(option_keys, "summarizer_snake", "summarizer_options")
    max_runtime_camel_key = _core_get(option_keys, "max_runtime_camel", "maxRuntimeChars")
    max_runtime_snake_key = _core_get(option_keys, "max_runtime_snake", "max_runtime_chars")
    policy_camel = _core_get(options, policy_camel_key, empty_map)
    policy = _core_get(options, policy_snake_key, policy_camel)
    policy_is_map = _core_type_is(policy, "object")
    if policy_is_map:
        pass
    else:
        policy = empty_map
    allowed_keys = _core_get(context_registry, "allowed_keys", None)
    allowed_is_list = _core_type_is(allowed_keys, "list")
    if allowed_is_list:
        pass
    else:
        allowed_keys = []
    for key in policy:
        allowed = _core_contains(allowed_keys, key)
        disallowed = _core_not(allowed)
        if disallowed:
            error_message = _agent_context_policy_migration_error(key)
            error_policy = _core_runtime_error(error_message)
            raise error_policy
        else:
            pass
    default_preset = _core_get(context_registry, "default_preset", "checkpointed")
    default_budget = _core_get(context_registry, "default_budget", "balanced")
    preset = _core_get(policy, preset_key, default_preset)
    budget = _core_get(policy, budget_key, default_budget)
    budget_profile = _agent_context_budget_profile(budget)
    preset_profile = _agent_context_preset_profile(preset)
    target_prompt_chars = _core_get(budget_profile, "targetPromptChars", 16000)
    inspect_threshold = _core_get(budget_profile, "inspectThreshold", 13600)
    action_replay = _core_get(preset_profile, "actionReplay", "full")
    recent_by_budget = _core_get(preset_profile, "recentFullActionsByBudget", empty_map)
    recent_default = _core_get(preset_profile, "recentFullActions", 1)
    recent_full_actions = _core_get(recent_by_budget, budget, recent_default)
    error_pruning = _core_get(preset_profile, "errorPruning", False)
    hindsight = _core_get(preset_profile, "hindsight", False)
    prune_rank = _core_get(preset_profile, "pruneRank", 2)
    state_summary_enabled = _core_get(preset_profile, "stateSummary", False)
    inspect_enabled = _core_get(preset_profile, "inspect", False)
    max_entries = _core_get(preset_profile, "maxEntries", None)
    hygiene_default = _core_get(preset_profile, "defaultHygieneMode", "none")
    hygiene_pressure = _core_get(preset_profile, "pressureHygieneMode", None)
    checkpoints_enabled = _core_get(preset_profile, "checkpointsEnabled", False)
    checkpoint_trigger = _core_none()
    if checkpoints_enabled:
        checkpoint_ratio = _core_get(preset_profile, "checkpointTriggerRatio", None)
        has_checkpoint_ratio = _core_is_not_none(checkpoint_ratio)
        if has_checkpoint_ratio:
            checkpoint_trigger = _core_mul(target_prompt_chars, checkpoint_ratio)
        else:
            pass
    else:
        pass
    summarizer_camel = _core_get(options, summarizer_camel_key, empty_map)
    summarizer_options = _core_get(options, summarizer_snake_key, summarizer_camel)
    max_runtime_snake = _core_get(options, max_runtime_snake_key, None)
    max_runtime_chars = _core_get(options, max_runtime_camel_key, max_runtime_snake)
    has_max_runtime = _core_is_not_none(max_runtime_chars)
    if has_max_runtime:
        pass
    else:
        max_runtime_chars = _core_get(context_registry, "default_max_runtime_chars", 3000)
    context_hygiene = {}
    context_hygiene["defaultMode"] = hygiene_default
    has_pressure = _core_is_not_none(hygiene_pressure)
    if has_pressure:
        context_hygiene["pressureMode"] = hygiene_pressure
    else:
        pass
    state_summary = {}
    state_summary["enabled"] = state_summary_enabled
    state_summary["maxEntries"] = max_entries
    state_summary_max_chars = _core_get(context_registry, "state_summary_max_chars", 1200)
    state_summary["maxChars"] = state_summary_max_chars
    state_inspection = {}
    state_inspection["enabled"] = inspect_enabled
    state_inspection["contextThreshold"] = inspect_threshold
    checkpoints = {}
    checkpoints["enabled"] = checkpoints_enabled
    checkpoints["triggerChars"] = checkpoint_trigger
    out = {}
    none_value = _core_none()
    out["preset"] = preset
    out["budget"] = budget
    out["summarizerOptions"] = summarizer_options
    out["actionReplay"] = action_replay
    out["recentFullActions"] = recent_full_actions
    out["contextHygiene"] = context_hygiene
    out["errorPruning"] = error_pruning
    out["hindsightEvaluation"] = hindsight
    out["pruneRank"] = prune_rank
    out["rankPruneGraceTurns"] = 2
    tombstoning_opt = _core_get(options, "tombstoning", none_value)
    out["tombstoning"] = tombstoning_opt
    out["stateSummary"] = state_summary
    out["stateInspection"] = state_inspection
    out["checkpoints"] = checkpoints
    out["targetPromptChars"] = target_prompt_chars
    out["maxRuntimeChars"] = max_runtime_chars
    return out


def _resolve_agent_executor_model_policy(options: Any) -> Any:
    _core_coverage_mark("_resolve_agent_executor_model_policy")
    empty_list = []
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    executor_registry = _core_get(context_registry, "executor_model_policy", empty_map)
    migration_error = _core_get(executor_registry, "migration_error", "executorModelPolicy now expects an ordered array of { model, namespaces?, aboveErrorTurns? } entries. Manage prompt pressure with contextPolicy.budget instead of abovePromptChars.")
    legacy_keys = _core_get(executor_registry, "legacy_keys", empty_list)
    policy_snake = _core_get(options, "executor_model_policy", None)
    policy = _core_get(options, "executorModelPolicy", policy_snake)
    missing = _core_is_none(policy)
    if missing:
        none = _core_none()
        return none
    else:
        pass
    is_list = _core_type_is(policy, "list")
    if is_list:
        pass
    else:
        error_shape = _core_runtime_error(migration_error)
        raise error_shape
    out = []
    index = 0
    for entry in policy:
        entry_is_map = _core_type_is(entry, "object")
        if entry_is_map:
            pass
        else:
            message_entry = _core_string_format("executorModelPolicy[{}] must be an object", index)
            error_entry = _core_runtime_error(message_entry)
            raise error_entry
        legacy_any = False
        for legacy_key in legacy_keys:
            has_legacy_key = _core_map_contains(entry, legacy_key)
            if has_legacy_key:
                legacy_any = True
            else:
                pass
        if legacy_any:
            error_legacy = _core_runtime_error(migration_error)
            raise error_legacy
        else:
            pass
        model = _core_get(entry, "model", "")
        model_missing = _core_eq(model, "")
        if model_missing:
            message_model = _core_string_format("executorModelPolicy[{}].model must be a non-empty string", index)
            error_model = _core_runtime_error(message_model)
            raise error_model
        else:
            pass
        above = _core_get(entry, "aboveErrorTurns", None)
        namespaces = _core_get(entry, "namespaces", None)
        has_above = _core_is_not_none(above)
        has_namespaces = _core_type_is(namespaces, "list")
        if has_above:
            above_is_number = _core_type_is(above, "number")
            above_negative = _core_lt(above, 0)
            above_invalid = _core_not(above_is_number)
            above_invalid = _core_or(above_invalid, above_negative)
            if above_invalid:
                message_above = _core_string_format("executorModelPolicy[{}].aboveErrorTurns must be a finite number >= 0", index)
                error_above = _core_runtime_error(message_above)
                raise error_above
            else:
                pass
        else:
            pass
        if has_namespaces:
            valid_namespace_count = 0
            for namespace in namespaces:
                namespace_is_string = _core_type_is(namespace, "string")
                if namespace_is_string:
                    trimmed_namespace = str(namespace).strip()
                    namespace_nonempty = _core_ne(trimmed_namespace, "")
                    if namespace_nonempty:
                        valid_namespace_count = _core_add(valid_namespace_count, 1)
                    else:
                        pass
                else:
                    pass
            no_valid_namespaces = _core_eq(valid_namespace_count, 0)
            if no_valid_namespaces:
                message_namespaces = _core_string_format("executorModelPolicy[{}].namespaces must contain at least one non-empty string", index)
                error_namespaces = _core_runtime_error(message_namespaces)
                raise error_namespaces
            else:
                pass
        else:
            pass
        has_trigger = _core_or(has_above, has_namespaces)
        if has_trigger:
            pass
        else:
            message_trigger = _core_string_format("executorModelPolicy[{}] must define at least one of aboveErrorTurns or namespaces", index)
            error_trigger = _core_runtime_error(message_trigger)
            raise error_trigger
        normalized = {}
        normalized["model"] = model
        if has_above:
            normalized["aboveErrorTurns"] = above
        else:
            pass
        if has_namespaces:
            normalized["namespaces"] = namespaces
        else:
            pass
        out.append(normalized)
        index = _core_add(index, 1)
    count = _core_len(out)
    empty = _core_eq(count, 0)
    if empty:
        error_empty = _core_runtime_error("executorModelPolicy must contain at least one entry")
        raise error_empty
    else:
        pass
    return out


def _select_agent_executor_model(policy: Any, actor_model_state: Any) -> Any:
    _core_coverage_mark("_select_agent_executor_model")
    none = _core_none()
    is_list = _core_type_is(policy, "list")
    if is_list:
        pass
    else:
        return none
    errors = _core_get(actor_model_state, "consecutiveErrorTurns", 0)
    matched = _core_get(actor_model_state, "matchedNamespaces", None)
    matched_is_list = _core_type_is(matched, "list")
    if matched_is_list:
        pass
    else:
        matched = []
    selected = _core_none()
    for entry in policy:
        model = _core_get(entry, "model", "")
        above = _core_get(entry, "aboveErrorTurns", None)
        namespaces = _core_get(entry, "namespaces", None)
        trigger = False
        has_above = _core_is_not_none(above)
        if has_above:
            error_trigger = _core_gte(errors, above)
            if error_trigger:
                trigger = True
            else:
                pass
        else:
            pass
        namespaces_is_list = _core_type_is(namespaces, "list")
        if namespaces_is_list:
            for namespace in namespaces:
                namespace_match = _core_contains(matched, namespace)
                if namespace_match:
                    trigger = True
                else:
                    pass
        else:
            pass
        if trigger:
            selected = model
        else:
            pass
    return selected


def _agent_compute_effective_chat_budget(base_budget: Any, fixed_overhead_chars: Any) -> number:
    _core_coverage_mark("_agent_compute_effective_chat_budget")
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    budget_math = _core_get(context_registry, "budget_math", empty_map)
    ratio = 1
    max_system = _core_get(budget_math, "maxSystemPromptChars", 30000)
    min_ratio = _core_get(budget_math, "minEffectiveBudgetRatio", 0.25)
    overhead_ratio = _core_div(fixed_overhead_chars, max_system)
    negative_overhead = _core_mul(-1, overhead_ratio)
    ratio = _core_add(1, negative_overhead)
    too_low = _core_lt(ratio, min_ratio)
    if too_low:
        ratio = min_ratio
    else:
        pass
    too_high = _core_gt(ratio, 1)
    if too_high:
        ratio = 1
    else:
        pass
    budget = _core_mul(base_budget, ratio)
    return budget


def _agent_action_log_char_count(entries: Any) -> number:
    _core_coverage_mark("_agent_action_log_char_count")
    total = 0
    for entry in entries:
        code = _core_get(entry, "code", "")
        output = _core_get(entry, "output", "")
        code_len = _core_len(code)
        output_len = _core_len(output)
        entry_len = _core_add(code_len, output_len)
        total = _core_add(total, entry_len)
    return total


def _agent_compute_dynamic_runtime_chars(entries: Any, target_prompt_chars: Any, max_runtime_chars: Any) -> number:
    _core_coverage_mark("_agent_compute_dynamic_runtime_chars")
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    runtime_budget = _core_get(context_registry, "runtime_output_budget", empty_map)
    floor_ratio = _core_get(runtime_budget, "floorRatio", 0.15)
    min_runtime_chars = _core_get(runtime_budget, "minRuntimeChars", 400)
    current_chars = _agent_action_log_char_count(entries)
    usage_ratio = _core_div(current_chars, target_prompt_chars)
    negative_usage_ratio = _core_mul(-1, usage_ratio)
    remaining_ratio = _core_add(1, negative_usage_ratio)
    too_low = _core_lt(remaining_ratio, floor_ratio)
    if too_low:
        remaining_ratio = floor_ratio
    else:
        pass
    too_high = _core_gt(remaining_ratio, 1)
    if too_high:
        remaining_ratio = 1
    else:
        pass
    effective_min = min_runtime_chars
    max_below_min = _core_lt(max_runtime_chars, effective_min)
    if max_below_min:
        effective_min = max_runtime_chars
    else:
        pass
    candidate = _core_mul(max_runtime_chars, remaining_ratio)
    above_max = _core_gt(candidate, max_runtime_chars)
    if above_max:
        candidate = max_runtime_chars
    else:
        pass
    below_min = _core_lt(candidate, effective_min)
    if below_min:
        candidate = effective_min
    else:
        pass
    return candidate


def _agent_context_pressure(mutable_prompt_chars: Any, effective_budget_chars: Any, checkpoint_active: Any) -> str:
    _core_coverage_mark("_agent_context_pressure")
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    pressure_levels = _core_get(context_registry, "pressure_levels", empty_map)
    ok_level = _core_get(pressure_levels, "ok", empty_map)
    watch_level = _core_get(pressure_levels, "watch", empty_map)
    critical_level = _core_get(pressure_levels, "critical", empty_map)
    ok_id = _core_get(ok_level, "id", "ok")
    watch_id = _core_get(watch_level, "id", "watch")
    critical_id = _core_get(critical_level, "id", "critical")
    watch_threshold = _core_get(watch_level, "threshold", 0.7)
    critical_threshold = _core_get(critical_level, "threshold", 0.9)
    if checkpoint_active:
        return critical_id
    else:
        pass
    invalid_budget = _core_lte(effective_budget_chars, 0)
    if invalid_budget:
        return ok_id
    else:
        pass
    ratio = _core_div(mutable_prompt_chars, effective_budget_chars)
    critical = _core_gte(ratio, critical_threshold)
    if critical:
        return critical_id
    else:
        pass
    watch = _core_gte(ratio, watch_threshold)
    if watch:
        return watch_id
    else:
        pass
    return ok_id


def _agent_render_context_pressure(pressure: str) -> str:
    _core_coverage_mark("_agent_render_context_pressure")
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    pressure_levels = _core_get(context_registry, "pressure_levels", empty_map)
    level = _core_get(pressure_levels, pressure, empty_map)
    text = _core_get(level, "text", "")
    empty_text = _core_eq(text, "")
    if empty_text:
        ok_level = _core_get(pressure_levels, "ok", empty_map)
        text = _core_get(ok_level, "text", "ok - normal context pressure; continue with focused, useful inspections.")
    else:
        pass
    return text


def _agent_smart_stringify(value: Any, max_chars: Any) -> str:
    _core_coverage_mark("_agent_smart_stringify")
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    settings = _core_get(context_registry, "smart_stringify", empty_map)
    array_threshold = _core_get(settings, "arrayThreshold", 10)
    array_head_items = _core_get(settings, "arrayHeadItems", 3)
    array_tail_items = _core_get(settings, "arrayTailItems", 2)
    is_list = _core_type_is(value, "list")
    if is_list:
        count = _core_len(value)
        large = _core_gt(count, array_threshold)
        if large:
            head = []
            tail = []
            negative_tail_items = _core_mul(-1, array_tail_items)
            tail_start = _core_add(count, negative_tail_items)
            index = 0
            for item in value:
                item_text = _core_json_stringify(item)
                in_head = _core_lt(index, array_head_items)
                if in_head:
                    head.append(item_text)
                else:
                    pass
                in_tail = _core_gte(index, tail_start)
                if in_tail:
                    tail.append(item_text)
                else:
                    pass
                index = _core_add(index, 1)
            head_text = _core_string_join(",\n  ", head)
            tail_text = _core_string_join(",\n  ", tail)
            hidden = _core_add(count, -5)
            out = _core_string_format("[\n  {},\n  ... [{} hidden items],\n  {}\n]", head_text, hidden, tail_text)
            return out
        else:
            pass
    else:
        pass
    json = _core_json_pretty(value)
    return json


def _agent_record_context_event(state: Any, event: Any) -> Any:
    _core_coverage_mark("_agent_record_context_event")
    empty_list = []
    events = _core_get(state, "context_events", empty_list)
    events.append(event)
    state["context_events"] = events
    return event


def _agent_entry_turn(entry: Any, fallback: Any) -> number:
    _core_coverage_mark("_agent_entry_turn")
    turn = _core_get(entry, "turn", fallback)
    return turn


def _agent_entry_is_error(entry: Any) -> bool:
    _core_coverage_mark("_agent_entry_is_error")
    tags = _core_get(entry, "tags", None)
    tags_is_list = _core_type_is(tags, "list")
    if tags_is_list:
        pass
    else:
        tags = []
    tag_error = _core_contains(tags, "error")
    is_error = _core_get(entry, "is_error", tag_error)
    return is_error


def _agent_entry_summary(entry: Any, fallback_turn: Any) -> str:
    _core_coverage_mark("_agent_entry_summary")
    tombstone = _core_get(entry, "tombstone", "")
    has_tombstone = _core_ne(tombstone, "")
    if has_tombstone:
        return tombstone
    else:
        pass
    turn = _agent_entry_turn(entry, fallback_turn)
    summary = _core_get(entry, "summary", "")
    has_summary = _core_ne(summary, "")
    if has_summary:
        return summary
    else:
        pass
    kind = _core_get(entry, "kind", "result")
    output = _core_get(entry, "output", "")
    preview = _core_string_slice(output, 0, 180)
    text = _core_string_format("{} turn result: {}", kind, preview)
    is_error = _agent_entry_is_error(entry)
    if is_error:
        text = _core_string_format("error turn {}: {}", turn, preview)
    else:
        pass
    return text


def _agent_entry_callables_text(entry: Any) -> str:
    _core_coverage_mark("_agent_entry_callables_text")
    empty_list = []
    calls = _core_get(entry, "_functionCalls", empty_list)
    names = []
    calls_is_list = _core_type_is(calls, "list")
    if calls_is_list:
        for call in calls:
            qualified = _core_get(call, "qualifiedName", "")
            has_qualified = _core_ne(qualified, "")
            if has_qualified:
                known = _core_contains(names, qualified)
                new_name = _core_not(known)
                if new_name:
                    names.append(qualified)
                else:
                    pass
            else:
                pass
    else:
        pass
    direct = _core_get(entry, "_directQualifiedCalls", empty_list)
    direct_is_list = _core_type_is(direct, "list")
    if direct_is_list:
        for direct_name in direct:
            has_direct = _core_ne(direct_name, "")
            if has_direct:
                known_direct = _core_contains(names, direct_name)
                new_direct = _core_not(known_direct)
                if new_direct:
                    names.append(direct_name)
                else:
                    pass
            else:
                pass
    else:
        pass
    count = _core_len(names)
    empty = _core_eq(count, 0)
    if empty:
        return "none"
    else:
        pass
    text = _core_string_join(", ", names)
    return text


def _agent_distill_structured_action_output(output: str) -> str:
    _core_coverage_mark("_agent_distill_structured_action_output")
    has_failed_line = _core_contains(output, "FAILED ")
    has_passed = _core_contains(output, " passed")
    has_failed_count = _core_contains(output, " failed")
    looks_test = _core_and(has_failed_line, has_passed)
    looks_test = _core_and(looks_test, has_failed_count)
    if looks_test:
        lines = _core_string_split_trim_nonempty(output, "\n")
        failure = ""
        counts = ""
        for line in lines:
            line_is_failure = _core_string_starts_with(line, "FAILED ")
            no_failure_yet = _core_eq(failure, "")
            take_failure = _core_and(line_is_failure, no_failure_yet)
            if take_failure:
                failure = line
            else:
                pass
            line_has_passed = _core_contains(line, " passed")
            line_has_failed = _core_contains(line, " failed")
            line_counts = _core_and(line_has_passed, line_has_failed)
            if line_counts:
                counts = line
            else:
                pass
        clean_counts = _core_regex_replace("^=+\\s*", "", counts)
        clean_counts = _core_regex_replace("\\s*=+$", "", clean_counts)
        clean_counts = _core_regex_replace("\\s+in\\s+.*$", "", clean_counts)
        test_name = _core_regex_replace("^FAILED\\s+", "", failure)
        test_name = _core_regex_replace("\\s+-\\s+.*$", "", test_name)
        detail = _core_string_slice(failure, 0, 180)
        out = _core_string_format("[DISTILLED:test-output]: {}\nFailures: {}\nError details: {}", clean_counts, test_name, detail)
        return out
    else:
        pass
    looks_json_array = _core_string_starts_with(output, "[")
    output_len = _core_len(output)
    long_output = _core_gt(output_len, 220)
    json_distill = _core_and(looks_json_array, long_output)
    if json_distill:
        preview = _core_string_slice(output, 0, 180)
        out_json = _core_string_format("[DISTILLED:json]: array\nPreview: {}", preview)
        return out_json
    else:
        pass
    return ""


def _agent_render_full_action_entry(state: Any, entry: Any) -> str:
    _core_coverage_mark("_agent_render_full_action_entry")
    tombstone = _core_get(entry, "tombstone", "")
    has_tombstone = _core_ne(tombstone, "")
    if has_tombstone:
        return tombstone
    else:
        pass
    runtime_contract = _core_get(state, "runtime_contract", None)
    fence = _core_get(runtime_contract, "code_fence_language", "javascript")
    js_fence = _core_eq(fence, "js")
    if js_fence:
        fence = "javascript"
    else:
        pass
    code = _core_get(entry, "code", "")
    output = _core_get(entry, "output", "")
    full_is_error = _core_get(entry, "is_error", False)
    if full_is_error:
        full_error = _core_get(entry, "error", "")
        full_err_text = _core_string_format("[runtime error] {}", full_error)
        full_output_has = _core_ne(output, "")
        if full_output_has:
            output = _core_string_format("{}\n{}", output, full_err_text)
        else:
            output = full_err_text
    else:
        pass
    text = _core_string_format("```{}\n{}\n```\nResult:\n{}", fence, code, output)
    return text


def _agent_render_compact_action_entry(entry: Any, turn: Any, reason: str) -> str:
    _core_coverage_mark("_agent_render_compact_action_entry")
    kind = _core_get(entry, "kind", "result")
    state_delta = _core_get(entry, "stateDelta", "No durable runtime state update")
    output = _core_get(entry, "output", "")
    compact_is_error = _core_get(entry, "is_error", False)
    if compact_is_error:
        compact_error = _core_get(entry, "error", "")
        output = _core_string_format("[runtime error] {}", compact_error)
    else:
        pass
    callables = _agent_entry_callables_text(entry)
    distilled = _agent_distill_structured_action_output(output)
    has_distilled = _core_ne(distilled, "")
    preview = _core_string_slice(output, 0, 180)
    if has_distilled:
        preview = distilled
    else:
        pass
    head = _core_string_format("[COMPACT:{}]: Turn {}. {} step.", reason, turn, kind)
    tail = _core_string_format(" State: {}. Callables: {}. Result: {}.", state_delta, callables, preview)
    text = _core_add(head, tail)
    return text


def _agent_fallback_checkpoint_summary(entries: Any, turns: Any) -> str:
    _core_coverage_mark("_agent_fallback_checkpoint_summary")
    empty_list = []
    evidence = []
    failures = []
    artifacts = []
    objective = "explore"
    fallback = 1
    for entry in entries:
        turn = _agent_entry_turn(entry, fallback)
        covered = _core_contains(turns, turn)
        if covered:
            kind = _core_get(entry, "kind", "result")
            objective = kind
            output = _core_get(entry, "output", "")
            preview = _core_string_slice(output, 0, 200)
            line = _core_string_format("Turn {}: {}", turn, preview)
            evidence.append(line)
            state_delta = _core_get(entry, "stateDelta", "")
            has_state = _core_ne(state_delta, "")
            if has_state:
                artifact = _core_string_format("Turn {}: {}", turn, state_delta)
                artifacts.append(artifact)
            else:
                pass
            is_error = _agent_entry_is_error(entry)
            if is_error:
                failures.append(line)
            else:
                pass
        else:
            pass
        fallback = _core_add(fallback, 1)
    artifact_text = _core_string_join(" | ", artifacts)
    evidence_text = _core_string_join(" | ", evidence)
    failure_text = _core_string_join(" | ", failures)
    empty_artifact = _core_eq(artifact_text, "")
    if empty_artifact:
        artifact_text = "Continue from liveRuntimeState and recent full action replay."
    else:
        pass
    empty_evidence = _core_eq(evidence_text, "")
    if empty_evidence:
        evidence_text = "none"
    else:
        pass
    empty_failures = _core_eq(failure_text, "")
    if empty_failures:
        failure_text = "none"
    else:
        pass
    head_summary = _core_string_format("Objective: {}\nCurrent state and artifacts: {}\nExact callables and formats: none\nEvidence: {}", objective, artifact_text, evidence_text)
    tail_summary = _core_string_format("\nUser constraints and preferences: none\nFailures to avoid: {}\nNext step: Continue from the latest live runtime state.", failure_text)
    summary = _core_add(head_summary, tail_summary)
    working = _agent_working_code_state(entries, turns)
    working_text = _core_get(working, "text", "")
    working_turns = _core_get(working, "turns", empty_list)
    working_count = _core_len(working_turns)
    turn_count = _core_len(turns)
    has_working = _core_ne(working_text, "")
    all_working = _core_eq(working_count, turn_count)
    if has_working:
        if all_working:
            summary = working_text
        else:
            summary = _core_string_format("{}\n\n{}", working_text, summary)
    else:
        pass
    return summary


def _agent_build_deterministic_tombstone(error_entry: Any, resolution_entry: Any) -> str:
    _core_coverage_mark("_agent_build_deterministic_tombstone")
    output = _core_get(error_entry, "output", "")
    signature = _core_string_slice(output, 0, 96)
    empty_signature = _core_eq(signature, "")
    if empty_signature:
        signature = "runtime error"
    else:
        pass
    resolved_turn = _agent_entry_turn(resolution_entry, 0)
    text = _core_string_format("[TOMBSTONE]: Resolved {} in turn {}.", signature, resolved_turn)
    return text


def _agent_apply_context_management(state: Any) -> Any:
    _core_coverage_mark("_agent_apply_context_management")
    empty_list = []
    entries = _core_get(state, "action_log", empty_list)
    policy = _core_get(state, "context_policy", None)
    error_pruning = _core_get(policy, "errorPruning", False)
    tombstoning = _core_get(policy, "tombstoning", False)
    enabled = _core_or(error_pruning, tombstoning)
    if enabled:
        pass
    else:
        return entries
    count = _core_len(entries)
    has_pairs = _core_gt(count, 1)
    if has_pairs:
        pass
    else:
        return entries
    prev = _core_none()
    has_prev = False
    for entry in entries:
        if has_prev:
            prev_is_error = _agent_entry_is_error(prev)
            current_is_error = _agent_entry_is_error(entry)
            current_success = _core_not(current_is_error)
            resolved = _core_and(prev_is_error, current_success)
            if resolved:
                existing = _core_get(prev, "tombstone", "")
                missing = _core_eq(existing, "")
                if missing:
                    tombstone = _agent_build_deterministic_tombstone(prev, entry)
                    prev["tombstone"] = tombstone
                    event = {}
                    kind = _agent_context_event_name("tombstone_created")
                    event["kind"] = kind
                    event["stage"] = "executor"
                    turn = _agent_entry_turn(prev, 0)
                    resolved_turn = _agent_entry_turn(entry, 0)
                    event["turn"] = turn
                    event["resolvedByTurn"] = resolved_turn
                    event["source"] = "deterministic"
                    summary_chars = _core_len(tombstone)
                    event["summaryChars"] = summary_chars
                    _agent_record_context_event(state, event)
                    tomb_is_true = _core_eq(tombstoning, True)
                    tomb_is_obj = _core_type_is(tombstoning, "object")
                    want_llm = _core_or(tomb_is_true, tomb_is_obj)
                    if want_llm:
                        prev["tombstone_llm_pending"] = True
                        err_code = _core_get(prev, "code", "")
                        err_output = _core_get(prev, "output", "")
                        res_code = _core_get(entry, "code", "")
                        llm_input = _core_string_format("errorCode:\n{}\n\nerrorOutput:\n{}\n\nresolutionCode:\n{}", err_code, err_output, res_code)
                        prev["tombstone_llm_input"] = llm_input
                    else:
                        pass
                else:
                    pass
            else:
                pass
        else:
            pass
        prev = entry
        has_prev = True
    state["action_log"] = entries
    return entries


def _agent_apply_llm_tombstone_summary(state: Any, client: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_apply_llm_tombstone_summary")
    empty_list = []
    entries = _core_get(state, "action_log", empty_list)
    for entry in entries:
        pending = _core_get(entry, "tombstone_llm_pending", False)
        if pending:
            llm_input = _core_get(entry, "tombstone_llm_input", "")
            instruction = "You are an internal AxAgent tombstone summarizer.\n\nWrite the output as exactly one concise line.\n- Start with [TOMBSTONE]:\n- Summarize the resolved error and the successful fix.\n- Mention one failed approach to avoid when possible.\n- Do not include code fences, bullet points, or extra prose.\n- Keep it roughly 20-40 tokens."
            tombstone = _context_map_complete(client, instruction, llm_input)
            has_text = _core_ne(tombstone, "")
            if has_text:
                entry["tombstone"] = tombstone
                entry["tombstone_source"] = "model"
                entry["tombstone_llm_pending"] = False
                event = {}
                kind = _agent_context_event_name("tombstone_created")
                event["kind"] = kind
                event["stage"] = "executor"
                event["source"] = "model"
                summary_chars = _core_len(tombstone)
                event["summaryChars"] = summary_chars
                _agent_record_context_event(state, event)
            else:
                pass
        else:
            pass
    state["action_log"] = entries
    return state


def _agent_working_code_state(entries: Any, turns: Any) -> Any:
    _core_coverage_mark("_agent_working_code_state")
    empty_list = []
    working_turns = []
    coverable_count = 0
    fallback = 1
    for entry in entries:
        turn = _agent_entry_turn(entry, fallback)
        covered = _core_contains(turns, turn)
        is_error = _agent_entry_is_error(entry)
        not_error = _core_not(is_error)
        tombstone = _core_get(entry, "tombstone", "")
        has_tombstone = _core_ne(tombstone, "")
        not_tombstone = _core_not(has_tombstone)
        include = _core_and(covered, not_error)
        include = _core_and(include, not_tombstone)
        if include:
            coverable_count = _core_add(coverable_count, 1)
        else:
            pass
        fallback = _core_add(fallback, 1)
    start = 0
    more_than_two = _core_gt(coverable_count, 2)
    if more_than_two:
        start = _core_add(coverable_count, -2)
    else:
        pass
    blocks = []
    index = 0
    fallback2 = 1
    for entry2 in entries:
        turn2 = _agent_entry_turn(entry2, fallback2)
        covered2 = _core_contains(turns, turn2)
        is_error2 = _agent_entry_is_error(entry2)
        not_error2 = _core_not(is_error2)
        tombstone2 = _core_get(entry2, "tombstone", "")
        has_tombstone2 = _core_ne(tombstone2, "")
        not_tombstone2 = _core_not(has_tombstone2)
        coverable2 = _core_and(covered2, not_error2)
        coverable2 = _core_and(coverable2, not_tombstone2)
        if coverable2:
            include_working = _core_gte(index, start)
            if include_working:
                working_turns.append(turn2)
                code = _core_get(entry2, "code", "(no code)")
                code_len = _core_len(code)
                code_too_long = _core_gt(code_len, 2000)
                if code_too_long:
                    code_head = _core_string_slice(code, 0, 2000)
                    code = _core_string_format("{}\n// ... (truncated)", code_head)
                else:
                    pass
                produced = _core_get(entry2, "producedVars", empty_list)
                produced_text = _core_string_join(", ", produced)
                produced_empty = _core_eq(produced_text, "")
                if produced_empty:
                    produced_text = "none"
                else:
                    pass
                reads = _core_get(entry2, "_durableReads", None)
                reads_is_list = _core_type_is(reads, "list")
                if reads_is_list:
                    pass
                else:
                    reads = _core_get(entry2, "referencedVars", empty_list)
                read_text = _core_string_join(", ", reads)
                read_empty = _core_eq(read_text, "")
                if read_empty:
                    read_text = "none"
                else:
                    pass
                callables = _agent_entry_callables_text(entry2)
                state_delta = _core_get(entry2, "stateDelta", "none")
                output = _core_get(entry2, "output", "(no output)")
                output_preview = _core_string_slice(output, 0, 800)
                block_head = _core_string_format("Code:\n{}\nProduced: {}\nRead: {}", code, produced_text, read_text)
                block_tail = _core_string_format("\nDirect callables: {}\nState delta: {}\nOutput: {}", callables, state_delta, output_preview)
                block = _core_add(block_head, block_tail)
                blocks.append(block)
            else:
                pass
            index = _core_add(index, 1)
        else:
            pass
        fallback2 = _core_add(fallback2, 1)
    body = _core_string_join("\n\n", blocks)
    out = {}
    out["turns"] = working_turns
    has_body = _core_ne(body, "")
    if has_body:
        text = _core_string_format("=== Working Code State (verbatim) ===\n{}", body)
        out["text"] = text
    else:
        out["text"] = ""
    return out


def _agent_refresh_checkpoint_state(state: Any) -> Any:
    _core_coverage_mark("_agent_refresh_checkpoint_state")
    empty_list = []
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    pressure_levels = _core_get(context_registry, "pressure_levels", empty_map)
    ok_level = _core_get(pressure_levels, "ok", empty_map)
    ok_pressure = _core_get(ok_level, "id", "ok")
    policy = _core_get(state, "context_policy", None)
    checkpoints = _core_get(policy, "checkpoints", None)
    enabled = _core_get(checkpoints, "enabled", False)
    if enabled:
        pass
    else:
        existing = _core_get(state, "checkpoint_state", None)
        has_existing = _core_type_is(existing, "object")
        if has_existing:
            cleared = {}
            cleared_kind = _agent_context_event_name("checkpoint_cleared")
            disabled_reason = _agent_context_event_reason("disabled")
            cleared["kind"] = cleared_kind
            cleared["stage"] = "executor"
            cleared["turn"] = 0
            cleared["coveredTurns"] = empty_list
            cleared["reason"] = disabled_reason
            _agent_record_context_event(state, cleared)
        else:
            pass
        none_checkpoint = _core_none()
        state["checkpoint_state"] = none_checkpoint
        none = _core_none()
        return none
    entries = _core_get(state, "action_log", empty_list)
    count = _core_len(entries)
    has_entries = _core_gt(count, 0)
    if has_entries:
        pass
    else:
        none_empty = _core_none()
        return none_empty
    chars = _agent_action_log_char_count(entries)
    trigger = _core_get(checkpoints, "triggerChars", 16000)
    over = _core_gte(chars, trigger)
    if over:
        pass
    else:
        current = _core_get(state, "checkpoint_state", None)
        return current
    recent = _core_get(policy, "recentFullActions", 1)
    recent_start = 0
    too_many = _core_gt(count, recent)
    if too_many:
        negative_recent = _core_mul(-1, recent)
        recent_start = _core_add(count, negative_recent)
    else:
        pass
    covered_turns = []
    index = 0
    fallback_turn = 1
    for entry in entries:
        turn = _agent_entry_turn(entry, fallback_turn)
        is_error = _agent_entry_is_error(entry)
        is_recent = _core_gte(index, recent_start)
        coverable = _core_not(is_error)
        not_recent = _core_not(is_recent)
        coverable = _core_and(coverable, not_recent)
        if coverable:
            covered_turns.append(turn)
        else:
            pass
        index = _core_add(index, 1)
        fallback_turn = _core_add(fallback_turn, 1)
    covered_count = _core_len(covered_turns)
    has_covered = _core_gt(covered_count, 0)
    if has_covered:
        pass
    else:
        none_no_covered = _core_none()
        return none_no_covered
    summary = _agent_fallback_checkpoint_summary(entries, covered_turns)
    checkpoint = {}
    fingerprint = _core_json_stable_stringify(covered_turns)
    checkpoint["fingerprint"] = fingerprint
    checkpoint["summary"] = summary
    checkpoint["turns"] = covered_turns
    cp_empty = {}
    cp_context_policy = _core_get(state, "context_policy", cp_empty)
    cp_summarizer_opts = _core_get(cp_context_policy, "summarizerOptions", None)
    cp_want_llm = _core_is_not_none(cp_summarizer_opts)
    if cp_want_llm:
        checkpoint["llm_pending"] = True
        checkpoint["llm_input"] = summary
    else:
        pass
    state["checkpoint_state"] = checkpoint
    event = {}
    created_kind = _agent_context_event_name("checkpoint_created")
    over_budget_reason = _agent_context_event_reason("over_budget")
    event["kind"] = created_kind
    event["stage"] = "executor"
    event["turn"] = count
    event["coveredTurns"] = covered_turns
    summary_len = _core_len(summary)
    event["summaryChars"] = summary_len
    event["reason"] = over_budget_reason
    _agent_record_context_event(state, event)
    return checkpoint


def _agent_build_action_log_parts(state: Any, hygiene_mode: str) -> Any:
    _core_coverage_mark("_agent_build_action_log_parts")
    empty_list = []
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    hygiene_modes = _core_get(context_registry, "hygiene_modes", empty_map)
    pressure_hygiene_mode = _core_get(hygiene_modes, "pressure", "pressure")
    aggressive_hygiene_mode = _core_get(hygiene_modes, "aggressive", "aggressive")
    entries = _core_get(state, "action_log", empty_list)
    policy = _core_get(state, "context_policy", None)
    action_replay = _core_get(policy, "actionReplay", "full")
    recent = _core_get(policy, "recentFullActions", 1)
    checkpoint_state = _core_get(state, "checkpoint_state", None)
    checkpoint_summary = _core_get(checkpoint_state, "summary", "")
    checkpoint_turns = _core_get(checkpoint_state, "turns", empty_list)
    restore_notice = _core_get(state, "restore_notice", "")
    delegated_summary = _core_get(state, "delegated_context_summary", "")
    summary_parts = []
    has_restore = _core_ne(restore_notice, "")
    if has_restore:
        summary_parts.append(restore_notice)
    else:
        pass
    has_delegated = _core_ne(delegated_summary, "")
    if has_delegated:
        delegated_text = _core_string_format("Delegated Context (runtime-only - explore with code):\n{}", delegated_summary)
        summary_parts.append(delegated_text)
    else:
        pass
    has_checkpoint_summary = _core_ne(checkpoint_summary, "")
    if has_checkpoint_summary:
        checkpoint_text = _core_string_format("Checkpoint Summary:\n{}", checkpoint_summary)
        summary_parts.append(checkpoint_text)
    else:
        pass
    summary = _core_string_join("\n\n", summary_parts)
    history_parts = []
    compactions = []
    count = _core_len(entries)
    recent_start = 0
    too_many = _core_gt(count, recent)
    if too_many:
        negative_recent = _core_mul(-1, recent)
        recent_start = _core_add(count, negative_recent)
    else:
        pass
    full_replay = _core_eq(action_replay, "full")
    checkpointed = _core_eq(action_replay, "checkpointed")
    index = 0
    fallback_turn = 1
    for entry in entries:
        turn = _agent_entry_turn(entry, fallback_turn)
        is_error = _agent_entry_is_error(entry)
        tombstone = _core_get(entry, "tombstone", "")
        has_tombstone = _core_ne(tombstone, "")
        is_recent = _core_gte(index, recent_start)
        checkpoint_covered = _core_contains(checkpoint_turns, turn)
        not_error = _core_not(is_error)
        replay_mode = _core_get(entry, "replayMode", "")
        replay_full = _core_eq(replay_mode, "full")
        replay_distill = _core_eq(replay_mode, "distill")
        replay_compact = _core_eq(replay_mode, "compact")
        replay_omit = _core_eq(replay_mode, "omit")
        covered_success = _core_and(checkpoint_covered, not_error)
        not_replay_full = _core_not(replay_full)
        covered_success = _core_and(covered_success, not_replay_full)
        rendered = ""
        if covered_success:
            rendered = ""
        else:
            render_full = False
            if replay_full:
                render_full = True
            else:
                pass
            if full_replay:
                render_full = True
            else:
                pass
            if is_recent:
                render_full = True
            else:
                pass
            if is_error:
                render_full = True
            else:
                pass
            pressure_pre = _core_eq(hygiene_mode, pressure_hygiene_mode)
            aggressive_pre = _core_eq(hygiene_mode, aggressive_hygiene_mode)
            pressure_compaction = _core_or(pressure_pre, aggressive_pre)
            old_success = _core_not(is_recent)
            old_success = _core_and(old_success, not_error)
            pressure_can_compact = _core_and(pressure_compaction, old_success)
            if pressure_can_compact:
                render_full = False
            else:
                pass
            if has_tombstone:
                rendered = tombstone
            else:
                pass
            has_rendered_pre = _core_ne(rendered, "")
            if has_rendered_pre:
                pass
            else:
                if render_full:
                    rendered = _agent_render_full_action_entry(state, entry)
                else:
                    pressure = _core_eq(hygiene_mode, pressure_hygiene_mode)
                    aggressive = _core_eq(hygiene_mode, aggressive_hygiene_mode)
                    should_compact = _core_or(pressure, aggressive)
                    should_compact = _core_or(should_compact, replay_compact)
                    should_distill = replay_distill
                    if should_distill:
                        distilled_output = _core_get(entry, "distilledOutput", "")
                        has_distilled_output = _core_ne(distilled_output, "")
                        if has_distilled_output:
                            pass
                        else:
                            raw_output_for_distill = _core_get(entry, "output", "")
                            distilled_output = _agent_distill_structured_action_output(raw_output_for_distill)
                        has_distill = _core_ne(distilled_output, "")
                        if has_distill:
                            full_text_distill = _agent_render_full_action_entry(state, entry)
                            runtime_contract_distill = _core_get(state, "runtime_contract", None)
                            fence_distill = _core_get(runtime_contract_distill, "code_fence_language", "javascript")
                            js_fence_distill = _core_eq(fence_distill, "js")
                            if js_fence_distill:
                                fence_distill = "javascript"
                            else:
                                pass
                            code_distill = _core_get(entry, "code", "")
                            rendered = _core_string_format("```{}\n{}\n```\nResult:\n{}", fence_distill, code_distill, distilled_output)
                            compaction_distill = {}
                            compaction_distill["turn"] = turn
                            compaction_distill["mode"] = "distill"
                            compaction_distill["reason"] = "structured_output"
                            original_chars_distill = _core_len(full_text_distill)
                            rendered_chars_distill = _core_len(rendered)
                            compaction_distill["originalChars"] = original_chars_distill
                            compaction_distill["renderedChars"] = rendered_chars_distill
                            compactions.append(compaction_distill)
                        else:
                            pass
                    else:
                        pass
                    rendered_after_distill = _core_ne(rendered, "")
                    if rendered_after_distill:
                        pass
                    else:
                        if should_compact:
                            reason = _agent_context_event_reason("pressure")
                            if aggressive:
                                reason = _agent_context_event_reason("lean")
                            else:
                                pass
                            full_text = _agent_render_full_action_entry(state, entry)
                            rendered = _agent_render_compact_action_entry(entry, turn, reason)
                            compaction = {}
                            compaction["turn"] = turn
                            compaction["mode"] = "compact"
                            compaction["reason"] = reason
                            original_chars = _core_len(full_text)
                            rendered_chars = _core_len(rendered)
                            compaction["originalChars"] = original_chars
                            compaction["renderedChars"] = rendered_chars
                            compactions.append(compaction)
                        else:
                            if replay_omit:
                                rendered = _agent_entry_summary(entry, turn)
                            else:
                                entry_summary = _agent_entry_summary(entry, turn)
                                rendered = _core_string_format("- Action {}: {}", turn, entry_summary)
        has_rendered = _core_ne(rendered, "")
        if has_rendered:
            history_parts.append(rendered)
        else:
            pass
        index = _core_add(index, 1)
        fallback_turn = _core_add(fallback_turn, 1)
    history = _core_string_join("\n\n", history_parts)
    out = {}
    out["summary"] = summary
    out["history"] = history
    out["compactions"] = compactions
    return out


def _agent_render_runtime_state_summary(state: Any, policy: Any) -> str:
    _core_coverage_mark("_agent_render_runtime_state_summary")
    empty_map = {}
    empty_list = []
    session_state = _core_get(state, "runtime_session_state", empty_map)
    state_summary = _core_get(policy, "stateSummary", empty_map)
    enabled = _core_get(state_summary, "enabled", False)
    if enabled:
        pass
    else:
        return ""
    max_entries = _core_get(state_summary, "maxEntries", 8)
    entries = _core_get(session_state, "entries", empty_list)
    entries_is_list = _core_type_is(entries, "list")
    if entries_is_list:
        entry_count = _core_len(entries)
        has_entries = _core_gt(entry_count, 0)
        if has_entries:
            provenance = _core_get(state, "provenance", empty_map)
            lines_structured = []
            structured_count = 0
            for entry in entries:
                under_structured_limit = _core_lt(structured_count, max_entries)
                if under_structured_limit:
                    name = _core_get(entry, "name", "")
                    type = _core_get(entry, "type", "unknown")
                    size = _core_get(entry, "size", "")
                    preview = _core_get(entry, "preview", "")
                    ctor = _core_get(entry, "ctor", "")
                    type_label = type
                    object_type = _core_eq(type, "object")
                    has_ctor = _core_ne(ctor, "")
                    object_with_ctor = _core_and(object_type, has_ctor)
                    if object_with_ctor:
                        type_label = _core_string_format("object<{}>", ctor)
                    else:
                        pass
                    has_size = _core_ne(size, "")
                    if has_size:
                        type_label = _core_string_format("{} ({})", type_label, size)
                    else:
                        pass
                    preview_text = ""
                    has_preview = _core_ne(preview, "")
                    if has_preview:
                        preview_text = _core_string_format(" = {}", preview)
                    else:
                        pass
                    prov = _core_get(provenance, name, None)
                    prov_text = ""
                    has_prov = _core_type_is(prov, "object")
                    if has_prov:
                        created_turn = _core_get(prov, "createdTurn", 0)
                        source = _core_get(prov, "source", "")
                        last_read = _core_get(prov, "lastReadTurn", 0)
                        has_source = _core_ne(source, "")
                        if has_source:
                            prov_text = _core_string_format(" [from t{} via {}", created_turn, source)
                        else:
                            prov_text = _core_string_format(" [from t{}", created_turn)
                        read_after = _core_gt(last_read, created_turn)
                        if read_after:
                            prov_text = _core_string_format("{}; read t{}", prov_text, last_read)
                        else:
                            pass
                        prov_text = _core_add(prov_text, "]")
                    else:
                        pass
                    restorable = _core_get(entry, "restorable", True)
                    snapshot_only = _core_eq(restorable, False)
                    restore_text = ""
                    if snapshot_only:
                        restore_text = " [snapshot only]"
                    else:
                        pass
                    line_base = _core_string_format("{}: {}{}", name, type_label, preview_text)
                    line_with_prov = _core_add(line_base, prov_text)
                    line = _core_add(line_with_prov, restore_text)
                    lines_structured.append(line)
                    structured_count = _core_add(structured_count, 1)
                else:
                    pass
            body_structured = _core_string_join("\n", lines_structured)
            empty_structured = _core_eq(body_structured, "")
            if empty_structured:
                body_structured = "(no user variables)"
            else:
                pass
            out_structured = _core_string_format("Current runtime state:\n{}", body_structured)
            state["runtime_state_summary"] = out_structured
            return out_structured
        else:
            pass
    else:
        pass
    globals = _core_get(session_state, "globals", None)
    bindings = _core_get(session_state, "bindings", globals)
    bindings_is_map = _core_type_is(bindings, "object")
    if bindings_is_map:
        pass
    else:
        return ""
    reserved = _agent_reserved_runtime_names()
    parts = []
    count = 0
    for key in bindings:
        reserved_key = _core_contains(reserved, key)
        allowed_key = _core_not(reserved_key)
        under_limit = _core_lt(count, max_entries)
        include_key = _core_and(allowed_key, under_limit)
        if include_key:
            value = _core_get(bindings, key, None)
            text = _core_json_stringify(value)
            line = _core_string_format("- {}: {}", key, text)
            parts.append(line)
            count = _core_add(count, 1)
        else:
            pass
    body = _core_string_join("\n", parts)
    empty = _core_eq(body, "")
    if empty:
        return ""
    else:
        pass
    out = _core_string_format("Current runtime state:\n{}", body)
    state["runtime_state_summary"] = out
    return out


def _agent_prepare_actor_context(state: Any) -> Any:
    _core_coverage_mark("_agent_prepare_actor_context")
    empty_list = []
    context_registry = _agent_context_policy_registry()
    empty_map = {}
    pressure_levels = _core_get(context_registry, "pressure_levels", empty_map)
    ok_level = _core_get(pressure_levels, "ok", empty_map)
    ok_pressure = _core_get(ok_level, "id", "ok")
    policy = _core_get(state, "context_policy", None)
    hygiene = _core_get(policy, "contextHygiene", None)
    default_hygiene = _core_get(hygiene, "defaultMode", "none")
    pressure_hygiene = _core_get(hygiene, "pressureMode", default_hygiene)
    checkpoint = _agent_refresh_checkpoint_state(state)
    parts = _agent_build_action_log_parts(state, default_hygiene)
    summary = _core_get(parts, "summary", "")
    history = _core_get(parts, "history", "")
    history_empty = _core_eq(history, "")
    if history_empty:
        history = "(no actions yet)"
    else:
        pass
    runtime_state_summary = _agent_render_runtime_state_summary(state, policy)
    guidance_log = _core_get(state, "guidance_log", empty_list)
    guidance_text = _core_json_stringify(guidance_log)
    history_chars = _core_len(history)
    guidance_chars = _core_len(guidance_text)
    runtime_chars = _core_len(runtime_state_summary)
    summary_chars = _core_len(summary)
    mutable_chars = _core_add(history_chars, guidance_chars)
    mutable_chars = _core_add(mutable_chars, runtime_chars)
    mutable_chars = _core_add(mutable_chars, summary_chars)
    target = _core_get(policy, "targetPromptChars", 16000)
    fixed = _core_get(state, "fixed_prompt_chars", 0)
    effective_budget = _agent_compute_effective_chat_budget(target, fixed)
    checkpoint_is_map = _core_type_is(checkpoint, "object")
    pressure = _agent_context_pressure(mutable_chars, effective_budget, checkpoint_is_map)
    pressure_is_ok = _core_eq(pressure, ok_pressure)
    hygiene_changes = _core_ne(pressure_hygiene, default_hygiene)
    pressure_not_ok = _core_not(pressure_is_ok)
    should_pressure = _core_and(pressure_not_ok, hygiene_changes)
    if should_pressure:
        pressure_parts = _agent_build_action_log_parts(state, pressure_hygiene)
        pressure_history = _core_get(pressure_parts, "history", "")
        pressure_history_empty = _core_eq(pressure_history, "")
        if pressure_history_empty:
            pressure_history = "(no actions yet)"
        else:
            pass
        pressure_len = _core_len(pressure_history)
        history_len = _core_len(history)
        shorter = _core_lt(pressure_len, history_len)
        if shorter:
            parts = pressure_parts
            summary = _core_get(pressure_parts, "summary", summary)
            history = pressure_history
        else:
            pass
    else:
        pass
    compactions = _core_get(parts, "compactions", empty_list)
    for compaction in compactions:
        event = {}
        action_compacted_kind = _agent_context_event_name("action_compacted")
        event["kind"] = action_compacted_kind
        event["stage"] = "executor"
        turn = _core_get(compaction, "turn", 0)
        mode = _core_get(compaction, "mode", "compact")
        default_reason = _agent_context_event_reason("pressure")
        reason = _core_get(compaction, "reason", default_reason)
        original_chars = _core_get(compaction, "originalChars", 0)
        rendered_chars = _core_get(compaction, "renderedChars", 0)
        event["turn"] = turn
        event["mode"] = mode
        event["reason"] = reason
        event["originalChars"] = original_chars
        event["renderedChars"] = rendered_chars
        _agent_record_context_event(state, event)
    action_log = _core_get(state, "action_log", empty_list)
    guidance_count = _core_len(guidance_log)
    action_count = _core_len(action_log)
    budget_event = {}
    budget_check_kind = _agent_context_event_name("budget_check")
    budget_event["kind"] = budget_check_kind
    budget_event["stage"] = "executor"
    turn = _core_add(action_count, 1)
    budget_event["turn"] = turn
    budget_event["pressure"] = pressure
    budget_event["mutablePromptChars"] = mutable_chars
    budget_event["fixedPromptChars"] = fixed
    budget_event["effectiveBudgetChars"] = effective_budget
    budget_event["targetPromptChars"] = target
    budget_event["checkpointActive"] = checkpoint_is_map
    budget_event["actionLogEntryCount"] = action_count
    budget_event["guidanceLogEntryCount"] = guidance_count
    _agent_record_context_event(state, budget_event)
    pressure_text = ""
    default_preset = _core_get(context_registry, "default_preset", "checkpointed")
    full_preset = _core_get(context_registry, "full_preset", "full")
    preset = _core_get(policy, "preset", default_preset)
    is_full = _core_eq(preset, full_preset)
    if is_full:
        pressure_text = ""
    else:
        pressure_text = _agent_render_context_pressure(pressure)
    max_runtime = _core_get(policy, "maxRuntimeChars", 3000)
    dynamic_runtime_chars = _agent_compute_dynamic_runtime_chars(action_log, target, max_runtime)
    out = {}
    out["summarizedActorLog"] = summary
    out["actionLog"] = history
    out["guidanceLog"] = guidance_text
    out["liveRuntimeState"] = runtime_state_summary
    out["contextPressure"] = pressure_text
    out["pressure"] = pressure
    out["effectiveBudgetChars"] = effective_budget
    out["mutablePromptChars"] = mutable_chars
    out["dynamicRuntimeChars"] = dynamic_runtime_chars
    state["last_actor_context"] = out
    return out


def _agent_build_action_evidence_summary(state: Any) -> str:
    _core_coverage_mark("_agent_build_action_evidence_summary")
    empty_list = []
    entries = _core_get(state, "action_log", empty_list)
    checkpoint = _core_get(state, "checkpoint_state", None)
    checkpoint_summary = _core_get(checkpoint, "summary", "")
    checkpoint_turns = _core_get(checkpoint, "turns", empty_list)
    runtime_summary = _core_get(state, "runtime_state_summary", "")
    parts = []
    parts.append("Actor stopped without calling final(...). Evidence summary:")
    has_checkpoint = _core_ne(checkpoint_summary, "")
    if has_checkpoint:
        checkpoint_text = _core_string_format("Checkpoint summary:\n{}", checkpoint_summary)
        parts.append(checkpoint_text)
    else:
        pass
    lines = []
    fallback = 1
    for entry in entries:
        turn = _agent_entry_turn(entry, fallback)
        covered = _core_contains(checkpoint_turns, turn)
        is_error = _agent_entry_is_error(entry)
        not_error_skip = _core_not(is_error)
        skip = _core_and(covered, not_error_skip)
        if skip:
            pass
        else:
            summary = _agent_entry_summary(entry, turn)
            line = _core_string_format("- Action {}: {}", turn, summary)
            lines.append(line)
        fallback = _core_add(fallback, 1)
    line_text = _core_string_join("\n", lines)
    has_lines = _core_ne(line_text, "")
    if has_lines:
        parts.append(line_text)
    else:
        no_checkpoint = _core_not(has_checkpoint)
        if no_checkpoint:
            parts.append("- No actions were taken.")
        else:
            pass
    has_runtime = _core_ne(runtime_summary, "")
    if has_runtime:
        runtime_text = _core_string_format("Current runtime state:\n{}", runtime_summary)
        parts.append(runtime_text)
    else:
        pass
    out = _core_string_join("\n", parts)
    return out


def _agent_sanitize_action_log_entries(entries: Any) -> list[Any]:
    _core_coverage_mark("_agent_sanitize_action_log_entries")
    out = []
    for entry in entries:
        clean = {}
        public_type = _core_get(entry, "type", "")
        has_public_type = _core_ne(public_type, "")
        if has_public_type:
            clean["type"] = public_type
        else:
            pass
        public_kind = _core_get(entry, "kind", "")
        has_public_kind = _core_ne(public_kind, "")
        if has_public_kind:
            clean["kind"] = public_kind
        else:
            pass
        public_action = _core_get(entry, "action", "")
        has_public_action = _core_ne(public_action, "")
        if has_public_action:
            clean["action"] = public_action
        else:
            pass
        public_reason = _core_get(entry, "reason", "")
        has_public_reason = _core_ne(public_reason, "")
        if has_public_reason:
            clean["reason"] = public_reason
        else:
            pass
        public_status = _core_get(entry, "status", "")
        has_public_status = _core_ne(public_status, "")
        if has_public_status:
            clean["status"] = public_status
        else:
            pass
        qualified_name = _core_get(entry, "qualified_name", "")
        has_qualified_name = _core_ne(qualified_name, "")
        if has_qualified_name:
            clean["qualified_name"] = qualified_name
        else:
            pass
        entry_name = _core_get(entry, "name", "")
        has_entry_name = _core_ne(entry_name, "")
        if has_entry_name:
            clean["name"] = entry_name
        else:
            pass
        entry_namespace = _core_get(entry, "namespace", "")
        has_entry_namespace = _core_ne(entry_namespace, "")
        if has_entry_namespace:
            clean["namespace"] = entry_namespace
        else:
            pass
        entry_error = _core_get(entry, "error", "")
        has_entry_error = _core_ne(entry_error, "")
        if has_entry_error:
            clean["error"] = entry_error
        else:
            pass
        error_category = _core_get(entry, "error_category", "")
        has_error_category = _core_ne(error_category, "")
        if has_error_category:
            clean["error_category"] = error_category
        else:
            pass
        entry_message = _core_get(entry, "message", "")
        has_entry_message = _core_ne(entry_message, "")
        if has_entry_message:
            clean["message"] = entry_message
        else:
            pass
        guidance = _core_get(entry, "guidance", "")
        has_guidance = _core_ne(guidance, "")
        if has_guidance:
            clean["guidance"] = guidance
        else:
            pass
        triggered_by = _core_get(entry, "triggered_by", "")
        has_triggered_by = _core_ne(triggered_by, "")
        if has_triggered_by:
            clean["triggered_by"] = triggered_by
        else:
            pass
        searches = _core_get(entry, "searches", None)
        searches_is_list = _core_type_is(searches, "list")
        if searches_is_list:
            clean["searches"] = searches
        else:
            pass
        tools = _core_get(entry, "tools", None)
        tools_is_list = _core_type_is(tools, "list")
        if tools_is_list:
            clean["tools"] = tools
        else:
            pass
        skills = _core_get(entry, "skills", None)
        skills_is_list = _core_type_is(skills, "list")
        if skills_is_list:
            clean["skills"] = skills
        else:
            pass
        request = _core_get(entry, "request", None)
        request_is_object = _core_type_is(request, "object")
        if request_is_object:
            clean["request"] = request
        else:
            pass
        turn = _core_get(entry, "turn", 0)
        code = _core_get(entry, "code", "")
        output = _core_get(entry, "output", "")
        tags = _core_get(entry, "tags", None)
        tags_is_list = _core_type_is(tags, "list")
        if tags_is_list:
            pass
        else:
            tags = []
        clean["turn"] = turn
        clean["code"] = code
        clean["output"] = output
        clean["tags"] = tags
        produced = _core_get(entry, "producedVars", None)
        produced_is_list = _core_type_is(produced, "list")
        if produced_is_list:
            clean["producedVars"] = produced
        else:
            pass
        referenced = _core_get(entry, "referencedVars", None)
        referenced_is_list = _core_type_is(referenced, "list")
        if referenced_is_list:
            clean["referencedVars"] = referenced
        else:
            pass
        state_delta = _core_get(entry, "stateDelta", "")
        has_state_delta = _core_ne(state_delta, "")
        if has_state_delta:
            clean["stateDelta"] = state_delta
        else:
            pass
        step_kind = _core_get(entry, "stepKind", "")
        has_step_kind = _core_ne(step_kind, "")
        if has_step_kind:
            clean["stepKind"] = step_kind
        else:
            pass
        replay_mode = _core_get(entry, "replayMode", "")
        has_replay_mode = _core_ne(replay_mode, "")
        if has_replay_mode:
            clean["replayMode"] = replay_mode
        else:
            pass
        rank = _core_get(entry, "rank", None)
        has_rank = _core_is_not_none(rank)
        if has_rank:
            clean["rank"] = rank
        else:
            pass
        tombstone = _core_get(entry, "tombstone", "")
        has_tombstone = _core_ne(tombstone, "")
        if has_tombstone:
            clean["tombstone"] = tombstone
            tombstone_source = _core_get(entry, "tombstone_source", "")
            has_tombstone_source = _core_ne(tombstone_source, "")
            if has_tombstone_source:
                clean["tombstone_source"] = tombstone_source
            else:
                pass
        else:
            pass
        out.append(clean)
    return out


def _agent_context_fixture_result(state: Any, fixture: Any) -> Any:
    _core_coverage_mark("_agent_context_fixture_result")
    empty_list = []
    operation = _core_get(fixture, "context_operation", "prepare")
    is_policy = _core_eq(operation, "resolve_policy")
    if is_policy:
        empty_map = {}
        fixture_options = _core_get(fixture, "options", empty_map)
        options = _core_get(fixture, "context_options", fixture_options)
        policy = _resolve_agent_context_policy(options)
        return policy
    else:
        pass
    is_executor_policy = _core_eq(operation, "executor_model_policy")
    if is_executor_policy:
        empty_map2 = {}
        fixture_options2 = _core_get(fixture, "options", empty_map2)
        options2 = _core_get(fixture, "context_options", fixture_options2)
        policy2 = _resolve_agent_executor_model_policy(options2)
        empty_actor_state = {}
        actor_state = _core_get(fixture, "actor_model_state", empty_actor_state)
        selected = _select_agent_executor_model(policy2, actor_state)
        out2 = {}
        out2["policy"] = policy2
        out2["selectedModel"] = selected
        return out2
    else:
        pass
    is_budget = _core_eq(operation, "budget")
    if is_budget:
        base = _core_get(fixture, "base_budget", 16000)
        fixed = _core_get(fixture, "fixed_overhead_chars", 0)
        empty_entries = []
        entries = _core_get(fixture, "action_log", empty_entries)
        max_runtime = _core_get(fixture, "max_runtime_chars", 3000)
        effective = _agent_compute_effective_chat_budget(base, fixed)
        dynamic = _agent_compute_dynamic_runtime_chars(entries, base, max_runtime)
        mutable_prompt_chars = _core_get(fixture, "mutable_prompt_chars", 0)
        checkpoint_active = _core_get(fixture, "checkpoint_active", False)
        pressure = _agent_context_pressure(mutable_prompt_chars, effective, checkpoint_active)
        pressure_text_budget = _agent_render_context_pressure(pressure)
        out_budget = {}
        out_budget["effectiveBudgetChars"] = effective
        out_budget["dynamicRuntimeChars"] = dynamic
        out_budget["pressure"] = pressure
        out_budget["contextPressure"] = pressure_text_budget
        return out_budget
    else:
        pass
    is_smart = _core_eq(operation, "smart_stringify")
    if is_smart:
        value = _core_get(fixture, "value", None)
        max_chars = _core_get(fixture, "max_chars", 400)
        text = _agent_smart_stringify(value, max_chars)
        out_smart = {}
        out_smart["text"] = text
        return out_smart
    else:
        pass
    fixture_action_log = _core_get(fixture, "action_log", None)
    has_fixture_action_log = _core_type_is(fixture_action_log, "list")
    if has_fixture_action_log:
        state["action_log"] = fixture_action_log
    else:
        pass
    fixture_session_state = _core_get(fixture, "runtime_session_state", None)
    has_session_state = _core_type_is(fixture_session_state, "object")
    if has_session_state:
        state["runtime_session_state"] = fixture_session_state
    else:
        pass
    fixture_checkpoint = _core_get(fixture, "checkpoint_state", None)
    has_fixture_checkpoint = _core_type_is(fixture_checkpoint, "object")
    if has_fixture_checkpoint:
        state["checkpoint_state"] = fixture_checkpoint
    else:
        pass
    fixture_provenance = _core_get(fixture, "provenance", None)
    has_fixture_provenance = _core_type_is(fixture_provenance, "object")
    if has_fixture_provenance:
        state["provenance"] = fixture_provenance
    else:
        pass
    fixture_restore_notice = _core_get(fixture, "restore_notice", "")
    has_fixture_restore_notice = _core_ne(fixture_restore_notice, "")
    if has_fixture_restore_notice:
        state["restore_notice"] = fixture_restore_notice
    else:
        pass
    is_checkpoint_summary = _core_eq(operation, "checkpoint_summary")
    if is_checkpoint_summary:
        checkpoint_entries = _core_get(fixture, "checkpoint_entries", fixture_action_log)
        checkpoint_turns = _core_get(fixture, "checkpoint_turns", empty_list)
        summary = _agent_fallback_checkpoint_summary(checkpoint_entries, checkpoint_turns)
        out_summary = {}
        out_summary["summary"] = summary
        return out_summary
    else:
        pass
    is_manage_context = _core_eq(operation, "manage_context")
    if is_manage_context:
        _agent_apply_context_management(state)
    else:
        pass
    prepared = _agent_prepare_actor_context(state)
    evidence = _agent_build_action_evidence_summary(state)
    exported = _agent_export_runtime_state(state)
    out = {}
    out["prepared"] = prepared
    out["evidence"] = evidence
    out["exported"] = exported
    return out


def _normalize_agent_callable(raw: Any, namespace: str) -> Any:
    _core_coverage_mark("_normalize_agent_callable")
    name = _core_get(raw, "name", "")
    missing_name = _core_eq(name, "")
    if missing_name:
        error = _core_runtime_error("agent callable name is required")
        raise error
    else:
        pass
    kind = _core_get(raw, "kind", "tool")
    description = _core_get(raw, "description", "")
    qualified = _core_string_format("{}.{}", namespace, name)
    parameters = _core_get(raw, "parameters", None)
    always_camel = _core_get(raw, "alwaysInclude", False)
    always_include = _core_get(raw, "always_include", always_camel)
    out = {}
    out["name"] = name
    out["namespace"] = namespace
    out["qualified_name"] = qualified
    out["kind"] = kind
    out["description"] = description
    out["parameters"] = parameters
    out["always_include"] = always_include
    return out


def _normalize_agent_group(raw: Any) -> Any:
    _core_coverage_mark("_normalize_agent_group")
    empty_list = []
    name = _core_get(raw, "name", "tools")
    namespace = _core_get(raw, "namespace", name)
    reserved = _agent_reserved_runtime_names()
    conflicts = _core_contains(reserved, namespace)
    if conflicts:
        message = _core_string_format("agent callable namespace conflicts with reserved runtime name: {}", namespace)
        error = _core_runtime_error(message)
        raise error
    else:
        pass
    title = _core_get(raw, "title", namespace)
    description = _core_get(raw, "description", "")
    selection_camel = _core_get(raw, "selectionCriteria", "")
    selection_criteria = _core_get(raw, "selection_criteria", selection_camel)
    always_camel = _core_get(raw, "alwaysInclude", False)
    always_include = _core_get(raw, "always_include", always_camel)
    functions = _core_get(raw, "functions", empty_list)
    callables = []
    for fn in functions:
        callable = _normalize_agent_callable(fn, namespace)
        callables.append(callable)
    out = {}
    out["namespace"] = namespace
    out["title"] = title
    out["description"] = description
    out["selection_criteria"] = selection_criteria
    out["always_include"] = always_include
    out["callables"] = callables
    return out


def _normalize_agent_callable_inventory(options: Any) -> Any:
    _core_coverage_mark("_normalize_agent_callable_inventory")
    empty_list = []
    functions = _core_get(options, "functions", empty_list)
    groups = []
    flat_callables = []
    has_flat = False
    has_group = False
    for item in functions:
        group_functions = _core_get(item, "functions", None)
        is_group = _core_type_is(group_functions, "list")
        if is_group:
            has_group = True
            if has_flat:
                error = _core_runtime_error("agent functions cannot mix grouped modules and flat functions")
                raise error
            else:
                pass
            group = _normalize_agent_group(item)
            groups.append(group)
        else:
            has_flat = True
            if has_group:
                error = _core_runtime_error("agent functions cannot mix grouped modules and flat functions")
                raise error
            else:
                pass
            callable = _normalize_agent_callable(item, "tools")
            flat_callables.append(callable)
    flat_count = _core_len(flat_callables)
    has_any_flat = _core_gt(flat_count, 0)
    if has_any_flat:
        flat_group = {}
        flat_group["namespace"] = "tools"
        flat_group["title"] = "Tools"
        flat_group["description"] = ""
        flat_group["selection_criteria"] = ""
        flat_group["always_include"] = True
        flat_group["callables"] = flat_callables
        groups.append(flat_group)
    else:
        pass
    return groups


def _split_agent_callable_inventory(inventory: Any) -> Any:
    _core_coverage_mark("_split_agent_callable_inventory")
    inline = []
    discoverable = []
    for group in inventory:
        always = _core_get(group, "always_include", False)
        if always:
            inline.append(group)
        else:
            discoverable.append(group)
    out = {}
    out["inline"] = inline
    out["discoverable"] = discoverable
    return out


def _render_agent_discovery_catalog(split: Any) -> Any:
    _core_coverage_mark("_render_agent_discovery_catalog")
    empty_list = []
    catalog = []
    inline = _core_get(split, "inline", empty_list)
    discoverable = _core_get(split, "discoverable", empty_list)
    for group in inline:
        callable_names = []
        callables = _core_get(group, "callables", empty_list)
        for callable in callables:
            qualified = _core_get(callable, "qualified_name", None)
            callable_names.append(qualified)
        namespace = _core_get(group, "namespace", None)
        entry = {}
        entry["namespace"] = namespace
        entry["placement"] = "actor_prompt"
        entry["callables"] = callable_names
        catalog.append(entry)
    for group in discoverable:
        namespace = _core_get(group, "namespace", None)
        hint = _core_string_format("discover tools {}", namespace)
        entry = {}
        entry["namespace"] = namespace
        entry["placement"] = "discover"
        entry["hint"] = hint
        catalog.append(entry)
    return catalog


def _normalize_agent_string_list(value: Any, label: str) -> list[Any]:
    _core_coverage_mark("_normalize_agent_string_list")
    out = []
    is_string = _core_type_is(value, "string")
    if is_string:
        trimmed = str(value).strip()
        empty = _core_eq(trimmed, "")
        if empty:
            message = _core_string_format("{} entries must be non-empty strings", label)
            error = _core_runtime_error(message)
            raise error
        else:
            out.append(trimmed)
    else:
        is_list = _core_type_is(value, "list")
        not_list = _core_not(is_list)
        if not_list:
            message = _core_string_format("{} must be a string or string[]", label)
            error = _core_runtime_error(message)
            raise error
        else:
            for item in value:
                item_is_string = _core_type_is(item, "string")
                bad_item = _core_not(item_is_string)
                if bad_item:
                    message = _core_string_format("{} entries must be strings", label)
                    error = _core_runtime_error(message)
                    raise error
                else:
                    trimmed_item = str(item).strip()
                    empty_item = _core_eq(trimmed_item, "")
                    if empty_item:
                        message = _core_string_format("{} entries must be non-empty strings", label)
                        error = _core_runtime_error(message)
                        raise error
                    else:
                        already = _core_contains(out, trimmed_item)
                        fresh = _core_not(already)
                        if fresh:
                            out.append(trimmed_item)
                        else:
                            pass
    count = _core_len(out)
    empty_out = _core_eq(count, 0)
    if empty_out:
        message = _core_string_format("{} requires at least one entry", label)
        error = _core_runtime_error(message)
        raise error
    else:
        pass
    return out


def _normalize_agent_discover_request(state: Any, request: Any) -> Any:
    _core_coverage_mark("_normalize_agent_discover_request")
    empty_list = []
    tools = []
    skills = []
    flags = _core_get(state, "policy_flags", None)
    is_string = _core_type_is(request, "string")
    is_list = _core_type_is(request, "list")
    direct_tools = _core_or(is_string, is_list)
    if direct_tools:
        tools = _normalize_agent_string_list(request, "discover tools")
    else:
        is_map = _core_type_is(request, "object")
        bad = _core_not(is_map)
        if bad:
            error = _core_runtime_error("discover(...) expects a string, string[], or { tools?, skills? }")
            raise error
        else:
            has_tools = _core_map_contains(request, "tools")
            has_skills = _core_map_contains(request, "skills")
            has_any = _core_or(has_tools, has_skills)
            missing_any = _core_not(has_any)
            if missing_any:
                error = _core_runtime_error("discover(...) requires at least one of tools or skills")
                raise error
            else:
                pass
            if has_tools:
                raw_tools = _core_get(request, "tools", empty_list)
                tools = _normalize_agent_string_list(raw_tools, "discover tools")
            else:
                pass
            if has_skills:
                raw_skills = _core_get(request, "skills", empty_list)
                skills = _normalize_agent_string_list(raw_skills, "discover skills")
            else:
                pass
    tool_count = _core_len(tools)
    skill_count = _core_len(skills)
    has_tool_items = _core_gt(tool_count, 0)
    has_skill_items = _core_gt(skill_count, 0)
    discovery_mode = _core_get(flags, "discoveryMode", False)
    skills_mode = _core_get(flags, "skillsMode", False)
    tools_disabled = _core_not(discovery_mode)
    skills_disabled = _core_not(skills_mode)
    bad_tools = _core_and(has_tool_items, tools_disabled)
    if bad_tools:
        error = _core_runtime_error("discover({ tools }) requires function discovery to be enabled")
        raise error
    else:
        pass
    bad_skills = _core_and(has_skill_items, skills_disabled)
    if bad_skills:
        error = _core_runtime_error("discover({ skills }) requires skill discovery to be enabled")
        raise error
    else:
        pass
    out = {}
    out["tools"] = tools
    out["skills"] = skills
    return out


def _agent_append_unique_by_field(items: Any, item: Any, field: str) -> Any:
    _core_coverage_mark("_agent_append_unique_by_field")
    value = _core_get(item, field, "")
    found = False
    for existing in items:
        existing_value = _core_get(existing, field, "")
        matches = _core_eq(existing_value, value)
        if matches:
            found = True
        else:
            pass
    missing = _core_not(found)
    if missing:
        items.append(item)
    else:
        pass
    return items


def _agent_render_discovered_tool_docs(docs: Any) -> str:
    _core_coverage_mark("_agent_render_discovered_tool_docs")
    lines = []
    for doc in docs:
        qualified = _core_get(doc, "qualified_name", "")
        description = _core_get(doc, "description", "")
        line = _core_string_format("- {}: {}", qualified, description)
        lines.append(line)
    body = _core_string_join("\n", lines)
    empty = _core_eq(body, "")
    out = body
    if empty:
        out = ""
    else:
        out = _core_string_format("Discovered Tool Docs\n{}", body)
    return out


def _agent_render_loaded_skills(skills: Any) -> str:
    _core_coverage_mark("_agent_render_loaded_skills")
    lines = []
    for skill in skills:
        name = _core_get(skill, "name", "")
        content = _core_get(skill, "content", "")
        line = _core_string_format("### {}\n{}", name, content)
        lines.append(line)
    body = _core_string_join("\n\n", lines)
    empty = _core_eq(body, "")
    out = body
    if empty:
        out = ""
    else:
        out = _core_string_format("Loaded Skills\n{}", body)
    return out


def _agent_discover(state: Any, request: Any) -> None:
    _core_coverage_mark("_agent_discover")
    empty_list = []
    normalized = _normalize_agent_discover_request(state, request)
    inventory = _core_get(state, "callable_inventory", empty_list)
    docs = _core_get(state, "discovered_tool_docs", empty_list)
    skill_docs = _core_get(state, "loaded_skill_docs", empty_list)
    trace = _core_get(state, "policy_trace", empty_list)
    action_log = _core_get(state, "action_log", empty_list)
    tools = _core_get(normalized, "tools", empty_list)
    skills = _core_get(normalized, "skills", empty_list)
    for wanted in tools:
        for group in inventory:
            namespace = _core_get(group, "namespace", None)
            namespace_match = _core_eq(namespace, wanted)
            callables = _core_get(group, "callables", empty_list)
            if namespace_match:
                for callable in callables:
                    doc_name = _core_get(callable, "name", None)
                    doc_qualified = _core_get(callable, "qualified_name", None)
                    doc_kind = _core_get(callable, "kind", None)
                    doc_description = _core_get(callable, "description", "")
                    doc = {}
                    doc["namespace"] = namespace
                    doc["name"] = doc_name
                    doc["qualified_name"] = doc_qualified
                    doc["kind"] = doc_kind
                    doc["description"] = doc_description
                    docs = _agent_append_unique_by_field(docs, doc, "qualified_name")
            else:
                for callable in callables:
                    qualified = _core_get(callable, "qualified_name", None)
                    name = _core_get(callable, "name", None)
                    qualified_match = _core_eq(qualified, wanted)
                    name_match = _core_eq(name, wanted)
                    matches = _core_or(qualified_match, name_match)
                    if matches:
                        kind = _core_get(callable, "kind", None)
                        description = _core_get(callable, "description", "")
                        doc = {}
                        doc["namespace"] = namespace
                        doc["name"] = name
                        doc["qualified_name"] = qualified
                        doc["kind"] = kind
                        doc["description"] = description
                        docs = _agent_append_unique_by_field(docs, doc, "qualified_name")
                    else:
                        pass
    skill_count = _core_len(skills)
    has_skills = _core_gt(skill_count, 0)
    if has_skills:
        host_skills = _core_agent_skill_search(state, skills)
        host_count = _core_len(host_skills)
        has_host = _core_gt(host_count, 0)
        if has_host:
            for host_skill in host_skills:
                skill_name = _core_get(host_skill, "name", "")
                skill_id = _core_get(host_skill, "id", skill_name)
                host_skill["id"] = skill_id
                skill_docs = _agent_append_unique_by_field(skill_docs, host_skill, "id")
        else:
            for skill in skills:
                doc = {}
                doc["id"] = skill
                doc["name"] = skill
                content = _core_string_format("Skill docs loaded for {}", skill)
                doc["content"] = content
                skill_docs = _agent_append_unique_by_field(skill_docs, doc, "id")
    else:
        pass
    event = {}
    event["type"] = "discover"
    event["tools"] = tools
    event["skills"] = skills
    trace.append(event)
    action_event = {}
    action_event["type"] = "discover"
    action_event["request"] = request
    action_event["tools"] = tools
    action_event["skills"] = skills
    action_log.append(action_event)
    state["discovered_tool_docs"] = docs
    state["loaded_skill_docs"] = skill_docs
    state["policy_trace"] = trace
    state["action_log"] = action_log
    _agent_record_trace_event(state, "discover", event)
    none = _core_none()
    return none


def _normalize_agent_recall_request(state: Any, request: Any) -> Any:
    _core_coverage_mark("_normalize_agent_recall_request")
    flags = _core_get(state, "policy_flags", None)
    enabled = _core_get(flags, "memoriesMode", False)
    disabled = _core_not(enabled)
    if disabled:
        error = _core_runtime_error("recall(...) requires memory search to be enabled")
        raise error
    else:
        pass
    searches = _normalize_agent_string_list(request, "recall searches")
    out = {}
    out["searches"] = searches
    return out


def _agent_merge_memory_results(existing: Any, incoming: Any) -> Any:
    _core_coverage_mark("_agent_merge_memory_results")
    out = existing
    for memory in incoming:
        id = _core_get(memory, "id", "")
        content = _core_get(memory, "content", "")
        has_id = _core_ne(id, "")
        has_content = _core_ne(content, "")
        valid = _core_and(has_id, has_content)
        if valid:
            out = _agent_append_unique_by_field(out, memory, "id")
        else:
            pass
    return out


def _agent_recall(state: Any, request: Any) -> None:
    _core_coverage_mark("_agent_recall")
    empty_list = []
    normalized = _normalize_agent_recall_request(state, request)
    searches = _core_get(normalized, "searches", empty_list)
    loaded = _core_get(state, "loaded_memories", empty_list)
    incoming = _core_agent_memory_search(state, searches, loaded)
    merged = _agent_merge_memory_results(loaded, incoming)
    state["loaded_memories"] = merged
    trace = _core_get(state, "policy_trace", empty_list)
    event = {}
    event["type"] = "recall"
    event["searches"] = searches
    event["loaded"] = incoming
    trace.append(event)
    state["policy_trace"] = trace
    action_log = _core_get(state, "action_log", empty_list)
    action = {}
    action["type"] = "recall"
    action["searches"] = searches
    action["loaded"] = incoming
    action_log.append(action)
    state["action_log"] = action_log
    _agent_record_trace_event(state, "recall", event)
    none = _core_none()
    return none


def _normalize_agent_used_request(request: Any, default_stage: str) -> Any:
    _core_coverage_mark("_normalize_agent_used_request")
    is_map = _core_type_is(request, "object")
    id = ""
    reason = ""
    stage = default_stage
    if is_map:
        id = _core_get(request, "id", "")
        reason = _core_get(request, "reason", "")
        stage = _core_get(request, "stage", default_stage)
    else:
        id = request
    id = str(id).strip()
    reason = str(reason).strip()
    missing = _core_eq(id, "")
    if missing:
        error = _core_runtime_error("used(...) requires a non-empty loaded memory or skill id")
        raise error
    else:
        pass
    out = {}
    out["id"] = id
    out["reason"] = reason
    out["stage"] = stage
    return out


def _agent_used(state: Any, request: Any, stage: str) -> None:
    _core_coverage_mark("_agent_used")
    empty_list = []
    flags = _core_get(state, "policy_flags", None)
    enabled = _core_get(flags, "usageTrackingMode", False)
    disabled = _core_not(enabled)
    if disabled:
        error = _core_runtime_error("used(...) requires usage tracking to be enabled")
        raise error
    else:
        pass
    normalized = _normalize_agent_used_request(request, stage)
    id = _core_get(normalized, "id", None)
    reason = _core_get(normalized, "reason", "")
    normalized_stage = _core_get(normalized, "stage", stage)
    dedupe_key = _core_string_format("{}\n{}\n{}", normalized_stage, id, reason)
    memories = _core_get(state, "loaded_memories", empty_list)
    skills = _core_get(state, "loaded_skill_docs", empty_list)
    used_memories = _core_get(state, "used_memories", empty_list)
    used_skills = _core_get(state, "used_skills", empty_list)
    matched = False
    for memory in memories:
        memory_id = _core_get(memory, "id", "")
        is_match = _core_eq(memory_id, id)
        if is_match:
            record = {}
            record["id"] = id
            record["reason"] = reason
            record["stage"] = normalized_stage
            record["dedupe_key"] = dedupe_key
            used_memories = _agent_append_unique_by_field(used_memories, record, "dedupe_key")
            matched = True
        else:
            pass
    for skill in skills:
        skill_id = _core_get(skill, "id", "")
        skill_name = _core_get(skill, "name", skill_id)
        is_match = _core_eq(skill_id, id)
        if is_match:
            record = {}
            record["id"] = id
            record["name"] = skill_name
            record["reason"] = reason
            record["stage"] = normalized_stage
            record["dedupe_key"] = dedupe_key
            used_skills = _agent_append_unique_by_field(used_skills, record, "dedupe_key")
            matched = True
        else:
            pass
    state["used_memories"] = used_memories
    state["used_skills"] = used_skills
    trace = _core_get(state, "policy_trace", empty_list)
    event = {}
    event["type"] = "used"
    event["id"] = id
    event["reason"] = reason
    event["stage"] = normalized_stage
    event["matched"] = matched
    trace.append(event)
    state["policy_trace"] = trace
    action_log = _core_get(state, "action_log", empty_list)
    action_log.append(event)
    state["action_log"] = action_log
    _agent_record_trace_event(state, "used", event)
    none = _core_none()
    return none


def _normalize_agent_guidance_payload(value: Any, triggered_by: str) -> Any:
    _core_coverage_mark("_normalize_agent_guidance_payload")
    is_map = _core_type_is(value, "object")
    guidance = ""
    trigger = triggered_by
    if is_map:
        guidance = _core_get(value, "guidance", "")
        trigger = _core_get(value, "triggeredBy", triggered_by)
    else:
        guidance = value
    guidance = str(guidance).strip()
    missing = _core_eq(guidance, "")
    if missing:
        error = _core_runtime_error("guideAgent() requires a non-empty string guidance")
        raise error
    else:
        pass
    out = {}
    out["type"] = "guide_agent"
    out["guidance"] = guidance
    has_trigger = _core_ne(trigger, "")
    if has_trigger:
        out["triggeredBy"] = trigger
    else:
        pass
    return out


def _agent_append_guidance(state: Any, payload: Any) -> Any:
    _core_coverage_mark("_agent_append_guidance")
    empty_list = []
    entries = _core_get(state, "guidance_log", empty_list)
    count = _core_len(entries)
    turn = _core_add(count, 1)
    guidance = _core_get(payload, "guidance", "")
    triggered_by = _core_get(payload, "triggeredBy", "")
    entry = {}
    entry["turn"] = turn
    entry["guidance"] = guidance
    has_trigger = _core_ne(triggered_by, "")
    if has_trigger:
        entry["triggeredBy"] = triggered_by
    else:
        pass
    entries.append(entry)
    state["guidance_log"] = entries
    action_log = _core_get(state, "action_log", empty_list)
    action = {}
    action["type"] = "guide_agent"
    action["guidance"] = guidance
    action["triggeredBy"] = triggered_by
    action_log.append(action)
    state["action_log"] = action_log
    _agent_record_trace_event(state, "guide_agent", entry)
    return entry


def _agent_execute_callable(state: Any, request: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_execute_callable")
    empty_list = []
    result = _core_agent_callable_invoke(state, request, options)
    qualified = _core_get(request, "qualified_name", "")
    name = _core_get(request, "name", qualified)
    args = _core_get(request, "args", request)
    status = _core_get(result, "status", "ok")
    trace = _core_get(state, "function_call_traces", empty_list)
    record = {}
    record["qualified_name"] = qualified
    record["name"] = name
    record["arguments"] = args
    record["status"] = status
    record["result"] = result
    trace.append(record)
    state["function_call_traces"] = trace
    action_log = _core_get(state, "action_log", empty_list)
    action = {}
    action["type"] = "function_call"
    action["qualified_name"] = qualified
    action["status"] = status
    action_log.append(action)
    state["action_log"] = action_log
    host_event = _agent_normalize_host_boundary_event("callable", request, result, status)
    _agent_record_trace_event(state, "function_call", host_event)
    guidance = _core_get(result, "guidance", None)
    has_guidance = _core_is_not_none(guidance)
    if has_guidance:
        payload = _normalize_agent_guidance_payload(guidance, qualified)
        _agent_append_guidance(state, payload)
        result["guidance_payload"] = payload
    else:
        pass
    return result


def _normalize_agent_final_payload(value: Any) -> Any:
    _core_coverage_mark("_normalize_agent_final_payload")
    is_map = _core_type_is(value, "object")
    if is_map:
        type = _core_get(value, "type", "")
        is_final = _core_eq(type, "final")
        if is_final:
            return value
        else:
            pass
    else:
        pass
    args = []
    args.append(value)
    out = {}
    out["type"] = "final"
    out["args"] = args
    return out


def _normalize_agent_clarification_payload(value: Any) -> Any:
    _core_coverage_mark("_normalize_agent_clarification_payload")
    is_map = _core_type_is(value, "object")
    question = ""
    payload = {}
    if is_map:
        type = _core_get(value, "type", "")
        is_clarification = _core_eq(type, "askClarification")
        if is_clarification:
            return value
        else:
            pass
        message = _core_get(value, "message", "")
        question = _core_get(value, "question", message)
        payload = value
    else:
        question = value
        payload["question"] = question
    missing = _core_eq(question, "")
    if missing:
        error = _core_runtime_error("agent clarification question is required")
        raise error
    else:
        pass
    args = []
    args.append(payload)
    out = {}
    out["type"] = "askClarification"
    out["args"] = args
    return out


def _agent_optimizer_metadata(state: Any) -> Any:
    _core_coverage_mark("_agent_optimizer_metadata")
    policy = _core_get(state, "policy", None)
    policy_version = _core_get(policy, "policy_version", "agent-runtime-decision-v1")
    stage_ids = []
    stage_ids.append("distiller")
    stage_ids.append("executor")
    stage_ids.append("responder")
    components = []
    runtime_component = {}
    runtime_component["id"] = "agent.actor.runtime_instructions"
    runtime_component["kind"] = "runtime_instruction"
    components.append(runtime_component)
    discovery_component = {}
    discovery_component["id"] = "agent.actor.discovery_policy"
    discovery_component["kind"] = "policy"
    components.append(discovery_component)
    delegation_component = {}
    delegation_component["id"] = "agent.actor.delegation_policy"
    delegation_component["kind"] = "policy"
    components.append(delegation_component)
    responder_component = {}
    responder_component["id"] = "agent.responder.signature"
    responder_component["kind"] = "stage"
    components.append(responder_component)
    out = {}
    out["policy_version"] = policy_version
    out["stage_ids"] = stage_ids
    out["optimizable_components"] = components
    return out


def _agent_begin_trace(state: Any, input: Any) -> Any:
    _core_coverage_mark("_agent_begin_trace")
    events = []
    optimizer = _core_get(state, "optimizer_metadata", None)
    trace = {}
    trace["schema_version"] = "axir-agent-trace-v1"
    trace["kind"] = "agent_run"
    trace["status"] = "running"
    trace["input"] = input
    trace["events"] = events
    trace["optimizer_metadata"] = optimizer
    trace["replayable"] = True
    state["trace"] = trace
    return trace


def _agent_record_trace_event(state: Any, kind: str, payload: Any) -> Any:
    _core_coverage_mark("_agent_record_trace_event")
    empty_map = {}
    empty_list = []
    trace = _core_get(state, "trace", empty_map)
    has_trace = _core_type_is(trace, "object")
    if has_trace:
        pass
    else:
        trace = _agent_begin_trace(state, empty_map)
    events = _core_get(trace, "events", empty_list)
    index = _core_len(events)
    event = {}
    event["index"] = index
    event["kind"] = kind
    payload_is_map = _core_type_is(payload, "object")
    if payload_is_map:
        component = _core_get(payload, "component_id", "")
        has_component = _core_ne(component, "")
        if has_component:
            event["component_id"] = component
        else:
            pass
        event["payload"] = payload
    else:
        event["value"] = payload
    events.append(event)
    trace["events"] = events
    state["trace"] = trace
    return event


def _agent_normalize_host_boundary_event(boundary: str, request: Any, result: Any, status: str) -> Any:
    _core_coverage_mark("_agent_normalize_host_boundary_event")
    out = {}
    out["boundary"] = boundary
    out["request"] = request
    out["result"] = result
    out["status"] = status
    return out


def _agent_finalize_trace(state: Any, status: str, output: Any) -> Any:
    _core_coverage_mark("_agent_finalize_trace")
    empty_map = {}
    empty_list = []
    trace = _core_get(state, "trace", empty_map)
    has_trace = _core_type_is(trace, "object")
    if has_trace:
        pass
    else:
        trace = _agent_begin_trace(state, empty_map)
    event_payload = {}
    event_payload["output"] = output
    _agent_record_trace_event(state, "final", event_payload)
    trace = _core_get(state, "trace", trace)
    events = _core_get(trace, "events", empty_list)
    event_count = _core_len(events)
    usage = _core_get(state, "usage", empty_map)
    chat_log = _core_get(state, "chat_log", empty_list)
    action_log = _core_get(state, "action_log", empty_list)
    policy_trace = _core_get(state, "policy_trace", empty_list)
    function_traces = _core_get(state, "function_call_traces", empty_list)
    optimizer = _core_get(state, "optimizer_metadata", empty_map)
    trace["status"] = status
    trace["final_output"] = output
    trace["event_count"] = event_count
    trace["usage"] = usage
    trace["chat_log"] = chat_log
    trace["action_log"] = action_log
    trace["policy_trace"] = policy_trace
    trace["function_call_traces"] = function_traces
    trace["optimizer_metadata"] = optimizer
    state["trace"] = trace
    return trace


def _agent_export_trace(state: Any) -> Any:
    _core_coverage_mark("_agent_export_trace")
    empty_map = {}
    empty_list = []
    trace = _core_get(state, "trace", empty_map)
    has_trace = _core_type_is(trace, "object")
    if has_trace:
        pass
    else:
        trace = _agent_begin_trace(state, empty_map)
    events = _core_get(trace, "events", empty_list)
    event_count = _core_len(events)
    usage = _core_get(state, "usage", empty_map)
    chat_log = _core_get(state, "chat_log", empty_list)
    action_log = _core_get(state, "action_log", empty_list)
    policy_trace = _core_get(state, "policy_trace", empty_list)
    function_traces = _core_get(state, "function_call_traces", empty_list)
    optimizer = _core_get(state, "optimizer_metadata", empty_map)
    trace["event_count"] = event_count
    trace["usage"] = usage
    trace["chat_log"] = chat_log
    trace["action_log"] = action_log
    trace["policy_trace"] = policy_trace
    trace["function_call_traces"] = function_traces
    trace["optimizer_metadata"] = optimizer
    state["trace"] = trace
    return trace


def _agent_replay_trace(trace: Any, fixtures: Any) -> Any:
    _core_coverage_mark("_agent_replay_trace")
    empty_list = []
    events = _core_get(trace, "events", empty_list)
    event_kinds = []
    for event in events:
        kind = _core_get(event, "kind", "")
        event_kinds.append(kind)
    expected_kinds = _core_get(fixtures, "expected_event_kinds", None)
    has_expected_kinds = _core_type_is(expected_kinds, "list")
    if has_expected_kinds:
        actual_text = _core_json_stringify(event_kinds)
        expected_text = _core_json_stringify(expected_kinds)
        matches = _core_eq(actual_text, expected_text)
        mismatch = _core_not(matches)
        if mismatch:
            message = _core_string_format("agent replay event sequence mismatch: expected {} got {}", expected_text, actual_text)
            error = _core_runtime_error(message)
            raise error
        else:
            pass
    else:
        pass
    output = _core_get(trace, "final_output", None)
    expected_output = _core_get(fixtures, "expected_output", None)
    has_expected_output = _core_is_not_none(expected_output)
    if has_expected_output:
        actual_output_text = _core_json_stringify(output)
        expected_output_text = _core_json_stringify(expected_output)
        output_matches = _core_eq(actual_output_text, expected_output_text)
        output_mismatch = _core_not(output_matches)
        if output_mismatch:
            message = _core_string_format("agent replay output mismatch: expected {} got {}", expected_output_text, actual_output_text)
            error = _core_runtime_error(message)
            raise error
        else:
            pass
    else:
        pass
    event_count = _core_len(events)
    status = _core_get(trace, "status", "unknown")
    action_log = _core_get(trace, "action_log", empty_list)
    chat_log = _core_get(trace, "chat_log", empty_list)
    out = {}
    out["ok"] = True
    out["status"] = "replayed"
    out["original_status"] = status
    out["output"] = output
    out["event_kinds"] = event_kinds
    out["event_count"] = event_count
    out["action_log"] = action_log
    out["chat_log"] = chat_log
    out["trace"] = trace
    return out


def _agent_export_runtime_state(state: Any) -> Any:
    _core_coverage_mark("_agent_export_runtime_state")
    empty_map = {}
    empty_list = []
    out = {}
    runtime_state = _core_get(state, "runtime_state", empty_map)
    discovered = _core_get(state, "discovered_tool_docs", empty_list)
    skills = _core_get(state, "loaded_skill_docs", empty_list)
    memories = _core_get(state, "loaded_memories", empty_list)
    used_memories = _core_get(state, "used_memories", empty_list)
    used_skills = _core_get(state, "used_skills", empty_list)
    guidance_log = _core_get(state, "guidance_log", empty_list)
    function_call_traces = _core_get(state, "function_call_traces", empty_list)
    trace = _core_get(state, "policy_trace", empty_list)
    action_log = _core_get(state, "action_log", empty_list)
    status_log = _core_get(state, "status_log", empty_list)
    runtime_session_state = _core_get(state, "runtime_session_state", empty_map)
    runtime_globals = _core_get(state, "runtime_globals", empty_map)
    runtime_inspection = _core_get(state, "runtime_inspection", None)
    actor_prompt_policy = _core_get(state, "actor_prompt_policy", empty_map)
    policy_registry = _core_get(state, "policy_registry", empty_map)
    context_policy = _core_get(state, "context_policy", empty_map)
    context_events = _core_get(state, "context_events", empty_list)
    checkpoint_state = _core_get(state, "checkpoint_state", None)
    context_map = _core_get(state, "context_map", None)
    runtime_state_summary = _core_get(state, "runtime_state_summary", "")
    actor_model_state = _core_get(state, "actor_model_state", empty_map)
    provenance = _core_get(state, "provenance", empty_map)
    last_actor_context = _core_get(state, "last_actor_context", empty_map)
    clean_action_log = _agent_sanitize_action_log_entries(action_log)
    run_trace = _agent_export_trace(state)
    out["runtime_state"] = runtime_state
    out["discovered_tool_docs"] = discovered
    out["loaded_skill_docs"] = skills
    out["loaded_memories"] = memories
    out["used_memories"] = used_memories
    out["used_skills"] = used_skills
    out["guidance_log"] = guidance_log
    out["function_call_traces"] = function_call_traces
    out["policy_trace"] = trace
    out["action_log"] = clean_action_log
    out["status_log"] = status_log
    out["runtime_session_state"] = runtime_session_state
    out["runtime_globals"] = runtime_globals
    out["runtime_inspection"] = runtime_inspection
    out["actor_prompt_policy"] = actor_prompt_policy
    out["policy_registry"] = policy_registry
    out["context_policy"] = context_policy
    out["context_events"] = context_events
    out["checkpoint_state"] = checkpoint_state
    out["context_map"] = context_map
    out["runtime_state_summary"] = runtime_state_summary
    out["actor_model_state"] = actor_model_state
    out["provenance"] = provenance
    out["last_actor_context"] = last_actor_context
    out["trace"] = run_trace
    return out


def _agent_restore_runtime_state(state: Any, snapshot: Any) -> Any:
    _core_coverage_mark("_agent_restore_runtime_state")
    empty_map = {}
    empty_list = []
    runtime_state = _core_get(snapshot, "runtime_state", empty_map)
    discovered = _core_get(snapshot, "discovered_tool_docs", empty_list)
    skills = _core_get(snapshot, "loaded_skill_docs", empty_list)
    memories = _core_get(snapshot, "loaded_memories", empty_list)
    used_memories = _core_get(snapshot, "used_memories", empty_list)
    used_skills = _core_get(snapshot, "used_skills", empty_list)
    guidance_log = _core_get(snapshot, "guidance_log", empty_list)
    function_call_traces = _core_get(snapshot, "function_call_traces", empty_list)
    trace = _core_get(snapshot, "policy_trace", empty_list)
    action_log = _core_get(snapshot, "action_log", empty_list)
    status_log = _core_get(snapshot, "status_log", empty_list)
    runtime_session_state = _core_get(snapshot, "runtime_session_state", empty_map)
    runtime_globals = _core_get(snapshot, "runtime_globals", empty_map)
    policy_registry = _core_get(snapshot, "policy_registry", None)
    run_trace = _core_get(snapshot, "trace", None)
    context_events = _core_get(snapshot, "context_events", empty_list)
    checkpoint_state = _core_get(snapshot, "checkpoint_state", None)
    context_map = _core_get(snapshot, "context_map", None)
    runtime_state_summary = _core_get(snapshot, "runtime_state_summary", "")
    actor_model_state = _core_get(snapshot, "actor_model_state", empty_map)
    provenance = _core_get(snapshot, "provenance", empty_map)
    last_actor_context = _core_get(snapshot, "last_actor_context", empty_map)
    clean_restore_action_log = _agent_sanitize_action_log_entries(action_log)
    state["runtime_state"] = runtime_state
    state["discovered_tool_docs"] = discovered
    state["loaded_skill_docs"] = skills
    state["loaded_memories"] = memories
    state["used_memories"] = used_memories
    state["used_skills"] = used_skills
    state["guidance_log"] = guidance_log
    state["function_call_traces"] = function_call_traces
    state["policy_trace"] = trace
    state["action_log"] = clean_restore_action_log
    state["status_log"] = status_log
    state["runtime_session_state"] = runtime_session_state
    state["runtime_globals"] = runtime_globals
    state["context_events"] = context_events
    state["checkpoint_state"] = checkpoint_state
    state["context_map"] = context_map
    state["runtime_state_summary"] = runtime_state_summary
    state["actor_model_state"] = actor_model_state
    state["provenance"] = provenance
    state["last_actor_context"] = last_actor_context
    has_policy_registry = _core_type_is(policy_registry, "object")
    if has_policy_registry:
        state["policy_registry"] = policy_registry
    else:
        pass
    has_trace = _core_type_is(run_trace, "object")
    if has_trace:
        state["trace"] = run_trace
    else:
        pass
    out = _agent_export_runtime_state(state)
    return out


def _agent_runtime_build_globals(state: Any, values: Any) -> Any:
    _core_coverage_mark("_agent_runtime_build_globals")
    empty_list = []
    empty_map = {}
    reserved = _agent_reserved_runtime_names()
    globals = {}
    primitives = []
    callable_inventory = _core_get(state, "callable_inventory", empty_list)
    discovery_catalog = _core_get(state, "discovery_catalog", empty_list)
    registry = _core_get(state, "policy_registry", empty_map)
    selected_primitives = _select_actor_primitives(registry, "executor")
    globals["inputs"] = values
    globals["context"] = values
    globals["callables"] = callable_inventory
    globals["discovery_catalog"] = discovery_catalog
    for primitive_meta in selected_primitives:
        name = _core_get(primitive_meta, "id", None)
        primitive = {}
        primitive["name"] = name
        primitive["kind"] = "runtime_primitive"
        primitive["metadata"] = primitive_meta
        primitives.append(primitive)
    globals["runtime_primitives"] = primitives
    for key in values:
        conflict = _core_contains(reserved, key)
        if conflict:
            message = _core_string_format("agent runtime global conflicts with reserved name: {}", key)
            error = _core_runtime_error(message)
            raise error
        else:
            value = _core_get(values, key, None)
            globals[key] = value
    runtime_contract = _core_get(state, "runtime_contract", empty_map)
    globals["runtime"] = runtime_contract
    state["runtime_globals"] = globals
    return globals


def _agent_runtime_sanitize_bindings(bindings: Any) -> Any:
    _core_coverage_mark("_agent_runtime_sanitize_bindings")
    reserved = _agent_reserved_runtime_names()
    out = {}
    bindings_is_map = _core_type_is(bindings, "object")
    if bindings_is_map:
        for key in bindings:
            conflict = _core_contains(reserved, key)
            if conflict:
                pass
            else:
                value = _core_get(bindings, key, None)
                out[key] = value
    else:
        pass
    return out


def _normalize_agent_runtime_snapshot(snapshot: Any) -> Any:
    _core_coverage_mark("_normalize_agent_runtime_snapshot")
    empty_list = []
    snapshot_is_map = _core_type_is(snapshot, "object")
    if snapshot_is_map:
        pass
    else:
        error = _core_runtime_error("runtime session snapshot must be an object")
        raise error
    raw_globals = _core_get(snapshot, "globals", None)
    raw_bindings = _core_get(snapshot, "bindings", None)
    has_globals = _core_type_is(raw_globals, "object")
    has_bindings = _core_type_is(raw_bindings, "object")
    has_any = _core_or(has_globals, has_bindings)
    if has_any:
        pass
    else:
        error2 = _core_runtime_error("runtime session snapshot globals must be an object")
        raise error2
    bindings = raw_globals
    if has_bindings:
        bindings = raw_bindings
    else:
        pass
    clean_bindings = _agent_runtime_sanitize_bindings(bindings)
    entries = _core_get(snapshot, "entries", empty_list)
    entries_is_list = _core_type_is(entries, "list")
    if entries_is_list:
        pass
    else:
        entries = empty_list
    closed = _core_get(snapshot, "closed", False)
    version = _core_get(snapshot, "version", 1)
    out = {}
    out["version"] = version
    out["entries"] = entries
    out["bindings"] = clean_bindings
    out["globals"] = clean_bindings
    out["closed"] = closed
    return out


def _agent_runtime_append_action_log(state: Any, entry: Any) -> Any:
    _core_coverage_mark("_agent_runtime_append_action_log")
    empty_list = []
    log = _core_get(state, "action_log", empty_list)
    entry_is_map = _core_type_is(entry, "object")
    if entry_is_map:
        has_turn = _core_map_contains(entry, "turn")
        if has_turn:
            pass
        else:
            count = _core_len(log)
            turn = _core_add(count, 1)
            entry["turn"] = turn
        has_tags = _core_map_contains(entry, "tags")
        if has_tags:
            pass
        else:
            tags = []
            is_error = _core_get(entry, "is_error", False)
            if is_error:
                tags.append("error")
            else:
                pass
            entry["tags"] = tags
    else:
        pass
    log.append(entry)
    state["action_log"] = log
    return entry


def _normalize_agent_runtime_step_result(raw: Any, code: str) -> Any:
    _core_coverage_mark("_normalize_agent_runtime_step_result")
    empty_map = {}
    none = _core_none()
    out = {}
    raw_is_map = _core_type_is(raw, "object")
    kind = "result"
    is_error = False
    result = raw
    output = ""
    error_message = ""
    error_category = ""
    completion_payload = none
    discover_request = none
    recall_request = none
    used_request = none
    callable_request = none
    guidance_payload = none
    status = none
    if raw_is_map:
        raw_type = _core_get(raw, "type", "")
        kind = _core_get(raw, "kind", raw_type)
        missing_kind = _core_eq(kind, "")
        if missing_kind:
            kind = "result"
        else:
            pass
        is_error = _core_get(raw, "is_error", False)
        result = _core_get(raw, "result", raw)
        output = _core_get(raw, "output", "")
        output_is_empty = _core_eq(output, "")
        if output_is_empty:
            raw_logs = _core_get(raw, "logs", None)
            raw_logs_is_list = _core_type_is(raw_logs, "list")
            if raw_logs_is_list:
                joined_logs = _core_string_join("\n", raw_logs)
                output = joined_logs
            else:
                pass
        else:
            pass
        error_message = _core_get(raw, "error", "")
        error_category = _core_get(raw, "error_category", "")
        completion_payload = _core_get(raw, "completion_payload", None)
        discover_request = _core_get(raw, "discover", None)
        recall_request = _core_get(raw, "recall", None)
        used_request = _core_get(raw, "used", None)
        callable_request = _core_get(raw, "callable", None)
        guidance_payload = _core_get(raw, "guidance", None)
        status = _core_get(raw, "status", None)
    else:
        pass
    completion_is_map = _core_type_is(completion_payload, "object")
    if completion_is_map:
        pass
    else:
        is_final_kind = _core_eq(kind, "final")
        is_clarification_kind = _core_eq(kind, "askClarification")
        is_protocol_kind = _core_or(is_final_kind, is_clarification_kind)
        if is_protocol_kind:
            completion_payload = raw
        else:
            pass
    completion_is_map2 = _core_type_is(completion_payload, "object")
    if completion_is_map2:
        completion_type = _core_get(completion_payload, "type", kind)
        is_final = _core_eq(completion_type, "final")
        if is_final:
            completion_payload = _normalize_agent_final_payload(completion_payload)
            kind = "final"
        else:
            is_clarification = _core_eq(completion_type, "askClarification")
            if is_clarification:
                completion_payload = _normalize_agent_clarification_payload(completion_payload)
                kind = "askClarification"
            else:
                pass
    else:
        pass
    is_guide_kind = _core_eq(kind, "guide_agent")
    if is_guide_kind:
        guidance_payload = _normalize_agent_guidance_payload(raw, "")
    else:
        pass
    out["type"] = "runtime_step"
    out["kind"] = kind
    out["code"] = code
    out["result"] = result
    out["output"] = output
    out["is_error"] = is_error
    out["error"] = error_message
    out["error_category"] = error_category
    out["completion_payload"] = completion_payload
    out["discover_request"] = discover_request
    out["recall_request"] = recall_request
    out["used_request"] = used_request
    out["callable_request"] = callable_request
    out["guidance_payload"] = guidance_payload
    out["status"] = status
    is_closed = _core_eq(error_category, "session_closed")
    if is_closed:
        out["restart_notice"] = "runtime session closed; restarting fresh session"
    else:
        pass
    is_abort = _core_eq(error_category, "abort")
    is_aborted = _core_eq(error_category, "aborted")
    is_user_error = _core_eq(error_category, "user_error")
    abort_like = _core_or(is_abort, is_aborted)
    should_escape = _core_or(abort_like, is_user_error)
    if should_escape:
        escape_message = _core_string_format("runtime host boundary escaped {}: {}", error_category, error_message)
        escape_error = _core_runtime_error(escape_message)
        raise escape_error
    else:
        pass
    return out


def _agent_runtime_execution_options(state: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_execution_options")
    empty_map = {}
    reserved_names = _agent_reserved_runtime_names()
    runtime_options = _core_map_merge(empty_map, options)
    _core_map_delete(runtime_options, "runtime")
    runtime_options["reservedNames"] = reserved_names
    timeout_ms = _core_get(options, "timeout_ms", None)
    timeout = _core_get(options, "timeout", timeout_ms)
    has_timeout = _core_is_not_none(timeout)
    if has_timeout:
        runtime_options["timeout"] = timeout
    else:
        pass
    abort_snake = _core_get(options, "abort", False)
    aborted = _core_get(options, "aborted", abort_snake)
    abort_signal = _core_get(options, "abortSignal", aborted)
    has_abort = _core_truthy(abort_signal)
    if has_abort:
        runtime_options["abort"] = True
    else:
        pass
    session_id_snake = _core_get(options, "session_id", None)
    session_id = _core_get(options, "sessionId", session_id_snake)
    has_session_id = _core_is_not_none(session_id)
    if has_session_id:
        runtime_options["sessionId"] = session_id
    else:
        pass
    trace_id_snake = _core_get(options, "trace_id", None)
    trace_id = _core_get(options, "traceId", trace_id_snake)
    has_trace_id = _core_is_not_none(trace_id)
    if has_trace_id:
        runtime_options["traceId"] = trace_id
    else:
        pass
    return runtime_options


def _agent_runtime_lifecycle_event(state: Any, action: str, details: Any) -> Any:
    _core_coverage_mark("_agent_runtime_lifecycle_event")
    empty_map = {}
    entry = _core_map_merge(empty_map, details)
    entry["type"] = "runtime_session"
    entry["action"] = action
    _agent_runtime_append_action_log(state, entry)
    _agent_record_trace_event(state, "runtime_lifecycle", entry)
    return entry


def _agent_runtime_create_session(state: Any, runtime: Any, globals: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_create_session")
    runtime_options = _agent_runtime_execution_options(state, options)
    session = _core_agent_runtime_create_session(runtime, globals, runtime_options)
    state["runtime_session"] = session
    state["runtime_globals"] = globals
    entry = {}
    entry["globals"] = globals
    entry["options"] = runtime_options
    _agent_runtime_lifecycle_event(state, "create_session", entry)
    return session


def _agent_runtime_execute_step(state: Any, runtime: Any, session: Any, code: str, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_execute_step")
    runtime_options = _agent_runtime_execution_options(state, options)
    empty_map = {}
    globals = _core_get(state, "runtime_globals", empty_map)
    missing_session = _core_is_none(session)
    if missing_session:
        session = _agent_runtime_create_session(state, runtime, globals, runtime_options)
    else:
        pass
    raw = _core_agent_runtime_execute(session, code, runtime_options)
    normalized = _normalize_agent_runtime_step_result(raw, code)
    closed = _core_get(normalized, "error_category", "")
    is_closed = _core_eq(closed, "session_closed")
    if is_closed:
        notice = {}
        notice["reason"] = "session_closed"
        _agent_runtime_lifecycle_event(state, "restart", notice)
        session = _agent_runtime_create_session(state, runtime, globals, runtime_options)
        raw = _core_agent_runtime_execute(session, code, runtime_options)
        normalized = _normalize_agent_runtime_step_result(raw, code)
    else:
        pass
    _agent_runtime_append_action_log(state, normalized)
    _agent_record_trace_event(state, "runtime_execute", normalized)
    step_error = _core_get(normalized, "is_error", False)
    if step_error:
        _agent_record_trace_event(state, "error", normalized)
    else:
        pass
    discover_request = _core_get(normalized, "discover_request", None)
    has_discover = _core_type_is(discover_request, "object")
    if has_discover:
        _agent_discover(state, discover_request)
    else:
        pass
    recall_request = _core_get(normalized, "recall_request", None)
    has_recall = _core_is_not_none(recall_request)
    if has_recall:
        _agent_recall(state, recall_request)
    else:
        pass
    used_request = _core_get(normalized, "used_request", None)
    has_used = _core_is_not_none(used_request)
    if has_used:
        _agent_used(state, used_request, "executor")
    else:
        pass
    callable_request = _core_get(normalized, "callable_request", None)
    has_callable = _core_is_not_none(callable_request)
    if has_callable:
        callable_result = _agent_execute_callable(state, callable_request, options)
        normalized["callable_result"] = callable_result
    else:
        pass
    guidance_payload = _core_get(normalized, "guidance_payload", None)
    has_guidance = _core_type_is(guidance_payload, "object")
    if has_guidance:
        _agent_append_guidance(state, guidance_payload)
    else:
        pass
    completion_payload = _core_get(normalized, "completion_payload", None)
    has_completion = _core_type_is(completion_payload, "object")
    if has_completion:
        state["last_runtime_completion"] = completion_payload
        completion_type = _core_get(completion_payload, "type", "")
        is_final_completion = _core_eq(completion_type, "final")
        if is_final_completion:
            _agent_record_trace_event(state, "final", completion_payload)
        else:
            is_clarification_completion = _core_eq(completion_type, "askClarification")
            if is_clarification_completion:
                _agent_record_trace_event(state, "clarification", completion_payload)
            else:
                pass
    else:
        pass
    status = _core_get(normalized, "status", None)
    has_status = _core_type_is(status, "object")
    if has_status:
        empty_list = []
        status_log = _core_get(state, "status_log", empty_list)
        status_log.append(status)
        state["status_log"] = status_log
        _agent_record_trace_event(state, "status", status)
    else:
        pass
    return normalized


def _agent_runtime_inspect_state(state: Any, session: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_inspect_state")
    inspection = _core_agent_runtime_inspect(session, options)
    state["runtime_inspection"] = inspection
    entry = {}
    entry["type"] = "runtime_session"
    entry["action"] = "inspect_globals"
    entry["result"] = inspection
    _agent_runtime_append_action_log(state, entry)
    return inspection


def _agent_runtime_export_session_state(state: Any, session: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_export_session_state")
    raw_snapshot = _core_agent_runtime_export_state(session, options)
    snapshot = _normalize_agent_runtime_snapshot(raw_snapshot)
    state["runtime_session_state"] = snapshot
    log_entry = {}
    log_entry["type"] = "runtime_session"
    log_entry["action"] = "snapshot_globals"
    log_entry["snapshot"] = snapshot
    _agent_runtime_append_action_log(state, log_entry)
    event = {}
    event["snapshot"] = snapshot
    _agent_record_trace_event(state, "state_export", event)
    return snapshot


def _agent_runtime_refresh_state_summary(state: Any, session: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_refresh_state_summary")
    empty_map = {}
    none = _core_none()
    policy = _core_get(state, "context_policy", None)
    state_summary = _core_get(policy, "stateSummary", empty_map)
    enabled = _core_get(state_summary, "enabled", False)
    if enabled:
        runtime_options = _agent_runtime_execution_options(state, options)
        raw_snapshot = _core_agent_runtime_export_state(session, runtime_options)
        snapshot = _normalize_agent_runtime_snapshot(raw_snapshot)
        state["runtime_session_state"] = snapshot
        return snapshot
    else:
        pass
    return none


def _agent_runtime_restore_session_state(state: Any, session: Any, snapshot: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_restore_session_state")
    normalized_snapshot = _normalize_agent_runtime_snapshot(snapshot)
    raw_restored = _core_agent_runtime_restore_state(session, normalized_snapshot, options)
    restored = _normalize_agent_runtime_snapshot(raw_restored)
    state["runtime_session_state"] = restored
    log_entry = {}
    log_entry["type"] = "runtime_session"
    log_entry["action"] = "patch_globals"
    log_entry["snapshot"] = restored
    _agent_runtime_append_action_log(state, log_entry)
    event = {}
    event["snapshot"] = restored
    _agent_record_trace_event(state, "state_restore", event)
    return restored


def _agent_runtime_close_session(state: Any, session: Any) -> Any:
    _core_coverage_mark("_agent_runtime_close_session")
    closed = _core_agent_runtime_close(session)
    state["runtime_session_closed"] = True
    entry = {}
    entry["result"] = closed
    _agent_runtime_lifecycle_event(state, "close_session", entry)
    return closed


def _agent_runtime_test(state: Any, runtime: Any, code: str, values: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_runtime_test")
    globals = _agent_runtime_build_globals(state, values)
    runtime_options = _agent_runtime_execution_options(state, options)
    session = _agent_runtime_create_session(state, runtime, globals, runtime_options)
    result = {}
    try:
        result = _agent_runtime_execute_step(state, runtime, session, code, runtime_options)
    except Exception as runtime_test_error:
        error_session = _core_get(state, "runtime_session", session)
        _agent_runtime_close_session(state, error_session)
        raise runtime_test_error
    active_session = _core_get(state, "runtime_session", session)
    _agent_runtime_close_session(state, active_session)
    return result


def _split_context_values(state: Any, values: Any) -> Any:
    _core_coverage_mark("_split_context_values")
    empty_list = []
    context_fields = _core_get(state, "context_fields", empty_list)
    ctx_values = {}
    non_ctx_values = {}
    for key in values:
        value = _core_get(values, key, None)
        is_context = _core_contains(context_fields, key)
        if is_context:
            ctx_values[key] = value
        else:
            non_ctx_values[key] = value
    out = {}
    out["context"] = ctx_values
    out["values"] = non_ctx_values
    return out


def _build_distiller_inputs(state: Any, values: Any) -> Any:
    _core_coverage_mark("_build_distiller_inputs")
    empty_map = {}
    split = _split_context_values(state, values)
    context = _core_get(split, "context", empty_map)
    cm_state = _core_get(state, "context_map", None)
    cm_text = _core_get(cm_state, "text", "")
    cm_has = _core_ne(cm_text, "")
    ctx_out = _core_map_merge(empty_map, context)
    if cm_has:
        ctx_out["contextMap"] = cm_text
    else:
        pass
    out = {}
    out["input"] = values
    out["context"] = ctx_out
    actor_context = _agent_prepare_actor_context(state)
    guidance_text = _core_get(actor_context, "guidanceLog", "[]")
    action_text = _core_get(actor_context, "actionLog", "(no actions yet)")
    summary_text = _core_get(actor_context, "summarizedActorLog", "")
    runtime_text = _core_get(actor_context, "liveRuntimeState", "")
    pressure_text = _core_get(actor_context, "contextPressure", "")
    out["summarizedActorLog"] = summary_text
    out["guidanceLog"] = guidance_text
    out["actionLog"] = action_text
    out["liveRuntimeState"] = runtime_text
    out["contextPressure"] = pressure_text
    return out


def _build_executor_inputs(state: Any, values: Any, distiller_payload: Any) -> Any:
    _core_coverage_mark("_build_executor_inputs")
    empty_list = []
    empty_map = {}
    split = _split_context_values(state, values)
    non_ctx = _core_get(split, "values", empty_map)
    empty = {}
    out = _core_map_merge(non_ctx, empty)
    args = _core_get(distiller_payload, "args", empty_list)
    fallback_request = _core_json_stringify(non_ctx)
    executor_request_raw = _core_list_get(args, 0, fallback_request)
    request_is_string = _core_type_is(executor_request_raw, "string")
    executor_request = executor_request_raw
    if request_is_string:
        pass
    else:
        executor_request_coerced = _core_string_format("{}", executor_request_raw)
        executor_request = executor_request_coerced
    distilled_context = _core_list_get(args, 1, empty_map)
    out["input"] = non_ctx
    out["executorRequest"] = executor_request
    out["distilledContext"] = distilled_context
    discovered_docs = _core_get(state, "discovered_tool_docs", empty_list)
    loaded_skills = _core_get(state, "loaded_skill_docs", empty_list)
    loaded_memories = _core_get(state, "loaded_memories", empty_list)
    discovered_text = _agent_render_discovered_tool_docs(discovered_docs)
    skills_text = _agent_render_loaded_skills(loaded_skills)
    actor_context = _agent_prepare_actor_context(state)
    guidance_text = _core_get(actor_context, "guidanceLog", "[]")
    action_text = _core_get(actor_context, "actionLog", "(no actions yet)")
    summary_text = _core_get(actor_context, "summarizedActorLog", "")
    runtime_text = _core_get(actor_context, "liveRuntimeState", "")
    pressure_text = _core_get(actor_context, "contextPressure", "")
    out["discoveredToolDocs"] = discovered_text
    out["loadedSkills"] = skills_text
    out["memories"] = loaded_memories
    out["summarizedActorLog"] = summary_text
    out["guidanceLog"] = guidance_text
    out["actionLog"] = action_text
    out["liveRuntimeState"] = runtime_text
    out["contextPressure"] = pressure_text
    exclude = _core_get(state, "executor_exclude_fields", empty_list)
    for key in exclude:
        _core_map_delete(out, key)
        _core_map_delete(non_ctx, key)
    return out


def _build_responder_inputs(state: Any, values: Any, executor_payload: Any) -> Any:
    _core_coverage_mark("_build_responder_inputs")
    empty_list = []
    empty_map = {}
    split = _split_context_values(state, values)
    non_ctx = _core_get(split, "values", empty_map)
    empty = {}
    out = _core_map_merge(values, empty)
    args = _core_get(executor_payload, "args", empty_list)
    task = _core_list_get(args, 0, "")
    context = _core_list_get(args, 1, empty_map)
    context_data = {}
    context_data["task"] = task
    context_data["evidence"] = context
    out["contextData"] = context_data
    out["agentTask"] = task
    out["agentContext"] = context
    out["executorResult"] = executor_payload
    exclude = _core_get(state, "responder_exclude_fields", empty_list)
    for key in exclude:
        _core_map_delete(out, key)
        _core_map_delete(non_ctx, key)
    return out


def _agent_render_field_token(field: Any) -> str:
    _core_coverage_mark("_agent_render_field_token")
    empty_list = []
    name = _core_get(field, "name", "")
    parts = []
    parts.append(name)
    is_optional = _core_get(field, "is_optional", False)
    if is_optional:
        parts.append("?")
    else:
        pass
    is_internal = _core_get(field, "is_internal", False)
    if is_internal:
        parts.append("!")
    else:
        pass
    ftype = _core_get(field, "type", None)
    tname = ""
    has_type = _core_is_not_none(ftype)
    if has_type:
        tname = _core_get(ftype, "name", "")
        parts.append(":")
        parts.append(tname)
        is_array = _core_get(ftype, "is_array", False)
        if is_array:
            parts.append("[]")
        else:
            pass
        is_class = _core_eq(tname, "class")
        if is_class:
            options = _core_get(ftype, "options", empty_list)
            opt_count = _core_len(options)
            has_opts = _core_ne(opt_count, 0)
            if has_opts:
                opts_joined = _core_string_join(" | ", options)
                parts.append(" \"")
                parts.append(opts_joined)
                parts.append("\"")
            else:
                pass
        else:
            pass
    else:
        pass
    description = _core_get(field, "description", "")
    desc_none = _core_is_none(description)
    if desc_none:
        description = ""
    else:
        pass
    has_desc = _core_ne(description, "")
    is_class_desc = _core_eq(tname, "class")
    not_class = _core_not(is_class_desc)
    render_desc = _core_and(has_desc, not_class)
    if render_desc:
        parts.append(" \"")
        parts.append(description)
        parts.append("\"")
    else:
        pass
    result = _core_string_join("", parts)
    return result


def _build_responder_signature(sig: Any, context_fields: Any) -> str:
    _core_coverage_mark("_build_responder_signature")
    empty_list = []
    input_fields = _core_get(sig, "input_fields", empty_list)
    output_fields = _core_get(sig, "output_fields", empty_list)
    description = _core_get(sig, "description", "")
    desc_none = _core_is_none(description)
    if desc_none:
        description = ""
    else:
        pass
    input_tokens = []
    for field in input_fields:
        fname = _core_get(field, "name", "")
        is_context = _core_contains(context_fields, fname)
        not_context = _core_not(is_context)
        if not_context:
            tok = _agent_render_field_token(field)
            input_tokens.append(tok)
        else:
            pass
    ctx_field = {}
    ctx_field["name"] = "contextData"
    ctx_type = {}
    ctx_type["name"] = "json"
    ctx_field["type"] = ctx_type
    ctx_tok = _agent_render_field_token(ctx_field)
    input_tokens.append(ctx_tok)
    output_tokens = []
    for ofield in output_fields:
        otok = _agent_render_field_token(ofield)
        output_tokens.append(otok)
    inputs_joined = _core_string_join(", ", input_tokens)
    outputs_joined = _core_string_join(", ", output_tokens)
    body_parts = []
    has_desc = _core_ne(description, "")
    if has_desc:
        body_parts.append("\"")
        body_parts.append(description)
        body_parts.append("\" ")
    else:
        pass
    body_parts.append(inputs_joined)
    body_parts.append(" -> ")
    body_parts.append(outputs_joined)
    sig_string = _core_string_join("", body_parts)
    return sig_string


def _normalize_agent_completion_payload(output: Any) -> Any:
    _core_coverage_mark("_normalize_agent_completion_payload")
    completion = _core_get(output, "completion", output)
    payload = _core_get(completion, "executorResult", completion)
    type = _core_get(payload, "type", None)
    is_final = _core_eq(type, "final")
    is_clarification = _core_eq(type, "askClarification")
    valid = _core_or(is_final, is_clarification)
    invalid = _core_not(valid)
    if invalid:
        message = _core_string_format("agent stage did not return a completion payload (a live model returns prose, but this stage expects a structured completion): pass options.runtime with a code engine so the executor runs model-generated code that calls final(...), or use a client that returns a structured final/askClarification completion. got: {}", payload)
        error = _core_runtime_error(message)
        raise error
    else:
        pass
    return payload


def _throw_agent_clarification(payload: Any, state: Any) -> None:
    _core_coverage_mark("_throw_agent_clarification")
    type = _core_get(payload, "type", None)
    is_clarification = _core_eq(type, "askClarification")
    if is_clarification:
        error = _core_agent_clarification_error(payload, state)
        raise error
    else:
        pass
    none = _core_none()
    return none


def _merge_agent_chat_log(state: Any, distiller: Any, executor: Any, responder: Any) -> list[Any]:
    _core_coverage_mark("_merge_agent_chat_log")
    logs = []
    distiller_logs = _core_agent_stage_chat_log(distiller)
    for entry in distiller_logs:
        entry["name"] = "distiller"
        entry["stage"] = "ctx"
        logs.append(entry)
    executor_logs = _core_agent_stage_chat_log(executor)
    for entry in executor_logs:
        entry["name"] = "executor"
        entry["stage"] = "task"
        logs.append(entry)
    responder_logs = _core_agent_stage_chat_log(responder)
    for entry in responder_logs:
        entry["name"] = "responder"
        entry["stage"] = "task"
        logs.append(entry)
    state["chat_log"] = logs
    return logs


def _merge_agent_usage(state: Any) -> Any:
    _core_coverage_mark("_merge_agent_usage")
    empty_list = []
    chat_log = _core_get(state, "chat_log", empty_list)
    count = _core_len(chat_log)
    usage = {}
    usage["chat_log_entries"] = count
    state["usage"] = usage
    return usage


def _agent_get_state(state: Any) -> Any:
    _core_coverage_mark("_agent_get_state")
    empty_map = {}
    runtime_state = _core_get(state, "runtime_state", empty_map)
    return runtime_state


def _agent_set_state(state: Any, runtime_state: Any) -> Any:
    _core_coverage_mark("_agent_set_state")
    state["runtime_state"] = runtime_state
    return runtime_state


def _agent_stage_options(state: Any, stage: str, forward_options: Any) -> Any:
    _core_coverage_mark("_agent_stage_options")
    empty_map = {}
    base_options = _core_get(state, "options", empty_map)
    stage_options = {}
    is_distiller = _core_eq(stage, "distiller")
    is_executor = _core_eq(stage, "executor")
    is_responder = _core_eq(stage, "responder")
    if is_distiller:
        context_opts_camel = _core_get(base_options, "contextOptions", empty_map)
        stage_options = _core_get(base_options, "context_options", context_opts_camel)
    else:
        pass
    if is_executor:
        executor_opts_camel = _core_get(base_options, "executorOptions", empty_map)
        stage_options = _core_get(base_options, "executor_options", executor_opts_camel)
    else:
        pass
    if is_responder:
        responder_opts_camel = _core_get(base_options, "responderOptions", empty_map)
        stage_options = _core_get(base_options, "responder_options", responder_opts_camel)
    else:
        pass
    out = _core_map_merge(stage_options, forward_options)
    top_cache_snake = _core_get(base_options, "context_cache", None)
    top_cache = _core_get(base_options, "contextCache", top_cache_snake)
    stage_cache_snake = _core_get(stage_options, "context_cache", None)
    stage_cache = _core_get(stage_options, "contextCache", stage_cache_snake)
    call_cache_snake = _core_get(forward_options, "context_cache", None)
    call_cache = _core_get(forward_options, "contextCache", call_cache_snake)
    cache = top_cache
    has_stage_cache = _core_is_not_none(stage_cache)
    if has_stage_cache:
        cache = stage_cache
    else:
        pass
    has_call_cache = _core_is_not_none(call_cache)
    if has_call_cache:
        cache = call_cache
    else:
        pass
    has_cache = _core_is_not_none(cache)
    if has_cache:
        out["context_cache"] = cache
        out["contextCache"] = cache
    else:
        pass
    return out


def _extract_agent_runtime_code(state: Any, executor_output: Any) -> str:
    _core_coverage_mark("_extract_agent_runtime_code")
    runtime_contract = _core_get(state, "runtime_contract", None)
    code_field_name = _core_get(runtime_contract, "code_field_name", "javascriptCode")
    code = _core_get(executor_output, code_field_name, "")
    completion = _core_get(executor_output, "completion", executor_output)
    completion_code = _core_get(completion, code_field_name, code)
    code = completion_code
    missing = _core_eq(code, "")
    if missing:
        message = _core_string_format("agent executor did not return runtime code field: {}", code_field_name)
        error = _core_runtime_error(message)
        raise error
    else:
        pass
    return code


def _agent_apply_llm_checkpoint_summary(state: Any, client: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_apply_llm_checkpoint_summary")
    empty_map = {}
    checkpoint = _core_get(state, "checkpoint_state", None)
    has_checkpoint = _core_is_not_none(checkpoint)
    if has_checkpoint:
        pending = _core_get(checkpoint, "llm_pending", False)
        if pending:
            llm_input = _core_get(checkpoint, "llm_input", "")
            instruction = "You are an internal AxAgent trajectory summarizer. Compress the execution history into a concise ledger with exactly these labels in order: Objective:, Current state and artifacts:, Exact callables and formats:, Evidence:, User constraints and preferences:, Failures to avoid:, Next step:. Use 'none' when a section is empty. Be concise and factual."
            messages = []
            sys = {}
            sys["role"] = "system"
            sys["content"] = instruction
            messages.append(sys)
            usr = {}
            usr["role"] = "user"
            usr["content"] = llm_input
            messages.append(usr)
            request = {}
            request["chat_prompt"] = messages
            response = _core_ai_complete_once(client, request)
            text = _core_get(response, "content", "")
            has_text = _core_ne(text, "")
            if has_text:
                updated = _core_map_merge(empty_map, checkpoint)
                updated["summary"] = text
                updated["summary_source"] = "model"
                updated["llm_pending"] = False
                state["checkpoint_state"] = updated
            else:
                pass
        else:
            pass
    else:
        pass
    return state


def _context_map_sections() -> Any:
    _core_coverage_mark("_context_map_sections")
    sections = []
    s1 = {}
    s1["name"] = "context_roadmap"
    s1["title"] = "CONTEXT ROADMAP"
    s1["slug"] = "cr"
    sections.append(s1)
    s2 = {}
    s2["name"] = "context_understanding"
    s2["title"] = "CONTEXT UNDERSTANDING"
    s2["slug"] = "cu"
    sections.append(s2)
    s3 = {}
    s3["name"] = "domain_constants"
    s3["title"] = "DOMAIN CONSTANTS"
    s3["slug"] = "dc"
    sections.append(s3)
    s4 = {}
    s4["name"] = "parsing_schema"
    s4["title"] = "PARSING SCHEMA"
    s4["slug"] = "ps"
    sections.append(s4)
    s5 = {}
    s5["name"] = "reusable_results"
    s5["title"] = "REUSABLE RESULTS"
    s5["slug"] = "rr"
    sections.append(s5)
    s6 = {}
    s6["name"] = "error_patterns"
    s6["title"] = "ERROR PATTERNS"
    s6["slug"] = "ep"
    sections.append(s6)
    return sections


def _context_map_parse_items(text: Any) -> Any:
    _core_coverage_mark("_context_map_parse_items")
    sections = _context_map_sections()
    items = []
    lines = _core_string_split_trim_nonempty(text, "\n")
    current = "context_understanding"
    for line in lines:
        is_header = _core_string_starts_with(line, "##")
        if is_header:
            title_raw = _core_string_replace(line, "#", "")
            title = str(title_raw).strip()
            for sec in sections:
                sec_title = _core_get(sec, "title", None)
                match = _core_eq(sec_title, title)
                if match:
                    sec_name = _core_get(sec, "name", None)
                    current = sec_name
                else:
                    pass
        else:
            is_item = _core_string_starts_with(line, "[")
            if is_item:
                parts = _core_string_split_once(line, "]")
                left = _core_get(parts, "left", "")
                right = _core_get(parts, "right", "")
                id_raw = _core_string_replace(left, "[", "")
                id = str(id_raw).strip()
                content = str(right).strip()
                id_ok = _core_ne(id, "")
                content_ok = _core_ne(content, "")
                valid = _core_and(id_ok, content_ok)
                if valid:
                    item = {}
                    item["id"] = id
                    item["section"] = current
                    item["content"] = content
                    items.append(item)
                else:
                    pass
            else:
                pass
    return items


def _context_map_render_items(items: Any) -> Any:
    _core_coverage_mark("_context_map_render_items")
    sections = _context_map_sections()
    parts = []
    for sec in sections:
        sec_name = _core_get(sec, "name", None)
        sec_title = _core_get(sec, "title", None)
        header = _core_string_format("## {}", sec_title)
        parts.append(header)
        for item in items:
            item_sec = _core_get(item, "section", None)
            in_sec = _core_eq(item_sec, sec_name)
            if in_sec:
                id = _core_get(item, "id", None)
                content = _core_get(item, "content", None)
                line = _core_string_format("[{}] {}", id, content)
                parts.append(line)
            else:
                pass
    text = _core_string_join("\n", parts)
    return text


def _context_map_update_scores(scores: Any, item_tags: Any) -> Any:
    _core_coverage_mark("_context_map_update_scores")
    empty_map = {}
    out = _core_map_merge(empty_map, scores)
    is_obj = _core_type_is(item_tags, "object")
    if is_obj:
        for id in item_tags:
            tag = _core_get(item_tags, id, None)
            cur = _core_get(out, id, 0)
            is_helpful = _core_eq(tag, "helpful")
            if is_helpful:
                up = _core_add(cur, 1)
                out[id] = up
            else:
                pass
            is_harmful = _core_eq(tag, "harmful")
            if is_harmful:
                down = _core_add(cur, -1)
                out[id] = down
            else:
                pass
            is_stale = _core_eq(tag, "stale")
            if is_stale:
                down2 = _core_add(cur, -1)
                out[id] = down2
            else:
                pass
    else:
        pass
    return out


def _context_map_apply_operations(items: Any, operations: Any, next_id: Any) -> Any:
    _core_coverage_mark("_context_map_apply_operations")
    sections = _context_map_sections()
    deletes = {}
    replaces = {}
    raw_adds = []
    is_list = _core_type_is(operations, "list")
    if is_list:
        for op in operations:
            type = _core_get(op, "type", "")
            is_delete = _core_eq(type, "DELETE")
            if is_delete:
                del_a = _core_get(op, "item_id", "")
                del_id = _core_get(op, "itemId", del_a)
                deletes[del_id] = True
            else:
                pass
            is_replace = _core_eq(type, "REPLACE")
            if is_replace:
                rep_a = _core_get(op, "item_id", "")
                rep_id = _core_get(op, "itemId", rep_a)
                rep_content = _core_get(op, "content", "")
                replaces[rep_id] = rep_content
            else:
                pass
            is_add = _core_eq(type, "ADD")
            if is_add:
                add_section = _core_get(op, "section", "context_understanding")
                add_content = _core_get(op, "content", "")
                content_ok = _core_ne(add_content, "")
                if content_ok:
                    raw = {}
                    raw["section"] = add_section
                    raw["content"] = add_content
                    raw_adds.append(raw)
                else:
                    pass
            else:
                pass
    else:
        pass
    result_items = []
    for item in items:
        id = _core_get(item, "id", None)
        deleted = _core_get(deletes, id, False)
        keep = _core_not(deleted)
        if keep:
            kept = {}
            kept["id"] = id
            sec = _core_get(item, "section", None)
            kept["section"] = sec
            new_content = _core_get(replaces, id, None)
            has_replace = _core_is_not_none(new_content)
            if has_replace:
                kept["content"] = new_content
            else:
                old_content = _core_get(item, "content", None)
                kept["content"] = old_content
            result_items.append(kept)
        else:
            pass
    counter = next_id
    for radd in raw_adds:
        radd_section = _core_get(radd, "section", None)
        radd_content = _core_get(radd, "content", None)
        slug = "cu"
        for sec in sections:
            sname = _core_get(sec, "name", None)
            smatch = _core_eq(sname, radd_section)
            if smatch:
                sslug = _core_get(sec, "slug", None)
                slug = sslug
            else:
                pass
        new_id = _core_string_format("{}-{}", slug, counter)
        inc = _core_add(counter, 1)
        counter = inc
        add_item = {}
        add_item["id"] = new_id
        add_item["section"] = radd_section
        add_item["content"] = radd_content
        result_items.append(add_item)
    out = {}
    out["items"] = result_items
    out["next_id"] = counter
    return out


def _context_map_evict_to_budget(items: Any, scores: Any, max_chars: Any) -> Any:
    _core_coverage_mark("_context_map_evict_to_budget")
    current = items
    while True:
        text = _context_map_render_items(current)
        len = _core_len(text)
        over = _core_gt(len, max_chars)
        not_over = _core_not(over)
        if not_over:
            break
        else:
            pass
        count = _core_len(current)
        empty = _core_eq(count, 0)
        if empty:
            break
        else:
            pass
        min_id = ""
        min_score = 0
        have_min = False
        for item in current:
            iid = _core_get(item, "id", None)
            iscore = _core_get(scores, iid, 0)
            first = _core_not(have_min)
            lower = _core_lt(iscore, min_score)
            take = _core_or(first, lower)
            if take:
                min_id = iid
                min_score = iscore
                have_min = True
            else:
                pass
        next_items = []
        for item in current:
            iid = _core_get(item, "id", None)
            is_min = _core_eq(iid, min_id)
            keep = _core_not(is_min)
            if keep:
                next_items.append(item)
            else:
                pass
        current = next_items
    return current


def _format_context_map_trajectory(state: Any) -> Any:
    _core_coverage_mark("_format_context_map_trajectory")
    empty_list = []
    action_log = _core_get(state, "action_log", empty_list)
    action_text = _core_json_stable_stringify(action_log)
    status_log = _core_get(state, "status_log", empty_list)
    status_text = _core_json_stable_stringify(status_log)
    out = _core_string_format("## Executor Action Log\n{}\n\n## Status Log\n{}", action_text, status_text)
    return out


def _context_map_complete(client: Any, system: Any, user: Any) -> Any:
    _core_coverage_mark("_context_map_complete")
    messages = []
    sys = {}
    sys["role"] = "system"
    sys["content"] = system
    messages.append(sys)
    usr = {}
    usr["role"] = "user"
    usr["content"] = user
    messages.append(usr)
    request = {}
    request["chat_prompt"] = messages
    response = _core_ai_complete_once(client, request)
    content = _core_get(response, "content", "")
    return content


def _context_map_parse_json(content: Any) -> Any:
    _core_coverage_mark("_context_map_parse_json")
    empty_map = {}
    trimmed = str(content).strip()
    is_empty = _core_eq(trimmed, "")
    if is_empty:
        return empty_map
    else:
        pass
    looks_object = _core_string_starts_with(trimmed, "{")
    not_object = _core_not(looks_object)
    if not_object:
        return empty_map
    else:
        pass
    parsed = _core_json_parse(trimmed)
    is_obj = _core_type_is(parsed, "object")
    if is_obj:
        return parsed
    else:
        pass
    return empty_map


def _agent_evolve_context_map(state: Any, client: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_evolve_context_map")
    empty_map = {}
    empty_list = []
    cm = _core_get(state, "context_map", None)
    has_cm = _core_is_not_none(cm)
    infinite = _core_get(cm, "infiniteEvolve", False)
    steps = _core_get(cm, "steps", 0)
    evolve_steps = _core_get(cm, "evolveSteps", 0)
    under_budget = _core_lt(steps, evolve_steps)
    evolve_ok = _core_or(infinite, under_budget)
    should_evolve = _core_and(has_cm, evolve_ok)
    if should_evolve:
        current_text = _core_get(cm, "text", "")
        scores = _core_get(cm, "scores", empty_map)
        max_chars = _core_get(cm, "maxChars", 4000)
        next_id = _core_get(cm, "next_id", 1)
        task = _core_get(state, "task_description", "")
        trajectory = _format_context_map_trajectory(state)
        distiller_sys = "You are the context-map Distiller for a recurring external context used by an AxAgent RLM loop.\n\nYour job is to read the completed trajectory and identify reusable orientation knowledge about the external context. The context map is a persistent cache of understanding, not a transcript summary, task playbook, or answer cache.\n\nCache only orientation work: would a future agent asking a completely different question about the same context benefit from knowing this?\n\nReview every existing context-map item before proposing new knowledge. Tag each existing item ID as exactly one of helpful, harmful, neutral, or stale. Treat unused-but-correct domain knowledge as neutral, not harmful.\n\nReturn:\n- diagnosis: concise analysis of orientation work vs. question-specific work.\n- itemTags: object mapping existing context-map item IDs to helpful, harmful, neutral, or stale.\n- cacheCandidates: JSON array of objects with section, value, transferability, and rationale."
        distiller_user = _core_string_format("task: {}\n\ncontextMap:\n{}\n\ntrajectory:\n{}", task, current_text, trajectory)
        distiller_resp = _context_map_complete(client, distiller_sys, distiller_user)
        distiller_parsed = _context_map_parse_json(distiller_resp)
        item_tags = _core_get(distiller_parsed, "itemTags", empty_map)
        reflection = _core_json_stringify(distiller_parsed)
        current_chars = _core_len(current_text)
        carto_sys = "You are the context-map Cartographer for a recurring external context used by an AxAgent RLM loop.\n\nTranslate the Distiller reflection into a small set of concrete context-map edits. Maintain a concise, high-value context map that stores shared understanding of the external context, not answers to individual questions.\n\nPrefer REPLACE over ADD when an existing item can be made more correct, compact, or general. DELETE stale, misleading, redundant, low-value, verbose, or question-specific items. ADD only transferable context understanding. When the map is near or over budget, remove or rewrite low-value entries first. If nothing is worth keeping, return an empty operations list.\n\nReturn operations as JSON objects under the key operations:\n- {\"type\":\"ADD\",\"section\":\"context_understanding\",\"content\":\"...\"}\n- {\"type\":\"DELETE\",\"item_id\":\"cu-1\"}\n- {\"type\":\"REPLACE\",\"item_id\":\"cu-1\",\"content\":\"...\"}"
        carto_user_head = _core_string_format("task: {}\n\ncontextMap:\n{}\n\ndistillerReflection:\n{}", task, current_text, reflection)
        carto_user = _core_string_format("{}\n\ncurrentChars: {}\nmaxChars: {}", carto_user_head, current_chars, max_chars)
        carto_resp = _context_map_complete(client, carto_sys, carto_user)
        carto_parsed = _context_map_parse_json(carto_resp)
        operations = _core_get(carto_parsed, "operations", empty_list)
        items = _context_map_parse_items(current_text)
        new_scores = _context_map_update_scores(scores, item_tags)
        applied = _context_map_apply_operations(items, operations, next_id)
        new_items = _core_get(applied, "items", empty_list)
        new_next_id = _core_get(applied, "next_id", next_id)
        evicted = _context_map_evict_to_budget(new_items, new_scores, max_chars)
        new_text = _context_map_render_items(evicted)
        new_steps = _core_add(steps, 1)
        updated = _core_map_merge(empty_map, cm)
        updated["text"] = new_text
        updated["scores"] = new_scores
        updated["steps"] = new_steps
        updated["next_id"] = new_next_id
        state["context_map"] = updated
    else:
        pass
    return state


def _agent_transcribe_one_audio(client: Any, audio: Any, transcribe_opts: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_transcribe_one_audio")
    empty_map = {}
    is_object = _core_type_is(audio, "object")
    if is_object:
        has_data = _core_map_contains(audio, "data")
        if has_data:
            request = _core_map_merge(empty_map, transcribe_opts)
            request["audio"] = audio
            response = _core_agent_transcribe(client, request, options)
            text = _core_get(response, "text", "")
            return text
        else:
            pass
    else:
        pass
    return audio


def _agent_transcribe_audio_inputs(state: Any, client: Any, values: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_transcribe_audio_inputs")
    empty_list = []
    empty_map = {}
    sig = _core_get(state, "signature", empty_map)
    input_fields = _core_get(sig, "input_fields", empty_list)
    speech = _core_get(options, "speech", empty_map)
    transcribe_opts = _core_get(speech, "transcribe", empty_map)
    result = _core_map_merge(empty_map, values)
    for field in input_fields:
        ftype = _core_get(field, "type", empty_map)
        tname = _core_get(ftype, "name", "")
        is_audio = _core_eq(tname, "audio")
        if is_audio:
            fname = _core_get(field, "name", None)
            has = _core_map_contains(result, fname)
            if has:
                value = _core_get(result, fname, None)
                is_string = _core_type_is(value, "string")
                is_list = _core_type_is(value, "list")
                if is_list:
                    transcribed = []
                    for item in value:
                        item_text = _agent_transcribe_one_audio(client, item, transcribe_opts, options)
                        transcribed.append(item_text)
                    result[fname] = transcribed
                else:
                    do_single = _core_not(is_string)
                    if do_single:
                        text = _agent_transcribe_one_audio(client, value, transcribe_opts, options)
                        result[fname] = text
                    else:
                        pass
            else:
                pass
        else:
            pass
    return result


def _agent_run_llm_query_one(sub_gen: Any, client: Any, item: Any) -> str:
    _core_coverage_mark("_agent_run_llm_query_one")
    empty_map = {}
    query = ""
    context = empty_map
    item_is_string = _core_type_is(item, "string")
    if item_is_string:
        query = item
    else:
        query = _core_get(item, "query", "")
        context = _core_get(item, "context", empty_map)
    values = {}
    values["task"] = query
    values["context"] = context
    sub_options = {}
    output = _core_agent_stage_forward(sub_gen, client, values, sub_options)
    answer = _core_get(output, "answer", "")
    return answer


def _agent_run_llm_query(sub_gen: Any, client: Any, params: Any) -> Any:
    _core_coverage_mark("_agent_run_llm_query")
    params_is_list = _core_type_is(params, "list")
    if params_is_list:
        answers = []
        for item in params:
            one = _agent_run_llm_query_one(sub_gen, client, item)
            answers.append(one)
        return answers
    else:
        pass
    single = _agent_run_llm_query_one(sub_gen, client, params)
    return single


def _agent_forward(state: Any, distiller: Any, executor: Any, responder: Any, client: Any, values: Any, options: Any) -> Any:
    _core_coverage_mark("_agent_forward")
    transcribed_values = _agent_transcribe_audio_inputs(state, client, values, options)
    values = transcribed_values
    _agent_begin_trace(state, values)
    _agent_apply_llm_checkpoint_summary(state, client, options)
    state_options = _core_get(state, "options", None)
    runtime_from_state = _core_get(state_options, "runtime", None)
    runtime_from_options = _core_get(options, "runtime", runtime_from_state)
    runtime_enabled = _core_is_not_none(runtime_from_options)
    distiller_options = _agent_stage_options(state, "distiller", options)
    executor_options = _agent_stage_options(state, "executor", options)
    responder_options = _agent_stage_options(state, "responder", options)
    distiller_payload = _core_none()
    if runtime_enabled:
        distiller_empty_log = []
        distiller_saved_action_log = _core_get(state, "action_log", distiller_empty_log)
        distiller_globals = _agent_runtime_build_globals(state, values)
        distiller_session = _core_none()
        distiller_max_steps = _core_get(options, "max_actor_steps", 4)
        distiller_step = 0
        while True:
            distiller_too_many = _core_gte(distiller_step, distiller_max_steps)
            if distiller_too_many:
                distiller_error_event = {}
                distiller_error_event["error"] = "agent distiller loop exceeded max steps"
                distiller_error_event["stage"] = "distiller"
                _agent_record_trace_event(state, "error", distiller_error_event)
                distiller_error = _core_runtime_error("agent distiller loop exceeded max steps")
                raise distiller_error
            else:
                pass
            distiller_values = _build_distiller_inputs(state, values)
            distiller_request_event = {}
            distiller_request_event["stage"] = "distiller"
            distiller_request_event["step"] = distiller_step
            distiller_request_event["values"] = distiller_values
            distiller_request_event["component_id"] = "agent.stage.distiller"
            _agent_record_trace_event(state, "stage_request", distiller_request_event)
            distiller_output = _core_agent_stage_forward(distiller, client, distiller_values, distiller_options)
            distiller_response_event = {}
            distiller_response_event["stage"] = "distiller"
            distiller_response_event["step"] = distiller_step
            distiller_response_event["output"] = distiller_output
            distiller_response_event["component_id"] = "agent.stage.distiller"
            _agent_record_trace_event(state, "stage_response", distiller_response_event)
            distiller_code = _extract_agent_runtime_code(state, distiller_output)
            distiller_runtime_step = _agent_runtime_execute_step(state, runtime_from_options, distiller_session, distiller_code, options)
            distiller_session = _core_get(state, "runtime_session", distiller_session)
            distiller_step_error = _core_get(distiller_runtime_step, "is_error", False)
            distiller_step_ok = _core_not(distiller_step_error)
            if distiller_step_ok:
                _agent_runtime_refresh_state_summary(state, distiller_session, options)
            else:
                pass
            distiller_completion = _core_get(distiller_runtime_step, "completion_payload", None)
            distiller_has_completion = _core_type_is(distiller_completion, "object")
            if distiller_has_completion:
                distiller_payload = distiller_completion
                break
            else:
                pass
            distiller_step = _core_add(distiller_step, 1)
        distiller_session_reset = _core_none()
        state["runtime_session"] = distiller_session_reset
        state["action_log"] = distiller_saved_action_log
        distiller_state_reset = {}
        state["runtime_session_state"] = distiller_state_reset
    else:
        distiller_values = _build_distiller_inputs(state, values)
        distiller_request_event = {}
        distiller_request_event["stage"] = "distiller"
        distiller_request_event["values"] = distiller_values
        distiller_request_event["component_id"] = "agent.stage.distiller"
        _agent_record_trace_event(state, "stage_request", distiller_request_event)
        distiller_output = _core_agent_stage_forward(distiller, client, distiller_values, distiller_options)
        distiller_response_event = {}
        distiller_response_event["stage"] = "distiller"
        distiller_response_event["output"] = distiller_output
        distiller_response_event["component_id"] = "agent.stage.distiller"
        _agent_record_trace_event(state, "stage_response", distiller_response_event)
        distiller_payload = _normalize_agent_completion_payload(distiller_output)
    _throw_agent_clarification(distiller_payload, state)
    executor_payload = _core_none()
    if runtime_enabled:
        exec_empty_map = {}
        exec_empty_list = []
        exec_args = _core_get(distiller_payload, "args", exec_empty_list)
        exec_non_ctx_split = _split_context_values(state, values)
        exec_non_ctx = _core_get(exec_non_ctx_split, "values", exec_empty_map)
        exec_fallback_req = _core_json_stringify(exec_non_ctx)
        exec_req_raw = _core_list_get(exec_args, 0, exec_fallback_req)
        exec_req_is_string = _core_type_is(exec_req_raw, "string")
        exec_req = exec_req_raw
        if exec_req_is_string:
            pass
        else:
            exec_req_coerced = _core_string_format("{}", exec_req_raw)
            exec_req = exec_req_coerced
        exec_distilled = _core_list_get(exec_args, 1, exec_empty_map)
        exec_extras = {}
        exec_extras["executorRequest"] = exec_req
        exec_extras["distilledContext"] = exec_distilled
        exec_runtime_values = _core_map_merge(values, exec_extras)
        globals = _agent_runtime_build_globals(state, exec_runtime_values)
        session = _core_get(state, "runtime_session", None)
        max_steps = _core_get(options, "max_actor_steps", 4)
        step = 0
        while True:
            too_many = _core_gte(step, max_steps)
            if too_many:
                error_event = {}
                error_event["error"] = "agent actor loop exceeded max steps"
                error_event["stage"] = "executor"
                _agent_record_trace_event(state, "error", error_event)
                error = _core_runtime_error("agent actor loop exceeded max steps")
                raise error
            else:
                pass
            executor_values = _build_executor_inputs(state, values, distiller_payload)
            executor_request_event = {}
            executor_request_event["stage"] = "executor"
            executor_request_event["step"] = step
            executor_request_event["values"] = executor_values
            executor_request_event["component_id"] = "agent.stage.executor"
            _agent_record_trace_event(state, "stage_request", executor_request_event)
            executor_output = _core_agent_stage_forward(executor, client, executor_values, executor_options)
            executor_response_event = {}
            executor_response_event["stage"] = "executor"
            executor_response_event["step"] = step
            executor_response_event["output"] = executor_output
            executor_response_event["component_id"] = "agent.stage.executor"
            _agent_record_trace_event(state, "stage_response", executor_response_event)
            code = _extract_agent_runtime_code(state, executor_output)
            runtime_step = _agent_runtime_execute_step(state, runtime_from_options, session, code, options)
            session = _core_get(state, "runtime_session", session)
            exec_step_error = _core_get(runtime_step, "is_error", False)
            exec_step_ok = _core_not(exec_step_error)
            if exec_step_ok:
                _agent_runtime_refresh_state_summary(state, session, options)
            else:
                pass
            completion_payload = _core_get(runtime_step, "completion_payload", None)
            has_completion = _core_type_is(completion_payload, "object")
            if has_completion:
                _throw_agent_clarification(completion_payload, state)
                executor_payload = completion_payload
                break
            else:
                pass
            step = _core_add(step, 1)
    else:
        executor_values = _build_executor_inputs(state, values, distiller_payload)
        executor_request_event = {}
        executor_request_event["stage"] = "executor"
        executor_request_event["values"] = executor_values
        executor_request_event["component_id"] = "agent.stage.executor"
        _agent_record_trace_event(state, "stage_request", executor_request_event)
        executor_output = _core_agent_stage_forward(executor, client, executor_values, executor_options)
        executor_response_event = {}
        executor_response_event["stage"] = "executor"
        executor_response_event["output"] = executor_output
        executor_response_event["component_id"] = "agent.stage.executor"
        _agent_record_trace_event(state, "stage_response", executor_response_event)
        executor_payload = _normalize_agent_completion_payload(executor_output)
        _throw_agent_clarification(executor_payload, state)
    _agent_apply_llm_checkpoint_summary(state, client, options)
    _agent_apply_context_management(state)
    _agent_apply_llm_tombstone_summary(state, client, options)
    _agent_evolve_context_map(state, client, options)
    responder_values = _build_responder_inputs(state, values, executor_payload)
    responder_request_event = {}
    responder_request_event["stage"] = "responder"
    responder_request_event["values"] = responder_values
    responder_request_event["component_id"] = "agent.stage.responder"
    _agent_record_trace_event(state, "stage_request", responder_request_event)
    responder_output = _core_agent_stage_forward(responder, client, responder_values, responder_options)
    responder_response_event = {}
    responder_response_event["stage"] = "responder"
    responder_response_event["output"] = responder_output
    responder_response_event["component_id"] = "agent.stage.responder"
    _agent_record_trace_event(state, "stage_response", responder_response_event)
    logs = _merge_agent_chat_log(state, distiller, executor, responder)
    usage = _merge_agent_usage(state)
    state["last_output"] = responder_output
    state["chat_log"] = logs
    state["usage"] = usage
    _agent_finalize_trace(state, "completed", responder_output)
    return responder_output

# END AXIR CORE EMITTED FUNCTIONS
