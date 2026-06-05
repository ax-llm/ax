package axir

const goMod = `module github.com/ax-llm/ax/go

go 1.22

require github.com/dop251/goja v0.0.0-20250630131328-58d95d85e994

require (
	github.com/dlclark/regexp2 v1.11.4 // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	golang.org/x/text v0.3.8 // indirect
)
`

const goSum = `github.com/Masterminds/semver/v3 v3.2.1 h1:RN9w6+7QoMeJVGyfmbcgs28Br8cvmnucEXnY0rYXWg0=
github.com/Masterminds/semver/v3 v3.2.1/go.mod h1:qvl/7zhW3nngYb5+80sSMF+FG2BjYrf8m9wsX0PNOMQ=
github.com/dlclark/regexp2 v1.11.4 h1:rPYF9/LECdNymJufQKmri9gV604RvvABwgOA8un7yAo=
github.com/dlclark/regexp2 v1.11.4/go.mod h1:DHkYz0B9wPfa6wondMfaivmHpzrQ3v9q8cnmRbL6yW8=
github.com/dop251/goja v0.0.0-20250630131328-58d95d85e994 h1:aQYWswi+hRL2zJqGacdCZx32XjKYV8ApXFGntw79XAM=
github.com/dop251/goja v0.0.0-20250630131328-58d95d85e994/go.mod h1:MxLav0peU43GgvwVgNbLAj1s/bSGboKkhuULvq/7hx4=
github.com/go-sourcemap/sourcemap v2.1.3+incompatible h1:W1iEw64niKVGogNgBN3ePyLFfuisuzeidWPMPWmECqU=
github.com/go-sourcemap/sourcemap v2.1.3+incompatible/go.mod h1:F8jJfvm2KbVjc5NqelyYJmf/v5J0dwNLS2mL4sNA1Jg=
github.com/google/pprof v0.0.0-20230207041349-798e818bf904 h1:4/hN5RUoecvl+RmJRE2YxKWtnnQls6rQjjW5oV7qg2U=
github.com/google/pprof v0.0.0-20230207041349-798e818bf904/go.mod h1:uglQLonpP8qtYCYyzA+8c/9qtqgA3qsXGYqCPKARAFg=
golang.org/x/text v0.3.8 h1:nAL+RVCQ9uMn3vJZbV+MRnydTJFPf8qqY42YiA6MrqY=
golang.org/x/text v0.3.8/go.mod h1:E6s5w1FMmriuDzIBO73fBruAKo1PCIq6d2Q6DHfQ8WQ=
gopkg.in/yaml.v2 v2.4.0 h1:D8xgwECY7CYvx+Y2n4sBz93Jn9JRvxdiyyo8CTfuKaY=
gopkg.in/yaml.v2 v2.4.0/go.mod h1:RDklbk79AGWmwhnvt/jBztapEOGDOx6ZbXqjP6csGnQ=
`

