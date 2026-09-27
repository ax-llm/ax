package goja

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	ax "github.com/ax-llm/ax/packages/go"
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
	// turnLogs collects this turn's console output. The axir step normalizer
	// reads it off the result as `logs` and joins it into the output the model
	// sees, which is the entire observation loop of the REPL contract: without
	// it, console.log runs, captures into the session snapshot, and the model
	// is never shown a byte — measured downstream as blind re-fetching of
	// results already in hand. Reset each Execute; the TS, Python and C++
	// runtimes all surface per-turn logs this way.
	turnLogs []string
	// baseline names the globals present before the agent's code ran; the
	// snapshot entries leave them out, as TS's AxJSRuntime does.
	baseline []string
}

// usageInstructions is TypeScript's AxJSRuntime.getUsageInstructions() in its
// default stdout mode.
const usageInstructions = "- Don't wrap async code in (async()=>{ ... })() \u2014 the runtime automatically handles async execution.\n" +
	"- State is session-scoped: all top-level declarations (`var`, `let`, `const`) persist across calls.\n" +
	"- Bare assignment (e.g. `x = 1`) also persists via `globalThis`.\n" +
	"- Use `console.log(...)` output is captured as the execution result so use it to inspect intermediate values between steps instead of `return`."


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

// RegisterHostCallable is a structural adapter for the agent wrapper, which
// cannot import this package (import cycle: goja imports axllm). The parameter
// is the literal func type func(ax.Value)(ax.Value,error) — identical to
// axllm's func(Value)(Value,error) since both Value aliases resolve to any — so
// the wrapper can register the built-in llmQuery primitive through a
// duck-typed interface without naming *goja.Runtime.
func (r *Runtime) RegisterHostCallable(name string, handler func(ax.Value) (ax.Value, error)) {
	r.RegisterCallable(name, HostCallable(handler))
}

func (r *Runtime) Language() string { return "JavaScript" }

