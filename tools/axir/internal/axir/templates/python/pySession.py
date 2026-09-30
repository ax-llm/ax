"""Run controls and the internal provider-pinned Responses transport adapter."""
from __future__ import annotations

import copy
import json
import queue
import threading
from typing import Any, Callable, Iterator, Protocol

from .ai import _emit_usage_event, _iter_sse_json
from .gen import _StreamingConsumerStopped, _core_ai_client_features, _core_ai_complete_once, _core_ai_stream_open, _core_axgen_speak


class AxChatSession(Protocol):
    """Optional normalized session supplied by a custom provider.

    Emit completed tool calls only after arguments are complete. Keep events
    open across response boundaries; close must unblock the event iterator.
    Applications normally use generation, agent, or flow entrypoints instead.
    """
    def events(self) -> Iterator[dict[str, Any]]: ...
    def submit(self, results: list[dict[str, Any]]) -> None: ...
    def update(self, update: dict[str, Any]) -> str: ...
    def close(self) -> None: ...


class AxRunControl:
    def __init__(self):
        self.signal = threading.Event()
        self._lock = threading.RLock()
        self._updates = []
        self._listeners = []
        self._next_id = 0

    def __deepcopy__(self, memo):
        return self

    def steer(self, text: str, *, target: str = "root"):
        if not text.strip():
            raise ValueError("Steering text must not be empty")
        self._enqueue({"type": "steer", "text": text, "target": target})

    def set_thinking_token_budget(self, level: str, *, target: str = "root"):
        if level not in ("none", "minimal", "low", "medium", "high", "highest"):
            raise ValueError("Invalid thinking token budget")
        self._enqueue({"type": "thinking", "level": level, "target": target})

    def abort(self):
        with self._lock:
            if self.signal.is_set():
                return
            self.signal.set()
        self._emit({"type": "aborted", "path": "root"})

    def on_event(self, listener: Callable[[dict[str, Any]], None]):
        with self._lock:
            self._listeners.append(listener)
        def remove():
            with self._lock:
                if listener in self._listeners:
                    self._listeners.remove(listener)
        return remove

    def _enqueue(self, update):
        with self._lock:
            if self.signal.is_set():
                raise RuntimeError("Run controller is aborted")
            self._next_id += 1
            update = {**update, "id": str(self._next_id)}
            self._updates.append(update)
        self._emit({"type": "queued", "path": update["target"], "update_id": update["id"]})

    def _pending(self, path, after):
        from .gen import chat_session_target_matches
        with self._lock:
            return [dict(u) for u in self._updates if int(u["id"]) > after and chat_session_target_matches(u["target"], path)]

    def _emit(self, event):
        with self._lock:
            listeners = list(self._listeners)
        for listener in listeners:
            try:
                listener(dict(event))
            except Exception:
                pass


def run_control() -> AxRunControl:
    return AxRunControl()


