"""Optional in-process QuickJS runtime profile for AxAgent.

Requires the ``quickjs`` wheel (``pip install axllm[runtime-quickjs]``). This gives the
agent a real JavaScript engine in-process: the executor stage writes JS, this engine runs
it, and ``final(...)`` / ``askClarification(...)`` produce the completion the agent loop
consumes -- the same contract the Go (goja) and other quickjs profiles satisfy.

    from axllm import agent
    from axllm.runtime_quickjs import AxQuickJsCodeRuntime

    runtime = AxQuickJsCodeRuntime().register_callable("search", lambda p: {"hits": []})
    qa = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    out = qa.forward(client, {"question": "..."}, {"runtime": runtime})
"""

from __future__ import annotations

import json
from typing import Any

from .agent import AxCodeRuntime, AxCodeSession

# JS prelude: defines the runtime primitives (final/askClarification/discover/recall/used/
# report*/guideAgent) which write a completion cell, plus the host-callable bridge. Helper
# names avoid a leading underscore so they read as JS, not python helpers.
_PRELUDE = (
    "function axComplete(v){globalThis.__ax_completion=v;return v;}"
    "function final(){return axComplete({type:'final',args:Array.from(arguments)});}"
    "function askClarification(){return axComplete({type:'askClarification',args:Array.from(arguments)});}"
    "function discover(r){return axComplete({kind:'discover',discover:r});}"
    "function recall(r){return axComplete({kind:'recall',recall:r});}"
    "function used(i,reason){var p=(i&&typeof i==='object')?i:{id:i};if(reason!==undefined&&reason!==null)p.reason=String(reason);return axComplete({kind:'used',used:p});}"
    "function reportSuccess(m){return axComplete({kind:'status',status:{type:'success',message:String(m||'')}});}"
    "function reportFailure(m){return axComplete({kind:'status',status:{type:'failed',message:String(m||'')}});}"
    "function guideAgent(g){return axComplete({type:'guide_agent',guidance:String(g||'')});}"
    "function axHc(name){return function(params){var r=JSON.parse(globalThis.__ax_host_call(name,JSON.stringify(params===undefined?null:params)));if(r.ok)return r.result;return{kind:'error',is_error:true,error_category:String(r.category||'runtime'),error:String(r.error||('host callable failed: '+name))};};}"
    "function axSnap(){var o={};for(var k of Object.getOwnPropertyNames(globalThis)){if(k.indexOf('__ax_')===0)continue;var v=globalThis[k];if(typeof v==='function'||typeof v==='undefined')continue;try{JSON.stringify(v);o[k]=v;}catch(e){}}return JSON.stringify(o);}"
    # console: the executor inspects intermediate values with console.log; capture each
    # turn's output into __ax_logs so the host can surface it back into the action log.
    "function axLog(){var a=Array.prototype.slice.call(arguments);globalThis.__ax_logs.push(a.map(function(x){return (typeof x==='string')?x:(function(){try{return JSON.stringify(x);}catch(e){return String(x);}})();}).join(' '));}"
    "globalThis.console={log:axLog,error:axLog,warn:axLog,info:axLog,debug:axLog};"
)


class AxQuickJsCodeSession(AxCodeSession):
    def __init__(self, runtime, globals_, options=None):
        self.runtime = runtime
        self.closed = False
        self.ctx = runtime._quickjs.Context()
        self.ctx.add_callable("__ax_host_call", self._host_call)
        self.ctx.eval(_PRELUDE)
        for name in runtime.host_callables:
            self.ctx.eval("globalThis[%s]=axHc(%s);" % (json.dumps(name), json.dumps(name)))
        for key, value in (globals_ or {}).items():
            self.ctx.eval("globalThis[%s]=JSON.parse(%s);" % (json.dumps(key), json.dumps(json.dumps(value))))

    def _host_call(self, name, params_json):
        handler = self.runtime.host_callables.get(name)
        if handler is None:
            return json.dumps({"ok": False, "category": "runtime", "error": "unknown host callable: " + name})
        try:
            return json.dumps({"ok": True, "result": handler(json.loads(params_json))})
        except Exception as exc:
            return json.dumps({"ok": False, "category": "runtime", "error": str(exc)})

    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        if self.closed:
            return {"is_error": True, "error_category": "session_closed", "error": "session closed"}
        # The RLM prompt has the model write `await final(...)` / `await llmQuery(...)`, so the
        # code uses top-level await — illegal in a plain script eval. Run it inside an async IIFE
        # (await becomes legal) and drain the job queue so awaited continuations and the
        # synchronous host primitives that set __ax_completion actually run before we read it.
        self.ctx.eval(
            "globalThis.__ax_completion=undefined;globalThis.__ax_result=undefined;"
            "globalThis.__ax_error=undefined;globalThis.__ax_logs=[];"
        )
        wrapper = (
            "(async()=>{\n" + code + "\n})().then("
            "function(r){globalThis.__ax_result=r;},"
            "function(e){globalThis.__ax_error=String((e&&e.stack)?e.stack:e);});"
        )
        try:
            self.ctx.eval(wrapper)
            for _ in range(1000000):
                if not self.ctx.execute_pending_job():
                    break
        except Exception as exc:
            return {"kind": "error", "is_error": True, "error_category": "runtime", "error": str(exc)}
        err = self.ctx.eval("globalThis.__ax_error===undefined?null:globalThis.__ax_error")
        if err is not None:
            return {"kind": "error", "is_error": True, "error_category": "runtime", "error": str(err)}
        try:
            logs = json.loads(self.ctx.eval("JSON.stringify(globalThis.__ax_logs||[])"))
        except Exception:
            logs = []
        payload = json.loads(self.ctx.eval(
            "JSON.stringify(globalThis.__ax_completion!==undefined?globalThis.__ax_completion:"
            "{kind:'result',result:(globalThis.__ax_result===undefined?null:globalThis.__ax_result)});"
        ))
        if logs and isinstance(payload, dict):
            payload["logs"] = logs
        return payload

    def _snap(self):
        try:
            return json.loads(self.ctx.eval("axSnap();"))
        except Exception:
            return {}

    def inspect_globals(self, options=None):
        return self._snap()

    def snapshot_globals(self, options=None):
        g = self._snap()
        return {"version": 1, "entries": [{"name": k, "type": type(v).__name__, "preview": repr(v)} for k, v in g.items()], "bindings": g, "globals": g, "closed": self.closed}

    def patch_globals(self, snapshot, options=None):
        snap = snapshot or {}
        for key, value in (snap.get("bindings") or snap.get("globals") or {}).items():
            self.ctx.eval("globalThis[%s]=JSON.parse(%s);" % (json.dumps(key), json.dumps(json.dumps(value))))
        self.closed = bool(snap.get("closed", False))
        return self.snapshot_globals(options or {})

    def export_state(self, options=None):
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot, options=None):
        return self.patch_globals(snapshot or {}, options or {})

    def close(self):
        self.closed = True
        self.ctx = None
        return {"closed": True}


class AxQuickJsCodeRuntime(AxCodeRuntime):
    language = "JavaScript"

    def __init__(self):
        import quickjs

        self._quickjs = quickjs
        self.host_callables = {}

    def register_callable(self, name, handler):
        self.host_callables[name] = handler
        return self

    def get_usage_instructions(self) -> str:
        return "In-process QuickJS runtime. Use final(...), askClarification(...), and namespaced tools."

    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None):
        return AxQuickJsCodeSession(self, globals, options)
