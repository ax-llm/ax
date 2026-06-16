package goja

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	ax "github.com/ax-llm/ax/go"
	gojavm "github.com/dop251/goja"
)

type HostCallable func(ax.Value) (ax.Value, error)

type Option func(*Runtime)

type Runtime struct {
	mu            sync.RWMutex
	runtimePolicy map[string]ax.Value
	hostCallables map[string]HostCallable
}

type Session struct {
	mu              sync.Mutex
	vm              *gojavm.Runtime
	runtimePolicy   map[string]ax.Value
	reserved        map[string]bool
	reservedValues  map[string]ax.Value
	hostCallables   map[string]HostCallable
	markerCallables map[string]map[string]ax.Value
	completion      ax.Value
	closed          bool
	stdout          []string
	stderr          []string
}

func NewRuntime(options ...Option) *Runtime {
	r := &Runtime{
		runtimePolicy: defaultPolicy(nil),
		hostCallables: map[string]HostCallable{},
	}
	for _, option := range options {
		if option != nil {
			option(r)
		}
	}
	return r
}

func WithRuntimePolicy(policy map[string]ax.Value) Option {
	return func(r *Runtime) {
		r.runtimePolicy = mergePolicy(r.runtimePolicy, policy)
	}
}

func WithCallable(name string, handler HostCallable) Option {
	return func(r *Runtime) {
		r.RegisterCallable(name, handler)
	}
}

func (r *Runtime) RegisterCallable(name string, handler HostCallable) *Runtime {
	if strings.TrimSpace(name) == "" {
		panic("goja host callable name is required")
	}
	if handler == nil {
		panic("goja host callable handler is required")
	}
	if isBuiltInReservedName(name) {
		panic("goja host callable cannot replace reserved runtime primitive: " + name)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.hostCallables[name] = handler
	return r
}

func (r *Runtime) Language() string { return "JavaScript" }

func (r *Runtime) UsageInstructions() string {
	return "JavaScript goja runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), reportFailure(...), and guideAgent(...). Filesystem, network, process, module loading, and native host objects are not exposed by default."
}

func (r *Runtime) RuntimePolicy() map[string]ax.Value {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return cloneMap(r.runtimePolicy)
}

func (r *Runtime) CreateSession(globals map[string]ax.Value, options map[string]ax.Value) (ax.CodeSession, error) {
	r.mu.RLock()
	hostCallables := map[string]HostCallable{}
	for name, handler := range r.hostCallables {
		hostCallables[name] = handler
	}
	policy := cloneMap(r.runtimePolicy)
	r.mu.RUnlock()
	policy = mergePolicy(policy, asMap(valueFromMap(options, "runtimePolicy")))
	session := &Session{
		vm:              gojavm.New(),
		runtimePolicy:   policy,
		reserved:        builtinReservedNames(),
		reservedValues:  map[string]ax.Value{},
		hostCallables:   hostCallables,
		markerCallables: map[string]map[string]ax.Value{},
	}
	session.installFreezeHelper()
	for _, name := range asStringSlice(valueFromMap(options, "reservedNames")) {
		session.reserved[name] = true
	}
	if globals == nil {
		globals = map[string]ax.Value{}
	}
	for key, value := range globals {
		if strings.HasPrefix(key, "__ax_") {
			continue
		}
		if marker := hostCallableMarker(value); marker != nil {
			if session.reserved[key] || isBuiltInReservedName(key) {
				return nil, ax.AxError{Category: "runtime", Message: "goja host callable conflicts with reserved runtime name: " + key}
			}
			session.markerCallables[key] = marker
			session.reserved[key] = true
			continue
		}
		safe, ok := jsonSafe(value)
		if !ok {
			continue
		}
		if session.reserved[key] {
			session.reservedValues[key] = safe
			session.defineProtectedJSON(key, safe)
			continue
		}
		_ = session.vm.Set(key, session.toJSONValue(safe))
	}
	for name := range hostCallables {
		if session.reserved[name] {
			return nil, ax.AxError{Category: "runtime", Message: "goja host callable conflicts with reserved runtime name: " + name}
		}
		session.reserved[name] = true
	}
	session.installBuiltins()
	return session, nil
}

func (s *Session) Execute(code string, options map[string]ax.Value) ax.Value {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return runtimeError("session closed", "session_closed")
	}
	s.completion = nil
	s.installBuiltins()
	timeoutMs := intOption(valueFromMap(options, "timeoutMs"), intOption(valueFromMap(s.runtimePolicy, "timeoutMs"), 5000))
	var timer *time.Timer
	if timeoutMs > 0 {
		timer = time.AfterFunc(time.Duration(timeoutMs)*time.Millisecond, func() {
			s.vm.Interrupt("goja execution timed out")
		})
	}
	body, marshalErr := json.Marshal("with (globalThis) {\n" + code + "\n}")
	if marshalErr != nil {
		return runtimeError("goja actor code is not executable", "runtime")
	}
	// The RLM prompt has the model write `await final(...)` / `await llmQuery(...)`, so actor
	// code uses top-level await — illegal in a plain Function body. Compile it as an async
	// function (AsyncFunction constructor) instead; the synchronous host primitives that set
	// the completion run before the first await suspends, so the completion is captured.
	_, err := s.vm.RunString("(async function(){}).constructor(" + string(body) + ")();")
	if timer != nil && !timer.Stop() {
		s.vm.ClearInterrupt()
	}
	if err != nil {
		return runtimeError(err.Error(), errorCategory(err))
	}
	s.restoreReservedGlobals()
	s.installBuiltins()
	if s.completion == nil {
		return map[string]ax.Value{"kind": "result", "result": nil}
	}
	if safe, ok := jsonSafe(s.completion); ok {
		return safe
	}
	return runtimeError("goja actor output is not JSON-compatible", "runtime")
}

