package main

import (
	"fmt"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func asMap(value ax.Value) map[string]ax.Value {
	if out, ok := value.(map[string]ax.Value); ok {
		return out
	}
	return map[string]ax.Value{}
}

func asSlice(value ax.Value) []ax.Value {
	if out, ok := value.([]ax.Value); ok {
		return out
	}
	return nil
}

func number(value ax.Value) float64 {
	switch v := value.(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float64:
		return v
	default:
		return 0
	}
}

func mustKind(value ax.Value, key string, want string) map[string]ax.Value {
	out := asMap(value)
	if fmt.Sprint(out[key]) != want {
		panic(fmt.Sprintf("bad %s result: %#v", want, out))
	}
	return out
}

func expectPanic(label string, fn func()) {
	defer func() {
		if recover() == nil {
			panic("expected panic: " + label)
		}
	}()
	fn()
}

func main() {
	expectPanic("reserved callable", func() {
		axgoja.NewRuntime(axgoja.WithCallable("inputs", func(params ax.Value) (ax.Value, error) {
			return nil, nil
		}))
	})

	runtime := axgoja.NewRuntime(
		axgoja.WithCallable("search", func(params ax.Value) (ax.Value, error) {
			query := fmt.Sprint(asMap(params)["query"])
			return map[string]ax.Value{"title": "Docs", "query": query}, nil
		}),
		axgoja.WithCallable("badTool", func(params ax.Value) (ax.Value, error) {
			return nil, fmt.Errorf("tool failed")
		}),
	)
	policy := runtime.RuntimePolicy()
	if policy["allowFilesystem"] != false || policy["allowNetwork"] != false || policy["allowProcess"] != false {
		panic(fmt.Sprintf("goja runtime policy must default-deny unsafe access: %#v", policy))
	}

	agent := ax.NewAgent("question:string -> answer:string", map[string]ax.Value{"runtime": map[string]ax.Value{"language": "JavaScript"}})
	testOut, err := agent.Test(runtime, "answer = inputs.question; final({answer})", map[string]ax.Value{"question": "goja"}, nil)
	if err != nil {
		panic(err)
	}
	wrapped := mustKind(testOut, "kind", "final")
	payload := asMap(wrapped["completion_payload"])
	first := asMap(asSlice(payload["args"])[0])
	if first["answer"] != "goja" {
		panic(fmt.Sprintf("agent.test did not execute real goja actor code: %#v", testOut))
	}

	session, err := runtime.CreateSession(
		map[string]ax.Value{"inputs": map[string]ax.Value{"question": "goja"}},
		map[string]ax.Value{"reservedNames": []ax.Value{"inputs"}},
	)
	if err != nil {
		panic(err)
	}
	step1 := mustKind(session.Execute("counter = (typeof counter === 'undefined' ? 0 : counter) + 1; final({counter})", nil), "type", "final")
	step2 := mustKind(session.Execute("counter = counter + 1; final({counter})", nil), "type", "final")
	if number(asMap(asSlice(step1["args"])[0])["counter"]) != 1 || number(asMap(asSlice(step2["args"])[0])["counter"]) != 2 {
		panic(fmt.Sprintf("persistent binding failed: %#v %#v", step1, step2))
	}
	protectedFinal := mustKind(session.Execute("final = function(){ return {type:'bad'} }; final({answer:'protected'})", nil), "type", "final")
	if asMap(asSlice(protectedFinal["args"])[0])["answer"] != "protected" {
		panic(fmt.Sprintf("final primitive overwrite protection failed: %#v", protectedFinal))
	}
	mustKind(session.Execute("askClarification('more?')", nil), "type", "askClarification")
	mustKind(session.Execute("discover({tools:['search']})", nil), "kind", "discover")
	mustKind(session.Execute("recall({query:'docs'})", nil), "kind", "recall")
	mustKind(session.Execute("used('mem1', 'helpful')", nil), "kind", "used")
	mustKind(session.Execute("reportSuccess('ok')", nil), "kind", "status")
	mustKind(session.Execute("guideAgent('Prefer concise final.')", nil), "type", "guide_agent")

	bridged := mustKind(session.Execute("const hit = search({query: inputs.question}); final({title: hit.title, query: hit.query})", nil), "type", "final")
	bridgedPayload := asMap(asSlice(bridged["args"])[0])
	if bridgedPayload["title"] != "Docs" || bridgedPayload["query"] != "goja" {
		panic(fmt.Sprintf("native host callable bridge failed: %#v", bridged))
	}
	protectedCallable := mustKind(session.Execute("search = function(){ return {title:'bad'} }; const hit = search({query: inputs.question}); final({title: hit.title})", nil), "type", "final")
	if asMap(asSlice(protectedCallable["args"])[0])["title"] != "Docs" {
		panic(fmt.Sprintf("host callable overwrite protection failed: %#v", protectedCallable))
	}
	failedCall := mustKind(session.Execute("final({error: badTool({}).error})", nil), "type", "final")
	if asMap(asSlice(failedCall["args"])[0])["error"] != "tool failed" {
		panic(fmt.Sprintf("host callable error normalization failed: %#v", failedCall))
	}
	ambient := mustKind(session.Execute("final({fetchType: typeof fetch, requireType: typeof require, processType: typeof process})", nil), "type", "final")
	ambientPayload := asMap(asSlice(ambient["args"])[0])
	if ambientPayload["fetchType"] != "undefined" || ambientPayload["requireType"] != "undefined" || ambientPayload["processType"] != "undefined" {
		panic(fmt.Sprintf("ambient unsafe APIs should be absent by default: %#v", ambient))
	}

	inputMutation := mustKind(session.Execute("inputs.question = 'mutated'; inputs = {question: 'replaced'}; final({answer: inputs.question})", nil), "type", "final")
	if asMap(asSlice(inputMutation["args"])[0])["answer"] != "goja" {
		panic(fmt.Sprintf("reserved input mutation protection failed: %#v", inputMutation))
	}
	session.Execute("safe = 7; final({safe})", nil)
	snapshot := asMap(session.SnapshotGlobals(nil))
	bindings := asMap(snapshot["bindings"])
	if _, ok := bindings["inputs"]; ok {
		panic(fmt.Sprintf("reserved input leaked into snapshot: %#v", snapshot))
	}
	if _, ok := bindings["search"]; ok {
		panic(fmt.Sprintf("host callable leaked into snapshot: %#v", snapshot))
	}
	session.PatchGlobals(map[string]ax.Value{"bindings": map[string]ax.Value{"safe": 9, "inputs": map[string]ax.Value{"question": "bad"}}}, nil)
	inspected := asMap(session.Inspect(nil))
	if number(inspected["safe"]) != 9 {
		panic(fmt.Sprintf("patch/inspect failed: %#v", inspected))
	}
	inputCheck := mustKind(session.Execute("final({answer: inputs.question, safe})", nil), "type", "final")
	inputPayload := asMap(asSlice(inputCheck["args"])[0])
	if inputPayload["answer"] != "goja" || number(inputPayload["safe"]) != 9 {
		panic(fmt.Sprintf("reserved input restore failed: %#v", inputCheck))
	}

	capped, err := runtime.CreateSession(nil, map[string]ax.Value{"runtimePolicy": map[string]ax.Value{"maxSnapshotBytes": 64}})
	if err != nil {
		panic(err)
	}
	capped.Execute("big = 'x'.repeat(1000); final({ok:true})", nil)
	cappedSnapshot := asMap(capped.SnapshotGlobals(nil))
	if asMap(cappedSnapshot["bindings"])["__ax_snapshot_truncated"] != true {
		panic(fmt.Sprintf("snapshot cap did not mark truncation: %#v", cappedSnapshot))
	}
	capped.Close()

	runtimeErr := mustKind(session.Execute("throw new Error('boom')", nil), "kind", "error")
	if runtimeErr["error_category"] != "runtime" || !strings.Contains(fmt.Sprint(runtimeErr["error"]), "boom") {
		panic(fmt.Sprintf("runtime error normalization failed: %#v", runtimeErr))
	}
	timeout := mustKind(session.Execute("while (true) {}", map[string]ax.Value{"timeoutMs": 10}), "kind", "error")
	if timeout["error_category"] != "timeout" {
		panic(fmt.Sprintf("timeout normalization failed: %#v", timeout))
	}
	session.Close()
	closed := mustKind(session.Execute("final({})", nil), "kind", "error")
	if closed["error_category"] != "session_closed" {
		panic(fmt.Sprintf("closed session behavior failed: %#v", closed))
	}

	fmt.Println("go-javascript-goja-profile-ok runtime-behavior-parity-ok")
}