func (r *Runtime) UsageInstructions() string {
	return usageInstructions
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
		// Reject only names the runtime itself installs (JS built-ins and
		// bootstrap primitives like final). Agent-declared reserved names such
		// as llmQuery are meant to be host-provided, so a host callable
		// claiming one is the provisioning mechanism, not a conflict — matching
		// the Python reference runtime.
		if isBuiltInReservedName(name) {
			return nil, ax.AxError{Category: "runtime", Message: "goja host callable conflicts with reserved runtime name: " + name}
		}
		session.reserved[name] = true
	}
	session.installBuiltins()
    if _, err := session.vm.RunString("var __ax_host_namespaces = Object.create(null);\nfunction __ax_bind_host_namespaces() {\n  const roots = [];\n  for (const name of Object.getOwnPropertyNames(globalThis)) {\n    if (name.indexOf('.') < 0) continue;\n    const callable = Object.getOwnPropertyDescriptor(globalThis, name);\n    if (!callable || typeof callable.value !== 'function') continue;\n    const parts = name.split('.');\n    if (parts.some(part => !part)) {\n      throw new Error('Invalid host callable namespace: ' + name);\n    }\n    let target = globalThis;\n    let path = '';\n    for (let index = 0; index < parts.length - 1; index++) {\n      const part = parts[index];\n      path += (index ? '.' : '') + part;\n      let entry = Object.getOwnPropertyDescriptor(target, part);\n      if (!entry) {\n        const value = Object.create(null);\n        Object.defineProperty(target, part, {value, enumerable: true});\n        __ax_host_namespaces[path] = value;\n        entry = {value};\n      }\n      if (entry.value !== __ax_host_namespaces[path]) {\n        throw new Error('Host callable namespace conflicts with a global: ' + path);\n      }\n      target = entry.value;\n    }\n    const leaf = parts[parts.length - 1];\n    const existing = Object.getOwnPropertyDescriptor(target, leaf);\n    if (existing && existing.value !== callable.value) {\n      throw new Error('Host callable name conflicts with a namespace: ' + name);\n    }\n    if (!existing) Object.defineProperty(target, leaf, {value: callable.value, enumerable: true});\n    if (roots.indexOf(parts[0]) < 0) roots.push(parts[0]);\n  }\n  if (Array.isArray(globalThis.__ax_session_reserved)) {\n    for (const root of roots) {\n      if (globalThis.__ax_session_reserved.indexOf(root) < 0) globalThis.__ax_session_reserved.push(root);\n    }\n  }\n  return roots;\n}\n"); err != nil { return nil, err }
    if _, err := session.vm.RunString("__ax_bind_host_namespaces()"); err != nil { return nil, err }
    for name := range hostCallables { if strings.Contains(name, ".") { session.reserved[strings.SplitN(name,".",2)[0]]=true } }
	// TypeScript's action-log code analysis and snapshot entries, shared by
	// the ports' JavaScript runtimes (scripts/axir-runtime-support.mjs).
	if _, err := session.vm.RunString("// Generated by scripts/axir-runtime-support.mjs from\n// src/ax/util/jsAnalysis.ts, src/ax/agent/contextManager.ts and\n// src/ax/funcs/worker.runtime.ts. Do not edit by hand.\n(function () {\nfunction isIdentifierChar(ch) {\n  return !!ch && /[A-Za-z0-9_$]/.test(ch);\n}\nfunction isIdentifierStart(ch) {\n  return !!ch && /[A-Za-z_$]/.test(ch);\n}\nfunction stripJsStringsAndComments(code) {\n  var _a, _b;\n  let out = \"\";\n  let i = 0;\n  let state = \"normal\";\n  let escaped = false;\n  while (i < code.length) {\n    const ch = (_a = code[i]) != null ? _a : \"\";\n    const next = (_b = code[i + 1]) != null ? _b : \"\";\n    if (state === \"lineComment\") {\n      if (ch === \"\\n\") {\n        out += \"\\n\";\n        state = \"normal\";\n      } else {\n        out += \" \";\n      }\n      i++;\n      continue;\n    }\n    if (state === \"blockComment\") {\n      if (ch === \"*\" && next === \"/\") {\n        out += \"  \";\n        i += 2;\n        state = \"normal\";\n      } else {\n        out += ch === \"\\n\" ? \"\\n\" : \" \";\n        i++;\n      }\n      continue;\n    }\n    if (state === \"single\" || state === \"double\" || state === \"template\") {\n      const quote = state === \"single\" ? \"'\" : state === \"double\" ? '\"' : \"`\";\n      if (escaped) {\n        out += ch === \"\\n\" ? \"\\n\" : \" \";\n        escaped = false;\n        i++;\n        continue;\n      }\n      if (ch === \"\\\\\") {\n        out += \" \";\n        escaped = true;\n        i++;\n        continue;\n      }\n      if (ch === quote) {\n        out += \" \";\n        state = \"normal\";\n        i++;\n        continue;\n      }\n      out += ch === \"\\n\" ? \"\\n\" : \" \";\n      i++;\n      continue;\n    }\n    if (ch === \"/\" && next === \"/\") {\n      out += \"  \";\n      i += 2;\n      state = \"lineComment\";\n      continue;\n    }\n    if (ch === \"/\" && next === \"*\") {\n      out += \"  \";\n      i += 2;\n      state = \"blockComment\";\n      continue;\n    }\n    if (ch === \"'\") {\n      out += \" \";\n      i++;\n      state = \"single\";\n      continue;\n    }\n    if (ch === '\"') {\n      out += \" \";\n      i++;\n      state = \"double\";\n      continue;\n    }\n    if (ch === \"`\") {\n      out += \" \";\n      i++;\n      state = \"template\";\n      continue;\n    }\n    out += ch;\n    i++;\n  }\n  return out;\n}\nfunction extractTopLevelDeclaredNames(code) {\n  const names = [];\n  const len = code.length;\n  let i = 0;\n  let braceDepth = 0;\n  let parenDepth = 0;\n  const skipString = (quote) => {\n    i++;\n    if (quote === \"`\") {\n      let templateDepth = 0;\n      while (i < len) {\n        const ch = code[i];\n        if (ch === \"\\\\\") {\n          i += 2;\n          continue;\n        }\n        if (templateDepth > 0) {\n          if (ch === \"{\") {\n            templateDepth++;\n          } else if (ch === \"}\") {\n            templateDepth--;\n          }\n          i++;\n          continue;\n        }\n        if (ch === \"$\" && i + 1 < len && code[i + 1] === \"{\") {\n          templateDepth++;\n          i += 2;\n          continue;\n        }\n        if (ch === \"`\") {\n          i++;\n          return;\n        }\n        i++;\n      }\n      return;\n    }\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \"\\\\\") {\n        i += 2;\n        continue;\n      }\n      if (ch === quote) {\n        i++;\n        return;\n      }\n      i++;\n    }\n  };\n  const skipLineComment = () => {\n    i += 2;\n    while (i < len && code[i] !== \"\\n\") {\n      i++;\n    }\n  };\n  const skipBlockComment = () => {\n    i += 2;\n    while (i < len) {\n      if (code[i] === \"*\" && i + 1 < len && code[i + 1] === \"/\") {\n        i += 2;\n        return;\n      }\n      i++;\n    }\n  };\n  const readWord = () => {\n    const start = i;\n    while (i < len && isIdentifierChar(code[i])) {\n      i++;\n    }\n    return code.slice(start, i);\n  };\n  const skipWhitespace = () => {\n    const start = i;\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \" \" || ch === \"\t\" || ch === \"\\n\" || ch === \"\\r\") {\n        i++;\n        continue;\n      }\n      if (ch === \"/\" && i + 1 < len) {\n        if (code[i + 1] === \"/\") {\n          skipLineComment();\n          continue;\n        }\n        if (code[i + 1] === \"*\") {\n          skipBlockComment();\n          continue;\n        }\n      }\n      break;\n    }\n    return i > start;\n  };\n  const extractDestructuredNames = (close) => {\n    let depth = 1;\n    while (i < len && depth > 0) {\n      skipWhitespace();\n      if (i >= len) return;\n      const ch = code[i];\n      if (ch === close) {\n        depth--;\n        i++;\n        continue;\n      }\n      if (ch === \"{\" || ch === \"[\") {\n        const nestedClose = ch === \"{\" ? \"}\" : \"]\";\n        i++;\n        extractDestructuredNames(nestedClose);\n        continue;\n      }\n      if (ch === \".\" && i + 2 < len && code[i + 1] === \".\" && code[i + 2] === \".\") {\n        i += 3;\n        skipWhitespace();\n        if (i < len && isIdentifierChar(code[i])) {\n          const name = readWord();\n          if (name) names.push(name);\n        }\n        continue;\n      }\n      if (ch === \",\") {\n        i++;\n        continue;\n      }\n      if (ch === \"=\") {\n        i++;\n        let eqDepth = 0;\n        while (i < len) {\n          const current = code[i];\n          if (current === \"'\" || current === '\"' || current === \"`\") {\n            skipString(current);\n            continue;\n          }\n          if (current === \"(\" || current === \"[\" || current === \"{\") {\n            eqDepth++;\n            i++;\n            continue;\n          }\n          if (current === \")\" || current === \"]\" || current === \"}\") {\n            if (eqDepth > 0) {\n              eqDepth--;\n              i++;\n              continue;\n            }\n            break;\n          }\n          if (current === \",\" && eqDepth === 0) {\n            break;\n          }\n          i++;\n        }\n        continue;\n      }\n      if (isIdentifierChar(ch)) {\n        const word = readWord();\n        skipWhitespace();\n        if (i < len && code[i] === \":\") {\n          i++;\n          skipWhitespace();\n          if (i < len) {\n            const current = code[i];\n            if (current === \"{\" || current === \"[\") {\n              const nestedClose = current === \"{\" ? \"}\" : \"]\";\n              i++;\n              extractDestructuredNames(nestedClose);\n            } else if (isIdentifierChar(current)) {\n              const renamed = readWord();\n              if (renamed) names.push(renamed);\n            }\n          }\n        } else if (word) {\n          names.push(word);\n        }\n        continue;\n      }\n      i++;\n    }\n  };\n  const skipToCommaOrEnd = () => {\n    let depth = 0;\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \"'\" || ch === '\"' || ch === \"`\") {\n        skipString(ch);\n        continue;\n      }\n      if (ch === \"/\" && i + 1 < len) {\n        if (code[i + 1] === \"/\") {\n          skipLineComment();\n          continue;\n        }\n        if (code[i + 1] === \"*\") {\n          skipBlockComment();\n          continue;\n        }\n      }\n      if (ch === \"(\" || ch === \"[\" || ch === \"{\") {\n        depth++;\n        i++;\n        continue;\n      }\n      if (ch === \")\" || ch === \"]\" || ch === \"}\") {\n        if (depth > 0) {\n          depth--;\n          i++;\n          continue;\n        }\n        return false;\n      }\n      if (ch === \",\" && depth === 0) {\n        i++;\n        return true;\n      }\n      if (ch === \";\" && depth === 0) {\n        i++;\n        return false;\n      }\n      if (ch === \"\\n\" && depth === 0) {\n        const savedIndex = i;\n        i++;\n        skipWhitespace();\n        if (i < len && code[i] === \",\") {\n          i++;\n          return true;\n        }\n        i = savedIndex;\n        return false;\n      }\n      i++;\n    }\n    return false;\n  };\n  const extractBindings = () => {\n    while (i < len) {\n      skipWhitespace();\n      if (i >= len) return;\n      const ch = code[i];\n      if (ch === \"{\") {\n        i++;\n        extractDestructuredNames(\"}\");\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      if (ch === \"[\") {\n        i++;\n        extractDestructuredNames(\"]\");\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      if (isIdentifierChar(ch)) {\n        const name = readWord();\n        if (name) names.push(name);\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      return;\n    }\n  };\n  const isStatementBoundary = (pos) => {\n    if (pos === 0) return true;\n    let j = pos - 1;\n    while (j >= 0) {\n      const ch = code[j];\n      if (ch === \" \" || ch === \"\t\" || ch === \"\\r\") {\n        j--;\n        continue;\n      }\n      return ch === \"\\n\" || ch === \";\" || ch === \"{\" || ch === \"}\";\n    }\n    return true;\n  };\n  while (i < len) {\n    const ch = code[i];\n    if (ch === \"'\" || ch === '\"' || ch === \"`\") {\n      skipString(ch);\n      continue;\n    }\n    if (ch === \"/\" && i + 1 < len) {\n      if (code[i + 1] === \"/\") {\n        skipLineComment();\n        continue;\n      }\n      if (code[i + 1] === \"*\") {\n        skipBlockComment();\n        continue;\n      }\n    }\n    if (ch === \"{\") {\n      braceDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \"}\") {\n      braceDepth--;\n      i++;\n      continue;\n    }\n    if (ch === \"(\") {\n      parenDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \")\") {\n      parenDepth--;\n      i++;\n      continue;\n    }\n    if (braceDepth === 0 && parenDepth === 0 && isIdentifierChar(ch)) {\n      const wordStart = i;\n      const word = readWord();\n      if ((word === \"var\" || word === \"let\" || word === \"const\") && i < len && (code[i] === \" \" || code[i] === \"\t\" || code[i] === \"\\n\") && isStatementBoundary(wordStart)) {\n        extractBindings();\n      }\n      continue;\n    }\n    i++;\n  }\n  const seen = /* @__PURE__ */ new Set();\n  const unique = [];\n  for (const name of names) {\n    if (!seen.has(name)) {\n      seen.add(name);\n      unique.push(name);\n    }\n  }\n  return unique;\n}\nfunction extractTopLevelDurableWriteTargets(code) {\n  const names = new Set(extractTopLevelDeclaredNames(code));\n  const sanitized = stripJsStringsAndComments(code);\n  const len = sanitized.length;\n  let i = 0;\n  let braceDepth = 0;\n  let parenDepth = 0;\n  const skipWhitespace = (index) => {\n    var _a;\n    let current = index;\n    while (current < len && /\\s/.test((_a = sanitized[current]) != null ? _a : \"\")) {\n      current++;\n    }\n    return current;\n  };\n  const previousNonWhitespaceIndex = (index) => {\n    var _a;\n    let current = index;\n    while (current >= 0 && /\\s/.test((_a = sanitized[current]) != null ? _a : \"\")) {\n      current--;\n    }\n    return current;\n  };\n  const isAssignmentOperatorAt = (index) => {\n    const threeChars = sanitized.slice(index, index + 3);\n    const twoChars = sanitized.slice(index, index + 2);\n    if (threeChars === \"===\" || twoChars === \"==\" || twoChars === \"=>\") {\n      return false;\n    }\n    return sanitized[index] === \"=\" || [\n      \"+=\",\n      \"-=\",\n      \"*=\",\n      \"/=\",\n      \"%=\",\n      \"&=\",\n      \"|=\",\n      \"^=\",\n      \"&&=\",\n      \"||=\",\n      \"??=\",\n      \"**=\",\n      \"<<=\",\n      \">>=\",\n      \">>>=\"\n    ].some((op) => sanitized.startsWith(op, index));\n  };\n  const readWord = (start) => {\n    let nextIndex = start;\n    while (nextIndex < len && isIdentifierChar(sanitized[nextIndex])) {\n      nextIndex++;\n    }\n    return { word: sanitized.slice(start, nextIndex), nextIndex };\n  };\n  const addIfBareAssignment = (word, start, end) => {\n    const prevIndex = previousNonWhitespaceIndex(start - 1);\n    const prev = prevIndex >= 0 ? sanitized[prevIndex] : void 0;\n    const nextIndex = skipWhitespace(end);\n    const isMemberAccess = prev === \".\" || prev === \"?\";\n    if (isMemberAccess) {\n      return;\n    }\n    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === \"++\" || sanitized.slice(Math.max(0, start - 2), start) === \"--\";\n    const hasSuffixUpdate = sanitized.startsWith(\"++\", nextIndex) || sanitized.startsWith(\"--\", nextIndex);\n    if (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(nextIndex)) {\n      names.add(word);\n    }\n  };\n  const addIfGlobalAssignment = (start, end) => {\n    const dotIndex = skipWhitespace(end);\n    if (sanitized[dotIndex] !== \".\") {\n      return;\n    }\n    const nameStart = skipWhitespace(dotIndex + 1);\n    if (!isIdentifierStart(sanitized[nameStart])) {\n      return;\n    }\n    const { word: propertyName, nextIndex } = readWord(nameStart);\n    const operatorIndex = skipWhitespace(nextIndex);\n    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === \"++\" || sanitized.slice(Math.max(0, start - 2), start) === \"--\";\n    const hasSuffixUpdate = sanitized.startsWith(\"++\", operatorIndex) || sanitized.startsWith(\"--\", operatorIndex);\n    if (propertyName && (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(operatorIndex))) {\n      names.add(propertyName);\n    }\n  };\n  while (i < len) {\n    const ch = sanitized[i];\n    if (ch === \"{\") {\n      braceDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \"}\") {\n      braceDepth--;\n      i++;\n      continue;\n    }\n    if (ch === \"(\") {\n      parenDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \")\") {\n      parenDepth--;\n      i++;\n      continue;\n    }\n    if (braceDepth === 0 && parenDepth === 0 && isIdentifierStart(ch)) {\n      const start = i;\n      const { word, nextIndex } = readWord(i);\n      i = nextIndex;\n      if (!word) {\n        continue;\n      }\n      if (word === \"globalThis\") {\n        addIfGlobalAssignment(start, nextIndex);\n        continue;\n      }\n      addIfBareAssignment(word, start, nextIndex);\n      continue;\n    }\n    i++;\n  }\n  return [...names];\n}\nconst JS_KEYWORDS = new Set([\n  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',\n  'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally',\n  'throw', 'new', 'delete', 'typeof', 'void', 'in', 'of', 'instanceof',\n  'this', 'class', 'extends', 'super', 'import', 'export', 'default', 'from',\n  'as', 'async', 'await', 'yield', 'true', 'false', 'null', 'undefined',\n  'console', 'log'\n]);\nfunction extractReferencedIdentifiers(code) {\n  const sanitized = stripJsStringsAndComments(code);\n  const identRegex = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;\n  const ids = new Set();\n  let match = identRegex.exec(sanitized);\n  while (match !== null) {\n    if (match[1] && !JS_KEYWORDS.has(match[1])) {\n      ids.add(match[1]);\n    }\n    match = identRegex.exec(sanitized);\n  }\n  return ids;\n}\nfunction extractReadIdentifiers(code) {\n  const reads = extractReferencedIdentifiers(code);\n  for (const declared of extractTopLevelDeclaredNames(code)) {\n    reads.delete(declared);\n  }\n  return reads;\n}\nfunction extractDirectQualifiedCallableUsages(code) {\n  const sanitized = stripJsStringsAndComments(code);\n  const usages = new Set();\n  const callPattern = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\.([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(/g;\n  let match = callPattern.exec(sanitized);\n  while (match) {\n    const namespace = match[1];\n    const name = match[2];\n    if (namespace && name) {\n      usages.add(namespace + '.' + name);\n    }\n    match = callPattern.exec(sanitized);\n  }\n  return [...usages];\n}\nconst truncateInspectText = (text, maxChars) =>\n  text.length <= maxChars ? text : text.slice(0, maxChars - 3) + '...';\nconst previewInspectAtom = (value) => {\n  if (value === null) {\n    return 'null';\n  }\n  if (value === undefined) {\n    return 'undefined';\n  }\n  const valueType = typeof value;\n  if (typeof value === 'string') {\n    return JSON.stringify(truncateInspectText(value, 40));\n  }\n  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {\n    return String(value);\n  }\n  if (valueType === 'symbol') {\n    return String(value);\n  }\n  if (valueType === 'function') {\n    const fnName = value.name && typeof value.name === 'string' ? value.name : '';\n    return '[function ' + (fnName || 'anonymous') + ']';\n  }\n  if (Array.isArray(value)) {\n    return '[array(' + value.length + ')]';\n  }\n  if (value instanceof Date) {\n    return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);\n  }\n  if (value instanceof Error) {\n    return (value.name || 'Error') + ': ' + (value.message || '');\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    return '[map(' + value.size + ')]';\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    return '[set(' + value.size + ')]';\n  }\n  const ctorName =\n    value && typeof value === 'object' && 'constructor' in value && value.constructor &&\n    typeof value.constructor.name === 'string'\n      ? value.constructor.name\n      : '';\n  return ctorName && ctorName !== 'Object' ? '[' + ctorName + ']' : '[object]';\n};\nconst describeInspectType = (value) => {\n  if (value === null) {\n    return { type: 'null' };\n  }\n  if (Array.isArray(value)) {\n    return { type: 'array', ctor: 'Array' };\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    return { type: 'map', ctor: 'Map' };\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    return { type: 'set', ctor: 'Set' };\n  }\n  if (value instanceof Date) {\n    return { type: 'date', ctor: 'Date' };\n  }\n  if (value instanceof Error) {\n    return {\n      type: 'error',\n      ctor: typeof value.name === 'string' && value.name.trim() ? value.name : 'Error',\n    };\n  }\n  const valueType = typeof value;\n  if (valueType !== 'object') {\n    return { type: valueType };\n  }\n  const ctor =\n    value && typeof value === 'object' && 'constructor' in value && value.constructor &&\n    typeof value.constructor.name === 'string'\n      ? value.constructor.name\n      : undefined;\n  return { type: 'object', ctor };\n};\nconst describeInspectSize = (value, type) => {\n  if (type === 'string') {\n    return value.length + ' chars';\n  }\n  if (type === 'array') {\n    return value.length + ' items';\n  }\n  if (type === 'map' || type === 'set') {\n    return value.size + ' items';\n  }\n  if (type === 'object' && value && typeof value === 'object') {\n    return Object.keys(value).length + ' keys';\n  }\n  return undefined;\n};\nconst previewInspectValue = (value, type, ctor) => {\n  if (type === 'array') {\n    const items = value.slice(0, 3).map((item) => previewInspectAtom(item));\n    return '[' + items.join(', ') + (value.length > 3 ? ', ...' : '') + ']';\n  }\n  if (type === 'map') {\n    const items = Array.from(value.entries())\n      .slice(0, 3)\n      .map((pair) => previewInspectAtom(pair[0]) + ' => ' + previewInspectAtom(pair[1]));\n    return 'Map(' + value.size + ') {' + items.join(', ') + (value.size > 3 ? ', ...' : '') + '}';\n  }\n  if (type === 'set') {\n    const items = Array.from(value.values())\n      .slice(0, 5)\n      .map((item) => previewInspectAtom(item));\n    return 'Set(' + value.size + ') {' + items.join(', ') + (value.size > 5 ? ', ...' : '') + '}';\n  }\n  if (type === 'date' || type === 'error' || type === 'function') {\n    return previewInspectAtom(value);\n  }\n  if (type === 'object' && value && typeof value === 'object') {\n    const keys = Object.keys(value);\n    const shown = keys.slice(0, 4);\n    const prefix = ctor && ctor !== 'Object' ? ctor + ' ' : '';\n    return prefix + '{' + shown.join(', ') + (keys.length > shown.length ? ', ...' : '') + '}';\n  }\n  return previewInspectAtom(value);\n};\nconst canCloneValue = (value, seen) => {\n  const valueType = typeof value;\n  if (valueType === 'function' || valueType === 'symbol') {\n    return false;\n  }\n  if (value === null || valueType !== 'object') {\n    return true;\n  }\n  if (seen.indexOf(value) >= 0) {\n    return true;\n  }\n  seen.push(value);\n  if (value instanceof Date || value instanceof RegExp || value instanceof Error) {\n    return true;\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    for (const pair of value.entries()) {\n      if (!canCloneValue(pair[0], seen) || !canCloneValue(pair[1], seen)) return false;\n    }\n    return true;\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    for (const item of value.values()) {\n      if (!canCloneValue(item, seen)) return false;\n    }\n    return true;\n  }\n  for (const key of Object.keys(value)) {\n    if (!canCloneValue(value[key], seen)) return false;\n  }\n  return true;\n};\nglobalThis.__ax_analyze_code = function (code) {\n  const text = typeof code === 'string' ? code : '';\n  return JSON.stringify({\n    producedVars: extractTopLevelDurableWriteTargets(text),\n    readVars: [...extractReadIdentifiers(text)],\n    callables: extractDirectQualifiedCallableUsages(text),\n  });\n};\n// src/ax/agent/agentInternal/sharedSession.ts buildDistillerFinalWrapperCode:\n// in the distiller phase, final(task, evidence) with an evidence object\n// keeps it as the distilledContext global, which the executor inherits with\n// the session. The runtime calls this after installing its final primitive;\n// a merge patch (the executor phase) sets __ax_phase to 'executor'.\nglobalThis.__ax_install_final_evidence = function () {\n  const hostFinal = globalThis.final;\n  if (typeof hostFinal !== 'function' || hostFinal.__ax_final_evidence === true) {\n    return;\n  }\n  const wrapped = function () {\n    const context = arguments[1];\n    if (\n      globalThis.__ax_phase !== 'executor' &&\n      arguments.length === 2 &&\n      context !== null &&\n      typeof context === 'object' &&\n      !Array.isArray(context)\n    ) {\n      globalThis.distilledContext = context;\n    }\n    return hostFinal.apply(this, arguments);\n  };\n  wrapped.__ax_final_evidence = true;\n  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'final') || {};\n  try {\n    if (descriptor.configurable === false) {\n      globalThis.final = wrapped;\n    } else {\n      Object.defineProperty(globalThis, 'final', {\n        value: wrapped,\n        writable: descriptor.writable !== false,\n        enumerable: descriptor.enumerable === true,\n        configurable: true,\n      });\n    }\n  } catch (_error) {\n    // A final the runtime cannot replace keeps its behavior.\n  }\n};\nglobalThis.__ax_inspect_entries = function (skipNames) {\n  const skip = new Set(Array.isArray(skipNames) ? skipNames : []);\n  const scope = globalThis;\n  const entries = Object.getOwnPropertyNames(scope)\n    .filter((name) => !skip.has(name) && !name.startsWith('_'))\n    .sort()\n    .map((name) => {\n      try {\n        const descriptor = Object.getOwnPropertyDescriptor(scope, name);\n        if (!descriptor) {\n          return undefined;\n        }\n        if ('get' in descriptor && typeof descriptor.get === 'function' && !('value' in descriptor)) {\n          return { name, type: 'accessor', preview: '[getter omitted]', restorable: false };\n        }\n        const value = 'value' in descriptor ? descriptor.value : scope[name];\n        const meta = describeInspectType(value);\n        const size = describeInspectSize(value, meta.type);\n        const preview = previewInspectValue(value, meta.type, meta.ctor);\n        const entry = { name, type: meta.type };\n        if (meta.ctor) entry.ctor = meta.ctor;\n        if (size) entry.size = size;\n        if (preview) entry.preview = truncateInspectText(preview, 96);\n        entry.restorable = canCloneValue(value, []);\n        return entry;\n      } catch (_error) {\n        return { name, type: 'unknown', preview: '[unavailable]', restorable: false };\n      }\n    })\n    .filter((entry) => entry !== undefined);\n  return JSON.stringify(entries);\n};\n})();\n"); err != nil {
		return nil, err
	}
	if names, err := session.vm.RunString("JSON.stringify(Object.getOwnPropertyNames(globalThis))"); err == nil {
		_ = json.Unmarshal([]byte(names.String()), &session.baseline)
	}
	return session, nil
}

