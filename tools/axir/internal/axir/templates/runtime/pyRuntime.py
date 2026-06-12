from __future__ import annotations

import json
import os
import shlex
import subprocess
import threading
from dataclasses import dataclass
from typing import Any


@dataclass
class RuntimeCapabilities:
    inspect: bool = True
    snapshot: bool = True
    patch: bool = True
    abort: bool = False
    language: str = "JavaScript"
    usage_instructions: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "inspect": self.inspect,
            "snapshot": self.snapshot,
            "patch": self.patch,
            "abort": self.abort,
            "language": self.language,
            "usage_instructions": self.usage_instructions,
        }


class RuntimeEnvelope:
    @staticmethod
    def result(value: Any) -> dict[str, Any]:
        return {"kind": "result", "result": value}

    @staticmethod
    def error(message: str, category: str = "runtime") -> dict[str, Any]:
        return {"kind": "error", "is_error": True, "error_category": category, "error": str(message)}

    @staticmethod
    def session_closed(message: str = "session closed") -> dict[str, Any]:
        return RuntimeEnvelope.error(message, "session_closed")

    @staticmethod
    def timeout(message: str = "execution timed out") -> dict[str, Any]:
        return RuntimeEnvelope.error(message, "timeout")

    @staticmethod
    def final(*args: Any) -> dict[str, Any]:
        payload = list(args)
        if len(payload) == 1 and isinstance(payload[0], list):
            payload = list(payload[0])
        return {"type": "final", "args": payload}

    @staticmethod
    def ask_clarification(*args: Any) -> dict[str, Any]:
        payload = list(args)
        if len(payload) == 1 and isinstance(payload[0], list):
            payload = list(payload[0])
        return {"type": "askClarification", "args": payload}

    @staticmethod
    def discover(request: Any) -> dict[str, Any]:
        return {"kind": "discover", "discover": request}

    @staticmethod
    def recall(request: Any) -> dict[str, Any]:
        return {"kind": "recall", "recall": request}

    @staticmethod
    def used(request: Any, reason: str | None = None, stage: str | None = None) -> dict[str, Any]:
        if isinstance(request, dict):
            payload = dict(request)
        else:
            payload = {"id": request}
        if reason is not None:
            payload["reason"] = reason
        if stage is not None:
            payload["stage"] = stage
        return {"kind": "used", "used": payload}

    @staticmethod
    def status(status_type: str, message: str = "", **extra: Any) -> dict[str, Any]:
        payload = {"type": status_type, "message": message}
        payload.update(extra)
        return {"kind": "status", "status": payload}

    @staticmethod
    def guide_agent(guidance: str, triggered_by: str | None = None) -> dict[str, Any]:
        payload = {"type": "guide_agent", "guidance": guidance}
        if triggered_by is not None:
            payload["triggeredBy"] = triggered_by
        return payload


class RuntimeProtocolError(RuntimeError):
    def __init__(self, message: str, category: str = "runtime"):
        super().__init__(message)
        self.category = category


class ProcessCodeRuntime:
    language = "JavaScript"

    def __init__(
        self,
        command: list[str] | str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ):
        argv = shlex.split(command) if isinstance(command, str) else list(command)
        if not argv:
            raise ValueError("ProcessCodeRuntime requires a command")
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        self._process = subprocess.Popen(
            argv,
            cwd=cwd,
            env=merged_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._lock = threading.Lock()
        self._next_id = 0

    def get_usage_instructions(self) -> str:
        try:
            response = self._request("capabilities", None, {})
            result = response.get("result") or {}
            if isinstance(result, dict):
                return str(result.get("usage_instructions") or "")
        except Exception:
            return ""
        return ""

    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None):
        response = self._request("create_session", None, {"globals": globals or {}, "options": options or {}})
        session_id = response.get("session_id")
        result = response.get("result")
        if not session_id and isinstance(result, dict):
            session_id = result.get("session_id")
        if not session_id:
            raise RuntimeError("runtime protocol did not return a session_id")
        return ProcessCodeSession(self, str(session_id))

    def shutdown(self):
        if self._process.poll() is None:
            try:
                self._request("shutdown", None, {})
            finally:
                try:
                    self._process.terminate()
                except ProcessLookupError:
                    pass

    def _request(self, op: str, session_id: str | None, payload: dict[str, Any] | None) -> dict[str, Any]:
        with self._lock:
            self._next_id += 1
            message: dict[str, Any] = {"id": str(self._next_id), "op": op, "payload": payload or {}}
            if session_id is not None:
                message["session_id"] = session_id
            if self._process.stdin is None or self._process.stdout is None:
                raise RuntimeError("runtime protocol process is closed")
            self._process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            self._process.stdin.flush()
            line = self._process.stdout.readline()
            if not line:
                raise RuntimeError(self._closed_without_response_message())
            try:
                response = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"runtime protocol invalid JSON response: {exc.msg}") from exc
            if not isinstance(response, dict):
                raise RuntimeError("runtime protocol response must be an object")
            if str(response.get("id")) != str(message["id"]):
                raise RuntimeError("runtime protocol response id mismatch")
            if session_id is not None and response.get("session_id") not in (None, session_id):
                raise RuntimeError("runtime protocol session_id mismatch")
            if response.get("ok") is False:
                error = response.get("error") if isinstance(response.get("error"), dict) else {}
                raise RuntimeProtocolError(
                    str(error.get("message") or "runtime protocol error"),
                    str(error.get("category") or "runtime"),
                )
            return response

    def _closed_without_response_message(self) -> str:
        code = self._process.poll()
        if code is None:
            try:
                code = self._process.wait(timeout=0.1)
            except subprocess.TimeoutExpired:
                code = None
        message = "runtime protocol process closed without a response"
        if code is not None:
            message += f" (exit code {code})"
            stderr_text = ""
            if self._process.stderr is not None:
                try:
                    stderr_text = self._process.stderr.read().strip()
                except Exception:
                    stderr_text = ""
            if stderr_text:
                message += f": {stderr_text}"
        return message


class ProcessCodeSession:
    def __init__(self, runtime: ProcessCodeRuntime, session_id: str):
        self._runtime = runtime
        self._session_id = session_id

    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        try:
            return self._runtime._request(
                "execute",
                self._session_id,
                {"code": str(code), "options": options or {}},
            ).get("result")
        except RuntimeProtocolError as exc:
            return RuntimeEnvelope.error(str(exc), exc.category)
        except RuntimeError as exc:
            return RuntimeEnvelope.error(str(exc), "runtime")

    def inspect_globals(self, options: dict[str, Any] | None = None) -> Any:
        return self._runtime._request("inspect_globals", self._session_id, options or {}).get("result")

    def snapshot_globals(self, options: dict[str, Any] | None = None) -> Any:
        return self._runtime._request("snapshot_globals", self._session_id, options or {}).get("result")

    def patch_globals(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> Any:
        return self._runtime._request(
            "patch_globals",
            self._session_id,
            {"globals": globals or {}, "options": options or {}},
        ).get("result")

    def export_state(self, options: dict[str, Any] | None = None) -> Any:
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        return self.patch_globals(snapshot or {}, options or {})

    def close(self) -> Any:
        return self._runtime._request("close", self._session_id, {}).get("result")
