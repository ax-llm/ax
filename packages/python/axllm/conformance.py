from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path
from typing import Any

from .ai import AnthropicClient, AzureOpenAIClient, AxAIServiceAuthenticationError, AxAIServiceError, AxAIServiceNetworkError, AxAIServiceResponseError, AxAIServiceStatusError, AxAIServiceStreamTerminatedError, AxAIServiceTimeoutError, AxBaseAI, AxBalancer, CohereClient, DeepSeekClient, GoogleGeminiClient, GrokClient, MistralClient, MultiServiceRouter, OpenAICompatibleClient, OpenAIResponsesClient, ProviderRouter, RekaClient, get_supported_ai_models, provider_descriptor, provider_model_catalog_summary, provider_normalize_profile, provider_profile_registry
from .ai import build_chat_request, build_embed_request, normalize_chat_response, normalize_embed_response, normalize_stream_delta, provider_resolve_profile, _gemini_build_speak_request, _gemini_build_transcribe_request, _gemini_normalize_speak_response, _gemini_normalize_transcribe_response, _grok_build_speak_request, _grok_build_transcribe_request, _openai_tool_call_to_provider_impl
from .gen import (
    ax,
    fold_stream,
    _adjust_optimization_score_for_actions,
    _build_optimization_eval_result,
    _build_optimization_eval_row,
    _build_optimizer_evidence_batch,
    _deserialize_optimized_artifact,
    _filter_optimization_components,
    _normalize_optimization_dataset,
    _normalize_optimization_metric_scores,
    _optimization_changed_components,
    _scalarize_optimization_scores,
    _serialize_optimized_artifact,
    _set_demos,
    _set_examples,
    _validate_optimized_artifact,
)
from .flow import (
    _FlowCallable,
    _flow_add_step,
    _flow_cache_key,
    _flow_condition_from_spec,
    _flow_merge_parallel_results,
    _flow_mapper_from_spec,
    _flow_step,
    _program_descriptor,
    flow,
)
from .agent import (
    AxAgent,
    AxAgentClarificationError,
    AxBootstrapFewShot,
    AxCodeRuntime,
    AxCodeSession,
    AxGEPA,
    OptimizerEngine,
    OptimizerEvaluator,
    _agent_context_fixture_result,
    _build_agent_eval_prediction,
    _build_optimization_judge_payload,
    _map_optimization_judge_quality_to_score,
    _normalize_policy_action_result,
    _optimized_artifact,
    _record_policy_event,
    _render_actor_primitive_guidance,
    _select_protocol_actions,
    _select_runtime_globals,
    _validate_policy_reserved_names,
    _normalize_agent_clarification_payload,
    _normalize_agent_final_payload,
    _normalize_agent_runtime_step_result,
    agent,
    optimize,
)
from .prompt import AxPromptTemplate, collect_template_variable_names, render_template_content, validate_prompt_template_syntax
from .runtime import ProcessCodeRuntime, RuntimeCapabilities, RuntimeEnvelope, RuntimeProtocolError
from .runtime_quickjs import AxQuickJsCodeRuntime
from .schema import strip_internal, to_json_schema, validate_output, validate_value
from .signature import AxSignature, f, s
from .tool import fn
from .mcp import mcp_jsonrpc_notification, mcp_jsonrpc_request, mcp_normalize_error, mcp_protocol_constants, run_mcp_conformance_fixture


class FixtureError(AssertionError):
    pass