// codeAnalysis is TS's analysis of a turn's code: the top-level variables it
// writes and reads, and its qualified calls.
func (s *Session) codeAnalysis(code string) ax.Value {
	codeJSON, err := json.Marshal(code)
	if err != nil {
		return nil
	}
	value, err := s.vm.RunString("__ax_analyze_code(" + string(codeJSON) + ")")
	if err != nil || value == nil || gojavm.IsUndefined(value) {
		return nil
	}
	var parsed any
	if json.Unmarshal([]byte(value.String()), &parsed) != nil {
		return nil
	}
	return parsed
}

// inspectEntries is TS's AxJSRuntime snapshot entries of the user globals.
func (s *Session) inspectEntries() ax.Value {
	skip := append([]string{}, s.baseline...)
	for name := range s.reserved {
		skip = append(skip, name)
	}
	skipJSON, err := json.Marshal(skip)
	if err != nil {
		return []ax.Value{}
	}
	value, err := s.vm.RunString("__ax_inspect_entries(" + string(skipJSON) + ")")
	if err != nil || value == nil || gojavm.IsUndefined(value) {
		return []ax.Value{}
	}
	var parsed []any
	if json.Unmarshal([]byte(value.String()), &parsed) != nil {
		return []ax.Value{}
	}
	return parsed
}