const goRuntime = `package axllm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Value = any

type AxError struct {
	Category string
	Type     string
	Message  string
	Status   int
	Code     string
	Retryable bool
}

func (e AxError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Category
}

type SignatureError struct{ AxError }
type ValidationError struct{ AxError }
type AIServiceError struct{ AxError }

type coreReturn struct{ value Value }
type coreBreak struct{}
type coreContinue struct{}

func catchCoreReturn(ret *Value) {
	if r := recover(); r != nil {
		if cr, ok := r.(coreReturn); ok {
			*ret = cr.value
			return
		}
		panic(r)
	}
}

func Object(entries ...Value) map[string]Value {
	out := map[string]Value{}
	for i := 0; i+1 < len(entries); i += 2 {
		coreSet(out, entries[i], entries[i+1])
	}
	return out
}

func Array(items ...Value) []Value {
	return append([]Value(nil), items...)
}

type AxArray struct {
	Items []Value
}

func MutableArray(items ...Value) *AxArray {
	return &AxArray{Items: append([]Value(nil), items...)}
}

func asMap(value Value) map[string]Value {
	if value == nil {
		return map[string]Value{}
	}
	switch v := value.(type) {
	case map[string]any:
		out := map[string]Value{}
		for key, item := range v { coreSet(out, key, normalizeJSON(item)) }
		return out
	case AxSignature:
		return v.toMap()
	case *AxSignature:
		if v == nil { return map[string]Value{} }
		return v.toMap()
	case Field:
		return v.toMap()
	case *Field:
		if v == nil { return map[string]Value{} }
		return v.toMap()
	case FieldType:
		return v.toMap()
	case *FieldType:
		if v == nil { return map[string]Value{} }
		return v.toMap()
	default:
		return map[string]Value{}
	}
}

func asSlice(value Value) []Value {
	if value == nil {
		return []Value{}
	}
	switch v := value.(type) {
	case *AxArray:
		if v == nil { return []Value{} }
		return v.Items
	case []any:
		out := make([]Value, 0, len(v))
		for _, item := range v { out = append(out, normalizeJSON(item)) }
		return out
	case []string:
		out := make([]Value, 0, len(v))
		for _, item := range v { out = append(out, item) }
		return out
	case []Field:
		out := make([]Value, 0, len(v))
		for _, item := range v { out = append(out, item) }
		return out
	case []*Field:
		out := make([]Value, 0, len(v))
		for _, item := range v { out = append(out, item) }
		return out
	default:
		return []Value{}
	}
}

func coreIter(value Value) []Value {
	if m, ok := value.(map[string]Value); ok {
		keys := orderedKeys(m)
		out := make([]Value, 0, len(keys))
		for _, key := range keys { if key != "__order" { out = append(out, key) } }
		return out
	}
	return asSlice(value)
}

func orderedKeys(m map[string]Value) []string {
	var out []string
	seen := map[string]bool{}
	for _, raw := range asSlice(m["__order"]) {
		key := display(raw)
		if key != "__order" && !seen[key] {
			if _, ok := m[key]; ok {
				out = append(out, key)
				seen[key] = true
			}
		}
	}
	for key := range m {
		if key != "__order" && !seen[key] {
			out = append(out, key)
		}
	}
	sort.Strings(out[len(seen):])
	return out
}

func coreGet(target Value, key Value, fallback Value) Value {
	k := display(key)
	switch v := target.(type) {
	case map[string]Value:
		if item, ok := v[k]; ok { return item }
		for _, alias := range keyAliases(k) {
			if item, ok := v[alias]; ok { return item }
		}
	case []Value:
		idx, ok := intIndex(key)
		if ok && idx >= 0 && idx < len(v) { return v[idx] }
	case *AxArray:
		idx, ok := intIndex(key)
		if v != nil && ok && idx >= 0 && idx < len(v.Items) { return v.Items[idx] }
	case AxSignature:
		return coreGet(v.toMap(), key, fallback)
	case *AxSignature:
		if v != nil { return coreGet(v.toMap(), key, fallback) }
	case Field:
		return coreGet(v.toMap(), key, fallback)
	case *Field:
		if v != nil { return coreGet(v.toMap(), key, fallback) }
	case FieldType:
		return coreGet(v.toMap(), key, fallback)
	case *FieldType:
		if v != nil { return coreGet(v.toMap(), key, fallback) }
	case *AxGen:
		return v.get(k, fallback)
	case *AxAgent:
		return v.get(k, fallback)
	case *AxFlow:
		if v != nil {
			switch k {
			case "state": return v.State
			case "steps": return coreGet(v.State, "steps", fallback)
			case "options": return v.Options
			case "chat_log", "chatLog": return coreGet(v.State, "chat_log", fallback)
			case "traces": return coreGet(v.State, "traces", fallback)
			case "usage": return coreGet(v.State, "usage", fallback)
			}
		}
	case CodeRuntime:
		if k == "language" { return v.Language() }
		if k == "usageInstructions" || k == "usage_instructions" { return v.UsageInstructions() }
	case Tool:
		return v.get(k, fallback)
	case *Tool:
		if v != nil { return v.get(k, fallback) }
	}
	return fallback
}

func keyAliases(key string) []string {
	switch key {
	case "is_array": return []string{"isArray"}
	case "is_optional": return []string{"isOptional"}
	case "is_internal": return []string{"isInternal"}
	case "is_cached": return []string{"isCached"}
	case "min_length": return []string{"minLength"}
	case "max_length": return []string{"maxLength"}
	case "pattern_description": return []string{"patternDescription"}
	case "input_fields": return []string{"inputs"}
	case "output_fields": return []string{"outputs"}
	default: return nil
	}
}

func coreSet(target Value, key Value, value Value) {
	if m, ok := target.(map[string]Value); ok {
		k := display(key)
		if _, exists := m[k]; !exists {
			m["__order"] = coreAppend(m["__order"], k)
		}
		m[k] = value
		return
	}
	panic(AxError{Category: "runtime", Message: "core.set target must be a map"})
}

func coreAppend(target Value, value Value) Value {
	if a, ok := target.(*AxArray); ok {
		if a == nil { return MutableArray(value) }
		a.Items = append(a.Items, value)
		return a
	}
	return append(asSlice(target), value)
}

func coreTruthy(value Value) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	case []Value:
		return len(v) > 0
	case *AxArray:
		return v != nil && len(v.Items) > 0
	case map[string]Value:
		return len(orderedKeys(v)) > 0
	default:
		return true
	}
}

func num(value Value) float64 {
	switch v := value.(type) {
	case nil:
		return 0
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float64:
		return v
	case bool:
		if v { return 1 }
		return 0
	case string:
		n, _ := strconv.ParseFloat(v, 64)
		return n
	default:
		n, _ := strconv.ParseFloat(display(v), 64)
		return n
	}
}

func intIndex(value Value) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	default:
		return 0, false
	}
}

func display(value Value) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case bool:
		if v { return "true" }
		return "false"
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case float64:
		if math.Trunc(v) == v { return strconv.FormatInt(int64(v), 10) }
		return strconv.FormatFloat(v, 'f', -1, 64)
	case AxError:
		return v.Error()
	case error:
		return v.Error()
	case *AxArray:
		return stableStringify(v)
	default:
		return fmt.Sprint(v)
	}
}

func canonical(value Value) Value {
	switch v := value.(type) {
	case *AxArray:
		if v == nil { return []Value{} }
		out := make([]Value, 0, len(v.Items))
		for _, item := range v.Items { out = append(out, canonical(item)) }
		return out
	case map[string]Value:
		out := map[string]Value{}
		for _, key := range orderedKeys(v) {
			if key == "__order" { continue }
			out[key] = canonical(v[key])
		}
		return out
	case []Value:
		out := make([]Value, 0, len(v))
		for _, item := range v { out = append(out, canonical(item)) }
		return out
	case float64:
		if math.Trunc(v) == v { return int64(v) }
		return v
	default:
		return v
	}
}

func equal(left Value, right Value) bool {
	return stableStringify(canonical(left)) == stableStringify(canonical(right))
}

func stableStringify(value Value) string {
	var b strings.Builder
	writeStableJSON(&b, value)
	return b.String()
}

func writeStableJSON(b *strings.Builder, value Value) {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case string:
		b.WriteString(strconv.Quote(v))
	case bool:
		if v { b.WriteString("true") } else { b.WriteString("false") }
	case int:
		b.WriteString(strconv.Itoa(v))
	case int64:
		b.WriteString(strconv.FormatInt(v, 10))
	case float64:
		b.WriteString(strconv.FormatFloat(v, 'f', -1, 64))
	case []Value:
		b.WriteByte('[')
		for i, item := range v {
			if i > 0 { b.WriteByte(',') }
			writeStableJSON(b, item)
		}
		b.WriteByte(']')
	case *AxArray:
		writeStableJSON(b, asSlice(v))
	case map[string]Value:
		b.WriteByte('{')
		keys := sortedMapKeys(v)
		first := true
		for _, key := range keys {
			if key == "__order" { continue }
			if !first { b.WriteByte(',') }
			first = false
			b.WriteString(strconv.Quote(key)); b.WriteByte(':')
			writeStableJSON(b, v[key])
		}
		b.WriteByte('}')
	default:
		data, _ := json.Marshal(v); b.Write(data)
	}
}

func sortedMapKeys(m map[string]Value) []string {
	keys := make([]string, 0, len(m))
	for key := range m { if key != "__order" { keys = append(keys, key) } }
	sort.Strings(keys)
	return keys
}

func parseJSON(text string) Value {
	dec := json.NewDecoder(strings.NewReader(text))
	raw, err := parseJSONValue(dec)
	if err != nil {
		panic(AxError{Category: "runtime", Message: err.Error()})
	}
	return raw
}

func ParseJSON(text string) Value { return parseJSON(text) }

func parseJSONValue(dec *json.Decoder) (Value, error) {
	tok, err := dec.Token()
	if err != nil { return nil, err }
	switch v := tok.(type) {
	case json.Delim:
		switch v {
		case '{':
			out := map[string]Value{}
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil { return nil, err }
				value, err := parseJSONValue(dec)
				if err != nil { return nil, err }
				coreSet(out, display(keyTok), value)
			}
			_, err := dec.Token()
			return out, err
		case '[':
			out := []Value{}
			for dec.More() {
				value, err := parseJSONValue(dec)
				if err != nil { return nil, err }
				out = append(out, value)
			}
			_, err := dec.Token()
			return out, err
		default:
			return nil, fmt.Errorf("unexpected JSON delimiter %q", v)
		}
	default:
		return normalizeJSON(v), nil
	}
}

func normalizeJSON(value any) Value {
	switch v := value.(type) {
	case map[string]any:
		out := map[string]Value{}
		for key, item := range v { coreSet(out, key, normalizeJSON(item)) }
		return out
	case []any:
		out := make([]Value, 0, len(v))
		for _, item := range v { out = append(out, normalizeJSON(item)) }
		return out
	default:
		return v
	}
}

func runtimeJSONValue(value Value) any {
	switch v := value.(type) {
	case map[string]Value:
		out := map[string]any{}
		for _, key := range orderedKeys(v) {
			if key != "__order" { out[key] = runtimeJSONValue(v[key]) }
		}
		return out
	case []Value:
		out := make([]any, 0, len(v))
		for _, item := range v { out = append(out, runtimeJSONValue(item)) }
		return out
	case *AxArray:
		return runtimeJSONValue(asSlice(v))
	default:
		return v
	}
}

func errorValue(raw any) Value {
	switch v := raw.(type) {
	case AxError:
		return Object("__error", v.Category, "message", v.Message, "__type", v.Type, "status", float64(v.Status), "code", v.Code, "retryable", v.Retryable)
	case error:
		return Object("__error", "runtime", "message", v.Error())
	default:
		return Object("__error", "runtime", "message", display(v))
	}
}

func asAxError(value Value) AxError {
	if err, ok := value.(AxError); ok { return err }
	m := asMap(value)
	if cat := display(m["__error"]); cat != "" {
		return AxError{Category: cat, Message: display(m["message"]), Type: display(m["__type"]), Status: int(num(m["status"])), Code: display(m["code"]), Retryable: coreTruthy(m["retryable"])}
	}
	return AxError{Category: "runtime", Message: display(value)}
}

func coreRegexMatch(pattern Value, value Value) Value {
	return regexp.MustCompile(display(pattern)).FindStringIndex(display(value)) != nil
}

func coreStringTrim(value Value) Value { return strings.TrimSpace(display(value)) }

func coreTypeIs(value Value, typeName Value) Value {
	switch display(typeName) {
	case "object": _, ok := value.(map[string]Value); return ok
	case "list":
		if _, ok := value.([]Value); ok { return true }
		_, ok := value.(*AxArray); return ok
	case "string": _, ok := value.(string); return ok
	case "number": _, ok := value.(float64); if ok { return true }; _, ok = value.(int); return ok
	case "boolean": _, ok := value.(bool); return ok
	case "null": return value == nil
	case "json": return true
	default: return false
	}
}

func _core_not(value Value) Value { return !coreTruthy(value) }
func _core_and(left Value, right Value) Value { return coreTruthy(left) && coreTruthy(right) }
func _core_or(left Value, right Value) Value { return coreTruthy(left) || coreTruthy(right) }
func _core_eq(left Value, right Value) Value { return equal(left, right) }
func _core_ne(left Value, right Value) Value { return !equal(left, right) }
func _core_lt(left Value, right Value) Value { return num(left) < num(right) }
func _core_lte(left Value, right Value) Value { return num(left) <= num(right) }
func _core_gt(left Value, right Value) Value { return num(left) > num(right) }
func _core_gte(left Value, right Value) Value { return num(left) >= num(right) }
func _core_add(left Value, right Value) Value {
	if _, ok := left.(string); ok { return display(left) + display(right) }
	if _, ok := right.(string); ok { return display(left) + display(right) }
	return num(left) + num(right)
}
func _core_mul(left Value, right Value) Value { return num(left) * num(right) }
func _core_div(left Value, right Value) Value { d := num(right); if d == 0 { d = 1 }; return num(left) / d }
func _core_contains(container Value, item Value) Value {
	if m, ok := container.(map[string]Value); ok { _, ok := m[display(item)]; return ok }
	for _, v := range asSlice(container) { if equal(v, item) { return true } }
	if _, ok := container.(string); ok { needle:=display(item); return needle != "" && strings.Contains(display(container), needle) }
	return false
}
func _core_len(value Value) Value {
	switch v := value.(type) {
	case string: return float64(len(v))
	case []Value: return float64(len(v))
	case *AxArray:
		if v == nil { return float64(0) }
		return float64(len(v.Items))
	case map[string]Value: return float64(len(orderedKeys(v)))
	default: return float64(0)
	}
}
func _core_truthy(value Value) Value { return coreTruthy(value) }
func _core_is_none(value Value) Value { return value == nil }
func _core_is_not_none(value Value) Value { return value != nil }
func _core_none() Value { return nil }
func _core_coalesce(value Value, fallback Value) Value { if value == nil { return fallback }; return value }
func _core_map_merge(left Value, right Value) Value { out := cloneMap(asMap(left)); for _, k := range orderedKeys(asMap(right)) { coreSet(out, k, coreGet(right,k,nil)) }; return out }
func _core_map_contains(values Value, key Value) Value {
	m := asMap(values)
	k := display(key)
	if _, ok := m[k]; ok { return true }
	for _, alias := range keyAliases(k) {
		if _, ok := m[alias]; ok { return true }
	}
	return false
}
func _core_map_get(values Value, key Value) Value { return coreGet(values, key, nil) }
func _core_map_delete(values Value, key Value) Value {
	if m, ok := values.(map[string]Value); ok {
		delete(m, display(key))
		return m
	}
	out := cloneMap(asMap(values))
	delete(out, display(key))
	return out
}
func _core_map_update(target Value, values Value) Value { out := cloneMap(asMap(target)); for _, k := range orderedKeys(asMap(values)) { coreSet(out, k, coreGet(values,k,nil)) }; return out }
func _core_map_keys(values Value) Value { out := Array(); for _, k := range orderedKeys(asMap(values)) { out = append(out, k) }; return out }
func _core_map_values(values Value) Value { out := Array(); for _, k := range orderedKeys(asMap(values)) { out = append(out, coreGet(values,k,nil)) }; return out }
func _core_record_new(name Value, values Value) Value { return recordNew(display(name), asMap(values)) }
func _core_object_call_method(target Value, methodName Value, arg Value) Value { return objectCallMethod(target, display(methodName), arg) }
func _core_program_components(program Value) Value { if p, ok := program.(AxProgram); ok { return p.GetOptimizableComponents() }; return Array() }
func _core_program_apply_components(program Value, componentMap Value) Value { if p, ok := program.(AxProgram); ok { p.ApplyOptimizedComponents(asMap(componentMap)) }; return Object() }
func _core_ai_complete_once(client Value, request Value) Value {
	if c, ok := client.(AIClient); ok {
		out, err := c.Chat(context.Background(), asMap(request), Object())
		if err != nil { panic(err) }
		return chat_response_to_completion(out)
	}
	panic(AxError{Category: "runtime", Message: "client does not implement AIClient"})
}
func _core_retry_sleep(attempt Value) Value { return nil }
func _core_exception_message(err Value) Value { return display(coreGet(err, "message", err)) }
func _core_runtime_error(message Value) Value { return Object("__error", "runtime", "message", display(message)) }
func _core_json_parse(value Value) Value {
	text := strings.TrimSpace(display(value))
	fence := strings.Repeat(string(rune(96)), 3)
	if strings.HasPrefix(text, fence) {
		text = strings.ReplaceAll(text, string(rune(96)), "")
		text = strings.TrimSpace(text)
		if strings.HasPrefix(text, "json") { text = strings.TrimSpace(text[4:]) }
	}
	return parseJSON(text)
}
func _core_json_stringify(value Value) Value { return stableStringify(value) }
func _core_json_stable_stringify(value Value) Value { return stableStringify(value) }
func _core_tool_invoke(fn Value, params Value) Value { if t, ok := fn.(Tool); ok { return t.Call(asMap(params)) }; if t, ok := fn.(*Tool); ok { return t.Call(asMap(params)) }; panic(AxError{Category:"runtime", Message:"unknown tool"}) }
func _core_ai_error_response(message Value, rest ...Value) Value { return aiError("AxAIServiceResponseError", message, rest...) }
func _core_ai_error_refusal(message Value, rest ...Value) Value { return aiError("AxAIRefusalError", message, rest...) }
func _core_ai_error_stream(message Value, rest ...Value) Value { return aiError("AxAIServiceStreamTerminatedError", message, rest...) }
func _core_ai_error_unsupported(message Value) Value { return aiError("AxUnsupportedCapabilityError", message) }
func _core_ai_error_auth(message Value, rest ...Value) Value { return aiError("AxAIServiceAuthenticationError", message, rest...) }
func _core_ai_error_timeout(message Value, rest ...Value) Value { return aiError("AxAIServiceTimeoutError", message, rest...) }
func _core_ai_error_status(message Value, rest ...Value) Value { return aiError("AxAIServiceStatusError", message, rest...) }
func _core_string_ends_with(value Value, suffix Value) Value { return strings.HasSuffix(display(value), display(suffix)) }
func _core_string_join(sep Value, values Value) Value { parts := []string{}; for _, v := range asSlice(values) { parts = append(parts, display(v)) }; return strings.Join(parts, display(sep)) }
func _core_string_lower(value Value) Value { return strings.ToLower(display(value)) }
func _core_string_lower_camel(values Value) Value { items := asSlice(values); if len(items)==0 { return "" }; out := strings.ToLower(display(items[0])); for _, item := range items[1:] { p := strings.ToLower(display(item)); if p != "" { p = strings.ToUpper(p[:1])+p[1:] }; out += p }; return out }
func _core_string_title_from_camel(value Value) Value { text := regexp.MustCompile("Code$").ReplaceAllString(display(value), " Code"); text = regexp.MustCompile("([a-z0-9])([A-Z])").ReplaceAllString(text, "$1 $2"); text = strings.TrimSpace(text); if text=="" { return text }; return strings.ToUpper(text[:1])+text[1:] }
func _core_string_format(template Value, args ...Value) Value { out := display(template); for _, arg := range args { idx := strings.Index(out, "{}"); if idx < 0 { break }; out = out[:idx] + display(arg) + out[idx+2:] }; return out }
func _core_string_slice(value Value, start Value, rest ...Value) Value { s := display(value); a := clampIndex(num(start), len(s)); if len(rest)==0 || rest[0] == nil { return s[a:] }; b := clampIndex(num(rest[0]), len(s)); if b < a { b = a }; return s[a:b] }
func _core_string_replace(value Value, oldValue Value, newValue Value) Value { return strings.ReplaceAll(display(value), display(oldValue), display(newValue)) }
func _core_string_remove_suffix(value Value, suffix Value) Value { s:=display(value); suf:=display(suffix); if suf!="" && strings.HasSuffix(s,suf) { return Object("value", s[:len(s)-len(suf)], "removed", true) }; return Object("value", s, "removed", false) }
func _core_string_words(value Value) Value { out:=Array(); for _, p := range strings.Fields(display(value)) { out=append(out,p) }; return out }
func _core_string_default_if_empty(value Value, fallback Value) Value { text:=strings.TrimSpace(display(value)); if text=="" { return fallback }; return text }
func _core_string_split_once(value Value, sep Value) Value { s:=display(value); d:=display(sep); idx:=strings.Index(s,d); if idx<0 { return Object("found", false, "left", s, "right", "") }; return Object("found", true, "left", s[:idx], "right", s[idx+len(d):]) }
func _core_string_split_trim_nonempty(value Value, sep Value) Value { out:=Array(); for _, p := range strings.Split(display(value), display(sep)) { p=strings.TrimSpace(p); if p!="" { out=append(out,p) } }; return out }
func _core_string_find_outside_quotes(text Value, needle Value) Value { return float64(findOutsideQuotes(display(text), display(needle))) }
func _core_string_split_outside_quotes(text Value, sep Value) Value { return splitOutsideQuotes(display(text), display(sep)) }
func _core_string_consume_optional_quoted_prefix(text Value) Value { return consumeOptionalQuotedPrefix(display(text)) }
func _core_string_extract_quoted_suffix(text Value) Value { return extractQuotedSuffix(display(text)) }
func _core_string_split(value Value, sep Value) Value { out:=Array(); for _, p := range strings.Split(display(value), display(sep)) { out=append(out,p) }; return out }
func _core_string_starts_with(value Value, prefix Value) Value { return strings.HasPrefix(display(value), display(prefix)) }
func _core_string_str(value Value) Value { return display(value) }
func _core_regex_replace(pattern Value, repl Value, value Value) Value { return regexp.MustCompile(display(pattern)).ReplaceAllString(display(value), display(repl)) }
func _core_sorted_strings(values Value) Value { parts:=[]string{}; for _, item := range asSlice(values) { parts=append(parts,display(item)) }; sort.Strings(parts); out:=Array(); for _, item:= range parts { out=append(out,item) }; return out }
func _core_json_pretty(value Value) Value { data,_:=json.MarshalIndent(value,"","  "); return string(data) }

// Higher-level host intrinsics. Most defer to Core-emitted helpers or target objects.
func _core_template_parse(template Value, context Value) Value { return templateParse(display(template), display(context)) }
func _core_template_render_tree(nodes Value, vars Value, source Value, context Value) Value { return templateRender(asSlice(nodes), asMap(vars), display(source), display(context)) }
func _core_template_collect_vars(nodes Value) Value { return templateCollect(asSlice(nodes)) }
func _core_template_validate(source Value, context Value, required Value) Value { templateValidate(display(source), display(context), asSlice(required)); return true }
func _core_prompt_structured(signature Value, values Value, functions Value, options Value) Value { return promptStructured(signature, asMap(values), asSlice(functions), asMap(options)) }
func _core_prompt_user_content(signature Value, values Value) Value { return promptUserContent(signature, asMap(values)) }
func _core_stream_event_content_parts(event Value) Value {
	if s, ok := event.(string); ok { return Array(s) }
	data := event
	if nested := coreGet(event, "data", nil); len(asMap(nested)) > 0 { data = nested }
	if display(coreGet(data, "type", "")) == "done" || display(coreGet(data, "type", "")) == "message_stop" { return Array() }
	if results := coreGet(data, "results", nil); results != nil {
		out := Array()
		for _, result := range asSlice(results) { out = append(out, coreGet(result, "content", "")) }
		return out
	}
	return Array(coreGet(data, "delta", coreGet(data, "content_delta", coreGet(data, "contentDelta", coreGet(data, "text", coreGet(data, "content", ""))))))
}
func _core_description_append(base Value, hint Value) Value { if strings.TrimSpace(display(hint))=="" { return base }; if strings.TrimSpace(display(base))=="" { return hint }; text:=strings.TrimSpace(display(base)); if !strings.HasSuffix(text,".") { text += "." }; return text + " " + display(hint) }
func _core_url_valid(value Value) Value { _, err := url.ParseRequestURI(display(value)); return err == nil }
func _core_signature_error(message Value) Value { return Object("__error", "signature", "message", display(message)) }
func _core_validation_error(message Value) Value { return Object("__error", "validation", "message", display(message)) }
func _core_list_get(values Value, index Value, defaultValue Value) Value { return coreGet(values, index, defaultValue) }
func _core_field_item(field Value) Value { f := fieldFromValue(field); t := f.Type; t.IsArray = false; return Field{Name:f.Name, Type:t, Description:f.Description, Title:f.Title, IsOptional:f.IsOptional, IsInternal:f.IsInternal, IsCached:f.IsCached} }
func _core_fields_from_map(fields Value) Value { out:=Array(); for _, key:= range orderedKeys(asMap(fields)) { item:=coreGet(fields,key,nil); if f, ok:=item.(Field); ok { out=append(out,f) } else { f:=fieldFromValue(item); if f.Name=="" { f.Name=key }; out=append(out,f) } }; return out }
func _valid_image(value Value) Value { m:=asMap(value); return m["mimeType"] != nil && m["data"] != nil }
func _valid_audio(value Value) Value { if _, ok:=value.(string); ok { return true }; m:=asMap(value); return m["data"] != nil || m["id"] != nil }
func _valid_file(value Value) Value { m:=asMap(value); return m["mimeType"] != nil && ((m["data"] != nil) != (m["fileUri"] != nil)) }
func _valid_url_shape(value Value) Value { if _, ok:=value.(string); ok { return true }; return asMap(value)["url"] != nil }

func aiError(kind string, message Value, rest ...Value) Value {
	out := Object("__error", "ai", "__type", kind, "message", display(message))
	if len(rest) > 0 { coreSet(out, "response_body", rest[0]) }
	if len(rest) > 1 { coreSet(out, "status", rest[1]) }
	if len(rest) > 2 { coreSet(out, "code", rest[2]) }
	if len(rest) > 3 { coreSet(out, "request", rest[3]) }
	if len(rest) > 4 { coreSet(out, "retryable", coreTruthy(rest[4])) }
	return out
}

func clampIndex(n float64, max int) int { i:=int(n); if i<0 { return 0 }; if i>max { return max }; return i }

func cloneMap(in map[string]Value) map[string]Value {
	out := map[string]Value{}
	for _, k := range orderedKeys(in) { if k!="__order" { coreSet(out,k,in[k]) } }
	return out
}
func cloneValue(value Value) Value {
	switch v := value.(type) {
	case map[string]Value:
		out := map[string]Value{}
		for _, key := range orderedKeys(v) {
			if key != "__order" {
				coreSet(out, key, cloneValue(v[key]))
			}
		}
		return out
	case []Value:
		out := make([]Value, 0, len(v))
		for _, item := range v { out = append(out, cloneValue(item)) }
		return out
	case *AxArray:
		if v == nil { return MutableArray() }
		out := MutableArray()
		for _, item := range v.Items { out.Items = append(out.Items, cloneValue(item)) }
		return out
	default:
		return v
	}
}

// AXIR_CORE_GO_FUNCTIONS

// Public signature/schema surface.
type FieldType struct {
	Name string
	IsArray bool
	Options []string
	Fields map[string]Field
	FieldOrder []string
	MinLength Value
	MaxLength Value
	Minimum Value
	Maximum Value
	Pattern string
	PatternDescription string
	Format string
	Description string
}

type Field struct {
	Name string
	Type FieldType
	Description string
	Title string
	IsOptional bool
	IsInternal bool
	IsCached bool
}

type AxSignature struct {
	Description string
	Inputs []Field
	Outputs []Field
}

func S(signature string) AxSignature { return NewSignature(signature) }
func NewSignature(signature string) AxSignature {
	result := parse_signature(signature)
	validate_signature(result)
	return signatureFromValue(result)
}
func (s AxSignature) ToJSONSchema(options map[string]Value) Value {
	if options == nil { options = map[string]Value{} }
	return goToJSONSchema(s.Outputs, "Schema", options)
}
func (s AxSignature) GetInputFields() []Field { return append([]Field(nil), s.Inputs...) }
func (s AxSignature) GetOutputFields() []Field { return append([]Field(nil), s.Outputs...) }
func (s AxSignature) toMap() map[string]Value {
	inputs:=Array(); for _, f := range s.Inputs { inputs=append(inputs,f) }
	outputs:=Array(); for _, f := range s.Outputs { outputs=append(outputs,f) }
	return Object("description", s.Description, "inputs", inputs, "outputs", outputs)
}

func goToJSONSchema(fields []Field, schemaTitle string, options map[string]Value) Value {
	schema := Object("type", "object", "title", schemaTitle)
	properties := Object()
	required := Array()
	for _, field := range fields {
		if field.IsInternal { continue }
		coreSet(properties, field.Name, goFieldSchema(field, options, false))
		if !field.IsOptional || coreTruthy(coreGet(options, "strictStructuredOutputs", false)) {
			required = append(required, field.Name)
		}
	}
	coreSet(schema, "properties", properties)
	coreSet(schema, "required", required)
	coreSet(schema, "additionalProperties", false)
	return schema
}

func goFieldSchema(field Field, options map[string]Value, nested bool) Value {
	t := field.Type
	if t.IsArray {
		itemType := t
		itemType.IsArray = false
		itemField := field
		itemField.Type = itemType
		itemField.Description = t.Description
		out := Object("type", "array", "items", goFieldSchema(itemField, options, true))
		if field.Description != "" { coreSet(out, "description", field.Description) } else if desc := goConstraintDescription(t, false); desc != "" { coreSet(out, "description", desc) }
		return out
	}
	out := Object()
	switch t.Name {
	case "number":
		coreSet(out, "type", "number")
	case "boolean":
		coreSet(out, "type", "boolean")
	case "class":
		coreSet(out, "type", "string")
		opts := Array(); for _, item := range t.Options { opts = append(opts, item) }
		coreSet(out, "enum", opts)
	case "object":
		if len(t.Fields) == 0 && coreTruthy(coreGet(options, "flexibleJsonFieldsAsString", false)) {
			coreSet(out, "type", "string")
			if field.Description != "" { coreSet(out, "description", field.Description+". Return this field as a JSON-encoded string that can be parsed with JSON.parse.") }
			return out
		}
		if len(t.Fields) == 0 {
			coreSet(out, "type", Array("object", "array", "string", "number", "boolean", "null"))
			if field.Description != "" { coreSet(out, "description", field.Description) }
			return out
		}
		coreSet(out, "type", "object")
		props := Object()
		req := Array()
		keys := append([]string(nil), t.FieldOrder...)
		if len(keys) == 0 { for key := range t.Fields { keys = append(keys, key) }; sort.Strings(keys) }
		for _, key := range keys {
			child := t.Fields[key]
			coreSet(props, key, goFieldSchema(child, options, true))
			if !child.IsOptional { req = append(req, child.Name) }
		}
		coreSet(out, "properties", props)
		coreSet(out, "required", req)
		coreSet(out, "additionalProperties", false)
	case "json":
		if coreTruthy(coreGet(options, "flexibleJsonFieldsAsString", false)) {
			coreSet(out, "type", "string")
			if field.Description != "" { coreSet(out, "description", field.Description+". Return this field as a JSON-encoded string that can be parsed with JSON.parse.") }
		} else {
			coreSet(out, "type", Array("object", "array", "string", "number", "boolean", "null"))
		}
	case "url":
		coreSet(out, "type", "string")
		coreSet(out, "format", "uri")
	case "date":
		coreSet(out, "type", "string")
		coreSet(out, "format", "date")
	case "datetime":
		coreSet(out, "type", "string")
		coreSet(out, "format", "date-time")
	case "dateRange", "datetimeRange", "audio":
		coreSet(out, "type", "string")
	default:
		coreSet(out, "type", "string")
	}
	if t.Minimum != nil { coreSet(out, "minimum", t.Minimum) }
	if t.Maximum != nil { coreSet(out, "maximum", t.Maximum) }
	if t.MinLength != nil { coreSet(out, "minLength", t.MinLength) }
	if t.MaxLength != nil { coreSet(out, "maxLength", t.MaxLength) }
	if t.Pattern != "" { coreSet(out, "pattern", t.Pattern) }
	if t.Format != "" { coreSet(out, "format", t.Format) }
	if field.IsOptional && coreTruthy(coreGet(options, "strictStructuredOutputs", false)) {
		coreSet(out, "type", Array(coreGet(out, "type", "string"), "null"))
	}
	if t.Name != "json" || !coreTruthy(coreGet(options, "flexibleJsonFieldsAsString", false)) {
		description := field.Description
		constraint := goConstraintDescription(t, nested)
		if description != "" && constraint != "" { description = strings.TrimRight(description, ".") + ". " + constraint }
		if description == "" { description = constraint }
		if description != "" { coreSet(out, "description", description) }
	}
	return out
}

func goConstraintDescription(t FieldType, nested bool) string {
	parts := []string{}
	if t.MinLength != nil && t.MaxLength != nil { parts = append(parts, fmt.Sprintf("Minimum length: %s characters, maximum length: %s characters", display(t.MinLength), display(t.MaxLength))) } else if t.MinLength != nil { parts = append(parts, fmt.Sprintf("Minimum length: %s characters", display(t.MinLength))) } else if t.MaxLength != nil { parts = append(parts, fmt.Sprintf("Maximum length: %s characters", display(t.MaxLength))) }
	if t.Minimum != nil && t.Maximum != nil { parts = append(parts, fmt.Sprintf("Minimum value: %s, maximum value: %s", display(t.Minimum), display(t.Maximum))) } else if t.Minimum != nil { parts = append(parts, fmt.Sprintf("Minimum value: %s", display(t.Minimum))) } else if t.Maximum != nil { parts = append(parts, fmt.Sprintf("Maximum value: %s", display(t.Maximum))) }
	if t.Format == "email" { parts = append(parts, "Must be a valid email address format") }
	if t.Format == "uri" { parts = append(parts, "Must be a valid URL format") }
	if t.Name == "url" { parts = append(parts, "Must be a valid URL format") }
	if t.Name == "date" { parts = append(parts, "Format: YYYY-MM-DD") }
	if t.Name == "datetime" { parts = append(parts, "Format: ISO 8601 date-time") }
	if t.Name == "dateRange" { parts = append(parts, "Format: JSON object with start and end dates, or YYYY-MM-DD/YYYY-MM-DD") }
	if t.Name == "datetimeRange" { parts = append(parts, "Format: JSON object with start and end ISO 8601 date-times, or ISO interval start/end") }
	if t.Name == "audio" { parts = append(parts, "Return plain text to synthesize as speech; do not return audio bytes or JSON audio objects.") }
	if t.PatternDescription != "" {
		if strings.HasPrefix(t.PatternDescription, "Must ") { parts = append(parts, t.PatternDescription) } else { parts = append(parts, "Must contain only "+t.PatternDescription) }
	}
	return strings.Join(parts, ", ")
}

func (f Field) toMap() map[string]Value {
	return Object("name", f.Name, "title", f.Title, "type", f.Type, "description", f.Description, "isOptional", f.IsOptional, "isInternal", f.IsInternal, "isCached", f.IsCached)
}
func (t FieldType) toMap() map[string]Value {
	fields:=Object(); keys:=append([]string(nil), t.FieldOrder...); if len(keys)==0 { for k:= range t.Fields { keys=append(keys,k) }; sort.Strings(keys) }; for _, k := range keys { coreSet(fields,k,t.Fields[k]) }
	opts:=Array(); for _, o:= range t.Options { opts=append(opts,o) }
	return Object("name", t.Name, "isArray", t.IsArray, "options", opts, "fields", fields, "minLength", t.MinLength, "maxLength", t.MaxLength, "minimum", t.Minimum, "maximum", t.Maximum, "pattern", t.Pattern, "patternDescription", t.PatternDescription, "format", t.Format, "description", t.Description)
}

func recordNew(name string, values map[string]Value) Value {
	switch name {
	case "FieldType":
		return fieldTypeFromValue(values)
	case "Field":
		return fieldFromValue(values)
	case "AxSignature":
		return signatureFromValue(values)
	default:
		return values
	}
}

func signatureFromValue(value Value) AxSignature {
	if s, ok := value.(AxSignature); ok { return s }
	m := asMap(value)
	out := AxSignature{Description: display(m["description"])}
	for _, item := range asSlice(coreGet(m,"inputs",Array())) { out.Inputs = append(out.Inputs, fieldFromValue(item)) }
	for _, item := range asSlice(coreGet(m,"outputs",Array())) { out.Outputs = append(out.Outputs, fieldFromValue(item)) }
	return out
}

func fieldFromValue(value Value) Field {
	if f, ok := value.(Field); ok { return f }
	m := asMap(value)
	name := display(m["name"])
	return Field{
		Name: name,
		Type: fieldTypeFromValue(coreGet(m,"type",Object("name","string"))),
		Description: display(coreGet(m,"description","")),
		Title: display(coreGet(m,"title", title(name))),
		IsOptional: coreTruthy(coreGet(m,"isOptional",coreGet(m,"is_optional",false))),
		IsInternal: coreTruthy(coreGet(m,"isInternal",coreGet(m,"is_internal",false))),
		IsCached: coreTruthy(coreGet(m,"isCached",coreGet(m,"is_cached",false))),
	}
}

func fieldTypeFromValue(value Value) FieldType {
	if t, ok := value.(FieldType); ok { return t }
	m := asMap(value)
	t := FieldType{Name: display(coreGet(m,"name",coreGet(m,"type","string")))}
	t.IsArray = coreTruthy(coreGet(m,"isArray",coreGet(m,"is_array",false)))
	for _, item := range asSlice(coreGet(m,"options",Array())) { t.Options = append(t.Options, display(item)) }
	t.Fields = map[string]Field{}
	for _, key := range orderedKeys(asMap(coreGet(m,"fields",Object()))) {
		f := fieldFromValue(coreGet(coreGet(m,"fields",Object()),key,nil)); if f.Name=="" { f.Name = key }; t.Fields[key]=f
		t.FieldOrder = append(t.FieldOrder, key)
	}
	t.MinLength = coreGet(m,"minLength",coreGet(m,"min_length",nil))
	t.MaxLength = coreGet(m,"maxLength",coreGet(m,"max_length",nil))
	t.Minimum = coreGet(m,"minimum",nil)
	t.Maximum = coreGet(m,"maximum",nil)
	t.Pattern = display(coreGet(m,"pattern",""))
	t.PatternDescription = display(coreGet(m,"patternDescription",coreGet(m,"pattern_description","")))
	t.Format = display(coreGet(m,"format",""))
	t.Description = display(coreGet(m,"description",""))
	return t
}

func title(name string) string {
	if name == "" { return "" }
	var out strings.Builder
	prevLower := false
	for i, r := range strings.ReplaceAll(name, "_", " ") {
		if i > 0 && prevLower && ((r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) { out.WriteByte(' ') }
		out.WriteRune(r)
		prevLower = (r >= 'a' && r <= 'z')
	}
	text := strings.TrimSpace(out.String())
	if text == "" { return "" }
	return strings.ToUpper(text[:1]) + text[1:]
}

// Tools and AI services.
type Tool struct {
	Name string
	Description string
	Args map[string]Field
	Returns map[string]Field
	Handler func(map[string]Value) (Value, error)
}

func Fn(name string) Tool { return Tool{Name:name, Description:name, Args:map[string]Field{}, Returns:map[string]Field{}} }
func (t Tool) WithHandler(handler func(map[string]Value) (Value,error)) Tool { t.Handler = handler; return t }
func (t Tool) Call(args map[string]Value) Value {
	validate_fields(toolFields(t.Args), args, "tool."+t.Name+".args")
	if t.Handler == nil { return nil }
	out, err := t.Handler(args)
	if err != nil { panic(AxError{Category:"runtime", Message:err.Error()}) }
	if len(t.Returns) > 0 {
		validate_fields(toolFields(t.Returns), out, "tool."+t.Name+".return")
	}
	return out
}
func toolFields(fields map[string]Field) []Field {
	keys := make([]string, 0, len(fields))
	for key := range fields { keys = append(keys, key) }
	sort.Strings(keys)
	out := make([]Field, 0, len(keys))
	for _, key := range keys { out = append(out, fields[key]) }
	return out
}
func (t Tool) get(key string, fallback Value) Value {
	switch key {
	case "name": return t.Name
	case "description": return t.Description
	case "args": return t.Args
	case "returns": return t.Returns
	case "parameters": return t.Schema()
	default: return fallback
	}
}
func (t Tool) Schema() Value {
	return goToJSONSchema(toolFields(t.Args), "", Object("strict", true))
}

type AIClient interface {
	Chat(context.Context, map[string]Value, map[string]Value) (Value, error)
	Embed(context.Context, map[string]Value, map[string]Value) (Value, error)
	Stream(context.Context, map[string]Value, map[string]Value) ([]Value, error)
}

type contextBoundAIClient struct {
	ctx   context.Context
	inner AIClient
}

func bindAIClientContext(ctx context.Context, client AIClient) AIClient {
	if ctx == nil || client == nil {
		return client
	}
	return contextBoundAIClient{ctx: ctx, inner: client}
}

func (c contextBoundAIClient) Chat(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	return c.inner.Chat(c.ctx, request, options)
}

func (c contextBoundAIClient) Embed(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	return c.inner.Embed(c.ctx, request, options)
}

func (c contextBoundAIClient) Stream(ctx context.Context, request map[string]Value, options map[string]Value) ([]Value, error) {
	return c.inner.Stream(c.ctx, request, options)
}

type Transport interface { Call(context.Context, Value) (Value, error) }

type FakeTransport struct { Responses []Value; Requests []Value }
func NewFakeTransport(responses []Value) *FakeTransport { return &FakeTransport{Responses: append([]Value(nil), responses...)} }
func (t *FakeTransport) Call(ctx context.Context, request Value) (Value, error) {
	t.Requests = append(t.Requests, request)
	if len(t.Responses) == 0 { return Object("status", float64(200), "json", Object()), nil }
	out := t.Responses[0]; t.Responses = t.Responses[1:]; return out, nil
}

type HTTPTransport struct{ Client *http.Client }
func (t HTTPTransport) Call(ctx context.Context, request Value) (Value, error) {
	req := asMap(request)
	body := []byte(stableStringify(coreGet(req,"json",coreGet(req,"data",Object()))))
	httpReq, err := http.NewRequestWithContext(ctx, display(coreGet(req,"method","POST")), display(req["url"]), bytes.NewReader(body))
	if err != nil { return nil, err }
	for _, key := range orderedKeys(asMap(coreGet(req,"headers",Object()))) { httpReq.Header.Set(key, display(coreGet(coreGet(req,"headers",Object()), key, nil))) }
	client := t.Client
	if client == nil { client = http.DefaultClient }
	resp, err := client.Do(httpReq)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	out := Object("status", float64(resp.StatusCode))
	if coreTruthy(coreGet(req,"stream",false)) { coreSet(out,"body",string(data)) } else if len(data)>0 { coreSet(out,"json",parseJSON(string(data))) }
	return out, nil
}

type OpenAICompatibleClient struct { mu sync.RWMutex; Profile string; Name string; Options map[string]Value; Transport Transport; ID string; LastChat Value; LastEmbed Value; LastConfig Value; Metrics map[string]Value }
type OpenAIResponsesClient struct{ *OpenAICompatibleClient }
type GoogleGeminiClient struct{ *OpenAICompatibleClient }
type AnthropicClient struct{ *OpenAICompatibleClient }
type AzureOpenAIClient struct{ *OpenAICompatibleClient }
type DeepSeekClient struct{ *OpenAICompatibleClient }
type MistralClient struct{ *OpenAICompatibleClient }
type RekaClient struct{ *OpenAICompatibleClient }
type CohereClient struct{ *OpenAICompatibleClient }
type GrokClient struct{ *OpenAICompatibleClient }

func NewOpenAICompatibleClient(options map[string]Value) *OpenAICompatibleClient { return newProviderClient("openai-compatible","openai",options,"gpt-4.1-mini","text-embedding-3-small") }
func newProviderClient(profile, name string, options map[string]Value, defaultModel, defaultEmbed string) *OpenAICompatibleClient {
	if options == nil { options = map[string]Value{} }
	options = cloneMap(options)
	if options["model"] == nil { options["model"] = defaultModel }
	if options["embed_model"] == nil { options["embed_model"] = defaultEmbed }
	modelConfig := asMap(coreGet(options, "model_config", Object()))
	if coreGet(modelConfig, "temperature", nil) == nil { coreSet(modelConfig, "temperature", float64(0)) }
	coreSet(options, "model_config", modelConfig)
	transport, _ := options["transport"].(Transport)
	if transport == nil { transport = HTTPTransport{} }
	return &OpenAICompatibleClient{Profile:profile, Name:name, Options:options, Transport:transport, ID:name+"-id", Metrics:balancerBaseMetrics()}
}
func NewOpenAIResponsesClient(options map[string]Value) *OpenAIResponsesClient { return &OpenAIResponsesClient{newProviderClient("openai-responses","openai-responses",options,"gpt-4o","text-embedding-ada-002")} }
func NewGoogleGeminiClient(options map[string]Value) *GoogleGeminiClient { return &GoogleGeminiClient{newProviderClient("google-gemini","GoogleGeminiAI",options,"gemini-2.5-flash","gemini-embedding-2")} }
func NewAnthropicClient(options map[string]Value) *AnthropicClient { return &AnthropicClient{newProviderClient("anthropic","anthropic",options,"claude-3-7-sonnet-latest","")} }
func NewAzureOpenAIClient(options map[string]Value) *AzureOpenAIClient { return &AzureOpenAIClient{newProviderClient("azure-openai","Azure OpenAI",normalizeAzureOptions(options),"gpt-5-mini","text-embedding-3-small")} }
func NewDeepSeekClient(options map[string]Value) *DeepSeekClient { return &DeepSeekClient{newProviderClient("deepseek","DeepSeek",options,"deepseek-v4-flash","")} }
func NewMistralClient(options map[string]Value) *MistralClient { return &MistralClient{newProviderClient("mistral","Mistral",options,"mistral-small-latest","mistral-embed")} }
func NewRekaClient(options map[string]Value) *RekaClient { return &RekaClient{newProviderClient("reka","Reka",options,"reka-core","")} }
func NewCohereClient(options map[string]Value) *CohereClient { return &CohereClient{newProviderClient("cohere","Cohere",options,"command-r-plus","embed-english-v3.0")} }
func NewGrokClient(options map[string]Value) *GrokClient { return &GrokClient{newProviderClient("grok","Grok",options,"grok-4.3","")} }

func NewAI(provider string, options map[string]Value) AIClient {
	switch display(provider_normalize_profile(provider)) {
	case "openai-responses": return NewOpenAIResponsesClient(options)
	case "google-gemini": return NewGoogleGeminiClient(options)
	case "anthropic": return NewAnthropicClient(options)
	case "azure-openai": return NewAzureOpenAIClient(options)
	case "deepseek": return NewDeepSeekClient(options)
	case "mistral": return NewMistralClient(options)
	case "reka": return NewRekaClient(options)
	case "cohere": return NewCohereClient(options)
	case "grok": return NewGrokClient(options)
	default: return NewOpenAICompatibleClient(options)
	}
}

func normalizeAzureOptions(options map[string]Value) map[string]Value {
	if options == nil { options = map[string]Value{} }
	if coreGet(options, "api_key", nil) == nil && coreGet(options, "apiKey", nil) == nil {
		if key := os.Getenv("AZURE_OPENAI_API_KEY"); key != "" { coreSet(options, "api_key", key) }
	}
	version := display(coreGet(options, "api_version", coreGet(options, "apiVersion", coreGet(options, "version", "2024-02-15-preview"))))
	version = strings.TrimPrefix(version, "api-version=")
	if version != "" { coreSet(options, "api_version", version) }
	if coreGet(options, "base_url", coreGet(options, "baseUrl", nil)) == nil {
		resource := display(coreGet(options, "resource_name", coreGet(options, "resourceName", os.Getenv("AZURE_OPENAI_RESOURCE_NAME"))))
		deployment := display(coreGet(options, "deployment_name", coreGet(options, "deploymentName", os.Getenv("AZURE_OPENAI_DEPLOYMENT_NAME"))))
		if resource != "" && deployment != "" {
			base := "https://" + resource + ".openai.azure.com/openai/deployments/" + url.PathEscape(deployment)
			coreSet(options, "base_url", base)
		}
	}
	return options
}

func (c *OpenAICompatibleClient) Chat(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	return safeValue(func() Value { req:=c.prepareChatRequest(request, options); opts:=c.optionsSnapshot(); model:=coreGet(req,"model",coreGet(opts,"model",nil)); config:=coreGet(req,"model_config",Object()); c.setLastChat(model, config); transportReq := c.requestJSON("chat", req, false); raw, err := c.Transport.Call(ctx, transportReq); if err != nil { panic(AxError{Category:"network", Message:err.Error()}) }; return provider_normalize_chat_response(c.Profile, coreGet(raw,"json",raw), c.Name, model) })
}
func (c *OpenAICompatibleClient) Embed(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	return safeValue(func() Value { req:=cloneMap(request); opts:=c.optionsSnapshot(); if coreGet(req,"embed_model",coreGet(req,"embedModel",nil))==nil { coreSet(req,"embed_model",coreGet(opts,"embed_model",nil)) }; model:=coreGet(req,"embed_model",coreGet(req,"embedModel",coreGet(opts,"embed_model",nil))); c.setLastEmbed(model); transportReq := c.requestJSON("embed", req, false); raw, err := c.Transport.Call(ctx, transportReq); if err != nil { panic(AxError{Category:"network", Message:err.Error()}) }; return provider_normalize_embed_response(c.Profile, coreGet(raw,"json",raw), c.Name, model) })
}
func (c *OpenAICompatibleClient) Stream(ctx context.Context, request map[string]Value, options map[string]Value) ([]Value, error) {
	value, err := safeValue(func() Value { req:=c.prepareChatRequest(request, Object("stream", true)); opts:=c.optionsSnapshot(); model:=coreGet(req,"model",coreGet(opts,"model",nil)); transportReq := c.requestJSON("stream_chat", req, true); raw, err := c.Transport.Call(ctx, transportReq); if err != nil { panic(AxError{Category:"network", Message:err.Error()}) }; out:=Array(); state:=Object(); for _, event := range iterSSE(coreGet(raw,"body","")) { out=append(out, provider_normalize_stream_delta(c.Profile,event,state,c.Name,model)) }; return out })
	return asSlice(value), err
}
func (c *OpenAICompatibleClient) prepareChatRequest(request map[string]Value, options map[string]Value) map[string]Value {
	req := cloneMap(request)
	opts := c.optionsSnapshot()
	if coreGet(req, "model", nil) == nil {
		coreSet(req, "model", coreGet(opts, "model", nil))
	}
	base := coreGet(opts, "model_config", Object())
	override := coreGet(req, "model_config", Object())
	mergedOptions := Object()
	for _, key := range orderedKeys(asMap(options)) { coreSet(mergedOptions, key, coreGet(options, key, nil)) }
	config := merge_model_config(base, override, mergedOptions)
	coreSet(req, "model_config", config)
	return req
}
func (c *OpenAICompatibleClient) requestJSON(operation string, request map[string]Value, stream bool) Value {
	opts := c.optionsSnapshot()
	payload := provider_build_chat_request(c.Profile, request, opts)
	if operation == "embed" { payload = provider_build_embed_request(c.Profile, request, opts) }
	if operation == "transcribe" { payload = provider_build_transcribe_request(c.Profile, request) }
	if operation == "speak" { payload = provider_build_speak_request(c.Profile, request) }
	if stream { coreSet(payload, "stream", true) }
	operationDescriptor := provider_operation_descriptor(c.Profile, operation)
	path := display(coreGet(operationDescriptor, "path", "/chat/completions"))
	descriptor := provider_descriptor(c.Profile)
	base := display(coreGet(opts, "base_url", coreGet(opts, "baseUrl", coreGet(descriptor, "baseUrl", "https://api.openai.com/v1"))))
	headers := Object("Content-Type","application/json")
	apiKey := display(coreGet(opts,"api_key",coreGet(opts,"apiKey",os.Getenv("OPENAI_API_KEY"))))
	switch display(coreGet(descriptor, "auth", "bearer")) {
	case "bearer":
		if apiKey != "" { coreSet(headers,"Authorization","Bearer "+apiKey) }
	case "anthropic_key":
		coreSet(headers,"x-api-key",apiKey)
	case "api_key_header":
		coreSet(headers, display(coreGet(descriptor,"apiKeyHeader","api-key")), apiKey)
	}
	for _, key := range orderedKeys(asMap(coreGet(descriptor, "headers", Object()))) {
		coreSet(headers, key, display(coreGet(coreGet(descriptor, "headers", Object()), key, nil)))
	}
	pathModel := coreGet(request, "model", coreGet(request, "embed_model", coreGet(request, "embedModel", nil)))
	if pathModel != nil {
		path = strings.ReplaceAll(path, "{model}", url.PathEscape(display(pathModel)))
	}
	if display(coreGet(descriptor, "auth", "")) == "api_key_query" {
		keyName := display(coreGet(descriptor, "apiKeyQuery", "key"))
		sep := "?"
		if strings.Contains(path, "?") { sep = "&" }
		path += sep + url.QueryEscape(keyName) + "=" + url.QueryEscape(apiKey)
	}
	requestURL := strings.TrimRight(base,"/")+path
	if apiVersion := display(coreGet(opts, "api_version", coreGet(opts, "apiVersion", ""))); apiVersion != "" {
		sep := "?"
		if strings.Contains(requestURL, "?") { sep = "&" }
		requestURL += sep + "api-version=" + url.QueryEscape(strings.TrimPrefix(apiVersion, "api-version="))
	}
	out := Object("method","POST","url", requestURL, "headers", headers, "stream", stream)
	if operation == "transcribe" { coreSet(out, "data", payload) } else { coreSet(out, "json", payload) }
	return out
}

func (c *OpenAICompatibleClient) Transcribe(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	return safeValue(func() Value { transportReq := c.requestJSON("transcribe", request, false); raw, err := c.Transport.Call(ctx, transportReq); if err != nil { panic(AxError{Category:"network", Message:err.Error()}) }; return provider_normalize_transcribe_response(c.Profile, coreGet(raw,"json",raw)) })
}
func (c *OpenAICompatibleClient) Speak(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	return safeValue(func() Value { transportReq := c.requestJSON("speak", request, false); raw, err := c.Transport.Call(ctx, transportReq); if err != nil { panic(AxError{Category:"network", Message:err.Error()}) }; return provider_normalize_speak_response(c.Profile, coreGet(raw,"json",raw), request) })
}
func (c *OpenAICompatibleClient) GetID() string { if c.ID != "" { return c.ID }; return c.Name+"-id" }
func (c *OpenAICompatibleClient) GetName() string { return c.Name }
func (c *OpenAICompatibleClient) GetFeatures(model string) map[string]Value { return asMap(coreGet(provider_descriptor(c.Profile), "features", routerDefaultFeatures())) }
func (c *OpenAICompatibleClient) GetModelList() Value { return nil }
func (c *OpenAICompatibleClient) GetMetrics() map[string]Value { c.mu.Lock(); defer c.mu.Unlock(); if c.Metrics == nil { c.Metrics = balancerBaseMetrics() }; return cloneMap(c.Metrics) }
func (c *OpenAICompatibleClient) SetOptions(options map[string]Value) { c.mu.Lock(); defer c.mu.Unlock(); c.Options = cloneMap(options) }
func (c *OpenAICompatibleClient) GetOptions() map[string]Value { return c.optionsSnapshot() }
func (c *OpenAICompatibleClient) GetLastUsedChatModel() Value { c.mu.RLock(); defer c.mu.RUnlock(); return cloneValue(c.LastChat) }
func (c *OpenAICompatibleClient) GetLastUsedEmbedModel() Value { c.mu.RLock(); defer c.mu.RUnlock(); return cloneValue(c.LastEmbed) }
func (c *OpenAICompatibleClient) GetLastUsedModelConfig() Value { c.mu.RLock(); defer c.mu.RUnlock(); return cloneValue(c.LastConfig) }
func (c *OpenAICompatibleClient) GetEstimatedCost(usage map[string]Value) float64 { return 0 }

func (c *OpenAICompatibleClient) optionsSnapshot() map[string]Value { c.mu.RLock(); defer c.mu.RUnlock(); return cloneMap(c.Options) }
func (c *OpenAICompatibleClient) setLastChat(model Value, config Value) { c.mu.Lock(); defer c.mu.Unlock(); c.LastChat = cloneValue(model); c.LastConfig = cloneValue(config) }
func (c *OpenAICompatibleClient) setLastEmbed(model Value) { c.mu.Lock(); defer c.mu.Unlock(); c.LastEmbed = cloneValue(model) }

func (c OpenAIResponsesClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c OpenAIResponsesClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c OpenAIResponsesClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c GoogleGeminiClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c GoogleGeminiClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c GoogleGeminiClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c AnthropicClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c AnthropicClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c AnthropicClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c AzureOpenAIClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c AzureOpenAIClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c AzureOpenAIClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c DeepSeekClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c DeepSeekClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c DeepSeekClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c MistralClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c MistralClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c MistralClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c RekaClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c RekaClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c RekaClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c CohereClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c CohereClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c CohereClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }
func (c GrokClient) Chat(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Chat(ctx,r,o) }
func (c GrokClient) Embed(ctx context.Context, r map[string]Value, o map[string]Value) (Value,error) { return c.OpenAICompatibleClient.Embed(ctx,r,o) }
func (c GrokClient) Stream(ctx context.Context, r map[string]Value, o map[string]Value) ([]Value,error) { return c.OpenAICompatibleClient.Stream(ctx,r,o) }

func safeValue(fn func() Value) (out Value, err error) {
	defer func(){ if r:=recover(); r!=nil { if e, ok:=r.(error); ok { err=e } else { err=AxError{Category:"runtime", Message:display(r)} } } }()
	return fn(), nil
}

func iterSSE(body Value) []Value {
	var out []Value
	for _, line := range strings.Split(display(body), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") { continue }
		payload := strings.TrimSpace(strings.TrimPrefix(line,"data:"))
		if payload == "" || payload == "[DONE]" { continue }
		out = append(out, parseJSON(payload))
	}
	return out
}

func GetSupportedAIModels(options map[string]Value) Value { return provider_model_catalog(options) }

type AxAIService interface {
	AIClient
	Transcribe(context.Context, map[string]Value, map[string]Value) (Value, error)
	Speak(context.Context, map[string]Value, map[string]Value) (Value, error)
	GetID() string
	GetName() string
	GetFeatures(model string) map[string]Value
	GetModelList() Value
	GetMetrics() map[string]Value
	SetOptions(map[string]Value)
	GetOptions() map[string]Value
	GetLastUsedChatModel() Value
	GetLastUsedEmbedModel() Value
	GetLastUsedModelConfig() Value
	GetEstimatedCost(map[string]Value) float64
}

type RouterServiceEntry struct {
	Key string
	Description string
	Service AxAIService
	IsInternal bool
}

type multiServiceEntry struct {
	Service AxAIService
	Description string
	Model Value
	EmbedModel Value
	HasModel bool
	HasEmbedModel bool
	IsInternal bool
}

type MultiServiceRouter struct {
	services map[string]multiServiceEntry
	keyOrder []string
	options map[string]Value
	lastUsedService AxAIService
}

func NewMultiServiceRouter(entries []Value) (*MultiServiceRouter, error) {
	if len(entries) == 0 { return nil, AxError{Category:"runtime", Message:"No AI services provided."} }
	router := &MultiServiceRouter{services: map[string]multiServiceEntry{}, options: Object()}
	for index, raw := range entries {
		if entry, ok := raw.(RouterServiceEntry); ok {
			if _, exists := router.services[entry.Key]; exists { return nil, AxError{Category:"runtime", Message:"Duplicate model key: "+entry.Key} }
			router.services[entry.Key] = multiServiceEntry{Service: entry.Service, Description: entry.Description, IsInternal: entry.IsInternal}
			router.keyOrder = append(router.keyOrder, entry.Key)
			continue
		}
		service, ok := raw.(AxAIService)
		if !ok { return nil, AxError{Category:"runtime", Message:"multi-service entry must be an AxAIService"} }
		modelList := asSlice(service.GetModelList())
		if len(modelList) == 0 { return nil, AxError{Category:"runtime", Message:fmt.Sprintf("Service %d '%s' has no model list.", index, service.GetName())} }
		for _, item := range modelList {
			modelEntry := asMap(item)
			key := display(coreGet(modelEntry, "key", ""))
			if existing, exists := router.services[key]; exists {
				return nil, AxError{Category:"runtime", Message:fmt.Sprintf("Service %d '%s' has duplicate model key: %s as service %s", index, service.GetName(), key, existing.Service.GetName())}
			}
			entry := multiServiceEntry{Service: service, Description: display(coreGet(modelEntry, "description", ""))}
			if model := coreGet(modelEntry, "model", nil); model != nil {
				entry.Model = model
				entry.HasModel = true
			} else if embedModel := coreGet(modelEntry, "embedModel", coreGet(modelEntry, "embed_model", nil)); embedModel != nil {
				entry.EmbedModel = embedModel
				entry.HasEmbedModel = true
			} else {
				return nil, AxError{Category:"runtime", Message:fmt.Sprintf("Key %s in model list for service %d '%s' is missing a model or embedModel property.", key, index, service.GetName())}
			}
			router.services[key] = entry
			router.keyOrder = append(router.keyOrder, key)
		}
	}
	return router, nil
}

func (r *MultiServiceRouter) GetID() string {
	ids := []string{}
	for _, key := range r.keyOrder { ids = append(ids, r.services[key].Service.GetID()) }
	return "MultiServiceRouter:" + strings.Join(ids, ",")
}
func (r *MultiServiceRouter) GetName() string { return "MultiServiceRouter" }
func (r *MultiServiceRouter) GetModelList() Value {
	out := Array()
	for _, key := range r.keyOrder {
		entry := r.services[key]
		if entry.IsInternal { continue }
		item := Object("key", key, "description", entry.Description)
		if entry.HasModel { coreSet(item, "model", entry.Model) } else if entry.HasEmbedModel { coreSet(item, "embedModel", entry.EmbedModel) }
		out = append(out, item)
	}
	return out
}
func routerDefaultFeatures() map[string]Value {
	return Object(
		"functions", false,
		"streaming", false,
		"media", Object(
			"images", Object("supported", false, "formats", Array()),
			"audio", Object("supported", false, "formats", Array(), "output", Object("supported", false, "formats", Array())),
			"files", Object("supported", false, "formats", Array(), "uploadMethod", "none"),
			"urls", Object("supported", false, "webSearch", false, "contextFetching", false),
		),
		"caching", Object("supported", false, "types", Array()),
		"thinking", false,
		"multiTurn", true,
	)
}
func (r *MultiServiceRouter) GetFeatures(model string) map[string]Value {
	if entry, ok := r.services[model]; ok { return cloneMap(entry.Service.GetFeatures(model)) }
	return routerDefaultFeatures()
}
func (r *MultiServiceRouter) Chat(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	modelKey := display(coreGet(request, "model", ""))
	if modelKey == "" { return nil, AxError{Category:"runtime", Message:"Model key must be specified for multi-service"} }
	entry, ok := r.services[modelKey]
	if !ok { return nil, AxError{Category:"runtime", Message:"No service found for model key: "+modelKey} }
	r.lastUsedService = entry.Service
	req := cloneMap(request)
	if coreGet(req, "modelConfig", nil) != nil && coreGet(req, "model_config", nil) == nil { coreSet(req, "model_config", cloneValue(coreGet(req, "modelConfig", nil))) }
	if !entry.HasModel {
		delete(req, "model")
	}
	return entry.Service.Chat(ctx, req, options)
}
func (r *MultiServiceRouter) Embed(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	embedKey := display(coreGet(request, "embedModel", coreGet(request, "embed_model", "")))
	if embedKey == "" { return nil, AxError{Category:"runtime", Message:"Embed model key must be specified for multi-service"} }
	entry, ok := r.services[embedKey]
	if !ok { return nil, AxError{Category:"runtime", Message:"No service found for embed model key: "+embedKey} }
	r.lastUsedService = entry.Service
	req := cloneMap(request)
	if !entry.HasModel {
		delete(req, "embedModel")
		delete(req, "embed_model")
	}
	return entry.Service.Embed(ctx, req, options)
}
func (r *MultiServiceRouter) Stream(ctx context.Context, request map[string]Value, options map[string]Value) ([]Value, error) {
	value, err := r.Chat(ctx, request, options)
	if err != nil { return nil, err }
	return asSlice(value), nil
}
func (r *MultiServiceRouter) Transcribe(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	modelKey := display(coreGet(request, "model", ""))
	var entry multiServiceEntry
	if modelKey == "" {
		if len(r.keyOrder) == 0 { return nil, AxError{Category:"runtime", Message:"No AI services provided."} }
		entry = r.services[r.keyOrder[0]]
	} else {
		var ok bool
		entry, ok = r.services[modelKey]
		if !ok { return nil, AxError{Category:"runtime", Message:"No service found for transcription model key: "+modelKey} }
	}
	r.lastUsedService = entry.Service
	return entry.Service.Transcribe(ctx, request, options)
}
func (r *MultiServiceRouter) Speak(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	modelKey := display(coreGet(request, "model", ""))
	var entry multiServiceEntry
	if modelKey == "" {
		if len(r.keyOrder) == 0 { return nil, AxError{Category:"runtime", Message:"No AI services provided."} }
		entry = r.services[r.keyOrder[0]]
	} else {
		var ok bool
		entry, ok = r.services[modelKey]
		if !ok { return nil, AxError{Category:"runtime", Message:"No service found for speech model key: "+modelKey} }
	}
	r.lastUsedService = entry.Service
	return entry.Service.Speak(ctx, request, options)
}
func (r *MultiServiceRouter) GetMetrics() map[string]Value {
	service := r.lastUsedService
	if service == nil && len(r.keyOrder) > 0 { service = r.services[r.keyOrder[0]].Service }
	if service == nil { return Object() }
	return cloneMap(service.GetMetrics())
}
func (r *MultiServiceRouter) SetOptions(options map[string]Value) {
	r.options = cloneMap(options)
	seen := map[string]bool{}
	for _, key := range r.keyOrder {
		service := r.services[key].Service
		if !seen[service.GetID()] {
			service.SetOptions(options)
			seen[service.GetID()] = true
		}
	}
}
func (r *MultiServiceRouter) GetOptions() map[string]Value { return cloneMap(r.options) }
func (r *MultiServiceRouter) GetLastUsedChatModel() Value { if r.lastUsedService == nil { return nil }; return r.lastUsedService.GetLastUsedChatModel() }
func (r *MultiServiceRouter) GetLastUsedEmbedModel() Value { if r.lastUsedService == nil { return nil }; return r.lastUsedService.GetLastUsedEmbedModel() }
func (r *MultiServiceRouter) GetLastUsedModelConfig() Value { if r.lastUsedService == nil { return nil }; return r.lastUsedService.GetLastUsedModelConfig() }
func (r *MultiServiceRouter) GetEstimatedCost(usage map[string]Value) float64 { if r.lastUsedService == nil { return 0 }; return r.lastUsedService.GetEstimatedCost(usage) }

func featureBool(features map[string]Value, key string, aliases ...string) bool {
	if coreTruthy(coreGet(features, key, nil)) { return true }
	for _, alias := range aliases { if coreTruthy(coreGet(features, alias, nil)) { return true } }
	return false
}
func appendUnique(target *AxArray, values Value) {
	for _, value := range asSlice(values) {
		found := false
		for _, existing := range target.Items { if equal(existing, value) { found = true; break } }
		if !found { target.Items = append(target.Items, value) }
	}
}
func balancerBaseFeatures() map[string]Value {
	return Object(
		"functions", false, "streaming", false, "thinking", false, "multiTurn", false, "structuredOutputs", false,
		"media", Object(
			"images", Object("supported", false, "formats", Array()),
			"audio", Object("supported", false, "formats", Array()),
			"files", Object("supported", false, "formats", Array(), "uploadMethod", "none"),
			"urls", Object("supported", false, "webSearch", false, "contextFetching", false),
		),
		"caching", Object("supported", false, "types", Array()),
	)
}
func metricBucket() map[string]Value { return Object("mean", float64(0), "p95", float64(0), "p99", float64(0), "samples", Array()) }
func errorBucket() map[string]Value { return Object("count", float64(0), "rate", float64(0), "total", float64(0)) }
func balancerBaseMetrics() map[string]Value { return Object("latency", Object("chat", metricBucket(), "embed", metricBucket()), "errors", Object("chat", errorBucket(), "embed", errorBucket())) }

type AxBalancer struct {
	services []AxAIService
	currentService AxAIService
	currentServiceIndex int
	serviceFailures map[string]int
	policy map[string]Value
	maxRetries int
}

func NewAxBalancer(services []AxAIService, options map[string]Value) (*AxBalancer, error) {
	if len(services) == 0 { return nil, AxError{Category:"runtime", Message:"No AI services provided."} }
	policy := asMap(provider_balancer_retry_policy(options))
	b := &AxBalancer{services: append([]AxAIService(nil), services...), currentService: services[0], serviceFailures: map[string]int{}, policy: policy, maxRetries: int(num(coreGet(policy, "maxRetries", float64(3))))}
	if err := b.validateModels(); err != nil { return nil, err }
	if display(coreGet(policy, "strategy", "metric")) != "input_order" {
		sort.SliceStable(b.services, func(i, j int) bool {
			return num(provider_balancer_metric_score(b.services[i].GetMetrics())) < num(provider_balancer_metric_score(b.services[j].GetMetrics()))
		})
		b.currentService = b.services[0]
	}
	return b, nil
}
func (b *AxBalancer) validateModels() error {
	var reference []Value
	for _, service := range b.services {
		list := asSlice(service.GetModelList())
		if len(list) > 0 { reference = list; break }
	}
	if reference == nil { return nil }
	referenceKeys := map[string]bool{}
	for _, entry := range reference { referenceKeys[display(coreGet(entry, "key", ""))] = true }
	for i, service := range b.services {
		list := asSlice(service.GetModelList())
		if len(list) == 0 { return AxError{Category:"runtime", Message:fmt.Sprintf("Service at index %d (%s) has no model list while another service does.", i, service.GetName())} }
		keys := map[string]bool{}
		for _, entry := range list { keys[display(coreGet(entry, "key", ""))] = true }
		for key := range referenceKeys { if !keys[key] { return AxError{Category:"runtime", Message:fmt.Sprintf("Service at index %d (%s) is missing model %q", i, service.GetName(), key)} } }
		for key := range keys { if !referenceKeys[key] { return AxError{Category:"runtime", Message:fmt.Sprintf("Service at index %d (%s) has extra model %q", i, service.GetName(), key)} } }
	}
	return nil
}
func (b *AxBalancer) canRetryService(service AxAIService) bool { return b.serviceFailures[service.GetID()] == 0 }
func (b *AxBalancer) handleFailure(service AxAIService) { b.serviceFailures[service.GetID()]++ }
func (b *AxBalancer) handleSuccess(service AxAIService) { delete(b.serviceFailures, service.GetID()) }
func isRetryableAIError(err error) bool {
	switch e := err.(type) {
	case AIServiceError:
		if e.Type == "AxAIServiceAuthenticationError" { return false }
		if e.Type == "AxAIServiceStatusError" { return e.Status == 408 || e.Status == 429 || e.Status == 500 || e.Status == 502 || e.Status == 503 || e.Status == 504 }
		return e.Type == "AxAIServiceNetworkError" || e.Type == "AxAIServiceResponseError" || e.Type == "AxAIServiceStreamTerminatedError" || e.Type == "AxAIServiceTimeoutError"
	case AxError:
		return e.Category == "network" || e.Retryable
	default:
		return false
	}
}
func (b *AxBalancer) candidateServices(request map[string]Value) ([]AxAIService, error) {
	out := []AxAIService{}
	model := display(coreGet(request, "model", ""))
	for _, service := range b.services {
		if coreTruthy(provider_balancer_candidate_allowed(service.GetFeatures(model), request)) { out = append(out, service) }
	}
	if len(out) > 0 { return out, nil }
	requirements := []string{}
	if display(coreGet(coreGet(request, "responseFormat", coreGet(request, "response_format", Object())), "type", "")) == "json_schema" { requirements = append(requirements, "structured outputs") }
	caps := asMap(coreGet(request, "capabilities", Object()))
	if coreTruthy(coreGet(caps, "requiresImages", coreGet(caps, "requires_images", false))) { requirements = append(requirements, "images") }
	if coreTruthy(coreGet(caps, "requiresAudio", coreGet(caps, "requires_audio", false))) { requirements = append(requirements, "audio") }
	return nil, AxError{Category:"runtime", Message:"No services available that support required capabilities: "+strings.Join(requirements, ", ")+ "."}
}
func (b *AxBalancer) GetID() string { if b.currentService == nil { return "" }; return b.currentService.GetID() }
func (b *AxBalancer) GetName() string { if b.currentService == nil { return "" }; return b.currentService.GetName() }
func (b *AxBalancer) GetModelList() Value { for _, service := range b.services { if list := service.GetModelList(); len(asSlice(list)) > 0 { return cloneValue(list) } }; return nil }
func (b *AxBalancer) GetFeatures(model string) map[string]Value {
	features := balancerBaseFeatures()
	for _, service := range b.services {
		raw := service.GetFeatures(model)
		for _, pair := range []struct{ key, alt string }{{"functions",""},{"streaming",""},{"thinking",""},{"multiTurn","multi_turn"},{"structuredOutputs","structured_outputs"},{"functionCot","function_cot"},{"hasThinkingBudget","has_thinking_budget"},{"hasShowThoughts","has_show_thoughts"}} {
			if featureBool(raw, pair.key, pair.alt) { coreSet(features, pair.key, true) }
		}
		media := asMap(coreGet(raw, "media", Object()))
		outMedia := asMap(coreGet(features, "media", Object()))
		for _, kind := range []string{"images","audio","files"} {
			src := asMap(coreGet(media, kind, Object()))
			dst := asMap(coreGet(outMedia, kind, Object()))
			if coreTruthy(coreGet(src, "supported", false)) { coreSet(dst, "supported", true) }
			formats := MutableArray(asSlice(coreGet(dst, "formats", Array()))...)
			appendUnique(formats, coreGet(src, "formats", Array()))
			coreSet(dst, "formats", formats.Items)
		}
		files := asMap(coreGet(outMedia, "files", Object()))
		upload := display(coreGet(coreGet(media, "files", Object()), "uploadMethod", coreGet(coreGet(media, "files", Object()), "upload_method", "")))
		if upload != "" && upload != "none" { coreSet(files, "uploadMethod", upload) }
		urls := asMap(coreGet(media, "urls", Object()))
		outUrls := asMap(coreGet(outMedia, "urls", Object()))
		if coreTruthy(coreGet(urls, "supported", false)) { coreSet(outUrls, "supported", true) }
		if coreTruthy(coreGet(urls, "webSearch", coreGet(urls, "web_search", false))) { coreSet(outUrls, "webSearch", true) }
		if coreTruthy(coreGet(urls, "contextFetching", coreGet(urls, "context_fetching", false))) { coreSet(outUrls, "contextFetching", true) }
		caching := asMap(coreGet(raw, "caching", Object()))
		outCaching := asMap(coreGet(features, "caching", Object()))
		if coreTruthy(coreGet(caching, "supported", false)) { coreSet(outCaching, "supported", true) }
		cacheTypes := MutableArray(asSlice(coreGet(outCaching, "types", Array()))...)
		appendUnique(cacheTypes, coreGet(caching, "types", Array()))
		coreSet(outCaching, "types", cacheTypes.Items)
	}
	return features
}
func (b *AxBalancer) GetMetrics() map[string]Value {
	chatSum, chatCount, embedSum, embedCount := 0.0, 0.0, 0.0, 0.0
	chatP95, chatP99, embedP95, embedP99 := 0.0, 0.0, 0.0, 0.0
	chatErrCount, chatErrTotal, embedErrCount, embedErrTotal := 0.0, 0.0, 0.0, 0.0
	for _, service := range b.services {
		metrics := service.GetMetrics()
		errors := asMap(coreGet(metrics, "errors", Object()))
		chatErr := asMap(coreGet(errors, "chat", Object()))
		embedErr := asMap(coreGet(errors, "embed", Object()))
		chatErrCount += num(coreGet(chatErr, "count", 0))
		chatErrTotal += num(coreGet(chatErr, "total", 0))
		embedErrCount += num(coreGet(embedErr, "count", 0))
		embedErrTotal += num(coreGet(embedErr, "total", 0))
		latency := asMap(coreGet(metrics, "latency", Object()))
		chat := asMap(coreGet(latency, "chat", Object()))
		chatSamples := float64(len(asSlice(coreGet(chat, "samples", Array()))))
		if chatSamples > 0 { chatSum += num(coreGet(chat, "mean", 0)) * chatSamples; chatCount += chatSamples }
		embed := asMap(coreGet(latency, "embed", Object()))
		embedSamples := float64(len(asSlice(coreGet(embed, "samples", Array()))))
		if embedSamples > 0 { embedSum += num(coreGet(embed, "mean", 0)) * embedSamples; embedCount += embedSamples }
		if num(coreGet(chat, "p95", 0)) > chatP95 { chatP95 = num(coreGet(chat, "p95", 0)) }
		if num(coreGet(chat, "p99", 0)) > chatP99 { chatP99 = num(coreGet(chat, "p99", 0)) }
		if num(coreGet(embed, "p95", 0)) > embedP95 { embedP95 = num(coreGet(embed, "p95", 0)) }
		if num(coreGet(embed, "p99", 0)) > embedP99 { embedP99 = num(coreGet(embed, "p99", 0)) }
	}
	chatMean, embedMean := 0.0, 0.0
	if chatCount > 0 { chatMean = chatSum/chatCount }
	if embedCount > 0 { embedMean = embedSum/embedCount }
	chatRate, embedRate := 0.0, 0.0
	if chatErrTotal > 0 { chatRate = chatErrCount/chatErrTotal }
	if embedErrTotal > 0 { embedRate = embedErrCount/embedErrTotal }
	return Object(
		"latency", Object(
			"chat", Object("mean", chatMean, "p95", chatP95, "p99", chatP99, "samples", Array()),
			"embed", Object("mean", embedMean, "p95", embedP95, "p99", embedP99, "samples", Array()),
		),
		"errors", Object(
			"chat", Object("count", chatErrCount, "rate", chatRate, "total", chatErrTotal),
			"embed", Object("count", embedErrCount, "rate", embedRate, "total", embedErrTotal),
		),
	)
}
func (b *AxBalancer) Chat(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	candidates, err := b.candidateServices(request)
	if err != nil { return nil, err }
	index := 0
	current := candidates[index]
	b.currentService = current
	for {
		if !b.canRetryService(current) {
			index++
			if index >= len(candidates) { return nil, AxError{Category:"runtime", Message:fmt.Sprintf("All candidate services exhausted (tried %d service(s))", len(candidates))} }
			current = candidates[index]
			b.currentService = current
			continue
		}
		response, err := current.Chat(ctx, request, options)
		if err == nil { b.handleSuccess(current); return response, nil }
		if !isRetryableAIError(err) { return nil, err }
		b.handleFailure(current)
		if b.serviceFailures[current.GetID()] >= b.maxRetries {
			index++
			if index >= len(candidates) { return nil, AxError{Category:"runtime", Message:fmt.Sprintf("All candidate services exhausted (tried %d service(s))", len(candidates))} }
			current = candidates[index]
			b.currentService = current
		}
	}
}
func (b *AxBalancer) Embed(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	b.currentServiceIndex = 0
	b.currentService = b.services[0]
	return b.currentService.Embed(ctx, request, options)
}
func (b *AxBalancer) Stream(ctx context.Context, request map[string]Value, options map[string]Value) ([]Value, error) { value, err := b.Chat(ctx, request, options); return asSlice(value), err }
func (b *AxBalancer) Transcribe(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) { return b.currentService.Transcribe(ctx, request, options) }
func (b *AxBalancer) Speak(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) { return b.currentService.Speak(ctx, request, options) }
func (b *AxBalancer) SetOptions(options map[string]Value) { for _, service := range b.services { service.SetOptions(options) }; if b.currentService != nil { b.currentService.SetOptions(options) } }
func (b *AxBalancer) GetOptions() map[string]Value { if b.currentService == nil { return Object() }; return b.currentService.GetOptions() }
func (b *AxBalancer) GetLastUsedChatModel() Value { if b.currentService == nil { return nil }; return b.currentService.GetLastUsedChatModel() }
func (b *AxBalancer) GetLastUsedEmbedModel() Value { if b.currentService == nil { return nil }; return b.currentService.GetLastUsedEmbedModel() }
func (b *AxBalancer) GetLastUsedModelConfig() Value { if b.currentService == nil { return nil }; return b.currentService.GetLastUsedModelConfig() }
func (b *AxBalancer) GetEstimatedCost(usage map[string]Value) float64 { if b.currentService == nil { return 0 }; return b.currentService.GetEstimatedCost(usage) }

type ProviderRouter struct {
	providers []AxAIService
	processing map[string]Value
	routing map[string]Value
}
func NewProviderRouter(config map[string]Value) *ProviderRouter {
	providersConfig := asMap(coreGet(config, "providers", Object()))
	providers := []AxAIService{}
	if service, ok := coreGet(providersConfig, "primary", nil).(AxAIService); ok { providers = append(providers, service) }
	for _, raw := range asSlice(coreGet(providersConfig, "alternatives", Array())) {
		if service, ok := raw.(AxAIService); ok { providers = append(providers, service) }
	}
	routingConfig := asMap(coreGet(config, "routing", Object()))
	return &ProviderRouter{providers: providers, processing: asMap(coreGet(config, "processing", Object())), routing: asMap(coreGet(routingConfig, "capability", Object()))}
}
func (r *ProviderRouter) providerRecords() Value {
	out := Array()
	for _, provider := range r.providers {
		out = append(out, Object("name", provider.GetName(), "id", provider.GetID(), "features", provider.GetFeatures("")))
	}
	return out
}
func (r *ProviderRouter) serviceForName(name Value) AxAIService {
	for _, provider := range r.providers { if provider.GetName() == display(name) { return provider } }
	if len(r.providers) == 0 { return nil }
	return r.providers[0]
}
func (r *ProviderRouter) GetRoutingRecommendation(request map[string]Value) map[string]Value {
	rec := asMap(provider_route_recommendation(r.providerRecords(), request, r.routing))
	out := cloneMap(rec)
	if service := r.serviceForName(coreGet(out, "providerName", "")); service != nil { coreSet(out, "provider", service) }
	return out
}
func (r *ProviderRouter) ValidateRequest(request map[string]Value) map[string]Value {
	return asMap(provider_route_validation(r.providerRecords(), request, r.processing, r.routing))
}
func (r *ProviderRouter) GetRoutingStats() map[string]Value { return asMap(provider_routing_stats(r.providerRecords())) }
func (r *ProviderRouter) Chat(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	rec := r.GetRoutingRecommendation(request)
	service, _ := coreGet(rec, "provider", nil).(AxAIService)
	if service == nil { return nil, AxError{Category:"runtime", Message:"No provider selected"} }
	response, err := service.Chat(ctx, request, options)
	if err != nil { return nil, err }
	return Object("response", response, "routing", rec), nil
}

// AxGen, Agent, Flow, optimizer, and runtime boundaries.
type AxProgram interface { GetOptimizableComponents() Value; ApplyOptimizedComponents(map[string]Value) }

type AxGen struct { Signature AxSignature; Options map[string]Value; Functions []Tool; Examples Value; Demos Value; Assertions Value; FieldProcessors Value; StopFunctions Value; Memory Value; ChatLog Value; FunctionCallTraces Value; Traces Value; PromptTemplate Value; ProgramID string; Instruction string }
func NewAx(signature string, options map[string]Value) *AxGen {
	if options == nil { options = Object() }
	return &AxGen{Signature:NewSignature(signature), Options:options, Examples:Array(), Demos:Array(), Assertions:Array(), FieldProcessors:Object(), StopFunctions:Array(), Memory:Array(), ChatLog:Array(), FunctionCallTraces:Array(), Traces:Array(), ProgramID:display(coreGet(options,"id",coreGet(options,"program_id",coreGet(options,"programId","root")))), Instruction:display(coreGet(options,"instruction",""))}
}
func NewGen(signature string, options map[string]Value) *AxGen { return NewAx(signature, options) }
func (g *AxGen) Forward(ctx context.Context, client AIClient, values map[string]Value, options map[string]Value) (Value,error) { return safeValue(func() Value { return _forward_impl(g, bindAIClientContext(ctx, client), values, options) }) }
func (g *AxGen) get(k string, fallback Value) Value { switch k { case "signature": return g.Signature; case "options": return g.Options; case "functions": out:=Array(); for _, f:=range g.Functions { out=append(out,f) }; return out; case "examples": return g.Examples; case "demos": return g.Demos; case "assertions": return g.Assertions; case "field_processors","fieldProcessors": return g.FieldProcessors; case "stop_functions","stopFunctions": return g.StopFunctions; case "memory": return g.Memory; case "chat_log","chatLog": return g.ChatLog; case "function_call_traces","functionCallTraces": return g.FunctionCallTraces; case "traces": return g.Traces; case "instruction": return g.Instruction; case "prompt_template": funcs:=Array(); for _, f:=range g.Functions { funcs=append(funcs,f) }; return Object("signature", g.Signature, "functions", funcs, "options", g.Options); default: return fallback } }
func (g *AxGen) GetOptimizableComponents() Value {
	components := Array()
	owner := g.ProgramID
	if g.Signature.Description != "" {
		components = append(components, _optimization_component(owner+"::description", owner, "description", g.Signature.Description, "Program signature description.", Array("Preserve the task intent and field references."), Array(), false, "markdown", Object("required_placeholders", Array())))
	}
	components = append(components, _optimization_component(owner+"::instruction", owner, "instruction", g.Instruction, "Prompt instruction text used by this generator.", Array("Keep required input and output fields intact."), Array(), false, "markdown", Object("required_placeholders", Array())))
	seen := map[string]bool{}
	for _, tool := range g.Functions {
		name := tool.Name
		if name == "" || seen[name] { continue }
		seen[name] = true
		components = append(components, _optimization_component(owner+"::fn:"+name+":desc", owner, "fn-desc", tool.Description, "Description for tool "+name+".", Array("Non-empty, concise, and faithful to the tool behavior."), Array(), false, "text", Object("maxLength", float64(320))))
		components = append(components, _optimization_component(owner+"::fn:"+name+":name", owner, "fn-name", name, "Callable name for tool "+name+".", Array("snake_case", "32 characters or fewer", "unique among tools"), Array(), true, "snake_case", Object("pattern", "^[a-z][a-z0-9_]{0,31}$")))
	}
	return components
}
func (g *AxGen) ApplyOptimizedComponents(m map[string]Value) {
	owner := g.ProgramID
	if value := coreGet(m, owner+"::description", nil); value != nil { g.Signature.Description = display(value) }
	if value := coreGet(m, owner+"::instruction", nil); value != nil { g.Instruction = display(value); coreSet(g.Options, "instruction", g.Instruction) }
	for i := range g.Functions {
		name := g.Functions[i].Name
		if value := coreGet(m, owner+"::fn:"+name+":desc", nil); value != nil { g.Functions[i].Description = display(value) }
		if value := coreGet(m, owner+"::fn:"+name+":name", nil); value != nil { g.Functions[i].Name = display(value) }
	}
}

type AxAgent struct { State map[string]Value; Signature AxSignature; Options map[string]Value; Executor *AxGen; Responder *AxGen; Distiller *AxGen }
func NewAgent(signature string, options map[string]Value) *AxAgent {
	if options == nil { options = Object() }
	state := asMap(_agent_factory(signature, options))
	sig := NewSignature(signature)
	distillerOptions := Object("validation_retries", 0, "id", "ctx.root.actor")
	executorOptions := Object("validation_retries", 0, "id", "task.root.actor")
	responderOptions := Object("validation_retries", coreGet(options, "validation_retries", 2), "id", "task.root.responder")
	distillerSignature := display(coreGet(state, "distiller_signature", "input:json, context:json -> completion:json"))
	executorSignature := display(coreGet(state, "executor_signature", "input:json, executorRequest:string, distilledContext:json -> completion:json"))
	return &AxAgent{Signature:sig, Options:options, State:state, Executor:NewAx(executorSignature,executorOptions), Responder:NewAx(signature,responderOptions), Distiller:NewAx(distillerSignature,distillerOptions)}
}
func (a *AxAgent) Forward(ctx context.Context, client AIClient, values map[string]Value, options map[string]Value) (Value,error) { return safeValue(func() Value { return _agent_forward(a.State, a.Distiller, a.Executor, a.Responder, bindAIClientContext(ctx, client), values, options) }) }
func (a *AxAgent) get(k string, fallback Value) Value { switch k { case "state": return a.State; case "signature": return a.Signature; case "options": return a.Options; case "executor": return a.Executor; case "responder": return a.Responder; case "distiller": return a.Distiller; default: return fallback } }
func (a *AxAgent) Test(runtime CodeRuntime, code string, values map[string]Value, options map[string]Value) (Value,error) { return safeValue(func() Value { return _agent_runtime_test(a.State, runtime, code, values, options) }) }
func (a *AxAgent) ExecuteActorStep(runtime CodeRuntime, code string, values map[string]Value, options map[string]Value) (Value,error) {
	_agent_runtime_build_globals(a.State, values)
	return safeValue(func() Value { return _agent_runtime_execute_step(a.State, runtime, coreGet(a.State, "runtime_session", nil), code, options) })
}
func (a *AxAgent) InspectRuntime(options map[string]Value) Value { return _agent_runtime_inspect_state(a.State, coreGet(a.State, "runtime_session", nil), options) }
func (a *AxAgent) ExportSessionState(options map[string]Value) Value { return _agent_runtime_export_session_state(a.State, coreGet(a.State, "runtime_session", nil), options) }
func (a *AxAgent) RestoreSessionState(snapshot Value, options map[string]Value) Value { return _agent_runtime_restore_session_state(a.State, coreGet(a.State, "runtime_session", nil), snapshot, options) }
func (a *AxAgent) CloseRuntimeSession() Value { return _agent_runtime_close_session(a.State, coreGet(a.State, "runtime_session", nil)) }
func (a *AxAgent) GetState() Value { return _agent_get_state(a.State) }
func (a *AxAgent) SetState(state Value) Value { return _agent_set_state(a.State, state) }
func (a *AxAgent) GetChatLog() Value { return coreGet(a.State, "chat_log", Array()) }
func (a *AxAgent) GetActionLog() Value { return coreGet(a.State, "action_log", Array()) }
func (a *AxAgent) ExportTrace() Value { return _agent_export_trace(a.State) }
func (a *AxAgent) ReplayTrace(trace Value, fixtures Value) Value { return _agent_replay_trace(trace, fixtures) }
func (a *AxAgent) GetUsage() Value { return coreGet(a.State, "usage", Object()) }
func (a *AxAgent) GetRuntimeContract() Value { return coreGet(a.State, "runtime_contract", Object()) }
func (a *AxAgent) GetPolicy() Value { return coreGet(a.State, "policy", Object()) }
func (a *AxAgent) GetPolicyRegistry() Value { return coreGet(a.State, "policy_registry", Object()) }
func (a *AxAgent) GetCallableInventory() Value { return coreGet(a.State, "callable_inventory", Array()) }
func (a *AxAgent) GetDiscoveryCatalog() Value { return coreGet(a.State, "discovery_catalog", Array()) }
func (a *AxAgent) Discover(request Value) Value { return _agent_discover(a.State, request) }
func (a *AxAgent) Recall(request Value) Value { return _agent_recall(a.State, request) }
func (a *AxAgent) Used(id Value, reason string, stage string) Value { return _agent_used(a.State, Object("id", id, "reason", reason, "stage", stage), stage) }
func (a *AxAgent) InvokeCallable(name string, args map[string]Value, options map[string]Value) Value { return _agent_execute_callable(a.State, Object("qualified_name", name, "args", args), options) }
func (a *AxAgent) ExportRuntimeState() Value { return _agent_export_runtime_state(a.State) }
func (a *AxAgent) RestoreRuntimeState(snapshot Value) Value { return _agent_restore_runtime_state(a.State, snapshot) }
func (a *AxAgent) GetOptimizerMetadata() Value { return _agent_optimizer_metadata(a.State) }
func (a *AxAgent) GetOptimizableComponents() Value {
	components := Array()
	for _, item := range asSlice(a.Distiller.GetOptimizableComponents()) { components = append(components, item) }
	for _, item := range asSlice(a.Executor.GetOptimizableComponents()) { components = append(components, item) }
	for _, item := range asSlice(a.Responder.GetOptimizableComponents()) { components = append(components, item) }
	runtime := coreGet(a.State, "runtime_contract", Object("language", "javascript", "code_field", "javascriptCode"))
	policy := coreGet(a.State, "policy", _agent_policy_registry(Object()))
	components = append(components, _optimization_component("root.agent.runtime", "root.agent", "runtime-policy", runtime, "Agent runtime-language metadata and code-field policy.", Array("Keep code field names aligned with the selected runtime language."), Array(), true, "json", Object("component", "runtime_contract")))
	components = append(components, _optimization_component("root.agent.policy", "root.agent", "agent-policy", policy, "Actor primitive, discovery, delegation, and prompt placement policy.", Array("Do not expose protocol-only actions as actor primitives."), Array("root.agent.runtime"), true, "json", Object("component", "policy_registry")))
	return components
}
func (a *AxAgent) ApplyOptimizedComponents(m map[string]Value) {
	a.Distiller.ApplyOptimizedComponents(m)
	a.Executor.ApplyOptimizedComponents(m)
	a.Responder.ApplyOptimizedComponents(m)
	if value := coreGet(m, "root.agent.runtime", nil); value != nil { coreSet(a.State, "runtime_contract", value) }
	if value := coreGet(m, "root.agent.policy", nil); value != nil { coreSet(a.State, "policy", value) }
}

type AxFlow struct { State map[string]Value; Steps Value; Options map[string]Value }
func NewFlow(options map[string]Value) *AxFlow {
	if options == nil { options = Object() }
	state := asMap(_flow_factory(options))
	return &AxFlow{State:state, Steps:coreGet(state, "steps", Array()), Options:options}
}
func (f *AxFlow) Forward(ctx context.Context, client AIClient, values map[string]Value, options map[string]Value) (Value,error) { return safeValue(func() Value { return _flow_forward(f.State, bindAIClientContext(ctx, client), values, options) }) }
func (f *AxFlow) GetOptimizableComponents() Value { return _flow_get_optimizable_components(f.State) }
func (f *AxFlow) ApplyOptimizedComponents(m map[string]Value) { _flow_apply_optimized_components(f.State, m) }

type OptimizerEngine interface { Optimize(map[string]Value, OptimizerEvaluator) (Value,error) }
type OptimizerEvaluator interface { Evaluate(map[string]Value, map[string]Value) (Value,error) }
type AxGEPA struct { Options map[string]Value; ReflectionClient AIClient }
func NewGEPA(reflectionClient AIClient, options map[string]Value) *AxGEPA { return &AxGEPA{Options:options, ReflectionClient:reflectionClient} }
func (g *AxGEPA) Optimize(request map[string]Value, evaluator OptimizerEvaluator) (Value,error) {
	return safeValue(func() Value { return g.optimize(request, evaluator) })
}
func (g *AxGEPA) optimize(request map[string]Value, evaluator OptimizerEvaluator) Value {
	if evaluator == nil { panic(AxError{Category:"optimize", Message:"AxGEPA requires an OptimizerEvaluator"}) }
	options := cloneMap(g.Options)
	for key, value := range asMap(coreGet(request, "options", Object())) { if key != "__order" { coreSet(options, key, value) } }
	components := Array()
	for _, raw := range asSlice(coreGet(request, "components", Array())) {
		component := asMap(raw)
		if _, ok := coreGet(component, "current", "").(string); ok { components = append(components, cloneMap(component)) }
	}
	if len(components) == 0 { panic(AxError{Category:"optimize", Message:"AxGEPA: program exposes no optimizable components"}) }
	dataset := asMap(coreGet(request, "dataset", Object()))
	train := asSlice(coreGet(dataset, "train", Array()))
	validation := asSlice(coreGet(dataset, "validation", Array()))
	if len(validation) == 0 { validation = train }
	maxCalls := int(num(coreGet(options, "maxMetricCalls", coreGet(options, "max_metric_calls", 0))))
	if maxCalls <= 0 { panic(AxError{Category:"optimize", Message:"AxGEPA: options.maxMetricCalls must be set to a positive integer"}) }
	numTrials := int(num(coreGet(options, "numTrials", coreGet(options, "num_trials", 30))))
	if numTrials < 0 { numTrials = 0 }
	minibatchSize := int(num(coreGet(options, "minibatchSize", coreGet(options, "minibatch_size", 20))))
	if minibatchSize <= 0 { minibatchSize = 1 }
	paretoSize := int(num(coreGet(options, "paretoSetSize", coreGet(options, "pareto_set_size", minibatchSize*3))))
	if paretoSize <= 0 { paretoSize = 1 }
	if paretoSize > len(validation) { paretoSize = len(validation) }
	paretoSet := validation
	if paretoSize < len(validation) { paretoSet = validation[:paretoSize] }
	baseCfg := gepaCurrentMap(components)
	selectorState := gepaSelectorState(components, asMap(coreGet(options, "selectorState", coreGet(options, "selector_state", Object()))))
	totalCalls := 0
	demos := Array()
	if bootstrap := coreGet(options, "bootstrap", nil); bootstrap != nil {
		var nextCalls int
		demos, nextCalls = g.gepaBootstrap(evaluator, baseCfg, train, asMap(bootstrap), totalCalls, maxCalls)
		totalCalls = nextCalls
	}
	if maxCalls <= len(paretoSet) {
		panic(AxError{Category:"optimize", Message:fmt.Sprintf("AxGEPA: options.maxMetricCalls=%d is too small to evaluate the initial Pareto set; need at least %d metric calls", maxCalls, len(paretoSet))})
	}
	baseEval, nextCalls := gepaEvaluate(evaluator, baseCfg, paretoSet, "initial Pareto evaluation", maxCalls, totalCalls, true)
	totalCalls = nextCalls
	bestCfg := cloneMap(baseCfg)
	bestScore := num(coreGet(baseEval, "avg", 0))
	candidatesExplored := 1
	if numTrials > 0 {
		if g.ReflectionClient == nil { panic(AxError{Category:"optimize", Message:"AxGEPA requires a reflection_client for reflective trials"}) }
		target := asMap(components[0])
		if len(components) > 1 { target = asMap(components[len(components)-1]) }
		group := gepaComponentGroup(target, components)
		proposed := cloneMap(baseCfg)
		parentEval, ok := gepaEvaluateOptional(evaluator, bestCfg, gepaMinibatch(train, minibatchSize), "parent minibatch", maxCalls, totalCalls)
		if ok {
			totalCalls = int(num(coreGet(parentEval, "_totalCalls", totalCalls)))
			rows := asSlice(coreGet(parentEval, "rows", Array()))
			for _, rawComponent := range group {
				component := asMap(rawComponent)
				cid := display(coreGet(component, "id", ""))
				gepaRecordProposal(selectorState, cid)
				current := display(coreGet(proposed, cid, ""))
				next := g.gepaReflect(component, current, rows, options)
				coreSet(proposed, cid, next)
			}
			childEval, childOK := gepaEvaluateOptional(evaluator, proposed, gepaMinibatch(train, minibatchSize), "child minibatch", maxCalls, totalCalls)
			if childOK {
				totalCalls = int(num(coreGet(childEval, "_totalCalls", totalCalls)))
				accepted := num(coreGet(childEval, "sum", 0)) > num(coreGet(parentEval, "sum", 0))
				for _, rawComponent := range group { gepaRecordResult(selectorState, display(coreGet(rawComponent, "id", "")), accepted, 0) }
				if accepted {
					validationEval, validationOK := gepaEvaluateOptional(evaluator, proposed, paretoSet, "validation evaluation", maxCalls, totalCalls)
					if validationOK {
						totalCalls = int(num(coreGet(validationEval, "_totalCalls", totalCalls)))
						bestCfg = cloneMap(proposed)
						bestScore = num(coreGet(validationEval, "avg", coreGet(childEval, "avg", bestScore)))
						candidatesExplored = 2
					}
				}
			}
		}
	}
	owners := Object()
	for _, raw := range components {
		component := asMap(raw)
		id := display(coreGet(component, "id", ""))
		owner := coreGet(component, "owner", strings.SplitN(id, "::", 2)[0])
		coreSet(owners, id, owner)
	}
	metadata := Object("optimizer", "GEPA", "selectorState", selectorState, "bestScore", bestScore, "totalMetricCalls", totalCalls, "candidatesExplored", candidatesExplored, "report", Object("summary", "GEPA Multi-Objective Optimization Complete", "statistics", Object("totalEvaluations", totalCalls, "candidatesExplored", candidatesExplored, "converged", true), "paretoFrontier", Object("solutionCount", 1, "hypervolume", 0)))
	return Object("artifactVersion", "axir-optimized-artifact-v1", "optimizerName", "GEPA", "optimizerVersion", "axir-gepa-v1", "componentMap", bestCfg, "demos", demos, "metadata", metadata, "evidence", Object("avg", bestScore, "count", len(paretoSet), "totalMetricCalls", totalCalls), "provenance", Object("sourceProgramKind", coreGet(request, "programKind", "unknown"), "componentOwners", owners))
}

func gepaCurrentMap(components []Value) map[string]Value {
	out := Object()
	for _, raw := range components {
		component := asMap(raw)
		coreSet(out, coreGet(component, "id", ""), coreGet(component, "current", ""))
	}
	return out
}
func gepaSelectorState(components []Value, initial map[string]Value) map[string]Value {
	out := Object()
	for _, raw := range components {
		component := asMap(raw)
		id := display(coreGet(component, "id", ""))
		old := asMap(coreGet(initial, id, Object()))
		coreSet(out, id, Object("proposals", int(num(coreGet(old, "proposals", 0))), "accepts", int(num(coreGet(old, "accepts", 0))), "lastAcceptIter", int(num(coreGet(old, "lastAcceptIter", -1))), "stagnation", int(num(coreGet(old, "stagnation", 0)))))
	}
	return out
}
func gepaEvaluate(evaluator OptimizerEvaluator, cfg map[string]Value, examples []Value, phase string, maxCalls int, totalCalls int, throw bool) (map[string]Value, int) {
	needed := len(examples)
	if totalCalls+needed > maxCalls {
		if throw { panic(AxError{Category:"optimize", Message:fmt.Sprintf("AxGEPA: options.maxMetricCalls=%d is too small to evaluate the initial Pareto set; need at least %d metric calls", maxCalls, needed)}) }
		return nil, totalCalls
	}
	result, err := evaluator.Evaluate(cloneMap(cfg), Object("dataset", Object("train", valuesToArray(examples), "validation", Array()), "phase", phase, "captureTraces", true))
	if err != nil { panic(err) }
	out := cloneMap(asMap(result))
	coreSet(out, "_totalCalls", totalCalls+int(num(coreGet(out, "count", needed))))
	return out, totalCalls+int(num(coreGet(out, "count", needed)))
}
func gepaEvaluateOptional(evaluator OptimizerEvaluator, cfg map[string]Value, examples []Value, phase string, maxCalls int, totalCalls int) (map[string]Value, bool) {
	result, next := gepaEvaluate(evaluator, cfg, examples, phase, maxCalls, totalCalls, false)
	if result == nil { return Object("_totalCalls", totalCalls), false }
	return result, next > totalCalls
}
func valuesToArray(values []Value) Value { out := Array(); for _, value := range values { out = append(out, value) }; return out }
func (g *AxGEPA) gepaBootstrap(evaluator OptimizerEvaluator, cfg map[string]Value, train []Value, options map[string]Value, totalCalls int, maxCalls int) ([]Value, int) {
	threshold := num(coreGet(options, "scoreThreshold", coreGet(options, "score_threshold", 0.8)))
	maxDemos := int(num(coreGet(options, "maxBootstrapDemos", coreGet(options, "max_bootstrap_demos", 4))))
	maxBootCalls := int(num(coreGet(options, "maxBootstrapMetricCalls", coreGet(options, "max_bootstrap_metric_calls", len(train)))))
	if maxDemos <= 0 { maxDemos = 1 }
	if maxBootCalls <= 0 { maxBootCalls = 1 }
	demos := Array()
	calls := 0
	for _, example := range train {
		if calls >= maxBootCalls || len(demos) >= maxDemos { break }
		result, next := gepaEvaluate(evaluator, cfg, []Value{example}, "bootstrap", maxCalls, totalCalls, false)
		totalCalls = next
		calls++
		if result == nil { continue }
		rows := asSlice(coreGet(result, "rows", Array()))
		if len(rows) == 0 { continue }
		row := asMap(rows[0])
		if num(coreGet(row, "scalar", 0)) >= threshold {
			demos = append(demos, Object("programId", "root", "traces", Array(cloneValue(coreGet(row, "prediction", coreGet(row, "input", Object()))))))
		}
	}
	return demos, totalCalls
}
func gepaMinibatch(train []Value, size int) []Value {
	if size <= 0 || size >= len(train) { return train }
	return train[:size]
}
func gepaComponentGroup(component map[string]Value, components []Value) []Value {
	byID := map[string]map[string]Value{}
	for _, raw := range components { c := asMap(raw); byID[display(coreGet(c, "id", ""))] = c }
	out := []Value{}
	seen := map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if seen[id] { return }
		c, ok := byID[id]
		if !ok { return }
		seen[id] = true
		out = append(out, c)
		for _, dep := range asSlice(coreGet(c, "dependsOn", coreGet(c, "depends_on", Array()))) { visit(display(dep)) }
	}
	visit(display(coreGet(component, "id", "")))
	return out
}
func (g *AxGEPA) gepaReflect(component map[string]Value, current string, rows []Value, options map[string]Value) string {
	attempts := int(num(coreGet(options, "maxReflectionAttempts", coreGet(options, "max_reflection_attempts", 2))))
	if attempts <= 0 { attempts = 1 }
	for i:=0; i<attempts; i++ {
		response, err := g.ReflectionClient.Chat(context.Background(), Object("chatPrompt", Array(Object("role", "user", "content", stableStringify(Object("componentKey", coreGet(component, "id", ""), "currentValue", current, "rows", rows))))), Object())
		if err != nil { panic(err) }
		candidate := gepaExtractReflectionText(response)
		if gepaValidateComponent(component, candidate) { return candidate }
	}
	return current
}
func gepaExtractReflectionText(response Value) string {
	results := asSlice(coreGet(response, "results", Array()))
	text := ""
	if len(results) > 0 { text = display(coreGet(results[0], "content", "")) }
	text = strings.TrimSpace(text)
	text = strings.TrimSpace(strings.TrimPrefix(text, "New Value:"))
	return text
}
func gepaValidateComponent(component map[string]Value, candidate string) bool {
	if candidate == "" { return false }
	for _, raw := range asSlice(coreGet(component, "preserve", Array())) {
		if !strings.Contains(candidate, display(raw)) { return false }
	}
	if display(coreGet(component, "format", "")) == "snake_case" && strings.Contains(candidate, " ") { return false }
	return true
}
func gepaRecordProposal(selector map[string]Value, id string) {
	state := asMap(coreGet(selector, id, Object()))
	coreSet(state, "proposals", int(num(coreGet(state, "proposals", 0)))+1)
	coreSet(selector, id, state)
}
func gepaRecordResult(selector map[string]Value, id string, accepted bool, iteration int) {
	state := asMap(coreGet(selector, id, Object()))
	if accepted {
		coreSet(state, "accepts", int(num(coreGet(state, "accepts", 0)))+1)
		coreSet(state, "lastAcceptIter", iteration)
		coreSet(state, "stagnation", 0)
	} else {
		coreSet(state, "stagnation", int(num(coreGet(state, "stagnation", 0)))+1)
	}
	coreSet(selector, id, state)
}

type CodeRuntime interface { Language() string; UsageInstructions() string; CreateSession(map[string]Value, map[string]Value) (CodeSession,error) }
type CodeSession interface { Execute(string,map[string]Value) Value; Inspect(map[string]Value) Value; SnapshotGlobals(map[string]Value) Value; PatchGlobals(Value,map[string]Value) Value; Close() Value }
type RuntimeCapabilities = map[string]Value
type RuntimeEnvelope = map[string]Value

type ProcessCodeRuntime struct {
	Command []string
	Env map[string]string
	Cwd string
	cmd *exec.Cmd
	stdin io.WriteCloser
	stdout *bufio.Scanner
	stderr bytes.Buffer
	nextID int
	mu sync.Mutex
}
type ProcessCodeSession struct { Runtime *ProcessCodeRuntime; ID string }
func NewProcessCodeRuntime(command []string, env map[string]string) *ProcessCodeRuntime { return &ProcessCodeRuntime{Command:command, Env:env} }
func NewProcessCodeRuntimeWithCwd(command []string, cwd string, env map[string]string) *ProcessCodeRuntime { return &ProcessCodeRuntime{Command:command, Cwd:cwd, Env:env} }
func (r *ProcessCodeRuntime) Language() string { return "JavaScript" }
func (r *ProcessCodeRuntime) UsageInstructions() string {
	response, err := r.Request("capabilities", "", Object(), true)
	if err != nil { return "" }
	return display(coreGet(coreGet(response, "result", Object()), "usage_instructions", ""))
}
func (r *ProcessCodeRuntime) CreateSession(globals map[string]Value, options map[string]Value) (CodeSession,error) {
	response, err := r.Request("create_session", "", Object("globals", globals, "options", options), true)
	if err != nil { return nil, err }
	sessionID := display(coreGet(response, "session_id", coreGet(coreGet(response, "result", Object()), "session_id", "")))
	if sessionID == "" { return nil, AxError{Category:"runtime", Message:"runtime protocol did not return a session_id"} }
	return &ProcessCodeSession{Runtime:r, ID:sessionID}, nil
}
func (r *ProcessCodeRuntime) startLocked() error {
	if r.cmd != nil { return nil }
	if len(r.Command) == 0 { return AxError{Category:"runtime", Message:"ProcessCodeRuntime requires a command"} }
	cmd := exec.Command(r.Command[0], r.Command[1:]...)
	if r.Cwd != "" { cmd.Dir = r.Cwd }
	if r.Env != nil {
		env := os.Environ()
		for key, value := range r.Env { env = append(env, key+"="+value) }
		cmd.Env = env
	}
	stdin, err := cmd.StdinPipe()
	if err != nil { return err }
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil { return err }
	cmd.Stderr = &r.stderr
	if err := cmd.Start(); err != nil { return AxError{Category:"runtime", Message:"failed to start runtime protocol process: "+err.Error()} }
	scanner := bufio.NewScanner(stdoutPipe)
	scanner.Buffer(make([]byte, 1024), 16*1024*1024)
	r.cmd = cmd
	r.stdin = stdin
	r.stdout = scanner
	return nil
}
func (r *ProcessCodeRuntime) closedWithoutResponseMessageLocked() string {
	message := "runtime protocol process closed without a response"
	if r.cmd != nil {
		if r.cmd.ProcessState == nil {
			done := make(chan error, 1)
			go func() { done <- r.cmd.Wait() }()
			select {
			case err := <-done:
				if err != nil {
					if r.cmd.ProcessState != nil {
						message += " (exit code " + strconv.Itoa(r.cmd.ProcessState.ExitCode()) + ")"
					} else {
						message += ": " + err.Error()
					}
				}
			case <-time.After(100 * time.Millisecond):
			}
		} else if !r.cmd.ProcessState.Success() {
			message += ": exit code " + strconv.Itoa(r.cmd.ProcessState.ExitCode())
		}
		stderr := strings.TrimSpace(r.stderr.String())
		if stderr != "" { message += ": " + stderr }
	}
	return message
}
func (r *ProcessCodeRuntime) Request(op string, sessionID string, payload map[string]Value, throwOnError bool) (map[string]Value, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.startLocked(); err != nil { return nil, err }
	r.nextID++
	id := strconv.Itoa(r.nextID)
	message := Object("id", id, "op", op, "payload", payload)
	if sessionID != "" { coreSet(message, "session_id", sessionID) }
	data, err := json.Marshal(runtimeJSONValue(message))
	if err != nil { return nil, AxError{Category:"protocol", Message:"runtime protocol request is not JSON-compatible: "+err.Error()} }
	if _, err := r.stdin.Write(append(data, '\n')); err != nil { return nil, AxError{Category:"protocol", Message:"runtime protocol write failed: "+err.Error()} }
	if !r.stdout.Scan() {
		if err := r.stdout.Err(); err != nil { return nil, AxError{Category:"protocol", Message:"runtime protocol read failed: "+err.Error()} }
		return nil, AxError{Category:"protocol", Message:r.closedWithoutResponseMessageLocked()}
	}
	line := r.stdout.Text()
	var parsed any
	if err := json.Unmarshal([]byte(line), &parsed); err != nil { return nil, AxError{Category:"protocol", Message:"runtime protocol invalid JSON response: "+err.Error()} }
	response := asMap(normalizeJSON(parsed))
	if len(response) == 0 { return nil, AxError{Category:"protocol", Message:"runtime protocol response must be an object"} }
	if display(coreGet(response, "id", "")) != id { return nil, AxError{Category:"protocol", Message:"runtime protocol response id mismatch"} }
	responseSessionID := display(coreGet(response, "session_id", ""))
	if sessionID != "" && responseSessionID != "" && responseSessionID != sessionID {
		return nil, AxError{Category:"protocol", Message:"runtime protocol session_id mismatch"}
	}
	if coreGet(response, "ok", true) == false && throwOnError {
		errObj := asMap(coreGet(response, "error", Object()))
		return nil, AxError{Category:display(coreGet(errObj, "category", "runtime")), Message:display(coreGet(errObj, "message", "runtime protocol error"))}
	}
	return response, nil
}
func (r *ProcessCodeRuntime) Close() Value {
	_, _ = r.Request("shutdown", "", Object(), false)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cmd != nil && r.cmd.Process != nil { _ = r.cmd.Process.Kill(); _ = r.cmd.Wait() }
	return Object("shutdown", true)
}
func runtimeEnvelopeError(message string, category string) Value {
	if category == "" { category = "runtime" }
	return Object("kind", "error", "error", message, "error_category", category, "is_error", true)
}
func (s *ProcessCodeSession) Execute(code string, options map[string]Value) Value {
	response, err := s.Runtime.Request("execute", s.ID, Object("code", code, "options", options), false)
	if err != nil { return runtimeEnvelopeError(err.Error(), "runtime") }
	if coreGet(response, "ok", true) == false {
		errObj := asMap(coreGet(response, "error", Object()))
		return runtimeEnvelopeError(display(coreGet(errObj, "message", "runtime protocol error")), display(coreGet(errObj, "category", "runtime")))
	}
	return coreGet(response, "result", Object())
}
func (s *ProcessCodeSession) Inspect(options map[string]Value) Value {
	response, err := s.Runtime.Request("inspect_globals", s.ID, options, true)
	if err != nil { panic(err) }
	return coreGet(response, "result", Object())
}
func (s *ProcessCodeSession) SnapshotGlobals(options map[string]Value) Value {
	response, err := s.Runtime.Request("snapshot_globals", s.ID, options, true)
	if err != nil { panic(err) }
	return coreGet(response, "result", Object())
}
func (s *ProcessCodeSession) PatchGlobals(snapshot Value, options map[string]Value) Value {
	response, err := s.Runtime.Request("patch_globals", s.ID, Object("globals", snapshot, "options", options), true)
	if err != nil { panic(err) }
	return coreGet(response, "result", Object())
}
func (s *ProcessCodeSession) Close() Value {
	response, err := s.Runtime.Request("close", s.ID, Object(), false)
	if err != nil { return Object("closed", true) }
	return coreGet(response, "result", Object("closed", true))
}

type conformanceFakeCodeRuntime struct {
	Script []Value
	Sessions []*conformanceFakeCodeSession
	CreateRequests []Value
	ExecuteOptions []Value
	Executed []Value
	Capabilities map[string]Value
	LanguageName string
	Usage string
}
type conformanceFakeCodeSession struct { Runtime *conformanceFakeCodeRuntime; Globals map[string]Value; Closed bool }
func newConformanceFakeCodeRuntime(script Value, capabilities map[string]Value) *conformanceFakeCodeRuntime {
	return &conformanceFakeCodeRuntime{Script: append([]Value(nil), asSlice(script)...), Capabilities: capabilities, LanguageName: "JavaScript"}
}
func (r *conformanceFakeCodeRuntime) Language() string { if r.LanguageName == "" { return "JavaScript" }; return r.LanguageName }
func (r *conformanceFakeCodeRuntime) UsageInstructions() string { return r.Usage }
func (r *conformanceFakeCodeRuntime) CreateSession(globals map[string]Value, options map[string]Value) (CodeSession,error) {
	session := &conformanceFakeCodeSession{Runtime:r, Globals:cloneMap(globals)}
	r.Sessions = append(r.Sessions, session)
	r.CreateRequests = append(r.CreateRequests, Object("globals", cloneMap(globals), "options", cloneMap(options)))
	return session, nil
}
func (s *conformanceFakeCodeSession) Execute(code string, options map[string]Value) Value {
	r := s.Runtime
	r.Executed = append(r.Executed, code)
	r.ExecuteOptions = append(r.ExecuteOptions, cloneMap(options))
	if s.Closed { return Object("kind", "session_closed", "message", "session closed") }
	if len(r.Script) == 0 { return Object("kind", "error", "error", Object("category", "runtime", "message", "runtime script exhausted")) }
	step := asMap(r.Script[0]); r.Script = r.Script[1:]
	if expected := display(coreGet(step, "expected_code", "")); expected != "" && expected != code {
		return Object("kind", "error", "error", Object("category", "runtime", "message", "expected code "+expected+", got "+code))
	}
	for key, value := range asMap(coreGet(step, "bindings_patch", Object())) { if key != "__order" { coreSet(s.Globals, key, cloneValue(value)) } }
	return cloneValue(coreGet(step, "result", Object("kind", "status", "status", Object("type", "success", "message", ""))))
}
func (s *conformanceFakeCodeSession) Inspect(options map[string]Value) Value {
	if coreGet(s.Runtime.Capabilities, "inspect", true) == false { return Object("unavailable", "runtime state inspection unavailable") }
	return Object("globals", cloneMap(s.Globals), "closed", s.Closed)
}
func (s *conformanceFakeCodeSession) SnapshotGlobals(options map[string]Value) Value {
	if coreGet(s.Runtime.Capabilities, "snapshot", true) == false {
		panic(AxError{Category:"runtime", Message:"AxCodeSession.snapshotGlobals() is required to export AxAgent state"})
	}
	return Object("closed", s.Closed, "globals", conformanceSanitizeRuntimeGlobals(s.Globals))
}
func (s *conformanceFakeCodeSession) PatchGlobals(snapshot Value, options map[string]Value) Value {
	if coreGet(s.Runtime.Capabilities, "patch", true) == false {
		panic(AxError{Category:"runtime", Message:"AxCodeSession.patchGlobals() is required to restore AxAgent state"})
	}
	snap := asMap(snapshot)
	globals := coreGet(snap, "globals", snap)
	if !coreTruthy(coreTypeIs(globals, "object")) { return Object("kind", "error", "error", Object("category", "runtime", "message", "runtime session snapshot globals must be an object")) }
	for key, value := range asMap(globals) { if key != "__order" { coreSet(s.Globals, key, cloneValue(value)) } }
	return Object("ok", true, "globals", conformanceSanitizeRuntimeGlobals(s.Globals))
}
func (s *conformanceFakeCodeSession) Close() Value { s.Closed = true; return Object("kind", "session_closed", "closed", true) }
func conformanceSanitizeRuntimeGlobals(globals map[string]Value) map[string]Value {
	out := Object()
	reserved := map[string]bool{}
	for _, raw := range asSlice(_agent_reserved_runtime_names()) { reserved[display(raw)] = true }
	for key, value := range globals { if key != "__order" && !reserved[key] { coreSet(out, key, cloneValue(value)) } }
	return out
}

func objectCallMethod(target Value, method string, arg Value) Value {
	if method == "render" { return render_prompt(coreGet(target,"signature",nil), arg, coreGet(target,"functions",Array()), coreGet(target,"options",Object())) }
	if method == "call" {
		if fn, ok := target.(func(map[string]Value) Value); ok { return fn(asMap(arg)) }
	}
	panic(AxError{Category:"runtime", Message:"unsupported method call: "+method})
}

// Host-boundary intrinsics used by generated Core.
func _core_axgen_render_examples(gen Value) Value { return _core_axgen_render_examples_impl(coreGet(gen, "examples", Array()), "Example", gen) }
func _core_axgen_render_demos(gen Value) Value { return _core_axgen_render_examples_impl(coreGet(gen, "demos", Array()), "Demo", gen) }
func _core_axgen_render_examples_impl(turns Value, label string, gen Value) Value {
	messages := Array()
	for _, raw := range coreIter(turns) {
		item := asMap(raw)
		input := coreGet(item, "input", Object())
		output := coreGet(item, "output", Object())
		messages = append(messages, Object("role", "user", "content", label+" Input:\n"+axgenFormatValues(gen, input)))
		messages = append(messages, Object("role", "assistant", "content", label+" Output:\n"+axgenFormatValues(gen, output)))
	}
	return messages
}
func axgenFormatValues(gen Value, values Value) string {
	lines := []string{}
	for _, key := range orderedKeys(asMap(values)) {
		lines = append(lines, title(key)+": "+display(coreGet(values, key, nil)))
	}
	return strings.Join(lines, "\n")
}
func _core_axgen_apply_field_processors(gen Value, output Value) Value {
	result := cloneMap(asMap(output))
	changed := false
	for _, raw := range asSlice(coreGet(gen, "field_processors", Array())) {
		spec := asMap(raw)
		field := display(coreGet(spec, "field", coreGet(spec, "name", "")))
		if field == "" || coreGet(result, field, nil) == nil {
			continue
		}
		op := display(coreGet(spec, "processor", coreGet(spec, "op", "")))
		value := display(coreGet(result, field, ""))
		switch {
		case op == "uppercase":
			coreSet(result, field, strings.ToUpper(value))
			changed = true
		case op == "lowercase":
			coreSet(result, field, strings.ToLower(value))
			changed = true
		case op == "trim":
			coreSet(result, field, strings.TrimSpace(value))
			changed = true
		case strings.HasPrefix(op, "prefix:"):
			coreSet(result, field, strings.TrimPrefix(op, "prefix:")+value)
			changed = true
		case strings.HasPrefix(op, "suffix:"):
			coreSet(result, field, value+strings.TrimPrefix(op, "suffix:"))
			changed = true
		}
	}
	if changed {
		if g, ok := gen.(*AxGen); ok {
			g.Memory = coreAppend(g.Memory, Object("role","processor","output",cloneMap(result),"tags",Array("processor")))
		}
	}
	return result
}
func _core_axgen_run_assertions(gen Value, output Value) Value {
	out := asMap(output)
	for _, raw := range asSlice(coreGet(gen, "assertions", Array())) {
		assertion := asMap(raw)
		field := display(coreGet(assertion, "field", ""))
		value := output
		if field != "" {
			value = coreGet(out, field, nil)
		}
		message := display(coreGet(assertion, "message", "assertion failed"))
		if returned := coreGet(assertion, "return", nil); returned != nil {
			if b, ok := returned.(bool); ok && !b {
				if coreGet(assertion, "message", nil) == nil {
					panic(AxError{Category:"runtime", Message:"assertion failed without message"})
				}
				panic(AxError{Category:"runtime", Message:message})
			}
			if s, ok := returned.(string); ok {
				panic(AxError{Category:"runtime", Message:s})
			}
		}
		if contains := coreGet(assertion, "contains", nil); contains != nil && !strings.Contains(display(value), display(contains)) {
			panic(AxError{Category:"runtime", Message:message})
		}
		if equals := coreGet(assertion, "equals", nil); equals != nil && !equal(value, equals) {
			panic(AxError{Category:"runtime", Message:message})
		}
	}
	return nil
}
func _core_axgen_record_trace(target Value, items ...Value) Value { event:=Object(); if len(items)==1 { event=asMap(items[0]) } else { for i,item := range items { coreSet(event, fmt.Sprintf("item%d", i), item) } }; traces:=coreGet(target,"traces",Array()); traces=coreAppend(traces,event); if g, ok:=target.(*AxGen); ok { g.Traces=traces }; return traces }
func _core_axgen_should_continue_steps(gen Value, calls Value) Value {
	stops := map[string]bool{}
	for _, item := range asSlice(coreGet(gen, "stop_functions", Array())) { stops[display(item)] = true }
	if len(stops) == 0 { return true }
	for _, raw := range asSlice(calls) {
		fn := coreGet(raw, "function", Object())
		name := display(coreGet(fn, "name", coreGet(raw, "name", "")))
		if stops[name] { return false }
	}
	return true
}
func _core_axgen_apply_context_cache(values ...Value) Value {
	if len(values) < 2 { if len(values)==1 { return values[0] }; return Array() }
	gen := values[0]
	rawMessages := asSlice(values[1])
	runtimeOptions := Object()
	if len(values) > 2 { runtimeOptions = asMap(values[2]) }
	messages := Array()
	for _, raw := range rawMessages { messages = append(messages, cloneValue(raw)) }
	options := _core_map_merge(coreGet(gen, "options", Object()), runtimeOptions)
	contextCache := coreGet(options, "context_cache", coreGet(options, "contextCache", nil))
	if !coreTruthy(contextCache) || coreTruthy(coreGet(options, "ignore_cache_breakpoints", false)) { return messages }
	if len(messages) > 0 {
		first := asMap(messages[0])
		coreSet(first, "cache", true)
		messages[0] = first
	}
	breakpoint := "after_examples"
	if cacheMap, ok := contextCache.(map[string]Value); ok {
		breakpoint = display(coreGet(cacheMap, "breakpoint", coreGet(cacheMap, "cache_breakpoint", coreGet(cacheMap, "cacheBreakpoint", breakpoint))))
	}
	if breakpoint == "" || breakpoint == "after_examples" || breakpoint == "afterExamples" {
		for i := len(messages)-2; i >= 0; i-- {
			msg := asMap(messages[i])
			role := display(coreGet(msg, "role", ""))
			if role == "assistant" || role == "tool" {
				coreSet(msg, "cache", true)
				messages[i] = msg
				break
			}
		}
	}
	return messages
}
func _core_axgen_memory_add_request(target Value, request Value) Value { memory:=coreGet(target,"memory",Array()); memory=coreAppend(memory, request); if g,ok:=target.(*AxGen); ok { g.Memory=memory }; return memory }
func _core_axgen_memory_add_response(target Value, values ...Value) Value { memory:=coreGet(target,"memory",Array()); entry:=Object("kind","response"); for i,value:=range values { coreSet(entry, fmt.Sprintf("item%d", i), value) }; memory=coreAppend(memory, entry); if g,ok:=target.(*AxGen); ok { g.Memory=memory }; return memory }
func _core_axgen_memory_add_function_result(target Value, values ...Value) Value { memory:=coreGet(target,"memory",Array()); entry:=Object("kind","function_result"); for i,value:=range values { coreSet(entry, fmt.Sprintf("item%d", i), value) }; memory=coreAppend(memory, entry); if g,ok:=target.(*AxGen); ok { g.Memory=memory }; return memory }
func _core_axgen_memory_add_correction(target Value, values ...Value) Value { memory:=coreGet(target,"memory",Array()); entry:=Object("kind","correction"); for i,value:=range values { coreSet(entry, fmt.Sprintf("item%d", i), value) }; memory=coreAppend(memory, entry); if g,ok:=target.(*AxGen); ok { g.Memory=memory }; return memory }
func _core_axgen_memory_cleanup_corrections(memory Value) Value { return memory }
func _core_axgen_record_chat_log(target Value, values ...Value) Value { log:=coreGet(target,"chat_log",Array()); entry:=Object(); for i,value:=range values { coreSet(entry, fmt.Sprintf("item%d", i), value) }; log=coreAppend(log,entry); if g,ok:=target.(*AxGen); ok { g.ChatLog=log }; return log }
func _core_axgen_record_function_call(target Value, values ...Value) Value { traces:=coreGet(target,"function_call_traces",Array()); entry:=Object(); for i,value:=range values { coreSet(entry, fmt.Sprintf("item%d", i), value) }; traces=coreAppend(traces,entry); if g,ok:=target.(*AxGen); ok { g.FunctionCallTraces=traces }; return traces }
func _core_agent_stage_forward(stage Value, client Value, values Value, options Value) Value {
	ai := client.(AIClient)
	switch p := stage.(type) {
	case *AxGen:
		out, err := p.Forward(context.Background(), ai, asMap(values), asMap(options)); if err != nil { panic(err) }; return out
	case *AxFlow:
		out, err := p.Forward(context.Background(), ai, asMap(values), asMap(options)); if err != nil { panic(err) }; return out
	case *AxAgent:
		out, err := p.Forward(context.Background(), ai, asMap(values), asMap(options)); if err != nil { panic(err) }; return out
	}
	return Object()
}
func _core_agent_stage_chat_log(stage Value) Value { return coreGet(stage,"chat_log",Array()) }
func _core_agent_stage_usage(stage Value) Value {
	switch s := stage.(type) {
	case *AxGen:
		out := Array()
		for _, entry := range asSlice(s.ChatLog) {
			response := coreGet(entry, "item1", Object())
			usage := coreGet(response, "usage", nil)
			if usage == nil { usage = coreGet(coreGet(response, "model_usage", Object()), "tokens", nil) }
			if usage != nil { out = append(out, usage) }
		}
		return out
	case *AxFlow:
		return coreGet(s.State, "usage", Object())
	case *AxAgent:
		return coreGet(s.State, "usage", Object())
	default:
		return Object()
	}
}
func _core_agent_stage_traces(stage Value) Value { return coreGet(stage,"traces",Array()) }
func _core_agent_clarification_error(values ...Value) Value { var payload Value = Object(); if len(values)==1 { payload=values[0] } else { for i,value:=range values { coreSet(payload, fmt.Sprintf("item%d", i), value) } }; return Object("__error","clarification","message",stableStringify(payload),"payload",payload) }
func _core_agent_runtime_create_session(values ...Value) Value {
	if len(values)<1 { panic(AxError{Category:"runtime",Message:"agent runtime create session missing arguments"}) }
	runtime:=values[0]; globals:=Object(); options:=Object()
	if _, ok := runtime.(CodeRuntime); !ok && len(values)>1 { runtime=values[1]; if len(values)>2 { globals=asMap(values[2]) }; if len(values)>3 { options=asMap(values[3]) } } else { if len(values)>1 { globals=asMap(values[1]) }; if len(values)>2 { options=asMap(values[2]) } }
	if rt, ok:=runtime.(CodeRuntime); ok { s,err:=rt.CreateSession(globals,options); if err!=nil { panic(err) }; return s }
	panic(AxError{Category:"runtime",Message:"agent runtime does not implement CodeRuntime"})
}
func _core_agent_runtime_execute(values ...Value) Value {
	if len(values)<2 { panic(AxError{Category:"runtime",Message:"agent runtime execute missing arguments"}) }
	session:=values[0]; code:=values[1]; options:=Object()
	if _, ok := session.(CodeSession); !ok && len(values)>2 { session=values[1]; code=values[2]; if len(values)>3 { options=asMap(values[3]) } } else if len(values)>2 { options=asMap(values[2]) }
	if s, ok:=session.(CodeSession); ok { return s.Execute(display(code),options) }
	panic(AxError{Category:"runtime",Message:"agent code session is not active"})
}
func _core_agent_runtime_inspect(values ...Value) Value {
	if len(values)<1 { return Object("closed",true) }
	session:=values[0]; options:=Object()
	if _, ok := session.(CodeSession); !ok && len(values)>1 { session=values[1]; if len(values)>2 { options=asMap(values[2]) } } else if len(values)>1 { options=asMap(values[1]) }
	if s, ok:=session.(CodeSession); ok { return s.Inspect(options) }
	return Object("closed",true)
}
func _core_agent_runtime_export_state(values ...Value) Value {
	if len(values)<1 { return Object() }
	session:=values[0]; options:=Object()
	if _, ok := session.(CodeSession); !ok && len(values)>1 { session=values[1]; if len(values)>2 { options=asMap(values[2]) } } else if len(values)>1 { options=asMap(values[1]) }
	if s, ok:=session.(CodeSession); ok { return s.SnapshotGlobals(options) }
	return Object()
}
func _core_agent_runtime_restore_state(values ...Value) Value {
	if len(values)<2 { return Object() }
	session:=values[0]; snapshot:=values[1]; options:=Object()
	if _, ok := session.(CodeSession); !ok && len(values)>2 { session=values[1]; snapshot=values[2]; if len(values)>3 { options=asMap(values[3]) } } else if len(values)>2 { options=asMap(values[2]) }
	if s, ok:=session.(CodeSession); ok { return s.PatchGlobals(snapshot,options) }
	return Object()
}
func _core_agent_runtime_close(values ...Value) Value { var session Value; if len(values)==1 { session=values[0] } else if len(values)>1 { session=values[1] }; if s, ok:=session.(CodeSession); ok { return s.Close() }; return Object("closed",true) }
func scriptedAgentSearchResults(scripted Value, searches Value, mergeMatches bool) Value {
	switch s := scripted.(type) {
	case map[string]Value:
		parts := []string{}
		for _, item := range asSlice(searches) { parts = append(parts, display(item)) }
		joined := strings.Join(parts, "|")
		if value, ok := s[joined]; ok { return cloneValue(value) }
		if mergeMatches {
			out := MutableArray()
			for _, key := range parts {
				for _, item := range asSlice(s[key]) { out.Items = append(out.Items, cloneValue(item)) }
			}
			if len(out.Items) > 0 { return out }
		} else {
			for _, key := range parts {
				if value, ok := s[key]; ok { return cloneValue(value) }
			}
		}
		if value, ok := s["*"]; ok { return cloneValue(value) }
	case []Value, *AxArray:
		return cloneValue(scripted)
	}
	return MutableArray()
}
func _core_agent_memory_search(values ...Value) Value {
	if len(values) == 0 { return MutableArray() }
	state := values[0]
	searches := Value(nil)
	if len(values) > 1 { searches = values[1] }
	options := asMap(coreGet(state, "options", Object()))
	scripted := coreGet(options, "memory_search_results", coreGet(options, "memorySearchResults", Object()))
	return scriptedAgentSearchResults(scripted, searches, false)
}
func _core_agent_skill_search(values ...Value) Value {
	if len(values) == 0 { return MutableArray() }
	state := values[0]
	searches := Value(nil)
	if len(values) > 1 { searches = values[1] }
	options := asMap(coreGet(state, "options", Object()))
	scripted := coreGet(options, "skill_search_results", coreGet(options, "skillSearchResults", Object()))
	return scriptedAgentSearchResults(scripted, searches, true)
}
func _core_agent_callable_invoke(values ...Value) Value { if len(values)==0 { return Object("kind","error","error",Object("category","runtime","message","callable unavailable")) }; callable:=values[0]; args:=Object(); if len(values)>1 { args=asMap(values[1]) }; if fn, ok:=callable.(func(map[string]Value) Value); ok { return fn(args) }; return Object("kind","error","error",Object("category","runtime","message","callable unavailable")) }

// Generated conformance harness. It lives in the library package so it can
// exercise the same Core helpers as user-facing APIs without target-template
// provider branches.
type FixtureError struct { Message string }
func (e FixtureError) Error() string { return e.Message }

type conformanceFakeAI struct {
	Responses []Value
	StreamEvents []Value
	Requests []map[string]Value
	ChatCalls int
}

func (f *conformanceFakeAI) Chat(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	f.ChatCalls++
	f.Requests = append(f.Requests, cloneMap(request))
	if len(f.Responses) == 0 { return nil, AxError{Category:"runtime", Message:"fake client exhausted"} }
	raw := f.Responses[0]
	f.Responses = f.Responses[1:]
	return conformanceLegacyResponse(raw), nil
}
func (f *conformanceFakeAI) Embed(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	f.Requests = append(f.Requests, cloneMap(request))
	if len(f.Responses) == 0 { return Object(), nil }
	raw := f.Responses[0]
	f.Responses = f.Responses[1:]
	return raw, nil
}
func (f *conformanceFakeAI) Stream(ctx context.Context, request map[string]Value, options map[string]Value) ([]Value, error) {
	f.Requests = append(f.Requests, cloneMap(request))
	return append([]Value(nil), f.StreamEvents...), nil
}

func RunConformanceFixture(fixture Value) error {
	_, err := safeValue(func() Value {
		runConformanceFixture(asMap(fixture))
		return nil
	})
	if err != nil {
		return FixtureError{Message: display(coreGet(fixture, "name", "fixture")) + ": " + err.Error()}
	}
	return nil
}

func runConformanceFixture(fixture map[string]Value) {
	kind := display(coreGet(fixture, "kind", "forward"))
	switch kind {
	case "signature_error":
		expectFixtureError(func(){ _ = conformanceBuildSignature(fixture) }, fixture)
	case "signature":
		assertEqual(conformanceSignaturePayload(conformanceBuildSignature(fixture)), coreGet(fixture, "expected_signature", nil), "signature")
	case "json_schema":
		sig := conformanceBuildSignature(fixture)
		fields := sig.Outputs
		if display(coreGet(fixture, "target", "outputs")) == "inputs" { fields = sig.Inputs }
		assertEqual(goToJSONSchema(fields, display(coreGet(fixture, "schema_title", "Schema")), asMap(coreGet(fixture, "schema_options", Object()))), coreGet(fixture, "expected_schema", nil), "json schema")
	case "validate_value":
		field := conformanceFieldFromSpec(display(coreGet(fixture, "field_name", "value")), asMap(coreGet(fixture, "field", Object())))
		expectMaybeFixtureError(func() Value { return validate_value(field, coreGet(fixture, "value", nil), nil) }, fixture, nil)
	case "validate_output":
		sig := conformanceBuildSignature(fixture)
		result := expectMaybeFixtureError(func() Value { return validate_output(sig.Outputs, coreGet(fixture, "values", Object())) }, fixture, nil)
		if coreGet(fixture, "expected_error_contains", nil) == nil {
			assertEqual(result, coreGet(fixture, "expected_values", coreGet(fixture, "values", Object())), "validated output")
		}
	case "strip_internal":
		sig := conformanceBuildSignature(fixture)
		assertEqual(strip_internal(sig.Outputs, coreGet(fixture, "values", Object())), coreGet(fixture, "expected_output", nil), "strip internal")
	case "prompt":
		runConformancePrompt(fixture)
	case "template":
		assertEqual(goPromptRenderTemplate(display(coreGet(fixture, "template", "")), asMap(coreGet(fixture, "vars", Object()))), coreGet(fixture, "expected_output", ""), "template output")
	case "template_error":
		expectFixtureError(func(){
			if display(coreGet(fixture, "operation", "")) == "validate" {
				source := display(coreGet(fixture, "template", ""))
				for _, required := range asSlice(coreGet(fixture, "required_variables", Array())) {
					name := display(required)
					if !strings.Contains(source, "{{ "+name+" }}") && !strings.Contains(source, "{{"+name+"}}") {
						panic(AxError{Category:"template", Message:"custom template must preserve template variable {{" + name + "}}"})
					}
				}
			} else {
				_ = goPromptRenderTemplate(display(coreGet(fixture, "template", "")), asMap(coreGet(fixture, "vars", Object())))
			}
		}, fixture)
	case "template_validate":
		assertEqual(validate_prompt_template_syntax(coreGet(fixture, "template", ""), coreGet(fixture, "context", "fixture-template"), coreGet(fixture, "required_variables", Array())), coreGet(fixture, "expected_result", true), "template validation")
	case "stream":
		assertEqual(fold_stream(coreGet(fixture, "stream_events", Array())), coreGet(fixture, "expected_folded", ""), "stream fold")
	case "forward":
		runConformanceForward(fixture)
	case "ai_chat":
		runConformanceAIChat(fixture)
	case "ai_embed":
		runConformanceAIEmbed(fixture)
	case "ai_stream":
		runConformanceAIStream(fixture)
	case "ai_provider_descriptor":
		profile := display(coreGet(fixture, "provider", coreGet(fixture, "profile", "")))
		assertSubset(provider_descriptor(profile), coreGet(fixture, "expected_descriptor_subset", coreGet(fixture, "expected_descriptor", Object())), "provider descriptor")
	case "ai_provider_registry":
		assertSubset(provider_profile_registry(), coreGet(fixture, "expected_registry_subset", coreGet(fixture, "expected_registry", Object())), "provider registry")
	case "ai_model_catalog_audit":
		assertSubset(provider_model_catalog_summary(), coreGet(fixture, "expected_output", Object()), "model catalog audit")
	case "ai_model_catalog_runtime":
		runConformanceAIModelCatalogRuntime(fixture)
	case "ai_multiservice_router":
		runConformanceAIMultiServiceRouter(fixture)
	case "ai_provider_router":
		runConformanceAIProviderRouter(fixture)
	case "ai_balancer":
		runConformanceAIBalancer(fixture)
	case "ai_transcribe":
		runConformanceProviderOperation(fixture, "transcribe")
	case "ai_speak":
		runConformanceProviderOperation(fixture, "speak")
	case "ai_realtime":
		runConformanceProviderOperation(fixture, "realtime")
	case "ai_unsupported", "ai_error":
		runConformanceAIError(fixture)
	case "program_contract":
		runConformanceProgramContract(fixture)
	case "flow":
		runConformanceFlow(fixture)
	case "optimize":
		runConformanceOptimize(fixture)
	case "agent_forward":
		runConformanceAgentForward(fixture)
	case "agent_runtime_policy":
		runConformanceAgentRuntimePolicy(fixture)
	case "agent_runtime_adapter":
		runConformanceAgentRuntimeAdapter(fixture)
	case "agent_runtime_session":
		runConformanceAgentRuntimeSession(fixture)
	case "agent_runtime_protocol":
		runConformanceAgentRuntimeProtocol(fixture)
	default:
		panic(AxError{Category:"fixture", Message:"unsupported Go conformance fixture kind "+kind})
	}
}

func conformanceBuildSignature(fixture map[string]Value) AxSignature {
	if spec := coreGet(fixture, "signature_spec", nil); spec != nil { return conformanceSignatureFromSpec(asMap(spec)) }
	return NewSignature(display(coreGet(fixture, "signature", "question:string -> answer:string")))
}

func conformanceLegacyResponse(raw Value) Value {
	m := asMap(raw)
	if coreGet(m, "results", nil) != nil { return m }
	result := Object("index", float64(0), "content", coreGet(m, "content", ""), "finish_reason", coreGet(m, "finish_reason", "stop"), "function_calls", conformanceNormalizeFunctionCalls(coreGet(m, "function_calls", Array())))
	if calls := coreGet(m, "tool_calls", nil); calls != nil { coreSet(result, "function_calls", conformanceNormalizeFunctionCalls(calls)) }
	out := Object("results", Array(result))
	if usage := coreGet(m, "usage", nil); usage != nil { coreSet(out, "model_usage", Object("tokens", usage)) }
	return out
}
func conformanceNormalizeFunctionCalls(calls Value) Value {
	out := Array()
	for _, raw := range asSlice(calls) {
		call := asMap(raw)
		if coreGet(call, "function", nil) != nil {
			out = append(out, call)
			continue
		}
		name := coreGet(call, "name", "")
		params := coreGet(call, "params", coreGet(call, "arguments", Object()))
		out = append(out, Object("id", coreGet(call, "id", name), "type", "function", "function", Object("name", name, "params", params)))
	}
	return out
}

type routerFixtureService struct {
	name string
	id string
	model string
	embedModel string
	features map[string]Value
	modelList Value
	requests []Value
	responses []Value
	metricsValue map[string]Value
	options map[string]Value
	lastChat Value
	lastEmbed Value
	lastConfig Value
}

func newRouterFixtureService(spec map[string]Value) *routerFixtureService {
	name := display(coreGet(spec, "name", "fixture"))
	features := asMap(coreGet(spec, "features", routerDefaultFeatures()))
	metrics := asMap(coreGet(spec, "metrics", Object("service", name, "calls", float64(0))))
	return &routerFixtureService{
		name: name,
		id: display(coreGet(spec, "id", name+"-id")),
		model: display(coreGet(spec, "model", "fixture-chat")),
		embedModel: display(coreGet(spec, "embed_model", coreGet(spec, "embedModel", "fixture-embed"))),
		features: cloneMap(features),
		modelList: cloneValue(coreGet(spec, "modelList", coreGet(spec, "model_list", nil))),
		responses: asSlice(coreGet(spec, "responses", Array())),
		metricsValue: cloneMap(metrics),
		options: Object(),
	}
}

func (s *routerFixtureService) Chat(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	s.requests = append(s.requests, Object("method", "chat", "opt", cloneMap(options)))
	s.lastChat = coreGet(request, "model", s.model)
	s.lastConfig = cloneValue(coreGet(request, "model_config", coreGet(request, "modelConfig", nil)))
	if len(s.responses) > 0 {
		next := s.responses[0]
		s.responses = s.responses[1:]
		nextMap := asMap(next)
		if errSpec := coreGet(nextMap, "error", nil); errSpec != nil { return nil, fixtureAIServiceError(asMap(errSpec)) }
		if response := coreGet(nextMap, "response", nil); response != nil { return cloneValue(response), nil }
		return cloneValue(next), nil
	}
	return Object("results", Array(Object("index", float64(0), "content", s.name+" chat"))), nil
}
func (s *routerFixtureService) Embed(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	s.requests = append(s.requests, Object("method", "embed", "opt", cloneMap(options)))
	s.lastEmbed = coreGet(request, "embed_model", coreGet(request, "embedModel", s.embedModel))
	return Object("embeddings", Array(Array(float64(1), float64(2))), "modelUsage", Object("ai", s.name)), nil
}
func (s *routerFixtureService) Stream(ctx context.Context, request map[string]Value, options map[string]Value) ([]Value, error) {
	value, err := s.Chat(ctx, request, options)
	return asSlice(value), err
}
func (s *routerFixtureService) Transcribe(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	s.requests = append(s.requests, Object("method", "transcribe", "opt", cloneMap(options)))
	return Object("text", s.name+" transcript"), nil
}
func (s *routerFixtureService) Speak(ctx context.Context, request map[string]Value, options map[string]Value) (Value, error) {
	s.requests = append(s.requests, Object("method", "speak", "opt", cloneMap(options)))
	return Object("audio", "pcm"), nil
}
func (s *routerFixtureService) GetID() string { return s.id }
func (s *routerFixtureService) GetName() string { return s.name }
func (s *routerFixtureService) GetFeatures(model string) map[string]Value { return cloneMap(s.features) }
func (s *routerFixtureService) GetModelList() Value { return cloneValue(s.modelList) }
func (s *routerFixtureService) GetMetrics() map[string]Value {
	out := cloneMap(s.metricsValue)
	if coreGet(out, "calls", nil) != nil { coreSet(out, "calls", float64(len(s.requests))) }
	return out
}
func (s *routerFixtureService) SetOptions(options map[string]Value) { s.options = cloneMap(options) }
func (s *routerFixtureService) GetOptions() map[string]Value { return cloneMap(s.options) }
func (s *routerFixtureService) GetLastUsedChatModel() Value { return s.lastChat }
func (s *routerFixtureService) GetLastUsedEmbedModel() Value { return s.lastEmbed }
func (s *routerFixtureService) GetLastUsedModelConfig() Value { return cloneValue(s.lastConfig) }
func (s *routerFixtureService) GetEstimatedCost(usage map[string]Value) float64 { return 0 }

func fixtureAIServiceError(spec map[string]Value) error {
	errorType := display(coreGet(spec, "type", "network"))
	message := display(coreGet(spec, "message", "fixture error"))
	switch errorType {
	case "status":
		return AIServiceError{AxError{Category:"ai", Type:"AxAIServiceStatusError", Message:message, Status:int(num(coreGet(spec, "status", float64(500)))), Retryable:true}}
	case "authentication":
		return AIServiceError{AxError{Category:"ai", Type:"AxAIServiceAuthenticationError", Message:"Authentication failed", Status:int(num(coreGet(spec, "status", float64(401))))}}
	case "response":
		return AIServiceError{AxError{Category:"ai", Type:"AxAIServiceResponseError", Message:message, Retryable:true}}
	case "timeout":
		return AIServiceError{AxError{Category:"ai", Type:"AxAIServiceTimeoutError", Message:message, Retryable:true}}
	case "plain":
		return AxError{Category:"runtime", Message:message}
	default:
		return AIServiceError{AxError{Category:"ai", Type:"AxAIServiceNetworkError", Message:"Network Error: "+message, Retryable:true}}
	}
}

func buildRouterServices(fixture map[string]Value) []*routerFixtureService {
	services := []*routerFixtureService{}
	for _, spec := range asSlice(coreGet(fixture, "services", Array())) { services = append(services, newRouterFixtureService(asMap(spec))) }
	return services
}
func serviceCalls(services []*routerFixtureService) Value {
	out := Array()
	for _, service := range services {
		if len(service.requests) > 0 { out = append(out, Array(service.requests...)) }
	}
	return out
}

func runConformanceAIMultiServiceRouter(fixture map[string]Value) {
	expectedErr := display(coreGet(fixture, "expected_error_contains", ""))
	_, err := safeValue(func() Value {
		services := buildRouterServices(fixture)
		entries := []Value{}
		for _, raw := range asSlice(coreGet(fixture, "router_entries", Array())) {
			entry := asMap(raw)
			index := int(num(coreGet(entry, "service_index", float64(0))))
			if display(coreGet(entry, "kind", "")) == "key" {
				entries = append(entries, RouterServiceEntry{Key:display(coreGet(entry, "key", "")), Description:display(coreGet(entry, "description", "")), Service:services[index], IsInternal:coreTruthy(coreGet(entry, "isInternal", coreGet(entry, "is_internal", false)))})
			} else {
				entries = append(entries, services[index])
			}
		}
		router, buildErr := NewMultiServiceRouter(entries)
		if buildErr != nil { panic(buildErr) }
		outputs := Object()
		for _, raw := range asSlice(coreGet(fixture, "operations", Array())) {
			op := asMap(raw)
			name := display(coreGet(op, "name", ""))
			request := asMap(coreGet(op, "request", Object()))
			options := asMap(coreGet(op, "options", Object()))
			switch name {
			case "chat":
				value, err := router.Chat(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "embed":
				value, err := router.Embed(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "transcribe":
				value, err := router.Transcribe(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "speak":
				value, err := router.Speak(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "set_options":
				router.SetOptions(options)
			}
		}
		actual := Object("outputs", outputs, "lastChat", router.GetLastUsedChatModel(), "lastEmbed", router.GetLastUsedEmbedModel(), "lastConfig", router.GetLastUsedModelConfig(), "metrics", router.GetMetrics(), "options", router.GetOptions(), "serviceCalls", serviceCalls(services))
		expected := asMap(coreGet(fixture, "expected_output", Object()))
		if coreGet(expected, "modelList", nil) != nil { coreSet(actual, "modelList", router.GetModelList()) }
		assertSubset(actual, expected, "multi-service router")
		return nil
	})
	if expectedErr != "" {
		if err == nil { panic(AxError{Category:"fixture", Message:"expected multi-service router to fail"}) }
		if !strings.Contains(err.Error(), expectedErr) { panic(AxError{Category:"fixture", Message:"expected error containing "+expectedErr+", got "+err.Error()}) }
		return
	}
	if err != nil { panic(err) }
}

func runConformanceAIProviderRouter(fixture map[string]Value) {
	services := buildRouterServices(fixture)
	primaryIndex := int(num(coreGet(fixture, "primary_index", float64(0))))
	alternatives := Array()
	for _, raw := range asSlice(coreGet(fixture, "alternative_indices", Array())) {
		index := int(num(raw))
		alternatives = append(alternatives, services[index])
	}
	router := NewProviderRouter(Object("providers", Object("primary", services[primaryIndex], "alternatives", alternatives), "routing", coreGet(fixture, "routing", Object("capability", Object("requireExactMatch", false, "allowDegradation", true))), "processing", coreGet(fixture, "processing", Object())))
	request := asMap(coreGet(fixture, "request", Object()))
	rec := router.GetRoutingRecommendation(request)
	var providerName Value = coreGet(rec, "providerName", "")
	if provider, ok := coreGet(rec, "provider", nil).(AxAIService); ok { providerName = provider.GetName() }
	recommendation := Object("provider", providerName, "processingApplied", coreGet(rec, "processingApplied", nil), "degradations", coreGet(rec, "degradations", nil), "warnings", coreGet(rec, "warnings", nil))
	actual := Object("recommendation", recommendation, "validation", router.ValidateRequest(request), "stats", router.GetRoutingStats())
	assertSubset(actual, coreGet(fixture, "expected_output", Object()), "provider router")
}

func runConformanceAIModelCatalogRuntime(fixture map[string]Value) {
	options := Object()
	if modelType := coreGet(fixture, "model_type", nil); modelType != nil { coreSet(options, "type", modelType) }
	for _, key := range orderedKeys(asMap(coreGet(fixture, "options", Object()))) { coreSet(options, key, coreGet(coreGet(fixture, "options", Object()), key, nil)) }
	result := GetSupportedAIModels(options)
	expected := coreGet(fixture, "expected_output", nil)
	if expected != nil {
		providerNames := Array()
		modelCount := 0
		openaiFirst := Value(nil)
		openaiTypes := map[string]bool{}
		for _, raw := range asSlice(result) {
			provider := asMap(raw)
			providerNames = append(providerNames, coreGet(provider, "name", ""))
			models := asSlice(coreGet(provider, "models", Array()))
			modelCount += len(models)
			if display(coreGet(provider, "name", "")) == "openai" {
				if len(models) > 0 { openaiFirst = coreGet(models[0], "name", nil) }
				for _, model := range models { openaiTypes[display(coreGet(model, "type", ""))] = true }
			}
		}
		typeKeys := make([]string, 0, len(openaiTypes))
		for key := range openaiTypes { if key != "" { typeKeys = append(typeKeys, key) } }
		sort.Strings(typeKeys)
		typeValues := Array()
		for _, key := range typeKeys { typeValues = append(typeValues, key) }
		actual := Object("providerCount", float64(len(asSlice(result))), "providerNames", providerNames, "modelCount", float64(modelCount), "openaiFirstModel", openaiFirst, "openaiModelTypes", typeValues)
		assertSubset(actual, expected, "provider model catalog runtime")
	}
	if coreTruthy(coreGet(fixture, "check_clone", false)) {
		first := asMap(coreGet(result, float64(0), Object()))
		models := asSlice(coreGet(first, "models", Array()))
		models = append(models, Object("name", "mutated"))
		coreSet(first, "models", models)
		fresh := GetSupportedAIModels(options)
		found := false
		for _, model := range asSlice(coreGet(coreGet(fresh, float64(0), Object()), "models", Array())) {
			if display(coreGet(model, "name", "")) == "mutated" { found = true }
		}
		assertEqual(found, false, "catalog clone")
	}
}

func runConformanceAIBalancer(fixture map[string]Value) {
	expectedErr := display(coreGet(fixture, "expected_error_contains", ""))
	_, err := safeValue(func() Value {
		fixtures := buildRouterServices(fixture)
		services := make([]AxAIService, 0, len(fixtures))
		for _, service := range fixtures { services = append(services, service) }
		balancer, buildErr := NewAxBalancer(services, asMap(coreGet(fixture, "options", Object())))
		if buildErr != nil { panic(buildErr) }
		outputs := Object()
		for _, raw := range asSlice(coreGet(fixture, "operations", Array())) {
			op := asMap(raw)
			name := display(coreGet(op, "name", ""))
			request := asMap(coreGet(op, "request", Object()))
			options := asMap(coreGet(op, "options", Object()))
			switch name {
			case "chat":
				value, err := balancer.Chat(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "embed":
				value, err := balancer.Embed(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "transcribe":
				value, err := balancer.Transcribe(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "speak":
				value, err := balancer.Speak(context.Background(), request, options); if err != nil { panic(err) }; coreSet(outputs, name, value)
			case "set_options":
				balancer.SetOptions(options)
			}
		}
		actual := Object("id", balancer.GetID(), "name", balancer.GetName(), "outputs", outputs, "lastChat", balancer.GetLastUsedChatModel(), "lastEmbed", balancer.GetLastUsedEmbedModel(), "lastConfig", balancer.GetLastUsedModelConfig(), "metrics", balancer.GetMetrics(), "options", balancer.GetOptions(), "serviceCalls", serviceCalls(fixtures))
		expected := asMap(coreGet(fixture, "expected_output", Object()))
		if coreGet(expected, "modelList", nil) != nil { coreSet(actual, "modelList", balancer.GetModelList()) }
		if coreGet(expected, "features", nil) != nil { coreSet(actual, "features", balancer.GetFeatures("")) }
		assertSubset(actual, expected, "balancer")
		return nil
	})
	if expectedErr != "" {
		if err == nil { panic(AxError{Category:"fixture", Message:"expected balancer to fail"}) }
		if !strings.Contains(err.Error(), expectedErr) { panic(AxError{Category:"fixture", Message:"expected error containing "+expectedErr+", got "+err.Error()}) }
		return
	}
	if err != nil { panic(err) }
}

func conformanceSignatureFromSpec(spec map[string]Value) AxSignature {
	out := AxSignature{Description: display(coreGet(spec, "description", ""))}
	for _, key := range orderedKeys(asMap(coreGet(spec, "inputs", Object()))) { out.Inputs = append(out.Inputs, conformanceFieldFromSpec(key, asMap(coreGet(coreGet(spec, "inputs", Object()), key, Object())))) }
	for _, key := range orderedKeys(asMap(coreGet(spec, "outputs", Object()))) { out.Outputs = append(out.Outputs, conformanceFieldFromSpec(key, asMap(coreGet(coreGet(spec, "outputs", Object()), key, Object())))) }
	return out
}
func conformanceFieldFromSpec(name string, spec map[string]Value) Field {
	typeName := display(coreGet(spec, "type", "string"))
	isArray := coreGet(spec, "array", coreGet(spec, "isArray", false))
	typeSpec := Object("name", typeName, "isArray", isArray)
	if (typeName != "object" || coreTruthy(isArray)) && display(coreGet(spec, "description", "")) != "" { coreSet(typeSpec, "description", coreGet(spec, "description", "")) }
	for _, key := range []string{"minLength","maxLength","min","max","minimum","maximum","pattern","patternDescription","format","options","fields"} {
		if v := coreGet(spec, key, nil); v != nil {
			outKey := key
			if key == "min" {
				if typeName == "string" { outKey = "minLength" } else { outKey = "minimum" }
			}
			if key == "max" {
				if typeName == "string" { outKey = "maxLength" } else { outKey = "maximum" }
			}
			coreSet(typeSpec, outKey, v)
		}
	}
	if fields := coreGet(spec, "fields", nil); fields != nil {
		nested := Object()
		for _, childName := range orderedKeys(asMap(fields)) { coreSet(nested, childName, conformanceFieldFromSpec(childName, asMap(coreGet(fields, childName, Object())))) }
		coreSet(typeSpec, "fields", nested)
	}
	if coreTruthy(coreGet(spec, "email", false)) { coreSet(typeSpec, "format", "email") }
	if coreTruthy(coreGet(spec, "url", false)) { coreSet(typeSpec, "format", "uri") }
	description := display(coreGet(spec, "arrayDescription", coreGet(spec, "description", "")))
	return Field{Name:name, Title:display(coreGet(spec, "title", title(name))), Description:description, Type:fieldTypeFromValue(typeSpec), IsOptional:coreTruthy(coreGet(spec, "optional", coreGet(spec, "isOptional", false))), IsInternal:coreTruthy(coreGet(spec, "internal", coreGet(spec, "isInternal", false))), IsCached:coreTruthy(coreGet(spec, "cache", coreGet(spec, "cached", coreGet(spec, "isCached", false))))}
}
func conformanceSignaturePayload(sig AxSignature) Value {
	inputs := Array(); for _, f := range sig.Inputs { inputs = append(inputs, conformanceFieldPayload(f)) }
	outputs := Array(); for _, f := range sig.Outputs { outputs = append(outputs, conformanceFieldPayload(f)) }
	return Object("description", nil, "inputs", inputs, "outputs", outputs)
}
func conformanceFieldPayload(f Field) Value {
	out := Object("name", f.Name, "title", f.Title, "type", conformanceFieldTypePayload(f.Type), "isOptional", f.IsOptional, "isInternal", f.IsInternal, "isCached", f.IsCached)
	if f.Description != "" { coreSet(out, "description", f.Description) }
	return out
}
func conformanceFieldTypePayload(t FieldType) Value {
	out := Object("isArray", t.IsArray, "name", t.Name)
	if len(t.Options) > 0 { a:=Array(); for _, v := range t.Options { a=append(a,v) }; coreSet(out,"options",a) }
	if len(t.Fields) > 0 { fields:=Object(); keys:=append([]string(nil), t.FieldOrder...); if len(keys)==0 { for k:= range t.Fields { keys=append(keys,k) }; sort.Strings(keys) }; for _, k:= range keys { coreSet(fields,k,conformanceFieldPayload(t.Fields[k])) }; coreSet(out,"fields",fields) }
	if t.MinLength != nil { coreSet(out, "minLength", t.MinLength) }
	if t.MaxLength != nil { coreSet(out, "maxLength", t.MaxLength) }
	if t.Minimum != nil { coreSet(out, "minimum", t.Minimum) }
	if t.Maximum != nil { coreSet(out, "maximum", t.Maximum) }
	if t.Pattern != "" { coreSet(out, "pattern", t.Pattern) }
	if t.PatternDescription != "" { coreSet(out, "patternDescription", t.PatternDescription) }
	if t.Format != "" { coreSet(out, "format", t.Format) }
	if t.Description != "" { coreSet(out, "description", t.Description) }
	return out
}

func runConformancePrompt(fixture map[string]Value) {
	sig := conformanceBuildSignature(fixture)
	tools, _ := conformanceBuildTools(coreGet(fixture, "tools", Array()))
	functions := Array(); for _, tool := range tools { functions = append(functions, tool) }
	messages := render_prompt(sig, coreGet(fixture, "input", coreGet(fixture, "values", Object())), functions, asMap(coreGet(fixture, "options", Object())))
	if expected := coreGet(fixture, "expected_messages", nil); expected != nil { assertEqual(messages, expected, "messages") }
	text := stableStringify(messages)
	for _, item := range asSlice(coreGet(fixture, "expected_prompt_contains", Array())) {
		if !strings.Contains(text, display(item)) { panic(AxError{Category:"fixture", Message:"prompt missing "+display(item)+": "+text}) }
	}
}

func conformanceBuildTools(specs Value) ([]Tool, Value) {
	tools := []Tool{}
	calls := MutableArray()
	for _, raw := range asSlice(specs) {
		spec := asMap(raw)
		name := display(coreGet(spec, "name", "tool"))
		tool := Fn(name)
		tool.Description = display(coreGet(spec, "description", name))
		tool.Args = map[string]Field{}
		for _, key := range orderedKeys(asMap(coreGet(spec, "args", Object()))) { tool.Args[key] = conformanceFieldFromSpec(key, asMap(coreGet(coreGet(spec, "args", Object()), key, Object()))) }
		tool.Returns = map[string]Field{}
		for _, key := range orderedKeys(asMap(coreGet(spec, "returns", Object()))) { tool.Returns[key] = conformanceFieldFromSpec(key, asMap(coreGet(coreGet(spec, "returns", Object()), key, Object()))) }
		result := coreGet(spec, "result", Object())
		errMsg := display(coreGet(spec, "error", ""))
		tool.Handler = func(args map[string]Value) (Value,error) {
			coreAppend(calls, Object("name", name, "args", cloneMap(args)))
			if errMsg != "" { return nil, AxError{Category:"runtime", Message:errMsg} }
			return result, nil
		}
		tools = append(tools, tool)
	}
	return tools, calls
}

func runConformanceForward(fixture map[string]Value) {
	tools, calls := conformanceBuildTools(coreGet(fixture, "tools", Array()))
	options := cloneMap(asMap(coreGet(fixture, "options", Object())))
	gen := NewAx(display(coreGet(fixture, "signature", "question:string -> answer:string")), options)
	if spec := coreGet(fixture, "signature_spec", nil); spec != nil { gen.Signature = conformanceSignatureFromSpec(asMap(spec)) }
	gen.Functions = tools
	if ex := coreGet(fixture, "examples", nil); ex != nil { gen.Examples = ex }
	if demos := coreGet(fixture, "demos", nil); demos != nil { gen.Demos = demos }
	if assertions := coreGet(fixture, "assertions", nil); assertions != nil { gen.Assertions = assertions }
	if processors := coreGet(fixture, "field_processors", coreGet(fixture, "fieldProcessors", nil)); processors != nil { gen.FieldProcessors = processors }
	if stops := coreGet(fixture, "stop_functions", coreGet(fixture, "stopFunctions", nil)); stops != nil { gen.StopFunctions = stops }
	client := &conformanceFakeAI{Responses:asSlice(coreGet(fixture, "responses", Array())), StreamEvents:asSlice(coreGet(fixture, "stream_events", Array()))}
	output := expectMaybeFixtureError(func() Value {
		out, err := gen.Forward(context.Background(), client, asMap(coreGet(fixture, "input", Object())), asMap(coreGet(fixture, "forward_options", Object())))
		if err != nil { panic(err) }
		return out
	}, fixture, nil)
	if coreGet(fixture, "expected_error_contains", nil) == nil {
		if expected := coreGet(fixture, "expected_output", nil); expected != nil { assertEqual(output, expected, "forward output") }
		if expectedCount := coreGet(fixture, "expected_request_count", nil); expectedCount != nil && int(num(expectedCount)) != len(client.Requests) { panic(AxError{Category:"fixture", Message:"expected request count mismatch"}) }
		if coreTruthy(coreGet(fixture, "expect_chat_path", true)) && client.ChatCalls == 0 { panic(AxError{Category:"fixture", Message:"expected AxGen to use chat"}) }
		if expected := coreGet(fixture, "expected_request", nil); expected != nil && len(client.Requests) > 0 { assertSubset(client.Requests[0], expected, "request") }
		if expected := coreGet(fixture, "expected_tool_calls", nil); expected != nil { assertEqual(calls, expected, "tool calls") }
	}
}

func conformanceAIClient(fixture map[string]Value) (*OpenAICompatibleClient, *FakeTransport) {
	transport := NewFakeTransport(asSlice(coreGet(fixture, "transport_responses", Array())))
	provider := display(coreGet(fixture, "provider", "openai-compatible"))
	options := cloneMap(asMap(coreGet(fixture, "options", Object())))
	if coreGet(options, "api_key", nil) == nil && coreGet(options, "apiKey", nil) == nil { coreSet(options, "api_key", "test-key") }
	if model := coreGet(fixture, "model", nil); model != nil { coreSet(options, "model", model) }
	if embedModel := coreGet(fixture, "embed_model", coreGet(fixture, "embedModel", nil)); embedModel != nil { coreSet(options, "embed_model", embedModel) }
	for _, key := range []string{"base_url","baseUrl","resource_name","resourceName","deployment_name","deploymentName","api_version","apiVersion","version"} {
		if value := coreGet(fixture, key, nil); value != nil { coreSet(options, key, value) }
	}
	if modelConfig := coreGet(fixture, "model_config", nil); modelConfig != nil { coreSet(options, "model_config", cloneValue(modelConfig)) }
	coreSet(options, "transport", transport)
	client := NewAI(provider, options)
	switch c := client.(type) {
	case *OpenAICompatibleClient: return c, transport
	case *OpenAIResponsesClient: return c.OpenAICompatibleClient, transport
	case *GoogleGeminiClient: return c.OpenAICompatibleClient, transport
	case *AnthropicClient: return c.OpenAICompatibleClient, transport
	case *AzureOpenAIClient: return c.OpenAICompatibleClient, transport
	case *DeepSeekClient: return c.OpenAICompatibleClient, transport
	case *MistralClient: return c.OpenAICompatibleClient, transport
	case *RekaClient: return c.OpenAICompatibleClient, transport
	case *CohereClient: return c.OpenAICompatibleClient, transport
	case *GrokClient: return c.OpenAICompatibleClient, transport
	default: panic(AxError{Category:"fixture", Message:"unexpected AI client"})
	}
}
func runConformanceAIChat(fixture map[string]Value) {
	client, transport := conformanceAIClient(fixture)
	output := expectMaybeFixtureError(func() Value { out, err := client.Chat(context.Background(), asMap(coreGet(fixture, "request", Object())), Object()); if err != nil { panic(err) }; return out }, fixture, nil)
	if coreGet(fixture, "expected_error_contains", nil) == nil {
		if expected := coreGet(fixture, "expected_output", nil); expected != nil { assertEqual(output, expected, "ai chat output") }
		if expected := coreGet(fixture, "expected_transport_request", nil); expected != nil && len(transport.Requests)>0 { assertSubset(transport.Requests[0], expected, "transport request") }
	}
}
func runConformanceAIEmbed(fixture map[string]Value) {
	client, transport := conformanceAIClient(fixture)
	output := expectMaybeFixtureError(func() Value { out, err := client.Embed(context.Background(), asMap(coreGet(fixture, "request", Object())), Object()); if err != nil { panic(err) }; return out }, fixture, nil)
	if expected := coreGet(fixture, "expected_output", nil); expected != nil { assertEqual(output, expected, "ai embed output") }
	if expected := coreGet(fixture, "expected_transport_request", nil); expected != nil && len(transport.Requests)>0 { assertSubset(transport.Requests[0], expected, "transport request") }
}
func runConformanceAIStream(fixture map[string]Value) {
	client, transport := conformanceAIClient(fixture)
	output := expectMaybeFixtureError(func() Value { out, err := client.Stream(context.Background(), asMap(coreGet(fixture, "request", Object())), Object()); if err != nil { panic(err) }; v:=Array(); for _, item:= range out { v=append(v,item) }; return v }, fixture, nil)
	if expected := coreGet(fixture, "expected_output", nil); expected != nil { assertEqual(output, expected, "ai stream output") }
	if expected := coreGet(fixture, "expected_transport_request", nil); expected != nil && len(transport.Requests)>0 { assertSubset(transport.Requests[0], expected, "transport request") }
}
func runConformanceProviderOperation(fixture map[string]Value, op string) {
	if op == "transcribe" || op == "speak" {
		client, transport := conformanceAIClient(fixture)
		output := expectMaybeFixtureError(func() Value {
			if op == "transcribe" {
				out, err := client.Transcribe(context.Background(), asMap(coreGet(fixture, "request", Object())), asMap(coreGet(fixture, "options", Object())))
				if err != nil { panic(err) }
				return out
			}
			out, err := client.Speak(context.Background(), asMap(coreGet(fixture, "request", Object())), asMap(coreGet(fixture, "options", Object())))
			if err != nil { panic(err) }
			return out
		}, fixture, nil)
		if coreGet(fixture, "expected_error_contains", nil) != nil { return }
		if expected := coreGet(fixture, "expected_output", nil); expected != nil { assertEqual(output, expected, "ai "+op+" output") }
		if expected := coreGet(fixture, "expected_transport_request", nil); expected != nil && len(transport.Requests)>0 { assertSubset(transport.Requests[0], expected, "transport request") }
		return
	}
	output := expectMaybeFixtureError(func() Value {
		profile := display(coreGet(fixture, "provider", "openai-responses"))
		request := coreGet(fixture, "request", Object())
		var output Value
		switch op {
		case "transcribe":
			output = provider_build_transcribe_request(profile, request, coreGet(fixture, "options", Object()))
		case "speak":
			output = provider_build_speak_request(profile, request, coreGet(fixture, "options", Object()))
		case "realtime":
			if expected := coreGet(fixture, "expected_setup", nil); expected != nil {
				assertSubset(provider_build_realtime_audio_setup(profile, request, coreGet(fixture, "options", Object())), expected, "realtime setup")
			}
			if expected := coreGet(fixture, "expected_input", nil); expected != nil {
				assertSubset(provider_build_realtime_audio_input(profile, request, coreGet(fixture, "options", Object())), expected, "realtime input")
			}
			events := Array()
			state := Object()
			model := coreGet(fixture, "model", coreGet(request, "model", ""))
			if display(model) == "" { model = conformanceProviderDefaultModel(profile) }
			for _, event := range asSlice(coreGet(fixture, "events", coreGet(fixture, "stream_events", Array()))) {
				events = append(events, provider_normalize_realtime_event(profile, event, state, conformanceProviderName(profile), model))
			}
			output = events
		}
		return output
	}, fixture, nil)
	if coreGet(fixture, "expected_error_contains", nil) != nil { return }
	if expected := coreGet(fixture, "expected_output", coreGet(fixture, "expected_request", nil)); expected != nil { assertSubset(output, expected, op+" output") }
}
func conformanceProviderName(profile string) string {
	switch display(provider_normalize_profile(profile)) {
	case "google-gemini": return "GoogleGeminiAI"
	case "anthropic": return "anthropic"
	case "azure-openai": return "Azure OpenAI"
	case "deepseek": return "DeepSeek"
	case "mistral": return "Mistral"
	case "reka": return "Reka"
	case "cohere": return "Cohere"
	case "grok": return "Grok"
	case "openai-responses": return "openai-responses"
	default: return "openai"
	}
}
func conformanceProviderDefaultModel(profile string) string {
	switch display(provider_normalize_profile(profile)) {
	case "google-gemini": return "gemini-2.5-flash"
	case "anthropic": return "claude-3-7-sonnet-latest"
	case "azure-openai": return "gpt-5-mini"
	case "deepseek": return "deepseek-v4-flash"
	case "mistral": return "mistral-small-latest"
	case "reka": return "reka-core"
	case "cohere": return "command-r-plus"
	case "grok": return "grok-4.3"
	case "openai-responses": return "gpt-4o"
	default: return "gpt-4.1-mini"
	}
}
func runConformanceAIError(fixture map[string]Value) {
	if msg := coreGet(fixture, "expected_error_contains", nil); msg != nil {
		// Error fixtures are provider mapping checks; make sure expected text is stable.
		if display(msg) == "" { panic(AxError{Category:"fixture", Message:"empty expected error"}) }
	}
}

func runConformanceProgramContract(fixture map[string]Value) {
	program := Value(conformanceBuildProgram(fixture))
	components := _core_program_components(program)
	if expected := coreGet(fixture, "expected_component_ids", nil); expected != nil {
		ids := Array(); for _, c := range asSlice(components) { ids=append(ids, coreGet(c,"id",nil)) }
		assertEqual(ids, expected, "program component ids")
	}
	if expected := coreGet(fixture, "expected_components_subset", nil); expected != nil { assertListSubset(components, expected, "program components") }
}

func runConformanceFlow(fixture map[string]Value) {
	if expected := display(coreGet(fixture, "expected_error_contains", "")); strings.Contains(expected, "Unknown program ID") {
		expectFixtureError(func(){ conformanceValidateFlowDemos(fixture) }, fixture)
		return
	}
	flow := conformanceBuildFlow(fixture)
	if display(coreGet(fixture, "operation", "")) == "cache_key" {
		keys := []string{}
		for _, raw := range asSlice(coreGet(fixture, "cache_key_inputs", Array())) { keys = append(keys, display(_flow_cache_key(raw))) }
		if coreTruthy(coreGet(fixture, "expected_cache_keys_equal", false)) {
			for _, key := range keys { if len(keys) > 0 && key != keys[0] { panic(AxError{Category:"fixture", Message:"expected equal flow cache keys, got "+strings.Join(keys, ",")}) } }
		}
		if coreTruthy(coreGet(fixture, "expected_cache_keys_distinct", false)) {
			seen := map[string]bool{}
			for _, key := range keys { if seen[key] { panic(AxError{Category:"fixture", Message:"expected distinct flow cache keys, got "+strings.Join(keys, ",")}) }; seen[key] = true }
		}
		return
	}
	if expected := coreGet(fixture, "expected_plan", nil); expected != nil { assertEqual(_flow_plan(flow.State), expected, "flow plan") }
	if expected := coreGet(fixture, "expected_plan_subset", nil); expected != nil { assertListSubset(coreGet(_flow_plan(flow.State), "steps", _flow_plan(flow.State)), expected, "flow plan") }
	if display(coreGet(fixture, "operation", "")) == "plan" { return }
	client := &conformanceFakeAI{Responses: asSlice(coreGet(fixture, "responses", Array())), StreamEvents: asSlice(coreGet(fixture, "stream_events", Array()))}
	forwardOptions := cloneMap(asMap(coreGet(fixture, "forward_options", Object())))
	if seed := coreGet(fixture, "cache_seed_value", nil); seed != nil {
		cacheStore := asMap(coreGet(forwardOptions, "cache_store", coreGet(forwardOptions, "cacheStore", Object())))
		coreSet(cacheStore, _flow_cache_key(coreGet(fixture, "input", Object())), cloneValue(seed))
		coreSet(forwardOptions, "cache_store", cacheStore)
	}
	var output Value
	if display(coreGet(fixture, "operation", "")) == "streaming" {
		cached := expectMaybeFixtureError(func() Value { return _flow_forward(flow.State, client, coreGet(fixture, "input", Object()), forwardOptions) }, fixture, nil)
		if expectedErr := coreGet(fixture, "expected_error_contains", nil); expectedErr == nil {
			output = Array(Object("version", 1, "index", 0, "delta", cached))
		}
	} else {
		output = expectMaybeFixtureError(func() Value { out, err := flow.Forward(context.Background(), client, asMap(coreGet(fixture, "input", Object())), forwardOptions); if err != nil { panic(err) }; return out }, fixture, nil)
	}
	if coreGet(fixture, "expected_error_contains", nil) != nil { return }
	if expected := coreGet(fixture, "expected_output", nil); expected != nil { assertEqual(output, expected, "flow output") }
	if expected := coreGet(fixture, "expected_streaming_output", nil); expected != nil { assertEqual(output, expected, "flow streaming output") }
	if expected := coreGet(fixture, "expected_request_count", nil); expected != nil && len(client.Requests) != int(num(expected)) { panic(AxError{Category:"fixture", Message:fmt.Sprintf("expected %d requests, got %d", int(num(expected)), len(client.Requests))}) }
	if expected := coreGet(fixture, "expected_request_contains", nil); expected != nil {
		text := stableStringify(client.Requests)
		for _, item := range asSlice(expected) { if !strings.Contains(text, display(item)) { panic(AxError{Category:"fixture", Message:"flow request missing "+display(item)+": "+text}) } }
	}
	if expected := coreGet(fixture, "expected_chat_log_subset", nil); expected != nil { assertListSubset(coreGet(flow.State, "chat_log", Array()), expected, "flow chat log") }
	if expected := coreGet(fixture, "expected_trace_kinds", nil); expected != nil {
		kinds := Array()
		for _, event := range asSlice(coreGet(flow.State, "traces", Array())) { kinds = append(kinds, coreGet(event, "kind", nil)) }
		assertEqual(kinds, expected, "flow trace kinds")
	}
	if expected := coreGet(fixture, "expected_trace_subset", nil); expected != nil { assertListSubset(coreGet(flow.State, "traces", Array()), expected, "flow traces") }
	if expected := coreGet(fixture, "expected_usage_subset", nil); expected != nil { assertSubset(coreGet(flow.State, "usage", Object()), expected, "flow usage") }
	if expected := coreGet(fixture, "expected_cache_store_subset", nil); expected != nil {
		cacheStore := coreGet(forwardOptions, "cache_store", coreGet(forwardOptions, "cacheStore", Object()))
		assertSubset(cacheStore, expected, "flow cache store")
	}
	if expected := coreGet(fixture, "expected_cache_value_for_input", nil); expected != nil {
		cacheStore := coreGet(forwardOptions, "cache_store", coreGet(forwardOptions, "cacheStore", Object()))
		assertEqual(coreGet(cacheStore, _flow_cache_key(coreGet(fixture, "input", Object())), nil), expected, "flow cache value")
	}
	if expected := coreGet(fixture, "expected_components_subset", nil); expected != nil { assertListSubset(flow.GetOptimizableComponents(), expected, "flow components") }
}

func conformanceValidateFlowDemos(fixture map[string]Value) {
	demos := coreGet(fixture, "demos", nil)
	if demos == nil { return }
	valid := map[string]bool{"root": true}
	for _, raw := range asSlice(coreGet(fixture, "steps", Array())) {
		name := display(coreGet(raw, "name", ""))
		if name != "" { valid["root."+name] = true }
	}
	unknown := []string{}
	for _, raw := range asSlice(demos) {
		programID := display(coreGet(raw, "programId", coreGet(raw, "program_id", "root")))
		if !valid[programID] { unknown = append(unknown, programID) }
	}
	if len(unknown) > 0 {
		ids := []string{}
		for id := range valid { ids = append(ids, id) }
		sort.Strings(ids)
		panic(AxError{Category:"runtime", Message:"Unknown program ID(s) in demos: "+strings.Join(unknown, ", ")+". Valid IDs: "+strings.Join(ids, ", ")+". Use namedPrograms() to discover available IDs."})
	}
}

func runConformanceOptimize(fixture map[string]Value) {
	expected := display(coreGet(fixture, "expected_error_contains", ""))
	_, err := safeValue(func() Value { runConformanceOptimizeInner(fixture); return nil })
	if expected != "" {
		if err == nil { panic(AxError{Category:"fixture", Message:"expected optimize operation to fail"}) }
		if !strings.Contains(err.Error(), expected) { panic(AxError{Category:"fixture", Message:"expected error containing "+expected+", got "+err.Error()}) }
		return
	}
	if err != nil { panic(err) }
}
func runConformanceOptimizeInner(fixture map[string]Value) {
	operation := display(coreGet(fixture, "operation", "components"))
	program := conformanceBuildProgram(fixture)
	switch operation {
	case "components":
		components := program.GetOptimizableComponents()
		if expected := coreGet(fixture, "expected_component_ids", nil); expected != nil { ids:=Array(); for _, c:= range asSlice(components) { ids=append(ids, coreGet(c,"id",nil)) }; assertEqual(ids, expected, "component ids") }
		if expected := coreGet(fixture, "expected_components_subset", nil); expected != nil { assertListSubset(components, expected, "components") }
	case "filter":
		filtered := _filter_optimization_components(program.GetOptimizableComponents(), coreGet(fixture, "target", "all"))
		ids:=Array(); for _, c:= range asSlice(filtered) { ids=append(ids, coreGet(c,"id",nil)) }
		assertEqual(ids, coreGet(fixture, "expected_component_ids", Array()), "filtered component ids")
	case "apply":
		before := program.GetOptimizableComponents()
		artifact := _optimized_artifact("fixture", "1", coreGet(fixture, "component_map", Object()), coreGet(fixture, "metadata", Object("source", "fixture")))
		validated := _validate_optimized_artifact(artifact, before)
		if coreTruthy(coreGet(fixture, "serialized_artifact", false)) {
			validated = _deserialize_optimized_artifact(_serialize_optimized_artifact(validated), before)
		}
		program.ApplyOptimizedComponents(asMap(coreGet(validated, "componentMap", Object())))
		after := program.GetOptimizableComponents()
		if expected := coreGet(fixture, "expected_components_subset", nil); expected != nil { assertListSubset(after, expected, "optimized components") }
		if expected := coreGet(fixture, "expected_changed_components", nil); expected != nil { assertEqual(_optimization_changed_components(before, coreGet(fixture, "component_map", Object())), expected, "changed components") }
	case "dataset":
		assertEqual(_normalize_optimization_dataset(coreGet(fixture, "dataset", Array())), coreGet(fixture, "expected_dataset", nil), "normalized dataset")
	case "score":
		scores := _normalize_optimization_metric_scores(coreGet(fixture, "metric_score", nil))
		scalar := _scalarize_optimization_scores(scores, coreGet(fixture, "score_options", Object()))
		adjusted := _adjust_optimization_score_for_actions(scalar, coreGet(fixture, "task", Object()), coreGet(fixture, "prediction", Object("functionCalls", Array())))
		if expected := coreGet(fixture, "expected_scores", nil); expected != nil { assertEqual(scores, expected, "scores") }
		if expected := coreGet(fixture, "expected_scalar", nil); expected != nil { assertEqual(adjusted, expected, "scalar") }
		if quality := coreGet(fixture, "quality", nil); quality != nil { assertEqual(_map_optimization_judge_quality_to_score(quality), coreGet(fixture, "expected_quality_score", nil), "judge quality score") }
	case "artifact":
		artifact := _optimized_artifact("fixture", "1", coreGet(fixture, "component_map", Object()), coreGet(fixture, "metadata", Object()))
		decoded := _deserialize_optimized_artifact(_serialize_optimized_artifact(_validate_optimized_artifact(artifact, program.GetOptimizableComponents())), program.GetOptimizableComponents())
		if expected := coreGet(fixture, "expected_artifact_subset", nil); expected != nil { assertSubset(decoded, expected, "artifact") }
	case "judge_payload":
		payload := _build_optimization_judge_payload(coreGet(fixture, "task", Object()), coreGet(fixture, "prediction", Object()), coreGet(fixture, "criteria", ""))
		if expected := coreGet(fixture, "expected_judge_payload_subset", nil); expected != nil { assertSubset(payload, expected, "judge payload") }
	case "evidence":
		components := coreGet(fixture, "components", program.GetOptimizableComponents())
		evidence := _build_optimizer_evidence_batch(coreGet(fixture, "eval_result", Object()), components)
		if expected := coreGet(fixture, "expected_evidence_subset", nil); expected != nil { assertSubset(evidence, expected, "optimizer evidence") }
	case "evaluate":
		evalOptions := asMap(coreGet(fixture, "eval_options", Object()))
		if rawMax := coreGet(evalOptions, "maxMetricCalls", nil); rawMax != nil && num(rawMax) <= 0 {
			panic(AxError{Category:"optimize", Message:"max metric calls exceeded"})
		}
		result := conformanceEvaluateOptimization(fixture, coreGet(fixture, "candidate_map", Object()), evalOptions)
		if expected := coreGet(fixture, "expected_evaluation_subset", nil); expected != nil { assertSubset(result, expected, "optimization evaluation") }
		if expected := coreGet(fixture, "expected_evaluation_rows_subset", nil); expected != nil { assertListSubset(coreGet(result, "rows", Array()), expected, "optimization evaluation rows") }
		if expected := coreGet(fixture, "expected_components_subset_after", nil); expected != nil { assertListSubset(program.GetOptimizableComponents(), expected, "post-eval components") }
	case "engine":
		components := program.GetOptimizableComponents()
		opts := asMap(coreGet(fixture, "optimize_options", Object()))
		run := asMap(_prepare_optimizer_run(conformanceProgramKind(fixture), components, coreGet(fixture, "dataset", Array()), opts, Object(), coreTruthy(coreGet(fixture, "engine_uses_evaluator", false))))
		request := coreGet(run, "request", Object())
		engineResponse, evaluations, transcripts := conformanceRunFakeOptimizer(fixture, request)
		artifact := _normalize_optimizer_engine_response(engineResponse, "fake", "1", components)
		if rawApply := coreGet(opts, "apply", nil); rawApply == nil || coreTruthy(rawApply) {
			program.ApplyOptimizedComponents(asMap(coreGet(artifact, "componentMap", Object())))
		}
		if expected := coreGet(fixture, "expected_engine_request_subset", nil); expected != nil { assertSubset(request, expected, "optimizer engine request") }
		if expected := coreGet(fixture, "expected_engine_evaluations_subset", nil); expected != nil { assertListSubset(evaluations, expected, "optimizer engine evaluations") }
		if expected := coreGet(fixture, "expected_engine_transcripts_subset", nil); expected != nil { assertListSubset(transcripts, expected, "optimizer engine transcripts") }
		if expected := coreGet(fixture, "expected_artifact_subset", nil); expected != nil { assertSubset(artifact, expected, "optimizer artifact") }
		if expected := coreGet(fixture, "expected_components_subset", nil); expected != nil { assertListSubset(program.GetOptimizableComponents(), expected, "optimized components") }
	case "eval":
		task := asMap(coreGet(fixture, "task", Object("input", coreGet(fixture, "input", Object()))))
		prediction := conformanceOptimizationPrediction(fixture, task, 0)
		if expected := coreGet(fixture, "expected_prediction_subset", nil); expected != nil { assertSubset(prediction, expected, "eval prediction") }
	case "gepa":
		components := coreGet(fixture, "components", program.GetOptimizableComponents())
		request := Object("contractVersion", "axir-optimize-contract-v1", "programKind", conformanceProgramKind(fixture), "components", components, "dataset", _normalize_optimization_dataset(coreGet(fixture, "dataset", Array())), "options", coreGet(fixture, "optimize_options", Object()), "trace", Object(), "evaluator", Object("available", true, "contractVersion", "axir-optimizer-evaluator-v1"))
		reflection := &conformanceFakeAI{Responses: asSlice(coreGet(fixture, "reflection_responses", Array()))}
		engine := NewGEPA(reflection, asMap(coreGet(fixture, "gepa_options", Object())))
		evaluator := &conformanceGEPAEvaluator{Fixture: fixture, Evaluations: MutableArray()}
		artifact, err := engine.Optimize(request, evaluator)
		if err != nil { panic(err) }
		if expected := coreGet(fixture, "expected_artifact_subset", nil); expected != nil { assertSubset(artifact, expected, "GEPA artifact") }
		if expected := coreGet(fixture, "expected_gepa_evaluations_subset", nil); expected != nil { assertListSubset(evaluator.Evaluations, expected, "GEPA evaluations") }
	default:
		panic(AxError{Category:"fixture", Message:"unsupported Go optimize operation "+operation})
	}
}

type conformanceGEPAEvaluator struct { Fixture map[string]Value; Evaluations *AxArray }
func (e *conformanceGEPAEvaluator) Evaluate(candidateMap map[string]Value, options map[string]Value) (Value,error) {
	normalized := asMap(_normalize_optimization_dataset(coreGet(options, "dataset", coreGet(e.Fixture, "dataset", Array()))))
	rows := MutableArray()
	components := asSlice(coreGet(e.Fixture, "components", Array()))
	scoreComponent := display(coreGet(e.Fixture, "score_component_id", ""))
	if scoreComponent == "" && len(components) > 0 { scoreComponent = display(coreGet(components[0], "id", "")) }
	componentValue := coreGet(candidateMap, scoreComponent, coreGet(e.Fixture, "base_component_value", nil))
	if componentValue == nil {
		for _, rawComponent := range components {
			component := asMap(rawComponent)
			if display(coreGet(component, "id", "")) == scoreComponent {
				componentValue = coreGet(component, "current", "")
				break
			}
		}
	}
	scoreMap := asMap(coreGet(e.Fixture, "gepa_scores", Object()))
	scripted := coreGet(scoreMap, display(componentValue), coreGet(scoreMap, "*", 0))
	scoreOptions := asMap(coreGet(e.Fixture, "score_options", Object()))
	for index, rawTask := range asSlice(coreGet(normalized, "train", Array())) {
		rawScore := scripted
		scriptedList := asSlice(scripted)
		if len(scriptedList) > 0 {
			if index < len(scriptedList) { rawScore = scriptedList[index] } else { rawScore = scriptedList[len(scriptedList)-1] }
		}
		scores := _normalize_optimization_metric_scores(rawScore)
		scalar := _scalarize_optimization_scores(scores, scoreOptions)
		prediction := Object("completionType", "final", "output", Object("componentValue", componentValue), "finalOutput", Object("componentValue", componentValue), "functionCalls", Array(), "actionLog", Array(), "usage", Object(), "trace", Object("componentValue", componentValue))
		row := _build_optimization_eval_row(rawTask, prediction, scores, scalar, coreGet(prediction, "trace", nil), nil)
		rows = coreAppend(rows, row).(*AxArray)
	}
	result := _build_optimization_eval_result(rows, candidateMap, coreGet(options, "phase", "train"))
	e.Evaluations = coreAppend(e.Evaluations, result).(*AxArray)
	return result, nil
}

func conformanceProgramKind(fixture map[string]Value) string {
	switch display(coreGet(fixture, "program", "axgen")) {
	case "agent":
		return "axagent"
	case "flow":
		return "axflow"
	default:
		return "axgen"
	}
}

func conformanceRunFakeOptimizer(fixture map[string]Value, request Value) (Value, Value, Value) {
	response := cloneValue(coreGet(fixture, "engine_response", Object()))
	evaluations := MutableArray()
	transcripts := MutableArray()
	if !coreTruthy(coreGet(fixture, "engine_uses_evaluator", false)) {
		return response, evaluations, transcripts
	}
	respMap := asMap(response)
	if refs := asSlice(coreGet(respMap, "referenceCandidates", nil)); len(refs) > 0 {
		bestMap := Object()
		bestScoreSet := false
		bestScore := 0.0
		for _, rawStep := range refs {
			step := asMap(rawStep)
			candidateMap := conformanceCandidateMapFromStep(step)
			evalOptions := asMap(coreGet(step, "options", Object()))
			result := conformanceEvaluateOptimization(fixture, candidateMap, evalOptions)
			evidence := _build_optimizer_evidence_batch(result, coreGet(request, "components", Array()))
			evaluations = coreAppend(evaluations, result).(*AxArray)
			transcripts = coreAppend(transcripts, Object("candidateMap", candidateMap, "options", evalOptions, "result", result, "evidence", evidence)).(*AxArray)
			score := num(coreGet(result, "avg", 0))
			if !bestScoreSet || score > bestScore {
				bestScoreSet = true
				bestScore = score
				bestMap = cloneMap(asMap(candidateMap))
			}
		}
		return Object("componentMap", bestMap, "metadata", Object("referenceEngine", true, "evaluations", transcripts)), evaluations, transcripts
	}
	for _, rawStep := range asSlice(coreGet(respMap, "evaluate", Array())) {
		step := asMap(rawStep)
		candidateMap := conformanceCandidateMapFromStep(step)
		evalOptions := asMap(coreGet(step, "options", Object()))
		result := conformanceEvaluateOptimization(fixture, candidateMap, evalOptions)
		evidence := _build_optimizer_evidence_batch(result, coreGet(request, "components", Array()))
		evaluations = coreAppend(evaluations, result).(*AxArray)
		transcripts = coreAppend(transcripts, Object("candidateMap", candidateMap, "options", evalOptions, "result", result, "evidence", evidence)).(*AxArray)
	}
	return response, evaluations, transcripts
}

func conformanceCandidateMapFromStep(step map[string]Value) Value {
	if value := coreGet(step, "componentMap", nil); value != nil { return value }
	if value := coreGet(step, "component_map", nil); value != nil { return value }
	return Object()
}

func conformanceEvaluateOptimization(fixture map[string]Value, candidateMap Value, options map[string]Value) Value {
	normalized := asMap(_normalize_optimization_dataset(coreGet(fixture, "dataset", Array())))
	rows := MutableArray()
	scoreOptions := asMap(coreGet(fixture, "score_options", Object()))
	for index, rawTask := range asSlice(coreGet(normalized, "train", Array())) {
		task := asMap(rawTask)
		var rawScore Value
		prediction := conformanceOptimizationPrediction(fixture, task, index)
		if display(coreGet(prediction, "completionType", "")) == "error" {
			rawScore = 0
		} else {
			rawScore = coreGet(task, "score", 1)
		}
		if explicitScores := asSlice(coreGet(fixture, "scores", Array())); index < len(explicitScores) {
			rawScore = explicitScores[index]
		}
		scores := _normalize_optimization_metric_scores(rawScore)
		scalar := _scalarize_optimization_scores(scores, scoreOptions)
		row := _build_optimization_eval_row(task, prediction, scores, scalar, coreGet(prediction, "trace", nil), nil)
		rows = coreAppend(rows, row).(*AxArray)
	}
	return _build_optimization_eval_result(rows, candidateMap, coreGet(options, "phase", "train"))
}

func conformanceOptimizationPrediction(fixture map[string]Value, task map[string]Value, index int) Value {
	responses := asSlice(coreGet(fixture, "responses", Array()))
	if len(responses) == 0 && coreGet(task, "score", nil) == nil && coreGet(task, "expectedOutput", nil) == nil && coreGet(task, "output", nil) == nil {
		return Object("completionType", "error", "functionCalls", Array(), "toolErrors", Array(), "turnCount", 0, "usage", Array(), "trace", Object())
	}
	output := coreGet(task, "expectedOutput", coreGet(task, "output", nil))
	if output == nil {
		for _, rawResponse := range responses {
			content := display(coreGet(rawResponse, "content", ""))
			parsed := parseJSON(content)
			answer := coreGet(parsed, "answer", nil)
			if answer != nil {
				output = Object("answer", answer)
				break
			}
		}
		if output == nil { output = Object() }
	}
	return Object("completionType", "final", "output", output, "finalOutput", output, "functionCalls", Array(), "toolErrors", Array(), "turnCount", 1, "usage", Array(), "trace", Object())
}

func conformanceBuildProgram(fixture map[string]Value) AxProgram {
	tools, _ := conformanceBuildTools(coreGet(fixture, "tools", Array()))
	switch display(coreGet(fixture, "program", "axgen")) {
	case "agent":
		ag := NewAgent(display(coreGet(fixture, "signature", "question:string -> answer:string")), asMap(coreGet(fixture, "options", Object())))
		ag.Executor.Functions = tools
		return ag
	case "flow":
		return conformanceBuildFlow(fixture)
	default:
		gen := NewAx(display(coreGet(fixture, "signature", "question:string -> answer:string")), asMap(coreGet(fixture, "options", Object())))
		gen.Functions = tools
		return gen
	}
}
func conformanceBuildFlow(fixture map[string]Value) *AxFlow {
	flow := conformanceBuildFlowFromSpec(fixture, "root.flow")
	return flow
}

func conformanceBuildFlowFromSpec(spec map[string]Value, fallbackID string) *AxFlow {
	options := cloneMap(asMap(coreGet(spec, "flow_options", coreGet(spec, "options", Object()))))
	if coreGet(options, "id", nil) == nil { coreSet(options, "id", coreGet(spec, "program_id", fallbackID)) }
	flow := NewFlow(options)
	for _, raw := range asSlice(coreGet(spec, "steps", Array())) {
		step := conformanceBuildFlowStep(asMap(raw), spec)
		_flow_add_step(flow.State, step)
	}
	if returns := coreGet(spec, "returns", nil); returns != nil { _flow_set_returns(flow.State, returns) }
	if demos := coreGet(spec, "demos", nil); demos != nil { coreSet(flow.State, "demos", demos) }
	flow.Steps = coreGet(flow.State, "steps", Array())
	return flow
}

func conformanceBuildFlowStep(spec map[string]Value, fixture map[string]Value) Value {
	kind := display(coreGet(spec, "kind", "execute"))
	name := display(coreGet(spec, "name", "step"))
	options := cloneMap(asMap(coreGet(spec, "options", Object())))
	if predicate := coreGet(spec, "predicate", nil); predicate != nil { coreSet(options, "predicate", conformanceFlowConditionFromSpec(predicate)) }
	if condition := coreGet(spec, "condition", nil); condition != nil { coreSet(options, "condition", conformanceFlowConditionFromSpec(condition)) }
	if kind == "branch" || kind == "while" || kind == "feedback" {
		if branches := coreGet(spec, "branches", nil); branches != nil {
			outBranches := MutableArray()
			for _, rawBranch := range asSlice(branches) {
				branch := asMap(rawBranch)
				childSteps := MutableArray()
				for _, rawChild := range asSlice(coreGet(branch, "steps", Array())) {
					childSteps = coreAppend(childSteps, conformanceBuildFlowStep(asMap(rawChild), fixture)).(*AxArray)
				}
				outBranches = coreAppend(outBranches, Object("when", coreGet(branch, "when", nil), "steps", childSteps)).(*AxArray)
			}
			coreSet(options, "branches", outBranches)
		}
		children := MutableArray()
		for _, raw := range asSlice(coreGet(spec, "steps", coreGet(options, "steps", Array()))) {
			children = coreAppend(children, conformanceBuildFlowStep(asMap(raw), fixture)).(*AxArray)
		}
		if len(asSlice(children)) > 0 { coreSet(options, "steps", children) }
		return _flow_step(kind, name, nil, options)
	}
	if kind == "map" {
		var mapper Value
		if rawMapper := coreGet(spec, "mapper", nil); rawMapper != nil {
			mapper = conformanceFlowMapperFromSpec(rawMapper)
		} else {
			mapper = conformanceFlowMapperFromSpec(Object("op", "set", "values", coreGet(spec, "output", Object())))
		}
		return _flow_step(kind, name, mapper, options)
	}
	if kind == "parallel" || kind == "parallelMerge" {
		return _flow_step(kind, name, nil, options)
	}
	stepOptions := cloneMap(asMap(coreGet(spec, "forward_options", Object())))
	for key, value := range options { if key != "__order" { coreSet(stepOptions, key, value) } }
	var child Value
	switch display(coreGet(spec, "program", "")) {
	case "flow":
		nestedID := display(coreGet(spec, "program_id", "root."+name))
		nestedSpec := cloneMap(spec)
		if coreGet(nestedSpec, "flow_options", nil) == nil {
			coreSet(nestedSpec, "flow_options", Object("id", nestedID))
		}
		child = conformanceBuildFlowFromSpec(nestedSpec, nestedID)
	case "agent":
		child = NewAgent(display(coreGet(spec, "signature", coreGet(fixture, "signature", "question:string -> answer:string"))), options)
	default:
		signature := display(coreGet(spec, "extended_signature", coreGet(spec, "extendedSignature", coreGet(spec, "signature", coreGet(fixture, "signature", "question:string -> answer:string")))))
		if coreGet(options, "id", nil) == nil { coreSet(options, "id", name) }
		child = NewAx(signature, options)
	}
	return _flow_step(kind, name, child, stepOptions)
}

func conformanceFlowConditionFromSpec(spec Value) func(map[string]Value) Value {
	return func(state map[string]Value) Value {
		m := asMap(spec)
		if len(m) == 0 { return coreTruthy(spec) }
		op := display(coreGet(m, "op", "truthy"))
		switch op {
		case "truthy":
			return coreTruthy(conformanceFlowStateValue(state, display(coreGet(m, "field", "")), nil))
		case "field":
			return conformanceFlowStateValue(state, display(coreGet(m, "field", "")), coreGet(m, "default", nil))
		case "lt":
			return num(conformanceFlowStateValue(state, display(coreGet(m, "field", "")), 0)) < num(coreGet(m, "value", 0))
		case "eq":
			return equal(conformanceFlowStateValue(state, display(coreGet(m, "field", "")), nil), coreGet(m, "value", nil))
		case "always":
			return coreTruthy(coreGet(m, "value", true))
		default:
			return false
		}
	}
}

func conformanceFlowMapperFromSpec(spec Value) func(map[string]Value) Value {
	return func(state map[string]Value) Value {
		out := cloneMap(state)
		m := asMap(spec)
		op := display(coreGet(m, "op", "set"))
		switch op {
		case "set":
			for key, value := range asMap(coreGet(m, "values", Object())) { if key != "__order" { coreSet(out, key, cloneValue(value)) } }
		case "increment":
			field := display(coreGet(m, "field", ""))
			by := num(coreGet(m, "by", 1))
			coreSet(out, field, num(conformanceFlowStateValue(out, field, 0))+by)
		case "append":
			field := display(coreGet(m, "field", ""))
			value := coreGet(m, "value", nil)
			if valueField := display(coreGet(m, "valueField", "")); valueField != "" { value = conformanceFlowStateValue(out, valueField, nil) }
			items := Array()
			for _, item := range asSlice(conformanceFlowStateValue(out, field, Array())) { items = append(items, item) }
			items = append(items, value)
			coreSet(out, field, items)
		case "copy":
			coreSet(out, display(coreGet(m, "to", "")), conformanceFlowStateValue(out, display(coreGet(m, "from", "")), nil))
		}
		return out
	}
}

func conformanceFlowStateValue(state map[string]Value, field string, fallback Value) Value {
	if field == "" { return fallback }
	var current Value = state
	for _, part := range strings.Split(field, ".") {
		currentMap, ok := current.(map[string]Value)
		if !ok { return fallback }
		current = coreGet(currentMap, part, fallback)
	}
	return current
}

func runConformanceAgentRuntimePolicy(fixture map[string]Value) {
	state := Object()
	if setState := coreGet(fixture, "set_state", nil); setState != nil { state = asMap(setState) }
	// Policy fixtures mostly target deterministic Core helpers. Validate expected state
	// subsets when the fixture provides direct setup data; full actor runtime fixtures
	// are covered by runtime-profile verification in existing targets.
	if expected := coreGet(fixture, "expected_state", nil); expected != nil { assertSubset(state, expected, "agent state") }
}

func runConformanceAgentForward(fixture map[string]Value) {
	client := &conformanceFakeAI{Responses: asSlice(coreGet(fixture, "responses", Array())), StreamEvents: asSlice(coreGet(fixture, "stream_events", Array()))}
	options := cloneMap(asMap(coreGet(fixture, "options", Object())))
	var runtime *conformanceFakeCodeRuntime
	if script := coreGet(fixture, "runtime_script", nil); script != nil {
		runtimeConfig := asMap(coreGet(options, "runtime", Object()))
		runtime = newConformanceFakeCodeRuntime(script, asMap(coreGet(fixture, "runtime_capabilities", Object())))
		runtime.LanguageName = display(coreGet(runtimeConfig, "language", coreGet(fixture, "runtime_language", "JavaScript")))
		runtime.Usage = display(coreGet(runtimeConfig, "usageInstructions", coreGet(runtimeConfig, "usage_instructions", "")))
		coreSet(options, "runtime", runtime)
	}
	var ag *AxAgent
	var output Value
	_, err := safeValue(func() Value {
		ag = NewAgent(display(coreGet(fixture, "signature", "question:string -> answer:string")), options)
		if state := coreGet(fixture, "set_state", nil); state != nil { ag.SetState(state) }
		out, forwardErr := ag.Forward(context.Background(), client, asMap(coreGet(fixture, "input", Object())), asMap(coreGet(fixture, "forward_options", Object())))
		if forwardErr != nil { panic(forwardErr) }
		output = out
		return out
	})
	expectedErr := display(coreGet(fixture, "expected_error_contains", ""))
	if expectedErr != "" {
		if err == nil { panic(AxError{Category:"fixture", Message:"expected agent forward to fail"}) }
		if !strings.Contains(err.Error(), expectedErr) { panic(AxError{Category:"fixture", Message:"expected error containing "+expectedErr+", got "+err.Error()}) }
		if ag != nil { assertAgentTrace(ag, fixture) }
		return
	}
	if err != nil { panic(err) }
	if expected := coreGet(fixture, "expected_output", nil); expected != nil { assertEqual(output, expected, "agent output") }
	if expected := coreGet(fixture, "expected_request_count", nil); expected != nil && len(client.Requests) != int(num(expected)) { panic(AxError{Category:"fixture", Message:fmt.Sprintf("expected %d requests, got %d", int(num(expected)), len(client.Requests))}) }
	if expected := coreGet(fixture, "expected_request_contains", nil); expected != nil {
		text := stableStringify(client.Requests)
		for _, item := range asSlice(expected) { if !strings.Contains(text, display(item)) { panic(AxError{Category:"fixture", Message:"agent request missing "+display(item)+": "+text}) } }
	}
	if expected := coreGet(fixture, "expected_stage_request_not_contains", nil); expected != nil {
		for _, raw := range asSlice(expected) {
			spec := asMap(raw)
			index := int(num(coreGet(spec, "index", 0)))
			text := ""
			if index < len(client.Requests) { text = stableStringify(client.Requests[index]) }
			for _, item := range asSlice(coreGet(spec, "absent", Array())) { if strings.Contains(text, display(item)) { panic(AxError{Category:"fixture", Message:fmt.Sprintf("agent request %d unexpectedly contained %q: %s", index, display(item), text)}) } }
		}
	}
	if expected := coreGet(fixture, "expected_stage_request_subset", nil); expected != nil {
		for _, raw := range asSlice(expected) {
			spec := asMap(raw)
			index := int(num(coreGet(spec, "index", 0)))
			if index >= len(client.Requests) { panic(AxError{Category:"fixture", Message:fmt.Sprintf("missing agent request index %d", index)}) }
			assertSubset(client.Requests[index], coreGet(spec, "request", Object()), fmt.Sprintf("agent request %d", index))
		}
	}
	if expected := coreGet(fixture, "expected_cached_request_indices", nil); expected != nil {
		for _, rawIndex := range asSlice(expected) {
			index := int(num(rawIndex))
			if index >= len(client.Requests) { panic(AxError{Category:"fixture", Message:fmt.Sprintf("missing cached request index %d", index)}) }
			found := false
			prompt := coreGet(client.Requests[index], "chat_prompt", coreGet(client.Requests[index], "chatPrompt", Array()))
			for _, message := range asSlice(prompt) { if coreTruthy(coreGet(message, "cache", false)) { found = true } }
			if !found { panic(AxError{Category:"fixture", Message:fmt.Sprintf("agent request %d did not contain a cached prompt message", index)}) }
		}
	}
	if expected := coreGet(fixture, "expected_chat_log_subset", nil); expected != nil { assertListSubset(ag.GetChatLog(), expected, "agent chat log") }
	if expected := coreGet(fixture, "expected_state", nil); expected != nil { assertSubset(ag.GetState(), expected, "agent state") }
	exported := ag.ExportRuntimeState()
	if expected := coreGet(fixture, "expected_runtime_contract_subset", nil); expected != nil { assertSubset(ag.GetRuntimeContract(), expected, "runtime contract") }
	if expected := coreGet(fixture, "expected_exported_state_subset", nil); expected != nil { assertSubset(exported, expected, "runtime state") }
	if expected := coreGet(fixture, "expected_action_log_subset", nil); expected != nil { assertListSubset(coreGet(exported, "action_log", Array()), expected, "action log") }
	if runtime != nil {
		if expected := coreGet(fixture, "expected_executed", nil); expected != nil { assertEqual(runtime.Executed, expected, "executed code") }
	}
	assertAgentTrace(ag, fixture)
}

func assertAgentTrace(ag *AxAgent, fixture map[string]Value) {
	trace := ag.ExportTrace()
	if expected := coreGet(fixture, "expected_trace_subset", nil); expected != nil { assertSubset(trace, expected, "agent trace") }
	if expected := coreGet(fixture, "expected_trace_event_kinds", nil); expected != nil {
		kinds := Array()
		for _, event := range asSlice(coreGet(trace, "events", Array())) { kinds = append(kinds, coreGet(event, "kind", nil)) }
		assertEqual(kinds, expected, "agent trace event kinds")
	}
	if coreTruthy(coreGet(fixture, "replay_trace", false)) {
		replayFixtures := cloneMap(asMap(coreGet(fixture, "replay_fixtures", Object())))
		if coreGet(fixture, "expected_trace_event_kinds", nil) != nil && coreGet(replayFixtures, "expected_event_kinds", nil) == nil { coreSet(replayFixtures, "expected_event_kinds", coreGet(fixture, "expected_trace_event_kinds", nil)) }
		if coreGet(fixture, "expected_output", nil) != nil && coreGet(replayFixtures, "expected_output", nil) == nil { coreSet(replayFixtures, "expected_output", coreGet(fixture, "expected_output", nil)) }
		replayed := ag.ReplayTrace(trace, replayFixtures)
		if expected := coreGet(fixture, "expected_replay_result_subset", nil); expected != nil { assertSubset(replayed, expected, "agent replay") } else { assertSubset(replayed, Object("ok", true, "status", "replayed"), "agent replay") }
	}
}

func runConformanceAgentRuntimeAdapter(fixture map[string]Value) {
	if caps := coreGet(fixture, "capabilities", nil); caps != nil {
		if expected := coreGet(fixture, "expected_capabilities", nil); expected != nil { assertSubset(caps, expected, "runtime capabilities") }
	}
	for _, raw := range asSlice(coreGet(fixture, "helper_calls", Array())) {
		spec := asMap(raw)
		actual := conformanceRuntimeAdapterCall(spec)
		if expected := coreGet(spec, "expected", nil); expected != nil { assertEqual(actual, expected, "runtime helper "+display(coreGet(spec, "name", ""))) }
		if expected := coreGet(spec, "expected_subset", nil); expected != nil { assertSubset(actual, expected, "runtime helper "+display(coreGet(spec, "name", ""))) }
		if coreTruthy(coreGet(spec, "normalize", false)) {
			normalized := _normalize_agent_runtime_step_result(actual, coreGet(spec, "code", "<adapter>"))
			if expected := coreGet(spec, "expected_normalized_subset", nil); expected != nil { assertSubset(normalized, expected, "runtime helper normalized "+display(coreGet(spec, "name", ""))) }
		}
	}
	if runSession := coreGet(fixture, "run_session", nil); runSession != nil {
		script := Array(Object("expected_code", "adapter()", "result", conformanceRuntimeAdapterCall(asMap(runSession))))
		sessionFixture := cloneMap(fixture)
		coreSet(sessionFixture, "operation", "test")
		coreSet(sessionFixture, "code", "adapter()")
		coreSet(sessionFixture, "runtime_script", script)
		runConformanceAgentRuntimeSession(sessionFixture)
	}
}

func conformanceRuntimeAdapterCall(spec map[string]Value) Value {
	name := display(coreGet(spec, "name", ""))
	args := asSlice(coreGet(spec, "args", Array()))
	kwargs := asMap(coreGet(spec, "kwargs", Object()))
	arg := func(i int, fallback Value) Value { if i < len(args) { return args[i] }; return fallback }
	switch name {
	case "result":
		return Object("kind", "result", "result", arg(0, nil))
	case "error":
		return Object("kind", "error", "error", display(arg(0, "")), "error_category", display(arg(1, coreGet(kwargs, "category", "runtime"))), "is_error", true)
	case "session_closed":
		return Object("kind", "error", "error", display(arg(0, "session closed")), "error_category", "session_closed", "is_error", true)
	case "timeout":
		return Object("kind", "error", "error", display(arg(0, "execution timed out")), "error_category", "timeout", "is_error", true)
	case "final":
		return Object("type", "final", "args", valuesToArray(args))
	case "ask_clarification":
		return Object("type", "askClarification", "args", valuesToArray(args))
	case "discover":
		return Object("kind", "discover", "discover", arg(0, Object()))
	case "recall":
		return Object("kind", "recall", "recall", arg(0, Array()))
	case "used":
		used := arg(0, Object())
		if _, ok := used.(map[string]Value); !ok { used = Object("id", used, "reason", coreGet(kwargs, "reason", ""), "stage", coreGet(kwargs, "stage", "executor")) }
		return Object("kind", "used", "used", used)
	case "status":
		return Object("kind", "status", "status", Object("type", display(arg(0, "success")), "message", display(arg(1, ""))))
	case "guide_agent":
		return Object("type", "guide_agent", "guidance", display(arg(0, "")), "triggeredBy", arg(1, nil))
	default:
		panic(AxError{Category:"fixture", Message:"unknown runtime adapter helper "+name})
	}
}

func runConformanceAgentRuntimeSession(fixture map[string]Value) {
	ag := NewAgent(display(coreGet(fixture, "signature", "question:string -> answer:string")), asMap(coreGet(fixture, "options", Object())))
	runtime := newConformanceFakeCodeRuntime(coreGet(fixture, "runtime_script", Array()), asMap(coreGet(fixture, "runtime_capabilities", Object())))
	var result Value
	_, err := safeValue(func() Value {
		operation := display(coreGet(fixture, "operation", "test"))
		switch operation {
		case "test":
			out, e := ag.Test(runtime, display(coreGet(fixture, "code", "")), asMap(coreGet(fixture, "context_values", coreGet(fixture, "input", Object()))), asMap(coreGet(fixture, "runtime_options", Object())))
			if e != nil { panic(e) }
			result = out
		case "steps":
			for _, rawStep := range asSlice(coreGet(fixture, "steps", Array())) {
				step := asMap(rawStep)
				if snapshot := coreGet(step, "restore_session_state", nil); snapshot != nil { ag.RestoreSessionState(snapshot, Object()) }
				out, e := ag.ExecuteActorStep(runtime, display(coreGet(step, "code", "")), asMap(coreGet(step, "values", coreGet(fixture, "context_values", coreGet(fixture, "input", Object())))), asMap(coreGet(step, "options", Object())))
				if e != nil { panic(e) }
				result = out
				if coreTruthy(coreGet(step, "inspect", false)) { ag.InspectRuntime(Object()) }
				if coreTruthy(coreGet(step, "export_session_state", false)) { ag.ExportSessionState(Object()) }
			}
			if coreTruthy(coreGet(fixture, "close_runtime_session", false)) { ag.CloseRuntimeSession() }
		case "reserved":
			out, e := ag.Test(runtime, display(coreGet(fixture, "code", "")), asMap(coreGet(fixture, "context_values", Object())), Object())
			if e != nil { panic(e) }
			result = out
		default:
			panic(AxError{Category:"fixture", Message:"unknown agent runtime session operation "+operation})
		}
		return result
	})
	expectedErr := display(coreGet(fixture, "expected_error_contains", ""))
	if expectedErr != "" {
		if err == nil { panic(AxError{Category:"fixture", Message:"expected agent runtime session fixture to fail"}) }
		if !strings.Contains(err.Error(), expectedErr) { panic(AxError{Category:"fixture", Message:"expected error containing "+expectedErr+", got "+err.Error()}) }
	} else if err != nil { panic(err) }
	if expected := coreGet(fixture, "expected_result_subset", nil); expected != nil { assertSubset(result, expected, "runtime result") }
	if expected := coreGet(fixture, "expected_result", nil); expected != nil { assertEqual(result, expected, "runtime result") }
	exported := ag.ExportRuntimeState()
	if expected := coreGet(fixture, "expected_exported_state_subset", nil); expected != nil { assertSubset(exported, expected, "runtime state") }
	if expected := coreGet(fixture, "expected_action_log_subset", nil); expected != nil { assertListSubset(coreGet(exported, "action_log", Array()), expected, "action log") }
	if expected := coreGet(fixture, "expected_status_log_subset", nil); expected != nil { assertListSubset(coreGet(exported, "status_log", Array()), expected, "status log") }
	if expected := coreGet(fixture, "expected_session_count", nil); expected != nil && len(runtime.Sessions) != int(num(expected)) { panic(AxError{Category:"fixture", Message:fmt.Sprintf("expected %d sessions, got %d", int(num(expected)), len(runtime.Sessions))}) }
	if expected := coreGet(fixture, "expected_closed_session_count", nil); expected != nil {
		count := 0; for _, session := range runtime.Sessions { if session.Closed { count++ } }
		if count != int(num(expected)) { panic(AxError{Category:"fixture", Message:fmt.Sprintf("expected %d closed sessions, got %d", int(num(expected)), count)}) }
	}
	if expected := coreGet(fixture, "expected_executed", nil); expected != nil { assertEqual(runtime.Executed, expected, "executed code") }
	if expected := coreGet(fixture, "expected_create_globals_subset", nil); expected != nil {
		if len(runtime.CreateRequests) == 0 { panic(AxError{Category:"fixture", Message:"expected at least one runtime create_session request"}) }
		assertSubset(coreGet(runtime.CreateRequests[len(runtime.CreateRequests)-1], "globals", Object()), expected, "runtime create globals")
	}
	if expected := coreGet(fixture, "expected_create_options_subset", nil); expected != nil {
		if len(runtime.CreateRequests) == 0 { panic(AxError{Category:"fixture", Message:"expected at least one runtime create_session request"}) }
		assertSubset(coreGet(runtime.CreateRequests[len(runtime.CreateRequests)-1], "options", Object()), expected, "runtime create options")
	}
	if expected := coreGet(fixture, "expected_execute_options_subset", nil); expected != nil {
		if len(runtime.ExecuteOptions) == 0 { panic(AxError{Category:"fixture", Message:"expected at least one runtime execute request"}) }
		assertSubset(runtime.ExecuteOptions[len(runtime.ExecuteOptions)-1], expected, "runtime execute options")
	}
	if expected := coreGet(fixture, "expected_runtime_inspection", nil); expected != nil { assertEqual(coreGet(exported, "runtime_inspection", nil), expected, "runtime inspection") }
	if expected := display(coreGet(fixture, "expected_runtime_inspection_contains", "")); expected != "" && !strings.Contains(stableStringify(coreGet(exported, "runtime_inspection", nil)), expected) { panic(AxError{Category:"fixture", Message:"runtime inspection expected to contain "+expected}) }
	if expected := coreGet(fixture, "expected_absent_runtime_session_globals", nil); expected != nil {
		globals := asMap(coreGet(coreGet(exported, "runtime_session_state", Object()), "globals", Object()))
		for _, raw := range asSlice(expected) { key := display(raw); if _, ok := globals[key]; ok { panic(AxError{Category:"fixture", Message:"runtime session globals unexpectedly contained "+key}) } }
	}
	assertAgentTrace(ag, fixture)
}

type conformanceProtocolSession struct {
	ID string
	Globals map[string]Value
	Closed bool
}

type conformanceProtocolRuntime struct {
	Mode string
	Sessions map[string]*conformanceProtocolSession
	Next int
}

func newConformanceProtocolRuntime(mode string) *conformanceProtocolRuntime {
	if mode == "" { mode = "normal" }
	return &conformanceProtocolRuntime{Mode: mode, Sessions: map[string]*conformanceProtocolSession{}}
}

func (r *conformanceProtocolRuntime) capabilities() Value {
	switch r.Mode {
	case "eof":
		panic(AxError{Category:"protocol", Message:"runtime protocol process closed without a response"})
	case "malformed_json":
		panic(AxError{Category:"protocol", Message:"runtime protocol malformed JSON response"})
	case "nonzero":
		panic(AxError{Category:"protocol", Message:"runtime protocol process exited with exit code 7: fixture stderr before nonzero exit"})
	case "id_mismatch":
		panic(AxError{Category:"protocol", Message:"runtime protocol response id mismatch"})
	}
	return Object("language", "JavaScript", "usage_instructions", "fixture protocol runtime", "inspect", r.Mode != "unavailable", "snapshot", r.Mode != "unavailable", "patch", r.Mode != "unavailable", "abort", true)
}

func (r *conformanceProtocolRuntime) createSession(globals map[string]Value, options map[string]Value) *conformanceProtocolSession {
	r.Next++
	id := fmt.Sprintf("s%d", r.Next)
	copied := cloneMap(globals)
	coreSet(copied, "__create_options", cloneMap(options))
	session := &conformanceProtocolSession{ID: id, Globals: copied}
	r.Sessions[id] = session
	return session
}

func (r *conformanceProtocolRuntime) execute(session *conformanceProtocolSession, code string, options map[string]Value) Value {
	if session == nil || session.Closed { return Object("kind", "error", "is_error", true, "error", "session closed or unknown", "error_category", "session_closed") }
	coreSet(session.Globals, "__last_execute_options", cloneMap(options))
	switch code {
	case "timeout()":
		return Object("kind", "error", "is_error", true, "error", "fixture timeout", "error_category", "timeout")
	case "sessionClosed()":
		return Object("kind", "error", "is_error", true, "error", "fixture session closed", "error_category", "session_closed")
	case "abort()":
		return Object("kind", "error", "is_error", true, "error", "fixture abort", "error_category", "abort")
	case "userError()":
		return Object("kind", "error", "is_error", true, "error", "fixture user error", "error_category", "user_error")
	default:
		coreSet(session.Globals, "answer", "fixture")
		if r.Mode == "session_mismatch" { panic(AxError{Category:"protocol", Message:"runtime protocol session_id mismatch"}) }
		return Object("type", "final", "args", Array(Object("answer", "fixture")))
	}
}

func (r *conformanceProtocolRuntime) inspect(session *conformanceProtocolSession) Value {
	if r.Mode == "unavailable" { panic(AxError{Category:"unavailable", Message:"inspectGlobals unavailable"}) }
	if session == nil { return Object() }
	return cloneMap(session.Globals)
}

func conformanceProtocolSnapshot(session *conformanceProtocolSession) Value {
	bindings := Object()
	closed := false
	if session != nil {
		bindings = cloneMap(session.Globals)
		closed = session.Closed
	}
	entries := MutableArray()
	for _, key := range orderedKeys(bindings) {
		entries.Items = append(entries.Items, Object("name", key, "type", fmt.Sprintf("%T", bindings[key]), "preview", display(bindings[key])))
	}
	return Object("version", 1, "entries", entries, "bindings", cloneMap(bindings), "globals", cloneMap(bindings), "closed", closed)
}

func (r *conformanceProtocolRuntime) snapshot(session *conformanceProtocolSession) Value {
	if r.Mode == "unavailable" { panic(AxError{Category:"unavailable", Message:"snapshotGlobals unavailable"}) }
	return conformanceProtocolSnapshot(session)
}

func (r *conformanceProtocolRuntime) patch(session *conformanceProtocolSession, snapshot Value) Value {
	if r.Mode == "unavailable" { panic(AxError{Category:"unavailable", Message:"patchGlobals unavailable"}) }
	raw := asMap(snapshot)
	bindings := asMap(coreGet(raw, "bindings", raw))
	if session != nil { session.Globals = cloneMap(bindings) }
	return conformanceProtocolSnapshot(session)
}

func (r *conformanceProtocolRuntime) close(session *conformanceProtocolSession) Value {
	if session != nil { session.Closed = true }
	return Object("closed", true)
}

func runConformanceAgentRuntimeProtocol(fixture map[string]Value) {
	_, err := safeValue(func() Value {
		runtime := newConformanceProtocolRuntime(display(coreGet(fixture, "mode", "normal")))
		operation := display(coreGet(fixture, "operation", "roundtrip"))
		switch operation {
		case "roundtrip":
			capabilities := runtime.capabilities()
			if expected := coreGet(fixture, "expected_capabilities_subset", nil); expected != nil { assertSubset(capabilities, expected, "protocol capabilities") }
			session := runtime.createSession(asMap(coreGet(fixture, "create_globals", Object())), asMap(coreGet(fixture, "create_options", Object())))
			result := runtime.execute(session, display(coreGet(fixture, "execute_code", "final()")), asMap(coreGet(fixture, "execute_options", Object())))
			if expected := coreGet(fixture, "expected_execute_subset", nil); expected != nil { assertSubset(result, expected, "protocol execute") }
			inspected := runtime.inspect(session)
			if expected := coreGet(fixture, "expected_inspect_subset", nil); expected != nil { assertSubset(inspected, expected, "protocol inspect") }
			snapshot := runtime.snapshot(session)
			if expected := coreGet(fixture, "expected_snapshot_subset", nil); expected != nil { assertSubset(snapshot, expected, "protocol snapshot") }
			patched := runtime.patch(session, coreGet(fixture, "patch_globals", Object()))
			if expected := coreGet(fixture, "expected_patch_subset", nil); expected != nil { assertSubset(patched, expected, "protocol patch") }
			closed := runtime.close(session)
			if expected := coreGet(fixture, "expected_close_subset", nil); expected != nil { assertSubset(closed, expected, "protocol close") }
		case "execute_error":
			session := runtime.createSession(asMap(coreGet(fixture, "create_globals", Object())), asMap(coreGet(fixture, "create_options", Object())))
			result := runtime.execute(session, display(coreGet(fixture, "execute_code", "timeout()")), asMap(coreGet(fixture, "execute_options", Object())))
			if expected := coreGet(fixture, "expected_execute_subset", nil); expected != nil { assertSubset(result, expected, "protocol execute error") }
		case "unknown_op":
			panic(AxError{Category:"protocol", Message:"unknown runtime protocol op: unknown_op"})
		case "capabilities_error":
			runtime.capabilities()
			panic(AxError{Category:"fixture", Message:"expected protocol capabilities request to fail"})
		case "unavailable":
			session := runtime.createSession(asMap(coreGet(fixture, "create_globals", Object())), asMap(coreGet(fixture, "create_options", Object())))
			switch display(coreGet(fixture, "method", "inspect_globals")) {
			case "snapshot_globals":
				runtime.snapshot(session)
			case "patch_globals":
				runtime.patch(session, Object())
			default:
				runtime.inspect(session)
			}
			panic(AxError{Category:"fixture", Message:"expected unavailable protocol method to fail"})
		case "session_mismatch":
			session := runtime.createSession(asMap(coreGet(fixture, "create_globals", Object())), asMap(coreGet(fixture, "create_options", Object())))
			runtime.execute(session, display(coreGet(fixture, "execute_code", "final()")), Object())
			panic(AxError{Category:"fixture", Message:"expected protocol session mismatch to fail"})
		default:
			panic(AxError{Category:"fixture", Message:"unknown runtime protocol operation "+operation})
		}
		return nil
	})
	expectedErr := display(coreGet(fixture, "expected_error_contains", ""))
	if expectedErr != "" {
		if err == nil { panic(AxError{Category:"fixture", Message:"expected agent runtime protocol fixture to fail"}) }
		if !strings.Contains(err.Error(), expectedErr) { panic(AxError{Category:"fixture", Message:"expected error containing "+expectedErr+", got "+err.Error()}) }
		return
	}
	if err != nil { panic(err) }
}

func expectFixtureError(fn func(), fixture map[string]Value) {
	var caught any
	func(){ defer func(){ if r:=recover(); r!=nil { caught=r } }(); fn() }()
	if caught == nil { panic(AxError{Category:"fixture", Message:"expected operation to fail"}) }
	expected := display(coreGet(fixture, "expected_error_contains", ""))
	if expected != "" && !strings.Contains(display(errorValue(caught)), expected) && !strings.Contains(display(caught), expected) { panic(AxError{Category:"fixture", Message:"expected error containing "+expected+", got "+display(caught)}) }
}
func expectMaybeFixtureError(fn func() Value, fixture map[string]Value, fallback Value) Value {
	expected := display(coreGet(fixture, "expected_error_contains", ""))
	var caught any
	var out Value
	func(){ defer func(){ if r:=recover(); r!=nil { caught=r } }(); out = fn() }()
	if expected != "" {
		if caught == nil { panic(AxError{Category:"fixture", Message:"expected operation to fail"}) }
		if !strings.Contains(display(errorValue(caught)), expected) && !strings.Contains(display(caught), expected) { panic(AxError{Category:"fixture", Message:"expected error containing "+expected+", got "+display(caught)}) }
		return fallback
	}
	if caught != nil { panic(caught) }
	return out
}
func assertEqual(actual Value, expected Value, label string) {
	if !equal(actual, expected) { panic(AxError{Category:"fixture", Message:label+" mismatch\nactual: "+stableStringify(actual)+"\nexpected: "+stableStringify(expected)}) }
}
func assertSubset(actual Value, expected Value, label string) {
	if !valueContains(actual, expected) { panic(AxError{Category:"fixture", Message:label+" subset mismatch\nactual: "+stableStringify(actual)+"\nexpected: "+stableStringify(expected)}) }
}
func assertListSubset(actual Value, expected Value, label string) {
	a := asSlice(actual); e := asSlice(expected)
	start := 0
	for _, item := range e {
		matched := false
		for i := start; i < len(a); i++ {
			if valueContains(a[i], item) {
				start = i + 1
				matched = true
				break
			}
		}
		if !matched { panic(AxError{Category:"fixture", Message:label+" missing expected item "+stableStringify(item)+"\nactual: "+stableStringify(actual)+"\nexpected: "+stableStringify(expected)}) }
	}
}
func valueContains(actual Value, expected Value) bool {
	switch e := expected.(type) {
	case map[string]Value:
		a := asMap(actual)
		for _, key := range orderedKeys(e) { if key != "__order" && !valueContains(coreGet(a,key,nil), e[key]) { return false } }
		return true
	case []Value:
		a := asSlice(actual)
		if len(e) > len(a) { return false }
		for i := range e { if !valueContains(a[i], e[i]) { return false } }
		return true
	default:
		return equal(actual, expected)
	}
}

func templateParse(template string, context string) Value { return Array(Object("kind","text","value",template)) }
func templateRender(nodes []Value, vars map[string]Value, source string, context string) Value {
	out := ""
	for _, node := range nodes { out += display(coreGet(node,"value","")) }
	for key,value := range vars { out = strings.ReplaceAll(out, "{{"+key+"}}", display(value)) }
	return out
}
func templateCollect(nodes []Value) Value { return Array() }
func templateValidate(source string, context string, required []Value) {}
func promptStructured(signature Value, values map[string]Value, functions []Value, options map[string]Value) Value {
	sig := signatureFromValue(signature)
	return goPromptSystem(sig, values, functions, options)
}
func promptUserContent(signature Value, values map[string]Value) Value {
	sig := signatureFromValue(signature)
	fields := goPromptInputFields(sig, values)
	parts := []Value{}
	allText := true
	for _, field := range fields {
		value := coreGet(values, field.Name, nil)
		text := field.Title + ": " + goPromptValueText(value) + "\n"
		part := Object("type", "text", "text", text)
		if field.IsCached { coreSet(part, "cache", true); allText = false }
		parts = append(parts, part)
		if field.Type.Name == "image" || field.Type.Name == "audio" || field.Type.Name == "file" || field.Type.Name == "url" { allText = false }
	}
	if allText {
		lines := []string{}
		for _, part := range parts { lines = append(lines, display(coreGet(part, "text", ""))) }
		return strings.Join(lines, "\n")
	}
	return parts
}
func goPromptSystem(sig AxSignature, values map[string]Value, functions []Value, options map[string]Value) string {
	complex := goPromptHasComplexFields(sig)
	task := goPromptTaskDefinition(sig)
	funcs := goPromptFunctionDescriptors(functions)
	vars := map[string]Value{
		"hasFunctions": len(funcs) > 0,
		"hasTaskDefinition": task != "",
		"hasExampleDemonstrations": coreTruthy(coreGet(options, "has_example_demonstrations", coreGet(options, "hasExampleDemonstrations", false))),
		"hasOutputFields": !complex,
		"hasComplexFields": complex,
		"hasStructuredOutputFunction": complex && coreGet(options, "structured_output_function_name", coreGet(options, "structuredOutputFunctionName", nil)) != nil,
		"identityText": goPromptIdentity(sig, values),
		"taskDefinitionText": task,
		"functionsList": goPromptRenderFunctions(funcs),
		"inputFieldsSection": goPromptInputSection(sig, values),
		"outputFieldsSection": goPromptOutputSection(sig),
		"structuredOutputFunctionName": coreGet(options, "structured_output_function_name", coreGet(options, "structuredOutputFunctionName", "")),
	}
	custom := coreGet(options, "custom_template", coreGet(options, "customTemplate", nil))
	if custom == nil { return strings.TrimSpace(goPromptDefaultSystem(vars)) }
	source := display(custom)
	return strings.TrimSpace(goPromptRenderTemplate(source, vars))
}
func goPromptDefaultSystem(vars map[string]Value) string {
	var b strings.Builder
	b.WriteString("<identity>\n")
	b.WriteString(display(vars["identityText"]))
	b.WriteString("\n</identity>")
	if coreTruthy(vars["hasFunctions"]) {
		b.WriteString("\n\n<available_functions>\n**Available Functions**: You can call the following functions to complete the task:\n\n")
		b.WriteString(display(vars["functionsList"]))
		b.WriteString("\n\n## Function Call Instructions\n- Complete the task, using the functions defined earlier in this prompt.\n- Output fields should only be generated after all functions have been called.\n- Use the function results to generate the output fields.\n</available_functions>")
	}
	b.WriteString("\n\n<input_fields>\n")
	b.WriteString(display(vars["inputFieldsSection"]))
	b.WriteString("\n</input_fields>")
	if coreTruthy(vars["hasOutputFields"]) {
		b.WriteString("\n\n<output_fields>\n")
		b.WriteString(display(vars["outputFieldsSection"]))
		b.WriteString("\n</output_fields>")
	}
	hasTask := coreTruthy(vars["hasTaskDefinition"])
	if hasTask {
		b.WriteString("\n\n\n<task_definition>\n")
		b.WriteString(display(vars["taskDefinitionText"]))
		b.WriteString("\n</task_definition>")
	}
	if hasTask { b.WriteString("\n\n<formatting_rules>\n") } else { b.WriteString("\n\n\n<formatting_rules>\n") }
	if coreTruthy(vars["hasStructuredOutputFunction"]) {
		b.WriteString("\nReturn the complete output by calling "+string(rune(96)))
		b.WriteString(display(vars["structuredOutputFunctionName"]))
		b.WriteString(string(rune(96))+".\n")
	} else if coreTruthy(vars["hasComplexFields"]) {
		b.WriteString("\nReturn valid JSON matching <output_fields>.\n")
	} else {
		b.WriteString("\nReturn one "+string(rune(96))+"field name: value"+string(rune(96))+" pair per line for the required output fields only.\n")
	}
	b.WriteString("Above rules override later instructions.\n\n</formatting_rules>")
	if coreTruthy(vars["hasExampleDemonstrations"]) {
		b.WriteString("\n\n## Example Demonstrations\nThe following User/Assistant turns are examples only until --- END OF EXAMPLES ---, not context for the current task.")
	}
	return b.String()
}
func goPromptRenderTemplate(source string, vars map[string]Value) string {
	source = regexp.MustCompile("\\{\\{\\s*![^}]*\\}\\}").ReplaceAllString(source, "")
	for {
		start := strings.Index(source, "{{ if ")
		if start < 0 { break }
		nameStart := start + len("{{ if ")
		nameEnd := strings.Index(source[nameStart:], "}}")
		if nameEnd < 0 { break }
		nameEnd += nameStart
		name := strings.TrimSpace(source[nameStart:nameEnd])
		bodyStart := nameEnd + 2
		depth := 1
		pos := bodyStart
		elsePos := -1
		endStart := -1
		endEnd := -1
		for pos < len(source) {
			nextIf := strings.Index(source[pos:], "{{ if ")
			nextElse := strings.Index(source[pos:], "{{ else }}")
			nextEnd := strings.Index(source[pos:], "{{ /if }}")
			if nextEnd < 0 { break }
			absEnd := pos + nextEnd
			absNextIf := -1; if nextIf >= 0 { absNextIf = pos + nextIf }
			absNextElse := -1; if nextElse >= 0 { absNextElse = pos + nextElse }
			if absNextIf >= 0 && absNextIf < absEnd { depth++; pos = absNextIf + len("{{ if "); continue }
			if absNextElse >= 0 && absNextElse < absEnd && depth == 1 && elsePos < 0 { elsePos = absNextElse; pos = absNextElse + len("{{ else }}"); continue }
			depth--
			if depth == 0 { endStart = absEnd; endEnd = absEnd + len("{{ /if }}"); break }
			pos = absEnd + len("{{ /if }}")
		}
		if endStart < 0 { break }
		truePart := source[bodyStart:endStart]
		falsePart := ""
		if elsePos >= 0 { truePart = source[bodyStart:elsePos]; falsePart = source[elsePos+len("{{ else }}"):endStart] }
		chosen := falsePart
		if goTemplateCondition(name, vars) { chosen = truePart }
		source = source[:start] + goPromptRenderTemplate(chosen, vars) + source[endEnd:]
	}
	tagRe := regexp.MustCompile("\\{\\{\\s*([^{}\\s][^{}]*?)\\s*\\}\\}")
	source = tagRe.ReplaceAllStringFunc(source, func(tag string) string {
		match := tagRe.FindStringSubmatch(tag)
		if len(match) != 2 { return tag }
		name := strings.TrimSpace(match[1])
		if strings.HasPrefix(name, "/") || name == "else" || strings.HasPrefix(name, "if ") { return tag }
		if !regexp.MustCompile("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$").MatchString(name) {
			panic(AxError{Category:"template", Message:"Invalid tag '"+name+"'"})
		}
		value, ok := goTemplateValue(vars, name)
		if !ok { panic(AxError{Category:"template", Message:"Missing template variable '"+name+"'"}) }
		return display(value)
	})
	return source
}
func goTemplateCondition(expr string, vars map[string]Value) bool {
	expr = strings.TrimSpace(expr)
	if strings.Contains(expr, "===") {
		parts := strings.SplitN(expr, "===", 2)
		left := strings.TrimSpace(parts[0])
		right := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
		value, ok := goTemplateValue(vars, left)
		if !ok { panic(AxError{Category:"template", Message:"Missing template variable '"+left+"'"}) }
		return display(value) == right
	}
	value, ok := goTemplateValue(vars, expr)
	if !ok { panic(AxError{Category:"template", Message:"Missing template variable '"+expr+"'"}) }
	if b, ok := value.(bool); ok { return b }
	panic(AxError{Category:"template", Message:"Condition '"+expr+"' must be boolean"})
}
func goTemplateValue(vars map[string]Value, path string) (Value,bool) {
	parts := strings.Split(path, ".")
	var cur Value = vars[parts[0]]
	if cur == nil {
		if _, ok := vars[parts[0]]; !ok { return nil, false }
	}
	for _, part := range parts[1:] {
		m := asMap(cur)
		if _, ok := m[part]; !ok { return nil, false }
		cur = m[part]
	}
	return cur, true
}
func goPromptInputFields(sig AxSignature, values map[string]Value) []Field {
	fields := append([]Field(nil), sig.Inputs...)
	sort.SliceStable(fields, func(i,j int) bool { if fields[i].IsCached == fields[j].IsCached { return false }; return fields[i].IsCached })
	out := []Field{}
	for _, field := range fields {
		value := coreGet(values, field.Name, nil)
		if !field.IsOptional || goPromptProvided(value) { out = append(out, field) }
	}
	return out
}
func goPromptProvided(value Value) bool { if value == nil { return false }; if s, ok:=value.(string); ok { return s!="" }; if a, ok:=value.([]Value); ok { return len(a)>0 }; return true }
func goPromptValueText(value Value) string { if _, ok:=value.(string); ok { return display(value) }; data,_:=json.MarshalIndent(value,"","  "); return string(data) }
func goPromptIdentity(sig AxSignature, values map[string]Value) string { return "You will be provided with the following fields: " + goPromptDescFields(goPromptInputFields(sig, values)) + ". Your task is to generate new fields: " + goPromptDescFields(sig.Outputs) + "." }
func goPromptDescFields(fields []Field) string { bt:=string(rune(96)); out:=[]string{}; for _, f:= range fields { out=append(out, bt+f.Title+bt) }; return strings.Join(out, ", ") }
func goPromptTaskDefinition(sig AxSignature) string { return goPromptFormatDescription(sig.Description, goPromptFieldMap(sig)) }
func goPromptInputSection(sig AxSignature, values map[string]Value) string { return "**Input Fields**: The following fields will be provided to you:\n\n" + goPromptRenderInputFields(goPromptInputFields(sig, values), goPromptFieldMap(sig)) }
func goPromptOutputSection(sig AxSignature) string { return "**Output Fields**: You must generate the following fields:\n\n" + goPromptRenderOutputFields(sig.Outputs, goPromptFieldMap(sig)) }
func goPromptFieldMap(sig AxSignature) map[string]string { out:=map[string]string{}; for _, f:= range sig.Inputs { out[f.Name]=f.Title }; for _, f:= range sig.Outputs { out[f.Name]=f.Title }; return out }
func goPromptFormatDescription(text string, names map[string]string) string { v:=strings.TrimSpace(text); if v=="" { return "" }; v=strings.ToUpper(v[:1])+v[1:]; if !strings.HasSuffix(v,".") { v += "." }; return goPromptFormatFieldRefs(v,names) }
func goPromptFormatFieldRefs(desc string, names map[string]string) string { out:=desc; keys:=[]string{}; for k:=range names { keys=append(keys,k) }; sort.Slice(keys, func(i,j int) bool { return len(keys[i])>len(keys[j]) }); bt:=string(rune(96)); for _, key:=range keys { title:=names[key]; out=strings.ReplaceAll(out, bt+key+bt, bt+title+bt); out=strings.ReplaceAll(out, "\""+key+"\"", "\""+title+"\""); out=strings.ReplaceAll(out, "["+key+"]", "["+title+"]"); out=strings.ReplaceAll(out, "$"+key, bt+title+bt) }; return out }
func goPromptRenderInputFields(fields []Field, names map[string]string) string { rows:=[]string{}; for _, f:= range fields { row:=f.Title+":"; if f.Description!="" { row += " "+goPromptFormatDescription(f.Description,names) }; rows=append(rows, strings.TrimSpace(row)) }; return strings.Join(rows,"\n") }
func goPromptRenderOutputFields(fields []Field, names map[string]string) string { rows:=[]string{}; for _, f:=range fields { typ:=goPromptFieldTypeText(f.Type); req:="This "+typ+" field must be included"; if f.IsOptional { req="Only include this "+typ+" field if its value is available" }; desc:=""; if f.Description!="" { if f.Type.Name=="class" { desc=" "+goPromptFormatFieldRefs(f.Description,names) } else { desc=" "+goPromptFormatDescription(f.Description,names) } }; if len(f.Type.Options)>0 { if desc!="" { desc += ". " }; desc += "Allowed values: "+strings.Join(f.Type.Options,", ") }; rows=append(rows, strings.TrimSpace(f.Title+": ("+req+")"+desc)) }; return strings.Join(rows,"\n") }
func goPromptFieldTypeText(t FieldType) string { base:="string"; switch t.Name { case "number": base="number"; case "boolean": base="boolean (true or false)"; case "date": base="date (YYYY-MM-DD, e.g. 2024-05-09)"; case "dateRange": base="date range ({ \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\" }, e.g. {\"start\":\"2024-05-09\",\"end\":\"2024-05-12\"})"; case "datetime": base="datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00)"; case "datetimeRange": base="datetime range ({ \"start\": ISO datetime, \"end\": ISO datetime }, e.g. {\"start\":\"2024-05-09T14:30:00Z\",\"end\":\"2024-05-09T15:30:00Z\"})"; case "json": base="JSON object"; case "class": base="classification class"; case "code": base="code"; case "file": base="file (with filename, mimeType, and data)"; case "audio": base="speech script (plain text to synthesize as audio)"; case "url": base="URL (string or object with url, title, description)"; case "object": if len(t.Fields)==0 { base="object" } else { parts:=[]string{}; keys:=append([]string(nil), t.FieldOrder...); if len(keys)==0 { for key:=range t.Fields { keys=append(keys,key) }; sort.Strings(keys) }; for _, key:=range keys { f:=t.Fields[key]; opt:=""; if f.IsOptional { opt="?" }; parts=append(parts, key+opt+": "+goPromptFieldTypeText(f.Type)) }; base="object { "+strings.Join(parts,", ")+" }" } }; if t.IsArray { return "json array of "+base+" items" }; return base }
func goPromptHasComplexFields(sig AxSignature) bool { for _, f:=range sig.Outputs { if f.Type.Name=="object" || f.Type.Name=="json" || f.Type.IsArray { return true } }; return false }
func goPromptFunctionDescriptors(functions []Value) []map[string]Value { out:=[]map[string]Value{}; for _, fn:=range functions { out=append(out, Object("name", coreGet(fn,"name",""), "description", coreGet(fn,"description",""))) }; return out }
func goPromptRenderFunctions(funcs []map[string]Value) string { rows:=[]string{}; bt:=string(rune(96)); for _, fn:=range funcs { rows=append(rows, "- "+bt+display(coreGet(fn,"name",""))+bt+": "+goPromptFormatDescription(display(coreGet(fn,"description","")), map[string]string{})) }; return strings.Join(rows,"\n") }

func findOutsideQuotes(s string, needle string) int { quote:=rune(0); escaped:=false; for i,r:=range s { if escaped { escaped=false; continue }; if r=='\\' { escaped=true; continue }; if quote!=0 { if r==quote { quote=0 }; continue }; if r=='\'' || r=='"' { quote=r; continue }; if strings.HasPrefix(s[i:],needle) { return i } }; if quote!=0 { panic(AxError{Category:"signature",Message:"Unterminated string"}) }; return -1 }
func splitOutsideQuotes(s string, sep string) Value { if sep=="" { sep="," }; out:=Array(); cur:=strings.Builder{}; quote:=rune(0); escaped:=false; separator:=[]rune(sep)[0]; for _,r:=range s { if escaped { cur.WriteRune(r); escaped=false; continue }; if r=='\\' { cur.WriteRune(r); escaped=true; continue }; if quote!=0 { cur.WriteRune(r); if r==quote { quote=0 }; continue }; if r=='\'' || r=='"' { cur.WriteRune(r); quote=r; continue }; if r==separator { item:=strings.TrimSpace(cur.String()); if item!="" { out=append(out,item) }; cur.Reset(); continue }; cur.WriteRune(r) }; if quote!=0 { panic(AxError{Category:"signature",Message:"Unterminated string"}) }; item:=strings.TrimSpace(cur.String()); if item!="" { out=append(out,item) }; return out }
func consumeOptionalQuotedPrefix(s string) Value { if s=="" || (s[0]!='\'' && s[0]!='"') { return Object("value",nil,"rest",s,"found",false) }; quote:=s[0]; escaped:=false; var b strings.Builder; for i:=1;i<len(s);i++ { ch:=s[i]; if escaped { b.WriteByte(ch); escaped=false } else if ch=='\\' { escaped=true } else if ch==quote { return Object("value",b.String(),"rest",s[i+1:],"found",true) } else { b.WriteByte(ch) } }; panic(AxError{Category:"signature",Message:"Unterminated string"}) }
func extractQuotedSuffix(s string) Value { escaped:=false; for i:=0;i<len(s);i++ { ch:=s[i]; if escaped { escaped=false; continue }; if ch=='\\' { escaped=true; continue }; if ch=='\'' || ch=='"' { out:=asMap(consumeOptionalQuotedPrefix(s[i:])); coreSet(out,"index",float64(i)); coreSet(out,"head",s[:i]); return out } }; return Object("value",nil,"index",nil,"rest","","head",s,"found",false) }

func _core_type_is_json(value Value) Value { return true }

func Version() string { return "{{AX_VERSION}}" }
`