class _BoundaryClient:
    """Apply controls to ordinary chat services at the next request boundary."""
    def __init__(self, client, options):
        self.client, self.options = client, options
        self.control = options["control"]
        self.path = options.get("execution_path", options.get("executionPath", "root"))
        self.after, self.level = 0, None
        self.control._emit({"type": "started", "path": self.path})

    def get_features(self, model=None):
        return _core_ai_client_features(self.client, model)

    def speak(self, request, options=None):
        # The audio output renderer's speech goes to the wrapped client.
        return _core_axgen_speak(self.client, request, options)

    def _apply(self, request):
        from .gen import chat_session_apply_boundary_updates
        if self.control.signal.is_set():
            raise RuntimeError("Run aborted before the next model request")
        updates = self.control._pending(self.path, self.after)
        if updates:
            self.after = max(int(update["id"]) for update in updates)
        applied = chat_session_apply_boundary_updates(request, updates, self.level)
        self.level = applied["level"]
        for update_id in applied["applied"]:
            self.control._emit({"type": "applied", "path": self.path, "update_id": update_id, "timing": "next-response"})
        return applied["request"]

    def _take_control_updates(self):
        # The forward applies these when a step starts, as TS does, so they
        # are applied now and the next request boundary skips them.
        updates = self.control._pending(self.path, self.after)
        if updates:
            self.after = max(int(update["id"]) for update in updates)
        for update in updates:
            self.control._emit({"type": "applied", "path": self.path, "update_id": update["id"], "timing": "next-response"})
        return updates

    def _pending_control_count(self):
        return len(self.control._pending(self.path, self.after))

    def complete(self, request):
        return _core_ai_complete_once(self.client, self._apply(request), self.options)

    def stream(self, request, options=None):
        # A streamed forward pulls the inner client's chunks through the same
        # request boundary.
        handle = _core_ai_stream_open(self.client, self._apply(request), options or self.options)
        try:
            while True:
                chunk = handle.next()
                if chunk is None:
                    return
                yield chunk
        finally:
            handle.close()

    def close(self, error=None):
        if isinstance(error, _StreamingConsumerStopped):
            # The consumer stopped the run early: it ended on purpose, as
            # with control.abort().
            self.control._emit({"type": "aborted", "path": self.path})
            return
        self.control._emit({"type": "failed" if error else "completed", "path": self.path,
            **({"error": str(error)} if error else {})})