func (s *Session) Execute(code string, options map[string]ax.Value) ax.Value {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return runtimeError("session closed", "session_closed")
	}
	analysis := s.codeAnalysis(code)
	result := s.executeLocked(code, options)
	if payload, ok := result.(map[string]ax.Value); ok && analysis != nil {
		payload["analysis"] = analysis
	}
	return result
}

func (s *Session) executeLocked(code string, options map[string]ax.Value) ax.Value {
	s.completion = nil
	s.turnLogs = nil
	s.installBuiltins()
	// TS's distiller final: final(task, evidence) keeps the evidence as the
	// distilledContext global the executor inherits.
	_, _ = s.vm.RunString("__ax_install_final_evidence()")
	timeoutMs := intOption(valueFromMap(options, "timeoutMs"), intOption(valueFromMap(s.runtimePolicy, "timeoutMs"), 5000))
	var timer *time.Timer
	if timeoutMs > 0 {
		timer = time.AfterFunc(time.Duration(timeoutMs)*time.Millisecond, func() {
			s.vm.Interrupt("goja execution timed out")
		})
	}
	// Persistence: top-level const/let/var declared this turn are block-scoped to the
	// async wrapper and would vanish next turn, but the RLM prompt promises a long-running
	// REPL where state persists. Extract the declared names and assign them onto globalThis
	// (the scope that survives), mirroring the TS runtime. Fail-open. (with(globalThis)
	// already persists bare assignments; this covers declarations.)
	persistSuffix := ""
	if codeJSON, mErr := json.Marshal(code); mErr == nil {
		if sv, sErr := s.vm.RunString("(function(src){try{var n=[],s={},re=/(?:^|[\\n;{}])\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,m;while((m=re.exec(src))){if(!s[m[1]]){s[m[1]]=1;n.push(m[1]);}}return n.map(function(x){return 'try{globalThis['+JSON.stringify(x)+']='+x+';}catch(__e){}';}).join('');}catch(__e){return '';}})(" + string(codeJSON) + ")"); sErr == nil && sv != nil && !gojavm.IsUndefined(sv) && !gojavm.IsNull(sv) {
			persistSuffix = sv.String()
		}
	}
	body, marshalErr := json.Marshal("with (globalThis) {\n" + code + "\n" + persistSuffix + "\n}")
	if marshalErr != nil {
		return runtimeError("goja actor code is not executable", "runtime")
	}
	// The RLM prompt has the model write `await final(...)` / `await llmQuery(...)`, so actor
	// code uses top-level await — illegal in a plain Function body. Compile it as an async
	// function (AsyncFunction constructor) instead. A synchronous `throw` inside an async
	// function becomes a *rejected promise*, so attach a rejection handler that records
	// __ax_error; goja drains the promise job queue when RunString returns, so the handler runs
	// before we read the result. Without it the throw's error_category would be silently lost.
	// The synchronous host primitives that set the completion run before the first await
	// suspends, so the completion is captured too.
	_, err := s.vm.RunString("globalThis.__ax_error = undefined; globalThis.__ax_error_category = undefined; (async function(){}).constructor(" + string(body) + ")().then(function(){}, function(e){ globalThis.__ax_error = String((e && e.stack) ? e.stack : e); globalThis.__ax_error_category = String((e && (e.error_category || e.category)) || 'runtime'); });")
	if timer != nil && !timer.Stop() {
		s.vm.ClearInterrupt()
	}
	// A timeout surfaces here as an uncatchable interrupt error (the `while (true) {}` path);
	// keep that check ahead of the rejection so it stays categorized as a timeout.
	if err != nil {
		return runtimeError(err.Error(), errorCategory(err))
	}
	if actorError := s.vm.Get("__ax_error"); actorError != nil && !gojavm.IsUndefined(actorError) && !gojavm.IsNull(actorError) {
		category := "runtime"
		if actorCategory := s.vm.Get("__ax_error_category"); actorCategory != nil && !gojavm.IsUndefined(actorCategory) && !gojavm.IsNull(actorCategory) {
			category = fmt.Sprint(actorCategory.Export())
		}
		return runtimeError(fmt.Sprint(actorError.Export()), category)
	}
	s.restoreReservedGlobals()
	s.installBuiltins()
	if s.completion == nil {
		return s.withTurnLogs(map[string]ax.Value{"kind": "result", "result": nil})
	}
	if safe, ok := jsonSafe(s.completion); ok {
		return s.withTurnLogs(safe)
	}
	return runtimeError("goja actor output is not JSON-compatible", "runtime")
}

