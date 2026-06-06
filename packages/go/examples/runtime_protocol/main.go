package main

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