func (s *Session) Inspect(options map[string]ax.Value) ax.Value {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return runtimeError("session closed", "session_closed")
	}
	return s.snapshotBindings(false)
}

func (s *Session) SnapshotGlobals(options map[string]ax.Value) ax.Value {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return runtimeError("session closed", "session_closed")
	}
	bindings := s.snapshotBindings(true)
	return map[string]ax.Value{
		"version":  1,
		"bindings": bindings,
		"globals":  bindings,
		"closed":   false,
	}
}

func (s *Session) PatchGlobals(snapshot ax.Value, options map[string]ax.Value) ax.Value {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return runtimeError("session closed", "session_closed")
	}
	next := asMap(snapshot)
	if _, ok := next["bindings"]; ok {
		next = asMap(valueFromMap(next, "bindings"))
	}
	global := s.vm.GlobalObject()
	for _, key := range global.Keys() {
		if s.reserved[key] || strings.HasPrefix(key, "__ax_") {
			continue
		}
		_ = global.Delete(key)
	}
	for key, value := range next {
		if s.reserved[key] || strings.HasPrefix(key, "__ax_") || hostCallableMarker(value) != nil {
			continue
		}
		safe, ok := jsonSafe(value)
		if !ok {
			continue
		}
		_ = s.vm.Set(key, safe)
	}
	s.restoreReservedGlobals()
	s.installBuiltins()
	bindings := s.snapshotBindings(true)
	return map[string]ax.Value{
		"version":  1,
		"bindings": bindings,
		"globals":  bindings,
		"closed":   false,
	}
}

func (s *Session) Close() ax.Value {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return map[string]ax.Value{"closed": true}
}