// withTurnLogs surfaces this turn's console output as `logs` on the payload,
// where the axir step normalizer joins it into the output shown to the model.
// Completion payloads get it too, mirroring the Python runtime; a payload that
// already carries logs, or is not a map, is returned untouched.
func (s *Session) withTurnLogs(payload ax.Value) ax.Value {
	if len(s.turnLogs) == 0 {
		return payload
	}
	m, ok := payload.(map[string]ax.Value)
	if !ok {
		return payload
	}
	if _, exists := m["logs"]; exists {
		return payload
	}
	logs := make([]ax.Value, 0, len(s.turnLogs))
	for _, line := range s.turnLogs {
		logs = append(logs, line)
	}
	m["logs"] = logs
	return m
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
		"entries":  s.inspectEntries(),
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
	// A merge patch (the agent's own globals for the executor, as TS's
	// patchGlobals) keeps the session's variables and updates its protected
	// values; any other patch replaces the user globals.
	merge := asMap(snapshot)["merge"] == true
	next := asMap(snapshot)
	if _, ok := next["bindings"]; ok {
		next = asMap(valueFromMap(next, "bindings"))
	}
	global := s.vm.GlobalObject()
	if merge {
		// The executor phase: the distiller's final no longer keeps evidence.
		_, _ = s.vm.RunString("globalThis.__ax_phase = 'executor'")
	}
	if !merge {
		for _, key := range global.Keys() {
			if s.reserved[key] || strings.HasPrefix(key, "__ax_") {
				continue
			}
			_ = global.Delete(key)
		}
	}
	for key, value := range next {
		if strings.HasPrefix(key, "__ax_") || hostCallableMarker(value) != nil {
			continue
		}
		safe, ok := jsonSafe(value)
		if !ok {
			continue
		}
		if s.reserved[key] {
			if merge {
				s.reservedValues[key] = safe
				s.defineProtectedJSON(key, safe)
			}
			continue
		}
		_ = s.vm.Set(key, safe)
	}
	s.restoreReservedGlobals()
	s.installBuiltins()
	bindings := s.snapshotBindings(true)
	return map[string]ax.Value{
		"version":  1,
		"entries":  s.inspectEntries(),
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
	logTo := func(target *[]string) func(values ...gojavm.Value) {
		return func(values ...gojavm.Value) {
			s.appendDiagnostic(target, values...)
			s.appendDiagnostic(&s.turnLogs, values...)
		}
	}
	// warn/info/debug exist in every sibling runtime's console shim; leaving
	// them undefined here turned a model's console.info into a TypeError that
	// failed the whole turn.
	for _, name := range []string{"log", "warn", "info", "debug"} {
		_ = console.DefineDataProperty(name, s.vm.ToValue(logTo(&s.stdout)), gojavm.FLAG_FALSE, gojavm.FLAG_FALSE, gojavm.FLAG_TRUE)
	}
	_ = console.DefineDataProperty("error", s.vm.ToValue(logTo(&s.stderr)), gojavm.FLAG_FALSE, gojavm.FLAG_FALSE, gojavm.FLAG_TRUE)
	s.defineProtected("console", console)
	s.setPrimitive("final", func(args []ax.Value) ax.Value {
		return map[string]ax.Value{"type": "final", "args": args}
	})
	s.setPrimitive("respond", func(args []ax.Value) ax.Value {
		return map[string]ax.Value{"type": "respond", "args": args}
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
				panic(s.hostCallableError(err, axErrorCategory(err)))
			}
			safe, ok := jsonSafe(result)
			if !ok {
				panic(s.hostCallableError(errors.New("host callable returned a non-JSON-compatible value"), "runtime"))
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
				panic(s.hostCallableError(errors.New(message), category))
			}
			if result, ok := spec["result"]; ok {
				safe, _ := jsonSafe(result)
				return s.vm.ToValue(safe)
			}
			return s.vm.ToValue(map[string]ax.Value{"kind": "result", "result": nil})
		}))
	}
}