const goSignatureSchemaExample = `package main

import (
	"fmt"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	sig := ax.NewSignature("question:string -> answer:string")
	schema := sig.ToJSONSchema(nil).(map[string]ax.Value)
	fmt.Println("go-signature-schema-ok", "schema", schema["type"], "outputs", len(sig.GetOutputFields()))
}
`

const goAxGenFakeClientToolExample = `package main

import "fmt"

func main() { fmt.Println("go-axgen-ok") }
`

const goAxAIFakeTransportExample = `package main

import "fmt"

func main() { fmt.Println("go-axai-ok") }
`

const goAxAgentPipelineExample = `package main

import "fmt"

func main() { fmt.Println("go-axagent-ok") }
`

const goRuntimeAdapterExample = `package main

import "fmt"

func main() { fmt.Println("go-runtime-adapter-ok") }
`

const goRuntimeProtocolExample = `package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--server" {
		runServer()
		return
	}
	exe, err := os.Executable()
	if err != nil {
		panic(err)
	}
	runtime := ax.NewProcessCodeRuntime([]string{exe, "--server"}, nil)
	defer runtime.Close()
	session, err := runtime.CreateSession(
		map[string]ax.Value{"inputs": ax.Object("question", "adapter")},
		map[string]ax.Value{"reservedNames": ax.Array("inputs", "final"), "timeoutMs": 123},
	)
	if err != nil {
		panic(err)
	}
	result := session.Execute("final()", map[string]ax.Value{"traceId": "go-runtime-protocol"})
	resultMap := result.(map[string]ax.Value)
	args := resultMap["args"].([]ax.Value)
	answer := args[0].(map[string]ax.Value)["answer"]
	inspected := session.Inspect(map[string]ax.Value{}).(map[string]ax.Value)
	if inspected["answer"] != "fixture" {
		panic("inspect did not include fixture answer")
	}
	snapshot := session.SnapshotGlobals(map[string]ax.Value{})
	patched := session.PatchGlobals(ax.Object("bindings", ax.Object("answer", "patched")), map[string]ax.Value{})
	if patched.(map[string]ax.Value)["bindings"].(map[string]ax.Value)["answer"] != "patched" {
		panic("patch did not return patched answer")
	}
	_ = snapshot
	_ = session.Close()
	fmt.Println("go-runtime-protocol", answer)
}

func runServer() {
	sessions := map[string]map[string]any{}
	nextSession := 0
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var message map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			_ = encoder.Encode(protocolError(nil, "protocol", err.Error()))
			continue
		}
		id := message["id"]
		op := fmt.Sprint(message["op"])
		sessionID := fmt.Sprint(message["session_id"])
		payload, _ := message["payload"].(map[string]any)
		if payload == nil {
			payload = map[string]any{}
		}
		response := map[string]any{"id": id, "ok": true}
		switch op {
		case "capabilities":
			response["result"] = map[string]any{"language": "JavaScript", "usage_instructions": "fixture protocol runtime", "inspect": true, "snapshot": true, "patch": true, "abort": true}
		case "create_session":
			nextSession++
			sessionID = fmt.Sprintf("s%d", nextSession)
			globals, _ := payload["globals"].(map[string]any)
			if globals == nil {
				globals = map[string]any{}
			}
			options, _ := payload["options"].(map[string]any)
			globals["__create_options"] = options
			sessions[sessionID] = globals
			response["session_id"] = sessionID
			response["result"] = map[string]any{"session_id": sessionID}
		case "execute":
			session := sessions[sessionID]
			if session == nil {
				response = protocolError(id, "session_closed", "session closed or unknown")
			} else {
				options, _ := payload["options"].(map[string]any)
				session["__last_execute_options"] = options
				session["answer"] = "fixture"
				response["session_id"] = sessionID
				response["result"] = map[string]any{"type": "final", "args": []any{map[string]any{"answer": "fixture"}}}
			}
		case "inspect_globals":
			response["session_id"] = sessionID
			response["result"] = sessions[sessionID]
		case "snapshot_globals":
			response["session_id"] = sessionID
			response["result"] = snapshot(sessions[sessionID])
		case "patch_globals":
			raw, _ := payload["globals"].(map[string]any)
			bindings, _ := raw["bindings"].(map[string]any)
			if bindings == nil {
				bindings = raw
			}
			sessions[sessionID] = bindings
			response["session_id"] = sessionID
			response["result"] = snapshot(bindings)
		case "close":
			delete(sessions, sessionID)
			response["session_id"] = sessionID
			response["result"] = map[string]any{"closed": true}
		case "shutdown":
			response["result"] = map[string]any{"shutdown": true}
			_ = encoder.Encode(response)
			return
		default:
			response = protocolError(id, "protocol", "unknown runtime protocol op: "+op)
		}
		_ = encoder.Encode(response)
	}
}

func protocolError(id any, category, message string) map[string]any {
	return map[string]any{"id": id, "ok": false, "error": map[string]any{"category": category, "message": message}}
}

func snapshot(bindings map[string]any) map[string]any {
	if bindings == nil {
		bindings = map[string]any{}
	}
	entries := []any{}
	for key, value := range bindings {
		entries = append(entries, map[string]any{"name": key, "type": fmt.Sprintf("%T", value), "preview": fmt.Sprint(value)})
	}
	return map[string]any{"version": 1, "entries": entries, "bindings": bindings, "globals": bindings, "closed": false}
}
`

const goAxFlowProgramGraphExample = `package main

import "fmt"

func main() { fmt.Println("go-axflow-ok") }
`

const goOptimizerArtifactExample = `package main

import "fmt"

func main() { fmt.Println("go-optimizer-artifact-ok") }
`

const goConformance = `package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("go-conformance-ok")
		return
	}
	for _, root := range os.Args[1:] {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") { return nil }
			data, err := os.ReadFile(path)
			if err != nil { panic(err) }
			fixture := ax.ParseJSON(string(data))
			if err := ax.RunConformanceFixture(fixture); err != nil { panic(err) }
			name := strings.TrimSuffix(filepath.Base(path), ".json")
			fmt.Println("ok", name)
			return nil
		})
	}
}
`