func (s *Session) installBuiltins() {
	s.installFreezeHelper()
	console := s.vm.NewObject()
	_ = console.DefineDataProperty("log", s.vm.ToValue(func(values ...gojavm.Value) { s.appendDiagnostic(&s.stdout, values...) }), gojavm.FLAG_FALSE, gojavm.FLAG_FALSE, gojavm.FLAG_TRUE)
	_ = console.DefineDataProperty("error", s.vm.ToValue(func(values ...gojavm.Value) { s.appendDiagnostic(&s.stderr, values...) }), gojavm.FLAG_FALSE, gojavm.FLAG_FALSE, gojavm.FLAG_TRUE)
	s.defineProtected("console", console)
	s.setPrimitive("final", func(args []ax.Value) ax.Value {
		return map[string]ax.Value{"type": "final", "args": args}
	})
	s.setPrimitive("askClarification", func(args []ax.Value) ax.Value {
		return map[string]ax.Value{"type": "askClarification", "args": args}
	})
	s.setPrimitive("discover", func(args []ax.Value) ax.Value {
		var request ax.Value
		if len(args) > 0 {
			request = args[0]
		}
		return map[string]ax.Value{"kind": "discover", "discover": request}
	})
	s.setPrimitive("recall", func(args []ax.Value) ax.Value {
		var request ax.Value
		if len(args) > 0 {
			request = args[0]
		}
		return map[string]ax.Value{"kind": "recall", "recall": request}
	})
	s.setPrimitive("used", func(args []ax.Value) ax.Value {
		payload := map[string]ax.Value{}
		if len(args) > 0 {
			if raw := asMap(args[0]); len(raw) > 0 {
				for key, value := range raw {
					payload[key] = value
				}
			} else {
				payload["id"] = args[0]
			}
		}
		if len(args) > 1 && args[1] != nil {
			payload["reason"] = fmt.Sprint(args[1])
		}
		return map[string]ax.Value{"kind": "used", "used": payload}
	})
	s.setPrimitive("reportSuccess", func(args []ax.Value) ax.Value {
		message := ""
		if len(args) > 0 {
			message = fmt.Sprint(args[0])
		}
		return map[string]ax.Value{"kind": "status", "status": map[string]ax.Value{"type": "success", "message": message}}
	})
	s.setPrimitive("reportFailure", func(args []ax.Value) ax.Value {
		message := ""
		if len(args) > 0 {
			message = fmt.Sprint(args[0])
		}
		return map[string]ax.Value{"kind": "status", "status": map[string]ax.Value{"type": "failed", "message": message}}
	})
	s.setPrimitive("guideAgent", func(args []ax.Value) ax.Value {
		guidance := ""
		if len(args) > 0 {
			guidance = fmt.Sprint(args[0])
		}
		return map[string]ax.Value{"type": "guide_agent", "guidance": guidance}
	})
	for name, handler := range s.hostCallables {
		h := handler
		s.defineProtected(name, s.vm.ToValue(func(call gojavm.FunctionCall) gojavm.Value {
			var params ax.Value
			if len(call.Arguments) > 0 {
				params = normalizeExport(call.Arguments[0].Export())
			}
			result, err := h(params)
			if err != nil {
				return s.vm.ToValue(runtimeError(err.Error(), "runtime"))
			}
			safe, ok := jsonSafe(result)
			if !ok {
				return s.vm.ToValue(runtimeError("host callable returned a non-JSON-compatible value", "runtime"))
			}
			return s.vm.ToValue(safe)
		}))
	}
	for name, marker := range s.markerCallables {
		spec := marker
		callableName := name
		s.defineProtected(callableName, s.vm.ToValue(func(call gojavm.FunctionCall) gojavm.Value {
			if errObj := asMap(valueFromMap(spec, "error")); len(errObj) > 0 {
				category := stringOption(valueFromMap(errObj, "category"), "runtime")
				message := stringOption(valueFromMap(errObj, "message"), stringOption(valueFromMap(errObj, "error"), "host callable failed: "+callableName))
				return s.vm.ToValue(runtimeError(message, category))
			}
			if result, ok := spec["result"]; ok {
				safe, _ := jsonSafe(result)
				return s.vm.ToValue(safe)
			}
			return s.vm.ToValue(map[string]ax.Value{"kind": "result", "result": nil})
		}))
	}
}

func (s *Session) setPrimitive(name string, builder func([]ax.Value) ax.Value) {
	s.defineProtected(name, s.vm.ToValue(func(call gojavm.FunctionCall) gojavm.Value {
		args := make([]ax.Value, 0, len(call.Arguments))
		for _, arg := range call.Arguments {
			args = append(args, normalizeExport(arg.Export()))
		}
		s.completion = builder(args)
		return s.vm.ToValue(s.completion)
	}))
}