class _ResponsesChatSession:
    """Transport and host cancellation only; Core owns event normalization."""
    def __init__(self, client, request, options=None):
        from .ai import merge_model_config, provider_build_chat_request
        self.client = client
        self.options = client._merged_options(options)
        self.model = str(request.get("model") or client.model)
        config = merge_model_config(client.model_config, request.get("model_config"), self.options)
        self.request = {**request, "model": self.model, "model_config": {**config, "stream": True}}
        self._base = provider_build_chat_request(client.profile, self.request, self.options)
        execution = {fn["name"]: fn.get("execution", "blocking") for fn in request.get("functions", [])}
        for tool in self._base.get("tools", []):
            if execution.get(tool.get("name")) == "background":
                tool["async"] = True
        self._queue = queue.Queue()
        self._lock = threading.RLock()
        self._wire_state = {}
        self._closed = threading.Event()
        self.signal = self._closed
        self._active = False
        self._failure = None
        self._previous_id = None
        self._updates = []
        self._readers = {}
        self._last_was_update = False
        self._socket = self.options.get("webSocketTransport", self.options.get("web_socket_transport"))
        factory=self.options.get("webSocketFactory",self.options.get("web_socket_factory"))
        if factory is not None:
            from .ai import AxAIServiceAuthenticationError
            target=client.base_url+client._operation_path("stream_chat",self.model)
            headers=client._headers()
            if client.credential_provider:
                fresh=client.credential_provider({"profile":client.profile,"operation":"stream_chat","method":"GET","url":target})
                if not isinstance(fresh,dict):raise AxAIServiceAuthenticationError("credential_provider must return a header dictionary")
                headers.update({str(key):str(value) for key,value in fresh.items()})
            self._socket=factory(target.replace("https:","wss:",1).replace("http:","ws:",1),headers)
            if self._socket is None:raise ValueError("Session WebSocket factory returned no transport")
        if self._socket is not None:
            threading.Thread(target=self._read_socket, daemon=True).start()
        self._send(dict(self._base))

    def events(self) -> Iterator[dict[str, Any]]:
        while True:
            event = self._queue.get()
            if event is None:
                if self._failure:
                    raise self._failure
                return
            yield event

    def _accept(self, raw):
        from .ai import openai_responses_session_event
        notifications = openai_responses_session_event(raw, self._wire_state, self.model)
        with self._lock:
            if self._closed.is_set():
                return
            if raw.get("type") == "response.created":
                self._previous_id = raw["response"]["id"]
                self._active = True
            for event in notifications:
                if event["type"] == "response.completed":
                    self._previous_id = event["response_id"]
                    self._active = False
                    usage = event["response"].get("model_usage")
                    self.client.last_model_usage = copy.deepcopy(usage)
                    _emit_usage_event("chat", event["response"], self.options, True)
                self._queue.put(event)

    def _read_socket(self):
        try:
            while not self._closed.is_set():
                receive = getattr(self._socket, "recv", None) or self._socket.receive
                raw = receive()
                if raw is None:
                    raise RuntimeError("Responses socket disconnected; work was not replayed")
                self._accept(json.loads(raw) if isinstance(raw, str) else raw)
        except BaseException as error:
            self._fail(error)

    def _read_http(self, payload):
        completed = False
        reader = None
        try:
            raw = self.client._request_json(self.client._operation_path("stream_chat", self.model), payload,
                stream=True, method="POST", operation="responses",
                error_options=self.options)
            reader = raw
            with self._lock:
                self._readers[id(reader)] = reader
            if self._closed.is_set():
                return
            for event in _iter_sse_json(raw):
                if self._closed.is_set():
                    break
                self._accept(event)
                if event.get("type") == "response.completed" or (event.get("type") == "response.incomplete" and event.get("response", {}).get("incomplete_details", {}).get("reason") == "steered"):
                    completed = True
                    break
            if not completed and not self._closed.is_set():
                raise RuntimeError("Responses stream disconnected before completion; work was not replayed")
        except BaseException as error:
            self._fail(error)
        finally:
            with self._lock:
                self._readers.pop(id(reader), None)
            close = getattr(reader, "close", None)
            if close:
                close()

    def _send(self, payload):
        from .ai import openai_responses_validate_session_request
        payload = openai_responses_validate_session_request(payload)
        with self._lock:
            if self._closed.is_set():
                raise self._failure or RuntimeError("Session closed")
            if self._active:
                raise RuntimeError("A response is already active")
            items = payload.get("input", [])
            if self._last_was_update and items and items[0].get("type") == "configuration_update":
                raise ValueError("Adjacent configuration_update items are not supported across responses")
            self._last_was_update = bool(items and items[-1].get("type") == "configuration_update")
            self._active = True
            if self._socket is not None:
                self._socket.send({"type": "response.create", **{key: value for key, value in payload.items() if key != "stream"}})
            else:
                threading.Thread(target=self._read_http, args=(payload,), daemon=True).start()

    def _continuation(self, items):
        with self._lock:
            payload = {**self._base, "previous_response_id": self._previous_id, "input": [*self._updates, *items]}
            self._send(payload)
            self._updates.clear()

    def submit_tool_results(self, results):
        self._continuation([{"type": "function_call_output", "call_id": r.get("function_id", r.get("id")), "output": r.get("result", r.get("output", ""))} for r in results])

    def continue_response(self):
        self._continuation([])

    def steer(self, text: str) -> str:
        with self._lock:
            if self._socket is not None and self._active and self._previous_id:
                self._socket.send({"type": "response.steer", "previous_response_id": self._previous_id,
                    "input": [{"role": "user", "content": [{"type": "input_text", "text": text}]}]})
                return "native"
            self._updates.append({"role": "user", "content": [{"type": "input_text", "text": text}]})
            return "next-response"

    def set_thinking_token_budget(self, level: str) -> str:
        from .ai import openai_reasoning_effort
        effort = openai_reasoning_effort(self.model, level)
        with self._lock:
            if self._updates and self._updates[-1].get("type") == "configuration_update":
                raise ValueError("Adjacent configuration_update items are not supported")
            self._updates.append({"type": "configuration_update", "reasoning": {"effort": effort}})
        return "next-response"

    def _fail(self, error):
        with self._lock:
            if self._closed.is_set():
                return
            self._failure = error
        self.close()

    def close(self):
        with self._lock:
            if self._closed.is_set():
                return
            self._closed.set()
            self._queue.put(None)
            resources = [self._socket, *self._readers.values()]
        for resource in resources:
            close = getattr(resource, "close", None)
            if close:
                try:
                    close()
                except Exception:
                    pass