func (s *Session) hostCallableError(err error, category string) *gojavm.Object {
	if category == "" {
		category = "runtime"
	}
	value := s.vm.NewGoError(err)
	_ = value.Set("error_category", category)
	return value
}

func axErrorCategory(err error) string {
	var value ax.AxError
	if errors.As(err, &value) && value.Category != "" {
		return value.Category
	}
	var pointer *ax.AxError
	if errors.As(err, &pointer) && pointer != nil && pointer.Category != "" {
		return pointer.Category
	}
	return "runtime"
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
	limit := intOption(valueFromMap(s.runtimePolicy, "maxDiagnosticsBytes"), 16384)
	*target = append(*target, truncateDiagnostic(strings.Join(parts, " "), limit))
	// Drop the oldest entries when the budget is exceeded, but never the entry
	// just written: it is the one the actor asked to see this turn, and the
	// line above has already bounded it on its own.
	for len(strings.Join(*target, "\n")) > limit && len(*target) > 1 {
		*target = (*target)[1:]
	}
}

// truncateDiagnostic bounds one logged line, replacing the overflow with a note
// that says what happened and what to do instead.
//
// Trimming a line to fit is what "the runtime truncates long values" means to
// the actor writing the code: it inspects a large object, sees the head of it
// plus the notice, and narrows to a slice on the next turn. Dropping the line
// entirely — which is what the enclosing budget loop did to any single line
// over the limit — is indistinguishable from console.log doing nothing, and
// leaves nothing to learn from. Measured downstream: logging a 25KB discovery
// seed produced no output at all, and the actor re-fetched what it already had.
func truncateDiagnostic(line string, limit int) string {
	if limit <= 0 || len(line) <= limit {
		return line
	}
	const shortNotice = "[truncated]"
	if limit <= len(shortNotice) {
		return shortNotice[:limit]
	}
	notice := fmt.Sprintf(" [truncated from %d bytes; log a slice or fewer fields instead]", len(line))
	if len(notice) >= limit {
		notice = " " + shortNotice
	}
	prefixBytes := limit - len(notice)
	for prefixBytes > 0 && !utf8.RuneStart(line[prefixBytes]) {
		prefixBytes--
	}
	return line[:prefixBytes] + notice
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
	// Read-only for the actor's code; configurable so the host can update the
	// value (a merge patch) and restore it after each turn.
	_ = s.vm.GlobalObject().DefineDataProperty(name, value, gojavm.FLAG_FALSE, gojavm.FLAG_FALSE, gojavm.FLAG_TRUE)
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
		"console", "inputs", "final", "respond", "askClarification", "discover", "recall", "used", "reportSuccess",
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