func (s *Session) appendDiagnostic(target *[]string, values ...gojavm.Value) {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, fmt.Sprint(normalizeExport(value.Export())))
	}
	*target = append(*target, strings.Join(parts, " "))
	limit := intOption(valueFromMap(s.runtimePolicy, "maxDiagnosticsBytes"), 16384)
	for len(strings.Join(*target, "\n")) > limit && len(*target) > 0 {
		*target = (*target)[1:]
	}
}

func (s *Session) restoreReservedGlobals() {
	for name, value := range s.reservedValues {
		s.defineProtectedJSON(name, value)
	}
}

func (s *Session) snapshotBindings(applyLimit bool) map[string]ax.Value {
	out := map[string]ax.Value{}
	global := s.vm.GlobalObject()
	for _, key := range global.Keys() {
		if s.reserved[key] || strings.HasPrefix(key, "__ax_") || isBuiltInReservedName(key) {
			continue
		}
		value := global.Get(key)
		if gojavm.IsUndefined(value) || gojavm.IsNull(value) {
			continue
		}
		if _, ok := gojavm.AssertFunction(value); ok {
			continue
		}
		safe, ok := jsonSafe(normalizeExport(value.Export()))
		if ok {
			out[key] = safe
		}
	}
	if len(s.stdout) > 0 {
		out["__ax_stdout"] = append([]string(nil), s.stdout...)
	}
	if len(s.stderr) > 0 {
		out["__ax_stderr"] = append([]string(nil), s.stderr...)
	}
	if applyLimit {
		maxBytes := intOption(valueFromMap(s.runtimePolicy, "maxSnapshotBytes"), 262144)
		encoded, _ := json.Marshal(out)
		if len(encoded) > maxBytes {
			trimmed := map[string]ax.Value{}
			keys := make([]string, 0, len(out))
			for key := range out {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				trimmed[key] = out[key]
				data, _ := json.Marshal(trimmed)
				if len(data) > maxBytes {
					delete(trimmed, key)
					trimmed["__ax_snapshot_truncated"] = true
					return trimmed
				}
			}
		}
	}
	return out
}

func (s *Session) installFreezeHelper() {
	if _, ok := gojavm.AssertFunction(s.vm.Get("__ax_deepFreeze")); ok {
		return
	}
	_, _ = s.vm.RunString(`
function __ax_deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.getOwnPropertyNames(value)) {
			__ax_deepFreeze(value[key]);
		}
	}
	return value;
}
`)
	if helper := s.vm.Get("__ax_deepFreeze"); !gojavm.IsUndefined(helper) {
		s.defineProtected("__ax_deepFreeze", helper)
	}
}

func (s *Session) defineProtected(name string, value gojavm.Value) {
	_ = s.vm.GlobalObject().DefineDataProperty(name, value, gojavm.FLAG_FALSE, gojavm.FLAG_FALSE, gojavm.FLAG_FALSE)
}

func (s *Session) defineProtectedJSON(name string, value ax.Value) {
	s.defineProtected(name, s.deepFreezeValue(s.toJSONValue(value)))
}

func (s *Session) toJSONValue(value ax.Value) gojavm.Value {
	safe, ok := jsonSafe(value)
	if !ok {
		return gojavm.Undefined()
	}
	data, err := json.Marshal(safe)
	if err != nil {
		return gojavm.Undefined()
	}
	quoted, err := json.Marshal(string(data))
	if err != nil {
		return gojavm.Undefined()
	}
	parsed, err := s.vm.RunString("JSON.parse(" + string(quoted) + ")")
	if err != nil {
		return gojavm.Undefined()
	}
	return parsed
}

func (s *Session) deepFreezeValue(value gojavm.Value) gojavm.Value {
	s.installFreezeHelper()
	fn, ok := gojavm.AssertFunction(s.vm.Get("__ax_deepFreeze"))
	if !ok {
		return value
	}
	frozen, err := fn(gojavm.Undefined(), value)
	if err != nil {
		return value
	}
	return frozen
}