class _SessionClient:
    """Bridge one AxGen run to a pinned provider without changing final validation.

    As in TS (axRunChatSession), each model request opens its own native
    session with the whole prompt and closes it once that request's response
    completes: a correction or a later step opens a fresh session, and each
    session applies the run's updates again.
    """
    def __init__(self, gen, client, options):
        self.gen, self.client, self.options = gen, client, options
        self.control = options.get("control")
        self.path = options.get("execution_path", options.get("executionPath", "root"))
        self.session = None
        self.state = None
        self._tools = {tool.name: tool for tool in gen.functions}
        self._delta = options.get("_session_delta")
        self._selected = False
        self._fallback = False
        self._fallback_level = None
        self._fallback_after = 0
        self._started = False
        self._reset_session()

    def _reset_session(self):
        # One session's state: its events, its tool workers' results, and the
        # run updates it has applied (all of them again, from the start).
        self._queue = queue.Queue()
        self._cancel = threading.Event()
        self._updates_after = 0
        self._boundary_updates = []
        self._last_response = None
        self._response_text = {}
        self._blocking = False
        self._waiting_calls = []

    def get_features(self, model=None):
        return self.client.get_features(model)

    def speak(self, request, options=None):
        # The audio output renderer's speech goes to the wrapped client.
        return _core_axgen_speak(self.client, request, options)

    def _emit(self, kind, **fields):
        if self.control:
            self.control._emit({"type": kind, "path": self.path, **fields})

    def _emit_started(self):
        if not self._started:
            self._started = True
            self._emit("started")

    def _bridge(self, session, events, cancel):
        try:
            for event in session.events():
                if cancel.is_set():return
                events.put(("provider", event))
            if not cancel.is_set():
                events.put(("failure", RuntimeError("Session disconnected; work was not replayed")))
        except BaseException as error:
            events.put(("failure", error))

    def _start(self, call):
        from . import gen as core
        from .schema import validate_fields
        call = core.chat_session_normalize_call(call)
        name = call.get("function", {}).get("name")
        if name == "__axOutput":
            core.chat_session_defer_final_call(self.state, call)
            return
        if call["id"] in self.state["pending"]:
            return
        if self._blocking:
            if not any(queued["id"] == call["id"] for queued in self._waiting_calls):
                self._waiting_calls.append(call)
            return
        tool = self._tools.get(name)
        args = call.get("function", {}).get("params", {})
        try:
            args = json.loads(args) if isinstance(args, str) else args
            if tool is None:
                raise ValueError(f"Function {name!r} not found")
            validate_fields(tool.args, args, f"tool.{name}.args")
            core.chat_session_validate_required_arguments(tool.parameters, args, f"tool.{name}.args")
        except Exception as error:
            core.chat_session_register_call(self.state, call, "blocking")
            message = core._tool_error_message_impl(call, error)
            core.chat_session_record_result(self.gen, self.state, call, message.get("result", str(error)), False)
            return
        call = {**call, "params": args, "function": {**call["function"], "params": args}}
        core.chat_session_register_call(self.state, call, tool.execution)
        self._blocking = tool.execution != "background"
        self._emit("tool.started", call_id=call["id"])
        # A worker owns only the invocation and its result. It cannot alter
        # history, and its result goes to the session that started it.
        events, cancel = self._queue, self._cancel
        def invoke():
            try:
                result = core._core_tool_invoke(tool, args, {"signal": cancel, "call_id": call["id"]})
                events.put(("tool", (call, result, None)))
            except BaseException as error:
                events.put(("tool", (call, None, error)))
        # Both kinds retain invocation context; blocking handlers remain a
        # continuation barrier even though an owned worker permits cancellation.
        import contextvars
        context = contextvars.copy_context()
        threading.Thread(target=context.run, args=(invoke,), daemon=True).start()

    def _updates(self):
        if not self.control:
            return
        from . import gen as core
        for update in self.control._pending(self.path, self._updates_after):
            self._updates_after = int(update["id"])
            if not core.chat_session_queue_update(self.state, update):
                continue
            timing = self.session.steer(update["text"]) if update["type"] == "steer" else self.session.set_thinking_token_budget(update["level"])
            if timing == "native":
                core.chat_session_native_update(self.state, update["id"])
            else:
                self._boundary_updates.append(update["id"])

    def _select(self, request):
        # The run's client is pinned on its first request. As in TS, the run
        # has started before its first request goes out.
        if self._selected:
            return
        self._emit_started()
        if self.control and self.control.signal.is_set():raise RuntimeError("Run aborted before selecting a provider")
        visited = set()
        while callable(getattr(self.client, "_pin_chat_run", None)):
            if id(self.client) in visited:raise RuntimeError("Cyclic run routing")
            visited.add(id(self.client))
            self.client = self.client._pin_chat_run(request, self.options)
        self._selected = True
        features = getattr(self.client,"get_features",lambda model=None:{})(request.get("model"))
        self._fallback = not (features.get("asyncTools") and callable(getattr(self.client,"open_chat_session",None)))

    def _fallback_request(self, request):
        # A pinned client without sessions takes the run's updates at the
        # request boundary.
        from . import gen as core
        if self.control and self.control.signal.is_set():raise RuntimeError("Run aborted before the next model request")
        updates=self.control._pending(self.path,self._fallback_after) if self.control else []
        if updates:self._fallback_after=max(int(update["id"]) for update in updates)
        applied=core.chat_session_apply_boundary_updates(request,updates,self._fallback_level)
        self._fallback_level=applied["level"]
        for identifier in applied["applied"]:self._emit("applied",update_id=identifier,timing="next-response")
        return applied["request"]

    def chat(self, request, options=None):
        self._select(request)
        if self._fallback:
            return self.client.chat(self._fallback_request(request),{**self.options,**(options or {})})
        for kind, item in self._run_session(request, options):
            if kind == "final":
                return item
        raise RuntimeError("Chat session ended without a response")

    def stream(self, request, options=None):
        # A streamed request yields the session's items for the streaming
        # forward: each partial response event, each response the session
        # continues from, and the final response.
        self._select(request)
        if self._fallback:
            handle = _core_ai_stream_open(self.client, self._fallback_request(request), {**self.options, **(options or {})})
            try:
                while True:
                    chunk = handle.next()
                    if chunk is None:
                        return
                    yield chunk
            finally:
                handle.close()
            return
        from . import gen as core
        for kind, item in self._run_session(request, options):
            info = {"type": kind, "turns": self.state["turns"]}
            if kind == "partial":
                info["response_id"] = item["response_id"]
                info["calls_started"] = bool(self.state["pending"])
                info["pending_calls"] = core.chat_session_unresolved(self.state)
                yield {"session": info, "results": item.get("response", {}).get("results", [])}
            elif kind == "completed":
                info["response_id"] = item
                yield {"session": info}
            else:
                info["response_id"] = self.state.get("response_id")
                final = {key: value for key, value in item.items() if not key.startswith("__session")}
                yield {**final, "session": info}

    def _run_session(self, request, options=None):
        # One model request in its own native session: yields ("partial",
        # event) for each partial response event, ("completed", response_id)
        # for each response it continues from, then ("final", response).
        from . import gen as core
        if self.control and self.control.signal.is_set():raise RuntimeError("Run aborted before opening a session")
        self._reset_session()
        session = self.client.open_chat_session(request, {**self.options, **(options or {})})
        self.session = session
        # As TS's maxResponses: the run's maxSteps (25 by default) less the
        # request's step.
        limit = int(self.options.get("max_steps", self.options.get("maxSteps", 25))) - int(request.get("_ax_step_index") or 0)
        self.state = core.chat_session_create_state(getattr(session,"model",request.get("model") or getattr(self.client,"model","")), self.path, limit)
        threading.Thread(target=self._bridge, args=(session, self._queue, self._cancel), daemon=True).start()
        try:
            while True:
                if self.control and self.control.signal.is_set():
                    raise RuntimeError(f"Run aborted; unresolved calls: {core.chat_session_unresolved(self.state)}")
                self._updates()
                try:
                    kind, event = self._queue.get(timeout=0.02)
                except queue.Empty:
                    kind, event = None, None
                if kind == "failure":
                    raise RuntimeError(f"Session failed; unresolved calls: {core.chat_session_unresolved(self.state)}: {event}") from event
                if kind == "tool":
                    call, result, error = event
                    if error:
                        message = core._tool_error_message_impl(call, error)
                        result = message.get("result", str(error))
                    if not core.chat_session_record_result(self.gen, self.state, call, result, error is None):
                        continue
                    self._emit("tool.completed", call_id=call["id"])
                    if self.state["pending"][call["id"]]["execution"] != "background":
                        self._blocking = False
                        queued, self._waiting_calls = self._waiting_calls, []
                        for queued_call in queued:
                            self._start(queued_call)
                if kind == "provider":
                    event_type = event["type"]
                    if event_type == "tool.call":
                        self._start(event["call"])
                    elif event_type == "response":
                        output = core.chat_session_observe_output(self.gen, self.state, event)
                        response = event["response"]
                        text = "".join(str(r.get("content", "")) for r in response.get("results", []))
                        response_id = event["response_id"]
                        self._response_text[response_id] = self._response_text.get(response_id, "") + text
                        if self._delta:
                            self._delta({**response, "version": self.state["version"]})
                        self._emit("model.output", **output)
                        yield "partial", event
                    elif event_type == "steering":
                        applied = core.chat_session_native_event(self.state, event)
                        if applied.get("applied_id"):
                            self._emit("applied", update_id=applied["applied_id"], timing="native")
                    elif event_type == "response.completed":
                        if core.chat_session_complete_response(self.state, event["response_id"]):
                            self._last_response = event["response"]
                            if self._delta and not self._response_text.get(event["response_id"]):
                                text = "".join(str(r.get("content", "")) for r in self._last_response.get("results", []))
                                if text:
                                    self._delta({**self._last_response, "version": self.state["version"]})
                            completion = core.chat_session_completion(self._last_response, event["response_id"])
                            for call in core._response_function_calls_impl(completion):
                                self._start(call)
                            if core.chat_session_has_continuation_work(self.state):
                                core.chat_session_record_response(self.gen, self.state, request, completion)
                            yield "completed", event["response_id"]
                action = core.chat_session_boundary_action(self.state)
                if action["type"] == "submit":
                    self._send_continuation(action["results"])
                elif action["type"] == "continue":
                    self._send_continuation([])
                elif action["type"] == "validate" and self._last_response is not None:
                    yield "final", core.chat_session_final_result(self.state, self._last_response)
                    return
        finally:
            self._close_session()

    def _close_session(self):
        self._cancel.set()
        session, self.session = self.session, None
        if session is not None:
            session.close()

    def _send_continuation(self, results):
        from . import gen as core
        if self.state["steps"] >= self.state["max_steps"]:
            raise core.chat_session_step_limit_error(self.state)
        updates = list(self._boundary_updates)
        if results:
            self.session.submit_tool_results(results)
        else:
            self.session.continue_response()
        core.chat_session_mark_submitted(self.state, [result["function_id"] for result in results])
        for update_id in updates:
            self._boundary_updates.remove(update_id)
            core.chat_session_transition(self.state, {"type": "update.applied", "id": update_id})
            self._emit("applied", update_id=update_id, timing="next-response")

    def close(self, error=None):
        self._close_session()
        pending = []
        if self.state:
            from .gen import chat_session_close_state, chat_session_record_unresolved
            chat_session_record_unresolved(self.gen, self.state)
            pending = chat_session_close_state(self.state)
        if isinstance(error, _StreamingConsumerStopped):
            # The consumer stopped the run early: it ended on purpose, as
            # with control.abort().
            self._emit("aborted")
            return
        self._emit("failed" if error else "completed", **({"error": str(error), "pending_call_ids": pending} if error else {}))


def _core_run_control_aborted(control):
    if isinstance(control, AxRunControl):
        return control.signal.is_set()
    return isinstance(control, dict) and bool(control.get("aborted"))