class ConformanceScriptedAI(AxBaseAI):
    def __init__(self, responses=None, stream_events=None, transcribe_responses=None):
        super().__init__(name="scripted", model="scripted-chat", embed_model="scripted-embed")
        self.responses = list(responses or [])
        self.stream_events = list(stream_events or [])
        self.transcribe_responses = list(transcribe_responses or [])
        self.requests = []
        self.chat_calls = 0

    def _chat(self, request: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
        self.chat_calls += 1
        self.requests.append(copy.deepcopy(request))
        if not self.responses:
            raise RuntimeError("scripted client exhausted")
        return _legacy_response_to_chat_response(copy.deepcopy(self.responses.pop(0)))

    def _embed(self, request: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(copy.deepcopy(request))
        if not self.responses:
            raise RuntimeError("scripted client exhausted")
        return copy.deepcopy(self.responses.pop(0))

    def stream(self, request: dict[str, Any]):
        self.requests.append(copy.deepcopy(request))
        for event in self.stream_events:
            yield copy.deepcopy(event)

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self.requests.append(copy.deepcopy(request))
        if self.transcribe_responses:
            return copy.deepcopy(self.transcribe_responses.pop(0))
        return {"text": "fixture transcript"}

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self.requests.append(copy.deepcopy(request))
        return {"audio": "fixture-audio", "format": (request or {}).get("format", "pcm")}


def _fixture_ai_service_error(spec):
    error_type = (spec or {}).get("type", "network")
    message = (spec or {}).get("message", "fixture error")
    if error_type == "status":
        return AxAIServiceStatusError(message, status=int((spec or {}).get("status", 500)), retryable=True)
    if error_type == "authentication":
        return AxAIServiceAuthenticationError("Authentication failed", status=int((spec or {}).get("status", 401)))
    if error_type == "response":
        return AxAIServiceResponseError(message)
    if error_type == "timeout":
        return AxAIServiceTimeoutError(message, retryable=True)
    if error_type == "plain":
        return RuntimeError(message)
    return AxAIServiceNetworkError("Network Error: " + str(message), retryable=True)


class RouterFixtureService(AxBaseAI):
    def __init__(self, spec):
        super().__init__(
            name=spec.get("name", "fixture"),
            model=spec.get("model", "fixture-chat"),
            embed_model=spec.get("embed_model", spec.get("embedModel", "fixture-embed")),
            features=copy.deepcopy(spec.get("features") or _router_fixture_features()),
        )
        self.fixture_id = spec.get("id", f"{self.name}-id")
        self.model_list = copy.deepcopy(spec.get("modelList", spec.get("model_list")))
        self.requests = []
        self.responses = list(spec.get("responses") or [])
        self.metrics_value = copy.deepcopy(spec.get("metrics") or {"service": self.name, "calls": 0})

    def get_id(self):
        return self.fixture_id

    def get_model_list(self):
        return copy.deepcopy(self.model_list)

    def get_metrics(self):
        out = copy.deepcopy(self.metrics_value)
        if isinstance(out, dict) and "calls" in out:
            out["calls"] = len(self.requests)
        return out

    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        self.requests.append({"method": "chat", "opt": copy.deepcopy(options or {})})
        if self.responses:
            next_response = self.responses.pop(0)
            if isinstance(next_response, dict) and "error" in next_response:
                raise _fixture_ai_service_error(next_response.get("error") or {})
            return copy.deepcopy(next_response.get("response", next_response)) if isinstance(next_response, dict) else copy.deepcopy(next_response)
        return {"results": [{"index": 0, "content": f"{self.name} chat"}]}

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        self.requests.append({"method": "embed", "opt": copy.deepcopy(options or {})})
        return {"embeddings": [[1, 2]], "modelUsage": {"ai": self.name}}

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self.requests.append({"method": "transcribe", "opt": copy.deepcopy(options or {})})
        return {"text": f"{self.name} transcript"}

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self.requests.append({"method": "speak", "opt": copy.deepcopy(options or {})})
        return {"audio": "pcm"}


def _router_fixture_features(overrides=None):
    base = {
        "functions": False,
        "streaming": False,
        "media": {
            "images": {"supported": False, "formats": []},
            "audio": {"supported": False, "formats": [], "output": {"supported": False, "formats": []}},
            "files": {"supported": False, "formats": [], "uploadMethod": "none"},
            "urls": {"supported": False, "webSearch": False, "contextFetching": False},
        },
        "caching": {"supported": False, "types": []},
        "thinking": False,
        "multiTurn": True,
    }
    if overrides:
        base = _deep_merge(base, overrides)
    return base


def _deep_merge(left, right):
    out = copy.deepcopy(left)
    for key, value in (right or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


class ScriptedTransport:
    def __init__(self, responses):
        self.responses = list(responses or [])
        self.requests = []

    def __call__(self, request):
        self.requests.append(copy.deepcopy(request))
        if not self.responses:
            raise RuntimeError("scripted transport exhausted")
        return copy.deepcopy(self.responses.pop(0))


class ScriptedCodeSession(AxCodeSession):
    def __init__(self, runtime, globals_, options=None):
        self.runtime = runtime
        self.globals = copy.deepcopy(globals_ or {})
        self.create_options = copy.deepcopy(options or {})
        self.closed = False

    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        if self.closed:
            return {"is_error": True, "error_category": "session_closed", "error": "session closed"}
        if not self.runtime.script:
            raise RuntimeError("scripted runtime exhausted")
        step = copy.deepcopy(self.runtime.script.pop(0))
        expected = step.get("expected_code")
        if expected is not None and expected != code:
            raise RuntimeError(f"expected code {expected!r}, got {code!r}")
        if "expected_options_subset" in step:
            _assert_subset(options or {}, step["expected_options_subset"], "runtime execute options")
        self.runtime.executed.append(code)
        self.runtime.execute_options.append(copy.deepcopy(options or {}))
        self.globals.update(step.get("bindings_patch") or {})
        if step.get("close_before_result"):
            self.closed = True
        return copy.deepcopy(step.get("result", {"kind": "result", "result": dict(self.globals)}))

    def inspect_globals(self, options: dict[str, Any] | None = None) -> Any:
        if not self.runtime.capabilities.get("inspect", True):
            return "[runtime state inspection unavailable: runtime session does not implement inspect_globals()]"
        return copy.deepcopy(self.globals)

    def snapshot_globals(self, options: dict[str, Any] | None = None) -> Any:
        if not self.runtime.capabilities.get("snapshot", True):
            raise RuntimeError("AxCodeSession.snapshot_globals() is required to export AxAgent state")
        entries = [
            {"name": key, "type": type(value).__name__, "preview": repr(value)}
            for key, value in self.globals.items()
        ]
        return {
            "version": 1,
            "entries": entries,
            "bindings": copy.deepcopy(self.globals),
            "globals": copy.deepcopy(self.globals),
            "closed": self.closed,
        }

    def patch_globals(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        if not self.runtime.capabilities.get("patch", True):
            raise RuntimeError("AxCodeSession.patch_globals() is required to restore AxAgent state")
        snap = copy.deepcopy(snapshot or {})
        self.globals = dict(snap.get("bindings") or snap.get("globals") or {})
        self.closed = bool(snap.get("closed", False))
        return self.snapshot_globals(options or {})

    def export_state(self, options: dict[str, Any] | None = None) -> Any:
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        return self.patch_globals(snapshot or {}, options or {})

    def close(self) -> Any:
        self.closed = True
        return {"closed": True}


class ScriptedCodeRuntime(AxCodeRuntime):
    def __init__(self, script=None, language="JavaScript", usage_instructions="", capabilities=None):
        self.script = list(script or [])
        self.sessions = []
        self.executed = []
        self.create_requests = []
        self.execute_options = []
        self.language = language
        self._usage_instructions = usage_instructions
        self.capabilities = {"inspect": True, "snapshot": True, "patch": True}
        self.capabilities.update(capabilities or {})

    def get_usage_instructions(self) -> str:
        return self._usage_instructions

    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> ScriptedCodeSession:
        self.create_requests.append({"globals": copy.deepcopy(globals or {}), "options": copy.deepcopy(options or {})})
        session = ScriptedCodeSession(self, globals, options)
        self.sessions.append(session)
        return session


def _runtime_protocol_response(message, result=None, *, ok=True, error=None, session_id=None):
    out = {"id": message.get("id"), "ok": ok}
    if ok:
        out["result"] = result if result is not None else {}
    else:
        out["error"] = error or {"category": "runtime", "message": "runtime protocol error"}
    if session_id is not None:
        out["session_id"] = session_id
    return out


def _runtime_protocol_fail(message, category, message_text):
    return _runtime_protocol_response(message, ok=False, error={"category": category, "message": message_text})


def _runtime_protocol_snapshot(session):
    bindings = copy.deepcopy(session.get("globals") or {})
    return {
        "version": 1,
        "entries": [{"name": key, "type": type(value).__name__, "preview": str(value)} for key, value in bindings.items()],
        "bindings": bindings,
        "globals": copy.deepcopy(bindings),
        "closed": bool(session.get("closed")),
    }


def _runtime_protocol_fixture_server_main():
    mode = os.environ.get("AXIR_RUNTIME_PROTOCOL_FIXTURE_MODE", "normal")
    sessions: dict[str, dict[str, Any]] = {}
    next_session = 0
    for line in sys.stdin:
        if mode == "eof":
            return
        if mode == "malformed_json":
            print("{not-json", flush=True)
            return
        if mode == "nonzero":
            print("fixture stderr before nonzero exit", file=sys.stderr, flush=True)
            raise SystemExit(7)
        try:
            message = json.loads(line)
            op = message.get("op")
            response_id = "mismatch" if mode == "id_mismatch" else message.get("id")
            if op == "capabilities":
                response = {"id": response_id, "ok": True, "result": {
                    "language": "JavaScript",
                    "usage_instructions": "fixture protocol runtime",
                    "inspect": mode != "unavailable",
                    "snapshot": mode != "unavailable",
                    "patch": mode != "unavailable",
                    "abort": True,
                }}
            elif op == "create_session":
                next_session += 1
                session_id = f"s{next_session}"
                payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
                globals_ = copy.deepcopy(payload.get("globals") if isinstance(payload.get("globals"), dict) else {})
                globals_["__create_options"] = copy.deepcopy(payload.get("options") if isinstance(payload.get("options"), dict) else {})
                sessions[session_id] = {"globals": globals_, "closed": False}
                response = {"id": response_id, "ok": True, "session_id": session_id, "result": {"session_id": session_id}}
            elif op == "execute":
                session_id = message.get("session_id")
                session = sessions.get(session_id or "")
                if not session or session.get("closed"):
                    response = _runtime_protocol_fail(message, "session_closed", "session closed or unknown")
                else:
                    payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
                    code = str(payload.get("code") or "")
                    session["globals"]["__last_execute_options"] = copy.deepcopy(payload.get("options") if isinstance(payload.get("options"), dict) else {})
                    if code == "timeout()":
                        response = _runtime_protocol_fail(message, "timeout", "fixture timeout")
                    elif code == "sessionClosed()":
                        response = _runtime_protocol_fail(message, "session_closed", "fixture session closed")
                    elif code == "abort()":
                        response = _runtime_protocol_fail(message, "abort", "fixture abort")
                    elif code == "userError()":
                        response = _runtime_protocol_fail(message, "user_error", "fixture user error")
                    else:
                        session["globals"]["answer"] = "fixture"
                        response = _runtime_protocol_response(message, {"type": "final", "args": [{"answer": "fixture"}]}, session_id=session_id)
                if mode == "session_mismatch" and response.get("ok"):
                    response["session_id"] = "wrong-session"
            elif op == "inspect_globals":
                if mode == "unavailable":
                    response = _runtime_protocol_fail(message, "unavailable", "inspectGlobals unavailable")
                else:
                    response = _runtime_protocol_response(message, copy.deepcopy((sessions.get(message.get("session_id") or "") or {}).get("globals") or {}), session_id=message.get("session_id"))
            elif op == "snapshot_globals":
                if mode == "unavailable":
                    response = _runtime_protocol_fail(message, "unavailable", "snapshotGlobals unavailable")
                else:
                    response = _runtime_protocol_response(message, _runtime_protocol_snapshot(sessions.get(message.get("session_id") or "") or {}), session_id=message.get("session_id"))
            elif op == "patch_globals":
                if mode == "unavailable":
                    response = _runtime_protocol_fail(message, "unavailable", "patchGlobals unavailable")
                else:
                    session = sessions.get(message.get("session_id") or "")
                    payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
                    raw = payload.get("globals") if isinstance(payload.get("globals"), dict) else {}
                    bindings = raw.get("bindings") if isinstance(raw.get("bindings"), dict) else raw
                    if session is not None:
                        session["globals"] = copy.deepcopy(bindings)
                    response = _runtime_protocol_response(message, _runtime_protocol_snapshot(session or {}), session_id=message.get("session_id"))
            elif op == "close":
                session = sessions.get(message.get("session_id") or "")
                if session is not None:
                    session["closed"] = True
                response = _runtime_protocol_response(message, {"closed": True}, session_id=message.get("session_id"))
            elif op == "shutdown":
                response = _runtime_protocol_response(message, {"shutdown": True})
            else:
                response = _runtime_protocol_fail(message, "protocol", f"unknown runtime protocol op: {op}")
            print(json.dumps(response, separators=(",", ":")), flush=True)
            if op == "shutdown":
                return
        except Exception as exc:
            print(json.dumps(_runtime_protocol_fail({"id": None}, "protocol", str(exc))), flush=True)


def _runtime_protocol_command(mode="normal"):
    env = {"AXIR_RUNTIME_PROTOCOL_FIXTURE_MODE": mode}
    return ProcessCodeRuntime([sys.executable, "-m", "axllm.conformance", "--runtime-protocol-fixture-server"], env=env)


def run_fixtures(paths):
    results = []
    for path in _expand_paths(paths):
        results.append(run_fixture_path(path))
    return results


def run_fixture_path(path):
    data = json.loads(Path(path).read_text())
    return run_fixture(data, source=str(path))


def run_fixture(fixture: dict[str, Any], *, source: str | None = None):
    name = fixture.get("name") or source or "<fixture>"
    kind = fixture.get("kind", "forward")
    try:
        if kind == "signature_error":
            _run_signature_error(fixture)
        elif kind == "signature":
            _run_signature(fixture)
        elif kind == "json_schema":
            _run_json_schema(fixture)
        elif kind == "prompt":
            _run_prompt(fixture)
        elif kind == "template":
            _run_template(fixture)
        elif kind == "template_error":
            _run_template_error(fixture)
        elif kind == "template_validate":
            _run_template_validate(fixture)
        elif kind == "stream":
            _run_stream(fixture)
        elif kind == "validate_value":
            _run_validate_value(fixture)
        elif kind == "validate_output":
            _run_validate_output(fixture)
        elif kind == "strip_internal":
            _run_strip_internal(fixture)
        elif kind == "forward":
            _run_forward(fixture)
        elif kind == "ai_chat":
            _run_ai_chat(fixture)
        elif kind == "ai_embed":
            _run_ai_embed(fixture)
        elif kind == "ai_stream":
            _run_ai_stream(fixture)
        elif kind == "ai_error":
            _run_ai_error(fixture)
        elif kind == "ai_unsupported":
            _run_ai_unsupported(fixture)
        elif kind == "ai_provider_descriptor":
            _run_ai_provider_descriptor(fixture)
        elif kind == "ai_provider_registry":
            _run_ai_provider_registry(fixture)
        elif kind == "ai_model_catalog_audit":
            _run_ai_model_catalog_audit(fixture)
        elif kind == "ai_model_catalog_runtime":
            _run_ai_model_catalog_runtime(fixture)
        elif kind == "ai_multiservice_router":
            _run_ai_multiservice_router(fixture)
        elif kind == "ai_provider_router":
            _run_ai_provider_router(fixture)
        elif kind == "ai_balancer":
            _run_ai_balancer(fixture)
        elif kind == "ai_transcribe":
            _run_ai_transcribe(fixture)
        elif kind == "ai_speak":
            _run_ai_speak(fixture)
        elif kind == "ai_realtime":
            _run_ai_realtime(fixture)
        elif kind == "agent_forward":
            _run_agent_forward(fixture)
        elif kind == "agent_runtime_policy":
            _run_agent_runtime_policy(fixture)
        elif kind == "agent_runtime_session":
            _run_agent_runtime_session(fixture)
        elif kind == "agent_runtime_adapter":
            _run_agent_runtime_adapter(fixture)
        elif kind == "agent_runtime_protocol":
            _run_agent_runtime_protocol(fixture)
        elif kind == "agent_prompt":
            _run_agent_prompt(fixture)
        elif kind == "agent_runtime_real":
            _run_agent_forward(fixture)
        elif kind == "program_contract":
            _run_program_contract(fixture)
        elif kind == "flow":
            _run_flow(fixture)
        elif kind == "optimize":
            _run_optimize(fixture)
        elif kind == "mcp":
            run_mcp_conformance_fixture(fixture)
        else:
            raise FixtureError(f"unknown fixture kind {kind!r}")
    except Exception as exc:
        if isinstance(exc, FixtureError):
            raise
        raise FixtureError(f"{name}: {type(exc).__name__}: {exc}") from exc
    return {"name": name, "ok": True}


def _run_signature_error(fixture):
    try:
        _build_signature(fixture)
    except Exception as exc:
        expected_category = fixture.get("expected_error_category")
        if expected_category and _error_category(exc) != expected_category:
            raise FixtureError(f"expected error category {expected_category!r}, got {_error_category(exc)!r}")
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        return
    raise FixtureError("expected signature construction to fail")


def _run_signature(fixture):
    sig = _build_signature(fixture)
    _assert_equal(_signature_payload(sig), fixture["expected_signature"], "signature")


def _run_json_schema(fixture):
    sig = _build_signature(fixture)
    target = fixture.get("target", "outputs")
    fields = sig.get_input_fields() if target == "inputs" else sig.get_output_fields()
    schema = to_json_schema(fields, fixture.get("schema_title", "Schema"), fixture.get("schema_options") or {})
    _assert_equal(schema, fixture["expected_schema"], "json schema")


def _run_prompt(fixture):
    sig = _build_signature(fixture)
    tools, _ = _build_tools(fixture.get("tools") or [])
    options = fixture.get("options") or {}
    prompt = AxPromptTemplate(
        sig,
        functions=tools,
        custom_template=fixture.get("custom_template") or options.get("custom_template") or options.get("customTemplate"),
        structured_output_function_name=fixture.get("structured_output_function_name") or options.get("structured_output_function_name") or options.get("structuredOutputFunctionName"),
    )
    if fixture.get("instruction"):
        prompt.set_instruction(fixture["instruction"])
    messages = prompt.render(fixture.get("input") or fixture.get("values") or {})
    for item in fixture.get("expected_prompt_contains") or []:
        if item not in json.dumps(messages, sort_keys=True):
            raise FixtureError(f"prompt missing {item!r}: {messages!r}")
    if "expected_messages" in fixture:
        _assert_equal(messages, fixture["expected_messages"], "messages")


def _run_template(fixture):
    rendered = render_template_content(
        fixture["template"],
        fixture.get("vars") or {},
        fixture.get("context", "fixture-template"),
    )
    _assert_equal(rendered, fixture.get("expected_output", ""), "template output")


def _run_template_error(fixture):
    try:
        if fixture.get("operation") == "validate":
            result = validate_prompt_template_syntax(
                fixture["template"],
                fixture.get("context", "fixture-template"),
                fixture.get("required_variables") or [],
            )
            if result is not True:
                raise ValueError(result)
        else:
            render_template_content(
                fixture["template"],
                fixture.get("vars") or {},
                fixture.get("context", "fixture-template"),
            )
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        return
    raise FixtureError("expected template operation to fail")


def _run_template_validate(fixture):
    result = validate_prompt_template_syntax(
        fixture["template"],
        fixture.get("context", "fixture-template"),
        fixture.get("required_variables") or [],
    )
    _assert_equal(result, fixture.get("expected_result", True), "template validation")


def _run_stream(fixture):
    chunks = []
    try:
        for event in fixture.get("stream_events") or []:
            chunks.append(event)
            content = fold_stream(chunks)
            for assertion in fixture.get("streaming_assertions") or []:
                needle = assertion.get("not_contains", assertion.get("notContains"))
                if needle is not None and str(needle) in str(content):
                    raise RuntimeError(assertion.get("message") or "streaming assertion failed")
    except Exception as exc:
        if "expected_error_contains" not in fixture:
            raise
        _assert_expected_error(exc, fixture)
        return
    if "expected_error_contains" in fixture:
        raise FixtureError("expected stream assertion to fail")
    _assert_equal(fold_stream(chunks), fixture.get("expected_folded", ""), "stream fold")


def _run_validate_value(fixture):
    field = _field_for_validation(fixture)
    try:
        validate_value(field, fixture.get("value"))
    except Exception as exc:
        if "expected_error_contains" not in fixture:
            raise
        _assert_expected_error(exc, fixture)
        return
    if "expected_error_contains" in fixture:
        raise FixtureError("expected validate_value to fail")


def _run_validate_output(fixture):
    sig = _build_signature(fixture)
    values = copy.deepcopy(fixture.get("values") or {})
    try:
        result = validate_output(sig.get_output_fields(), values)
    except Exception as exc:
        if "expected_error_contains" not in fixture:
            raise
        _assert_expected_error(exc, fixture)
        return
    if "expected_error_contains" in fixture:
        raise FixtureError("expected validate_output to fail")
    _assert_equal(result, fixture.get("expected_values", values), "validated output")


def _run_strip_internal(fixture):
    sig = _build_signature(fixture)
    result = strip_internal(sig.get_output_fields(), fixture.get("values") or {})
    _assert_equal(result, fixture["expected_output"], "strip internal")


def _run_forward(fixture):
    sig = _build_signature(fixture)
    tools, tool_calls = _build_tools(fixture.get("tools") or [])
    options = {"functions": tools, **(fixture.get("options") or {})}
    gen = ax(sig, options)
    if "examples" in fixture:
        gen.set_examples(fixture.get("examples") or [])
    if "demos" in fixture:
        gen.set_demos(fixture.get("demos") or [])
    for assertion in fixture.get("assertions") or []:
        gen.add_assert(assertion)
    for processor in fixture.get("field_processors") or fixture.get("fieldProcessors") or []:
        gen.add_field_processor(processor.get("field"), processor.get("processor", processor.get("op")))
    if "stop_functions" in fixture or "stopFunctions" in fixture:
        gen.set_stop_functions(fixture.get("stop_functions") or fixture.get("stopFunctions") or [])
    client = ConformanceScriptedAI(fixture.get("responses") or [], fixture.get("stream_events") or [], fixture.get("transcribe_responses") or [])
    try:
        output = gen.forward(client, fixture.get("input") or {}, fixture.get("forward_options"))
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected forward to fail")
    if "expected_output" in fixture:
        _assert_equal(output, fixture["expected_output"], "forward output")
    if "expected_request_count" in fixture and len(client.requests) != fixture["expected_request_count"]:
        raise FixtureError(f"expected {fixture['expected_request_count']} requests, got {len(client.requests)}")
    if fixture.get("expect_chat_path", True) and client.chat_calls == 0:
        raise FixtureError("expected AxGen to use AxAIService.chat()")
    if "expected_request" in fixture:
        if not client.requests:
            raise FixtureError("fixture expected a request but none were sent")
        _assert_subset(client.requests[0], fixture["expected_request"], "request")
    if "expected_request_contains" in fixture:
        request_text = json.dumps(client.requests, sort_keys=True)
        for item in fixture.get("expected_request_contains") or []:
            if str(item) not in request_text:
                raise FixtureError(f"request missing {item!r}: {request_text}")
    if "expected_tool_calls" in fixture:
        _assert_equal(tool_calls, fixture["expected_tool_calls"], "tool calls")
    if "expected_trace" in fixture:
        traces = gen.get_traces()
        if not traces:
            raise FixtureError("expected trace but none was recorded")
        _assert_subset(traces[-1], fixture["expected_trace"], "trace")
    if "expected_memory_history" in fixture:
        _assert_subset(gen.get_memory().history(), fixture["expected_memory_history"], "memory history")
    if "expected_memory_history_subset" in fixture:
        _assert_list_subset(gen.get_memory().history(), fixture["expected_memory_history_subset"], "memory history")
    if "expected_chat_log" in fixture:
        _assert_subset(gen.get_chat_log(), fixture["expected_chat_log"], "chat log")
    if "expected_chat_log_subset" in fixture:
        _assert_list_subset(gen.get_chat_log(), fixture["expected_chat_log_subset"], "chat log")
    if "expected_function_traces" in fixture:
        _assert_subset(gen.get_function_call_traces(), fixture["expected_function_traces"], "function call traces")
    if "expected_function_traces_subset" in fixture:
        _assert_list_subset(gen.get_function_call_traces(), fixture["expected_function_traces_subset"], "function call traces")
    if "expected_chat_prompt" in fixture:
        if not client.requests:
            raise FixtureError("fixture expected a request but none were sent")
        _assert_equal(client.requests[0].get("chat_prompt"), fixture["expected_chat_prompt"], "chat prompt")
    if "expected_chat_prompt_contains" in fixture:
        if not client.requests:
            raise FixtureError("fixture expected a request but none were sent")
        prompt_text = json.dumps(client.requests[0].get("chat_prompt"), sort_keys=True)
        for item in fixture.get("expected_chat_prompt_contains") or []:
            if str(item) not in prompt_text:
                raise FixtureError(f"chat prompt missing {item!r}: {prompt_text}")


def _flow_build_step_from_fixture(step, fixture):
    kind = step.get("kind", "execute")
    name = step.get("name")
    options = copy.deepcopy(step.get("options") or {})
    if kind in ("map", "derive"):
        mapper = _flow_mapper_from_spec(step["mapper"]) if "mapper" in step else _FlowCallable(lambda _state, output=copy.deepcopy(step.get("output") or {}): copy.deepcopy(output))
        return _flow_step(kind, name, mapper, options)
    if kind == "branch":
        predicate_spec = step.get("predicate", options.get("predicate"))
        options["predicate"] = _flow_condition_from_spec(predicate_spec)
        branches = []
        for branch in step.get("branches", options.get("branches") or []):
            branches.append({
                "when": branch.get("when"),
                "steps": [_flow_build_step_from_fixture(child, fixture) for child in branch.get("steps") or []],
            })
        options["branches"] = branches
        return _flow_step("branch", name, None, options)
    if kind == "while" or kind == "feedback":
        condition_spec = step.get("condition", options.get("condition"))
        options["condition"] = _flow_condition_from_spec(condition_spec)
        options["steps"] = [_flow_build_step_from_fixture(child, fixture) for child in step.get("steps", options.get("steps") or [])]
        return _flow_step(kind, name, None, options)
    if kind == "parallel" or kind == "parallelMerge":
        return _flow_step(kind, name, None, options)
    step_options = {**(step.get("forward_options") or {}), **options}
    if step.get("program") == "flow":
        program = _build_flow({
            "flow_options": step.get("flow_options") or {"id": step.get("program_id", f"root.{name}")},
            "steps": step.get("steps") or [],
            "returns": step.get("returns") or {},
            "signature": step.get("signature", fixture.get("signature", "question:string -> answer:string")),
        })
    elif step.get("program") == "agent":
        program = agent(step.get("signature", fixture.get("signature", "question:string -> answer:string")), step.get("options") or {})
    else:
        signature = step.get("extended_signature") or step.get("extendedSignature") or step.get("signature", fixture.get("signature", "question:string -> answer:string"))
        program = ax(signature, step.get("options") or {})
    return _flow_step(kind, name, program, step_options)


def _build_flow(fixture):
    fl = flow(fixture.get("flow_options") or {"id": fixture.get("program_id", "root.flow")})
    for step in fixture.get("steps") or []:
        _flow_add_step(fl.state, _flow_build_step_from_fixture(step, fixture))
    if "returns" in fixture:
        fl.returns(fixture.get("returns") or {})
    if "demos" in fixture:
        fl.set_demos(fixture.get("demos") or {})
    return fl


def _run_program_contract(fixture):
    program = ax(fixture.get("signature", "question:string -> answer:string"), fixture.get("options") or {})
    if fixture.get("program") == "flow":
        program = _build_flow(fixture)
    components = program.get_optimizable_components()
    if "expected_component_ids" in fixture:
        _assert_equal([item.get("id") for item in components], fixture["expected_component_ids"], "program component ids")
    if "expected_components_subset" in fixture:
        _assert_list_subset(components, fixture["expected_components_subset"], "program components")


def _run_flow(fixture):
    try:
        fl = _build_flow(fixture)
        if fixture.get("operation") == "cache_key":
            keys = [_flow_cache_key(item) for item in fixture.get("cache_key_inputs") or []]
            if fixture.get("expected_cache_keys_equal") and len(set(keys)) != 1:
                raise FixtureError(f"expected equal flow cache keys, got {keys}")
            if fixture.get("expected_cache_keys_distinct") and len(set(keys)) != len(keys):
                raise FixtureError(f"expected distinct flow cache keys, got {keys}")
            return
        if "expected_plan" in fixture:
            _assert_equal(fl.get_plan(), fixture["expected_plan"], "flow plan")
        if "expected_plan_subset" in fixture:
            _assert_list_subset(fl.get_plan(), fixture["expected_plan_subset"], "flow plan")
        if fixture.get("operation") == "plan":
            return
        client = ConformanceScriptedAI(fixture.get("responses") or [], fixture.get("stream_events") or [], fixture.get("transcribe_responses") or [])
        forward_options = copy.deepcopy(fixture.get("forward_options") or {})
        if "cache_seed_value" in fixture:
            cache_store = forward_options.setdefault("cache_store", {})
            cache_store[_flow_cache_key(fixture.get("input") or {})] = copy.deepcopy(fixture.get("cache_seed_value"))
        if fixture.get("operation") == "streaming":
            output = list(fl.streaming_forward(client, fixture.get("input") or {}, forward_options))
        else:
            output = fl.forward(client, fixture.get("input") or {}, forward_options)
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected flow to fail")
    if "expected_output" in fixture:
        _assert_equal(output, fixture["expected_output"], "flow output")
    if "expected_streaming_output" in fixture:
        _assert_equal(output, fixture["expected_streaming_output"], "flow streaming output")
    if "expected_request_count" in fixture and len(client.requests) != fixture["expected_request_count"]:
        raise FixtureError(f"expected {fixture['expected_request_count']} requests, got {len(client.requests)}")
    if "expected_request_contains" in fixture:
        request_text = json.dumps(client.requests, sort_keys=True)
        for item in fixture.get("expected_request_contains") or []:
            if str(item) not in request_text:
                raise FixtureError(f"flow request missing {item!r}: {request_text}")
    if "expected_chat_log_subset" in fixture:
        _assert_list_subset(fl.get_chat_log(), fixture["expected_chat_log_subset"], "flow chat log")
    if "expected_trace_kinds" in fixture:
        _assert_equal([event.get("kind") for event in fl.get_traces()], fixture["expected_trace_kinds"], "flow trace kinds")
    if "expected_trace_subset" in fixture:
        _assert_list_subset(fl.get_traces(), fixture["expected_trace_subset"], "flow traces")
    if "expected_usage_subset" in fixture:
        _assert_subset(fl.get_usage(), fixture["expected_usage_subset"], "flow usage")
    if "expected_cache_store_subset" in fixture:
        cache_store = forward_options.get("cache_store") or forward_options.get("cacheStore") or {}
        _assert_subset(cache_store, fixture["expected_cache_store_subset"], "flow cache store")
    if "expected_cache_value_for_input" in fixture:
        cache_store = forward_options.get("cache_store") or forward_options.get("cacheStore") or {}
        _assert_equal(cache_store.get(_flow_cache_key(fixture.get("input") or {})), fixture["expected_cache_value_for_input"], "flow cache value")
    if "expected_components_subset" in fixture:
        _assert_list_subset(fl.get_optimizable_components(), fixture["expected_components_subset"], "flow components")


def _run_optimize(fixture):
    class ScriptedOptimizer(OptimizerEngine):
        name = "scripted"
        version = "1"

        def __init__(self, response):
            self.response = response
            self.requests = []
            self.evaluations = []
            self.transcripts = []

        def optimize(self, request, evaluator=None):
            self.requests.append(copy.deepcopy(request))
            if evaluator is not None and isinstance(self.response, dict):
                if "referenceCandidates" in self.response:
                    best_map = {}
                    best_score = None
                    for step in self.response.get("referenceCandidates") or []:
                        candidate_map = step.get("component_map") or step.get("componentMap") or {}
                        eval_options = step.get("options") or {}
                        result = evaluator.evaluate(candidate_map, eval_options)
                        evidence = _build_optimizer_evidence_batch(result, request.get("components") or [])
                        self.evaluations.append(copy.deepcopy(result))
                        self.transcripts.append({
                            "candidateMap": copy.deepcopy(candidate_map),
                            "options": copy.deepcopy(eval_options),
                            "result": copy.deepcopy(result),
                            "evidence": copy.deepcopy(evidence),
                        })
                        score = result.get("avg", 0) if isinstance(result, dict) else 0
                        if best_score is None or score > best_score:
                            best_score = score
                            best_map = copy.deepcopy(candidate_map)
                    return {
                        "componentMap": best_map,
                        "metadata": {
                            "referenceEngine": True,
                            "evaluations": copy.deepcopy(self.transcripts),
                        },
                    }
                for step in self.response.get("evaluate") or []:
                    candidate_map = step.get("component_map") or step.get("componentMap") or {}
                    eval_options = step.get("options") or {}
                    result = evaluator.evaluate(candidate_map, eval_options)
                    evidence = _build_optimizer_evidence_batch(result, request.get("components") or [])
                    self.evaluations.append(copy.deepcopy(result))
                    self.transcripts.append({
                        "candidateMap": copy.deepcopy(candidate_map),
                        "options": copy.deepcopy(eval_options),
                        "result": copy.deepcopy(result),
                        "evidence": copy.deepcopy(evidence),
                    })
            return copy.deepcopy(self.response)

    class ScriptedGEPAEvaluator(OptimizerEvaluator):
        def __init__(self, fixture):
            self.fixture = fixture
            self.evaluations = []

        def evaluate(self, candidate_map, options=None):
            opts = options or {}
            normalized = _normalize_optimization_dataset(opts.get("dataset") or self.fixture.get("dataset") or [])
            rows = []
            score_component = self.fixture.get("score_component_id")
            components = self.fixture.get("components") or []
            if not score_component and components:
                score_component = components[0].get("id")
            component_value = (candidate_map or {}).get(score_component, self.fixture.get("base_component_value", ""))
            score_map = self.fixture.get("gepa_scores")
            scripted = (
                score_map.get(str(component_value), score_map.get("*", 0))
                if isinstance(score_map, dict)
                else None
            )
            for index, task in enumerate(normalized.get("train") or []):
                if isinstance(score_map, dict):
                    raw_score = scripted[index] if isinstance(scripted, list) and scripted else scripted
                    if isinstance(scripted, list) and index >= len(scripted):
                        raw_score = scripted[-1]
                else:
                    raw_score = task.get("metric_score", task.get("scores", task.get("score", 0)))
                scores = _normalize_optimization_metric_scores(raw_score)
                scalar = _scalarize_optimization_scores(scores, self.fixture.get("score_options") or {})
                prediction = {
                    "completionType": "final",
                    "output": {"componentValue": component_value},
                    "finalOutput": {"componentValue": component_value},
                    "functionCalls": [],
                    "actionLog": [],
                    "usage": {},
                    "trace": {"componentValue": component_value},
                }
                rows.append(_build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), None))
            result = _build_optimization_eval_result(rows, candidate_map or {}, opts.get("phase", "train"))
            self.evaluations.append(copy.deepcopy(result))
            return result

    def build_gepa_request():
        components = copy.deepcopy(fixture.get("components") or program.get_optimizable_components())
        dataset = _normalize_optimization_dataset(fixture.get("dataset") or [])
        return {
            "contractVersion": "axir-optimize-contract-v1",
            "programKind": fixture.get("program", "axgen"),
            "components": components,
            "dataset": dataset,
            "options": copy.deepcopy(fixture.get("optimize_options") or {}),
            "trace": {},
            "evaluator": {"available": True, "contractVersion": "axir-optimizer-evaluator-v1"},
        }

    def build_program():
        sig = fixture.get("signature", "question:string -> answer:string")
        options = copy.deepcopy(fixture.get("options") or {})
        tools, _ = _build_tools(fixture.get("tools") or [])
        if tools:
            options["functions"] = tools
        if fixture.get("program", "agent") == "axgen":
            return ax(sig, options)
        if fixture.get("program") == "flow":
            return _build_flow(fixture)
        return agent(sig, options)

    program = build_program()
    operation = fixture.get("operation", "components")
    try:
        if operation == "verification":
            actual = _verification_instruments_summary()
            _assert_equal(actual, fixture.get("expected_output"), "verification instruments")
            return
        if operation == "components":
            components = program.get_optimizable_components()
            if "expected_components_subset" in fixture:
                _assert_list_subset(components, fixture["expected_components_subset"], "optimizable components")
            if "expected_component_ids" in fixture:
                _assert_equal([item.get("id") for item in components], fixture["expected_component_ids"], "component ids")
            return
        if operation == "filter":
            components = program.get_optimizable_components()
            filtered = _filter_optimization_components(components, fixture.get("target", "all"))
            _assert_equal([item.get("id") for item in filtered], fixture.get("expected_component_ids", []), "filtered component ids")
            return
        if operation == "apply":
            before = program.get_optimizable_components()
            artifact = _optimized_artifact("fixture", "1", fixture.get("component_map") or {}, fixture.get("metadata") or {"source": "fixture"})
            artifact = _validate_optimized_artifact(artifact, before)
            payload = _serialize_optimized_artifact(artifact) if fixture.get("serialized_artifact") else artifact
            program.apply_optimization(payload)
            after = program.get_optimizable_components()
            if "expected_components_subset" in fixture:
                _assert_list_subset(after, fixture["expected_components_subset"], "optimized components")
            if "expected_changed_components" in fixture:
                _assert_equal(_optimization_changed_components(before, fixture.get("component_map") or {}), fixture["expected_changed_components"], "changed components")
            return
        if operation == "artifact":
            components = program.get_optimizable_components()
            artifact = _optimized_artifact("fixture", "1", fixture.get("component_map") or {}, fixture.get("metadata") or {})
            validated = _validate_optimized_artifact(artifact, components)
            text = _serialize_optimized_artifact(validated)
            decoded = _deserialize_optimized_artifact(text, components)
            if "expected_artifact_subset" in fixture:
                _assert_subset(decoded, fixture["expected_artifact_subset"], "optimized artifact")
            return
        if operation == "dataset":
            normalized = _normalize_optimization_dataset(fixture.get("dataset") or [])
            _assert_equal(normalized, fixture.get("expected_dataset"), "normalized dataset")
            return
        if operation == "score":
            scores = _normalize_optimization_metric_scores(fixture.get("metric_score"))
            scalar = _scalarize_optimization_scores(scores, fixture.get("score_options") or {})
            prediction = fixture.get("prediction") or {"functionCalls": []}
            adjusted = _adjust_optimization_score_for_actions(scalar, fixture.get("task") or {}, prediction)
            if "expected_scores" in fixture:
                _assert_equal(scores, fixture["expected_scores"], "metric scores")
            if "expected_scalar" in fixture:
                _assert_equal(adjusted, fixture["expected_scalar"], "metric scalar")
            if "quality" in fixture:
                _assert_equal(_map_optimization_judge_quality_to_score(fixture["quality"]), fixture.get("expected_quality_score"), "judge quality score")
            return
        if operation == "judge_payload":
            payload = _build_optimization_judge_payload(fixture.get("task") or {}, fixture.get("prediction") or {}, fixture.get("criteria") or "")
            if "expected_judge_payload_subset" in fixture:
                _assert_subset(payload, fixture["expected_judge_payload_subset"], "judge payload")
            return
        if operation == "evidence":
            components = fixture.get("components") or program.get_optimizable_components()
            eval_result = fixture.get("eval_result") or {}
            evidence = _build_optimizer_evidence_batch(eval_result, components)
            if "expected_evidence_subset" in fixture:
                _assert_subset(evidence, fixture["expected_evidence_subset"], "optimizer evidence")
            return
        if operation == "evaluate":
            if not hasattr(program, "evaluate_optimization"):
                raise FixtureError("evaluate operation requires an optimizable program")
            client = ConformanceScriptedAI(fixture.get("responses") or [], fixture.get("stream_events") or [], fixture.get("transcribe_responses") or [])
            result = program.evaluate_optimization(client, fixture.get("dataset") or [], fixture.get("candidate_map") or {}, fixture.get("eval_options") or {})
            if "expected_evaluation_subset" in fixture:
                _assert_subset(result, fixture["expected_evaluation_subset"], "optimization evaluation")
            if "expected_evaluation_rows_subset" in fixture:
                _assert_list_subset(result.get("rows") or [], fixture["expected_evaluation_rows_subset"], "optimization evaluation rows")
            if "expected_components_subset_after" in fixture:
                _assert_list_subset(program.get_optimizable_components(), fixture["expected_components_subset_after"], "post-eval components")
            return
        if operation == "engine":
            engine = ScriptedOptimizer(fixture.get("engine_response") or {})
            opts = copy.deepcopy(fixture.get("optimize_options") or {})
            if fixture.get("engine_uses_evaluator"):
                opts["client"] = ConformanceScriptedAI(fixture.get("responses") or [], fixture.get("stream_events") or [])
            artifact = program.optimize_with(engine, fixture.get("dataset") or [], opts)
            if "expected_engine_request_subset" in fixture:
                if not engine.requests:
                    raise FixtureError("optimizer engine was not called")
                _assert_subset(engine.requests[0], fixture["expected_engine_request_subset"], "optimizer engine request")
            if "expected_engine_evaluations_subset" in fixture:
                _assert_list_subset(engine.evaluations, fixture["expected_engine_evaluations_subset"], "optimizer engine evaluations")
            if "expected_engine_transcripts_subset" in fixture:
                _assert_list_subset(engine.transcripts, fixture["expected_engine_transcripts_subset"], "optimizer engine transcripts")
            if "expected_artifact_subset" in fixture:
                _assert_subset(artifact, fixture["expected_artifact_subset"], "optimizer artifact")
            if "expected_components_subset" in fixture:
                _assert_list_subset(program.get_optimizable_components(), fixture["expected_components_subset"], "optimized components")
            return
        if operation == "bootstrap":
            engine = AxBootstrapFewShot(**copy.deepcopy(fixture.get("optimize_options") or {}))
            evaluator = ScriptedGEPAEvaluator(fixture)
            artifact = engine.optimize(build_gepa_request(), evaluator)
            if "expected_artifact_subset" in fixture:
                _assert_subset(artifact, fixture["expected_artifact_subset"], "BootstrapFewShot artifact")
            if "expected_demo_count" in fixture and len(artifact.get("demos") or []) != fixture["expected_demo_count"]:
                raise FixtureError(f"expected {fixture['expected_demo_count']} demos, got {len(artifact.get('demos') or [])}")
            if "expected_gepa_evaluations_subset" in fixture:
                _assert_list_subset(evaluator.evaluations, fixture["expected_gepa_evaluations_subset"], "BootstrapFewShot evaluations")
            return
        if operation == "helper":
            opts = copy.deepcopy(fixture.get("optimize_options") or {})
            client = ConformanceScriptedAI(fixture.get("responses") or [], fixture.get("stream_events") or [], fixture.get("transcribe_responses") or [])
            opts.setdefault("studentAI", client)
            opts.setdefault("teacherAI", client)
            artifact = optimize(program, fixture.get("dataset") or [], opts)
            if "expected_artifact_subset" in fixture:
                _assert_subset(artifact, fixture["expected_artifact_subset"], "optimize helper artifact")
            if "expected_demo_count" in fixture and len(artifact.get("demos") or []) != fixture["expected_demo_count"]:
                raise FixtureError(f"expected {fixture['expected_demo_count']} demos, got {len(artifact.get('demos') or [])}")
            if "expected_components_subset" in fixture:
                _assert_list_subset(program.get_optimizable_components(), fixture["expected_components_subset"], "post-helper components")
            return
        if operation == "gepa":
            reflection = ConformanceScriptedAI(fixture.get("reflection_responses") or [], fixture.get("stream_events") or [])
            engine = AxGEPA(reflection, **copy.deepcopy(fixture.get("gepa_options") or {}))
            evaluator = ScriptedGEPAEvaluator(fixture)
            artifact = engine.optimize(build_gepa_request(), evaluator)
            if "expected_artifact_subset" in fixture:
                _assert_subset(artifact, fixture["expected_artifact_subset"], "GEPA artifact")
            if "expected_gepa_evaluations_subset" in fixture:
                _assert_list_subset(evaluator.evaluations, fixture["expected_gepa_evaluations_subset"], "GEPA evaluations")
            return
        if operation == "eval":
            if not isinstance(program, AxAgent):
                raise FixtureError("eval operation requires agent program")
            client = ConformanceScriptedAI(fixture.get("responses") or [], fixture.get("stream_events") or [], fixture.get("transcribe_responses") or [])
            prediction = program.evaluate_optimization_task(client, fixture.get("task") or {"input": fixture.get("input") or {}}, fixture.get("eval_options") or {})
            if "expected_prediction_subset" in fixture:
                _assert_subset(prediction, fixture["expected_prediction_subset"], "eval prediction")
            return
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    raise FixtureError(f"unknown optimize operation {operation!r}")


def _verification_instruments_summary():
    prompt_vars = sorted(collect_template_variable_names("Hello {{name}} and {{count}}", "verification"))
    chat_request = {
        "model": "gpt-fixture",
        "chat_prompt": [{"role": "user", "content": "hello"}],
        "model_config": {},
    }
    chat_payload = build_chat_request(None, chat_request, {})
    chat_response = normalize_chat_response({
        "id": "chat-1",
        "model": "gpt-fixture",
        "choices": [{"index": 0, "message": {"content": "hello"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
    })
    embed_payload = build_embed_request(None, {"embedModel": "embed-fixture", "texts": ["hello"]}, {})
    embed_response = normalize_embed_response({
        "id": "embed-1",
        "model": "embed-fixture",
        "data": [{"embedding": [0.1, 0.2]}],
        "usage": {"prompt_tokens": 1, "total_tokens": 1},
    })
    stream_response = normalize_stream_delta({
        "id": "stream-1",
        "model": "gpt-fixture",
        "choices": [{"index": 0, "delta": {"content": "delta"}}],
    }, {})
    tool_call = _openai_tool_call_to_provider_impl({"id": "call-1", "function": {"name": "lookup", "params": {"term": "ax"}}})
    profile = provider_resolve_profile("openai")
    _gemini_build_transcribe_request({"audio": {"data": "audio-bytes", "mimeType": "audio/wav"}})
    _gemini_build_speak_request({"text": "speak", "voice": "Kore", "format": "wav"})
    gemini_transcript = _gemini_normalize_transcribe_response({"candidates": [{"content": {"parts": [{"text": "transcript"}]}}]})
    gemini_speech = _gemini_normalize_speak_response({"candidates": [{"content": {"parts": [{"inlineData": {"data": "audio-bytes"}}]}}]}, {"format": "wav"})
    grok_transcribe = _grok_build_transcribe_request({"audio": "audio-bytes", "language": "en", "prompt": "names"})
    grok_speak = _grok_build_speak_request({"text": "speak", "voice": {"id": "eve"}, "format": "pcm16", "sampleRate": 16000})

    registry = {
        "flags": {"skillsMode": True},
        "protocol_actions": [{"id": "respond"}],
        "runtime_globals": [{"id": "runtime"}],
        "actor_primitives": [{"id": "speak", "effect": "fixture guidance", "stages": ["actor"], "availability_condition": "always"}],
    }
    _validate_policy_reserved_names(registry, "fixtureCallable")
    guidance = _render_actor_primitive_guidance(registry, "actor")
    policy_state = {}
    _record_policy_event(policy_state, "respond", {"ok": True})
    policy_result = _normalize_policy_action_result("respond", {"ok": True})

    descriptor = _program_descriptor("fixture", "core", {"source": "verification"})
    merged = _flow_merge_parallel_results({"base": "keep"}, {"answer": "ok"})
    gen_marker = {}
    _set_examples(gen_marker, [{"input": {"question": "q"}, "output": {"answer": "a"}}])
    _set_demos(gen_marker, [{"traces": []}])
    constants = mcp_protocol_constants()
    request = mcp_jsonrpc_request("1", "ping", {"ok": True})
    notification = mcp_jsonrpc_notification("progress", {"pct": 1})
    mcp_error = mcp_normalize_error({"jsonrpc": "2.0", "id": "1", "error": {"code": -32000, "message": "nope"}})

    return {
        "promptVars": prompt_vars,
        "chatModel": chat_payload.get("model"),
        "chatContent": chat_response.get("results", [{}])[0].get("content"),
        "embedModel": embed_payload.get("model"),
        "embedCount": len(embed_response.get("embeddings") or []),
        "streamContent": stream_response.get("results", [{}])[0].get("content"),
        "toolName": (tool_call.get("function") or {}).get("name"),
        "profileId": profile.get("id"),
        "geminiText": gemini_transcript.get("text"),
        "geminiAudio": gemini_speech.get("audio"),
        "grokCodec": (grok_speak.get("output_format") or {}).get("codec"),
        "grokFormat": grok_transcribe.get("format"),
        "policyActions": len(_select_protocol_actions(registry)),
        "runtimeGlobals": len(_select_runtime_globals(registry)),
        "qualityScore": _map_optimization_judge_quality_to_score("good"),
        "policyTrace": len(policy_state.get("policy_trace") or []),
        "policyEffectOnly": policy_result.get("effect_only"),
        "guidance": guidance,
        "programKind": descriptor.get("kind"),
        "flowAnswer": merged.get("answer"),
        "mcpVersion": constants.get("protocolVersion"),
        "mcpRequest": request.get("method"),
        "mcpNotification": notification.get("method"),
        "mcpError": mcp_error.get("code"),
        "genExamples": len(gen_marker.get("examples") or []),
        "genDemos": len(gen_marker.get("demos") or []),
    }


def _run_agent_prompt(fixture):
    # Prompt-parity gate (G3): build a real agent and assert the RLM stage instructions
    # were actually rendered into agent state. A hollow agent (RLM prompt never rendered
    # from IR) has empty/absent description keys, so this fails -- catching the exact
    # defect that slipped a non-functional agent() past every other gate.
    ag = agent(
        fixture.get("signature", "question:string -> answer:string"),
        copy.deepcopy(fixture.get("options") or {}),
    )
    expects = fixture.get("expected_description_contains") or {}
    for field, needles in expects.items():
        if field == "__order":
            continue
        desc = ag.state.get(field, "")
        if not isinstance(desc, str) or desc.strip() == "":
            raise FixtureError(
                f"agent stage description {field} is empty; RLM prompt was not rendered into agent state"
            )
        for needle in needles or []:
            if needle not in desc:
                raise FixtureError(
                    f"agent stage description {field} missing {needle!r}: {desc}"
                )


# The QuickJS engine lives in the shippable axllm.runtime_quickjs module; conformance
# imports it so the gate exercises the same code users get via `pip install axllm[runtime-quickjs]`.
_AxQuickJsRuntime = AxQuickJsCodeRuntime


def _run_agent_forward(fixture):
    client = ConformanceScriptedAI(fixture.get("responses") or [], fixture.get("stream_events") or [], fixture.get("transcribe_responses") or [])
    runtime = None
    agent_options = copy.deepcopy(fixture.get("options") or {})
    if "runtime_script" in fixture:
        runtime_config = agent_options.get("runtime") if isinstance(agent_options.get("runtime"), dict) else {}
        runtime = ScriptedCodeRuntime(
            fixture.get("runtime_script") or [],
            language=runtime_config.get("language", fixture.get("runtime_language", "JavaScript")),
            usage_instructions=runtime_config.get("usageInstructions", runtime_config.get("usage_instructions", "")),
        )
        agent_options["runtime"] = runtime
    if "runtime_engine" in fixture:
        runtime = _AxQuickJsRuntime()
        agent_options["runtime"] = runtime
    ag = None
    try:
        ag = agent(fixture.get("signature"), agent_options)
        if "set_state" in fixture:
            ag.set_state(fixture.get("set_state") or {})
        if "restore_runtime_state" in fixture:
            ag.restore_runtime_state(fixture.get("restore_runtime_state") or {})
        output = ag.forward(client, fixture.get("input") or {}, fixture.get("forward_options"))
    except AxAgentClarificationError as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            if "expected_clarification" in fixture:
                _assert_subset(exc.clarification, fixture["expected_clarification"], "clarification")
            if ag is not None:
                _assert_agent_trace(ag, fixture)
            return
        raise
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            if ag is not None:
                _assert_agent_trace(ag, fixture)
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected agent forward to fail")
    if "expected_output" in fixture:
        _assert_equal(output, fixture["expected_output"], "agent output")
    if "expected_request_count" in fixture and len(client.requests) != fixture["expected_request_count"]:
        raise FixtureError(f"expected {fixture['expected_request_count']} requests, got {len(client.requests)}")
    if "expected_request_contains" in fixture:
        request_text = json.dumps(client.requests, sort_keys=True)
        for item in fixture.get("expected_request_contains") or []:
            if str(item) not in request_text:
                raise FixtureError(f"agent request missing {item!r}: {request_text}")
    if "expected_stage_request_not_contains" in fixture:
        for raw in fixture["expected_stage_request_not_contains"]:
            index = int(raw.get("index", 0))
            text = json.dumps(client.requests[index], sort_keys=True) if index < len(client.requests) else ""
            for item in raw.get("absent") or []:
                if str(item) in text:
                    raise FixtureError(f"agent request {index} unexpectedly contained {item!r}: {text}")
    if "expected_stage_request_subset" in fixture:
        for raw in fixture["expected_stage_request_subset"]:
            index = int(raw.get("index", 0))
            if index >= len(client.requests):
                raise FixtureError(f"missing agent request index {index}")
            _assert_subset(client.requests[index], raw.get("request") or {}, f"agent request {index}")
    if "expected_cached_request_indices" in fixture:
        for index in fixture.get("expected_cached_request_indices") or []:
            idx = int(index)
            if idx >= len(client.requests):
                raise FixtureError(f"missing cached request index {idx}")
            prompt = client.requests[idx].get("chat_prompt") or []
            if not any(isinstance(message, dict) and message.get("cache") is True for message in prompt):
                raise FixtureError(f"agent request {idx} did not contain a cached prompt message: {prompt!r}")
    if "expected_chat_log_subset" in fixture:
        _assert_list_subset(ag.get_chat_log(), fixture["expected_chat_log_subset"], "agent chat log")
    if "expected_state" in fixture:
        _assert_subset(ag.get_state(), fixture["expected_state"], "agent state")
    exported = ag.export_runtime_state()
    if "expected_runtime_contract_subset" in fixture:
        _assert_subset(ag.get_runtime_contract(), fixture["expected_runtime_contract_subset"], "runtime contract")
    if "expected_exported_state_subset" in fixture:
        _assert_subset(exported, fixture["expected_exported_state_subset"], "runtime state")
    if "expected_action_log_subset" in fixture:
        _assert_list_subset(exported.get("action_log") or [], fixture["expected_action_log_subset"], "action log")
    if runtime is not None and "expected_executed" in fixture:
        _assert_equal(runtime.executed, fixture["expected_executed"], "executed code")
    _assert_agent_trace(ag, fixture)


def _assert_agent_trace(ag, fixture):
    trace = ag.export_trace()
    if "expected_trace_subset" in fixture:
        _assert_subset(trace, fixture["expected_trace_subset"], "agent trace")
    if "expected_trace_event_kinds" in fixture:
        kinds = [event.get("kind") for event in trace.get("events") or []]
        _assert_equal(kinds, fixture["expected_trace_event_kinds"], "agent trace event kinds")
    if fixture.get("replay_trace"):
        replay_fixtures = dict(fixture.get("replay_fixtures") or {})
        if "expected_trace_event_kinds" in fixture and "expected_event_kinds" not in replay_fixtures:
            replay_fixtures["expected_event_kinds"] = fixture["expected_trace_event_kinds"]
        if "expected_output" in fixture and "expected_output" not in replay_fixtures:
            replay_fixtures["expected_output"] = fixture["expected_output"]
        replayed = ag.replay_trace(trace, replay_fixtures)
        if "expected_replay_result_subset" in fixture:
            _assert_subset(replayed, fixture["expected_replay_result_subset"], "agent replay")
        else:
            _assert_subset(replayed, {"ok": True, "status": "replayed"}, "agent replay")


def _run_agent_runtime_policy(fixture):
    ag = None
    try:
        ag = agent(fixture.get("signature", "question:string -> answer:string"), fixture.get("options") or {})
        if "discover" in fixture:
            result = ag.discover(fixture.get("discover") or {})
            if "expected_discover_result" in fixture:
                _assert_equal(result, fixture.get("expected_discover_result"), "discover result")
        if "recall" in fixture:
            result = ag.recall(fixture.get("recall") or [])
            if "expected_recall_result" in fixture:
                _assert_equal(result, fixture.get("expected_recall_result"), "recall result")
        if "used" in fixture:
            used = fixture.get("used") or {}
            result = ag.used(used.get("id"), used.get("reason"), used.get("stage", "executor"))
            if "expected_used_result" in fixture:
                _assert_equal(result, fixture.get("expected_used_result"), "used result")
        if "invoke_callable" in fixture:
            call = fixture.get("invoke_callable") or {}
            result = ag.invoke_callable(call.get("qualified_name") or call.get("name"), call.get("args") or {})
            if "expected_callable_result_subset" in fixture:
                _assert_subset(result, fixture.get("expected_callable_result_subset"), "callable result")
        if "replay_trace_input" in fixture:
            result = ag.replay_trace(fixture.get("replay_trace_input") or {}, fixture.get("replay_fixtures") or {})
            if "expected_replay_result_subset" in fixture:
                _assert_subset(result, fixture.get("expected_replay_result_subset"), "agent replay")
        if "restore_runtime_state" in fixture:
            ag.restore_runtime_state(fixture.get("restore_runtime_state") or {})
        if "context_operation" in fixture:
            result = _agent_context_fixture_result(ag.state, fixture)
            if "expected_context_result" in fixture:
                _assert_equal(result, fixture.get("expected_context_result"), "agent context result")
            if "expected_context_result_subset" in fixture:
                _assert_subset(result, fixture.get("expected_context_result_subset"), "agent context result")
            if "expected_context_events_subset" in fixture:
                exported = (result or {}).get("exported") or {}
                _assert_list_subset(exported.get("context_events") or [], fixture.get("expected_context_events_subset"), "agent context events")
        if "final_payload" in fixture:
            payload = _normalize_agent_final_payload(fixture.get("final_payload"))
            _assert_equal(payload, fixture.get("expected_final_payload"), "final payload")
        if "clarification_payload" in fixture:
            payload = _normalize_agent_clarification_payload(fixture.get("clarification_payload"))
            _assert_equal(payload, fixture.get("expected_clarification_payload"), "clarification payload")
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    if "expected_error_contains" in fixture:
        raise FixtureError("expected agent runtime policy fixture to fail")
    if "expected_runtime_contract_subset" in fixture:
        _assert_subset(ag.get_runtime_contract(), fixture["expected_runtime_contract_subset"], "runtime contract")
    if "expected_policy_subset" in fixture:
        _assert_subset(ag.get_policy(), fixture["expected_policy_subset"], "agent policy")
    if "expected_policy_registry_subset" in fixture:
        _assert_subset(ag.get_policy_registry(), fixture["expected_policy_registry_subset"], "policy registry")
    registry = ag.get_policy_registry()
    if "expected_actor_primitives_subset" in fixture:
        _assert_list_subset(registry.get("actor_primitives") or [], fixture["expected_actor_primitives_subset"], "actor primitives")
    if "expected_protocol_actions_subset" in fixture:
        _assert_list_subset(registry.get("protocol_actions") or [], fixture["expected_protocol_actions_subset"], "protocol actions")
    if "expected_runtime_globals_subset" in fixture:
        _assert_list_subset(registry.get("runtime_globals") or [], fixture["expected_runtime_globals_subset"], "runtime globals")
    if "expected_host_boundaries_subset" in fixture:
        _assert_list_subset(registry.get("host_boundaries") or [], fixture["expected_host_boundaries_subset"], "host boundaries")
    if "expected_callable_inventory_subset" in fixture:
        _assert_list_subset(ag.get_callable_inventory(), fixture["expected_callable_inventory_subset"], "callable inventory")
    if "expected_discovery_catalog_subset" in fixture:
        _assert_list_subset(ag.get_discovery_catalog(), fixture["expected_discovery_catalog_subset"], "discovery catalog")
    state = ag.export_runtime_state()
    if "expected_discovered_tool_docs_subset" in fixture:
        _assert_list_subset(state.get("discovered_tool_docs") or [], fixture["expected_discovered_tool_docs_subset"], "discovered tools")
    if "expected_loaded_skill_docs_subset" in fixture:
        _assert_list_subset(state.get("loaded_skill_docs") or [], fixture["expected_loaded_skill_docs_subset"], "loaded skills")
    if "expected_loaded_memories_subset" in fixture:
        _assert_list_subset(state.get("loaded_memories") or [], fixture["expected_loaded_memories_subset"], "loaded memories")
    if "expected_used_memories_subset" in fixture:
        _assert_list_subset(state.get("used_memories") or [], fixture["expected_used_memories_subset"], "used memories")
    if "expected_used_skills_subset" in fixture:
        _assert_list_subset(state.get("used_skills") or [], fixture["expected_used_skills_subset"], "used skills")
    if "expected_guidance_log_subset" in fixture:
        _assert_list_subset(state.get("guidance_log") or [], fixture["expected_guidance_log_subset"], "guidance log")
    if "expected_function_call_traces_subset" in fixture:
        _assert_list_subset(state.get("function_call_traces") or [], fixture["expected_function_call_traces_subset"], "function call traces")
    if "expected_policy_trace_subset" in fixture:
        _assert_list_subset(state.get("policy_trace") or [], fixture["expected_policy_trace_subset"], "policy trace")
    if "expected_action_log_subset" in fixture:
        _assert_list_subset(state.get("action_log") or [], fixture["expected_action_log_subset"], "action log")
    if "expected_exported_state_subset" in fixture:
        _assert_subset(state, fixture["expected_exported_state_subset"], "exported runtime state")
    if "expected_optimizer_metadata_subset" in fixture:
        _assert_subset(ag.get_optimizer_metadata(), fixture["expected_optimizer_metadata_subset"], "optimizer metadata")
    _assert_agent_trace(ag, fixture)


def _run_agent_runtime_session(fixture):
    ag = agent(fixture.get("signature", "question:string -> answer:string"), fixture.get("options") or {})
    runtime = ScriptedCodeRuntime(
        fixture.get("runtime_script") or [],
        capabilities=fixture.get("runtime_capabilities") or {},
    )
    caught_expected_error = False
    result = None
    try:
        operation = fixture.get("operation", "test")
        if operation == "test":
            result = ag.test(
                runtime,
                fixture.get("code", ""),
                fixture.get("context_values") or fixture.get("input") or {},
                fixture.get("runtime_options") or {},
            )
        elif operation == "steps":
            result = None
            for step in fixture.get("steps") or []:
                if "restore_session_state" in step:
                    ag.restore_session_state(step.get("restore_session_state") or {})
                result = ag.execute_actor_step(
                    runtime,
                    step.get("code", ""),
                    step.get("values") or fixture.get("context_values") or fixture.get("input") or {},
                    step.get("options") or {},
                )
                if step.get("inspect"):
                    ag.inspect_runtime()
                if step.get("export_session_state"):
                    ag.export_session_state()
            if fixture.get("close_runtime_session"):
                ag.close_runtime_session()
        elif operation == "reserved":
            result = ag.test(runtime, fixture.get("code", ""), fixture.get("context_values") or {}, {})
        else:
            raise FixtureError(f"unknown agent runtime session operation {operation!r}")
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            caught_expected_error = True
            result = None
        else:
            raise
    if "expected_error_contains" in fixture and not caught_expected_error:
        raise FixtureError("expected agent runtime session fixture to fail")
    if "expected_result_subset" in fixture:
        _assert_subset(result, fixture["expected_result_subset"], "runtime result")
    if "expected_result" in fixture:
        _assert_equal(result, fixture["expected_result"], "runtime result")
    exported = ag.export_runtime_state()
    if "expected_exported_state_subset" in fixture:
        _assert_subset(exported, fixture["expected_exported_state_subset"], "runtime state")
    if "expected_action_log_subset" in fixture:
        _assert_list_subset(exported.get("action_log") or [], fixture["expected_action_log_subset"], "action log")
    if "expected_status_log_subset" in fixture:
        _assert_list_subset(exported.get("status_log") or [], fixture["expected_status_log_subset"], "status log")
    if "expected_session_count" in fixture and len(runtime.sessions) != fixture["expected_session_count"]:
        raise FixtureError(f"expected {fixture['expected_session_count']} sessions, got {len(runtime.sessions)}")
    if "expected_closed_session_count" in fixture:
        closed_count = sum(1 for session in runtime.sessions if getattr(session, "closed", False))
        if closed_count != fixture["expected_closed_session_count"]:
            raise FixtureError(f"expected {fixture['expected_closed_session_count']} closed sessions, got {closed_count}")
    if "expected_executed" in fixture:
        _assert_equal(runtime.executed, fixture["expected_executed"], "executed code")
    if "expected_create_globals_subset" in fixture:
        if not runtime.create_requests:
            raise FixtureError("expected at least one runtime create_session request")
        _assert_subset(runtime.create_requests[-1].get("globals") or {}, fixture["expected_create_globals_subset"], "runtime create globals")
    if "expected_create_options_subset" in fixture:
        if not runtime.create_requests:
            raise FixtureError("expected at least one runtime create_session request")
        _assert_subset(runtime.create_requests[-1].get("options") or {}, fixture["expected_create_options_subset"], "runtime create options")
    if "expected_execute_options_subset" in fixture:
        if not runtime.execute_options:
            raise FixtureError("expected at least one runtime execute request")
        _assert_subset(runtime.execute_options[-1], fixture["expected_execute_options_subset"], "runtime execute options")
    if "expected_runtime_inspection" in fixture:
        _assert_equal(exported.get("runtime_inspection"), fixture["expected_runtime_inspection"], "runtime inspection")
    if "expected_runtime_inspection_contains" in fixture:
        actual_inspection = str(exported.get("runtime_inspection"))
        if fixture["expected_runtime_inspection_contains"] not in actual_inspection:
            raise FixtureError(f"runtime inspection expected to contain {fixture['expected_runtime_inspection_contains']!r}, got {actual_inspection!r}")
    if "expected_absent_runtime_session_globals" in fixture:
        globals_ = (exported.get("runtime_session_state") or {}).get("globals") or {}
        for key in fixture["expected_absent_runtime_session_globals"]:
            if isinstance(globals_, dict) and key in globals_:
                raise FixtureError(f"runtime session globals unexpectedly contained {key!r}")
    _assert_agent_trace(ag, fixture)


def _runtime_adapter_call(spec):
    name = spec.get("name")
    args = spec.get("args") or []
    kwargs = spec.get("kwargs") or {}
    if name == "result":
        return RuntimeEnvelope.result(args[0] if args else None)
    if name == "error":
        return RuntimeEnvelope.error(args[0] if args else "", args[1] if len(args) > 1 else kwargs.get("category", "runtime"))
    if name == "session_closed":
        return RuntimeEnvelope.session_closed(args[0] if args else "session closed")
    if name == "timeout":
        return RuntimeEnvelope.timeout(args[0] if args else "execution timed out")
    if name == "final":
        return RuntimeEnvelope.final(*args)
    if name == "ask_clarification":
        return RuntimeEnvelope.ask_clarification(*args)
    if name == "discover":
        return RuntimeEnvelope.discover(args[0] if args else {})
    if name == "recall":
        return RuntimeEnvelope.recall(args[0] if args else [])
    if name == "used":
        return RuntimeEnvelope.used(args[0] if args else {}, kwargs.get("reason"), kwargs.get("stage"))
    if name == "status":
        return RuntimeEnvelope.status(args[0] if args else "success", args[1] if len(args) > 1 else "")
    if name == "guide_agent":
        return RuntimeEnvelope.guide_agent(args[0] if args else "", args[1] if len(args) > 1 else None)
    raise FixtureError(f"unknown runtime adapter helper {name!r}")


def _run_agent_runtime_adapter(fixture):
    if "capabilities" in fixture:
        raw = fixture.get("capabilities") or {}
        caps = RuntimeCapabilities(
            inspect=raw.get("inspect", True),
            snapshot=raw.get("snapshot", True),
            patch=raw.get("patch", True),
            abort=raw.get("abort", False),
            language=raw.get("language", "JavaScript"),
            usage_instructions=raw.get("usage_instructions", ""),
        )
        if "expected_capabilities" in fixture:
            _assert_subset(caps.to_dict(), fixture["expected_capabilities"], "runtime capabilities")
    for spec in fixture.get("helper_calls") or []:
        actual = _runtime_adapter_call(spec)
        if "expected" in spec:
            _assert_equal(actual, spec["expected"], f"runtime helper {spec.get('name')}")
        if "expected_subset" in spec:
            _assert_subset(actual, spec["expected_subset"], f"runtime helper {spec.get('name')}")
        if spec.get("normalize"):
            normalized = _normalize_agent_runtime_step_result(actual, spec.get("code", "<adapter>"))
            if "expected_normalized_subset" in spec:
                _assert_subset(normalized, spec["expected_normalized_subset"], f"runtime helper normalized {spec.get('name')}")
    if fixture.get("run_session"):
        script = [{"expected_code": "adapter()", "result": _runtime_adapter_call(fixture["run_session"])}]
        session_fixture = {
            "signature": fixture.get("signature", "question:string -> answer:string"),
            "operation": "test",
            "code": "adapter()",
            "context_values": fixture.get("context_values") or {"question": "adapter"},
            "runtime_script": script,
            "expected_result_subset": fixture.get("expected_result_subset"),
            "expected_action_log_subset": fixture.get("expected_action_log_subset"),
            "expected_trace_event_kinds": fixture.get("expected_trace_event_kinds"),
            "expected_closed_session_count": fixture.get("expected_closed_session_count"),
        }
        _run_agent_runtime_session({k: v for k, v in session_fixture.items() if v is not None})


def _run_agent_runtime_protocol(fixture):
    runtime = _runtime_protocol_command(fixture.get("mode", "normal"))
    session = None
    try:
        operation = fixture.get("operation", "roundtrip")
        if operation == "roundtrip":
            capabilities = runtime._request("capabilities", None, {}).get("result")
            if "expected_capabilities_subset" in fixture:
                _assert_subset(capabilities, fixture["expected_capabilities_subset"], "protocol capabilities")
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            result = session.execute(fixture.get("execute_code", "final()"), fixture.get("execute_options") or {})
            if "expected_execute_subset" in fixture:
                _assert_subset(result, fixture["expected_execute_subset"], "protocol execute")
            inspected = session.inspect_globals({})
            if "expected_inspect_subset" in fixture:
                _assert_subset(inspected, fixture["expected_inspect_subset"], "protocol inspect")
            snapshot = session.snapshot_globals({})
            if "expected_snapshot_subset" in fixture:
                _assert_subset(snapshot, fixture["expected_snapshot_subset"], "protocol snapshot")
            patched = session.patch_globals(fixture.get("patch_globals") or {}, {})
            if "expected_patch_subset" in fixture:
                _assert_subset(patched, fixture["expected_patch_subset"], "protocol patch")
            closed = session.close()
            if "expected_close_subset" in fixture:
                _assert_subset(closed, fixture["expected_close_subset"], "protocol close")
            return
        if operation == "execute_error":
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            result = session.execute(fixture.get("execute_code", "timeout()"), fixture.get("execute_options") or {})
            if "expected_execute_subset" in fixture:
                _assert_subset(result, fixture["expected_execute_subset"], "protocol execute error")
            return
        if operation == "unknown_op":
            runtime._request("unknown_op", None, {})
            raise FixtureError("expected unknown protocol op to fail")
        if operation == "capabilities_error":
            runtime._request("capabilities", None, {})
            raise FixtureError("expected protocol capabilities request to fail")
        if operation == "unavailable":
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            method = getattr(session, fixture.get("method", "inspect_globals"))
            method({})
            raise FixtureError("expected unavailable protocol method to fail")
        if operation == "session_mismatch":
            session = runtime.create_session(fixture.get("create_globals") or {}, fixture.get("create_options") or {})
            runtime._request("execute", "s1", {"code": fixture.get("execute_code", "final()"), "options": {}})
            raise FixtureError("expected protocol session mismatch to fail")
        raise FixtureError(f"unknown runtime protocol operation {operation!r}")
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected in str(exc):
            return
        raise
    finally:
        try:
            if session is not None:
                session.close()
        except Exception:
            pass
        try:
            runtime.shutdown()
        except Exception:
            pass


def _run_ai_chat(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.chat(fixture["request"], fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai chat output")
    _assert_transport_request(fixture, transport)


def _run_ai_embed(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.embed(fixture["request"], fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai embed output")
    _assert_transport_request(fixture, transport)


def _run_ai_stream(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = list(client.stream(fixture["request"], fixture.get("options")))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai stream output")
    _assert_transport_request(fixture, transport)


def _run_ai_error(fixture):
    client, transport = _openai_fixture_client(fixture)
    try:
        method = fixture.get("method", "chat")
        if method == "stream":
            list(client.stream(fixture["request"], fixture.get("options")))
        elif method == "embed":
            client.embed(fixture["request"], fixture.get("options"))
        elif method in ("transcribe", "speak"):
            getattr(client, method)(fixture.get("request") or {}, fixture.get("options"))
        else:
            client.chat(fixture["request"], fixture.get("options"))
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        expected_type = fixture.get("expected_error_type")
        if expected_type and type(exc).__name__ != expected_type:
            raise FixtureError(f"expected error type {expected_type}, got {type(exc).__name__}")
        if "expected_status" in fixture and getattr(exc, "status", None) != fixture["expected_status"]:
            raise FixtureError(f"expected status {fixture['expected_status']}, got {getattr(exc, 'status', None)}")
        _assert_transport_request(fixture, transport)
        return
    raise FixtureError("expected AxAI call to fail")


def _run_ai_unsupported(fixture):
    client, _ = _openai_fixture_client(fixture)
    method = getattr(client, fixture.get("method", "transcribe"))
    try:
        method(fixture.get("request") or {})
    except Exception as exc:
        expected = fixture.get("expected_error_contains")
        if expected and expected not in str(exc):
            raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")
        return
    raise FixtureError("expected unsupported capability error")


def _run_ai_provider_descriptor(fixture):
    descriptor = provider_descriptor(fixture.get("provider", "openai-compatible"))
    if "expected_output" in fixture:
        _assert_subset(descriptor, fixture["expected_output"], "provider descriptor")


def _run_ai_provider_registry(fixture):
    registry = provider_profile_registry()
    if "expected_output" in fixture:
        _assert_subset(registry, fixture["expected_output"], "provider profile registry")
    for alias, expected in (fixture.get("alias_expectations") or {}).items():
        _assert_equal(provider_normalize_profile(alias), expected, f"provider alias {alias}")


def _run_ai_model_catalog_audit(fixture):
    summary = provider_model_catalog_summary()
    if "expected_output" in fixture:
        _assert_subset(summary, fixture["expected_output"], "provider model catalog audit")


def _run_ai_model_catalog_runtime(fixture):
    model_type = fixture.get("model_type")
    result = get_supported_ai_models(model_type)
    expected = fixture.get("expected_output")
    if expected is not None:
        actual = {
            "providerCount": len(result),
            "providerNames": [item.get("name") for item in result],
            "modelCount": sum(len(item.get("models") or []) for item in result),
            "openaiFirstModel": next((p.get("models", [{}])[0].get("name") for p in result if p.get("name") == "openai" and p.get("models")), None),
            "openaiModelTypes": sorted(set(model.get("type") for p in result if p.get("name") == "openai" for model in p.get("models", []))),
            "catalog": result,
        }
        _assert_subset(actual, expected, "provider model catalog runtime")
    if fixture.get("check_clone"):
        result[0]["models"].append({"name": "mutated"})
        fresh = get_supported_ai_models(model_type)
        _assert_equal(any(model.get("name") == "mutated" for model in fresh[0].get("models", [])), False, "catalog clone")


def _build_router_services(fixture):
    return [RouterFixtureService(spec) for spec in fixture.get("services", [])]


def _run_ai_multiservice_router(fixture):
    services = _build_router_services(fixture)
    entries = []
    for raw in fixture.get("router_entries", []):
        if raw.get("kind") == "key":
            entries.append({"key": raw["key"], "description": raw.get("description", ""), "service": services[raw.get("service_index", 0)], "isInternal": raw.get("isInternal", raw.get("is_internal"))})
        else:
            entries.append(services[raw.get("service_index", 0)])
    try:
        router = MultiServiceRouter(entries)
        outputs = {}
        for op in fixture.get("operations", []):
            name = op.get("name")
            if name == "chat":
                outputs[name] = router.chat(op.get("request") or {}, op.get("options"))
            elif name == "embed":
                outputs[name] = router.embed(op.get("request") or {}, op.get("options"))
            elif name == "transcribe":
                outputs[name] = router.transcribe(op.get("request") or {}, op.get("options"))
            elif name == "speak":
                outputs[name] = router.speak(op.get("request") or {}, op.get("options"))
            elif name == "set_options":
                router.set_options(op.get("options") or {})
        actual = {
            "outputs": outputs,
            "lastChat": router.get_last_used_chat_model(),
            "lastEmbed": router.get_last_used_embed_model(),
            "lastConfig": router.get_last_used_model_config(),
            "metrics": router.get_metrics(),
            "options": router.get_options(),
            "serviceCalls": [service.requests for service in services if service.requests],
        }
        expected_output = fixture.get("expected_output") or {}
        if "modelList" in expected_output:
            actual["modelList"] = router.get_model_list()
        if fixture.get("expected_error_contains"):
            raise FixtureError("expected multi-service router to fail")
        if "expected_output" in fixture:
            _assert_subset(actual, expected_output, "multi-service router")
    except Exception as exc:
        if not fixture.get("expected_error_contains"):
            raise
        if fixture["expected_error_contains"] not in str(exc):
            raise FixtureError(f"expected error containing {fixture['expected_error_contains']}, got {exc}")


def _run_ai_provider_router(fixture):
    services = _build_router_services(fixture)
    primary = services[fixture.get("primary_index", 0)] if services else None
    alternatives = [services[index] for index in fixture.get("alternative_indices", [])]
    router = ProviderRouter({
        "providers": {"primary": primary, "alternatives": alternatives},
        "routing": fixture.get("routing") or {"capability": {"requireExactMatch": False, "allowDegradation": True}},
        "processing": fixture.get("processing") or {},
    })
    request = fixture.get("request") or {}
    rec = router.get_routing_recommendation(request)
    provider = rec.get("provider")
    recommendation = {
        "provider": provider.get_name() if provider else rec.get("providerName"),
        "processingApplied": rec.get("processingApplied"),
        "degradations": rec.get("degradations"),
        "warnings": rec.get("warnings"),
    }
    actual = {
        "recommendation": recommendation,
        "validation": router.validate_request(request),
        "stats": router.get_routing_stats(),
    }
    if "expected_output" in fixture:
        _assert_subset(actual, fixture["expected_output"], "provider router")


def _run_ai_balancer(fixture):
    services = _build_router_services(fixture)
    try:
        balancer = AxBalancer(services, fixture.get("options") or {})
        outputs = {}
        for op in fixture.get("operations", []):
            name = op.get("name")
            if name == "chat":
                outputs[name] = balancer.chat(op.get("request") or {}, op.get("options"))
            elif name == "embed":
                outputs[name] = balancer.embed(op.get("request") or {}, op.get("options"))
            elif name == "transcribe":
                outputs[name] = balancer.transcribe(op.get("request") or {}, op.get("options"))
            elif name == "speak":
                outputs[name] = balancer.speak(op.get("request") or {}, op.get("options"))
            elif name == "set_options":
                balancer.set_options(op.get("options") or {})
        actual = {
            "id": balancer.get_id(),
            "name": balancer.get_name(),
            "outputs": outputs,
            "lastChat": balancer.get_last_used_chat_model(),
            "lastEmbed": balancer.get_last_used_embed_model(),
            "lastConfig": balancer.get_last_used_model_config(),
            "metrics": balancer.get_metrics(),
            "options": balancer.get_options(),
            "serviceCalls": [service.requests for service in services if service.requests],
        }
        expected_output = fixture.get("expected_output") or {}
        if "modelList" in expected_output:
            actual["modelList"] = balancer.get_model_list()
        if "features" in expected_output:
            actual["features"] = balancer.get_features()
        if fixture.get("expected_error_contains"):
            raise FixtureError("expected balancer to fail")
        if "expected_output" in fixture:
            _assert_subset(actual, fixture["expected_output"], "balancer")
    except Exception as exc:
        if not fixture.get("expected_error_contains"):
            raise
        if fixture["expected_error_contains"] not in str(exc):
            raise FixtureError(f"expected error containing {fixture['expected_error_contains']}, got {exc}")


def _run_ai_transcribe(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.transcribe(fixture.get("request") or {}, fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai transcribe output")
    _assert_transport_request(fixture, transport)


def _run_ai_speak(fixture):
    client, transport = _openai_fixture_client(fixture)
    result = client.speak(fixture.get("request") or {}, fixture.get("options"))
    if "expected_output" in fixture:
        _assert_equal(result, fixture["expected_output"], "ai speak output")
    _assert_transport_request(fixture, transport)


def _run_ai_realtime(fixture):
    client, _ = _openai_fixture_client(fixture)
    try:
        request = fixture.get("request") or {}
        if "expected_setup" in fixture:
            _assert_equal(client.realtime_audio_setup(request), fixture["expected_setup"], "ai realtime setup")
        if "expected_input" in fixture:
            _assert_equal(client.realtime_audio_input(request), fixture["expected_input"], "ai realtime input")
        result = list(client.realtime(fixture.get("events") or []))
        if fixture.get("expected_error_contains"):
            raise FixtureError("expected ai realtime fixture to fail")
        if "expected_output" in fixture:
            _assert_equal(result, fixture["expected_output"], "ai realtime output")
    except Exception as exc:
        if not fixture.get("expected_error_contains"):
            raise
        if fixture["expected_error_contains"] not in str(exc):
            raise FixtureError(f"expected error containing {fixture['expected_error_contains']}, got {exc}")


def _build_signature(fixture):
    if "signature_spec" in fixture:
        return _signature_from_spec(fixture["signature_spec"])
    return s(fixture["signature"])


def _field_for_validation(fixture):
    name = fixture.get("field_name", "value")
    return _field_from_spec(fixture.get("field") or {}).to_field(name)


def _signature_payload(sig):
    return {
        "description": sig.get_description(),
        "inputs": [_field_payload(field) for field in sig.get_input_fields()],
        "outputs": [_field_payload(field) for field in sig.get_output_fields()],
    }


def _field_payload(field):
    out = {
        "name": field.name,
        "title": field.title,
        "type": _type_payload(field.type),
        "isOptional": bool(field.is_optional),
        "isInternal": bool(field.is_internal),
        "isCached": bool(field.is_cached),
    }
    if field.description is not None:
        out["description"] = field.description
    return out


def _type_payload(typ):
    out = {"name": typ.name, "isArray": bool(typ.is_array)}
    if typ.options is not None:
        out["options"] = list(typ.options)
    if typ.description is not None:
        out["description"] = typ.description
    if typ.fields:
        out["fields"] = {name: _field_payload(_nested_payload_field(name, item)) for name, item in typ.fields.items()}
    if typ.min_length is not None:
        out["minLength"] = typ.min_length
    if typ.max_length is not None:
        out["maxLength"] = typ.max_length
    if typ.minimum is not None:
        out["minimum"] = typ.minimum
    if typ.maximum is not None:
        out["maximum"] = typ.maximum
    if typ.pattern is not None:
        out["pattern"] = typ.pattern
    if typ.pattern_description is not None:
        out["patternDescription"] = typ.pattern_description
    if typ.format is not None:
        out["format"] = typ.format
    return out


def _nested_payload_field(name, item):
    from .signature import Field
    if isinstance(item, Field):
        return item
    return Field(name=name, type=item)


def _assert_expected_error(exc, fixture):
    expected_category = fixture.get("expected_error_category")
    if expected_category and _error_category(exc) != expected_category:
        raise FixtureError(f"expected error category {expected_category!r}, got {_error_category(exc)!r}")
    expected = fixture.get("expected_error_contains")
    if expected and expected not in str(exc):
        raise FixtureError(f"expected error containing {expected!r}, got {exc!r}")


def _error_category(exc):
    name = type(exc).__name__
    if name == "AxSignatureError":
        return "signature"
    if name == "AxValidationError":
        return "validation"
    if name.startswith("AxAI"):
        return "ai"
    return "runtime"


def _openai_fixture_client(fixture):
    transport = ScriptedTransport(fixture.get("transport_responses") or fixture.get("responses") or [])
    provider = provider_normalize_profile(str(fixture.get("provider", "openai-compatible")))
    if provider == "openai-responses":
        client_cls = OpenAIResponsesClient
        default_model = "gpt-4o"
        default_embed_model = "text-embedding-ada-002"
    elif provider == "google-gemini":
        client_cls = GoogleGeminiClient
        default_model = "gemini-2.5-flash"
        default_embed_model = "gemini-embedding-2"
    elif provider == "anthropic":
        client_cls = AnthropicClient
        default_model = "claude-3-7-sonnet-latest"
        default_embed_model = ""
    elif provider == "azure-openai":
        client_cls = AzureOpenAIClient
        default_model = "gpt-5-mini"
        default_embed_model = "text-embedding-3-small"
    elif provider == "deepseek":
        client_cls = DeepSeekClient
        default_model = "deepseek-v4-flash"
        default_embed_model = ""
    elif provider == "mistral":
        client_cls = MistralClient
        default_model = "mistral-small-latest"
        default_embed_model = "mistral-embed"
    elif provider == "reka":
        client_cls = RekaClient
        default_model = "reka-core"
        default_embed_model = ""
    elif provider == "cohere":
        client_cls = CohereClient
        default_model = "command-r-plus"
        default_embed_model = "embed-english-v3.0"
    elif provider == "grok":
        client_cls = GrokClient
        default_model = "grok-4.3"
        default_embed_model = ""
    else:
        client_cls = OpenAICompatibleClient
        default_model = "gpt-4.1-mini"
        default_embed_model = "text-embedding-3-small"
    extra_options = {}
    for key in ("base_url", "baseUrl", "resource_name", "resourceName", "deployment_name", "deploymentName", "api_version", "apiVersion", "version"):
        if key in fixture:
            extra_options[key] = fixture[key]
    client = client_cls(
        model=fixture.get("model", default_model),
        embed_model=fixture.get("embed_model", default_embed_model),
        api_key="test-key",
        transport=transport,
        model_config=fixture.get("model_config"),
        **extra_options,
    )
    return client, transport


def _assert_transport_request(fixture, transport):
    if "expected_transport_request" not in fixture:
        return
    if not transport.requests:
        raise FixtureError("expected provider transport request but none were sent")
    _assert_subset(transport.requests[0], fixture["expected_transport_request"], "provider request")


def _legacy_response_to_chat_response(raw):
    if "results" in raw:
        return raw
    calls = []
    for call in raw.get("function_calls") or []:
        calls.append({
            "id": call.get("id"),
            "type": "function",
            "function": {
                "name": call.get("name"),
                "params": call.get("params"),
            },
        })
    return {
        "results": [{
            "index": 0,
            "content": raw.get("content", ""),
            "function_calls": calls,
            "finish_reason": raw.get("finish_reason", "stop"),
        }],
        "model_usage": {"tokens": raw.get("usage")} if raw.get("usage") else None,
    }


def _signature_from_spec(spec):
    builder = f()
    if spec.get("description"):
        builder.description(spec["description"])
    for name, field_spec in (spec.get("inputs") or {}).items():
        builder.input(name, _field_from_spec(field_spec))
    for name, field_spec in (spec.get("outputs") or {}).items():
        builder.output(name, _field_from_spec(field_spec))
    return builder.build()


def _field_from_spec(spec):
    typ = spec.get("type", "string")
    if typ == "class":
        field = f.classification(spec.get("options") or [], spec.get("description"))
    elif typ == "object":
        fields = {name: _field_from_spec(item) for name, item in (spec.get("fields") or {}).items()} if "fields" in spec else None
        field = f.object(fields, spec.get("description"))
    else:
        factory_name = {
            "dateRange": "date_range",
            "datetimeRange": "datetime_range",
        }.get(typ, typ)
        factory = getattr(f, factory_name)
        field = factory(spec.get("description"))
    if spec.get("array"):
        field = field.array(spec.get("arrayDescription"))
    if spec.get("optional"):
        field = field.optional()
    if spec.get("internal"):
        field = field.internal()
    if spec.get("cache"):
        field = field.cache()
    if "min" in spec:
        field = field.min(spec["min"])
    if "max" in spec:
        field = field.max(spec["max"])
    if spec.get("email"):
        field = field.email()
    if spec.get("url"):
        field = field.url()
    if spec.get("pattern"):
        field = field.regex(spec["pattern"], spec.get("patternDescription") or spec["pattern"])
    return field


def _build_tools(specs):
    calls = []
    tools = []
    for spec in specs:
        builder = fn(spec["name"]).description(spec.get("description") or spec["name"])
        for name, field_spec in (spec.get("args") or {}).items():
            builder.arg(name, _field_from_spec(field_spec))
        for name, field_spec in (spec.get("returns") or {}).items():
            builder.returns_field(name, _field_from_spec(field_spec))
        result = copy.deepcopy(spec.get("result"))
        error = spec.get("error")

        def handler(args, *, _name=spec["name"], _result=result, _error=error):
            calls.append({"name": _name, "args": copy.deepcopy(args)})
            if _error:
                raise RuntimeError(_error)
            return copy.deepcopy(_result)

        tools.append(builder.handler(handler).build())
    return tools, calls


def _assert_equal(actual, expected, label):
    if actual != expected:
        raise FixtureError(
            f"{label} mismatch\nactual: {json.dumps(actual, sort_keys=True)}\nexpected: {json.dumps(expected, sort_keys=True)}"
        )


def _assert_subset(actual, expected, label):
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            raise FixtureError(f"{label} expected dict subset, got {type(actual).__name__}")
        for key, value in expected.items():
            if key not in actual:
                raise FixtureError(f"{label} missing key {key!r}")
            _assert_subset(actual[key], value, f"{label}.{key}")
        return
    if isinstance(expected, list):
        _assert_equal(actual, expected, label)
        return
    if actual != expected:
        raise FixtureError(f"{label} expected {expected!r}, got {actual!r}")


def _assert_list_subset(actual, expected, label):
    if not isinstance(actual, list):
        raise FixtureError(f"{label} expected list, got {type(actual).__name__}")
    start = 0
    for expected_item in expected:
        matched = False
        for index in range(start, len(actual)):
            try:
                _assert_subset(actual[index], expected_item, f"{label}[{index}]")
                start = index + 1
                matched = True
                break
            except FixtureError:
                continue
        if not matched:
            raise FixtureError(f"{label} missing expected item {expected_item!r}")


def _expand_paths(paths):
    out = []
    for path in paths:
        p = Path(path)
        if p.is_dir():
            out.extend(sorted(p.glob("*.json")))
        else:
            out.append(p)
    return out


def main(argv=None):
    argv = list(argv or sys.argv[1:])
    if argv and argv[0] == "--runtime-protocol-fixture-server":
        _runtime_protocol_fixture_server_main()
        return
    if not argv:
        raise SystemExit("usage: python -m axllm.conformance <fixture-or-dir>...")
    for result in run_fixtures(argv):
        print("ok", result["name"])


if __name__ == "__main__":
    main()