func defaultPolicy(overrides map[string]ax.Value) map[string]ax.Value {
	policy := map[string]ax.Value{
		"allowFilesystem":       false,
		"allowNetwork":          false,
		"allowProcess":          false,
		"allowNativeHostAccess": false,
		"allowModuleLoading":    false,
		"maxSnapshotBytes":      262144,
		"maxDiagnosticsBytes":   16384,
		"timeoutMs":             5000,
	}
	for key, value := range overrides {
		policy[key] = value
	}
	return policy
}

func mergePolicy(base map[string]ax.Value, override map[string]ax.Value) map[string]ax.Value {
	policy := defaultPolicy(base)
	for key, value := range override {
		policy[key] = value
	}
	return policy
}

func builtinReservedNames() map[string]bool {
	names := map[string]bool{}
	for name := range builtinReservedNameSet {
		names[name] = true
	}
	return names
}

var builtinReservedNameSet = func() map[string]bool {
	names := map[string]bool{}
	for _, name := range []string{
		"Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
		"undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
		"AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
		"URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
		"isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
		"console", "inputs", "final", "askClarification", "discover", "recall", "used", "reportSuccess",
		"reportFailure", "guideAgent", "fetch", "require", "process", "module", "exports",
		"prototype", "__proto__", "constructor", "__ax_deepFreeze",
	} {
		names[name] = true
	}
	return names
}()

func isBuiltInReservedName(name string) bool { return builtinReservedNameSet[name] }

func hostCallableMarker(value ax.Value) map[string]ax.Value {
	marker := asMap(value)
	if marker["__ax_host_callable"] == true || marker["native"] == true {
		return marker
	}
	return nil
}

func runtimeError(message string, category string) map[string]ax.Value {
	if category == "" {
		category = "runtime"
	}
	return map[string]ax.Value{"kind": "error", "is_error": true, "error_category": category, "error": message}
}

func errorCategory(err error) string {
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "timeout") || strings.Contains(text, "timed out") || strings.Contains(text, "interrupted") {
		return "timeout"
	}
	return "runtime"
}

func valueFromMap(values map[string]ax.Value, key string) ax.Value {
	if values == nil {
		return nil
	}
	return values[key]
}

func cloneMap(values map[string]ax.Value) map[string]ax.Value {
	out := map[string]ax.Value{}
	for key, value := range values {
		out[key] = value
	}
	return out
}

func asMap(value ax.Value) map[string]ax.Value {
	if value == nil {
		return map[string]ax.Value{}
	}
	if values, ok := value.(map[string]ax.Value); ok {
		out := map[string]ax.Value{}
		for key, item := range values {
			out[key] = normalizeExport(item)
		}
		return out
	}
	return map[string]ax.Value{}
}

func asStringSlice(value ax.Value) []string {
	switch values := value.(type) {
	case []string:
		return append([]string(nil), values...)
	case []ax.Value:
		out := make([]string, 0, len(values))
		for _, item := range values {
			out = append(out, fmt.Sprint(item))
		}
		return out
	default:
		return nil
	}
}

func intOption(value ax.Value, fallback int) int {
	switch v := value.(type) {
	case int:
		if v > 0 {
			return v
		}
	case int64:
		if v > 0 {
			return int(v)
		}
	case float64:
		if v > 0 {
			return int(v)
		}
	case string:
		var parsed int
		if _, err := fmt.Sscanf(v, "%d", &parsed); err == nil && parsed > 0 {
			return parsed
		}
	}
	return fallback
}

func stringOption(value ax.Value, fallback string) string {
	if value == nil {
		return fallback
	}
	text := fmt.Sprint(value)
	if text == "" {
		return fallback
	}
	return text
}

func normalizeExport(value any) ax.Value {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return value
	}
	return parsed
}

func jsonSafe(value ax.Value) (ax.Value, bool) {
	normalized := normalizeExport(value)
	data, err := json.Marshal(normalized)
	if err != nil {
		return nil, false
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, false
	}
	return parsed, true
}
